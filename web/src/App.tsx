import { createEffect, createSignal, Show, type Accessor } from "solid-js";
import { createAllyList } from "./allies/ally-list.ts";
import { AlertSettingsPanel } from "./alert/AlertSettingsPanel.tsx";
import { createAlertSettings } from "./alert/alert-settings.ts";
import { AllyListSettings } from "./allies/AllyListSettings.tsx";
import { ConsolePanel } from "./console/ConsolePanel.tsx";
import { AppearanceSettings } from "./customize/AppearanceSettings.tsx";
import { createColorScheme } from "./customize/color-scheme.ts";
import { attachShortcuts, createKeybindings, createShortcutCommands } from "./customize/keybindings.ts";
import { registerPanelShortcuts } from "./customize/panel-shortcuts.ts";
import type { ImportReport } from "./customize/settings-transfer.ts";
import { SettingsTransfer } from "./customize/SettingsTransfer.tsx";
import { ShortcutSettings } from "./customize/ShortcutSettings.tsx";
import { browserDarkQuery, createUiTheme } from "./customize/ui-theme.ts";
import { createReplaySettings, mbToBytes, sharedHistoryCache } from "./replay/replay-settings.ts";
import { I18nProvider, useI18n } from "./i18n";
import { MapAndRoom } from "./map/MapAndRoom.tsx";
import type { PanelController, PanelDef } from "./panels/Workspace.tsx";
import { pageVisibility } from "./power/visibility.ts";
import { RawReadings } from "./readings/RawReadings.tsx";
import { SettingsPage, type SourceFactory } from "./settings/SettingsPage.tsx";
import { createSettings } from "./settings/settings.ts";
import { LiveSource } from "./source/live-source.ts";
import { sharedSources } from "./source/shared-source.ts";
import { browserStorage } from "./storage/local-store.ts";

/** MapAndRoom 自带的核心面板（快捷键可切换到的面板） */
const CORE_PANELS = ["map", "room", "pvp", "details"];

const liveSource: SourceFactory = (server, token) =>
  new LiveSource(server, { ...(token === undefined ? {} : { token }), visibility: pageVisibility() });

interface ShellProps {
  readonly sourceFor: SourceFactory;
  readonly narrow?: Accessor<boolean>;
  readonly onController?: (controller: PanelController) => void;
}

interface ShellOwnProps extends ShellProps {
  /** 导入设置后由 App 重建整个界面 */
  readonly onImported: (report: ImportReport) => void;
  readonly lastImport: ImportReport | undefined;
}

function Shell(props: ShellOwnProps) {
  const { locale, setLocale, t } = useI18n();
  const settings = createSettings(browserStorage());
  const allies = createAllyList(browserStorage());
  const alerts = createAlertSettings(browserStorage());
  // 外观与快捷键（#5）
  const uiTheme = createUiTheme({ storage: browserStorage(), darkQuery: browserDarkQuery() });
  const colors = createColorScheme(browserStorage());
  const keybindings = createKeybindings(browserStorage());
  const shortcuts = createShortcutCommands();
  attachShortcuts(document, keybindings, shortcuts);
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
          <AppearanceSettings uiTheme={uiTheme} colors={colors} />
          <ShortcutSettings bindings={keybindings} />
          <SettingsTransfer storage={browserStorage()} onImported={props.onImported} lastImport={props.lastImport} />
        </>
      ),
    },
    // Console（#6）：默认不打开，从工具栏 / 标签管理里加入
    {
      id: "console",
      title: "console.title",
      size: { w: 7, h: 10 },
      render: () => <ConsolePanel settings={settings} sourceFor={sourceFor} />,
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
        theme={colors.theme()}
        roomView={{ shortcuts }}
        {...(props.narrow ? { narrow: props.narrow } : {})}
        onController={(controller) => {
          registerPanelShortcuts(shortcuts, controller, [...CORE_PANELS, ...panels.map((p) => p.id)]);
          props.onController?.(controller);
        }}
      />
    </main>
  );
}

/**
 * `sourceFor` 默认连真实 Server（经同源 Gateway）；测试里换成 FixtureSource。
 * `narrow` 默认跟随媒体查询（测试里强制 Monitor Mode）。
 */
export function App(props: Partial<ShellProps>) {
  // 导入设置（#5）后整个界面按新存储重建：各功能都在创建时读存储，重建即生效，无需刷新页面
  const [generation, setGeneration] = createSignal(1);
  const [lastImport, setLastImport] = createSignal<ImportReport>();
  const onImported = (report: ImportReport) => {
    // 已打开的历史缓存按新上限淘汰
    const limit = createReplaySettings(browserStorage()).cacheLimitMb();
    void sharedHistoryCache()
      .then((cache) => cache?.setLimit(mbToBytes(limit)))
      .catch(() => {});
    setLastImport(report);
    setGeneration((n) => n + 1);
  };
  return (
    <Show when={generation()} keyed>
      {(_generation) => (
        <I18nProvider>
          <Shell
            sourceFor={props.sourceFor ?? liveSource}
            {...(props.narrow ? { narrow: props.narrow } : {})}
            {...(props.onController ? { onController: props.onController } : {})}
            onImported={onImported}
            lastImport={lastImport()}
          />
        </I18nProvider>
      )}
    </Show>
  );
}
