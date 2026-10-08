/**
 * 装饰（Decoration，#61）的画法小工具：官方的颜色亮度换算，与对象装饰的图元。
 * 照官方渲染器（screeps/renderer，ISC）`engine/src/lib/utils/hsl.js` 的 colorBrightness / hslToRgbStr
 * 与 `processors/objectDecoration.js` 改写。地形与道路的装饰画法在 official-terrain.ts。
 */
import type { Color } from "../scene/scene.ts";
import type { ObjectDecoration, RoomDecorations } from "../source/room-decorations.ts";
import { num, center, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

const channels = (color: Color): [number, number, number] => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
}

const clamp = (v: number) => Math.min(255, Math.max(0, v));
const fromChannels = ([r, g, b]: readonly number[]): Color => (clamp(r!) << 16) | (clamp(g!) << 8) | clamp(b!);

/** `#rrggbb` → 颜色 */
export const parseHex = (hex: string): Color => parseInt(hex.slice(1), 16);
/** 颜色 → `#rrggbb` */
export const toHex = (color: Color): string => `#${color.toString(16).padStart(6, "0")}`;

/** 官方 colorBrightness：HSL 的亮度乘以 brightness */
export function colorBrightness(hex: string, brightness: number): Color {
  const [h, s, l] = rgbToHsl(...channels(parseHex(hex)));
  return fromChannels(hslToRgb(h, s, l * brightness));
}

/** 官方 hslToRgbStr(0, 0, l)：灰度 */
export function grayHex(lightness: number): string {
  return toHex(fromChannels(hslToRgb(0, 0, lightness)));
}

/** 白色图案按 color 染色的 SVG 滤镜（Pixi 的 tint：逐通道相乘） */
export function tintFilter(id: string, color: Color): string {
  const [r, g, b] = channels(color).map((c) => Number((c / 255).toFixed(4)));
  return `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0"/></filter>`;
}

function applies(decoration: ObjectDecoration, obj: RoomObject): boolean {
  return decoration.objectType === obj["type"] && (decoration.user === undefined || decoration.user === obj["user"]);
}

/**
 * 对象装饰（objectDecoration.js）：对象类型（与玩家）对上的每条装饰，按 active 的尺寸（官方单位）
 * 以格子为中心画一组贴图，垫在对象自身所有部件之下（官方加在对象容器的最底层），对象自身的部件照画。
 * 透明度截到 0–1（官方 alpha 的取值范围到 2，Pixi 超过 1 等于 1）。
 * 不做：官方的循环透明度动画（`active.animation`；常驻动画，ADR 0008 不画）与光照层副本（`active.lighting`）。
 */
export function objectDecorationDrafts(obj: RoomObject, decorations: RoomDecorations, layer: number): PrimitiveDraft[] {
  if (num(obj, "x") === undefined) return [];
  const { x, y } = center(obj);
  const out: PrimitiveDraft[] = [];
  decorations.objects.forEach((decoration, i) => {
    if (!applies(decoration, obj)) return;
    const width = decoration.width / 100;
    const height = decoration.height / 100;
    decoration.graphics.forEach((graphic, j) => {
      out.push({
        part: `decoration/${i}/${j}`,
        kind: "image",
        layer,
        x: x - width / 2,
        y: y - height / 2,
        width,
        height,
        url: graphic.url,
        ...(graphic.alpha !== undefined ? { alpha: Math.min(1, Math.max(0, graphic.alpha)) } : {}),
        ...(graphic.color !== undefined ? { tint: colorBrightness(graphic.color, graphic.brightness ?? 1) } : {}),
      });
    });
  });
  return out;
}
