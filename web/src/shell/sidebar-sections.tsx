/**
 * 区块表（#24）：Main View 模式 → Sidebar Section 列表，按显示顺序。
 *
 * 新增一个区块：写一个 SidebarSectionDef（id 全局唯一，用作折叠状态的存储键；title 是词典键；
 * render 只调用一次），加进对应模式的数组。区块需要的数据从 SectionContext 取；缺什么就在
 * SectionContext 里加一个字段，并在 MapAndRoom.tsx 构造 context 的地方给出。
 *
 * 两个模式的区块都常驻挂载：不属于当前模式、Sidebar 收起或区块折叠时只是隐藏，
 * `section.shown()` 为 false（想暂停渲染的区块据此停下）。
 */
import { Show, type Accessor, type JSX } from "solid-js";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n";
import type { MapLayerPrefs } from "../map/map-layer-toggles.ts";
import type { OwnershipHub } from "../map/ownership-hub.ts";
import type { WorldMapLink } from "../map/world-map-link.ts";
import { MapLayersSection, PointedRoomSection, RoomSearchSection } from "../map/WorldMapSections.tsx";
import { Minimap } from "../minimap/Minimap.tsx";
import type { VisibilitySignal } from "../power/visibility.ts";
import type { PvpFeed } from "../pvp/pvp-feed.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Theme } from "../scene/theme.ts";
import { PvpOverview } from "../pvp/PvpOverview.tsx";
import { sectionCombatants } from "../pvp/PvpCombatants.tsx";
import type { RoomDisplayOptions } from "../room/display-options.ts";
import type { RoomState } from "../room/room-state.ts";
import { DisplayOptionsSection, RoomInfoSection } from "../room/RoomSidebarSections.tsx";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import type { Source } from "../source/source.ts";
import type { RoomMapHub } from "../source/room-map-hub.ts";
import { replayAt, type MainViewMode, type ShellState } from "./shell-state.ts";

/** 区块可用的页面级数据与动作 */
export interface SectionContext {
  /** 外壳状态；跳转一律 shell.navigate(...) */
  readonly shell: ShellState;
  readonly settings: Settings;
  /** 全页共享的 Source 工厂（拿租约，不要自己 new） */
  readonly sourceFor: SourceFactory;
  /** 当前 Server + token 的共享 Source */
  readonly source: Accessor<Source>;
  readonly ownership: Accessor<OwnershipHub>;
  /** 全页共用的 roomMap2 订阅中心（总预算、去重、按优先级截断）；roomMap2 一律经它订阅 */
  readonly roomMaps: Accessor<RoomMapHub>;
  readonly pvp: PvpFeed;
  /** Room View 把选中对象的详情画进这个元素 */
  readonly setDetailsHost: (el: HTMLElement | undefined) => void;
  /** World Map 的居中与指向房间（#28） */
  readonly worldMap: WorldMapLink;
  /** World Map 的图层开关（#28） */
  readonly mapLayers: MapLayerPrefs;
  /** 页面可见性（#14） */
  readonly visibility: VisibilitySignal;
  /** 画 Scene 的区块用（#27 Minimap）：测试里换成假的 SceneView；不给时用 Pixi 适配层 */
  readonly createView: ((options: SceneViewOptions) => Promise<SceneView>) | undefined;
  /** Scene 调色板（#5）；undefined 时用 DEFAULT_THEME */
  readonly theme: Accessor<Theme | undefined>;
  /** Ally List（#17） */
  readonly allies: Accessor<ReadonlySet<string> | undefined>;
  /** Room View 此刻选中的对象 id（#26） */
  readonly selectedId: Accessor<string | undefined>;
  /** Room View 画面上的房间状态（#26） */
  readonly roomState: Accessor<RoomState | undefined>;
  /** Room View 的显示选项（#26） */
  readonly display: RoomDisplayOptions;
}

export interface SectionRender {
  /** 区块此刻是否在屏幕上（当前模式、Sidebar 打开、区块展开） */
  readonly shown: Accessor<boolean>;
}

export interface SidebarSectionDef {
  readonly id: string;
  readonly title: MessageKey;
  readonly render: (ctx: SectionContext, section: SectionRender) => JSX.Element;
}

function DetailsSection(props: { ctx: SectionContext }) {
  const { t } = useI18n();
  return (
    <div class="details-section">
      <Show when={props.ctx.selectedId() === undefined}>
        <p class="details-section__hint settings__muted">{t("shell.details.hint")}</p>
      </Show>
      <div class="details-section__mount" ref={(el) => props.ctx.setDetailsHost(el)} />
    </div>
  );
}

export const SIDEBAR_SECTIONS: Readonly<Record<MainViewMode, readonly SidebarSectionDef[]>> = {
  room: [
    {
      id: "room.info",
      title: "roomSidebar.info.title",
      render: (ctx, { shown }) => (
        <RoomInfoSection
          location={ctx.shell.location}
          roomState={ctx.roomState}
          ownership={ctx.ownership}
          shown={shown}
          canLookup={() => !!ctx.settings.token()}
        />
      ),
    },
    { id: "room.minimap", title: "minimap.title", render: (ctx, { shown }) => <Minimap ctx={ctx} shown={shown} /> },
    { id: "room.selected", title: "roomDetails.title", render: (ctx) => <DetailsSection ctx={ctx} /> },
    { id: "room.display", title: "roomSidebar.display.title", render: (ctx) => <DisplayOptionsSection options={ctx.display} /> },
  ],
  map: [
    { id: "map.search", title: "worldMapSidebar.search.title", render: (ctx) => <RoomSearchSection link={ctx.worldMap} /> },
    { id: "map.layers", title: "worldMapSidebar.layers.title", render: (ctx) => <MapLayersSection prefs={ctx.mapLayers} /> },
    { id: "map.pointed", title: "worldMapSidebar.pointed.title", render: (ctx) => <PointedRoomSection link={ctx.worldMap} /> },
    {
      id: "map.pvp",
      title: "pvp.title",
      render: (ctx, section) => (
        <PvpOverview
          feed={ctx.pvp}
          combatants={sectionCombatants(ctx, section.shown)}
          onOpenRoom={(target) => ctx.shell.navigate(target)}
          onReplay={({ tick, ...target }) => ctx.shell.navigate(replayAt(target, tick, true))}
        />
      ),
    },
  ],
};
