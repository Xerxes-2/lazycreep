/**
 * World Map 的“单位”图层（#44），照官方 @screeps/map 的 UnitsLayer（docs/research/official-art-and-badges.md C 节）：
 * 已订阅 roomMap2 的每个房间画一张 50×50 的像素图（一格一像素，units-raster.ts，与 Minimap 同一画法），
 * 以加色混合叠在地形瓦片上。
 *
 * - 数据：use-map-info.ts 把每个房间最近一帧 roomMap2 原样记进 MapState.units（与 Power Bank 同一个订阅）。
 * - 选像素图而不是每点一个 rect：一个房间可有数百个点（道路、墙），可见的上百个房间就是数万个图元，
 *   Pixi 适配层每次 Scene 变化都要逐个比较、各建一个 Graphics；像素图每房间只有一个图元。
 */
import type { Primitive } from "../scene/scene.ts";
import type { PixelImage } from "../scene/pixel-image.ts";
import type { RoomMapUpdate } from "../source/source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import { MAP_LAYER, type MapLayerPainter, type MapPaintContext } from "./map-scene.ts";
import type { MapState } from "./map-state.ts";
import { createUnitsRaster } from "./units-raster.ts";

/** 记下一个房间最近一帧 roomMap2（全部点）。 */
export function applyRoomUnits(state: MapState, room: string, frame: RoomMapUpdate): MapState {
  if (state.units[room] === frame) return state;
  return { ...state, units: { ...state.units, [room]: frame } };
}

/** 只留 rooms 里的房间（退订了的房间不再显示旧的点）；没有要删的时原样返回。 */
export function retainUnits(state: MapState, rooms: ReadonlySet<string>): MapState {
  const kept = Object.entries(state.units).filter(([room]) => rooms.has(room));
  if (kept.length === Object.keys(state.units).length) return state;
  return { ...state, units: Object.fromEntries(kept) };
}

/** encode 可换（测试数编码次数）；每个画师各有一份缓存 */
export function createUnitsPainter(encode?: (image: PixelImage) => string): MapLayerPainter {
  const raster = createUnitsRaster(encode);
  return (ctx) => {
    if (ctx.zoom < ICON_MIN_ZOOM) return [];
    const coloring = { ownerColor: ctx.ownerColor, knownUsers: ctx.state.users };
    const out: Primitive[] = [];
    for (const room of ctx.visibleRooms) {
      const frame = ctx.state.units[room.name];
      if (!frame) continue;
      const url = raster(frame, coloring);
      if (url === undefined) continue;
      out.push({
        kind: "image",
        key: `units:${room.name}`,
        // 在所有权色块之上、区域覆盖之下（MAP_LAYER 只在调用时读：本模块与 map-scene.ts 互相引用）
        layer: MAP_LAYER.ownership + 5,
        x: room.x,
        y: room.y,
        width: 1,
        height: 1,
        url,
        blend: "add",
      });
    }
    return out;
  };
}

let shared: MapLayerPainter | undefined;

/** 默认的单位图层（全页共用一份缓存）。用函数声明：map-scene.ts 的 MAP_LAYERS 在模块求值时就要拿到它。 */
export function paintUnits(ctx: MapPaintContext): readonly Primitive[] {
  shared ??= createUnitsPainter();
  return shared(ctx);
}
