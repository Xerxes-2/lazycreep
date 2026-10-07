/** 设置里的 Attack Alert：启用系统通知、三类条件开关、冷却与停留阈值。 */
import { For, Match, Switch } from "solid-js";
import { useI18n } from "../i18n";
import type { AlertSettings } from "./alert-settings.ts";

export function AlertSettingsPanel(props: { readonly settings: AlertSettings }) {
  const { t } = useI18n();
  const s = props.settings;
  const conditions = [
    { key: "pvp", label: () => t("alert.settings.pvp") },
    { key: "nuke", label: () => t("alert.settings.nuke") },
    { key: "stranger", label: () => t("alert.settings.stranger") },
  ] as const;

  return (
    <section class="settings" aria-labelledby="alert-settings-title">
      <h2 id="alert-settings-title">{t("alert.settings.title")}</h2>
      <p class="settings__muted">{t("alert.settings.hint")}</p>

      <div class="settings__inline" data-testid="alert-permission">
        <Switch>
          <Match when={s.permission() === "granted"}>
            <span>{t("alert.settings.granted")}</span>
          </Match>
          <Match when={s.permission() === "denied"}>
            <span class="settings__muted">{t("alert.settings.denied")}</span>
          </Match>
          <Match when={s.permission() === "unsupported"}>
            <span class="settings__muted">{t("alert.settings.unsupported")}</span>
          </Match>
          <Match when={s.permission() === "default"}>
            <button type="button" data-action="enable-notifications" onClick={() => void s.requestPermission()}>
              {t("alert.settings.enable")}
            </button>
          </Match>
        </Switch>
      </div>

      <For each={conditions}>
        {(c) => (
          <label class="settings__inline">
            <input
              type="checkbox"
              name={`alert-${c.key}`}
              checked={s.config()[c.key]}
              onChange={(e) => s.update({ [c.key]: e.currentTarget.checked })}
            />
            {c.label()}
          </label>
        )}
      </For>

      <label>
        {t("alert.settings.cooldown")}
        <input
          type="number"
          name="alert-cooldown"
          min="1"
          step="1"
          value={s.config().cooldownMinutes}
          onChange={(e) => s.update({ cooldownMinutes: e.currentTarget.valueAsNumber })}
        />
      </label>
      <label>
        {t("alert.settings.strangerTicks")}
        <input
          type="number"
          name="alert-stranger-ticks"
          min="1"
          step="1"
          value={s.config().strangerTicks}
          onChange={(e) => s.update({ strangerTicks: e.currentTarget.valueAsNumber })}
        />
      </label>
    </section>
  );
}
