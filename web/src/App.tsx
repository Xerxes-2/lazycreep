import { createEffect } from "solid-js";
import { I18nProvider, useI18n } from "./i18n";

function Shell() {
  const { locale, setLocale, t } = useI18n();

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
    </main>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
