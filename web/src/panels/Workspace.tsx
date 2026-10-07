/**
 * 面板系统（#2）：同一组面板，两种布局。
 * - 桌面：12 列网格上的停靠布局。拖标题栏移动、拖右下角缩放（吸附到网格），× 关闭，工具栏里加回面板。
 * - Monitor Mode（窄屏）：底部标签栏切换，一次只显示一个面板；“⋯”里选择标签栏放哪些面板。
 *
 * 面板内容只在面板打开（桌面）或在标签栏里（Monitor Mode）时挂载；在两种布局里都打开的面板，
 * 切换断点时保留同一份 DOM 与状态（地图视口、房间流等不重建）。Monitor Mode 下不在前台的标签只隐藏、不卸载。
 *
 * 新增面板：在面板目录里加一个 PanelDef（id、标题键、桌面默认尺寸、render），需要时把 id 加进默认布局。
 * 跨面板跳转用 PanelController.focus(id)：桌面上打开并滚到它，Monitor Mode 下切到它的标签。
 */
import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { GRID_COLS, type PanelId, type PanelSize } from "./layout.ts";
import type { LayoutStore } from "./layout-store.ts";

/** 网格行高与间距（CSS 像素），与 styles.css 的 .workspace__panels 一致 */
export const ROW_HEIGHT = 40;
export const GRID_GAP = 8;

export interface PanelContext {
  /** 面板此刻是否显示在屏幕上（桌面：已打开；Monitor Mode：当前标签） */
  readonly shown: Accessor<boolean>;
}

export interface PanelDef {
  readonly id: PanelId;
  readonly title: MessageKey;
  /** 桌面布局里新打开时的尺寸（网格单位） */
  readonly size: PanelSize;
  /** 面板挂载时调用一次 */
  readonly render: (panel: PanelContext) => JSX.Element;
}

export interface PanelController {
  readonly store: LayoutStore;
  /** true 时是 Monitor Mode */
  readonly narrow: Accessor<boolean>;
  /** 最近一次 focus 的面板（用于高亮） */
  readonly focused: Accessor<PanelId | undefined>;
  /** 面板此刻是否显示在屏幕上 */
  shown(id: PanelId): boolean;
  /** 切换到 / 聚焦面板：桌面上没打开就打开并滚到它，Monitor Mode 下切到它的标签 */
  focus(id: PanelId): void;
}

export function createPanelController(store: LayoutStore, narrow: Accessor<boolean>): PanelController {
  const [focused, setFocused] = createSignal<PanelId>();
  return {
    store,
    narrow,
    focused,
    shown: (id) => (narrow() ? store.monitor().active === id : store.desktop().panels.some((p) => p.id === id)),
    focus(id) {
      if (narrow()) store.showTab(id);
      else store.openPanel(id);
      setFocused(undefined);
      setFocused(id);
      queueMicrotask(() =>
        document.querySelector(`[data-panel="${id}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
      );
    },
  };
}

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly from: { readonly a: number; readonly b: number };
  readonly apply: (a: number, b: number) => void;
}

export function Workspace(props: { panels: readonly PanelDef[]; controller: PanelController }) {
  const { t } = useI18n();
  const ctl = props.controller;
  const store = ctl.store;
  const defs = createMemo(() => new Map(props.panels.map((p) => [p.id, p])));

  /** 当前布局里挂载的面板，按显示顺序 */
  const mounted = createMemo(() =>
    (ctl.narrow() ? store.monitor().tabs : store.desktop().panels.map((p) => p.id)).filter((id) => defs().has(id)),
  );
  const closedPanels = () => props.panels.filter((p) => !store.desktop().panels.some((d) => d.id === p.id));
  const [manageTabs, setManageTabs] = createSignal(false);

  let grid!: HTMLDivElement;
  /** 一个网格单位对应的 CSS 像素（含间距） */
  const cell = () => ({ x: (grid.clientWidth + GRID_GAP) / GRID_COLS, y: ROW_HEIGHT + GRID_GAP });

  const startDrag = (event: PointerEvent, from: Drag["from"], apply: Drag["apply"]) => {
    if (event.button !== 0 || ctl.narrow()) return;
    const el = event.currentTarget as HTMLElement;
    const drag: Drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from, apply };
    event.preventDefault();
    el.setPointerCapture?.(event.pointerId);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const size = cell();
      drag.apply(
        Math.round(drag.from.a + (e.clientX - drag.startX) / size.x),
        Math.round(drag.from.b + (e.clientY - drag.startY) / size.y),
      );
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const Frame = (frame: { id: PanelId }) => {
    const def = defs().get(frame.id)!;
    const place = () => store.desktop().panels.find((p) => p.id === frame.id);
    const shown = () => ctl.shown(frame.id);
    const style = (): JSX.CSSProperties => {
      const p = place();
      if (ctl.narrow() || !p) return {};
      return { "grid-column": `${p.x + 1} / span ${p.w}`, "grid-row": `${p.y + 1} / span ${p.h}` };
    };
    return (
      <section
        class="panel"
        data-panel={frame.id}
        data-focused={ctl.focused() === frame.id ? "" : undefined}
        hidden={!shown()}
        style={style()}
        aria-label={t(def.title)}
      >
        <header
          class="panel__header"
          onPointerDown={(e) => {
            const p = place();
            if (!p || (e.target as Element).closest("button")) return;
            startDrag(e, { a: p.x, b: p.y }, (x, y) => store.move(frame.id, x, y));
          }}
        >
          <span class="panel__title">{t(def.title)}</span>
          <Show when={!ctl.narrow()}>
            <button
              type="button"
              class="panel__close"
              data-action="close-panel"
              aria-label={t("panels.close", { panel: t(def.title) })}
              onClick={() => store.closePanel(frame.id)}
            >
              ×
            </button>
          </Show>
        </header>
        <div class="panel__body">{def.render({ shown })}</div>
        <Show when={!ctl.narrow()}>
          <div
            class="panel__resize"
            data-action="resize-panel"
            aria-hidden="true"
            onPointerDown={(e) => {
              const p = place();
              if (p) startDrag(e, { a: p.w, b: p.h }, (w, h) => store.resize(frame.id, w, h));
            }}
          />
        </Show>
      </section>
    );
  };

  return (
    <div class="workspace" data-layout={ctl.narrow() ? "monitor" : "desktop"}>
      <Show when={!ctl.narrow()}>
        <div class="workspace__toolbar" role="toolbar" aria-label={t("panels.toolbar")}>
          <Show when={closedPanels().length > 0}>
            <span class="settings__muted">{t("panels.add")}</span>
            <For each={closedPanels()}>
              {(def) => (
                <button type="button" data-action="open-panel" data-panel-id={def.id} onClick={() => ctl.focus(def.id)}>
                  + {t(def.title)}
                </button>
              )}
            </For>
          </Show>
          <button type="button" data-action="reset-layout" onClick={() => store.resetDesktop()}>
            {t("panels.reset")}
          </button>
        </div>
      </Show>
      <div class="workspace__panels" ref={grid}>
        <For each={mounted()}>{(id) => <Frame id={id} />}</For>
      </div>
      <Show when={ctl.narrow()}>
        <Show when={manageTabs()}>
          <div class="workspace__tab-manager" role="dialog" aria-label={t("panels.manageTabs")}>
            <For each={props.panels}>
              {(def) => (
                <label>
                  <input
                    type="checkbox"
                    data-tab-toggle={def.id}
                    checked={store.monitor().tabs.includes(def.id)}
                    onChange={() => store.toggleTab(def.id)}
                  />
                  {t(def.title)}
                </label>
              )}
            </For>
          </div>
        </Show>
        <nav class="workspace__tabs" role="tablist" aria-label={t("panels.tabs")}>
          <For each={mounted()}>
            {(id) => (
              <button
                type="button"
                role="tab"
                data-tab={id}
                aria-selected={store.monitor().active === id}
                onClick={() => {
                  setManageTabs(false);
                  store.showTab(id);
                }}
              >
                {t(defs().get(id)!.title)}
              </button>
            )}
          </For>
          <button
            type="button"
            class="workspace__more"
            data-action="manage-tabs"
            aria-label={t("panels.manageTabs")}
            aria-expanded={manageTabs()}
            onClick={() => setManageTabs((open) => !open)}
          >
            ⋯
          </button>
        </nav>
      </Show>
    </div>
  );
}
