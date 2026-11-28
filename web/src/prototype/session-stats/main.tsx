/**
 * PROTOTYPE（一次性）：Session Stats 的布局原型页，`pnpm prototype:stats` 打开。
 * 四种结构不同的区块（?variant=A|B|C|D，?metrics=3|15，底部切换条或 ← →）分别放进 260px、390px（窄屏底部面板）、
 * 640px 三个 Sidebar 框和一个 1280×260 的 Console Panel 框。窗口和读数游标在所有框里同步。
 */
import { render } from "solid-js/web";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { VARIANTS } from "./variants.tsx";
import { many, setMany } from "./charts.tsx";
import "../../styles.css";
import "./proto.css";

type Key = (typeof VARIANTS)[number]["key"];

function initial(): Key {
  const v = new URLSearchParams(location.search).get("variant");
  return VARIANTS.some((x) => x.key === v) ? (v as Key) : "A";
}

function Frame(props: { title: string; note: string; width: number; height: number; sheet?: boolean; children: JSX.Element }) {
  return (
    <figure class="pf">
      <figcaption>
        <strong>{props.title}</strong> <span>{props.note}</span>
      </figcaption>
      <div class="pf__box" classList={{ "pf__box--sheet": !!props.sheet }} style={{ width: `${props.width}px`, height: `${props.height}px` }}>
        {props.children}
      </div>
    </figure>
  );
}

function SidebarMock(props: { children: JSX.Element }) {
  return (
    <>
      <h2 class="sidebar-section__title">
        <button type="button" aria-expanded="false">
          房间信息
        </button>
      </h2>
      <h2 class="sidebar-section__title">
        <button type="button" aria-expanded="true">
          Session Stats
        </button>
      </h2>
      <div class="sidebar-section__body pf__body">{props.children}</div>
      <h2 class="sidebar-section__title">
        <button type="button" aria-expanded="false">
          Minimap
        </button>
      </h2>
    </>
  );
}

function SheetMock(props: { children: JSX.Element }) {
  return (
    <>
      <div class="pf__sheethead">
        <span>房间信息</span>
        <span>Minimap</span>
        <span aria-current="true">Session Stats</span>
        <span>选中对象</span>
      </div>
      <div class="sidebar-section__body pf__body">{props.children}</div>
    </>
  );
}

function ConsoleMock(props: { children: JSX.Element }) {
  return (
    <>
      <div class="pf__consolehead">
        <span>Console</span>
        <span aria-current="true">Stats</span>
      </div>
      <div class="pf__body pf__body--console">{props.children}</div>
    </>
  );
}

function Page() {
  const [key, setKey] = createSignal<Key>(initial());
  const idx = () => VARIANTS.findIndex((v) => v.key === key());
  const go = (d: number) => {
    const next = VARIANTS[(idx() + d + VARIANTS.length) % VARIANTS.length]!.key;
    setKey(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
  };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, [contenteditable]") || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", onKey);
    onCleanup(() => removeEventListener("keydown", onKey));
  });
  const [dark, setDark] = createSignal(matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = () => document.documentElement.setAttribute("data-theme", dark() ? "dark" : "light");
  theme();
  const C = () => VARIANTS[idx()]!.Component;
  return (
    <main class="pp">
      <header class="pp__head">
        <h1>PROTOTYPE · Session Stats 布局</h1>
        <p>
          问题：Sidebar 窄到 260px 时这类时间序列看不看得清？哪种结构最好？假数据：官服 2 小时 session，约 52–58 分钟页面隐藏，约 95 分钟断线 1.5 分钟；15 个指标时房间指标只在当时看那个房间时才有（W12S28 在最近 30 分钟里没看过），Memory.stats 每分钟一个点。
          在任一张图上悬停（触屏按住拖动），所有框同步出读数线。
        </p>
        <button
          type="button"
          onClick={() => {
            setDark(!dark());
            theme();
          }}
        >
          {dark() ? "切到浅色" : "切到深色"}
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            setMany(!many());
            const url = new URL(location.href);
            url.searchParams.set("metrics", many() ? "15" : "3");
            history.replaceState(null, "", url);
          }}
        >
          指标：{many() ? "15 个（切到 3 个）" : "3 个（切到 15 个）"}
        </button>
      </header>
      <div class="pp__row">
        <Frame title="Sidebar 260px" note="自动宽度的下限 / 1024×768 横屏约 290" width={260} height={760}>
          <SidebarMock>
            <Dynamic component={C()} />
          </SidebarMock>
        </Frame>
        <Frame title="窄屏底部面板 390px" note="手机，半屏高，一个区块一个标签" width={390} height={420} sheet>
          <SheetMock>
            <Dynamic component={C()} />
          </SheetMock>
        </Frame>
        <Frame title="Sidebar 640px" note="1366×768 及以上的常见情况" width={640} height={760}>
          <SidebarMock>
            <Dynamic component={C()} />
          </SidebarMock>
        </Frame>
      </div>
      <div class="pp__row">
        <Frame title="Console Panel 的 Stats 标签 1280×260" note="1920 宽屏时 Main View 下方，高度可调 120–800" width={1280} height={260}>
          <ConsoleMock>
            <Dynamic component={C()} />
          </ConsoleMock>
        </Frame>
      </div>
      {import.meta.env.DEV && (
        <nav class="proto-switcher" aria-label="原型方案切换">
          <button type="button" onClick={() => go(-1)} aria-label="上一个">
            ←
          </button>
          <span>
            {key()} <small>（{VARIANTS[idx()]!.name}）</small>
          </span>
          <button type="button" onClick={() => go(1)} aria-label="下一个">
            →
          </button>
        </nav>
      )}
    </main>
  );
}

render(() => <Page />, document.getElementById("root")!);
