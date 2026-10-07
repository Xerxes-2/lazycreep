/**
 * 页面主体（#2）：World Map、Room View（含 Replay）、PvP Overview、对象详情这几个核心面板，
 * 加上调用方给的其余面板（设置、开发用原始读数），放进面板系统；Attack Alert 不属于任何面板。
 *
 * 跨视图跳转都表现为切换到 / 聚焦对应面板：
 * - 地图点房间进入 Room View；“返回地图”聚焦地图面板，地图一直挂载，视口不变；
 * - PvP Overview 点房间进入 Room View，“回看”进入 Replay（`#/replay?…` 路由，路由变化时也聚焦 Room View）；
 *   别的 Shard 上的房间同时把地图切到那个 Shard；
 * - Attack Alert 的通知与横幅点击进入该房间的 Room View。
 * 地图、PvP Overview 与告警共用一个 OwnershipHub（同一份 map-stats 缓存与额度）与一个 PvP feed。
 */
import { createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { pageVisibility, type VisibilitySignal } from "../power/visibility.ts";
import { AttackAlert } from "../alert/AttackAlert.tsx";
import type { AlertSettings } from "../alert/alert-settings.ts";
import { visibleOrKept } from "../alert/keep-awake.ts";
import { useI18n } from "../i18n";
import { mediaQuery, NARROW_QUERY } from "../panels/breakpoint.ts";
import { createLayoutStore } from "../panels/layout-store.ts";
import { panelVisibility } from "../panels/panel-visibility.ts";
import { createPanelController, Workspace, type PanelController, type PanelDef } from "../panels/Workspace.tsx";
import { createPvpFeed } from "../pvp/pvp-feed.ts";
import { pvpMapLayers } from "../pvp/pvp-map-layer.ts";
import { PvpOverview } from "../pvp/PvpOverview.tsx";
import { createOwnershipHub } from "./ownership-hub.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Theme } from "../scene/theme.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { browserStorage, type KeyValueStorage } from "../storage/local-store.ts";
import { RoomView, type RoomViewProps } from "../room/RoomView.tsx";
import { MapView, type MapTarget } from "./MapView.tsx";
import { openReplay, parseReplayHref } from "../replay/replay-controller.ts";

export interface MapAndRoomProps {
  readonly settings: Settings;
  /** 应是全页共享的 Source（见 source/shared-source.ts） */
  readonly sourceFor: SourceFactory;
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
  /** 核心面板之外的面板（设置等），排在核心面板之后 */
  readonly panels?: readonly PanelDef[];
  /** 布局的存储；默认浏览器 localStorage */
  readonly layoutStorage?: KeyValueStorage;
  /** 是否窄屏（Monitor Mode）；默认跟随 NARROW_QUERY 媒体查询 */
  readonly narrow?: Accessor<boolean>;
  /** 拿到面板控制器（例如外部快捷键切换面板） */
  readonly onController?: (controller: PanelController) => void;
  /** Scene 调色板与着色规则（#5），同时作用于地图与 Room View；默认 DEFAULT_THEME */
  readonly theme?: Theme | undefined;
}

export function MapAndRoom(props: MapAndRoomProps) {
  const { t } = useI18n();
  const page = props.visibility ?? pageVisibility();
  /** 进入 Room View 的房间（地图、PvP、告警）；每次给新对象 Room View 就切过去 */
  const [opened, setOpened] = createSignal<MapTarget>();

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

  const core: PanelDef[] = [
    {
      id: "map",
      title: "worldMap.title",
      size: { w: 7, h: 14 },
      render: (panel) => (
        <MapView
          settings={props.settings}
          sourceFor={props.sourceFor}
          {...(props.createView ? { createView: props.createView } : {})}
          visibility={panelVisibility(page, panel.shown)}
          ownership={ownership()}
          overlays={(shard) => pvpMapLayers(pvp.groups()?.find((g) => g.shard === shard))}
          {...(props.allies ? { allies: props.allies } : {})}
          active={panel.shown()}
          theme={props.theme}
          onOpenRoom={(target) => openRoom(target)}
        />
      ),
    },
    {
      id: "room",
      title: "roomView.title",
      size: { w: 5, h: 14 },
      render: (panel) => (
        <RoomView
          settings={props.settings}
          sourceFor={props.sourceFor}
          {...(props.createView ? { createView: props.createView } : {})}
          {...(props.allies ? { allies: props.allies } : {})}
          visibility={panelVisibility(page, panel.shown)}
          theme={props.theme}
          {...props.roomView}
          open={opened()}
          detailsMount={controller.shown("details") ? detailsHost() : undefined}
          onBack={opened() ? () => controller.focus("map") : undefined}
        />
      ),
    },
    {
      id: "pvp",
      title: "pvp.title",
      size: { w: 7, h: 9 },
      render: () => (
        <PvpOverview
          feed={pvp}
          onOpenRoom={openFromPvp}
          onReplay={(target) => {
            openFromPvp(target);
            openReplay({ ...target, latest: true });
          }}
        />
      ),
    },
    {
      id: "details",
      title: "roomDetails.title",
      size: { w: 5, h: 9 },
      render: () => (
        <div class="details-panel">
          <p class="details-panel__hint settings__muted">{t("panels.details.hint")}</p>
          <div class="details-panel__mount" ref={setDetailsHost} />
        </div>
      ),
    },
  ];
  const panels = [...core, ...(props.panels ?? [])];

  const store = createLayoutStore(
    props.layoutStorage ?? browserStorage(),
    { ids: panels.map((p) => p.id), size: (id) => panels.find((p) => p.id === id)?.size ?? { w: 6, h: 8 } },
    {
      desktop: panels.map((p) => p.id).filter((id) => id !== "console"),
      monitor: panels.map((p) => p.id).filter((id) => id !== "details" && id !== "readings" && id !== "console"),
    },
  );
  const controller = createPanelController(store, props.narrow ?? mediaQuery(NARROW_QUERY));
  props.onController?.(controller);

  const openRoom = (target: MapTarget) => {
    setOpened({ ...target });
    controller.focus("room");
  };
  /** 从 PvP Overview / 告警进入房间：地图也切到那个 Shard，返回地图时能看到它 */
  const openFromPvp = (target: MapTarget) => {
    if (source().server.sharded && props.settings.shard() !== target.shard) props.settings.setShard(target.shard);
    openRoom(target);
  };

  // `#/replay?…` 路由（PvP 的“回看”、粘贴的链接）：切到 Room View，由它进入 Replay
  const onRoute = () => {
    if (parseReplayHref(location.hash)) controller.focus("room");
  };
  onRoute();
  window.addEventListener("hashchange", onRoute);
  onCleanup(() => window.removeEventListener("hashchange", onRoute));

  return (
    <>
      <Show when={props.alerts}>
        {(alerts) => (
          <AttackAlert
            source={source}
            feed={pvp}
            enabled={() => !!props.settings.token()}
            allies={() => props.allies ?? new Set()}
            settings={alerts()}
            onOpen={openFromPvp}
          />
        )}
      </Show>
      <Workspace panels={panels} controller={controller} />
    </>
  );
}
