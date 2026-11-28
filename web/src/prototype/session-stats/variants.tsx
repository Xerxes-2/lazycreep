/**
 * PROTOTYPE（一次性）：三种结构不同的 Session Stats 区块。每种都用 container query 按区块自身宽度排版，
 * 同一个组件既放进 Sidebar 框，也放进 Console Panel 框。
 *
 * A 逐行小图：一个指标一行，当前值大字 + 窗口内 min–max + 满宽小图；≥420px 时数值在左、图在右。
 * B 数字磁贴 + 焦点图：上面一排数字磁贴，点哪个下面就放大哪个（带 y 轴 min/max）；宽时磁贴与大图左右分。
 * C 泳道时间轴：各指标是紧贴的泳道、共一条游标，读数集中在顶部一行（随游标变），像示波器。
 * D 紧凑表格 + 展开：见 VariantD。
 */
import { createSignal, For, Show } from "solid-js";
import { bucketAt, rangeOf, ago, type Metric } from "./data.ts";
import { activeMetrics, ConnLane, connAtCursor, connLabel, cursor, cursorAgo, series, Spark, TimeAxis, view, WindowButtons } from "./charts.tsx";

function Value(props: { metric: Metric }) {
  const b = () => bucketAt(series(props.metric.key), cursor());
  return (
    <span class="ss-value">
      <Show when={b()} fallback={<span class="ss-none">—</span>}>
        {(bb) => (
          <>
            <strong>{props.metric.format(bb().avg)}</strong>
            <span class="ss-unit">{props.metric.unit}</span>
          </>
        )}
      </Show>
    </span>
  );
}

function Range(props: { metric: Metric }) {
  const r = () => rangeOf(series(props.metric.key));
  return (
    <Show when={r()}>
      {(rr) => (
        <span class="ss-range">
          {props.metric.format(rr()[0])}–{props.metric.format(rr()[1])}
        </span>
      )}
    </Show>
  );
}

/** 读数所指时刻：没有游标时是“现在” */
function When() {
  return (
    <span class="ss-when">
      {cursor() === undefined ? "现在" : ago(cursorAgo())}
      <Show when={connAtCursor() !== "ok"}> · {connLabel(connAtCursor())}</Show>
    </span>
  );
}

export function VariantA() {
  return (
    <div class="ss ss-a">
      <div class="ss-toolbar">
        <When />
        <WindowButtons />
      </div>
      <For each={activeMetrics()}>
        {(m) => (
          <div class="ss-a__row">
            <div class="ss-a__head">
              <span class="ss-label">{m.label}</span>
              <Value metric={m} />
              <Range metric={m} />
            </div>
            <Spark buckets={series(m.key)} conn={view().conn} height="36px" band />
          </div>
        )}
      </For>
      <div class="ss-a__row">
        <div class="ss-a__head">
          <span class="ss-label">连接</span>
        </div>
        <ConnLane height="10px" />
      </div>
      <div class="ss-a__row ss-a__axisrow">
        <div class="ss-a__head" />
        <TimeAxis />
      </div>
    </div>
  );
}

export function VariantB() {
  const [focus, setFocus] = createSignal<string>("cpu");
  const fm = () => activeMetrics().find((m) => m.key === focus()) ?? activeMetrics()[0]!;
  return (
    <div class="ss ss-b">
      <div class="ss-toolbar">
        <When />
        <WindowButtons />
      </div>
      <div class="ss-b__grid">
        <div class="ss-b__tiles">
          <For each={activeMetrics()}>
            {(m) => (
              <button type="button" class="ss-b__tile" aria-pressed={focus() === m.key} onClick={() => setFocus(m.key)}>
                <span class="ss-label">{m.label}</span>
                <Value metric={m} />
                <Spark buckets={series(m.key)} conn={view().conn} height="14px" class="ss-spark--mini" />
              </button>
            )}
          </For>
          <div class="ss-b__tile ss-b__tile--conn">
            <span class="ss-label">连接</span>
            <span class="ss-value">
              <strong>{connLabel(connAtCursor())}</strong>
            </span>
            <span class="ss-range">断线 1 次 · 隐藏 6 分</span>
          </div>
        </div>
        <div class="ss-b__focus">
          <div class="ss-b__focushead">
            <span class="ss-label">{fm().label}</span>
            <Range metric={fm()} />
          </div>
          <div class="ss-b__plot">
            <div class="ss-b__yaxis" aria-hidden="true">
              <span>{fm().format(rangeOf(series(fm().key))?.[1] ?? 0)}</span>
              <span>{fm().format(rangeOf(series(fm().key))?.[0] ?? 0)}</span>
            </div>
            <Spark buckets={series(fm().key)} conn={view().conn} height="100%" band class="ss-b__big" />
          </div>
          <ConnLane height="6px" />
          <TimeAxis />
        </div>
      </div>
    </div>
  );
}

export function VariantC() {
  return (
    <div class="ss ss-c">
      <div class="ss-c__readout">
        <When />
        <For each={activeMetrics()}>
          {(m) => (
            <span class="ss-c__item">
              <span class="ss-label">{m.label}</span> <Value metric={m} />
            </span>
          )}
        </For>
        <WindowButtons />
      </div>
      <div class="ss-c__lanes">
        <For each={activeMetrics()}>
          {(m) => (
            <div class="ss-c__lane">
              <span class="ss-c__lanelabel">
                {m.label} <Range metric={m} />
              </span>
              <Spark buckets={series(m.key)} conn={view().conn} height="100%" />
            </div>
          )}
        </For>
        <ConnLane height="8px" />
      </div>
      <TimeAxis />
    </div>
  );
}

/**
 * D 紧凑表格 + 展开：每个指标一行（标签 | 当前值 | 行内小图，约 22px 高），按来源分组；
 * 点行把它放进上方的焦点区（最多 3 个，叠成泳道，共用游标）。宽时表格在左、焦点在右。
 */
export function VariantD() {
  const [picked, setPicked] = createSignal<readonly string[]>(["cpu"]);
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key].slice(-3)));
  const groups = () => {
    const out = new Map<string, Metric[]>();
    for (const m of activeMetrics()) out.set(m.group, [...(out.get(m.group) ?? []), m]);
    return [...out];
  };
  const pickedMetrics = () => picked().flatMap((k) => activeMetrics().filter((m) => m.key === k));
  return (
    <div class="ss ss-d">
      <div class="ss-toolbar">
        <When />
        <WindowButtons />
      </div>
      <div class="ss-d__grid">
        <div class="ss-d__focus">
          <For each={pickedMetrics()} fallback={<p class="ss-d__hint">点下面的行放大，最多 3 个</p>}>
            {(m) => (
              <div class="ss-d__lane">
                <div class="ss-d__lanehead">
                  <span class="ss-label">
                    {m.group.replace(/（.*）/, "")} · {m.label}
                  </span>
                  <Value metric={m} />
                  <Range metric={m} />
                  <button type="button" class="ss-d__close" aria-label="移出焦点" onClick={() => toggle(m.key)}>
                    ×
                  </button>
                </div>
                <div class="ss-d__plot">
                  <Spark buckets={series(m.key)} conn={view().conn} height="100%" band />
                </div>
              </div>
            )}
          </For>
          <ConnLane height="6px" />
          <TimeAxis />
        </div>
        <div class="ss-d__table">
          <For each={groups()}>
            {([group, ms]) => (
              <>
                <div class="ss-d__group">{group}</div>
                <For each={ms}>
                  {(m) => {
                    const b = () => bucketAt(series(m.key), cursor());
                    const r = () => rangeOf(series(m.key));
                    return (
                      <button
                        type="button"
                        class="ss-d__row"
                        classList={{ "ss-d__row--empty": !r() }}
                        aria-pressed={picked().includes(m.key)}
                        title={r() ? `${m.format(r()![0])}–${m.format(r()![1])} ${m.unit}` : "这段时间没在看这个房间"}
                        onClick={() => toggle(m.key)}
                      >
                        <span class="ss-d__label">{m.label}</span>
                        <span class="ss-d__val">
                          {b() ? m.format(b()!.avg) : "—"}
                          <span class="ss-unit">{b() ? m.unit : ""}</span>
                        </span>
                        <Spark buckets={series(m.key)} conn={view().conn} height="16px" class="ss-spark--mini" />
                      </button>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export const VARIANTS = [
  { key: "A", name: "逐行小图", Component: VariantA },
  { key: "B", name: "数字磁贴 + 焦点图", Component: VariantB },
  { key: "C", name: "泳道时间轴", Component: VariantC },
  { key: "D", name: "紧凑表格 + 展开", Component: VariantD },
] as const;
