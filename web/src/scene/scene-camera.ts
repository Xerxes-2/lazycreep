/**
 * 相机与点选：与 Scene 来源无关的纯函数（Room View、World Map 都可用）。
 *
 * 相机（Camera）用世界坐标描述“看哪里、看多大”，与画布尺寸无关，适合持久化；
 * 视口（Viewport）是适配层用的屏幕换算：screen = world * scale + (x, y)。
 */
import type { Viewport } from "./pixi-scene-view.ts";
import type { Primitive, Scene } from "./scene.ts";

export interface Camera {
  /** 画布中心对应的世界坐标 */
  readonly cx: number;
  readonly cy: number;
  /** 画布短边能放下的世界单位数 */
  readonly span: number;
}

export function toViewport(camera: Camera, width: number, height: number): Viewport {
  const scale = Math.min(width, height) / camera.span;
  return { x: width / 2 - camera.cx * scale, y: height / 2 - camera.cy * scale, scale };
}

export function fromViewport(viewport: Viewport, width: number, height: number): Camera {
  const center = screenToWorld(viewport, width / 2, height / 2);
  return { cx: center.x, cy: center.y, span: Math.min(width, height) / viewport.scale };
}

export function screenToWorld(viewport: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - viewport.x) / viewport.scale, y: (sy - viewport.y) / viewport.scale };
}

/** 以屏幕点 (sx, sy) 为中心缩放 factor 倍，该点下的世界坐标保持不动。 */
export function zoomAround(viewport: Viewport, sx: number, sy: number, factor: number): Viewport {
  const scale = viewport.scale * factor;
  return { x: sx - (sx - viewport.x) * factor, y: sy - (sy - viewport.y) * factor, scale };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

/** 最多放大到短边只剩这么多格 */
const MIN_SPAN = 4;
/** 最多缩小到场景长边的这么多倍 */
const MAX_SPAN_RATIO = 1.5;

/** 中心不出场景范围，缩放在上下限之内。 */
export function clampCamera(camera: Camera, scene: Pick<Scene, "width" | "height">): Camera {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    cx: clamp(camera.cx, 0, scene.width),
    cy: clamp(camera.cy, 0, scene.height),
    span: clamp(camera.span, MIN_SPAN, Math.max(scene.width, scene.height) * MAX_SPAN_RATIO),
  };
}

function covers(p: Primitive, x: number, y: number): boolean {
  switch (p.kind) {
    case "rect":
    case "bar":
    case "image":
      return p.x <= x && x <= p.x + p.width && p.y <= y && y <= p.y + p.height;
    case "circle":
      return (x - p.x) ** 2 + (y - p.y) ** 2 <= p.radius ** 2;
    case "text":
      return false;
    case "line":
    case "polygon": {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < p.points.length; i += 2) {
        const px = p.points[i]!, py = p.points[i + 1]!;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return x0 <= x && x <= x1 && y0 <= y && y <= y1;
    }
  }
}

/**
 * 世界点 (x, y) 下的对象 id，自上而下。对象的高度按它覆盖该点的图元里最低的层级算，
 * 这样选中高亮、血条等装饰不会改变顺序（rampart 在 creep 上，creep 在建筑上）。
 */
export function pickObjects(scene: Scene, x: number, y: number): string[] {
  const lowest = new Map<string, number>();
  for (const p of scene.primitives) {
    if (p.objectId === undefined || !covers(p, x, y)) continue;
    const seen = lowest.get(p.objectId);
    if (seen === undefined || p.layer < seen) lowest.set(p.objectId, p.layer);
  }
  return [...lowest].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** 同一处重复点选时在重叠对象间轮换；没有对象时为 undefined（收起详情）。 */
export function nextPick(ids: readonly string[], current: string | undefined): string | undefined {
  if (ids.length === 0) return undefined;
  const index = current === undefined ? -1 : ids.indexOf(current);
  return ids[(index + 1) % ids.length];
}
