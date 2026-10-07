/** 设置里的 Ally List：增删盟友玩家名。 */
import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../i18n";
import type { AllyList } from "./ally-list.ts";

export function AllyListSettings(props: { readonly allies: AllyList }) {
  const { t } = useI18n();
  const [draft, setDraft] = createSignal("");

  const submit = (event: Event) => {
    event.preventDefault();
    props.allies.add(draft());
    setDraft("");
  };

  return (
    <section class="settings" aria-labelledby="allies-title">
      <h2 id="allies-title">{t("mapInfo.allies.title")}</h2>
      <p class="settings__muted">{t("mapInfo.allies.hint")}</p>
      <Show when={props.allies.names().length > 0} fallback={<p class="settings__muted">{t("mapInfo.allies.empty")}</p>}>
        <ul class="allies__list">
          <For each={props.allies.names()}>
            {(name) => (
              <li data-ally={name}>
                <span>{name}</span>{" "}
                <button
                  type="button"
                  aria-label={t("mapInfo.allies.remove", { name })}
                  onClick={() => props.allies.remove(name)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <form class="settings__inline" onSubmit={submit}>
        <input
          name="ally-name"
          autocomplete="off"
          placeholder={t("mapInfo.allies.placeholder")}
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
        <button type="submit">{t("mapInfo.allies.add")}</button>
      </form>
    </section>
  );
}
