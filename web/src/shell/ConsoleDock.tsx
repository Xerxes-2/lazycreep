/**
 * Console Panel 的容器（#24）：Main View 底部，默认收起；高度来自外壳状态，内容在内部滚动。
 * 内容第一次展开时才挂载（之前不订阅 Console 频道），之后收起只隐藏，保留已收到的输出。
 * 拖动上边缘调高度属于 #30：调用 shell.setConsoleHeight 即可，存储已就绪。
 */
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { useI18n } from "../i18n";
import type { ShellState } from "./shell-state.ts";

export function ConsoleDock(props: { shell: ShellState; children: () => JSX.Element }) {
  const { t } = useI18n();
  const shell = props.shell;
  const [opened, setOpened] = createSignal(shell.consoleOpen());
  createEffect(() => {
    if (shell.consoleOpen()) setOpened(true);
  });
  return (
    <section
      class="console-dock"
      data-console-panel
      hidden={!shell.consoleOpen()}
      aria-label={t("console.title")}
      style={{ height: `${shell.consoleHeight()}px` }}
    >
      <Show when={opened()}>{props.children()}</Show>
    </section>
  );
}
