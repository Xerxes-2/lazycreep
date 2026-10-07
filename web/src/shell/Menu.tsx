/**
 * Menu（#24）：从左侧滑出的层，列出各项（各类设置等）；点一项在同一层里显示它，一次只显示一项，
 * 内容在层内滚动。Esc 或点层外关闭。
 *
 * 新增一个 Menu 项：在 App.tsx 的 Menu 项数组里加一个 MenuItemDef（id 唯一、title 是词典键、
 * render 在该项被打开时调用，关闭或换项时卸载——状态请放在各自的 store 里）。
 * 从别处直接打开某项：shell.openMenu(id)。
 */
import { For, onCleanup, Show, type JSX } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { ShellState } from "./shell-state.ts";

export interface MenuItemDef {
  readonly id: string;
  readonly title: MessageKey;
  readonly render: () => JSX.Element;
}

export function Menu(props: { shell: ShellState; items: readonly MenuItemDef[] }) {
  const { t } = useI18n();
  const shell = props.shell;
  const current = () => props.items.find((item) => item.id === shell.menuItem());

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !shell.menuOpen() || event.defaultPrevented) return;
    event.preventDefault();
    shell.closeMenu();
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <Show when={shell.menuOpen()}>
      <div class="menu-backdrop" data-action="close-menu-backdrop" onClick={() => shell.closeMenu()} />
      <nav class="menu" aria-label={t("shell.menu")} data-item={shell.menuItem()}>
        <header class="menu__header">
          <Show when={current()} fallback={<h2 class="menu__title">{t("shell.menu")}</h2>}>
            {(item) => (
              <>
                <button type="button" data-action="menu-back" aria-label={t("shell.menu.back")} onClick={() => shell.openMenu()}>
                  ‹
                </button>
                <h2 class="menu__title">{t(item().title)}</h2>
              </>
            )}
          </Show>
          <button type="button" data-action="close-menu" aria-label={t("shell.menu.close")} onClick={() => shell.closeMenu()}>
            ×
          </button>
        </header>
        <div class="menu__body">
          <Show
            when={current()}
            keyed
            fallback={
              <ul class="menu__items">
                <For each={props.items}>
                  {(item) => (
                    <li>
                      <button type="button" data-menu-item={item.id} onClick={() => shell.openMenu(item.id)}>
                        {t(item.title)}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            }
          >
            {(item) => (
              <div class="menu__content" data-menu-content={item.id}>
                {item.render()}
              </div>
            )}
          </Show>
        </div>
      </nav>
    </Show>
  );
}
