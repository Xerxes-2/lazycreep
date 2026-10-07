/**
 * 历史 chunk 的本地缓存（IndexedDB）。
 * 键为 Server + Shard + 房间 + base；记录大小与最近访问时间，总量超过上限时按最久未访问淘汰。
 *
 * 缓存只是加速：打不开、读写出错时一律退化为直接请求，Replay 不受影响。
 */
import type { HistoryChunk, Source } from "../source/source.ts";
import type { HistoryFetcher } from "./replay-engine.ts";

export const DEFAULT_CACHE_LIMIT_MB = 200;
const DB_NAME = "msc-history";
const DB_VERSION = 1;
const META = "meta";
const CHUNKS = "chunks";
const BY_ACCESS = "accessedAt";

export interface HistoryCache {
  /** 命中时同时刷新访问时间 */
  get(key: string): Promise<HistoryChunk | undefined>;
  /** 写入后按上限淘汰最久未访问的 */
  put(key: string, chunk: HistoryChunk): Promise<void>;
  /** 换上限，立即按新上限淘汰 */
  setLimit(bytes: number): Promise<void>;
  /** 当前占用字节数 */
  usage(): Promise<number>;
  close(): void;
}

export interface HistoryCacheOptions {
  /** 默认 globalThis.indexedDB；undefined 表示不可用 */
  readonly indexedDB: IDBFactory | undefined;
  readonly limitBytes: number;
  /** 访问时间的时钟，默认 Date.now */
  readonly now?: () => number;
  readonly name?: string;
}

interface Meta {
  readonly key: string;
  readonly size: number;
  readonly accessedAt: number;
}

export function historyCacheKey(serverId: string, shard: string, room: string, base: number): string {
  return `${serverId}/${shard}/${room}/${base}`;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("事务中止"));
  });
}

function byteSize(chunk: HistoryChunk): number {
  return new TextEncoder().encode(JSON.stringify(chunk)).length;
}

/** 在事务里从最近访问往前累加大小，超过上限的一律删掉。 */
function evict(tx: IDBTransaction, limit: number) {
  let total = 0;
  const cursorRequest = tx.objectStore(META).index(BY_ACCESS).openCursor(null, "prev");
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const meta = cursor.value as Meta;
    total += meta.size;
    if (total > limit) {
      cursor.delete();
      tx.objectStore(CHUNKS).delete(meta.key);
    }
    cursor.continue();
  };
}

/** 打开缓存；IndexedDB 不可用或打不开时得到 undefined。 */
export async function openHistoryCache(options: HistoryCacheOptions): Promise<HistoryCache | undefined> {
  const factory = options.indexedDB;
  if (!factory) return undefined;
  const now = options.now ?? Date.now;
  let limit = options.limitBytes;
  let db: IDBDatabase;
  try {
    const opening = factory.open(options.name ?? DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const upgrade = opening.result;
      if (!upgrade.objectStoreNames.contains(META)) {
        upgrade.createObjectStore(META, { keyPath: "key" }).createIndex(BY_ACCESS, "accessedAt");
      }
      if (!upgrade.objectStoreNames.contains(CHUNKS)) upgrade.createObjectStore(CHUNKS);
    };
    db = await request(opening);
  } catch {
    return undefined;
  }

  return {
    async get(key) {
      const tx = db.transaction([META, CHUNKS], "readwrite");
      const finished = done(tx);
      const chunk = (await request(tx.objectStore(CHUNKS).get(key))) as HistoryChunk | undefined;
      if (chunk) {
        const meta = (await request(tx.objectStore(META).get(key))) as Meta | undefined;
        tx.objectStore(META).put({ key, size: meta?.size ?? byteSize(chunk), accessedAt: now() } satisfies Meta);
      }
      await finished;
      return chunk;
    },
    async put(key, chunk) {
      const size = byteSize(chunk);
      const tx = db.transaction([META, CHUNKS], "readwrite");
      const finished = done(tx);
      tx.objectStore(CHUNKS).put(chunk, key);
      tx.objectStore(META).put({ key, size, accessedAt: now() } satisfies Meta);
      evict(tx, limit);
      await finished;
    },
    async setLimit(bytes) {
      limit = bytes;
      const tx = db.transaction([META, CHUNKS], "readwrite");
      const finished = done(tx);
      evict(tx, limit);
      await finished;
    },
    async usage() {
      const tx = db.transaction(META, "readonly");
      const metas = (await request(tx.objectStore(META).getAll())) as Meta[];
      return metas.reduce((sum, meta) => sum + meta.size, 0);
    },
    close: () => db.close(),
  };
}

/**
 * 在 Source 的历史接口上叠一层缓存：先查缓存，未命中再请求并写回。
 * 历史不存在（null）不缓存（尚未生成的 chunk 之后会出现）；缓存出错时当作未命中。
 */
export function cachedHistory(
  source: Pick<Source, "server" | "getHistoryChunk">,
  cache: HistoryCache | undefined,
): HistoryFetcher {
  return async (shard, room, base) => {
    if (!cache) return source.getHistoryChunk(shard, room, base);
    const key = historyCacheKey(source.server.id, shard, room, base);
    const hit = await cache.get(key).catch(() => undefined);
    if (hit) return hit;
    const chunk = await source.getHistoryChunk(shard, room, base);
    if (chunk) cache.put(key, chunk).catch(() => {});
    return chunk;
  };
}
