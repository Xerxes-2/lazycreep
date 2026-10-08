/**
 * Room View 画法的公共部分：层级、画法签名与小工具。具体画法在 official-painters.ts 的映射表里。
 */
import type { SeasonArt } from "../art/season-art.ts";
import type { Color, Primitive } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { RoomUser } from "../source/source.ts";
import type { RoomObject, RoomState } from "./room-state.ts";

/** Room View 的层级。新画法挑一个已有层级，或在两层之间取值。 */
export const LAYER = {
  terrain: 0,
  road: 10,
  /** 地面上的东西：掉落资源、墓碑、废墟、工地 */
  ground: 15,
  structure: 20,
  /** 未知类型的占位图元 */
  placeholder: 25,
  creep: 30,
  /** 半透明盖在 creep 上 */
  rampart: 40,
  label: 60,
  /** RoomVisual（脚本画的东西）在一切之上 */
  visual: 100,
} as const;

type Draft<P> = P extends Primitive ? Omit<P, "key" | "objectId"> & { readonly part: string } : never;

/**
 * 画法产出的图元草稿：`part` 在同一个对象内唯一（如 "body"、"energy"），
 * buildRoomScene 把它变成 Scene 里的 key（`<对象 id>/<part>`）并填上 objectId。
 */
export type PrimitiveDraft = Draft<Primitive>;

export interface PaintContext {
  readonly theme: Theme;
  /** 画布上 1 格对应的像素数；玩家名、徽章等按缩放显隐的规则用它 */
  readonly zoom: number;
  /** 当前选中的对象 id */
  readonly selectedId: string | undefined;
  readonly users: Readonly<Record<string, RoomUser>>;
  /** 当前 Tick；未知时为 undefined。按剩余时间画的东西（冷却、衰减、倒计时）用它 */
  readonly gameTime?: number | undefined;
  /** 对象主人的颜色；按玩家 / 阵营着色的规则替换这里 */
  ownerColor(user: unknown): Color;
  /** 已确认可用的赛季贴图（#47）；没有时赛季对象用兜底画法（season-painters.ts） */
  readonly seasonArt?: SeasonArt;
  /** 本 Tick 要播放有界动画时给出（ADR 0008）；没有时画法只画静止画面、不带动画描述 */
  readonly animation?: AnimationContext;
}

/** 画法播放动画需要的上下文（action-animation.ts 的构件都收它） */
export interface AnimationContext {
  /** 动画的标识（本 Tick 的 gameTime）：放进 PrimitiveAnimation.id，连续两个 Tick 的同样动作也会重播 */
  readonly tick: number;
  /** Tick 间隔（毫秒，已取 max(间隔, 100)）；动画时长按它的比例算 */
  readonly tickMs: number;
  /** 上一个画出的房间状态（移动补间、炮塔转向的起点） */
  readonly previous: RoomState;
}

/** 一种对象类型的画法。对象保证带数值 x、y。 */
export type ObjectPainter = (obj: RoomObject, ctx: PaintContext) => readonly PrimitiveDraft[];

export type ObjectPainters = Readonly<Record<string, ObjectPainter>>;

// ---- 小工具 ----

export function num(obj: RoomObject, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 格子中心 */
export function center(obj: RoomObject): { readonly x: number; readonly y: number } {
  return { x: (num(obj, "x") ?? 0) + 0.5, y: (num(obj, "y") ?? 0) + 0.5 };
}

function sumValues(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  let total = 0;
  for (const v of Object.values(value)) if (typeof v === "number") total += v;
  return total;
}

/** store 的装载比例（0–1）；没有容量信息时为 undefined。 */
export function storeFraction(obj: RoomObject): number | undefined {
  const used = sumValues(obj["store"]);
  const capacity = num(obj, "storeCapacity") || sumValues(obj["storeCapacityResource"]);
  if (used === undefined || !capacity) return undefined;
  return Math.min(1, used / capacity);
}

/** 以格子中心为圆心、半径 r 的正多边形顶点（首个顶点朝上）。 */
export function regularPolygon(obj: RoomObject, sides: number, r: number, rotation = 0): number[] {
  const { x, y } = center(obj);
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation - Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push(x + r * Math.cos(angle), y + r * Math.sin(angle));
  }
  return points;
}
