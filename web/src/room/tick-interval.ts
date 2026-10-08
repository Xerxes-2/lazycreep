/**
 * 动画用的 Tick 间隔（ADR 0008）：Live 用 Top Bar 实测的 Tick 速度（测出来之前按 1000 ms），
 * Replay 由回放速度算出；最终取 max(间隔, 100 ms)（照官方渲染器的下限）。
 */

/** Tick 速度测出来之前按这个算 */
export const DEFAULT_TICK_MS = 1000;
/** 再短也按这个算：极快的回放不出现闪烁的残影 */
export const MIN_TICK_MS = 100;

export function animationTickMs(measured: number | undefined): number {
  const ms = measured !== undefined && Number.isFinite(measured) && measured > 0 ? measured : DEFAULT_TICK_MS;
  return Math.max(MIN_TICK_MS, ms);
}
