/**
 * “外观”里的 Art Style 选项（#42）：官方 / 几何，改动即时生效。
 */
import { For } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { ART_STYLES, type ArtStyleStore } from "./art-style.ts";

export function ArtStyleSettings(props: { readonly store: ArtStyleStore }) {
  const { t } = useI18n();
  return (
    <fieldset class="settings__group" data-testid="art-style-settings">
      <legend>{t("art.style.title")}</legend>
      <For each={ART_STYLES}>
        {(style) => (
          <label>
            <input
              type="radio"
              name="art-style"
              value={style}
              checked={props.store.style() === style}
              onChange={() => props.store.setStyle(style)}
            />
            {t(`art.style.${style}` as MessageKey)}
          </label>
        )}
      </For>
      <p class="settings__muted">{t("art.style.hint")}</p>
    </fieldset>
  );
}
