/**
 * 窄屏的底部面板（#29，ADR 0005）：Sidebar 在窄屏上从底部升起占半屏，区块表里当前模式的每个
 * Sidebar Section 变为面板顶部的一个标签，一次显示一个。标签只由区块表（sidebar-sections.tsx）
 * 驱动，新增区块自动出现。面板开合沿用 Sidebar 的开合（shell.sidebarOpen）：点关闭或在顶部下滑收起，
 * Top Bar 的 Sidebar 按钮重新打开。
 *
 * 当前标签不持久化；每个模式各记一个，默认是该模式的第一个区块。
 */
import { createSignal, For, type Accessor } from "solid-js";
import { useI18n } from "../i18n";
import type { MainViewMode, ShellState } from "./shell-state.ts";
import { SIDEBAR_SECTIONS } from "./sidebar-sections.tsx";

/** 选中对象区块（#24 的详情区块）的 id：点选对象时切到它 */
export const SELECTED_OBJECT_SECTION = "room.selected";

/** 下滑超过这个距离（CSS 像素）就收起 */
const SWIPE_CLOSE_PX = 60;

export interface SheetTabs {
  /** 该模式此刻的标签（区块 id）；记下的标签已不在区块表里时退回第一个 */
  active(mode: MainViewMode): string | undefined;
  select(mode: MainViewMode, id: string): void;
}

export function createSheetTabs(): SheetTabs {
  const [chosen, setChosen] = createSignal<Partial<Record<MainViewMode, string>>>({});
  return {
    active(mode) {
      const ids = SIDEBAR_SECTIONS[mode].map((section) => section.id);
      const id = chosen()[mode];
      return id !== undefined && ids.includes(id) ? id : ids[0];
    },
    select: (mode, id) => setChosen((prev) => ({ ...prev, [mode]: id })),
  };
}

/** Room View 的选中信号接到这里：窄屏上选中对象时打开面板并切到选中对象标签 */
export function revealSelection(shell: ShellState, tabs: SheetTabs, narrow: Accessor<boolean>) {
  return (id: string | undefined) => {
    if (id === undefined || !narrow()) return;
    tabs.select("room", SELECTED_OBJECT_SECTION);
    shell.setSidebarOpen(true);
  };
}

/** 面板顶部：标签条与关闭按钮，整条可下滑收起 */
export function SheetHeader(props: { shell: ShellState; tabs: SheetTabs }) {
  const { t } = useI18n();
  const shell = props.shell;
  const mode = () => shell.mainView();
  let start: { id: number; y: number } | undefined;
  return (
    <div
      class="sheet__header"
      data-sheet-handle
      onPointerDown={(event) => {
        start = { id: event.pointerId, y: event.clientY };
      }}
      onPointerUp={(event) => {
        if (start?.id === event.pointerId && event.clientY - start.y > SWIPE_CLOSE_PX) shell.setSidebarOpen(false);
        start = undefined;
      }}
      onPointerCancel={() => {
        start = undefined;
      }}
    >
      <div class="sheet__tabs" role="tablist" aria-label={t("shell.sheet.tabs")}>
        <For each={SIDEBAR_SECTIONS[mode()]}>
          {(section) => (
            <button
              type="button"
              role="tab"
              data-tab={section.id}
              aria-selected={props.tabs.active(mode()) === section.id}
              onClick={() => props.tabs.select(mode(), section.id)}
            >
              {t(section.title)}
            </button>
          )}
        </For>
      </div>
      <button type="button" data-action="close-sheet" aria-label={t("shell.sheet.close")} onClick={() => shell.setSidebarOpen(false)}>
        ×
      </button>
    </div>
  );
}
