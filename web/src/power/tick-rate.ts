/**
 * 服务器 Tick 速度（毫秒 / Tick）：由最近若干 Tick 的到达时间估计，
 * 用来察觉服务器卡顿或客户端落后（#14）。
 */

export interface TickRate {
  /** 记下一个 Tick 的到达；重复或倒退的 Tick 号忽略。 */
  record(gameTime: number, at?: number): void;
  /** 窗口内平均每 Tick 毫秒数；不足两个 Tick 时为 undefined。 */
  msPerTick(): number | undefined;
  /** 清空（换房间、或页面隐藏期间的空档不应计入）。 */
  reset(): void;
}

export interface TickRateOptions {
  /** 参与估计的最近 Tick 个数，默认 10 */
  readonly window?: number;
  readonly now?: () => number;
}

export function createTickRate(options: TickRateOptions = {}): TickRate {
  const window = Math.max(2, options.window ?? 10);
  const now = options.now ?? (() => performance.now());
  let samples: { gameTime: number; at: number }[] = [];
  return {
    record(gameTime, at = now()) {
      const last = samples.at(-1);
      if (last && gameTime <= last.gameTime) return;
      samples.push({ gameTime, at });
      if (samples.length > window) samples.shift();
    },
    msPerTick() {
      const first = samples[0];
      const last = samples.at(-1);
      if (!first || !last || last === first) return undefined;
      return (last.at - first.at) / (last.gameTime - first.gameTime);
    },
    reset() {
      samples = [];
    },
  };
}
