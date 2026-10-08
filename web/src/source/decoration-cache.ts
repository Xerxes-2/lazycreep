/**
 * 房间装饰缓存（#61）：装饰很少变（赛季服全世界一套，MMO 玩家偶尔换），进过的房间一天内不再请求
 * `game/room-decorations`，来回切换房间时装饰与地形一起立即出现。
 *
 * - 内存里一份，按 Server 持久化一份（`msc.decorationCache.<server id>`）；同一房间的并发请求只发一次。
 * - 一天内直接给缓存；过期后先给旧值（调用方不等网络），后台刷新一次，结果供之后使用。
 * - 请求失败：没有旧值时给“没有装饰”（默认外观，不拒绝），不缓存，下次重新请求；有旧值时照旧用旧值。
 * - 条目有上限，按最近使用淘汰（存储里的对象按使用先后排列，与 terrain-cache.ts 相同）。
 */
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import { NO_DECORATIONS, decodeRoomDecorations, type RoomDecorations } from "./room-decorations.ts";

/** 每个 Server 一个键：`msc.decorationCache.<server id>` */
export const DECORATION_CACHE_STORAGE: StoredKey = {
  key: "msc.decorationCache.",
  kind: "json-object",
  role: "runtime",
  prefix: true,
};

/** 赛季房间每个约 1 KB，上限约 200 KB */
export const DECORATION_CACHE_MAX_ROOMS = 200;

export const DECORATIONS_FRESH_MS = 24 * 3_600_000;

interface Entry {
  /** 取得时间（Unix 毫秒） */
  readonly at: number;
  readonly value: RoomDecorations;
}

/** `<shard>/<room>` → 条目；先后即使用先后（最早使用的在前） */
type Stored = Record<string, Entry>;

function decodeStored(value: unknown): Stored | undefined {
  if (!isRecord(value) || !isRecord(value["rooms"])) return undefined;
  const rooms: Stored = {};
  for (const [slot, raw] of Object.entries(value["rooms"])) {
    if (!isRecord(raw) || typeof raw["at"] !== "number") continue;
    const decoded = decodeRoomDecorations(raw["value"]);
    if (decoded) rooms[slot] = { at: raw["at"], value: decoded };
  }
  return rooms;
}

export interface DecorationCacheOptions {
  readonly storage: KeyValueStorage | undefined;
  readonly serverId: string;
  readonly now: () => number;
  readonly fetch: (shard: string, room: string) => Promise<RoomDecorations>;
}

export function createDecorationCache(options: DecorationCacheOptions): (shard: string, room: string) => Promise<RoomDecorations> {
  const storageKey = DECORATION_CACHE_STORAGE.key + options.serverId;
  const memory = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<RoomDecorations>>();

  const read = (): Stored => readJson(options.storage, storageKey, decodeStored, {});
  /** 把 slot 移到最近使用的位置（必要时写入），超出上限时淘汰最早使用的 */
  const touch = (slot: string, entry: Entry) => {
    const rooms = read();
    delete rooms[slot];
    rooms[slot] = entry;
    const keys = Object.keys(rooms);
    for (const old of keys.slice(0, Math.max(0, keys.length - DECORATION_CACHE_MAX_ROOMS))) delete rooms[old];
    writeJson(options.storage, storageKey, { rooms });
  };

  const refresh = (shard: string, room: string, slot: string): Promise<RoomDecorations> => {
    const running = inFlight.get(slot);
    if (running) return running;
    const started = options.fetch(shard, room).then((value) => {
      const entry = { at: options.now(), value };
      memory.set(slot, entry);
      touch(slot, entry);
      return value;
    });
    inFlight.set(slot, started);
    const done = () => inFlight.delete(slot);
    started.then(done, done);
    return started;
  };

  return async (shard, room) => {
    const slot = `${shard}/${room}`;
    const remembered = memory.get(slot);
    const stored = read()[slot];
    const entry = remembered && (!stored || remembered.at >= stored.at) ? remembered : stored;
    if (!entry) return refresh(shard, room, slot).catch(() => NO_DECORATIONS);
    memory.set(slot, entry);
    touch(slot, entry);
    if (options.now() - entry.at >= DECORATIONS_FRESH_MS) refresh(shard, room, slot).catch(() => {});
    return entry.value;
  };
}
