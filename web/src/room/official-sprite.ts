/**
 * 官方画法的公共小工具（#42 写在 official-painters.ts 里，#45 挪到这里，供按对象类别拆开的画法文件共用，
 * 避免这些文件与 official-painters.ts 互相 import）。
 */
import { officialArtUrl, type OfficialSvgName } from "../art/official-art.ts";
import type { Color } from "../scene/scene.ts";
import { LAYER, center, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

/** 官方 metadata 的长度单位：100 = 1 格 */
export const u = (value: number) => value / 100;

/** 官方的 zIndex 换成我们的层级：都在 structure 层，按官方先后微调 */
export const zLayer = (zIndex: number) => LAYER.structure + zIndex / 100;

/** 官方的能量黄 */
export const ENERGY = 0xffe56d;

export interface SpriteOptions {
  /** 官方单位（100 = 1 格） */
  readonly width: number;
  readonly height?: number;
  /** 贴图上对准格子中心的点（0–1），默认 (0.5, 0.5)；也是旋转中心 */
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly rotation?: number;
  readonly tint?: Color;
  readonly alpha?: number;
  readonly layer?: number;
}

/** 以格子中心为锚点摆一张官方贴图（对应官方 `sprite` processor）。 */
export function officialSprite(obj: RoomObject, part: string, name: OfficialSvgName, options: SpriteOptions): PrimitiveDraft {
  const { x, y } = center(obj);
  const width = u(options.width);
  const height = u(options.height ?? options.width);
  const ax = options.anchorX ?? 0.5;
  const ay = options.anchorY ?? 0.5;
  const rotated = options.rotation !== undefined;
  return {
    part,
    kind: "image",
    layer: options.layer ?? LAYER.structure,
    x: x - ax * width,
    y: y - ay * height,
    width,
    height,
    url: officialArtUrl(name),
    ...(rotated ? { rotation: options.rotation, pivotX: x, pivotY: y } : {}),
    ...(options.tint === undefined ? {} : { tint: options.tint }),
    ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
  };
}

export function circle(obj: RoomObject, part: string, radius: number, fill: Color, layer: number): PrimitiveDraft {
  const { x, y } = center(obj);
  return { part, kind: "circle", layer, x, y, radius: u(radius), fill };
}

export const energyStore = (obj: RoomObject) => {
  const store = obj["store"];
  const value = typeof store === "object" && store !== null ? (store as Record<string, unknown>)["energy"] : undefined;
  return typeof value === "number" ? value : 0;
};

export const energyCapacity = (obj: RoomObject) => {
  const cap = obj["storeCapacityResource"];
  const value = typeof cap === "object" && cap !== null ? (cap as Record<string, unknown>)["energy"] : undefined;
  return typeof value === "number" ? value : undefined;
};

/** 有主人时的主人色（官方 playerColor） */
export const ownerTint = (obj: RoomObject, ctx: PaintContext) => ctx.ownerColor(obj["user"]);

/**
 * 徽章位：官方 userBadge 在没有徽章图时画纯色圆。徽章图由徽章票接入；在那之前用主人色，
 * 没有主人时用官方默认的 0x222222。
 */
export function badgeSpot(obj: RoomObject, ctx: PaintContext, radius: number, layer: number): PrimitiveDraft {
  return circle(obj, "badge", radius, obj["user"] === undefined ? 0x222222 : ownerTint(obj, ctx), layer);
}

// ---- 官方 Graphics 的弧、扇形、椭圆（Scene 没有这些图元，用折线 / 多边形逼近） ----

const ARC_STEPS_PER_TURN = 48;

/** 圆心 (cx, cy)、半径 r（格）从 start 到 end（弧度，y 轴朝下即顺时针）的弧上的点，扁平数组 */
export function arcPoints(cx: number, cy: number, r: number, start: number, end: number): number[] {
  const steps = Math.max(1, Math.ceil((Math.abs(end - start) / (2 * Math.PI)) * ARC_STEPS_PER_TURN));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    points.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return points;
}

/** 0–1 截断；非数（NaN、Infinity）当 0 */
export const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/**
 * 官方 `siteProgress` processor 的扇形：从正上方顺时针填 fraction 圈，半径 radius（官方单位）。
 * 没有进度时返回 undefined。
 */
export function progressPie(
  obj: RoomObject,
  part: string,
  radius: number,
  fraction: number,
  fill: Color,
  layer: number,
  alpha?: number,
): PrimitiveDraft | undefined {
  const f = clamp01(fraction);
  if (f === 0) return undefined;
  const { x, y } = center(obj);
  const start = -Math.PI / 2;
  const points = [x, y, ...arcPoints(x, y, u(radius), start, start + 2 * Math.PI * f)];
  return { part, kind: "polygon", layer, points, fill, ...(alpha === undefined ? {} : { alpha }) };
}

/** 官方 `arc` 描边：从正上方顺时针画 fraction 圈；描边宽 width（官方单位） */
export function progressArc(obj: RoomObject, part: string, radius: number, fraction: number, color: Color, width: number, layer: number): PrimitiveDraft | undefined {
  const f = clamp01(fraction);
  if (f === 0) return undefined;
  const { x, y } = center(obj);
  const start = -Math.PI / 2;
  return { part, kind: "line", layer, points: arcPoints(x, y, u(radius), start, start + 2 * Math.PI * f), stroke: { color, width: u(width) } };
}

/** 官方 `drawEllipse(0, 0, rx, ry)`：半轴为 rx、ry（官方单位）的椭圆顶点 */
export function ellipsePoints(obj: RoomObject, rx: number, ry: number): number[] {
  const { x, y } = center(obj);
  const points: number[] = [];
  for (let i = 0; i < ARC_STEPS_PER_TURN; i++) {
    const a = (i * 2 * Math.PI) / ARC_STEPS_PER_TURN;
    points.push(x + u(rx) * Math.cos(a), y + u(ry) * Math.sin(a));
  }
  return points;
}

/** store 里各资源的数量 */
export function storeAmounts(obj: RoomObject): Readonly<Record<string, number>> {
  const store = obj["store"];
  const out: Record<string, number> = {};
  if (typeof store === "object" && store !== null) {
    for (const [k, v] of Object.entries(store)) if (typeof v === "number") out[k] = v;
  }
  return out;
}

/** 官方 resourceTotal：store 各项之和 */
export function storeTotal(obj: RoomObject): number {
  let total = 0;
  for (const v of Object.values(storeAmounts(obj))) total += v;
  return total;
}

/** storeCapacityResource[key]（没有时 undefined） */
export function capacityOf(obj: RoomObject, key: string): number | undefined {
  const cap = obj["storeCapacityResource"];
  const value = typeof cap === "object" && cap !== null ? (cap as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" ? value : undefined;
}

/** 以格子中心为原点、官方单位的矩形 (x, y, w, h) */
export function officialRect(obj: RoomObject, part: string, x: number, y: number, width: number, height: number, fill: Color, layer: number): PrimitiveDraft {
  const c = center(obj);
  return { part, kind: "rect", layer, x: c.x + u(x), y: c.y + u(y), width: u(width), height: u(height), fill };
}
