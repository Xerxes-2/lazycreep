/**
 * Session Stats 的存储（#65）：本次会话看到的瞬时值，按时间降采样后只放在内存里。
 *
 * - 每个指标按固定分辨率（默认 1 秒）记 min / max / 和 / 个数；私服几毫秒一个 Tick 时，一秒内的样本并进同一格。
 * - 只留最近 retainMs（默认 2 小时）：更早的格子丢掉，内存有上限。
 * - 空档（页面隐藏、断线）单独记成区间，显示时画成两种空档，线在空档处断开。
 * - 不持久化、不跨标签页：刷新页面就是新的会话。
 */

export type GapKind = "hidden" | "offline";

export interface Bucket {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
}

export interface StatsWindow {
  readonly from: number;
  readonly to: number;
  /** 桶数 */
  readonly n: number;
  /** 每个桶里出现过的空档（隐藏优先于断线）；没有为 undefined */
  readonly gaps: readonly (GapKind | undefined)[];
  /** 某个指标在每个桶里的值；没有样本的桶为 null */
  series(key: string): readonly (Bucket | null)[];
}

export interface SessionStore {
  /** 会话开始（构造）的时刻 */
  readonly start: number;
  record(key: string, value: number, at?: number): void;
  /** 当前空档状态：undefined 为正常。重复设同一状态不产生新区间 */
  setGap(kind: GapKind | undefined, at?: number): void;
  /** 最近 spanMs（"all" 为整个保留期）切成 n 个桶 */
  window(span: number | "all", n: number, now?: number): StatsWindow;
  /** 记过的指标，按第一次出现的顺序 */
  keys(): readonly string[];
}

export interface SessionStoreOptions {
  readonly now?: () => number;
  /** 底层分辨率（毫秒），默认 1000 */
  readonly resolutionMs?: number;
  /** 保留多久（毫秒），默认 2 小时 */
  readonly retainMs?: number;
  /** 相邻两个有值的桶相距不超过这么久且中间没有空档时，把中间的空桶补成直线（官服几秒一个 Tick，短窗口里桶比样本密），默认 30 秒 */
  readonly bridgeMs?: number;
}

interface Bin {
  min: number;
  max: number;
  sum: number;
  count: number;
}

interface Series {
  /** 格号 → 格；Map 按插入顺序，格号单调不减，所以最旧的在最前 */
  readonly bins: Map<number, Bin>;
  /** 最新的格号 */
  last: number;
}

interface GapSpan {
  readonly kind: GapKind;
  readonly from: number;
  to: number | undefined;
}

export const DEFAULT_RETAIN_MS = 2 * 60 * 60_000;

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const now = options.now ?? (() => Date.now());
  const res = options.resolutionMs ?? 1000;
  const retain = options.retainMs ?? DEFAULT_RETAIN_MS;
  const bridge = options.bridgeMs ?? 30_000;
  const start = now();
  const series = new Map<string, Series>();
  const gaps: GapSpan[] = [];

  const prune = (s: Series, newest: number) => {
    const oldest = newest - Math.ceil(retain / res);
    for (const index of s.bins.keys()) {
      if (index >= oldest) break;
      s.bins.delete(index);
    }
  };

  const pruneGaps = (at: number) => {
    while (gaps.length && gaps[0]!.to !== undefined && gaps[0]!.to < at - retain) gaps.shift();
  };

  return {
    start,
    record(key, value, at = now()) {
      if (!Number.isFinite(value)) return;
      let s = series.get(key);
      if (!s) series.set(key, (s = { bins: new Map(), last: -Infinity }));
      const index = Math.floor(at / res);
      const bin = s.bins.get(index);
      if (bin) {
        bin.min = Math.min(bin.min, value);
        bin.max = Math.max(bin.max, value);
        bin.sum += value;
        bin.count++;
        return;
      }
      // 时间倒退（理论上不会）的样本丢掉，保持格号单调
      if (index < s.last) return;
      s.last = index;
      s.bins.set(index, { min: value, max: value, sum: value, count: 1 });
      prune(s, index);
    },
    setGap(kind, at = now()) {
      const open = gaps.at(-1);
      if (open && open.to === undefined) {
        if (open.kind === kind) return;
        open.to = at;
      }
      if (kind) gaps.push({ kind, from: at, to: undefined });
      pruneGaps(at);
    },
    window(span, n, at = now()) {
      const to = at;
      const earliest = Math.max(start, to - retain);
      const from = span === "all" ? earliest : to - span;
      const width = (to - from) / n;
      const slot = (t: number) => Math.floor((t - from) / width);

      const marks: (GapKind | undefined)[] = Array.from({ length: n }, () => undefined);
      for (const gap of gaps) {
        const end = gap.to ?? to;
        if (end <= from || gap.from >= to) continue;
        const a = Math.max(0, slot(gap.from));
        const b = Math.min(n - 1, slot(Math.max(gap.from, end - 1)));
        for (let i = a; i <= b; i++) if (marks[i] !== "hidden") marks[i] = gap.kind;
      }

      const cache = new Map<string, readonly (Bucket | null)[]>();
      return {
        from,
        to,
        n,
        gaps: marks,
        series(key) {
          let out = cache.get(key);
          if (out) return out;
          const acc: (Bin | undefined)[] = Array.from({ length: n }, () => undefined);
          for (const [index, bin] of series.get(key)?.bins ?? []) {
            const t = index * res;
            if (t + res <= from || t > to) continue;
            const i = Math.min(n - 1, Math.max(0, slot(t)));
            const into = acc[i];
            if (!into) acc[i] = { ...bin };
            else {
              into.min = Math.min(into.min, bin.min);
              into.max = Math.max(into.max, bin.max);
              into.sum += bin.sum;
              into.count += bin.count;
            }
          }
          const buckets: (Bucket | null)[] = acc.map((b) => (b ? { min: b.min, max: b.max, avg: b.sum / b.count } : null));
          // 补短缺口：两个有值的桶之间的空桶，没有空档、且相距不超过 bridgeMs 时按直线补上
          let prev = -1;
          for (let i = 0; i < n; i++) {
            const here = buckets[i];
            if (!here) continue;
            if (prev >= 0 && i - prev > 1 && (i - prev) * width <= bridge) {
              const left = buckets[prev]!;
              let clear = true;
              for (let j = prev + 1; j < i; j++) if (marks[j]) clear = false;
              if (clear)
                for (let j = prev + 1; j < i; j++) {
                  const v = left.avg + ((here.avg - left.avg) * (j - prev)) / (i - prev);
                  buckets[j] = { min: v, max: v, avg: v };
                }
            }
            prev = i;
          }
          cache.set(key, (out = buckets));
          return out;
        },
      };
    },
    keys: () => [...series.keys()],
  };
}
