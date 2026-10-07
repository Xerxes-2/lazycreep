/**
 * 外壳的主体（#24，ADR 0005）：Main View（World Map 与 Room View 二选一）、其下的 Console Panel 槽位、
 * 右侧的 Sidebar；Attack Alert 不属于 Main View。
 *
 * World Map 与 Room View 常驻挂载：非当前的一个只隐藏并暂停渲染，切换时视口、房间与订阅都保留。
 * 跨视图跳转都经外壳状态的唯一入口 shell.navigate（shell-state.ts）：
 * - 地图点房间、PvP Overview 点房间、告警 → navigate({ shard, room })（别的 Shard 上的房间同时切 Shard）；
 * - Room View 的“返回地图” → navigate({ view: "map" })；
 * - “回看” → navigate({ shard, room, replay })；`#/replay?…` 路由由外壳状态监听，切到 Room View。
 * 地图、PvP Overview 与告警共用一个 OwnershipHub（同一份 map-stats 缓存与额度）与一个 PvP feed。
 */
import { createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { pageVisibility, type VisibilitySignal } from "../power/visibility.ts";
import { AttackAlert } from "../alert/AttackAlert.tsx";
import type { AlertSettings } from "../alert/alert-settings.ts";
import { visibleOrKept } from "../alert/keep-awake.ts";
import { mediaQuery, NARROW_QUERY } from "../shell/breakpoint.ts";
import { createSheetTabs, revealSelection } from "../shell/bottom-sheet.tsx";
import { createShellState, type ShellState } from "../shell/shell-state.ts";
import { Sidebar } from "../shell/Sidebar.tsx";
import type { SectionContext } from "../shell/sidebar-sections.tsx";
import { shownVisibility } from "../shell/view-visibility.ts";
import { createPvpFeed } from "../pvp/pvp-feed.ts";
import { createMapLayerPrefs, mapLayers } from "./map-layer-toggles.ts";
import { createOwnershipHub } from "./ownership-hub.ts";
import { createWorldMapLink } from "./world-map-link.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Theme } from "../scene/theme.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { browserStorage } from "../storage/local-store.ts";
import { RoomView, type RoomViewProps } from "../room/RoomView.tsx";
import { MapView } from "./MapView.tsx";

export interface MapAndRoomProps {
  readonly settings: Settings;
  /** 应是全页共享的 Source（见 source/shared-source.ts） */
  readonly sourceFor: SourceFactory;
  /** 外壳状态；默认按浏览器 localStorage 新建一份（测试用） */
  readonly shell?: ShellState;
  /** 测试里换成假的 SceneView */
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
  /** Ally List（#17）：同时驱动地图与 Room View 的着色 */
  readonly allies?: ReadonlySet<string>;
  /** 透传给 Room View 的其余选项（测试用） */
  readonly roomView?: Partial<RoomViewProps>;
  /** 页面可见性；默认 pageVisibility()（测试用） */
  readonly visibility?: VisibilitySignal;
  /** Attack Alert（#4）的设置；不给时不告警 */
  readonly alerts?: AlertSettings;
  /** 是否窄屏；默认跟随 NARROW_QUERY 媒体查询 */
  readonly narrow?: Accessor<boolean>;
  /** Scene 调色板与着色规则（#5），同时作用于地图与 Room View；默认 DEFAULT_THEME */
  readonly theme?: Theme | undefined;
  /** Main View 底部的 Console Panel */
  readonly bottom?: JSX.Element;
}

export function MapAndRoom(props: MapAndRoomProps) {
  const page = props.visibility ?? pageVisibility();
  const shell = props.shell ?? createShellState(browserStorage(), props.settings);
  const narrow = props.narrow ?? mediaQuery(NARROW_QUERY);

  // PvP 列表与所有权补查用的 Source（全页共享的同一个）
  const source = createMemo(() => {
    const created = props.sourceFor(props.settings.server(), props.settings.token() || undefined);
    onCleanup(() => created.close());
    return created;
  });
  const ownership = createMemo(() => {
    const src = source();
    const hub = createOwnershipHub({ fetch: (shard, rooms) => src.getMapStats(shard, rooms) });
    onCleanup(() => hub.dispose());
    return hub;
  });
  // Attack Alert 需要 PvP / 核弹时，页面隐藏也继续轮询（#4 对 #14 规则的调整）
  const alertsNeedFeed = () => {
    const config = props.alerts?.config();
    return !!props.settings.token() && !!config && (config.pvp || config.nuke);
  };
  const pvp = createPvpFeed({
    source,
    ownership,
    canLookup: () => !!props.settings.token(),
    visibility: visibleOrKept(page, alertsNeedFeed),
  });

  const [detailsHost, setDetailsHost] = createSignal<HTMLElement>();
  // 窄屏底部面板的当前标签（#29）
  const tabs = createSheetTabs();
  const worldMap = createWorldMapLink();
  const layerPrefs = createMapLayerPrefs(browserStorage());
  const sectionContext: SectionContext = {
    shell,
    settings: props.settings,
    sourceFor: props.sourceFor,
    source,
    ownership,
    pvp,
    setDetailsHost,
    worldMap,
    mapLayers: layerPrefs,
  };

  const mapShown = () => shell.mainView() === "map";
  const roomShown = () => shell.mainView() === "room";

  return (
    <div class="shell__body" data-layout={narrow() ? "narrow" : "wide"}>
      <Show when={props.alerts}>
        {(alerts) => (
          <AttackAlert
            source={source}
            feed={pvp}
            enabled={() => !!props.settings.token()}
            allies={() => props.allies ?? new Set()}
            settings={alerts()}
            onOpen={(target) => shell.navigate(target)}
          />
        )}
      </Show>
      <div class="shell__main">
        <div class="main-view" data-main-view={shell.mainView()}>
          <div class="main-view__slot" data-view="map" hidden={!mapShown()}>
            <MapView
              settings={props.settings}
              sourceFor={props.sourceFor}
              {...(props.createView ? { createView: props.createView } : {})}
              visibility={shownVisibility(page, mapShown)}
              ownership={ownership()}
              layers={(shard) => mapLayers(layerPrefs.enabled(), pvp.groups()?.find((g) => g.shard === shard))}
              link={worldMap}
              {...(props.allies ? { allies: props.allies } : {})}
              active={mapShown()}
              theme={props.theme}
              onOpenRoom={(target) => shell.navigate(target)}
            />
          </div>
          <div class="main-view__slot" data-view="room" hidden={!roomShown()}>
            <RoomView
              settings={props.settings}
              sourceFor={props.sourceFor}
              {...(props.createView ? { createView: props.createView } : {})}
              {...(props.allies ? { allies: props.allies } : {})}
              visibility={shownVisibility(page, roomShown)}
              theme={props.theme}
              {...props.roomView}
              open={shell.roomRequest()}
              onTarget={shell.reportRoom}
              detailsMount={shell.sidebarOpen() && (narrow() || !shell.sectionCollapsed("room.selected")) ? detailsHost() : undefined}
              onSelect={revealSelection(shell, tabs, narrow)}
              onBack={() => shell.navigate({ view: "map" })}
            />
          </div>
        </div>
        {props.bottom}
      </div>
      <Sidebar ctx={sectionContext} narrow={narrow} tabs={tabs} />
    </div>
  );
}
