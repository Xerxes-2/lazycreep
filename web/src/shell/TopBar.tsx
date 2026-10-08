/**
 * Top Bar（#24）：左端打开 Menu，随后是应用名；右端是 Sidebar、Console Panel 开合与语言切换。
 * 不放 Main View 切换按钮：从 World Map 点房间进 Room View，Room View 里有“返回地图”，另有 M 键。
 * 状态信息（Server / Shard、连接、Tick、CPU，#25）放进 `top-bar__status` 槽位（children）。
 */
import { Show, type ParentProps } from "solid-js";
import { useI18n } from "../i18n";
import type { ShellState } from "./shell-state.ts";

export interface TopBarProps {
  readonly shell: ShellState;
  /** 是否显示 Console Panel 开合按钮（窄屏上 Console 从 Menu 打开，#29） */
  readonly consoleToggle?: boolean;
}

export function TopBar(props: ParentProps<TopBarProps>) {
  const { locale, setLocale, t } = useI18n();
  const shell = props.shell;
  return (
    <header class="top-bar">
      <button
        type="button"
        class="top-bar__menu"
        data-action="open-menu"
        aria-label={t("shell.menu.open")}
        aria-expanded={shell.menuOpen()}
        onClick={() => (shell.menuOpen() ? shell.closeMenu() : shell.openMenu())}
      >
        ☰
      </button>
      <h1 class="top-bar__title">{t("app.title")}</h1>
      <div class="top-bar__status">{props.children}</div>
      <Show when={props.consoleToggle !== false}>
        <button type="button" data-action="toggle-console" aria-pressed={shell.consoleOpen()} onClick={() => shell.toggleConsole()}>
          {t("console.title")}
        </button>
      </Show>
      <button
        type="button"
        data-action="toggle-sidebar"
        aria-pressed={shell.sidebarOpen()}
        aria-label={t("shell.sidebar.toggle")}
        onClick={() => shell.toggleSidebar()}
      >
        ◨
      </button>
      <button
        type="button"
        data-action="toggle-locale"
        aria-label={t("locale.toggleLabel")}
        onClick={() => setLocale(locale() === "zh-CN" ? "en" : "zh-CN")}
      >
        {t("locale.toggle")}
      </button>
    </header>
  );
}
