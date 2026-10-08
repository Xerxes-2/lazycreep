/**
 * 静态数据缓存（#35）：包在 Source 工厂外的薄装饰层，只接管 Shard 列表、世界尺寸与版本信息（#47 加入，
 * 带赛季渲染器配置），其余方法原样转发。
 *
 * - 在途去重：同一 Source 内对同一静态请求（Shard 列表；某个 Shard 的世界尺寸）同时只有一个请求，
 *   Top Bar、设置、World Map、Minimap 等各自去要也只发一次。
 * - 持久化：按 Server 存一个键（世界尺寸再按 Shard 分），运行状态、不导出。
 *   新鲜时直接给缓存、不发请求；过期后先给旧值（调用方不等网络），后台刷新一次，结果供之后使用。
 *   请求失败不缓存；后台刷新失败时照旧用旧值。
 *
 * 过期时间：两者都只在开服、合服、赛季切换时才变，但 Shard 列表里还带着房间数、玩家数与 Tick 时长
 * （设置页显示），按一天算；世界尺寸只有赛季重开才会变，按七天算。过期后旧值仍先用着，
 * 所以过期时间只决定“多久核对一次”，不影响首帧快慢。
 *
 * 用在 sharedSources 之内：每个 Server + token 的共享 Source 自带一份，所有调用方自动受益。
 */
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import { rendererFromStored } from "./season-renderer.ts";
import { sharedTime } from "./shared-time.ts";
import { createDecorationCache } from "./decoration-cache.ts";
import { createSnapshotCache } from "./snapshot-cache.ts";
import { createTerrainCache } from "./terrain-cache.ts";
import { decodeTileTerrain, type TilePixels } from "./tile-terrain.ts";
import type { ServerVersion, ShardInfo, Source, UserInfo, WorldSize } from "./source.ts";

/** 每个 Server 一个键：`msc.staticCache.<server id>` */
export const STATIC_CACHE_STORAGE: StoredKey = {
  key: "msc.staticCache.",
  kind: "json-object",
  role: "runtime",
  prefix: true,
};

const HOUR = 3_600_000;
export const SHARDS_FRESH_MS = 24 * HOUR;
export const WORLD_SIZE_FRESH_MS = 7 * 24 * HOUR;
/** 版本信息：渲染器配置只在赛季切换时变，包版本随官方发布；按一天核对一次 */
export const VERSION_FRESH_MS = 24 * HOUR;

export interface StaticCacheOptions {
  readonly storage: KeyValueStorage | undefined;
  /** 当前时间（Unix 毫秒）；默认 Date.now */
  readonly now?: () => number;
  /** 取地图瓦片的像素（tile-terrain.ts 的 loadTilePixels）；不给则不从瓦片解地形 */
  readonly tilePixels?: (url: string) => Promise<TilePixels>;
}

interface Entry<T> {
  /** 取得时间（Unix 毫秒） */
  readonly at: number;
  readonly value: T;
}

interface Stored {
  readonly shards?: Entry<readonly ShardInfo[]>;
  readonly worldSize?: Readonly<Record<string, Entry<WorldSize>>>;
  readonly version?: Entry<ServerVersion>;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function decodeEntry<T>(value: unknown, decode: (raw: unknown) => T | undefined): Entry<T> | undefined {
  if (!isRecord(value) || !isNumber(value["at"])) return undefined;
  const decoded = decode(value["value"]);
  return decoded === undefined ? undefined : { at: value["at"], value: decoded };
}

function decodeShards(value: unknown): readonly ShardInfo[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ok = value.every(
    (s: unknown) =>
      isRecord(s) &&
      typeof s["name"] === "string" &&
      isNumber(s["rooms"]) &&
      isNumber(s["users"]) &&
      isNumber(s["tickMs"]),
  );
  return ok ? (value as ShardInfo[]) : undefined;
}

function decodeSize(value: unknown): WorldSize | undefined {
  if (!isRecord(value) || !isNumber(value["width"]) || !isNumber(value["height"])) return undefined;
  return { width: value["width"], height: value["height"] };
}

function decodeVersion(value: unknown): ServerVersion | undefined {
  if (!isRecord(value) || !isNumber(value["package"]) || !isNumber(value["protocol"])) return undefined;
  if (!isNumber(value["historyChunkSize"])) return undefined;
  const renderer = rendererFromStored(value["renderer"]);
  if (value["renderer"] !== undefined && !renderer) return undefined;
  // 旧版缓存没有瓦片根地址：丢弃重取（否则赛季服会用到旧赛季的瓦片）
  const mapTileRoot = value["mapTileRoot"];
  if (mapTileRoot !== null && typeof mapTileRoot !== "string") return undefined;
  return {
    package: value["package"],
    protocol: value["protocol"],
    historyChunkSize: value["historyChunkSize"],
    ...(renderer ? { renderer } : {}),
    mapTileRoot,
  };
}

function decodeStored(value: unknown): Stored | undefined {
  if (!isRecord(value)) return undefined;
  const shards = decodeEntry(value["shards"], decodeShards);
  const version = decodeEntry(value["version"], decodeVersion);
  const sizes: Record<string, Entry<WorldSize>> = {};
  if (isRecord(value["worldSize"])) {
    for (const [shard, raw] of Object.entries(value["worldSize"])) {
      const entry = decodeEntry(raw, decodeSize);
      if (entry) sizes[shard] = entry;
    }
  }
  return { ...(shards ? { shards } : {}), ...(version ? { version } : {}), worldSize: sizes };
}

/** 一个 Server 的持久化缓存；每次读写都直接对存储，同一 Server 的多个 Source 互相看得见 */
function serverStore(storage: KeyValueStorage | undefined, serverId: string) {
  const key = STATIC_CACHE_STORAGE.key + serverId;
  const read = (): Stored => readJson(storage, key, decodeStored, {});
  return {
    read,
    update: (change: (stored: Stored) => Stored) => writeJson(storage, key, change(read())),
  };
}

/** 当前用户（getMe）的复用时长：回到 World Map 等短时间内的再次请求不再发 */
export const ME_REUSE_MS = 60_000;

/** 包装一个 Source：getShards / getWorldSize / getVersion / getTerrain / getRoomDecorations / getRoomSnapshot 走缓存，getTime 与 getMe 去重（#38），其余原样转发 */
export function withStaticCache(source: Source, options: StaticCacheOptions): Source {
  const now = options.now ?? Date.now;
  const store = serverStore(options.storage, source.server.id);
  const inFlight = new Map<string, Promise<unknown>>();
  /** 本 Source 取到过的值：存储不可用时也不重复请求 */
  const memory = new Map<string, Entry<unknown>>();

  /** 只发一次的请求：结果写进存储，结束后从在途表移除 */
  const refresh = <T>(slot: string, fetch: () => Promise<T>, save: (entry: Entry<T>) => void): Promise<T> => {
    const running = inFlight.get(slot) as Promise<T> | undefined;
    if (running) return running;
    const started = fetch().then((value) => {
      const entry = { at: now(), value };
      memory.set(slot, entry);
      save(entry);
      return value;
    });
    inFlight.set(slot, started);
    const done = () => inFlight.delete(slot);
    started.then(done, done);
    return started;
  };

  const cached = <T>(
    slot: string,
    stored: Entry<T> | undefined,
    freshMs: number,
    fetch: () => Promise<T>,
    save: (entry: Entry<T>) => void,
  ): Promise<T> => {
    const remembered = memory.get(slot) as Entry<T> | undefined;
    const entry = remembered && (!stored || remembered.at >= stored.at) ? remembered : stored;
    if (!entry) return refresh(slot, fetch, save);
    if (now() - entry.at >= freshMs) refresh(slot, fetch, save).catch(() => {});
    return Promise.resolve(entry.value);
  };

  const getShards = (): Promise<readonly ShardInfo[]> =>
    cached(
      "shards",
      store.read().shards,
      SHARDS_FRESH_MS,
      () => source.getShards(),
      (entry) => store.update((stored) => ({ ...stored, shards: entry })),
    );

  const getWorldSize = (shard: string): Promise<WorldSize> =>
    cached(
      `worldSize:${shard}`,
      store.read().worldSize?.[shard],
      WORLD_SIZE_FRESH_MS,
      () => source.getWorldSize(shard),
      (entry) =>
        store.update((stored) => ({
          ...stored,
          worldSize: { ...stored.worldSize, [shard]: entry },
        })),
    );

  const getVersion = (): Promise<ServerVersion> =>
    cached(
      "version",
      store.read().version,
      VERSION_FRESH_MS,
      () => source.getVersion(),
      (entry) => store.update((stored) => ({ ...stored, version: entry })),
    );

  /** 本赛季的单房间瓦片 → 地形；版本信息取不到时 terrain-cache 不会调它 */
  const tileTerrain =
    (load: (url: string) => Promise<TilePixels>) =>
    async (shard: string, room: string) =>
      decodeTileTerrain(await load(source.mapTiles(shard, await getVersion()).room(room)));

  /** 房间地形：赛季内不变，长期缓存（terrain-cache.ts） */
  const getTerrain = createTerrainCache({
    storage: options.storage,
    serverId: source.server.id,
    getVersion,
    fetch: (shard, room) => source.getTerrain(shard, room),
    ...(options.tilePixels ? { fromTile: tileTerrain(options.tilePixels) } : {}),
  });

  /** 房间装饰：一天核对一次，失败时给“没有装饰”（decoration-cache.ts） */
  const getRoomDecorations = createDecorationCache({
    storage: options.storage,
    serverId: source.server.id,
    now,
    fetch: (shard, room) => source.getRoomDecorations(shard, room),
  });

  /** 房间快照：只在内存里留约 10 秒，并发去重（#63，snapshot-cache.ts） */
  const getRoomSnapshot = createSnapshotCache({ now, fetch: (shard, room) => source.getRoomSnapshot(shard, room) });

  /** 当前时间不持久化，只在途去重与短窗口复用（#38，shared-time.ts） */
  const getTime = sharedTime((shard) => source.getTime(shard), now);

  /**
   * 当前用户：在途去重，结果只在内存里复用 {@link ME_REUSE_MS}（我的房间会变，不持久化）。
   * 打开页面时徽章、地图、Minimap、Room View、攻击提醒同时要，每次回到 World Map 地图又要一次；
   * 不去重就是 5–6 份 `auth/me` + `user/rooms`，浏览器还会把同一地址的并发 GET 排成队，最后一份要等好几秒。
   */
  let me: { at: number; value: Promise<UserInfo> } | undefined;
  const getMe = (): Promise<UserInfo> => {
    if (me && now() - me.at < ME_REUSE_MS) return me.value;
    const entry = { at: now(), value: source.getMe() };
    me = entry;
    // 失败不复用：下次重新请求
    entry.value.catch(() => {
      if (me === entry) me = undefined;
    });
    return entry.value;
  };

  return new Proxy(source, {
    get(target, prop) {
      if (prop === "getShards") return getShards;
      if (prop === "getTerrain") return getTerrain;
      if (prop === "getRoomDecorations") return getRoomDecorations;
      if (prop === "getRoomSnapshot") return getRoomSnapshot;
      if (prop === "getTime") return getTime;
      if (prop === "getMe") return getMe;
      if (prop === "getVersion") return getVersion;
      if (prop === "getWorldSize") return getWorldSize;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** 工厂版：经它创建的每个 Source 都带缓存。放在 sharedSources 之内，使每个共享 Source 只包一次 */
export function staticCached(create: SourceFactory, options: StaticCacheOptions): SourceFactory {
  return (server, token) => withStaticCache(create(server, token), options);
}
