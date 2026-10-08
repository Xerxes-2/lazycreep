/**
 * roomMap2 一帧 → 50×50 像素图（一格一像素），照官方 @screeps/map 的 UnitsLayer
 * （docs/research/official-art-and-badges.md C 节）。World Map 的单位图层与 Minimap 共用这一种画法。
 *
 * - 颜色：固定类别用官方 COLORS；玩家按 ownerColor（我方 / 盟友 / 陌生人，与所有权同一条规则）；
 *   未知键用官方的红色。同一格有多个点时玩家盖过固定类别。
 * - 按“这一帧 + 着色”缓存：别的房间更新导致 Scene 重建时，没变的房间不重新编码。
 */
import type { Color } from "../scene/scene.ts";
import { encodePixelImage, type PixelImage } from "../scene/pixel-image.ts";
import { isNotPlayer, type RoomMapUpdate } from "../source/source.ts";

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

/** 玩家键：服务器的用户 id（官方 24 位十六进制，私服常见 15–16 位）；也认 knownUsers 里的用户 */
const PLAYER_ID = /^[0-9a-f]{15,24}$/i;

export interface UnitsColoring {
  /** 玩家 id → 颜色 */
  readonly ownerColor: (userId: string) => Color;
  /** 已知用户（键不是标准 id 时据此认作玩家） */
  readonly knownUsers: Readonly<Record<string, unknown>>;
}

/** 一帧 → 像素图的 data URL；没有可画的点时为 undefined */
export type UnitsRaster = (frame: RoomMapUpdate, coloring: UnitsColoring) => string | undefined;

/** 一帧里每个键的颜色，按绘制先后：固定类别、未知键，最后玩家（盖在上面） */
function colorsOf(frame: RoomMapUpdate, { ownerColor, knownUsers }: UnitsColoring): Array<[string, Color]> {
  const fixed: Array<[string, Color]> = [];
  const players: Array<[string, Color]> = [];
  for (const [key, points] of Object.entries(frame)) {
    if (points.length === 0) continue;
    const known = FIXED_COLORS[key];
    if (known !== undefined) fixed.push([key, known]);
    else if (!isNotPlayer(key) && (PLAYER_ID.test(key) || key in knownUsers)) players.push([key, ownerColor(key)]);
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

/** encode 可换（测试数编码次数）；每个使用方各有一份缓存 */
export function createUnitsRaster(encode: (image: PixelImage) => string = encodePixelImage): UnitsRaster {
  const cache = new WeakMap<RoomMapUpdate, { readonly signature: string; readonly url: string }>();
  return (frame, coloring) => {
    const colors = colorsOf(frame, coloring);
    if (colors.length === 0) return undefined;
    const signature = colors.map(([key, color]) => `${key}:${color}`).join();
    let cached = cache.get(frame);
    if (cached?.signature !== signature) {
      cached = { signature, url: encode(rasterize(frame, colors)) };
      cache.set(frame, cached);
    }
    return cached.url;
  };
}
