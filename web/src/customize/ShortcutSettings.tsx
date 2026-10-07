/**
 * 设置里的“快捷键”（#5）：列出全部动作与当前键位，点“重绑”后按下新键；
 * 新键已被别的动作使用时提示冲突，可选择改用（解除另一个）或取消。Esc 取消录入。
 */
import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../i18n";
import { DEFAULT_KEYS, keyFromEvent, SHORTCUT_ACTIONS, type Keybindings, type ShortcutAction } from "./keybindings.ts";

interface Pending {
  readonly action: ShortcutAction;
  readonly key: string;
  readonly other: ShortcutAction;
}

const titleOf = (id: ShortcutAction) => SHORTCUT_ACTIONS.find((a) => a.id === id)!.title;

export function ShortcutSettings(props: { readonly bindings: Keybindings }) {
  const { t } = useI18n();
  const [capturing, setCapturing] = createSignal<ShortcutAction>();
  const [pending, setPending] = createSignal<Pending>();

  const keyLabel = (key: string | undefined) => (key === undefined ? t("shortcuts.unbound") : key === "Space" ? t("shortcuts.space") : key);

  const onCapture = (action: ShortcutAction, event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return setCapturing(undefined);
    const key = keyFromEvent(event);
    if (key === undefined) return;
    setCapturing(undefined);
    const other = props.bindings.conflictWith(action, key);
    if (other) setPending({ action, key, other });
    else props.bindings.set(action, key);
  };

  const confirm = () => {
    const p = pending();
    if (!p) return;
    props.bindings.set(p.other, undefined);
    props.bindings.set(p.action, p.key);
    setPending(undefined);
  };

  const conflicted = (action: ShortcutAction) => {
    const key = props.bindings.keys()[action];
    return key !== undefined && props.bindings.conflicts().has(key);
  };

  return (
    <section class="settings" aria-labelledby="shortcuts-title" data-testid="shortcut-settings">
      <h2 id="shortcuts-title">{t("shortcuts.title")}</h2>
      <p class="settings__muted">{t("shortcuts.hint")}</p>
      <Show when={pending()}>
        {(p) => (
          <div class="settings__error customize__conflict" role="alert" data-testid="shortcut-conflict">
            <p>
              {t("shortcuts.conflict", {
                key: keyLabel(p().key),
                other: t(titleOf(p().other)),
                action: t(titleOf(p().action)),
              })}
            </p>
            <button type="button" data-action="shortcut-replace" onClick={confirm}>
              {t("shortcuts.conflict.replace")}
            </button>{" "}
            <button type="button" data-action="shortcut-cancel" onClick={() => setPending(undefined)}>
              {t("shortcuts.conflict.cancel")}
            </button>
          </div>
        )}
      </Show>
      <Show when={props.bindings.conflicts().size > 0}>
        <p class="settings__error" role="status">
          {t("shortcuts.conflictsExisting")}
        </p>
      </Show>
      <table class="customize__shortcuts">
        <tbody>
          <For each={SHORTCUT_ACTIONS}>
            {(action) => (
              <tr data-shortcut={action.id} data-conflict={conflicted(action.id) ? "" : undefined}>
                <th scope="row">{t(action.title)}</th>
                <td>
                  <Show
                    when={capturing() === action.id}
                    fallback={<kbd data-testid="shortcut-key">{keyLabel(props.bindings.keys()[action.id])}</kbd>}
                  >
                    <button
                      type="button"
                      data-shortcut-capture
                      ref={(el) => queueMicrotask(() => el.focus())}
                      onKeyDown={(e) => onCapture(action.id, e)}
                      onBlur={() => setCapturing(undefined)}
                    >
                      {t("shortcuts.pressKey")}
                    </button>
                  </Show>
                </td>
                <td>
                  <button
                    type="button"
                    data-action="shortcut-rebind"
                    onClick={() => {
                      setPending(undefined);
                      setCapturing(action.id);
                    }}
                  >
                    {t("shortcuts.rebind")}
                  </button>{" "}
                  <button
                    type="button"
                    data-action="shortcut-unbind"
                    disabled={props.bindings.keys()[action.id] === undefined}
                    onClick={() => props.bindings.set(action.id, undefined)}
                  >
                    {t("shortcuts.unbind")}
                  </button>{" "}
                  <button
                    type="button"
                    data-action="shortcut-reset"
                    disabled={props.bindings.keys()[action.id] === DEFAULT_KEYS[action.id]}
                    onClick={() => props.bindings.reset(action.id)}
                  >
                    {t("shortcuts.reset")}
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <button type="button" data-action="shortcut-reset-all" onClick={() => props.bindings.resetAll()}>
        {t("shortcuts.resetAll")}
      </button>
    </section>
  );
}
