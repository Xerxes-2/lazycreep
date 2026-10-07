import { createEffect } from "solid-js";
import { I18nProvider, useI18n } from "./i18n";
import { RawReadings } from "./readings/RawReadings.tsx";
import { SettingsPage, type SourceFactory } from "./settings/SettingsPage.tsx";
import { createSettings, type SettingsStorage } from "./settings/settings.ts";
import { LiveSource } from "./source/live-source.ts";

const liveSource: SourceFactory = (server, token) => new LiveSource(server, token === undefined ? {} : { token });

function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function Shell(props: { sourceFor: SourceFactory }) {
  const { locale, setLocale, t } = useI18n();
  const settings = createSettings(browserStorage());

  createEffect(() => {
    document.title = t("app.title");
  });

  const toggleLocale = () => setLocale(locale() === "zh-CN" ? "en" : "zh-CN");

  return (
    <main class="shell">
      <header class="shell__header">
        <h1>{t("app.title")}</h1>
        <button
          type="button"
          data-action="toggle-locale"
          aria-label={t("locale.toggleLabel")}
          onClick={toggleLocale}
        >
          {t("locale.toggle")}
        </button>
      </header>
      <p class="shell__tagline">{t("app.tagline")}</p>
      <SettingsPage settings={settings} sourceFor={props.sourceFor} />
      <RawReadings settings={settings} sourceFor={props.sourceFor} />
    </main>
  );
}

/** `sourceFor` 默认连真实 Server（经同源 Gateway）；测试里换成 FixtureSource。 */
export function App(props: { sourceFor?: SourceFactory }) {
  return (
    <I18nProvider>
      <Shell sourceFor={props.sourceFor ?? liveSource} />
    </I18nProvider>
  );
}
