/**
 * Sidebar（#24）：Main View 右侧的竖条，按区块表（sidebar-sections.tsx）叠出当前模式的 Sidebar Section。
 * 整条收起时隐藏（Main View 占回空间）；每个区块点标题单独折叠。内容只在区块内部滚动。
 * 宽屏上左边缘的手柄（ResizeHandle）拖动或用左右方向键调宽度，双击恢复自动宽度。
 * 窄屏（#29）上变为底部面板：区块变为标签（bottom-sheet.tsx），折叠状态不起作用。
 */
import { For, Show, type Accessor } from "solid-js";
import { useI18n } from "../i18n";
import { SheetHeader, type SheetTabs } from "./bottom-sheet.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { SIDEBAR_WIDTH, type MainViewMode } from "./shell-state.ts";
import { SIDEBAR_SECTIONS, type SectionContext, type SidebarSectionDef } from "./sidebar-sections.tsx";

const MODES: readonly MainViewMode[] = ["room", "map"];

interface SheetProps {
  readonly narrow: Accessor<boolean>;
  readonly tabs: SheetTabs;
}

function SidebarSection(props: SheetProps & { def: SidebarSectionDef; mode: MainViewMode; ctx: SectionContext }) {
  const { t } = useI18n();
  const shell = props.ctx.shell;
  const id = props.def.id;
  const inMode = () => shell.mainView() === props.mode;
  const expanded = () => !shell.sectionCollapsed(id);
  const tabbed = () => props.narrow() && props.tabs.active(props.mode) === id;
  const open = () => (props.narrow() ? tabbed() : expanded());
  const shown = () => inMode() && shell.sidebarOpen() && open();
  const bodyId = `sidebar-section-${id.replace(/[^a-z0-9-]/gi, "-")}`;
  return (
    <section class="sidebar-section" data-section={id} hidden={!inMode() || (props.narrow() && !tabbed())}>
      <h2 class="sidebar-section__title" hidden={props.narrow()}>
        <button
          type="button"
          data-action="toggle-section"
          aria-expanded={expanded()}
          aria-controls={bodyId}
          onClick={() => shell.toggleSection(id)}
        >
          {t(props.def.title)}
        </button>
      </h2>
      <div class="sidebar-section__body" id={bodyId} hidden={!open()}>
        {props.def.render(props.ctx, { shown })}
      </div>
    </section>
  );
}

export function Sidebar(props: SheetProps & { ctx: SectionContext }) {
  const { t } = useI18n();
  const shell = props.ctx.shell;
  const width = () => (props.narrow() ? undefined : shell.sidebarWidth());
  let aside!: HTMLElement;
  return (
    <>
      <Show when={!props.narrow() && shell.sidebarOpen()}>
        <ResizeHandle
          class="sidebar-resize"
          action="resize-sidebar"
          label={t("shell.sidebar.resize")}
          orientation="vertical"
          range={SIDEBAR_WIDTH}
          value={shell.sidebarWidth}
          measure={() => aside.getBoundingClientRect().width}
          resize={shell.setSidebarWidth}
          onReset={() => shell.setSidebarWidth(undefined)}
        />
      </Show>
      <aside
        ref={aside}
        class="sidebar"
        data-mode={shell.mainView()}
        data-sheet={props.narrow() ? "bottom" : undefined}
        hidden={!shell.sidebarOpen()}
        aria-label={t("shell.sidebar")}
        data-width={width() === undefined ? undefined : "custom"}
        style={width() === undefined ? undefined : { "--sidebar-set-width": `${width()}px` }}
      >
      <Show when={props.narrow()}>
        <SheetHeader shell={shell} tabs={props.tabs} />
      </Show>
      <For each={MODES}>
        {(mode) => <For each={SIDEBAR_SECTIONS[mode]}>{(def) => <SidebarSection def={def} mode={mode} ctx={props.ctx} narrow={props.narrow} tabs={props.tabs} />}</For>}
      </For>
      </aside>
    </>
  );
}
