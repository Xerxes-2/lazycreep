/**
 * Top Bar 的 Tick 时钟：少发 `game/time`，Tick 号与 Tick 速度不必很准。
 *
 * - 来源按优先级：Room View 的房间流（每 Tick 一帧、带 gameTime，最准）> 服务器给的平均 Tick 时长
 *   （`game/shards/info` 的 tickMs，随 Shard 列表缓存）> 相邻两次 `game/time` 校准估出的速度。
 * - Tick 号：最近一个样本（房间流或校准）按 Tick 时长往前推；校准时可能跳一两个 Tick。
 * - 房间流 {@link LIVE_FRESH_MS} 内来过帧时算“在流”：这期间不必校准。
 */
import { createTickRate } from "./tick-rate.ts";

/** 房间流最近一帧在这段时间内算“在流” */
export const LIVE_FRESH_MS = 20_000;

export interface TickClock {
  /** 房间流的一帧（带 gameTime 的） */
  live(gameTime: number, at?: number): void;
  /** 一次 `game/time` 的结果 */
  calibrate(gameTime: number, at?: number): void;
  /** 服务器给的平均 Tick 时长；不知道时 undefined */
  setServerMs(ms: number | undefined): void;
  /** 每 Tick 毫秒数：在流时用房间流实测，否则服务器平均值，再否则校准估计 */
  msPerTick(at?: number): number | undefined;
  /** 推算的当前 Tick；没有样本时 undefined */
  tick(at?: number): number | undefined;
  /** 房间流最近 {@link LIVE_FRESH_MS} 内来过帧 */
  streaming(at?: number): boolean;
}

export function createTickClock(now: () => number = () => performance.now()): TickClock {
  const liveRate = createTickRate({ now });
  const calibrationRate = createTickRate({ now, window: 5 });
  let serverMs: number | undefined;
  let last: { gameTime: number; at: number } | undefined;
  let lastLiveAt: number | undefined;

  const streaming = (at = now()) => lastLiveAt !== undefined && at - lastLiveAt < LIVE_FRESH_MS;
  const msPerTick = (at = now()) => (streaming(at) ? liveRate.msPerTick() : undefined) ?? serverMs ?? calibrationRate.msPerTick();

  return {
    live(gameTime, at = now()) {
      // 断流后重新进来：旧样本的间隔里含着没在看的时间，不能算进速度
      if (!streaming(at)) liveRate.reset();
      liveRate.record(gameTime, at);
      lastLiveAt = at;
      last = { gameTime, at };
    },
    calibrate(gameTime, at = now()) {
      calibrationRate.record(gameTime, at);
      // 校准结果比推算的小（推快了）也照用：宁可跳回一两个 Tick
      last = { gameTime, at };
    },
    setServerMs(ms) {
      serverMs = ms !== undefined && ms > 0 ? ms : undefined;
    },
    msPerTick,
    tick(at = now()) {
      if (!last) return undefined;
      const ms = msPerTick(at);
      return ms === undefined ? last.gameTime : last.gameTime + Math.max(0, Math.floor((at - last.at) / ms));
    },
    streaming,
  };
}
