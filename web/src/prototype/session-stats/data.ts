/**
 * PROTOTYPE（一次性）：假数据。模拟官服一次 2 小时的 session：约 3 秒一个 Tick，
 * 中间页面隐藏 6 分钟（频道暂停，没有样本），后来断线重连 1.5 分钟。
 *
 * 15 个指标分四组：
 * - 客户端：CPU、Memory、Tick（`user:<id>/cpu` 与 tick-rate，每 Tick）
 * - 房间：只有那个房间在 Room View 里时才有（`room:` 流），其余时段为空
 * - Memory.stats：`GET user/memory` 每分钟拉一次，桶之间按上一次的值保持
 */

export type Conn = "ok" | "hidden" | "reconnecting";

export interface Sample {
  /** session 开始后的秒数 */
  readonly t: number;
  readonly v: Readonly<Record<string, number>>;
}

export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly conn: Conn;
}

export const SESSION_S = 7200;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEGMENTS: readonly Segment[] = [
  { from: 0, to: 3120, conn: "ok" },
  { from: 3120, to: 3480, conn: "hidden" },
  { from: 3480, to: 5700, conn: "ok" },
  { from: 5700, to: 5790, conn: "reconnecting" },
  { from: 5790, to: SESSION_S, conn: "ok" },
];

const connAt = (t: number): Conn => SEGMENTS.find((s) => t >= s.from && t < s.to)?.conn ?? "ok";
const within = (spans: ReadonlyArray<readonly [number, number]>) => (t: number) => spans.some(([a, b]) => t >= a && t < b);

/** 在看哪个房间（Room View 在屏幕上） */
const viewingA = within([
  [600, 1800],
  [4800, SESSION_S],
]);
const viewingB = within([
  [1800, 3000],
  [5000, 5400],
]);
const battle = (t: number) => t > 6300 && t < 6550;

export interface Metric {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly format: (v: number) => string;
  readonly unit: string;
  /** 采样间隔（秒）；0 为每 Tick */
  readonly period: number;
  /** 这一刻有没有这个数据（例如房间是否在看） */
  readonly when?: (t: number) => boolean;
  readonly gen: (t: number, r: () => number, prev: number | undefined, dt: number) => number;
}

const k = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
const int = (v: number) => Math.round(v).toString();
const pct = (v: number) => v.toFixed(1);

const G_CLIENT = "客户端";
const G_ROOM_A = "W13S28（当前房间）";
const G_ROOM_B = "W12S28";
const G_MEM = "Memory.stats（每分钟）";

export const ALL_METRICS: readonly Metric[] = [
  {
    key: "cpu",
    label: "CPU",
    group: G_CLIENT,
    format: (v) => v.toFixed(1),
    unit: "ms",
    period: 0,
    gen: (t, r) => 9 + 2.5 * Math.sin(t / 600) + r() * 3 + (r() < 0.03 ? 8 + r() * 10 : 0) + (battle(t) ? 7 : 0),
  },
  {
    key: "mem",
    label: "Memory",
    group: G_CLIENT,
    format: (v) => (v / 1_000_000).toFixed(2),
    unit: "MB",
    period: 0,
    gen: (_t, r, p) => (p ?? 1_620_000) + 120 + r() * 200 - (r() < 0.0012 ? 120_000 + r() * 60_000 : 0),
  },
  { key: "tickMs", label: "Tick", group: G_CLIENT, format: (v) => (v / 1000).toFixed(2), unit: "s/Tick", period: 0, gen: (_t, _r, _p, dt) => dt * 1000 },

  { key: "a.storage", label: "storage 能量", group: G_ROOM_A, format: k, unit: "", period: 0, when: viewingA, gen: (t, r, p) => (p ?? 412_000) + (battle(t) ? -300 : 40) + (r() - 0.5) * 400 },
  { key: "a.terminal", label: "terminal 能量", group: G_ROOM_A, format: k, unit: "", period: 0, when: viewingA, gen: (t) => 50_000 + 15_000 * Math.sin(t / 400) },
  { key: "a.ctrl", label: "controller 进度", group: G_ROOM_A, format: pct, unit: "%", period: 0, when: viewingA, gen: (t) => (t / 90) % 100 },
  { key: "a.creeps", label: "我的 creep", group: G_ROOM_A, format: int, unit: "", period: 0, when: viewingA, gen: (t, r) => Math.round(15 + 2 * Math.sin(t / 300) + r()) },
  { key: "a.hostile", label: "敌方 creep", group: G_ROOM_A, format: int, unit: "", period: 0, when: viewingA, gen: (t, r) => (battle(t) ? 3 + Math.round(r() * 2) : 0) },

  { key: "b.storage", label: "storage 能量", group: G_ROOM_B, format: k, unit: "", period: 0, when: viewingB, gen: (_t, r, p) => (p ?? 180_000) + 25 + (r() - 0.5) * 300 },
  { key: "b.creeps", label: "我的 creep", group: G_ROOM_B, format: int, unit: "", period: 0, when: viewingB, gen: (t, r) => Math.round(8 + Math.sin(t / 250) + r()) },

  { key: "m.bucket", label: "bucket", group: G_MEM, format: int, unit: "", period: 60, gen: (t, r, p) => Math.min(10_000, Math.max(0, (p ?? 10_000) + (battle(t) ? -180 : 60) + (r() - 0.5) * 40)) },
  { key: "m.gcl", label: "GCL 进度", group: G_MEM, format: pct, unit: "%", period: 60, gen: (t) => 37 + t / 1800 },
  { key: "m.credits", label: "credits", group: G_MEM, format: k, unit: "", period: 60, gen: (_t, r, p) => (p ?? 1_230_000) + (r() - 0.45) * 4000 },
  { key: "m.harvest", label: "采集 / Tick", group: G_MEM, format: int, unit: "", period: 60, gen: (_t, r) => 68 + r() * 10 },
  { key: "m.spawn", label: "spawn 占用", group: G_MEM, format: int, unit: "%", period: 60, gen: (t, r) => 55 + 20 * Math.sin(t / 900) + r() * 10 },
];

export const FEW_METRICS: readonly Metric[] = ALL_METRICS.slice(0, 3);

function generate(): Sample[] {
  const r = rng(42);
  const out: Sample[] = [];
  const prev: Record<string, number> = {};
  const due: Record<string, number> = {};
  let t = 0;
  while (t < SESSION_S) {
    let dt = 2.7 + r() * 0.6;
    if (r() < 0.006) dt += 3 + r() * 4; // 服务器偶尔卡一下
    t += dt;
    const v: Record<string, number> = {};
    for (const m of ALL_METRICS) {
      if (m.period && t < (due[m.key] ?? 0)) continue;
      if (m.when && !m.when(t)) continue;
      // 时间照常走，只是看不见：先算出值再决定记不记，保持连续
      const val = m.gen(t, r, prev[m.key], dt);
      prev[m.key] = val;
      if (m.period) due[m.key] = t + m.period;
      if (connAt(t) === "ok") v[m.key] = val;
    }
    out.push({ t, v });
  }
  return out;
}

export const SAMPLES: readonly Sample[] = generate();

export interface Bucket {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
}

export const WINDOWS = { "5m": 300, "30m": 1800, all: SESSION_S } as const;
export type WindowKey = keyof typeof WINDOWS;
export const WINDOW_LABEL: Record<WindowKey, string> = { "5m": "5 分", "30m": "30 分", all: "全部" };

export interface View {
  readonly from: number;
  readonly to: number;
  readonly buckets: Readonly<Record<string, readonly (Bucket | null)[]>>;
  /** 每个桶的连接状态（桶内出现过非 ok 就记非 ok） */
  readonly conn: readonly Conn[];
  readonly n: number;
}

/** 窗口内按固定桶数降采样；没有样本的桶为 null（画成空档）。按分钟拉的指标在两次之间保持上一次的值。 */
export function makeView(win: WindowKey, n = 120): View {
  const to = SESSION_S;
  const from = to - WINDOWS[win];
  const span = (to - from) / n;
  const conn = Array.from({ length: n }, (_, i) => {
    const a = from + i * span;
    const b = a + span;
    return SEGMENTS.find((s) => s.conn !== "ok" && s.from < b && s.to > a)?.conn ?? "ok";
  });
  const buckets: Record<string, (Bucket | null)[]> = {};
  for (const m of ALL_METRICS) {
    const acc = Array.from({ length: n }, () => [] as number[]);
    let last: { t: number; v: number } | undefined;
    for (const s of SAMPLES) {
      const v = s.v[m.key];
      if (v === undefined) continue;
      if (s.t < from) {
        last = { t: s.t, v };
        continue;
      }
      acc[Math.min(n - 1, Math.floor((s.t - from) / span))]!.push(v);
    }
    const bs: (Bucket | null)[] = [];
    acc.forEach((vs, i) => {
      if (vs.length) {
        const b = { min: Math.min(...vs), max: Math.max(...vs), avg: vs.reduce((a, c) => a + c, 0) / vs.length };
        bs.push(b);
        last = { t: from + (i + 1) * span, v: b.avg };
      } else if (m.period && last && conn[i] === "ok" && from + i * span - last.t < m.period * 1.5) {
        bs.push({ min: last.v, max: last.v, avg: last.v });
      } else bs.push(null);
    });
    buckets[m.key] = bs;
  }
  return { from, to, buckets, conn, n };
}

export function rangeOf(bs: readonly (Bucket | null)[] | undefined): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bs ?? []) {
    if (!b) continue;
    lo = Math.min(lo, b.min);
    hi = Math.max(hi, b.max);
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/** 游标所在桶；没有游标时取最后一个有值的桶 */
export function bucketAt(bs: readonly (Bucket | null)[] | undefined, idx: number | undefined): Bucket | null {
  if (!bs) return null;
  if (idx !== undefined) return bs[idx] ?? null;
  for (let i = bs.length - 1; i >= 0; i--) if (bs[i]) return bs[i]!;
  return null;
}

export function ago(seconds: number): string {
  if (seconds < 1) return "现在";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `−${m}分${s ? `${s}秒` : ""}` : `−${s}秒`;
}
