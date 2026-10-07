/**
 * World Map 特有的视口运算：适配世界、缩放上下限、Scene 用的可见区域与缩放分档。
 * 通用的换算、缩放与平移在 scene/scene-camera.ts（与 Room View 共用）。
 * 视口形状与 Pixi 适配层相同：screen = world * scale + (x, y)。
 */
import type { Viewport } from "../scene/pixi-scene-view.ts";
import { screenToWorld, zoomAround } from "../scene/scene-camera.ts";
import type { WorldSize } from "../source/source.ts";
import type { WorldRect } from "./map-scene.ts";

/** 每个房间最多放大到多少 CSS 像素 */
export const MAX_ZOOM = 300;

/** 整个世界居中放进画布 */
export function fitCamera(size: WorldSize, width: number, height: number): Viewport {
  const scale = Math.min(width / size.width, height / size.height);
  return { x: (width - size.width * scale) / 2, y: (height - size.height * scale) / 2, scale };
}

/** 以屏幕点 (px, py) 为中心缩放 factor 倍；scale 夹在 [minScale, MAX_ZOOM]。 */
export function zoomAt(camera: Viewport, px: number, py: number, factor: number, minScale: number): Viewport {
  const scale = Math.max(minScale, Math.min(MAX_ZOOM, camera.scale * factor));
  return { ...zoomAround(camera, px, py, scale / camera.scale), scale };
}

/** 画布里可见的世界区域 */
export function visibleRect(camera: Viewport, width: number, height: number): WorldRect {
  const a = screenToWorld(camera, 0, 0);
  const b = screenToWorld(camera, width, height);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/**
 * 给 Scene 用的可见区域：向外对齐到 4 个房间（与 zoom2 块一致），平移一点点时 Scene 不变，
 * 只改视口（只重画、不重建图元）。
 */
export function sceneRect(rect: WorldRect): WorldRect {
  const step = 4;
  return {
    x0: Math.floor(rect.x0 / step) * step,
    y0: Math.floor(rect.y0 / step) * step,
    x1: Math.ceil(rect.x1 / step) * step,
    y1: Math.ceil(rect.y1 / step) * step,
  };
}

/** 给 Scene 用的缩放：按 2 的 1/4 次方分档，连续缩放时 Scene 只在跨档时重建。 */
export function sceneZoom(scale: number): number {
  return 2 ** (Math.floor(Math.log2(scale) * 4) / 4);
}

/** 把世界点 (wx, wy) 放到画布中央，缩放为 scale */
export function centerOn(wx: number, wy: number, width: number, height: number, scale: number): Viewport {
  return { x: width / 2 - wx * scale, y: height / 2 - wy * scale, scale };
}
