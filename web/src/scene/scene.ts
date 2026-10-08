/**
 * Scene：渲染前的纯数据（spec #1 接缝 2）。Room View 与 World Map 都先产出 Scene，
 * 图元有 rect / circle / line / polygon / text / image 六种。
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

/**
 * 图片（World Map 的地形瓦片、官方画风的贴图等）：把 url 指向的图拉伸进矩形。只存 URL 与矩形，
 * 加载由适配层负责；加载完成前与加载失败时什么都不画。
 *
 * url 是贴图的唯一引用，也是适配层缓存纹理的键。合法形式（编码与识别都在 scene/image-sources.ts，
 * 见 textureSourceKind）：
 * - 同源地址（WebGL 纹理需要 CORS）：`.svg` 结尾的按当前缩放取档位栅格化，其余（PNG 等）按位图加载；
 * - `data:image/svg+xml;charset=utf-8,…`（svgDataUrl，徽章）或其他 `data:image/svg+xml`：同 SVG；
 * - `data:image/svg+xml;msc=composite,…`（compositeSvgUrl）：房间级合成贴图，内联引用的 PNG 后栅格化；
 * - `data:image/bmp;base64,…`（pixel-image.ts 的 encodePixelImage）：像素图，同步解码、最近邻缩放。
 */
export interface ImagePrimitive extends PrimitiveBase {
  readonly kind: "image";
  /** 未旋转时矩形的左上角 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly url: string;
  /** 混合方式，默认正常；"add" 为加色混合（World Map 单位图层） */
  readonly blend?: "add";
  /** 顺时针旋转的弧度（y 轴朝下），绕 (pivotX, pivotY)；默认 0 */
  readonly rotation?: number;
  /** 旋转中心（世界坐标）；默认矩形中心 */
  readonly pivotX?: number;
  readonly pivotY?: number;
  /** 染色：与贴图逐像素相乘（白色部分变成这个颜色）；默认不染色 */
  readonly tint?: Color;
}

export type Primitive =
  | RectPrimitive
  | CirclePrimitive
  | LinePrimitive
  | PolygonPrimitive
  | TextPrimitive
  | ImagePrimitive;

export type PrimitiveKind = Primitive["kind"];

export interface Scene {
  /** 世界范围 [0, width) × [0, height) */
  readonly width: number;
  readonly height: number;
  readonly background: Color;
  readonly primitives: readonly Primitive[];
}
