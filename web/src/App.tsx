import { createEffect, createSignal, Show, type Accessor } from "solid-js";
import { createAllyList } from "./allies/ally-list.ts";
import { AlertSettingsPanel } from "./alert/AlertSettingsPanel.tsx";
import { createAlertSettings } from "./alert/alert-settings.ts";
import { AllyListSettings } from "./allies/AllyListSettings.tsx";
import { ConsoleView } from "./console/ConsoleView.tsx";
import { createBootProgress, type CreateView } from "./boot/boot-progress.ts";
import { BootScreen } from "./boot/BootScreen.tsx";
import { AppearanceSettings } from "./customize/AppearanceSettings.tsx";
import { createColorScheme } from "./customize/color-scheme.ts";
import { createArtStyle } from "./art/art-style.ts";
import { attachShortcuts, createKeybindings, createShortcutCommands } from "./customize/keybindings.ts";
import type { ImportReport } from "./customize/settings-transfer.ts";
import { SettingsTransfer } from "./customize/SettingsTransfer.tsx";
import { ShortcutSettings } from "./customize/ShortcutSettings.tsx";
import { browserDarkQuery, createUiTheme } from "./customize/ui-theme.ts";
import { HistoryCacheSettings } from "./replay/HistoryCacheSettings.tsx";
import { createSceneView } from "./scene/pixi-scene-view.ts";
import { createReplaySettings, mbToBytes, sharedHistoryCache } from "./replay/replay-settings.ts";
import { I18nProvider, useI18n } from "./i18n";
import { MapAndRoom } from "./map/MapAndRoom.tsx";
import { pageVisibility } from "./power/visibility.ts";
import { RawReadings } from "./readings/RawReadings.tsx";
import { SettingsPage, type SourceFactory } from "./settings/SettingsPage.tsx";
import { createSettings } from "./settings/settings.ts";
import { mediaQuery, NARROW_QUERY } from "./shell/breakpoint.ts";
import { ConsolePanel } from "./shell/ConsolePanel.tsx";
import { Menu, type MenuItemDef } from "./shell/Menu.tsx";
import { RouteNotice } from "./shell/RouteNotice.tsx";
import { createShellState } from "./shell/shell-state.ts";
import { registerShellShortcuts } from "./shell/shell-shortcuts.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { TopBarStatus } from "./shell/TopBarStatus.tsx";
import { createUrlRouter, isReplayAddress } from "./shell/url-router.ts";
import { LiveSource } from "./source/live-source.ts";
import { sharedSources } from "./source/shared-source.ts";
import { staticCached } from "./source/static-cache.ts";
import { browserStorage } from "./storage/local-store.ts";

const liveSource: SourceFactory = (server, token) =>
  new LiveSource(server, { ...(token === undefined ? {} : { token }), visibility: pageVisibility() });

interface ShellProps {
  readonly sourceFor: SourceFactory;
  readonly narrow?: Accessor<boolean>;
  /** Top Bar 轮询 `game/time` 的间隔（测试用；默认 TICK_POLL_MS） */
  readonly tickPollMs?: number;
  /** 测试里换成假的 SceneView */
  readonly createView?: CreateView;
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
  const artStyle = createArtStyle(browserStorage());
  const keybindings = createKeybindings(browserStorage());
  const shortcuts = createShortcutCommands();
  attachShortcuts(document, keybindings, shortcuts);
  // 全页共享数据源：每个 Server + token 组合只有一个 Source（一条 WebSocket），各处与告警共用
  // 启动画面（#33）观察共享 Source 之下的真实事件；URL 指向 Replay 时认证不是必需的
  const boot = createBootProgress({ authOptional: () => replayRoute() });
  // Shard 列表与世界尺寸按 Server 缓存、在途去重（#35）：启动时不等这些请求
  const sourceFor = sharedSources(staticCached(boot.wrapSources(props.sourceFor), { storage: browserStorage() }));
  // 窄屏（#29）：Console Panel 不显示，Console 改从 Menu 打开；Sidebar 开合按布局各记一份
  const narrow = props.narrow ?? mediaQuery(NARROW_QUERY);
  const shell = createShellState(browserStorage(), settings, narrow);
  const replayRoute = () => shell.location().replay !== undefined || isReplayAddress(location.hash);
  registerShellShortcuts(shortcuts, shell, narrow);
  // URL 导航（#32）：地址 ↔ Main View 位置
  const router = createUrlRouter(shell, settings);
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
    { id: "appearance", title: "customize.appearance.title", render: () => <AppearanceSettings uiTheme={uiTheme} colors={colors} artStyle={artStyle} /> },
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
    render: () => <ConsoleView settings={settings} sourceFor={sourceFor} />,
  };

  return (
    <main class="shell" data-layout={narrow() ? "narrow" : "wide"}>
      <TopBar shell={shell} consoleToggle={!narrow()}>
        <TopBarStatus
          settings={settings}
          sourceFor={sourceFor}
          {...(props.tickPollMs === undefined ? {} : { tickPollMs: props.tickPollMs })}
        />
      </TopBar>
      <MapAndRoom
        settings={settings}
        sourceFor={sourceFor}
        shell={shell}
        allies={allies.set()}
        alerts={alerts}
        theme={colors.theme()}
        artStyle={artStyle.style()}
        roomView={{ shortcuts }}
        createView={boot.wrapView(props.createView ?? createSceneView)}
        narrow={narrow}
        bottom={
          <Show when={!narrow()}>
            <ConsolePanel shell={shell}>{() => <ConsoleView settings={settings} sourceFor={sourceFor} />}</ConsolePanel>
          </Show>
        }
      />
      <Menu shell={shell} items={narrow() ? [consoleItem, ...menuItems] : menuItems} />
      <BootScreen
        progress={boot}
        hasToken={!!settings.token()}
        anonymousRoute={replayRoute}
        openSettings={() => shell.openMenu("server")}
      />
      <RouteNotice router={router} />
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
            {...(props.tickPollMs === undefined ? {} : { tickPollMs: props.tickPollMs })}
            {...(props.createView ? { createView: props.createView } : {})}
            onImported={onImported}
            lastImport={lastImport()}
          />
        </I18nProvider>
      )}
    </Show>
  );
}
