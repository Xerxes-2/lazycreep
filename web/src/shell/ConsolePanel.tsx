/**
 * Console Panel 的容器（#24）：Main View 底部，默认收起；高度来自外壳状态，内容在内部滚动。
 * 内容第一次展开时才挂载（之前不订阅 Console 频道），之后收起只隐藏，保留已收到的输出。
 * 上边缘的手柄（#30，ResizeHandle）拖动或用上下方向键调高度；高度经 shell.setConsoleHeight 持久化。
 */
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { useI18n } from "../i18n";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { CONSOLE_HEIGHT, type ShellState } from "./shell-state.ts";

export function ConsolePanel(props: { shell: ShellState; children: () => JSX.Element }) {
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
      class="console-panel"
      data-console-panel
      hidden={!shell.consoleOpen()}
      aria-label={t("console.title")}
      style={{ height: `${shell.consoleHeight()}px` }}
    >
      <ResizeHandle
        class="console-panel__resize"
        action="resize-console"
        label={t("consolePanel.resize")}
        orientation="horizontal"
        range={CONSOLE_HEIGHT}
        value={shell.consoleHeight}
        measure={() => panel.getBoundingClientRect().height}
        resize={shell.setConsoleHeight}
      />
      <Show when={opened()}>{props.children()}</Show>
    </section>
  );
}
