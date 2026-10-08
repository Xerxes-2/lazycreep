/**
 * 外壳的主体（#24，ADR 0005）：Main View（World Map 与 Room View 二选一）、其下的 Console Panel 槽位、
 * 右侧的 Sidebar；Attack Alert 不属于 Main View。
 *
 * World Map 与 Room View 常驻挂载：非当前的一个只隐藏并暂停渲染，切换时视口、房间与订阅都保留。
 * 跨视图跳转都经外壳状态的唯一入口 shell.navigate（shell-state.ts）：
 * - 地图点房间、PvP Overview 点房间、告警 → navigate({ shard, room })（别的 Shard 上的房间同时切 Shard）；
 * - Room View 的“返回地图” → navigate({ view: "map" })；
 * - “回看” → navigate({ shard, room, replay })；地址（URL 路由，shell/url-router.ts）也经 navigate 导航。
 * 地图、PvP Overview 与告警共用一个 OwnershipHub（同一份 map-stats 缓存与额度）与一个 PvP feed；
 * 所有 roomMap2（告警、Minimap、PvP 参战者、地图）经同一个订阅中心（source/room-map-hub.ts），总数受预算约束。
 */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack, type Accessor, type JSX } from "solid-js";
import { pageVisibility, type VisibilitySignal } from "../power/visibility.ts";
import { AttackAlert } from "../alert/AttackAlert.tsx";
import type { AlertSettings } from "../alert/alert-settings.ts";
import { visibleOrKept } from "../alert/keep-awake.ts";
import { mediaQuery, NARROW_QUERY } from "../shell/breakpoint.ts";
import { createSheetTabs, revealSelection } from "../shell/bottom-sheet.tsx";
import { createShellState, replayAt, type ShellState } from "../shell/shell-state.ts";
import { Sidebar } from "../shell/Sidebar.tsx";
import type { SectionContext } from "../shell/sidebar-sections.tsx";
import { shownVisibility } from "../shell/view-visibility.ts";
import { createPvpFeed } from "../pvp/pvp-feed.ts";
import { pageCombatants } from "../pvp/PvpCombatants.tsx";
import { createMapLayerPrefs, mapLayers } from "./map-layer-toggles.ts";
import { badgeLayer } from "./map-badge-layer.ts";
import { createMapBadges } from "./map-badges.ts";
import { ownershipBudgetStore } from "./ownership-budget.ts";
import { createOwnershipHub } from "./ownership-hub.ts";
import { roomMapHubFor } from "../source/room-map-hub.ts";
import { createWorldMapLink } from "./world-map-link.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Theme } from "../scene/theme.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { browserStorage } from "../storage/local-store.ts";
import { RoomView, type RoomViewProps } from "../room/RoomView.tsx";
import { createRoomDisplayOptions } from "../room/display-options.ts";
import type { RoomState } from "../room/room-state.ts";
import { MapView } from "./MapView.tsx";
import { useSharedSource } from "../source/use-shared-source.ts";

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
  const narrow = props.narrow ?? mediaQuery(NARROW_QUERY);
  const shell = props.shell ?? createShellState(browserStorage(), props.settings, narrow);

  // PvP 列表与所有权补查用的 Source（全页共享的同一个）
  const source = useSharedSource(props.sourceFor, props.settings);
  const ownership = createMemo(() => {
    const src = source();
    const hub = createOwnershipHub({
      fetch: (shard, rooms) => src.getMapStats(shard, rooms),
      budget: ownershipBudgetStore(browserStorage(), src.server.id),
    });
    onCleanup(() => hub.dispose());
    return hub;
  });
  const roomMaps = roomMapHubFor(source);
  // World Map 徽章图层（#43）
  const badges = badgeLayer(createMapBadges({ source }));
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
  // 从 Room View 回到地图（返回按钮、M 键、Top Bar、URL 都走 navigate）：以刚才的房间为中心。
  // 不用 defer：Solid 的 on 在 defer 跳过的第一次执行里不记录上一个值，页面直接在 Room View 打开时，
  // 第一次回到地图拿到的 previous 会是 undefined 而不是 "room"。第一次执行时 previous 本来就是 undefined，条件自然不成立。
  createEffect(
    on(
      () => shell.mainView(),
      (view, previous) => {
        if (view !== "map" || previous !== "room") return;
        const room = untrack(() => shell.location().room);
        if (room) worldMap.setFocusRoom(room);
      },
    ),
  );
  const layerPrefs = createMapLayerPrefs(browserStorage());
  // Room View 的区块（#26）：选中对象、房间状态、显示选项
  const [selectedId, setSelectedId] = createSignal<string>();
  const [roomState, setRoomState] = createSignal<RoomState>();
  const display = createRoomDisplayOptions(browserStorage());
  const mapShown = () => shell.mainView() === "map";
  const roomShown = () => shell.mainView() === "room";
  // PvP 房间的参战者：全页一份，World Map 可见时订阅（PvP / PvE 两个区块与地图图例共用）
  const combatants = pageCombatants({ source, roomMaps, pvp, settings: props.settings, allies: () => props.allies }, mapShown);

  const sectionContext: SectionContext = {
    shell,
    settings: props.settings,
    sourceFor: props.sourceFor,
    source,
    ownership,
    roomMaps,
    pvp,
    combatants,
    setDetailsHost,
    worldMap,
    mapLayers: layerPrefs,
    visibility: page,
    createView: props.createView,
    theme: () => props.theme,
    allies: () => props.allies,
    selectedId,
    roomState,
    display,
  };

  return (
    <div class="shell__body" data-layout={narrow() ? "narrow" : "wide"}>
      <Show when={props.alerts}>
        {(alerts) => (
          <AttackAlert
            source={source}
            roomMaps={roomMaps}
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
              roomMaps={roomMaps()}
              layers={(shard) => {
                const group = pvp.groups()?.find((g) => g.shard === shard);
                // 在这里读分类：参战者帧到了地图跟着重画
                const pve = new Set(group?.rooms.filter((r) => combatants.pve(shard, r.room)).map((r) => r.room));
                return mapLayers(layerPrefs.enabled(), group, badges, pve);
              }}
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
              onSelect={(id) => {
                setSelectedId(id);
                if (id !== undefined) shell.setSectionCollapsed("room.selected", false);
                revealSelection(shell, tabs, narrow)(id);
              }}
              onBack={() => shell.navigate({ view: "map" })}
              display={display.display()}
              onShownState={setRoomState}
              onEnterReplay={(target, tick) => shell.navigate(replayAt(target, tick, true))}
            />
          </div>
        </div>
        {props.bottom}
      </div>
      <Sidebar ctx={sectionContext} narrow={narrow} tabs={tabs} />
    </div>
  );
}
