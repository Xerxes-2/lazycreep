/**
 * 外壳的快捷键执行者（#24）：M 在 World Map 与 Room View 之间切换 Main View。
 *
 * #5 的数字键面板动作在快捷键目录重做（#30）之前暂时映射到外壳上的对应位置：
 * 地图 / 房间切 Main View，PvP / 对象详情切到对应模式并展开该区块，设置打开 Menu，Console 展开 Console Panel。
 */
import { onCleanup } from "solid-js";
import type { ShortcutCommands } from "../customize/keybindings.ts";
import type { MainViewMode, ShellState } from "./shell-state.ts";

export function registerShellShortcuts(commands: ShortcutCommands, shell: ShellState): void {
  const section = (mode: MainViewMode, id: string) => () => {
    shell.navigate({ view: mode });
    shell.setSidebarOpen(true);
    shell.setSectionCollapsed(id, false);
  };
  onCleanup(
    commands.register({
      "view.toggleMapRoom": () => shell.toggleMainView(),
      "panel.map": () => shell.navigate({ view: "map" }),
      "panel.room": () => shell.navigate({ view: "room" }),
      "panel.pvp": section("map", "map.pvp"),
      "panel.details": section("room", "room.selected"),
      "panel.settings": () => shell.openMenu(),
      "panel.console": () => shell.setConsoleOpen(true),
    }),
  );
}
