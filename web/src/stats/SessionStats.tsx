/**
 * Session Stats 区块（#65，原型方案 D）：紧凑表格 + 展开。
 *
 * - 每个指标一行（标签 | 当前值 | 行内小图），按来源分组：账号（CPU、Memory）、服务器（Tick 时长）、看过的各房间。
 * - 点一行放进上方的焦点区（最多 3 个，叠成泳道，带 min–max 浅色带）；再点或点 × 移出。
 * - 读数线：桌面悬停、触屏按住拖动；所有图同步，读数行显示那一刻的值。
 * - 时间窗口 5 分 / 30 分 / 全部；空档（页面隐藏、断线）画成两种底色，线断开。
 * - 排版按区块自身宽度（container query，styles.css）。
 * 区块不在屏幕上时不重算窗口；在屏幕上时随记录器的 version() 至多每秒重算一次。
 */
import { createMemo, createSignal, For, Index, Show, type Accessor } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { ROOM_METRICS, type RoomMetric } from "./room-metrics.ts";
import { CPU_KEY, MEMORY_KEY, roomKey, TICK_KEY, type SessionRecorder } from "./session-recorder.ts";
import type { Bucket, GapKind, StatsWindow } from "./session-store.ts";

export const WINDOWS = { "5m": 5 * 60_000, "30m": 30 * 60_000, all: "all" } as const;
export type WindowKey = keyof typeof WINDOWS;
const WINDOW_LABEL: Record<WindowKey, MessageKey> = {
  "5m": "sessionStats.window.5m",
  "30m": "sessionStats.window.30m",
  all: "sessionStats.window.all",
};
/** 每个窗口切成的桶数 */
const BUCKETS = 120;
/** 焦点区最多几个指标 */
const MAX_PICKED = 3;

/** 两个模式的区块共用的界面状态：窗口、焦点、读数线 */
export interface SessionStatsUi {
  readonly win: Accessor<WindowKey>;
  setWin(win: WindowKey): void;
  readonly picked: Accessor<readonly string[]>;
  toggle(key: string): void;
  readonly cursor: Accessor<number | undefined>;
  setCursor(index: number | undefined): void;
}

export function createSessionStatsUi(): SessionStatsUi {
  // 默认“全部”：从会话开始到现在。会话刚开始时 30 分的窗口里只有最右边一小段有数据
  const [win, setWin] = createSignal<WindowKey>("all");
  const [picked, setPicked] = createSignal<readonly string[]>([CPU_KEY]);
  const [cursor, setCursor] = createSignal<number>();
  return {
    win,
    setWin,
    picked,
    toggle: (key) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key].slice(-MAX_PICKED))),
    cursor,
    setCursor,
  };
}

/** 一个指标怎么显示：数值（不带单位）与单位；`ref` 是窗口内的最大值，用来定量级 */
interface Format {
  readonly value: (v: number) => string;
  readonly unit: string;
}

interface MetricDef {
  readonly key: string;
  readonly label: MessageKey;
  readonly format: (ref: number) => Format;
  readonly hint?: MessageKey;
}

const fixed = (digits: number, unit = ""): Format => ({ value: (v) => v.toFixed(digits), unit });
const thousands = (): Format => ({
  value: (v) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)),
  unit: "",
});
const bytes = (ref: number): Format =>
  ref >= 1024 * 1024 ? { value: (v) => (v / 1024 / 1024).toFixed(2), unit: "MB" } : { value: (v) => (v / 1024).toFixed(0), unit: "KB" };
/** Tick 时长：官服几秒，私服几毫秒 */
const tickTime = (ref: number): Format => (ref >= 1000 ? { value: (v) => (v / 1000).toFixed(2), unit: "s" } : { value: (v) => v.toFixed(0), unit: "ms" });

const ROOM_DEFS: Record<RoomMetric, Omit<MetricDef, "key">> = {
  storage: { label: "sessionStats.metric.storage", format: thousands },
  terminal: { label: "sessionStats.metric.terminal", format: thousands },
  controller: { label: "sessionStats.metric.controller", format: () => fixed(1, "%") },
  mine: { label: "sessionStats.metric.mine", format: () => fixed(0) },
  hostile: { label: "sessionStats.metric.hostile", format: () => fixed(0) },
};

interface Group {
  readonly id: string;
  readonly title: string;
  /** 焦点区标题里用的短名（房间不带“当前房间”） */
  readonly short: string;
  readonly metrics: readonly MetricDef[];
}

export interface SessionStatsProps {
  readonly recorder: SessionRecorder;
  readonly ui: SessionStatsUi;
  /** Room View 当前的房间（World Map 下为 undefined） */
  readonly current: Accessor<{ readonly shard: string; readonly room: string } | undefined>;
  readonly shown: Accessor<boolean>;
}

const rangeOf = (bs: readonly (Bucket | null)[]): [number, number] | undefined => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bs) if (b) (lo = Math.min(lo, b.min)), (hi = Math.max(hi, b.max));
  return lo <= hi ? [lo, hi] : undefined;
};

/** 读数线所在的桶；没有读数线时取最后一个有值的桶 */
const valueAt = (bs: readonly (Bucket | null)[], cursor: number | undefined): Bucket | null => {
  if (cursor !== undefined) return bs[cursor] ?? null;
  for (let i = bs.length - 1; i >= 0; i--) if (bs[i]) return bs[i]!;
  return null;
};

export function SessionStats(props: SessionStatsProps) {
  const { t } = useI18n();
  const ui = props.ui;

  /** 当前窗口：不在屏幕上时保留上一次的结果，不重算 */
  let last: StatsWindow | undefined;
  const view = createMemo<StatsWindow>(() => {
    props.recorder.version();
    const store = props.recorder.store();
    if (!props.shown() && last) return last;
    return (last = store.window(WINDOWS[ui.win()], BUCKETS));
  });
  const series = (key: string) => view().series(key);

  const duration = (ms: number) => {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (!m) return t("sessionStats.sec", { s });
    return s ? t("sessionStats.minSec", { m, s }) : t("sessionStats.min", { m });
  };
  const span = () => view().to - view().from;
  const cursorAgo = () => {
    const c = ui.cursor();
    return c === undefined ? 0 : span() - ((c + 0.5) / view().n) * span();
  };
  const gapLabel = (gap: GapKind) => t(gap === "hidden" ? "sessionStats.gap.hidden" : "sessionStats.gap.offline");

  const groups = createMemo<readonly Group[]>(() => {
    const keys = new Set((props.recorder.version(), props.recorder.store().keys()));
    const current = props.current();
    const out: Group[] = [
      {
        id: "account",
        title: t("sessionStats.group.account"),
        short: t("sessionStats.group.account"),
        metrics: [
          { key: CPU_KEY, label: "sessionStats.metric.cpu", format: () => fixed(1, "ms") },
          { key: MEMORY_KEY, label: "sessionStats.metric.memory", format: bytes },
        ],
      },
      {
        id: "server",
        title: t("sessionStats.group.server"),
        short: t("sessionStats.group.server"),
        metrics: [{ key: TICK_KEY, label: "sessionStats.metric.tick", format: tickTime, hint: "sessionStats.tickHint" }],
      },
    ];
    const rooms = [...props.recorder.rooms()];
    // 当前房间排最前
    rooms.sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)));
    function isCurrent(r: { shard: string; room: string }) {
      return !!current && current.shard === r.shard && current.room === r.room;
    }
    const shards = new Set(rooms.map((r) => r.shard));
    for (const r of rooms) {
      const name = shards.size > 1 ? `${r.shard}/${r.room}` : r.room;
      out.push({
        id: `room:${r.shard}/${r.room}`,
        title: isCurrent(r) ? t("sessionStats.group.currentRoom", { room: name }) : name,
        short: name,
        metrics: ROOM_METRICS.filter((m) => keys.has(roomKey(r.shard, r.room, m))).map((m) => ({ key: roomKey(r.shard, r.room, m), ...ROOM_DEFS[m] })),
      });
    }
    return out;
  });
  const defs = createMemo(() => new Map(groups().flatMap((g) => g.metrics.map((m) => [m.key, { ...m, group: g.short }] as const))));
  const formatOf = (m: MetricDef) => m.format(Math.abs(rangeOf(series(m.key))?.[1] ?? 0));

  /** 指针横向位置 → 桶号；桌面悬停、触屏按住拖动 */
  const scrub = {
    onPointerMove: (e: PointerEvent) => at(e),
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      at(e);
    },
    onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && ui.setCursor(undefined),
    onPointerUp: (e: PointerEvent) => e.pointerType !== "mouse" && ui.setCursor(undefined),
    onPointerCancel: () => ui.setCursor(undefined),
  };
  function at(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width <= 0) return;
    const n = view().n;
    ui.setCursor(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n))));
  }

  const Value = (p: { def: MetricDef }) => {
    const b = () => valueAt(series(p.def.key), ui.cursor());
    return (
      <span class="session-stats__value">
        <Show when={b()} fallback="—">
          {(bucket) => (
            <>
              {formatOf(p.def).value(bucket().avg)}
              <span class="session-stats__unit">{formatOf(p.def).unit}</span>
            </>
          )}
        </Show>
      </span>
    );
  };

  const Range = (p: { def: MetricDef }) => (
    <Show when={rangeOf(series(p.def.key))}>
      {(r) => (
        <span class="session-stats__range">
          {formatOf(p.def).value(r()[0])}–{formatOf(p.def).value(r()[1])}
        </span>
      )}
    </Show>
  );

  return (
    <div class="session-stats">
      <div class="session-stats__toolbar">
        <span class="session-stats__when" data-stats="when">
          {ui.cursor() === undefined ? t("sessionStats.now") : t("sessionStats.ago", { time: duration(cursorAgo()) })}
          <Show when={ui.cursor() !== undefined && view().gaps[ui.cursor()!]}>{(gap) => <> · {gapLabel(gap())}</>}</Show>
        </span>
        <div class="session-stats__windows" role="group" aria-label={t("sessionStats.windowLabel")}>
          <For each={Object.keys(WINDOWS) as WindowKey[]}>
            {(key) => (
              <button type="button" data-window={key} aria-pressed={ui.win() === key} onClick={() => ui.setWin(key)}>
                {t(WINDOW_LABEL[key])}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="session-stats__body">
        <div class="session-stats__focus">
          <For each={ui.picked().flatMap((key) => defs().get(key) ?? [])} fallback={<p class="session-stats__hint">{t("sessionStats.pickHint")}</p>}>
            {(def) => (
              <div class="session-stats__lane" data-focus={def.key}>
                <div class="session-stats__lanehead">
                  <span class="session-stats__lanelabel">
                    {t(def.label)} · {def.group}
                  </span>
                  <Value def={def} />
                  <Range def={def} />
                  <button type="button" class="session-stats__unpick" aria-label={t("sessionStats.unpick")} onClick={() => ui.toggle(def.key)}>
                    ×
                  </button>
                </div>
                <div class="session-stats__plot" {...scrub}>
                  <Spark buckets={series(def.key)} gaps={view().gaps} cursor={ui.cursor()} band />
                </div>
              </div>
            )}
          </For>
          <div class="session-stats__conn" {...scrub}>
            <GapLane gaps={view().gaps} cursor={ui.cursor()} />
          </div>
          <div class="session-stats__axis" aria-hidden="true">
            <span>{t("sessionStats.ago", { time: duration(span()) })}</span>
            <span>{t("sessionStats.ago", { time: duration(span() / 2) })}</span>
            <span>{t("sessionStats.now")}</span>
          </div>
        </div>

        <div class="session-stats__table">
          <For each={groups()}>
            {(group) => (
              <Show when={group.metrics.length}>
                <div class="session-stats__group">{group.title}</div>
                <For each={group.metrics}>
                  {(def) => {
                    const empty = () => !rangeOf(series(def.key));
                    return (
                      <button
                        type="button"
                        class="session-stats__row"
                        data-metric={def.key}
                        data-empty={empty() ? "" : undefined}
                        aria-pressed={ui.picked().includes(def.key)}
                        title={empty() ? t(def.hint ?? "sessionStats.noData") : undefined}
                        onClick={() => ui.toggle(def.key)}
                      >
                        <span class="session-stats__label">{t(def.label)}</span>
                        <Value def={def} />
                        <Spark buckets={series(def.key)} gaps={view().gaps} cursor={ui.cursor()} />
                      </button>
                    );
                  }}
                </For>
              </Show>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function runs(bs: readonly (Bucket | null)[]): Array<Array<readonly [number, Bucket]>> {
  const out: Array<Array<readonly [number, Bucket]>> = [];
  let run: Array<readonly [number, Bucket]> = [];
  bs.forEach((b, i) => {
    if (b) run.push([i, b]);
    else if (run.length) {
      out.push(run);
      run = [];
    }
  });
  if (run.length) out.push(run);
  return out;
}

/** 平均值折线（+ 可选的桶内 min–max 浅色带）；空档画成底色，线在没有值的桶断开 */
function Spark(props: { buckets: readonly (Bucket | null)[]; gaps: readonly (GapKind | undefined)[]; cursor: number | undefined; band?: boolean }) {
  const paths = createMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of props.buckets) {
      if (!b) continue;
      lo = Math.min(lo, props.band ? b.min : b.avg);
      hi = Math.max(hi, props.band ? b.max : b.avg);
    }
    if (lo > hi) return { line: "", band: "" };
    const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
    const y = (v: number) => (100 - ((v - lo) / (hi - lo)) * 100).toFixed(2);
    const rs = runs(props.buckets);
    const line = rs.map((r) => r.map(([i, b], k) => `${k ? "L" : "M"}${i + 0.5} ${y(b.avg)}`).join("")).join("");
    const band = props.band
      ? rs
          .map((r) => {
            const top = r.map(([i, b], k) => `${k ? "L" : "M"}${i} ${y(b.max)}L${i + 1} ${y(b.max)}`).join("");
            const bottom = [...r]
              .reverse()
              .map(([i, b]) => `L${i + 1} ${y(b.min)}L${i} ${y(b.min)}`)
              .join("");
            return `${top}${bottom}Z`;
          })
          .join("")
      : "";
    return { line, band };
  });
  return (
    <svg class="session-stats__spark" viewBox={`0 0 ${props.buckets.length} 100`} preserveAspectRatio="none" aria-hidden="true">
      <GapRects gaps={props.gaps} height={100} />
      <Show when={props.band}>
        <path class="session-stats__band" d={paths().band} />
      </Show>
      <path class="session-stats__line" d={paths().line} vector-effect="non-scaling-stroke" />
      <Cursor at={props.cursor} height={100} />
    </svg>
  );
}

function GapRects(props: { gaps: readonly (GapKind | undefined)[]; height: number }) {
  return (
    <Index each={props.gaps}>
      {(gap, i) => (
        <Show when={gap()}>
          <rect class={`session-stats__gap session-stats__gap--${gap()}`} x={i} y={0} width={1.02} height={props.height} />
        </Show>
      )}
    </Index>
  );
}

function Cursor(props: { at: number | undefined; height: number }) {
  return (
    <Show when={props.at !== undefined}>
      <line class="session-stats__cursor" x1={props.at! + 0.5} x2={props.at! + 0.5} y1={0} y2={props.height} vector-effect="non-scaling-stroke" />
    </Show>
  );
}

/** 连接条：正常为细线，隐藏与断线为整格色块 */
function GapLane(props: { gaps: readonly (GapKind | undefined)[]; cursor: number | undefined }) {
  return (
    <svg class="session-stats__spark" viewBox={`0 0 ${props.gaps.length} 10`} preserveAspectRatio="none" aria-hidden="true">
      <rect class="session-stats__ok" x={0} y={4} width={props.gaps.length} height={2} />
      <Index each={props.gaps}>
        {(gap, i) => (
          <Show when={gap()}>
            <rect class={`session-stats__lane-gap session-stats__lane-gap--${gap()}`} x={i} y={0} width={1.02} height={10} />
          </Show>
        )}
      </Index>
      <Cursor at={props.cursor} height={10} />
    </svg>
  );
}
