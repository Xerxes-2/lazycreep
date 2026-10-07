/**
 * Console Panel 的容器（#24）：Main View 底部，默认收起；高度来自外壳状态，内容在内部滚动。
 * 内容第一次展开时才挂载（之前不订阅 Console 频道），之后收起只隐藏，保留已收到的输出。
 * 上边缘的手柄（#30）用 Pointer Events 拖动调高度，也可聚焦后用上下方向键调；高度经 shell.setConsoleHeight 持久化。
 */
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { useI18n } from "../i18n";
import { CONSOLE_HEIGHT, type ShellState } from "./shell-state.ts";

/** 方向键每按一次调整的高度（CSS 像素） */
const KEY_STEP = 20;

function ResizeHandle(props: { shell: ShellState; panel: () => HTMLElement }) {
  const { t } = useI18n();
  const shell = props.shell;
  let drag: { readonly pointerId: number; readonly startY: number; readonly startHeight: number } | undefined;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // 从实际显示的高度起算（样式可能把存下的高度压低）
    const shown = props.panel().getBoundingClientRect().height;
    drag = { pointerId: event.pointerId, startY: event.clientY, startHeight: shown > 0 ? shown : shell.consoleHeight() };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // jsdom 等环境不支持捕获时，仍按普通 move 处理
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // 上边缘往上拖，面板变高
    shell.setConsoleHeight(drag.startHeight + (drag.startY - event.clientY));
  };
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = undefined;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // 同上
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = event.key === "ArrowUp" ? KEY_STEP : event.key === "ArrowDown" ? -KEY_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    shell.setConsoleHeight(shell.consoleHeight() + delta);
  };

  return (
    <div
      class="console-dock__resize"
      data-action="resize-console"
      role="separator"
      tabindex="0"
      aria-orientation="horizontal"
      aria-label={t("consolePanel.resize")}
      aria-valuemin={CONSOLE_HEIGHT.min}
      aria-valuemax={CONSOLE_HEIGHT.max}
      aria-valuenow={shell.consoleHeight()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}

export function ConsoleDock(props: { shell: ShellState; children: () => JSX.Element }) {
  const { t } = useI18n();
  const shell = props.shell;
  const [opened, setOpened] = createSignal(shell.consoleOpen());
  createEffect(() => {
    if (shell.consoleOpen()) setOpened(true);
  });
  let panel!: HTMLElement;
  return (
    <section
      ref={panel}
      class="console-dock"
      data-console-panel
      hidden={!shell.consoleOpen()}
      aria-label={t("console.title")}
      style={{ height: `${shell.consoleHeight()}px` }}
    >
      <ResizeHandle shell={shell} panel={() => panel} />
      <Show when={opened()}>{props.children()}</Show>
    </section>
  );
}
