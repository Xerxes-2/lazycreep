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
 *   代价是一次性栅格化（每个房间一次、constructedWall 变化时再一次、放大越过档位时再一次）与一张房间大小的纹理
 *   （尺寸按设备与缩放取档位，手机整房间约 1024²，上限 2048²，见 composite-textures.ts）。
 * - 外观参数（墙底色、纹理强度、环境光）比官方调亮，见 TERRAIN_LOOK。
 * - lighting 图层（ADR 0009）：官方的光照图（环境光、墙的模糊阴影与墙本身的 0x808080，加上各 glow）以正片叠底
 *   盖住地形与对象。光照打开时，这里给出光照组的底色（{@link LIGHTING_BASE_KEY}：铺满房间的环境光方块，
 *   有地形时再加一张环境光 + 墙阴影的合成贴图），地形贴图与道路颜色不再预乘环境光；光照关闭时没有光照组，
 *   地形与道路照旧自带环境光与墙阴影（与 #46 一样）。环境光：没有地形装饰时 TERRAIN_LOOK.ambient，有装饰时官方 #808080。
 * - 装饰（#61，Decoration）：墙与地面的颜色、亮度、前景图案，沼泽与道路的颜色，照 terrain.js、decorations.js 与
 *   road.js 的装饰分支；有装饰的部分用官方原参数（OFFICIAL_LOOK），不用 TERRAIN_LOOK 的调亮。装饰进地形的缓存键。
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
import { compositeSvgUrl } from "../scene/image-sources.ts";
import type { Color, ImagePrimitive, LinePrimitive, Primitive, RectPrimitive } from "../scene/scene.ts";
import type { FloorLandscape, WallLandscape } from "../source/room-decorations.ts";
import type { Terrain } from "../source/source.ts";
import { colorBrightness, grayHex, tintFilter, toHex } from "./decoration-look.ts";
import { LAYER, center, num, type ObjectPainter, type ObjectPainters, type PaintContext } from "./room-paint.ts";
import type { RoomState } from "./room-state.ts";
import { PATH_ROOM_SIZE as N, cellGrid, renderPath, type CellGrid } from "./render-path.ts";

/** 官方环境光 0x808080 */
const AMBIENT = 0x80 / 0xff;
/** 官方道路色 */
const ROAD_COLOR = 0xaaaaaa;
/** 官方道路色 0xaaaaaa 乘以环境光（光照关闭时） */
export const OFFICIAL_ROAD_COLOR = scaleColor(ROAD_COLOR, AMBIENT);

/**
 * 道路颜色：有地面装饰时按装饰的颜色与亮度（road.js）。光照关闭时乘以环境光；
 * 打开时由光照组乘，这里给原色（不压暗两次）
 */
export function roadColor(floor: FloorLandscape | undefined, lighting = false): Color {
  const color = floor ? colorBrightness(floor.roadsColor, floor.roadsBrightness) : ROAD_COLOR;
  return lighting ? color : scaleColor(color, AMBIENT);
}
/** 官方道路：圆半径 0.15 格，连接条宽 0.3 格 */
const ROAD_RADIUS = 0.15;

function scaleColor(color: Color, k: number): Color {
  const ch = (shift: number) => Math.round(((color >> shift) & 0xff) * k) << shift;
  return ch(16) | ch(8) | ch(0);
}

const hex = (color: Color) => `#${color.toString(16).padStart(6, "0")}`;

// ---- 地形 SVG（terrain.js：lighting 'normal'、swampTexture 静止；装饰见 #61） ----

/**
 * 官方噪声纹理用加色混合（Pixi 的 ADD）叠进墙与沼泽。SVG 里对应 `mix-blend-mode: plus-lighter`，
 * 不认它的浏览器（MDN 兼容数据：Chrome / Edge 100、Firefox 99 之前；Safari 自 9.1 起认）会忽略整条声明、
 * 退成普通混合，噪声盖住底色。注意同一份数据称 Safari / iOS 不支持 SVG 元素上的 mix-blend-mode，
 * 那里本文件所有混合（含 multiply、screen）是否生效要在设备上确认，检测 CSS.supports 也测不出来。
 * 这时改用 `screen`：1 − (1 − a)(1 − b)，底色很暗（墙 #111、沼泽的暗绿）且噪声不透明度只有 0.075–0.2，
 * 结果与相加只差 b·a 一项，肉眼几乎看不出。
 */
export type AdditiveBlend = "plus-lighter" | "screen";

export function detectAdditiveBlend(): AdditiveBlend {
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  try {
    return css?.supports?.("mix-blend-mode", "plus-lighter") ? "plus-lighter" : "screen";
  } catch {
    return "screen";
  }
}

/**
 * 没有装饰时的默认地形外观。官方原参数（括号内）整体偏暗：墙近乎纯黑、纹理起伏只有 3/255 左右肉眼看不出。
 * 用户 2026-10-08 在 W17S25 的并排对比（原样 / 轻度 / 中度 / 明显）里选了“轻度”：
 * 墙仍明显比平原暗，纹理能看出来。
 */
const TERRAIN_LOOK = {
  /** 墙底色（官方 #111111） */
  wall: "#1c1c1c",
  /** 墙噪声 noise1 的不透明度（官方 0.2） */
  wallNoise: 0.3,
  /** 地面纹理 ground（官方 0.3） */
  ground: 0.7,
  /** 地面遮罩 ground-mask，正片叠底（官方 0.15） */
  groundMask: 0.3,
  /** 沼泽底色的不透明度（官方 0.4） */
  swamp: 0.6,
  /** 沼泽两层噪声 noise2 各自的不透明度（官方 0.075） */
  swampNoise: 0.15,
  /** 整体环境光，正片叠底（官方 #808080） */
  ambient: "#8c8c8c",
} as const;

/** 装饰的前景贴图（官方静态资源上的 PNG）按 1024 像素算：Scene 是纯数据，合成时才取图，量不到原始尺寸 */
export const DECORATION_TEXTURE_PX = 1024;

/** 有装饰时照官方原参数（terrain.js，lighting 'normal'）；没有装饰的部分仍用 TERRAIN_LOOK */
const OFFICIAL_LOOK = { wallNoise: 0.2, swamp: 0.4, swampNoise: 0.075, ambient: "#808080" } as const;

/** 装饰的地形（#61）：墙与地面各自可有可无 */
export interface TerrainDecorations {
  readonly wall?: WallLandscape | undefined;
  readonly floor?: FloorLandscape | undefined;
}

const FULL = `x="0" y="0" width="5000" height="5000"`;
const WALL_SHADOW_FILTER = `<filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="20"/></filter>`;

const decorated = ({ wall, floor }: TerrainDecorations) => wall !== undefined || floor !== undefined;

/** 光照组底色的环境光：没有地形装饰时用 TERRAIN_LOOK（用户选定的“轻度”），有装饰时用官方原参数 */
export function ambientColor(decorations: TerrainDecorations = {}): Color {
  return parseInt((decorated(decorations) ? OFFICIAL_LOOK.ambient : TERRAIN_LOOK.ambient).slice(1), 16);
}

/**
 * lighting 图层里与地形有关的部分（terrain.js）：环境光、墙的模糊阴影（正片叠底）、墙本身的 0x808080（滤色；
 * 装饰时描边的亮度按 strokeLighting）。引用 `#walls` 与 `#shadow`
 */
function lightingParts(walls: string, wall: WallLandscape | undefined, ambient: Color): string[] {
  const parts = [`<rect ${FULL} fill="${hex(ambient)}"/>`];
  if (walls) {
    const lightStroke = wall ? grayHex(wall.strokeLighting) : "#000000";
    parts.push(
      `<use href="#walls" fill="#000000" filter="url(#shadow)" style="mix-blend-mode:multiply"/>`,
      `<use href="#walls" fill="#808080" stroke="${lightStroke}" ${wallStrokeWidth(wall)} paint-order="stroke" style="mix-blend-mode:screen"/>`,
    );
  }
  return parts;
}

const wallStrokeWidth = (wall: WallLandscape | undefined) => (wall ? `stroke-width="${wall.strokeWidth}"` : `stroke-width="10"`);

/** 光照组的底色贴图（光照打开时）：与光照关闭时地形贴图末尾乘上的那一层完全相同，但单独成图、不透明 */
function lightingSvg(walls: string, decorations: TerrainDecorations): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">`,
    `<defs>${WALL_SHADOW_FILTER}<path id="walls" d="${walls}"/></defs>`,
    ...lightingParts(walls, decorations.wall, ambientColor(decorations)),
    `</svg>`,
  ].join("");
}

/** 地形贴图；lit 为真（光照打开）时不乘环境光与墙阴影，交给光照组 */
function terrainSvg(walls: string, swamps: string, blend: AdditiveBlend, decorations: TerrainDecorations = {}, lit = false): string {
  const { wall, floor } = decorations;
  const full = FULL;
  const tile = (id: string, name: Parameters<typeof officialTextureUrl>[0], size: number, filter = "") =>
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">` +
    `<image href="${officialTextureUrl(name)}" width="${size}" height="${size}" preserveAspectRatio="none"${filter}/></pattern>`;
  const add = `style="mix-blend-mode:${blend}"`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">`,
    `<defs>`,
    // noise2 的 tint 0x66FF00
    `<filter id="green" color-interpolation-filters="sRGB"><feColorMatrix values="0.4 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>`,
  ];
  if (!lit) parts.push(WALL_SHADOW_FILTER);
  // 官方 tileScale：ground 3、ground-mask 7、noise2 10 与 14、墙的 noise1 8
  if (!floor) parts.push(tile("ground", "ground", 512 * 3), tile("groundMask", "ground-mask", 512 * 7));
  parts.push(
    tile("swampNoiseA", "noise2", 256 * 10, ` filter="url(#green)"`),
    tile("swampNoiseB", "noise2", 256 * 14, ` filter="url(#green)"`),
    tile("wallNoise", "noise1", 512 * 8),
  );
  if (wall) parts.push(tintFilter("wallTint", colorBrightness(wall.foregroundColor, wall.foregroundBrightness)));
  if (floor) {
    parts.push(tintFilter("floorTint", colorBrightness(floor.floorForegroundColor, floor.floorForegroundBrightness)));
    if (floor.tileScale !== undefined) {
      // 官方 TilingSprite 的 tileScale：一块 = 贴图像素 × tileScale 个官方单位（100 = 1 格）
      const size = DECORATION_TEXTURE_PX * floor.tileScale;
      parts.push(
        `<pattern id="floorTile" patternUnits="userSpaceOnUse" width="${size}" height="${size}">` +
          `<image href="${floor.floorForegroundUrl}" width="${size}" height="${size}" preserveAspectRatio="none" filter="url(#floorTint)"/></pattern>`,
      );
    }
  }
  parts.push(
    `<path id="walls" d="${walls}"/><path id="swamps" d="${swamps}"/>`,
    `<clipPath id="wallClip"><use href="#walls"/></clipPath><clipPath id="swampClip"><use href="#swamps"/></clipPath>`,
    `</defs>`,
  );
  // 地面
  if (floor) {
    const alpha = floor.floorForegroundAlpha;
    parts.push(
      `<rect ${full} fill="${toHex(colorBrightness(floor.floorBackgroundColor, floor.floorBackgroundBrightness))}"/>`,
      floor.tileScale !== undefined
        ? `<rect ${full} fill="url(#floorTile)" opacity="${alpha}"/>`
        : `<image href="${floor.floorForegroundUrl}" ${full} preserveAspectRatio="none" filter="url(#floorTint)" opacity="${alpha}"/>`,
    );
  } else {
    parts.push(
      `<rect ${full} fill="#555555"/>`,
      `<rect ${full} fill="url(#ground)" opacity="${TERRAIN_LOOK.ground}"/>`,
      `<rect ${full} fill="url(#groundMask)" opacity="${TERRAIN_LOOK.groundMask}" style="mix-blend-mode:multiply"/>`,
    );
  }
  if (swamps) {
    const look = floor ? OFFICIAL_LOOK : TERRAIN_LOOK;
    const fill = floor ? `fill="${floor.swampColor}" stroke="${floor.swampStrokeColor}" stroke-width="${floor.swampStrokeWidth}"` : `fill="#4a501e" stroke="#4a501e" stroke-width="50"`;
    parts.push(
      `<use href="#swamps" ${fill} paint-order="stroke" opacity="${look.swamp}"/>`,
      // 官方噪声 alpha 0.3，遮罩精灵自身 alpha 0.25（Pixi 的精灵遮罩把它乘进去），合起来 0.075；没有装饰时按 TERRAIN_LOOK 加强
      `<rect ${full} fill="url(#swampNoiseA)" opacity="${look.swampNoise}" clip-path="url(#swampClip)" ${add}/>`,
      `<rect ${full} fill="url(#swampNoiseB)" opacity="${look.swampNoise}" clip-path="url(#swampClip)" ${add}/>`,
    );
  }
  const wallStroke = wallStrokeWidth(wall);
  if (walls) {
    const fill = wall
      ? `fill="${toHex(colorBrightness(wall.backgroundColor, wall.backgroundBrightness))}" stroke="${toHex(colorBrightness(wall.strokeColor, wall.strokeBrightness))}"`
      : `fill="${TERRAIN_LOOK.wall}" stroke="#000000"`;
    parts.push(
      `<use href="#walls" ${fill} ${wallStroke} paint-order="stroke"/>`,
      `<rect ${full} fill="url(#wallNoise)" opacity="${wall ? OFFICIAL_LOOK.wallNoise : TERRAIN_LOOK.wallNoise}" clip-path="url(#wallClip)" ${add}/>`,
    );
    // 装饰的前景（decorations.js）：拉伸铺满整个房间，用墙的遮罩（只有填充、不含描边）
    if (wall) {
      parts.push(
        `<image href="${wall.foregroundUrl}" ${full} preserveAspectRatio="none" filter="url(#wallTint)" opacity="${wall.foregroundAlpha}" clip-path="url(#wallClip)"/>`,
      );
    }
  }
  // 光照关闭时把 lighting 图层里与地形有关的部分乘进来（光照打开时由光照组负责）
  if (!lit) parts.push(`<g style="mix-blend-mode:multiply">`, ...lightingParts(walls, wall, ambientColor(decorations)), `</g>`);
  parts.push(`</svg>`);
  return parts.join("");
}

function rampartSvg(path: string, color: Color): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">` +
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
  /** 光照组底色贴图（环境光 + 墙阴影） */
  lighting: number;
  roads: number;
  ramparts: number;
}

export interface OfficialLayerOptions {
  /** 噪声纹理的加色混合方式；默认按浏览器支持检测（{@link detectAdditiveBlend}） */
  readonly additiveBlend?: AdditiveBlend;
}

/** 一份按输入缓存的官方地形与连接图层；counters 记录真正重算的次数（测试用） */
export function createOfficialLayers(options: OfficialLayerOptions = {}) {
  const blend = options.additiveBlend ?? detectAdditiveBlend();
  const counters: OfficialLayerCounters = { terrain: 0, lighting: 0, roads: 0, ramparts: 0 };
  interface Cached {
    key: string;
    wall: WallLandscape | undefined;
    floor: FloorLandscape | undefined;
    primitive: ImagePrimitive;
  }
  /** 地形贴图按房间缓存，光照开 / 关各一份（开关来回切换不重算） */
  const terrainCache = { lit: new WeakMap<Terrain, Cached>(), unlit: new WeakMap<Terrain, Cached>() };
  const lightingCache = new WeakMap<Terrain, Cached>();
  const roadCache = new Recent<readonly LinePrimitive[]>(8);
  const rampartCache = new Recent<ImagePrimitive>(32);

  /** 按房间缓存一张房间大小的合成贴图：constructedWall 集合或装饰（同一房间内是同一个对象，按引用比较）变了才重算 */
  const cachedImage = (
    cache: WeakMap<Terrain, Cached>,
    terrain: Terrain,
    constructedWalls: number[],
    { wall, floor }: TerrainDecorations,
    make: (natural: CellGrid, swamps: CellGrid) => { readonly key: string; readonly layer: number; readonly group?: "lighting"; readonly svg: string },
  ): ImagePrimitive => {
    const key = cellsKey(constructedWalls);
    const hit = cache.get(terrain);
    if (hit && hit.key === key && hit.wall === wall && hit.floor === floor) return hit.primitive;
    const natural = cellGrid();
    const swamps = cellGrid();
    for (let i = 0; i < N * N; i++) {
      const code = Number(terrain.encoded[i] ?? 0);
      if (code & 1) natural[i] = 1;
      else if (code & 2) swamps[i] = 1;
    }
    const { key: primitiveKey, layer, group, svg } = make(gridOf(constructedWalls, natural), swamps);
    const primitive: ImagePrimitive = {
      key: primitiveKey,
      kind: "image",
      layer,
      x: 0,
      y: 0,
      width: N,
      height: N,
      url: compositeSvgUrl(svg),
      ...(group ? { group } : {}),
    };
    cache.set(terrain, { key, wall, floor, primitive });
    return primitive;
  };

  const terrainLayer = (terrain: Terrain, constructedWalls: number[], decorations: TerrainDecorations, lit: boolean): ImagePrimitive =>
    cachedImage(lit ? terrainCache.lit : terrainCache.unlit, terrain, constructedWalls, decorations, (walls, swamps) => {
      counters.terrain++;
      return { key: "official-terrain", layer: LAYER.terrain, svg: terrainSvg(renderPath(walls), renderPath(swamps), blend, decorations, lit) };
    });

  const lightingLayer = (terrain: Terrain, constructedWalls: number[], decorations: TerrainDecorations): ImagePrimitive =>
    cachedImage(lightingCache, terrain, constructedWalls, decorations, (walls) => {
      counters.lighting++;
      return { key: LIGHTING_BASE_KEY.walls, layer: LAYER.lighting, group: "lighting", svg: lightingSvg(renderPath(walls), decorations) };
    });

  const roadLayer = (roads: number[], color: Color) =>
    roadCache.get(`${color}|${cellsKey(roads)}`, () => {
      counters.roads++;
      return roadLinks(gridOf(roads), color);
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
    const decorations = ctx.decorations;
    const terrainDecorations = { wall: decorations?.wall, floor: decorations?.floor };
    const lit = ctx.lighting === true;
    if (terrain) out.push(terrainLayer(terrain, constructedWalls, terrainDecorations, lit));
    if (lit) {
      // 光照组的底色：先铺一块环境光（地形还没到时也有），有地形时盖上环境光 + 墙阴影的合成贴图
      out.push(ambientRect(ambientColor(terrainDecorations)));
      if (terrain) out.push(lightingLayer(terrain, constructedWalls, terrainDecorations));
    }
    if (roads.length > 0) out.push(...roadLayer(roads, roadColor(decorations?.floor, lit)));
    for (const user of [...ramparts.keys()].sort()) {
      out.push(rampartLayer(user, ramparts.get(user)!, ctx.ownerColor(user)));
    }
    return out;
  }

  return { layers, counters };
}

/** 光照组底色的两个图元：铺满房间的环境光方块、环境光 + 墙阴影的合成贴图 */
export const LIGHTING_BASE_KEY = { ambient: "lighting/ambient", walls: "lighting/terrain" } as const;

/** 环境光方块按颜色复用同一个图元对象（适配层比较时直接命中） */
const ambientRects = new Map<Color, RectPrimitive>();
function ambientRect(fill: Color): RectPrimitive {
  let rect = ambientRects.get(fill);
  if (!rect) {
    rect = { key: LIGHTING_BASE_KEY.ambient, kind: "rect", layer: LAYER.lighting, group: "lighting", x: 0, y: 0, width: N, height: N, fill };
    ambientRects.set(fill, rect);
  }
  return rect;
}

/** 八邻域里只看“往后”的四个方向：右、下、右下、左下；同方向连成一串的合成一条线 */
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
] as const;

/** 道路连线（road.js 的连接条）：每串同方向相邻的道路一条 line，宽 0.3 格，从格子中心到格子中心 */
export function roadLinks(grid: CellGrid, color: Color = OFFICIAL_ROAD_COLOR): LinePrimitive[] {
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
          stroke: { color, width: ROAD_RADIUS * 2 },
        });
      }
    }
  }
  return out;
}

/** 全页共用的一份（buildRoomScene 用） */
const shared = createOfficialLayers();

/** 官方画风的房间级图层：地形、道路连线、合并的 rampart（buildRoomScene 用） */
export function officialRoomLayers(state: RoomState, terrain: Terrain | undefined, ctx: PaintContext): Primitive[] {
  return shared.layers(state, terrain, ctx);
}

// ---- 对象画法：道路与 rampart ----

/** 道路本身：官方 road.js 的圆；连线在房间级图层里 */
const road: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [{ part: "body", kind: "circle", layer: LAYER.road, x, y, radius: ROAD_RADIUS, fill: roadColor(ctx.decorations?.floor, ctx.lighting) }];
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
