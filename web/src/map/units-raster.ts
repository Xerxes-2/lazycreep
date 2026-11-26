/**
 * roomMap2 一帧 → 50×50 像素图（一格一像素），照官方 @screeps/map 的 UnitsLayer
 * （docs/research/official-art-and-badges.md C 节）。World Map 的单位图层与 Minimap 共用这一种画法。
 *
 * - 颜色：固定类别用官方 COLORS；玩家按 ownerColor（我方 / 盟友 / 陌生人，与所有权同一条规则）；
 *   未知键用官方的红色。同一格有多个点时玩家盖过固定类别。
 * - 按“这一帧 + 着色”缓存：别的房间更新导致 Scene 重建时，没变的房间不重新编码。
 * - 再按像素内容缓存（最近用过的 UNITS_RASTER_CACHE_SIZE 张）：每个 Tick 都是新的一帧对象，但路与墙几乎不变，
 *   没动的房间的单位点也一样；私服几毫秒一个 Tick 时逐帧重新编码 BMP 与 base64 很费（fabot sim 实测约占页面 CPU 1.5%）。
 *   命中时给出同一个 URL，Scene 的图元不变，纹理也不重新上传。
 * - 路与墙（{@link isGroundKey}）另画一张“地面”图，放在所有权色块之下：官方没有色块，路（60）比平原（43）略亮、
 *   墙是黑的；色块若压在路下面，有主房间的平原被染亮，路反而显得暗。其余的点画在色块之上保持原色。
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

/** 路与墙：画进所有权色块之下的“地面”图 */
const GROUND_KEYS: ReadonlySet<string> = new Set(["w", "r"]);
export const isGroundKey = (key: string): boolean => GROUND_KEYS.has(key);

/** 一帧里每个键的颜色，按绘制先后：固定类别、未知键，最后玩家（盖在上面） */
function colorsOf(frame: RoomMapUpdate, { ownerColor, knownUsers }: UnitsColoring, keep: (key: string) => boolean): Array<[string, Color]> {
  const fixed: Array<[string, Color]> = [];
  const players: Array<[string, Color]> = [];
  for (const [key, points] of Object.entries(frame)) {
    if (points.length === 0 || !keep(key)) continue;
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

/** 每个像素图缓存最多留几张（按最近使用）：够 World Map 订阅预算的 100 个房间都命中，每张约 23 KB */
export const UNITS_RASTER_CACHE_SIZE = 256;

const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));

/**
 * MurmurHash3（x86_32）的逐字混合，按 32 位字读（50×50×4 字节，长度是 4 的倍数）。
 * 不用逐字 FNV：这些图大多是透明里稀疏的几个点，逐字 FNV 在这种输入上大量相撞（单像素图 257 张里撞了一百多次）。
 */
function hashPixels(rgba: Uint8Array): number {
  const words = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  let h = 0;
  for (let i = 0; i < words.length; i++) {
    let k = Math.imul(words[i]!, 0xcc9e2d51);
    k = Math.imul(rotl(k, 15), 0x1b873593);
    h = (Math.imul(rotl(h ^ k, 13), 5) + 0xe6546b64) | 0;
  }
  h ^= rgba.byteLength;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const samePixels = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * encode 可换（测试数编码次数）；每个使用方各有一份缓存。
 * part：`ground` 只画路与墙，`top` 画其余的点。
 */
export function createUnitsRaster(part: "ground" | "top", encode: (image: PixelImage) => string = encodePixelImage): UnitsRaster {
  const keep = part === "ground" ? isGroundKey : (key: string) => !isGroundKey(key);
  const cache = new WeakMap<RoomMapUpdate, { readonly signature: string; readonly url: string }>();
  /** 像素内容 → URL，Map 的先后即最近使用的先后（最久没用的在前） */
  const byPixels = new Map<number, { readonly rgba: Uint8Array; readonly url: string }>();
  const encodeOnce = (image: PixelImage): string => {
    const hash = hashPixels(image.rgba);
    const hit = byPixels.get(hash);
    if (hit) {
      byPixels.delete(hash);
      // 哈希撞上但内容不同：当作没命中，覆盖掉
      if (samePixels(hit.rgba, image.rgba)) {
        byPixels.set(hash, hit);
        return hit.url;
      }
    }
    const url = encode(image);
    byPixels.set(hash, { rgba: image.rgba, url });
    if (byPixels.size > UNITS_RASTER_CACHE_SIZE) byPixels.delete(byPixels.keys().next().value!);
    return url;
  };
  return (frame, coloring) => {
    const colors = colorsOf(frame, coloring, keep);
    if (colors.length === 0) return undefined;
    const signature = colors.map(([key, color]) => `${key}:${color}`).join();
    let cached = cache.get(frame);
    if (cached?.signature !== signature) {
      cached = { signature, url: encodeOnce(rasterize(frame, colors)) };
      cache.set(frame, cached);
    }
    return cached.url;
  };
}
