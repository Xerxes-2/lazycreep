/**
 * World Map 信息层的数据接线（#17），供 MapView 调用：
 * - Ally List 写进 MapState（着色与高亮由 buildMapScene 的层负责）
 * - 放大到 ICON_MIN_ZOOM 以上时订阅可见房间的 roomMap2，把 Power Bank 写进 MapState
 * 矿物、RCL 与区域状态随 map-stats 由所有权加载器带回，这里不另发请求。
 */
import { createEffect, createMemo, onCleanup, type Accessor, type Setter } from "solid-js";
import type { Source } from "../source/source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import type { WorldRect } from "./map-scene.ts";
import { applyPowerBanks, parseRoomName, withAllies, worldOffset, type MapState } from "./map-state.ts";
import { createRoomMapFeed, roomsByDistance } from "./room-map-feed.ts";

export interface MapInfoOptions {
  readonly source: Accessor<Source>;
  readonly mapState: Accessor<MapState | undefined>;
  readonly setMapState: Setter<MapState | undefined>;
  readonly allies: Accessor<ReadonlySet<string> | undefined>;
  /** 当前可见区域与缩放（每房间 CSS 像素） */
  readonly focus: Accessor<{ readonly rect: WorldRect; readonly zoom: number } | undefined>;
  /** 有 token、页面可见、地图在前台时为 true */
  readonly enabled: Accessor<boolean>;
}

export function useMapInfo(options: MapInfoOptions): void {
  const { mapState, setMapState } = options;

  createEffect(() => {
    const state = mapState();
    const allies = options.allies();
    if (state && allies && state.allies !== allies) setMapState(withAllies(state, allies));
  });

  const feed = createMemo(() => {
    const src = options.source();
    const created = createRoomMapFeed({
      subscribe: (shard, room, listener) => src.subscribeRoomMap(shard, room, listener),
      onPowerBanks: (room, positions) => setMapState((state) => state && applyPowerBanks(state, room, positions)),
    });
    onCleanup(() => created.dispose());
    return created;
  });

  /** 只随 Shard 与世界尺寸变化，Power Bank 更新不触发重算订阅 */
  const world = createMemo(
    () => {
      const state = mapState();
      return state && { shard: state.shard, size: state.size };
    },
    undefined,
    { equals: (a, b) => a === b || (!!a && !!b && a.shard === b.shard && a.size === b.size) },
  );

  createEffect(() => {
    const current = feed();
    const w = world();
    const focus = options.focus();
    const wanted = w && focus && options.enabled() && focus.zoom >= ICON_MIN_ZOOM;
    current.show(w?.shard ?? "", wanted ? roomsByDistance(w.size, focus.rect) : []);
  });
}

/** 搜索框里的房间名 → 房间中心的世界坐标；不是房间名或在世界之外时 undefined。 */
export function findRoom(state: Pick<MapState, "size">, text: string): { x: number; y: number } | undefined {
  const coord = parseRoomName(text.trim().toUpperCase());
  if (!coord) return undefined;
  const offset = worldOffset(state.size);
  const x = coord.x + offset.x;
  const y = coord.y + offset.y;
  if (x < 0 || y < 0 || x >= state.size.width || y >= state.size.height) return undefined;
  return { x: x + 0.5, y: y + 0.5 };
}
