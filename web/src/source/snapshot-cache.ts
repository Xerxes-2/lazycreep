/**
 * 房间快照缓存（#63）：邻居预加载取到的快照，切过去时直接用，不再请求。
 *
 * - 只在内存里（对象会变，不持久化）；取到后约 60 秒内有效，过期不用、重新请求。
 *   Room View 停留期间每 30 秒在后台刷新邻居的快照（`maxAgeMs`，neighbor-preload.ts），切过去时最多旧 30 秒左右；
 *   实时第一帧到了会整体替换，creep 从快照位置补间过去。
 * - 同一房间的并发请求只发一次（预加载还在途时切过去，并进同一个请求）。
 * - 请求失败照常拒绝、不缓存，下次重新请求；调用方自行静默。
 */
import type { RoomSnapshot, SnapshotOptions } from "./source.ts";

export const SNAPSHOT_FRESH_MS = 60_000;
/** 后台刷新邻居快照的间隔，也是刷新时可接受的最大年龄 */
export const SNAPSHOT_REFRESH_MS = 30_000;

interface Entry {
  /** 取到的时间（Unix 毫秒） */
  readonly at: number;
  readonly value: RoomSnapshot;
}

export interface SnapshotCacheOptions {
  readonly now: () => number;
  readonly fetch: (shard: string, room: string) => Promise<RoomSnapshot>;
}

export function createSnapshotCache(
  options: SnapshotCacheOptions,
): (shard: string, room: string, request?: SnapshotOptions) => Promise<RoomSnapshot> {
  const memory = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<RoomSnapshot>>();

  return (shard, room, request = {}) => {
    const slot = `${shard}/${room}`;
    const now = options.now();
    // 顺手清掉过期的，内存里只留有效期内的
    for (const [key, entry] of memory) if (now - entry.at >= SNAPSHOT_FRESH_MS) memory.delete(key);
    const entry = memory.get(slot);
    const maxAge = Math.min(request.maxAgeMs ?? SNAPSHOT_FRESH_MS, SNAPSHOT_FRESH_MS);
    if (entry && now - entry.at < maxAge) return Promise.resolve(entry.value);
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
