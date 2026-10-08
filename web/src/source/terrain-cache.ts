/**
 * 房间地形缓存：地形在一个赛季内不变，进过的房间不再请求 `game/room-terrain`
 * （每次约 1.4 秒，且有每小时 360 次的限额），来回切换房间时地形立即出现。
 *
 * - 内存里一份，按 Server 持久化一份（`msc.terrainCache.<server id>`）；同一房间的并发请求只发一次。
 * - “赛季”标识取版本信息里本赛季的瓦片根地址（`mapTileRoot`，map-tiles.ts；MMO 为 null）：
 *   换赛季时存储里的旧地形整体作废。版本信息取不到时只用内存，不写存储。
 * - 条目有上限，按最近使用淘汰：存储里的对象按使用先后排列（JSON 保持字符串键的插入顺序）。
 */
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import type { ServerVersion, Terrain, TerrainOptions } from "./source.ts";
import type { TileTerrain } from "./tile-terrain.ts";

/** 每个 Server 一个键：`msc.terrainCache.<server id>` */
export const TERRAIN_CACHE_STORAGE: StoredKey = {
  key: "msc.terrainCache.",
  kind: "json-object",
  role: "runtime",
  prefix: true,
};

/** 每个房间约 2.5 KB，上限约 500 KB */
export const TERRAIN_CACHE_MAX_ROOMS = 200;

interface Stored {
  /** 赛季标识：本赛季瓦片根地址；MMO 为 "" */
  readonly season: string;
  /** `<shard>/<room>` → 编码后的地形；先后即使用先后（最早使用的在前） */
  readonly rooms: Readonly<Record<string, string>>;
}

function decodeStored(value: unknown): Stored | undefined {
  if (!isRecord(value) || typeof value["season"] !== "string" || !isRecord(value["rooms"])) return undefined;
  const rooms: Record<string, string> = {};
  for (const [key, encoded] of Object.entries(value["rooms"])) if (typeof encoded === "string") rooms[key] = encoded;
  return { season: value["season"], rooms };
}

export interface TerrainCacheOptions {
  readonly storage: KeyValueStorage | undefined;
  readonly serverId: string;
  readonly getVersion: () => Promise<ServerVersion>;
  readonly fetch: (shard: string, room: string) => Promise<Terrain>;
  /**
   * 从本赛季的地图瓦片解地形（tile-terrain.ts）；认不出时 undefined。缓存未命中时先试它：
   * 准确就直接用（不发 `room-terrain`），不准确就交给 onPreview 先画，再照常请求
   */
  readonly fromTile?: (shard: string, room: string) => Promise<TileTerrain | undefined>;
}

export function createTerrainCache(
  options: TerrainCacheOptions,
): (shard: string, room: string, terrainOptions?: TerrainOptions) => Promise<Terrain> {
  const storageKey = TERRAIN_CACHE_STORAGE.key + options.serverId;
  const memory = new Map<string, Terrain>();
  const inFlight = new Map<string, Promise<Terrain>>();
  const tiles = new Map<string, Promise<TileTerrain | undefined>>();

  /** 同一房间的瓦片只解一次（结束后移除；解出来的准确地形进缓存，近似地形不留） */
  const fromTile = (shard: string, room: string, slot: string): Promise<TileTerrain | undefined> => {
    if (!options.fromTile) return Promise.resolve(undefined);
    let running = tiles.get(slot);
    if (!running) {
      running = options.fromTile(shard, room).catch(() => undefined);
      tiles.set(slot, running);
      void running.then(() => tiles.delete(slot));
    }
    return running;
  };

  const season = (): Promise<string | undefined> =>
    options.getVersion().then(
      (version) => version.mapTileRoot ?? "",
      () => undefined,
    );
  const read = (current: string): Record<string, string> => {
    const stored = readJson(options.storage, storageKey, decodeStored, undefined);
    return stored?.season === current ? { ...stored.rooms } : {};
  };
  /** 把 slot 移到最近使用的位置（必要时写入），超出上限时淘汰最早使用的 */
  const touch = (current: string, slot: string, encoded: string) => {
    const rooms = read(current);
    delete rooms[slot];
    rooms[slot] = encoded;
    const keys = Object.keys(rooms);
    for (const old of keys.slice(0, Math.max(0, keys.length - TERRAIN_CACHE_MAX_ROOMS))) delete rooms[old];
    writeJson(options.storage, storageKey, { season: current, rooms });
  };

  return async (shard, room, terrainOptions) => {
    const slot = `${shard}/${room}`;
    const current = await season();
    const remembered = memory.get(slot);
    if (remembered) {
      if (current !== undefined) touch(current, slot, remembered.encoded);
      return remembered;
    }
    if (current !== undefined) {
      const encoded = read(current)[slot];
      if (encoded !== undefined) {
        const terrain = { shard, room, encoded };
        memory.set(slot, terrain);
        touch(current, slot, encoded);
        return terrain;
      }
    }
    // 版本信息取不到时不解瓦片：默认根地址下可能是旧赛季的瓦片（map-tiles.ts）
    const tile = current === undefined ? undefined : await fromTile(shard, room, slot);
    const again = memory.get(slot);
    if (again) return again;
    if (tile?.exact) {
      const terrain = { shard, room, encoded: tile.encoded };
      memory.set(slot, terrain);
      touch(current!, slot, tile.encoded);
      return terrain;
    }
    if (tile) terrainOptions?.onPreview?.({ shard, room, encoded: tile.encoded });
    const running = inFlight.get(slot);
    if (running) return running;
    const started = options.fetch(shard, room).then((terrain) => {
      memory.set(slot, terrain);
      if (current !== undefined) touch(current, slot, terrain.encoded);
      return terrain;
    });
    inFlight.set(slot, started);
    const done = () => inFlight.delete(slot);
    started.then(done, done);
    return started;
  };
}
