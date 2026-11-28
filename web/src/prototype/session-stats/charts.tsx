/** PROTOTYPE（一次性）：共用的小图、连接条、时间轴与全局状态（窗口、读数游标在所有框里同步）。 */
import { createMemo, createSignal, For, Show } from "solid-js";
import { ago, ALL_METRICS, FEW_METRICS, makeView, type Bucket, type Conn, type View, type WindowKey, WINDOW_LABEL, WINDOWS } from "./data.ts";

const [win, setWin] = createSignal<WindowKey>("30m");
const [cursor, setCursor] = createSignal<number | undefined>();
const [many, setMany] = createSignal(new URLSearchParams(location.search).get("metrics") !== "3");
export { win, setWin, cursor, many, setMany };
/** 当前展示的指标：3 个（只有客户端）或全部 15 个 */
export const activeMetrics = () => (many() ? ALL_METRICS : FEW_METRICS);
/** 某个指标在当前窗口里的桶 */
export const series = (key: string): readonly (Bucket | null)[] => view().buckets[key] ?? [];
const views = new Map<WindowKey, View>();
export const view = createMemo(() => {
  const w = win();
  let v = views.get(w);
  if (!v) views.set(w, (v = makeView(w)));
  return v;
});

/** 游标所指的时刻，距现在多少秒 */
export const cursorAgo = () => {
  const v = view();
  const c = cursor();
  if (c === undefined) return 0;
  return v.to - (v.from + ((c + 0.5) / v.n) * (v.to - v.from));
};

/** 指针在元素上的横向位置 → 桶号；桌面悬停、触屏按住拖动都走 pointer 事件 */
export function scrub(n: () => number) {
  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCursor(Math.max(0, Math.min(n() - 1, Math.floor(((e.clientX - r.left) / r.width) * n()))));
  };
  return {
    onPointerMove: at,
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && setCursor(undefined),
    onPointerUp: (e: PointerEvent) => e.pointerType !== "mouse" && setCursor(undefined),
  };
}

export function WindowButtons() {
  return (
    <div class="ss-win" role="group" aria-label="时间窗口">
      <For each={Object.keys(WINDOWS) as WindowKey[]}>
        {(k) => (
          <button type="button" aria-pressed={win() === k} onClick={() => setWin(k)}>
            {WINDOW_LABEL[k]}
          </button>
        )}
      </For>
    </div>
  );
}

function runs(bs: readonly (Bucket | null)[]): Array<Array<[number, Bucket]>> {
  const out: Array<Array<[number, Bucket]>> = [];
  let cur: Array<[number, Bucket]> = [];
  bs.forEach((b, i) => {
    if (b) cur.push([i, b]);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

export interface SparkProps {
  readonly buckets: readonly (Bucket | null)[];
  readonly conn: readonly Conn[];
  /** CSS 高度；"100%" 时撑满父元素 */
  readonly height: string;
  readonly band?: boolean;
  readonly class?: string;
}

/** 平均值折线 + 桶内 min–max 浅色带；空档（页面隐藏 / 断线）画成灰底，线断开 */
export function Spark(props: SparkProps) {
  const n = () => props.buckets.length;
  const scale = createMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of props.buckets) if (b) (lo = Math.min(lo, props.band ? b.min : b.avg)), (hi = Math.max(hi, props.band ? b.max : b.avg));
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
    return (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  });
  const paths = createMemo(() => {
    const y = scale();
    const rs = runs(props.buckets);
    const line = rs.map((r) => r.map(([i, b], k) => `${k ? "L" : "M"}${i + 0.5} ${y(b.avg).toFixed(2)}`).join("")).join("");
    const band = rs
      .map((r) => {
        const top = r.map(([i, b], k) => `${k ? "L" : "M"}${i} ${y(b.max).toFixed(2)}L${i + 1} ${y(b.max).toFixed(2)}`).join("");
        const bot = [...r].reverse().map(([i, b]) => `L${i + 1} ${y(b.min).toFixed(2)}L${i} ${y(b.min).toFixed(2)}`).join("");
        return top + bot + "Z";
      })
      .join("");
    return { line, band };
  });
  return (
    <div class={`ss-spark ${props.class ?? ""}`} style={{ height: props.height }} {...scrub(n)}>
      <svg viewBox={`0 0 ${n()} 100`} preserveAspectRatio="none" aria-hidden="true">
        <For each={props.conn}>{(c, i) => <Show when={c !== "ok"}>{<rect class={`ss-gap ss-gap--${c}`} x={i()} y={0} width={1} height={100} />}</Show>}</For>
        <Show when={props.band}>
          <path class="ss-band" d={paths().band} />
        </Show>
        <path class="ss-line" d={paths().line} vector-effect="non-scaling-stroke" />
        <Show when={cursor() !== undefined}>
          <line class="ss-cursor" x1={cursor()! + 0.5} x2={cursor()! + 0.5} y1={0} y2={100} vector-effect="non-scaling-stroke" />
        </Show>
      </svg>
    </div>
  );
}

const CONN_LABEL: Record<Conn, string> = { ok: "已连接", hidden: "页面隐藏", reconnecting: "重连中" };
export const connLabel = (c: Conn) => CONN_LABEL[c];

/** 连接条：正常为细实线，隐藏与断线是不同颜色的块 */
export function ConnLane(props: { readonly height?: string }) {
  const v = view;
  return (
    <div class="ss-conn" style={{ height: props.height ?? "8px" }} {...scrub(() => v().n)}>
      <svg viewBox={`0 0 ${v().n} 10`} preserveAspectRatio="none" aria-hidden="true">
        <For each={v().conn}>{(c, i) => <rect class={`ss-conn--${c}`} x={i()} y={c === "ok" ? 4 : 0} width={1.02} height={c === "ok" ? 2 : 10} />}</For>
        <Show when={cursor() !== undefined}>
          <line class="ss-cursor" x1={cursor()! + 0.5} x2={cursor()! + 0.5} y1={0} y2={10} vector-effect="non-scaling-stroke" />
        </Show>
      </svg>
    </div>
  );
}

export function TimeAxis() {
  const span = () => view().to - view().from;
  return (
    <div class="ss-axis" aria-hidden="true">
      <span>{ago(span())}</span>
      <span>{ago(span() / 2)}</span>
      <span>现在</span>
    </div>
  );
}

/** 游标所在桶的连接状态（读数行里显示） */
export const connAtCursor = (): Conn => {
  const c = cursor();
  const v = view();
  return c === undefined ? "ok" : (v.conn[c] ?? "ok");
};
