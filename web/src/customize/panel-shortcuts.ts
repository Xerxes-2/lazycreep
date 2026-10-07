/**
 * 面板导航的快捷键执行者（#5）：切换 / 聚焦各面板，地图与 Room View 之间来回切。
 * 都走 PanelController.focus（#2），桌面与 Monitor Mode 一样可用。
 */
import { onCleanup } from "solid-js";
import type { PanelController } from "../panels/Workspace.tsx";
import { SHORTCUT_ACTIONS, type ShortcutAction, type ShortcutCommands, type ShortcutHandler } from "./keybindings.ts";

/** panels：页面上实际存在的面板 id；不存在的面板对应的快捷键不拦截 */
export function registerPanelShortcuts(
  commands: ShortcutCommands,
  controller: PanelController,
  panels: readonly string[],
): void {
  const handlers: Partial<Record<ShortcutAction, ShortcutHandler>> = {};
  for (const action of SHORTCUT_ACTIONS) {
    if (!("panel" in action)) continue;
    const id = action.panel;
    handlers[action.id] = () => {
      if (!panels.includes(id)) return false;
      controller.focus(id);
      return true;
    };
  }
  handlers["view.toggleMapRoom"] = () => {
    const current = controller.narrow() ? controller.store.monitor().active : controller.focused();
    controller.focus(current === "room" ? "map" : "room");
  };
  onCleanup(commands.register(handlers));
}
