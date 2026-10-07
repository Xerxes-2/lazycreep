import { createEffect, type Accessor } from "solid-js";
import { createAllyList } from "./allies/ally-list.ts";
import { AlertSettingsPanel } from "./alert/AlertSettingsPanel.tsx";
import { createAlertSettings } from "./alert/alert-settings.ts";
import { AllyListSettings } from "./allies/AllyListSettings.tsx";
import { I18nProvider, useI18n } from "./i18n";
import { MapAndRoom } from "./map/MapAndRoom.tsx";
import type { PanelController, PanelDef } from "./panels/Workspace.tsx";
import { pageVisibility } from "./power/visibility.ts";
import { RawReadings } from "./readings/RawReadings.tsx";
import { SettingsPage, type SourceFactory } from "./settings/SettingsPage.tsx";
import { createSettings, type SettingsStorage } from "./settings/settings.ts";
import { LiveSource } from "./source/live-source.ts";
import { sharedSources } from "./source/shared-source.ts";

const liveSource: SourceFactory = (server, token) =>
  new LiveSource(server, { ...(token === undefined ? {} : { token }), visibility: pageVisibility() });

function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

interface ShellProps {
  readonly sourceFor: SourceFactory;
  readonly narrow?: Accessor<boolean>;
  readonly onController?: (controller: PanelController) => void;
}

function Shell(props: ShellProps) {
  const { locale, setLocale, t } = useI18n();
  const settings = createSettings(browserStorage());
  const allies = createAllyList(browserStorage());
  const alerts = createAlertSettings(browserStorage());
  // 全页共享数据源：每个 Server + token 组合只有一个 Source（一条 WebSocket），各面板与告警共用
  const sourceFor = sharedSources(props.sourceFor);

  createEffect(() => {
    document.title = t("app.title");
  });

  const toggleLocale = () => setLocale(locale() === "zh-CN" ? "en" : "zh-CN");

  const panels: PanelDef[] = [
    {
      id: "settings",
      title: "settings.title",
      size: { w: 12, h: 12 },
      render: () => (
        <>
          <SettingsPage settings={settings} sourceFor={sourceFor} />
          <AllyListSettings allies={allies} />
          <AlertSettingsPanel settings={alerts} />
        </>
      ),
    },
    // 开发用原始读数：生产构建不打包
    ...(import.meta.env.DEV
      ? [
          {
            id: "readings",
            title: "readings.title",
            size: { w: 12, h: 9 },
            render: () => <RawReadings settings={settings} sourceFor={sourceFor} />,
          } satisfies PanelDef,
        ]
      : []),
  ];

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
      <MapAndRoom
        settings={settings}
        sourceFor={sourceFor}
        allies={allies.set()}
        alerts={alerts}
        panels={panels}
        {...(props.narrow ? { narrow: props.narrow } : {})}
        {...(props.onController ? { onController: props.onController } : {})}
      />
    </main>
  );
}

/**
 * `sourceFor` 默认连真实 Server（经同源 Gateway）；测试里换成 FixtureSource。
 * `narrow` 默认跟随媒体查询（测试里强制 Monitor Mode）。
 */
export function App(props: Partial<ShellProps>) {
  return (
    <I18nProvider>
      <Shell
        sourceFor={props.sourceFor ?? liveSource}
        {...(props.narrow ? { narrow: props.narrow } : {})}
        {...(props.onController ? { onController: props.onController } : {})}
      />
    </I18nProvider>
  );
}
