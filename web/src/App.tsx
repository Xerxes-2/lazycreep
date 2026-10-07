import { createEffect, createSignal, Show, type Accessor } from "solid-js";
import { createAllyList } from "./allies/ally-list.ts";
import { AlertSettingsPanel } from "./alert/AlertSettingsPanel.tsx";
import { createAlertSettings } from "./alert/alert-settings.ts";
import { AllyListSettings } from "./allies/AllyListSettings.tsx";
import { ConsolePanel } from "./console/ConsolePanel.tsx";
import { AppearanceSettings } from "./customize/AppearanceSettings.tsx";
import { createColorScheme } from "./customize/color-scheme.ts";
import { attachShortcuts, createKeybindings, createShortcutCommands } from "./customize/keybindings.ts";
import type { ImportReport } from "./customize/settings-transfer.ts";
import { SettingsTransfer } from "./customize/SettingsTransfer.tsx";
import { ShortcutSettings } from "./customize/ShortcutSettings.tsx";
import { browserDarkQuery, createUiTheme } from "./customize/ui-theme.ts";
import { HistoryCacheSettings } from "./replay/HistoryCacheSettings.tsx";
import { createReplaySettings, mbToBytes, sharedHistoryCache } from "./replay/replay-settings.ts";
import { I18nProvider, useI18n } from "./i18n";
import { MapAndRoom } from "./map/MapAndRoom.tsx";
import { pageVisibility } from "./power/visibility.ts";
import { RawReadings } from "./readings/RawReadings.tsx";
import { SettingsPage, type SourceFactory } from "./settings/SettingsPage.tsx";
import { createSettings } from "./settings/settings.ts";
import { mediaQuery, NARROW_QUERY } from "./shell/breakpoint.ts";
import { ConsoleDock } from "./shell/ConsoleDock.tsx";
import { Menu, type MenuItemDef } from "./shell/Menu.tsx";
import { createShellState } from "./shell/shell-state.ts";
import { registerShellShortcuts } from "./shell/shell-shortcuts.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { LiveSource } from "./source/live-source.ts";
import { sharedSources } from "./source/shared-source.ts";
import { browserStorage } from "./storage/local-store.ts";

const liveSource: SourceFactory = (server, token) =>
  new LiveSource(server, { ...(token === undefined ? {} : { token }), visibility: pageVisibility() });

interface ShellProps {
  readonly sourceFor: SourceFactory;
  readonly narrow?: Accessor<boolean>;
}

interface ShellOwnProps extends ShellProps {
  /** 导入设置后由 App 重建整个界面 */
  readonly onImported: (report: ImportReport) => void;
  readonly lastImport: ImportReport | undefined;
}

/**
 * 固定外壳（#24，ADR 0005）：Top Bar、Main View + Sidebar（MapAndRoom）、Console Panel、Menu。
 * 页面本身不滚动，只有 Menu、Sidebar 区块与 Console Panel 在内部滚动。
 */
function Shell(props: ShellOwnProps) {
  const { t } = useI18n();
  const settings = createSettings(browserStorage());
  const allies = createAllyList(browserStorage());
  const alerts = createAlertSettings(browserStorage());
  // 外观与快捷键（#5）
  const uiTheme = createUiTheme({ storage: browserStorage(), darkQuery: browserDarkQuery() });
  const colors = createColorScheme(browserStorage());
  const keybindings = createKeybindings(browserStorage());
  const shortcuts = createShortcutCommands();
  attachShortcuts(document, keybindings, shortcuts);
  // 全页共享数据源：每个 Server + token 组合只有一个 Source（一条 WebSocket），各处与告警共用
  const sourceFor = sharedSources(props.sourceFor);
  const shell = createShellState(browserStorage(), settings);
  // 窄屏（#29）：Console Panel 不显示，Console 改从 Menu 打开
  const narrow = props.narrow ?? mediaQuery(NARROW_QUERY);
  registerShellShortcuts(shortcuts, shell);
  // 导入设置后界面重建：回到导入那一项，显示导入结果
  if (props.lastImport) shell.openMenu("transfer");

  createEffect(() => {
    document.title = t("app.title");
  });

  /** Menu 项，按显示顺序；新增设置项加在这里 */
  const menuItems: MenuItemDef[] = [
    { id: "server", title: "shell.menu.server", render: () => <SettingsPage settings={settings} sourceFor={sourceFor} /> },
    { id: "allies", title: "mapInfo.allies.title", render: () => <AllyListSettings allies={allies} /> },
    { id: "alerts", title: "alert.settings.title", render: () => <AlertSettingsPanel settings={alerts} /> },
    {
      id: "history",
      title: "replay.cache.title",
      render: () => (
        <section class="settings">
          <HistoryCacheSettings />
        </section>
      ),
    },
    { id: "appearance", title: "customize.appearance.title", render: () => <AppearanceSettings uiTheme={uiTheme} colors={colors} /> },
    { id: "shortcuts", title: "shortcuts.title", render: () => <ShortcutSettings bindings={keybindings} /> },
    {
      id: "transfer",
      title: "transfer.title",
      render: () => (
        <SettingsTransfer storage={browserStorage()} onImported={props.onImported} lastImport={props.lastImport} />
      ),
    },
    // 开发用原始读数：生产构建不打包
    ...(import.meta.env.DEV
      ? [
          {
            id: "readings",
            title: "readings.title",
            render: () => <RawReadings settings={settings} sourceFor={sourceFor} />,
          } satisfies MenuItemDef,
        ]
      : []),
  ];

  const consoleItem: MenuItemDef = {
    id: "console",
    title: "console.title",
    render: () => <ConsolePanel settings={settings} sourceFor={sourceFor} />,
  };

  return (
    <main class="shell" data-layout={narrow() ? "narrow" : "wide"}>
      <TopBar shell={shell} consoleToggle={!narrow()} />
      <MapAndRoom
        settings={settings}
        sourceFor={sourceFor}
        shell={shell}
        allies={allies.set()}
        alerts={alerts}
        theme={colors.theme()}
        roomView={{ shortcuts }}
        narrow={narrow}
        bottom={
          <Show when={!narrow()}>
            <ConsoleDock shell={shell}>{() => <ConsolePanel settings={settings} sourceFor={sourceFor} />}</ConsoleDock>
          </Show>
        }
      />
      <Menu shell={shell} items={narrow() ? [consoleItem, ...menuItems] : menuItems} />
    </main>
  );
}

/**
 * `sourceFor` 默认连真实 Server（经同源 Gateway）；测试里换成 FixtureSource。
 * `narrow` 默认跟随媒体查询（测试里强制窄屏结构）。
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
            onImported={onImported}
            lastImport={lastImport()}
          />
        </I18nProvider>
      )}
    </Show>
  );
}
