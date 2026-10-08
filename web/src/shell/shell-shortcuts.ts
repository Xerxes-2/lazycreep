/**
 * 外壳的快捷键执行者（#24 起，#30 定目录）：Main View 切换、Sidebar 与 Console Panel 开合、Esc 关闭。
 * Replay 的进出与播放控制由 Room View 登记（customize/room-shortcuts.ts）。
 *
 * 反引号：宽屏开合 Console Panel；窄屏没有 Console Panel（#29），改为打开 / 关闭 Menu 的 console 项。
 * H：开合 Sidebar；窄屏的 Sidebar 即底部面板，同一个开合状态。
 * Esc：Menu 打开时关闭 Menu；否则在窄屏结构下收起 Sidebar（窄屏的 Sidebar 即底部面板）；
 * 都不适用时不拦截。Menu 自己也听 Esc（焦点在 Menu 里的输入框时快捷键不生效，Esc 仍应关闭它）。
 */
import { onCleanup, type Accessor } from "solid-js";
import type { ShortcutCommands } from "../customize/keybindings.ts";
import type { ShellState } from "./shell-state.ts";

export function registerShellShortcuts(commands: ShortcutCommands, shell: ShellState, narrow: Accessor<boolean>): void {
  onCleanup(
    commands.register({
      "view.toggleMapRoom": () => shell.toggleMainView(),
      "sidebar.toggle": () => shell.toggleSidebar(),
      "console.toggle": () => {
        if (!narrow()) return shell.toggleConsole();
        if (shell.menuOpen() && shell.menuItem() === "console") shell.closeMenu();
        else shell.openMenu("console");
      },
      "shell.close": () => {
        if (shell.menuOpen()) return void shell.closeMenu();
        if (narrow() && shell.sidebarOpen()) return void shell.setSidebarOpen(false);
        return false;
      },
    }),
  );
}
