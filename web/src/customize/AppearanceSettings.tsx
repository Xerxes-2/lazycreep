/**
 * 设置里的“外观”（#5）：页面明暗主题，以及 Scene 的调色板与着色规则。改动即时生效。
 */
import { createSignal, For, Index, Show } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { StrangerColoring } from "../scene/theme.ts";
import { colorToHex, hexToColor, PALETTE_KEYS, type ColorScheme } from "./color-scheme.ts";
import { UI_THEME_PREFERENCES, type UiThemeStore } from "./ui-theme.ts";
import type { ArtStyleStore } from "../art/art-style.ts";
import { ArtStyleSettings } from "../art/ArtStyleSettings.tsx";

export interface AppearanceSettingsProps {
  readonly uiTheme: UiThemeStore;
  readonly colors: ColorScheme;
  /** Art Style（#42） */
  readonly artStyle?: ArtStyleStore;
}

export function AppearanceSettings(props: AppearanceSettingsProps) {
  const { t } = useI18n();
  const theme = () => props.colors.theme();
  const [playerName, setPlayerName] = createSignal("");
  const [playerColor, setPlayerColor] = createSignal("#ff8800");

  const addPlayer = (event: Event) => {
    event.preventDefault();
    const color = hexToColor(playerColor());
    if (!playerName().trim() || color === undefined) return;
    props.colors.setPlayerColor(playerName(), color);
    setPlayerName("");
  };

  return (
    <section class="settings" aria-labelledby="appearance-title" data-testid="appearance-settings">
      <h2 id="appearance-title">{t("customize.appearance.title")}</h2>

      <fieldset class="settings__group">
        <legend>{t("customize.uiTheme.title")}</legend>
        <For each={UI_THEME_PREFERENCES}>
          {(choice) => (
            <label>
              <input
                type="radio"
                name="ui-theme"
                value={choice}
                checked={props.uiTheme.preference() === choice}
                onChange={() => props.uiTheme.setPreference(choice)}
              />
              {t(`customize.uiTheme.${choice}` as MessageKey)}
            </label>
          )}
        </For>
      </fieldset>

      <Show when={props.artStyle}>{(store) => <ArtStyleSettings store={store()} />}</Show>

      <fieldset class="settings__group">
        <legend>{t("customize.rules.title")}</legend>
        <label>
          {t("customize.rules.strangers")}
          <select
            name="stranger-coloring"
            value={theme().strangerColoring}
            onChange={(e) => props.colors.setStrangerColoring(e.currentTarget.value as StrangerColoring)}
          >
            <option value="perPlayer">{t("customize.rules.perPlayer")}</option>
            <option value="faction">{t("customize.rules.faction")}</option>
          </select>
        </label>
        <p class="settings__muted">{t("customize.rules.playersHint")}</p>
        <Show when={Object.keys(theme().playerColors).length > 0}>
          <ul class="customize__players">
            <For each={Object.entries(theme().playerColors)}>
              {([name, color]) => (
                <li data-player-color={name}>
                  <input
                    type="color"
                    aria-label={t("customize.rules.playerColor", { name })}
                    value={colorToHex(color)}
                    onInput={(e) => {
                      const next = hexToColor(e.currentTarget.value);
                      if (next !== undefined) props.colors.setPlayerColor(name, next);
                    }}
                  />{" "}
                  <span>{name}</span>{" "}
                  <button
                    type="button"
                    aria-label={t("customize.rules.removePlayer", { name })}
                    onClick={() => props.colors.setPlayerColor(name, undefined)}
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <form class="settings__inline" onSubmit={addPlayer}>
          <input
            name="player-color-name"
            autocomplete="off"
            placeholder={t("customize.rules.playerPlaceholder")}
            value={playerName()}
            onInput={(e) => setPlayerName(e.currentTarget.value)}
          />
          <input
            type="color"
            name="player-color-value"
            aria-label={t("customize.rules.newPlayerColor")}
            value={playerColor()}
            onInput={(e) => setPlayerColor(e.currentTarget.value)}
          />
          <button type="submit">{t("customize.rules.addPlayer")}</button>
        </form>
      </fieldset>

      <fieldset class="settings__group">
        <legend>{t("customize.palette.title")}</legend>
        <p class="settings__muted">{t("customize.palette.hint")}</p>
        <div class="customize__palette">
          <For each={PALETTE_KEYS}>
            {(key) => (
              <label>
                <input
                  type="color"
                  name={`palette-${key}`}
                  value={colorToHex(theme()[key])}
                  onInput={(e) => {
                    const next = hexToColor(e.currentTarget.value);
                    if (next !== undefined) props.colors.setColor(key, next);
                  }}
                />
                {t(`customize.palette.${key}` as MessageKey)}
              </label>
            )}
          </For>
        </div>
        <p>{t("customize.palette.strangers")}</p>
        <div class="customize__palette">
          <Index each={theme().strangers}>
            {(color, i) => (
              <input
                type="color"
                name={`palette-stranger-${i}`}
                aria-label={t("customize.palette.stranger", { n: i + 1 })}
                value={colorToHex(color())}
                onInput={(e) => {
                  const next = hexToColor(e.currentTarget.value);
                  if (next !== undefined) props.colors.setStranger(i, next);
                }}
              />
            )}
          </Index>
        </div>
        <button type="button" data-action="reset-colors" onClick={() => props.colors.reset()}>
          {t("customize.palette.reset")}
        </button>
      </fieldset>
    </section>
  );
}
