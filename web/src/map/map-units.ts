/**
 * World Map 的“单位”图层（#44），照官方 @screeps/map 的 UnitsLayer（docs/research/official-art-and-badges.md C 节）：
 * 已订阅 roomMap2 的每个房间画一张 50×50 的像素图（一格一像素），以加色混合叠在地形瓦片上。
 *
 * - 数据：use-map-info.ts 把每个房间最近一帧 roomMap2 原样记进 MapState.units（与 Power Bank 同一个订阅）。
 * - 颜色：固定类别用官方 COLORS；玩家按 ctx.ownerColor（我方 / 盟友 / 陌生人，与所有权同一条规则）；
 *   未知键用官方的红色。同一格有多个点时玩家盖过固定类别。
 * - 选像素图而不是每点一个 rect：一个房间可有数百个点（道路、墙），可见的上百个房间就是数万个图元，
 *   Pixi 适配层每次 Scene 变化都要逐个比较、各建一个 Graphics；像素图每房间只有一个图元。
 * - 像素图按“这一帧 + 着色”缓存：同一动画帧里别的房间更新导致 Scene 重建时，没变的房间不重新编码。
 */
import type { Color, Primitive } from "../scene/scene.ts";
import { encodePixelImage, type PixelImage } from "../scene/pixel-image.ts";
import { isNotPlayer, type RoomMapUpdate } from "../source/source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import { MAP_LAYER, type MapLayerPainter, type MapPaintContext } from "./map-scene.ts";
import type { MapState } from "./map-state.ts";

/** 房间边长（格） */
const ROOM_SIZE = 50;


/** 官方 COLORS（@screeps/map） */
const FIXED_COLORS: Readonly<Record<string, Color>> = {
  "2": 0xff9600,
  "3": 0xff9600,
  w: 0x000000,
  r: 0x3c3c3c,
  pb: 0xffffff,
  m: 0xaaaaaa,
  p: 0x00c8ff,
  k: 0x640000,
  c: 0x505050,
  s: 0xfff246,
};
const UNKNOWN_COLOR: Color = 0xeb5547;

/** 玩家键：服务器的用户 id（官方 24 位十六进制，私服常见 15–16 位）；也认 MapState 里已知的用户 */
const PLAYER_ID = /^[0-9a-f]{15,24}$/i;

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

/** 一帧里每个键的颜色，按绘制先后：固定类别、未知键，最后玩家（盖在上面） */
function colorsOf(frame: RoomMapUpdate, ctx: MapPaintContext): Array<[string, Color]> {
  const fixed: Array<[string, Color]> = [];
  const players: Array<[string, Color]> = [];
  for (const [key, points] of Object.entries(frame)) {
    if (points.length === 0) continue;
    const known = FIXED_COLORS[key];
    if (known !== undefined) fixed.push([key, known]);
    else if (!isNotPlayer(key) && (PLAYER_ID.test(key) || key in ctx.state.users)) players.push([key, ctx.ownerColor(key)]);
    else fixed.push([key, UNKNOWN_COLOR]);
  }
  return [...fixed, ...players];
}

function rasterize(frame: RoomMapUpdate, colors: ReadonlyArray<[string, Color]>): PixelImage {
  const rgba = new Uint8Array(ROOM_SIZE * ROOM_SIZE * 4);
  for (const [key, color] of colors) {
    for (const [x, y] of frame[key] ?? []) {
      if (x < 0 || y < 0 || x >= ROOM_SIZE || y >= ROOM_SIZE) continue;
      const i = (y * ROOM_SIZE + x) * 4;
      rgba[i] = (color >> 16) & 0xff;
      rgba[i + 1] = (color >> 8) & 0xff;
      rgba[i + 2] = color & 0xff;
      rgba[i + 3] = 255;
    }
  }
  return { width: ROOM_SIZE, height: ROOM_SIZE, rgba };
}

/** encode 可换（测试数编码次数）；每个画师各有一份缓存 */
export function createUnitsPainter(encode: (image: PixelImage) => string = encodePixelImage): MapLayerPainter {
  const cache = new WeakMap<RoomMapUpdate, { readonly signature: string; readonly url: string }>();
  return (ctx) => {
    if (ctx.zoom < ICON_MIN_ZOOM) return [];
    const out: Primitive[] = [];
    for (const room of ctx.visibleRooms) {
      const frame = ctx.state.units[room.name];
      if (!frame) continue;
      const colors = colorsOf(frame, ctx);
      if (colors.length === 0) continue;
      const signature = colors.map(([key, color]) => `${key}:${color}`).join();
      let cached = cache.get(frame);
      if (cached?.signature !== signature) {
        cached = { signature, url: encode(rasterize(frame, colors)) };
        cache.set(frame, cached);
      }
      out.push({
        kind: "image",
        key: `units:${room.name}`,
        // 在所有权色块之上、区域覆盖之下（MAP_LAYER 只在调用时读：本模块与 map-scene.ts 互相引用）
        layer: MAP_LAYER.ownership + 5,
        x: room.x,
        y: room.y,
        width: 1,
        height: 1,
        url: cached.url,
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
