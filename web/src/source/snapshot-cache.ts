/**
 * 房间快照缓存（#63）：邻居预加载取到的快照，切过去时直接用，不再请求。
 *
 * - 只在内存里（对象会变，不持久化）；取到后约 10 秒内有效，过期不用、重新请求。
 * - 同一房间的并发请求只发一次（预加载还在途时切过去，并进同一个请求）。
 * - 请求失败照常拒绝、不缓存，下次重新请求；调用方自行静默。
 */
import type { RoomSnapshot } from "./source.ts";

export const SNAPSHOT_FRESH_MS = 10_000;

interface Entry {
  /** 取到的时间（Unix 毫秒） */
  readonly at: number;
  readonly value: RoomSnapshot;
}

export interface SnapshotCacheOptions {
  readonly now: () => number;
  readonly fetch: (shard: string, room: string) => Promise<RoomSnapshot>;
}

export function createSnapshotCache(options: SnapshotCacheOptions): (shard: string, room: string) => Promise<RoomSnapshot> {
  const memory = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<RoomSnapshot>>();

  return (shard, room) => {
    const slot = `${shard}/${room}`;
    const now = options.now();
    // 顺手清掉过期的，内存里只留 10 秒内的
    for (const [key, entry] of memory) if (now - entry.at >= SNAPSHOT_FRESH_MS) memory.delete(key);
    const entry = memory.get(slot);
    if (entry) return Promise.resolve(entry.value);
    const running = inFlight.get(slot);
    if (running) return running;
    const started = options.fetch(shard, room).then((value) => {
      memory.set(slot, { at: options.now(), value });
      return value;
    });
    inFlight.set(slot, started);
    const done = () => inFlight.delete(slot);
    started.then(done, done);
    return started;
  };
}
