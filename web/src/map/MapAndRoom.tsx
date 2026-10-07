/**
 * World Map 与 Room View 的固定布局（面板系统见 #2）：在地图上点房间进入它的 Room View，
 * Room View 里“返回地图”回到地图。进入 Room View 时只隐藏地图、不卸载，所以返回时视口不变。
 * PvP Overview（#3）放在最下面：点房间同样进入 Room View，热点画在地图上；
 * 地图与 PvP Overview 共用一个 OwnershipHub（同一份 map-stats 缓存与额度）。
 */
import { createMemo, createSignal, onCleanup } from "solid-js";
import type { VisibilitySignal } from "../power/visibility.ts";
import { createPvpFeed } from "../pvp/pvp-feed.ts";
import { pvpMapLayers } from "../pvp/pvp-map-layer.ts";
import { PvpOverview } from "../pvp/PvpOverview.tsx";
import { createOwnershipHub } from "./ownership-hub.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { RoomView, type RoomViewProps } from "../room/RoomView.tsx";
import { MapView, type MapTarget } from "./MapView.tsx";
import { openReplay } from "../replay/replay-controller.ts";

export interface MapAndRoomProps {
  readonly settings: Settings;
  readonly sourceFor: SourceFactory;
  /** 测试里换成假的 SceneView */
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
  /** 透传给 Room View 的其余选项（测试用） */
  readonly roomView?: Partial<RoomViewProps>;
  /** PvP 轮询用的页面可见性；默认 pageVisibility()（测试用） */
  readonly visibility?: VisibilitySignal;
}

export function MapAndRoom(props: MapAndRoomProps) {
  /** 从地图打开的房间；有值时地图隐藏 */
  const [opened, setOpened] = createSignal<MapTarget>();
  const scrollTo = (id: string) =>
    queueMicrotask(() => document.getElementById(id)?.scrollIntoView?.({ block: "start" }));

  // PvP 列表与所有权补查用的 Source（只用 HTTP，不建 WebSocket）
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
  const pvp = createPvpFeed({
    source,
    ownership,
    canLookup: () => !!props.settings.token(),
    ...(props.visibility ? { visibility: props.visibility } : {}),
  });
  /** 从 PvP Overview 进入房间：地图也切到那个 Shard，返回地图时能看到它 */
  const openFromPvp = (target: MapTarget) => {
    if (source().server.sharded && props.settings.shard() !== target.shard) props.settings.setShard(target.shard);
    setOpened({ ...target });
    scrollTo("room-view-title");
  };

  return (
    <>
      <div class="world-map__host" hidden={opened() !== undefined}>
        <MapView
          settings={props.settings}
          sourceFor={props.sourceFor}
          {...(props.createView ? { createView: props.createView } : {})}
          ownership={ownership()}
          overlays={(shard) => pvpMapLayers(pvp.groups()?.find((g) => g.shard === shard))}
          onOpenRoom={(target) => {
            setOpened({ ...target });
            scrollTo("room-view-title");
          }}
        />
      </div>
      <RoomView
        settings={props.settings}
        sourceFor={props.sourceFor}
        {...(props.createView ? { createView: props.createView } : {})}
        {...props.roomView}
        open={opened()}
        onBack={
          opened()
            ? () => {
                setOpened(undefined);
                scrollTo("world-map-title");
              }
            : undefined
        }
      />
      <PvpOverview
        feed={pvp}
        onOpenRoom={openFromPvp}
        onReplay={(target) => {
          openFromPvp(target);
          openReplay({ ...target, latest: true });
        }}
      />
    </>
  );
}
