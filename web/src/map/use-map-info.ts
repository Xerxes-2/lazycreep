/**
 * World Map 信息层的数据接线（#17），供 MapView 调用：
 * - Ally List 写进 MapState（着色与高亮由 buildMapScene 的层负责）
 * - 放大到 ICON_MIN_ZOOM 以上时经 roomMap2 订阅中心订阅可见房间（World Map 优先级最低，预算不够时先被截），
 *   把 Power Bank 与全部点（单位图层，#44）写进 MapState；退订的房间的点随即丢掉
 * 矿物、RCL 与区域状态随 map-stats 由所有权加载器带回，这里不另发请求。
 */
import { createEffect, createMemo, type Accessor, type Setter } from "solid-js";
import { ROOM_MAP_PRIORITY, roomMapKey, useRoomMapLease, type RoomMapHub } from "../source/room-map-hub.ts";
import type { RoomMapUpdate } from "../source/source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import type { WorldRect } from "./map-scene.ts";
import { applyPowerBanks, parseRoomName, withAllies, worldOffset, type MapState } from "./map-state.ts";
import { applyRoomUnits, retainUnits } from "./map-units.ts";
import { roomsByDistance } from "./room-map-feed.ts";

export interface MapInfoOptions {
  /** roomMap2 订阅中心（全页共用） */
  readonly roomMaps: Accessor<RoomMapHub>;
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

  /** 只随 Shard 与世界尺寸变化，Power Bank 更新不触发重算订阅 */
  const world = createMemo(
    () => {
      const state = mapState();
      return state && { shard: state.shard, size: state.size };
    },
    undefined,
    { equals: (a, b) => a === b || (!!a && !!b && a.shard === b.shard && a.size === b.size) },
  );

  const wanted = createMemo(() => {
    const w = world();
    const focus = options.focus();
    if (!w || !focus || !options.enabled() || focus.zoom < ICON_MIN_ZOOM) return [];
    return roomsByDistance(w.size, focus.rect).map((room) => ({ shard: w.shard, room }));
  });

  // 订阅中心在一个动画帧里把各房间的最新一帧逐个分发：先攒下，同一轮分发结束后一次写进 MapState，
  // Scene 每帧只重建一次（否则可见的上百个房间各触发一次）
  let pending: Map<string, { shard: string; frame: RoomMapUpdate }> | undefined;
  const commit = () => {
    const batch = pending;
    pending = undefined;
    if (!batch) return;
    setMapState((state) => {
      let next = state;
      for (const [room, { shard, frame }] of batch) {
        if (!next || next.shard !== shard) continue;
        next = applyRoomUnits(applyPowerBanks(next, room, frame["pb"] ?? []), room, frame);
      }
      return next;
    });
  };
  const granted = useRoomMapLease(
    options.roomMaps,
    {
      priority: ROOM_MAP_PRIORITY.worldMap,
      onFrame: (shard, room, frame) => {
        if (!pending) {
          pending = new Map();
          queueMicrotask(commit);
        }
        pending.set(room, { shard, frame });
      },
    },
    wanted,
  );

  createEffect(() => {
    const channels = granted();
    setMapState((state) => {
      if (!state) return state;
      const rooms = new Set([...Object.keys(state.units)].filter((room) => channels.has(roomMapKey(state.shard, room))));
      return retainUnits(state, rooms);
    });
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
