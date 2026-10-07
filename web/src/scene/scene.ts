/**
 * Scene：渲染前的纯数据（spec #1 接缝 2）。Room View 与 World Map 都先产出 Scene，
 * 再交给与来源无关的 Pixi 适配层画出来。Scene 里只有可 JSON 序列化的值，没有函数与类实例。
 *
 * 坐标是“世界单位”：Room View 里 1 单位 = 1 格，格 (x, y) 占 [x, x+1) × [y, y+1)；
 * World Map 可以自定单位，适配层只把 [0, width) × [0, height) 缩放进画布。
 */

/** 0xRRGGBB */
export type Color = number;

export interface Stroke {
  readonly color: Color;
  /** 世界单位 */
  readonly width: number;
  readonly alpha?: number;
}

interface PrimitiveBase {
  /** 在一个 Scene 里唯一；适配层按它复用显示对象。 */
  readonly key: string;
  /** 越大越靠上；相同层级按出现顺序。 */
  readonly layer: number;
  /** 图元代表的游戏对象（点选、详情用）；地形等没有。 */
  readonly objectId?: string;
  /** 0–1，默认 1 */
  readonly alpha?: number;
}

export interface RectPrimitive extends PrimitiveBase {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 圆角半径 */
  readonly radius?: number;
  readonly fill?: Color;
  readonly stroke?: Stroke;
}

export interface CirclePrimitive extends PrimitiveBase {
  readonly kind: "circle";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly fill?: Color;
  readonly stroke?: Stroke;
}

/** 折线：points 为扁平的 [x0, y0, x1, y1, ...]。 */
export interface LinePrimitive extends PrimitiveBase {
  readonly kind: "line";
  readonly points: readonly number[];
  readonly stroke: Stroke;
}

/** 闭合多边形：points 为扁平的 [x0, y0, x1, y1, ...]。 */
export interface PolygonPrimitive extends PrimitiveBase {
  readonly kind: "polygon";
  readonly points: readonly number[];
  readonly fill?: Color;
  readonly stroke?: Stroke;
}

export interface TextPrimitive extends PrimitiveBase {
  readonly kind: "text";
  /** (x, y) 是文字的锚点：水平按 align，垂直居中。 */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** 字号，世界单位 */
  readonly size: number;
  readonly color: Color;
  readonly align?: "left" | "center" | "right";
  readonly stroke?: Stroke;
}

/** 进度条（血条、能量条）：从左往右填充 value 比例。 */
export interface BarPrimitive extends PrimitiveBase {
  readonly kind: "bar";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 0–1，越界会被截断 */
  readonly value: number;
  readonly fill: Color;
  readonly background: Color;
}

export type Primitive =
  | RectPrimitive
  | CirclePrimitive
  | LinePrimitive
  | PolygonPrimitive
  | TextPrimitive
  | BarPrimitive;

export type PrimitiveKind = Primitive["kind"];

export interface Scene {
  /** 世界范围 [0, width) × [0, height) */
  readonly width: number;
  readonly height: number;
  readonly background: Color;
  readonly primitives: readonly Primitive[];
}
