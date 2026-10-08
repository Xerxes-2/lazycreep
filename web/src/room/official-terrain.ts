/**
 * 官方画风的地形与连接（#46，ADR 0006）：墙与沼泽的合并轮廓 + 噪声纹理、道路连接、非公开 rampart 合并。
 * 照官方渲染器（screeps/renderer，ISC，commit a2db4a7）的 `engine/src/lib/processors/terrain.js`、
 * `road.js` 与 `metadata/src/objects/rampart.metadata.js` 改写。
 *
 * 取舍：
 * - 官方把格子合成 SVG path（pathHelper，见 render-path.ts）再栅格化，噪声纹理用遮罩贴进轮廓里。
 *   我们的 Scene 图元没有遮罩，polygon 也没有洞（墙圈住的平原、rampart 围成的环都需要洞），
 *   所以整块地形（地面、沼泽、墙、噪声、阴影）合成一张房间大小的 SVG，作为一个 image 图元
 *   （composite-textures.ts 负责内联 PNG 与栅格化）。图元只有一个，Pixi 的逐图元比较几乎没有开销；
 *   代价是一次性栅格化（每个房间一次、constructedWall 变化时再一次）与一张 2048² 的纹理。
 * - lighting 图层：官方整个画面乘以 0x808080 的环境光，建筑另有光晕提亮（光晕见 official-lighting.ts，#49）；
 *   我们只把环境光（含墙的模糊阴影）乘进地形与道路的颜色，建筑保持原色。
 * - 沼泽噪声不流动（官方 swampTexture: 'animated' 的平移动画），出口标记（exit-*.svg）不画。
 * - 道路：官方每条路画一个圆 + 连向左上、上、右上、左四个邻居的矩形条（宽 0.3 格），合起来就是八邻域连线。
 *   我们把同一方向上连成一串的道路合成一条 line 图元，圆仍由每个道路对象画（点选、选中高亮照旧）。
 * - constructedWall 并进墙的合并轮廓（与官方一样），对象本身再叠一张加色的 constructedWall.svg。
 * - 非公开 rampart：按主人合并成一条带描边的 path（填充是主人色 × 0.3，描边是主人色），
 *   alpha 0.4、加色混合，也是一张房间大小的 image 图元；公开 rampart 逐格画 rampart.svg。
 *
 * 缓存：这些计算按输入缓存，只在地形、constructedWall / 道路 / 某个主人的 rampart 集合（或主人色）
 * 变化时重算；每个 Tick 只扫一遍对象算出集合的键。缓存的图元对象原样复用，适配层比较时直接命中。
 */
import { officialArtUrl } from "../art/official-art.ts";
import { officialTextureUrl } from "../art/official-textures.ts";
import { compositeSvgUrl } from "../scene/composite-textures.ts";
import type { Color, ImagePrimitive, LinePrimitive, Primitive } from "../scene/scene.ts";
import type { Terrain } from "../source/source.ts";
import { LAYER, center, num, type ObjectPainter, type ObjectPainters, type PaintContext } from "./room-paint.ts";
import type { RoomState } from "./room-state.ts";
import { PATH_ROOM_SIZE as N, cellGrid, renderPath, type CellGrid } from "./render-path.ts";

/** 地形贴图的栅格尺寸（像素）：约 41 像素 / 格，16 MB */
export const TERRAIN_RASTER = 2048;
/** 合并 rampart 的栅格尺寸（像素） */
export const RAMPART_RASTER = 1024;

/** 官方环境光 0x808080 */
const AMBIENT = 0x80 / 0xff;
/** 官方道路色 0xaaaaaa 乘以环境光 */
export const OFFICIAL_ROAD_COLOR = scaleColor(0xaaaaaa, AMBIENT);
/** 官方道路：圆半径 0.15 格，连接条宽 0.3 格 */
const ROAD_RADIUS = 0.15;

function scaleColor(color: Color, k: number): Color {
  const ch = (shift: number) => Math.round(((color >> shift) & 0xff) * k) << shift;
  return ch(16) | ch(8) | ch(0);
}

const hex = (color: Color) => `#${color.toString(16).padStart(6, "0")}`;

// ---- 地形 SVG（terrain.js：lighting 'normal'、swampTexture 静止、没有 decoration） ----

function terrainSvg(walls: string, swamps: string): string {
  const full = `x="0" y="0" width="5000" height="5000"`;
  const tile = (id: string, name: Parameters<typeof officialTextureUrl>[0], size: number, filter = "") =>
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">` +
    `<image href="${officialTextureUrl(name)}" width="${size}" height="${size}" preserveAspectRatio="none"${filter}/></pattern>`;
  const add = `style="mix-blend-mode:plus-lighter"`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TERRAIN_RASTER}" height="${TERRAIN_RASTER}" viewBox="0 0 5000 5000">`,
    `<defs>`,
    // noise2 的 tint 0x66FF00
    `<filter id="green" color-interpolation-filters="sRGB"><feColorMatrix values="0.4 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>`,
    `<filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="20"/></filter>`,
    // 官方 tileScale：ground 3、ground-mask 7、noise2 10 与 14、墙的 noise1 8
    tile("ground", "ground", 512 * 3),
    tile("groundMask", "ground-mask", 512 * 7),
    tile("swampNoiseA", "noise2", 256 * 10, ` filter="url(#green)"`),
    tile("swampNoiseB", "noise2", 256 * 14, ` filter="url(#green)"`),
    tile("wallNoise", "noise1", 512 * 8),
    `<path id="walls" d="${walls}"/><path id="swamps" d="${swamps}"/>`,
    `<clipPath id="wallClip"><use href="#walls"/></clipPath><clipPath id="swampClip"><use href="#swamps"/></clipPath>`,
    `</defs>`,
    // 地面
    `<rect ${full} fill="#555555"/>`,
    `<rect ${full} fill="url(#ground)" opacity="0.3"/>`,
    `<rect ${full} fill="url(#groundMask)" opacity="0.15" style="mix-blend-mode:multiply"/>`,
  ];
  if (swamps) {
    parts.push(
      `<use href="#swamps" fill="#4a501e" stroke="#4a501e" stroke-width="50" paint-order="stroke" opacity="0.4"/>`,
      // 官方噪声 alpha 0.3，遮罩精灵自身 alpha 0.25（Pixi 的精灵遮罩把它乘进去）
      `<rect ${full} fill="url(#swampNoiseA)" opacity="0.075" clip-path="url(#swampClip)" ${add}/>`,
      `<rect ${full} fill="url(#swampNoiseB)" opacity="0.075" clip-path="url(#swampClip)" ${add}/>`,
    );
  }
  if (walls) {
    parts.push(
      `<use href="#walls" fill="#111111" stroke="#000000" stroke-width="10" paint-order="stroke"/>`,
      `<rect ${full} fill="url(#wallNoise)" opacity="0.2" clip-path="url(#wallClip)" ${add}/>`,
    );
  }
  // lighting 图层里与地形有关的部分：环境光、墙的模糊阴影、墙本身的 0x808080
  parts.push(`<g style="mix-blend-mode:multiply"><rect ${full} fill="#808080"/>`);
  if (walls) {
    parts.push(
      `<use href="#walls" fill="#000000" filter="url(#shadow)" style="mix-blend-mode:multiply"/>`,
      `<use href="#walls" fill="#808080" stroke="#000000" stroke-width="10" paint-order="stroke" style="mix-blend-mode:screen"/>`,
    );
  }
  parts.push(`</g></svg>`);
  return parts.join("");
}

function rampartSvg(path: string, color: Color): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RAMPART_RASTER}" height="${RAMPART_RASTER}" viewBox="0 0 5000 5000">` +
    `<path d="${path}" fill="${hex(scaleColor(color, 0.3))}" stroke="${hex(color)}" stroke-width="25" paint-order="stroke"/></svg>`
  );
}

// ---- 缓存 ----

/** 最近用过的若干个结果（按键） */
class Recent<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly limit: number) {}
  get(key: string, make: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = make();
    this.map.set(key, value);
    for (const old of this.map.keys()) {
      if (this.map.size <= this.limit) break;
      this.map.delete(old);
    }
    return value;
  }
}

/** 一组格子的键：排好序的下标 */
const cellsKey = (cells: number[]) => cells.sort((a, b) => a - b).join(",");

function gridOf(cells: readonly number[], base?: CellGrid): CellGrid {
  const grid = base ? base.slice() : cellGrid();
  for (const i of cells) grid[i] = 1;
  return grid;
}

export interface OfficialLayerCounters {
  terrain: number;
  roads: number;
  ramparts: number;
}

/** 一份按输入缓存的官方地形与连接图层；counters 记录真正重算的次数（测试用） */
export function createOfficialLayers() {
  const counters: OfficialLayerCounters = { terrain: 0, roads: 0, ramparts: 0 };
  const terrainCache = new WeakMap<Terrain, { key: string; primitive: ImagePrimitive }>();
  const roadCache = new Recent<readonly LinePrimitive[]>(8);
  const rampartCache = new Recent<ImagePrimitive>(32);

  const terrainLayer = (terrain: Terrain, constructedWalls: number[]): ImagePrimitive => {
    const key = cellsKey(constructedWalls);
    const hit = terrainCache.get(terrain);
    if (hit && hit.key === key) return hit.primitive;
    counters.terrain++;
    const natural = cellGrid();
    const swamps = cellGrid();
    for (let i = 0; i < N * N; i++) {
      const code = Number(terrain.encoded[i] ?? 0);
      if (code & 1) natural[i] = 1;
      else if (code & 2) swamps[i] = 1;
    }
    const svg = terrainSvg(renderPath(gridOf(constructedWalls, natural)), renderPath(swamps));
    const primitive: ImagePrimitive = {
      key: "official-terrain",
      kind: "image",
      layer: LAYER.terrain,
      x: 0,
      y: 0,
      width: N,
      height: N,
      url: compositeSvgUrl(svg),
    };
    terrainCache.set(terrain, { key, primitive });
    return primitive;
  };

  const roadLayer = (roads: number[]) =>
    roadCache.get(cellsKey(roads), () => {
      counters.roads++;
      return roadLinks(gridOf(roads));
    });

  const rampartLayer = (user: string, cells: number[], color: Color) =>
    rampartCache.get(`${user}|${color}|${cellsKey(cells)}`, () => {
      counters.ramparts++;
      return {
        key: `official-rampart/${user}`,
        kind: "image",
        layer: LAYER.rampart,
        x: 0,
        y: 0,
        width: N,
        height: N,
        url: compositeSvgUrl(rampartSvg(renderPath(gridOf(cells)), color)),
        alpha: 0.4,
        blend: "add",
      } satisfies ImagePrimitive;
    });

  /** 房间级图层：地形贴图、道路连线、每个主人一张合并的 rampart */
  function layers(state: RoomState, terrain: Terrain | undefined, ctx: PaintContext): Primitive[] {
    const constructedWalls: number[] = [];
    const roads: number[] = [];
    const ramparts = new Map<string, number[]>();
    for (const obj of Object.values(state.objects)) {
      const x = num(obj, "x");
      const y = num(obj, "y");
      if (x === undefined || y === undefined || x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = Math.floor(y) * N + Math.floor(x);
      const type = obj["type"];
      if (type === "constructedWall") constructedWalls.push(i);
      else if (type === "road") roads.push(i);
      else if (type === "rampart" && !obj["isPublic"] && typeof obj["user"] === "string") {
        let cells = ramparts.get(obj["user"]);
        if (!cells) ramparts.set(obj["user"], (cells = []));
        cells.push(i);
      }
    }
    const out: Primitive[] = [];
    if (terrain) out.push(terrainLayer(terrain, constructedWalls));
    if (roads.length > 0) out.push(...roadLayer(roads));
    for (const user of [...ramparts.keys()].sort()) {
      out.push(rampartLayer(user, ramparts.get(user)!, ctx.ownerColor(user)));
    }
    return out;
  }

  return { layers, counters };
}

/** 八邻域里只看“往后”的四个方向：右、下、右下、左下；同方向连成一串的合成一条线 */
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
] as const;

/** 道路连线（road.js 的连接条）：每串同方向相邻的道路一条 line，宽 0.3 格，从格子中心到格子中心 */
export function roadLinks(grid: CellGrid): LinePrimitive[] {
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && grid[y * N + x] !== 0;
  const out: LinePrimitive[] = [];
  for (const [d, [dx, dy]] of DIRECTIONS.entries()) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // 每串从它的第一格开始：自己是路、前一格不是、后一格是
        if (!has(x, y) || has(x - dx, y - dy) || !has(x + dx, y + dy)) continue;
        let length = 1;
        while (has(x + dx * (length + 1), y + dy * (length + 1))) length++;
        out.push({
          key: `official-road/${d}/${x}/${y}`,
          kind: "line",
          layer: LAYER.road,
          points: [x + 0.5, y + 0.5, x + dx * length + 0.5, y + dy * length + 0.5],
          stroke: { color: OFFICIAL_ROAD_COLOR, width: ROAD_RADIUS * 2 },
        });
      }
    }
  }
  return out;
}

/** 全页共用的一份（buildRoomScene 用） */
const shared = createOfficialLayers();

/** 官方画风的房间级图层（buildRoomScene 在官方画风下用它替代几何地形） */
export function officialRoomLayers(state: RoomState, terrain: Terrain | undefined, ctx: PaintContext): Primitive[] {
  return shared.layers(state, terrain, ctx);
}

// ---- 对象画法：道路与 rampart ----

/** 道路本身：官方 road.js 的圆；连线在房间级图层里 */
const road: ObjectPainter = (obj) => {
  const { x, y } = center(obj);
  return [{ part: "body", kind: "circle", layer: LAYER.road, x, y, radius: ROAD_RADIUS, fill: OFFICIAL_ROAD_COLOR }];
};

/**
 * rampart：公开的逐格画 rampart.svg（alpha 0.5、主人色染色）；非公开的画在房间级的合并图层里，
 * 这里只留一个不画任何东西的方块，供点选。
 */
const rampart: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const cell = { part: "body", layer: LAYER.rampart, x: x - 0.5, y: y - 0.5, width: 1, height: 1 } as const;
  if (!obj["isPublic"]) return [{ ...cell, kind: "rect" }];
  return [{ ...cell, kind: "image", url: officialArtUrl("rampart"), tint: ctx.ownerColor(obj["user"]), alpha: 0.5 }];
};

/**
 * constructedWall：轮廓并进墙的合并轮廓（地形贴图里）；对象本身照官方叠一张加色混合的 constructedWall.svg。
 * 官方 hits 为 1 时闪红，不做。
 */
const constructedWall: ObjectPainter = (obj) => {
  const { x, y } = center(obj);
  return [
    { part: "body", kind: "image", layer: LAYER.structure, x: x - 0.5, y: y - 0.5, width: 1, height: 1, url: officialArtUrl("constructedWall"), blend: "add" },
  ];
};

/** 官方映射表里由本模块负责的条目 */
export const CONNECTED_PAINTERS: ObjectPainters = { road, rampart, constructedWall };
