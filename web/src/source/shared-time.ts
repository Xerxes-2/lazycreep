/**
 * 当前时间（game/time）去重（#38）：由静态数据缓存层（static-cache.ts）接管 Source 的 getTime。
 *
 * - 在途去重：同一 Source 内同一 Shard 同时只有一个请求，Top Bar、设置、Room View、Replay 一起要也只发一次。
 * - 短窗口复用：刚到达的结果在 TIME_REUSE_MS 内直接给，远小于一个 Tick（赛季服约 3.7 秒），不持久化。
 * - 调用方可用 `maxAgeMs` 收紧复用。Top Bar 的 Tick 速度估算依赖结果的到达时刻，它传 0：
 *   只并入在途请求（到达时刻是真实的），不拿已到达的旧结果，所以复用不会被当作新的采样。
 * - 失败不复用。按 Shard 分开。
 */
import type { TimeOptions } from "./source.ts";

/** 复用窗口（毫秒） */
export const TIME_REUSE_MS = 1000;

export type GetTime = (shard: string, options?: TimeOptions) => Promise<number>;

/** 包装底层 getTime：在途去重 + 短窗口复用 */
export function sharedTime(fetch: (shard: string) => Promise<number>, now: () => number): GetTime {
  const inFlight = new Map<string, Promise<number>>();
  const recent = new Map<string, { readonly at: number; readonly value: number }>();

  return (shard, options) => {
    const running = inFlight.get(shard);
    if (running) return running;
    const last = recent.get(shard);
    const maxAge = Math.min(options?.maxAgeMs ?? TIME_REUSE_MS, TIME_REUSE_MS);
    if (last && now() - last.at < maxAge) return Promise.resolve(last.value);
    const started = fetch(shard).then((value) => {
      recent.set(shard, { at: now(), value });
      return value;
    });
    inFlight.set(shard, started);
    const done = () => inFlight.delete(shard);
    started.then(done, done);
    return started;
  };
}
