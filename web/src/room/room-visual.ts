/**
 * RoomVisual → Scene 图元。纯函数。
 *
 * 线上格式（screeps/engine src/game/rooms.js 的 RoomVisual.prototype.*）：每行一个 JSON 指令，
 *   circle {t:"c", x, y, s}   line {t:"l", x1, y1, x2, y2, s}   rect {t:"r", x, y, w, h, s}
 *   poly   {t:"p", points:[[x,y],...], s}   text {t:"t", text, x, y, s}
 * 样式字段与默认值按 docs.screeps.com/api/#RoomVisual。
 *
 * RoomVisual 的坐标以格子中心为原点（(10,10) 是格子 10,10 的中心），Scene 以格子左上角为原点，
 * 所以所有坐标加 0.5。坏行、未知指令、未知样式或无法识别的值一律忽略（退回默认值），不抛错。
 */
import type { Color, Primitive, Stroke } from "../scene/scene.ts";
import { LAYER } from "./room-paint.ts";

type Style = Readonly<Record<string, unknown>>;
type Draft = Primitive extends infer P ? (P extends Primitive ? Omit<P, "key" | "layer"> : never) : never;

const HALF = 0.5;
/** 官方客户端 1 格 = 100 像素；font 写成 "20px" 时按此换算成格。 */
const PX_PER_TILE = 100;
/** 文档未写 text 的默认字号；取 0.5 格。 */
const DEFAULT_FONT = 0.5;
/** 基线 → 文字中部的偏移（字号的比例），近似 cap height 的一半。 */
const BASELINE_TO_MIDDLE = 0.35;
/** 估算文字宽度（背景矩形用）：每个字符约 0.6 个字号宽。 */
const CHAR_WIDTH = 0.6;
const CIRCLE_SEGMENTS = 48;

const NAMED_COLORS: Readonly<Record<string, Color>> = {
  white: 0xffffff,
  black: 0x000000,
  red: 0xff0000,
  green: 0x008000,
  lime: 0x00ff00,
  blue: 0x0000ff,
  yellow: 0xffff00,
  cyan: 0x00ffff,
  aqua: 0x00ffff,
  magenta: 0xff00ff,
  fuchsia: 0xff00ff,
  orange: 0xffa500,
  purple: 0x800080,
  pink: 0xffc0cb,
  brown: 0xa52a2a,
  gray: 0x808080,
  grey: 0x808080,
  silver: 0xc0c0c0,
  maroon: 0x800000,
  olive: 0x808000,
  navy: 0x000080,
  teal: 0x008080,
  gold: 0xffd700,
  violet: 0xee82ee,
};

/** 颜色：undefined = 无法识别；null = transparent（显式不画）。 */
function parseColor(value: unknown): Color | null | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase();
  if (s === "transparent" || s === "none") return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1]!.split("").map((c) => parseInt(c + c, 16));
    return (r! << 16) | (g! << 8) | b!;
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return parseInt(m[1]!, 16);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((c) => Math.min(255, Number(c)));
    return (r! << 16) | (g! << 8) | b!;
  }
  return NAMED_COLORS[s];
}

/** 有效颜色或默认值；transparent → undefined（不画）。 */
function color(style: Style, key: string, fallback: Color | undefined): Color | undefined {
  const parsed = parseColor(style[key]);
  if (parsed === null) return undefined;
  return parsed ?? fallback;
}

function number(style: Style, key: string, fallback: number): number {
  const value = style[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finite(...values: unknown[]): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}

/** font：数字（格）、"0.7"、"20px"、"0.7 serif"、"bold italic 1.5 Times New Roman"。字体族与粗斜体忽略。 */
function fontSize(font: unknown): number {
  if (typeof font === "number" && Number.isFinite(font) && font > 0) return font;
  if (typeof font !== "string") return DEFAULT_FONT;
  for (const token of font.trim().split(/\s+/)) {
    const px = /^(\d*\.?\d+)px$/i.exec(token);
    if (px) return Number(px[1]) / PX_PER_TILE;
    if (/^\d*\.?\d+$/.test(token)) return Number(token);
  }
  return DEFAULT_FONT;
}

type LineStyle = "dashed" | "dotted" | undefined;

function lineStyle(style: Style): LineStyle {
  const v = style["lineStyle"];
  return v === "dashed" || v === "dotted" ? v : undefined;
}

/** 虚线 / 点线的 [实, 空] 长度（格），随线宽缩放。 */
function dashPattern(kind: "dashed" | "dotted", width: number): [number, number] {
  return kind === "dashed" ? [Math.max(0.15, width * 3), Math.max(0.1, width * 2)] : [Math.max(0.03, width), Math.max(0.08, width * 2)];
}

/** 把折线（扁平点列）按 pattern 切成若干段，每段一个扁平点列。 */
function dashPolyline(points: readonly number[], pattern: [number, number]): number[][] {
  const [on, off] = pattern;
  const segments: number[][] = [];
  let current: number[] | undefined;
  let drawing = true;
  let left = on;
  for (let i = 0; i + 3 < points.length; i += 2) {
    let [x0, y0] = [points[i]!, points[i + 1]!];
    const [x1, y1] = [points[i + 2]!, points[i + 3]!];
    let remaining = Math.hypot(x1 - x0, y1 - y0);
    if (remaining === 0) continue;
    const [dx, dy] = [(x1 - x0) / remaining, (y1 - y0) / remaining];
    while (remaining > 0) {
      const step = Math.min(left, remaining);
      const [nx, ny] = [x0 + dx * step, y0 + dy * step];
      if (drawing) {
        current ??= [x0, y0];
        current.push(nx, ny);
      }
      [x0, y0] = [nx, ny];
      remaining -= step;
      left -= step;
      if (left <= 1e-9) {
        if (drawing && current) segments.push(current);
        current = undefined;
        drawing = !drawing;
        left = drawing ? on : off;
      }
    }
  }
  if (drawing && current && current.length >= 4) segments.push(current);
  return segments;
}

/** 描边：实线返回挂在图元上的 stroke；虚线返回独立的线段图元。 */
function outline(
  path: readonly number[],
  stroke: Stroke | undefined,
  kind: LineStyle,
  alpha: number,
): { stroke?: Stroke; dashes: Draft[] } {
  if (!stroke) return { dashes: [] };
  if (!kind) return { stroke, dashes: [] };
  return {
    dashes: dashPolyline(path, dashPattern(kind, stroke.width)).map((points) => ({ kind: "line", points, stroke, alpha })),
  };
}

function strokeOf(style: Style, colorKey: string, fallbackColor: Color | undefined, widthKey: string, fallbackWidth: number) {
  const c = color(style, colorKey, fallbackColor);
  return c === undefined ? undefined : { color: c, width: number(style, widthKey, fallbackWidth) };
}

function circle(cmd: Style, style: Style): Draft[] {
  if (!finite(cmd["x"], cmd["y"])) return [];
  const x = (cmd["x"] as number) + HALF;
  const y = (cmd["y"] as number) + HALF;
  const radius = number(style, "radius", 0.15);
  const alpha = number(style, "opacity", 0.5);
  const fill = color(style, "fill", 0xffffff);
  const ring: number[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const a = (i * 2 * Math.PI) / CIRCLE_SEGMENTS;
    ring.push(x + radius * Math.cos(a), y + radius * Math.sin(a));
  }
  const { stroke, dashes } = outline(ring, strokeOf(style, "stroke", undefined, "strokeWidth", 0.1), lineStyle(style), alpha);
  const body: Draft[] =
    fill === undefined && !stroke
      ? []
      : [{ kind: "circle", x, y, radius, alpha, ...(fill === undefined ? {} : { fill }), ...(stroke ? { stroke } : {}) }];
  return [...body, ...dashes];
}

function line(cmd: Style, style: Style): Draft[] {
  if (!finite(cmd["x1"], cmd["y1"], cmd["x2"], cmd["y2"])) return [];
  const points = [cmd["x1"], cmd["y1"], cmd["x2"], cmd["y2"]].map((v) => (v as number) + HALF);
  const alpha = number(style, "opacity", 0.5);
  const stroke = strokeOf(style, "color", 0xffffff, "width", 0.1);
  if (!stroke) return [];
  const kind = lineStyle(style);
  if (kind) return outline(points, stroke, kind, alpha).dashes;
  return [{ kind: "line", points, stroke, alpha }];
}

function rect(cmd: Style, style: Style): Draft[] {
  if (!finite(cmd["x"], cmd["y"], cmd["w"], cmd["h"])) return [];
  const x = (cmd["x"] as number) + HALF;
  const y = (cmd["y"] as number) + HALF;
  const width = cmd["w"] as number;
  const height = cmd["h"] as number;
  const alpha = number(style, "opacity", 0.5);
  const fill = color(style, "fill", 0xffffff);
  const path = [x, y, x + width, y, x + width, y + height, x, y + height, x, y];
  const { stroke, dashes } = outline(path, strokeOf(style, "stroke", undefined, "strokeWidth", 0.1), lineStyle(style), alpha);
  const body: Draft[] =
    fill === undefined && !stroke
      ? []
      : [{ kind: "rect", x, y, width, height, alpha, ...(fill === undefined ? {} : { fill }), ...(stroke ? { stroke } : {}) }];
  return [...body, ...dashes];
}

function poly(cmd: Style, style: Style): Draft[] {
  const raw = cmd["points"];
  if (!Array.isArray(raw)) return [];
  const points: number[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && finite(p[0], p[1])) points.push((p[0] as number) + HALF, (p[1] as number) + HALF);
  }
  if (points.length < 4) return [];
  const alpha = number(style, "opacity", 0.5);
  const fill = color(style, "fill", undefined);
  const prims: Draft[] = [];
  if (fill !== undefined && points.length >= 6) prims.push({ kind: "polygon", points, fill, alpha });
  const stroke = strokeOf(style, "stroke", 0xffffff, "strokeWidth", 0.1);
  if (stroke) {
    const kind = lineStyle(style);
    if (kind) prims.push(...outline(points, stroke, kind, alpha).dashes);
    else prims.push({ kind: "line", points, stroke, alpha });
  }
  return prims;
}

function text(cmd: Style, style: Style): Draft[] {
  const content = cmd["text"];
  if (!finite(cmd["x"], cmd["y"]) || (typeof content !== "string" && typeof content !== "number")) return [];
  const label = String(content);
  const x = (cmd["x"] as number) + HALF;
  const baseline = (cmd["y"] as number) + HALF;
  const size = fontSize(style["font"]);
  const alpha = number(style, "opacity", 1);
  const align = style["align"] === "left" || style["align"] === "right" ? style["align"] : "center";
  const background = color(style, "backgroundColor", undefined);
  const stroke = strokeOf(style, "stroke", undefined, "strokeWidth", 0.15);
  const prims: Draft[] = [];
  // 有背景时官方改为垂直居中于 y，否则 y 是基线
  const y = background === undefined ? baseline - size * BASELINE_TO_MIDDLE : baseline;
  if (background !== undefined) {
    const padding = number(style, "backgroundPadding", 0.3);
    const textWidth = label.length * size * CHAR_WIDTH;
    const left = align === "left" ? x : align === "right" ? x - textWidth : x - textWidth / 2;
    prims.push({
      kind: "rect",
      x: left - padding,
      y: y - size / 2 - padding,
      width: textWidth + 2 * padding,
      height: size + 2 * padding,
      fill: background,
      alpha,
    });
  }
  prims.push({
    kind: "text",
    x,
    y,
    text: label,
    size,
    color: color(style, "color", 0xffffff) ?? 0xffffff,
    align,
    alpha,
    ...(stroke ? { stroke } : {}),
  });
  return prims;
}

const COMMANDS: Readonly<Record<string, (cmd: Style, style: Style) => Draft[]>> = {
  c: circle,
  l: line,
  r: rect,
  p: poly,
  t: text,
};

function isRecord(value: unknown): value is Style {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RoomVisual 序列化文本 → visual 层的图元（key 为 `visual/<行号>/<序号>`）。 */
export function roomVisualPrimitives(visual: string): Primitive[] {
  const prims: Primitive[] = [];
  if (!visual) return prims;
  visual.split("\n").forEach((row, index) => {
    if (!row.trim()) return;
    let cmd: unknown;
    try {
      cmd = JSON.parse(row);
    } catch {
      return;
    }
    if (!isRecord(cmd) || typeof cmd["t"] !== "string" || !Object.hasOwn(COMMANDS, cmd["t"])) return;
    const style = isRecord(cmd["s"]) ? cmd["s"] : {};
    COMMANDS[cmd["t"]]!(cmd, style).forEach((draft, part) => {
      prims.push({ ...draft, key: `visual/${index}/${part}`, layer: LAYER.visual } as Primitive);
    });
  });
  return prims;
}
