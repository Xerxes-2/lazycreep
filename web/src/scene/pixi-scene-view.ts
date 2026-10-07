/**
 * Pixi 适配层：把 Scene 画到画布上。与 Scene 的来源无关（Room View、World Map 都用它）。
 *
 * - 按图元 key 复用显示对象：key 相同且内容没变的图元不重画，消失的销毁
 * - 不用 Pixi 的 Application 与自动 ticker；只在 Scene 变化、尺寸 / 视口变化
 *   或显式 requestRender() 时安排一帧，同一帧内多次请求合并成一次 render
 */
import { Container, Graphics, Text, Ticker, autoDetectRenderer, type Renderer } from "pixi.js";
import type { Primitive, Scene, Stroke } from "./scene.ts";

/** 世界坐标到画布 CSS 像素：screen = world * scale + (x, y) */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** 适配层用到的渲染器能力；默认由 Pixi 的 autoDetectRenderer 创建。 */
export type SceneRenderer = Pick<Renderer, "render" | "resize" | "canvas" | "destroy" | "background">;

export interface SceneViewOptions {
  /** 画布 CSS 尺寸 */
  readonly width: number;
  readonly height: number;
  /** 设备像素比，默认 window.devicePixelRatio */
  readonly resolution?: number;
  /** 测试或特殊环境里换掉渲染器 */
  readonly renderer?: SceneRenderer;
  /** 安排一帧，默认 requestAnimationFrame */
  readonly schedule?: (frame: () => void) => void;
}

export interface SceneView {
  readonly canvas: HTMLCanvasElement;
  /** 换成新的 Scene；与上一个 Scene 内容相同时什么都不做。 */
  show(scene: Scene): void;
  /** 下一帧强制重画一次（例如画布被系统清掉之后）。 */
  requestRender(): void;
  resize(width: number, height: number): void;
  /** 不传则自动适配：整个 Scene 居中放进画布。 */
  setViewport(viewport: Viewport | undefined): void;
  /** 当前生效的视口（包括自动适配算出来的）。 */
  readonly viewport: Viewport;
  destroy(): void;
}

/** 文字先按这个字号栅格化再缩放到世界单位，避免放大后发糊。 */
const TEXT_RASTER_SIZE = 32;

type Node = Graphics | Text;

interface Entry {
  primitive: Primitive;
  node: Node;
}

function sameStroke(a: Stroke | undefined, b: Stroke | undefined): boolean {
  if (a === b) return true;
  return !!a && !!b && a.color === b.color && a.width === b.width && a.alpha === b.alpha;
}

function samePoints(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 图元内容是否相同（按字段比较，points 与 stroke 逐项比较）。 */
export function samePrimitive(a: Primitive, b: Primitive): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = (a as unknown as Record<string, unknown>)[key];
    const y = (b as unknown as Record<string, unknown>)[key];
    if (x === y) continue;
    if (key === "points") {
      if (!samePoints(x as readonly number[], y as readonly number[])) return false;
    } else if (key === "stroke") {
      if (!sameStroke(x as Stroke | undefined, y as Stroke | undefined)) return false;
    } else return false;
  }
  return true;
}

function strokeStyle(stroke: Stroke) {
  return { color: stroke.color, width: stroke.width, alpha: stroke.alpha ?? 1 };
}

function drawGraphics(g: Graphics, p: Exclude<Primitive, { kind: "text" }>): void {
  g.clear();
  switch (p.kind) {
    case "rect":
      if (p.radius) g.roundRect(p.x, p.y, p.width, p.height, p.radius);
      else g.rect(p.x, p.y, p.width, p.height);
      if (p.fill !== undefined) g.fill({ color: p.fill });
      if (p.stroke) g.stroke(strokeStyle(p.stroke));
      break;
    case "circle":
      g.circle(p.x, p.y, p.radius);
      if (p.fill !== undefined) g.fill({ color: p.fill });
      if (p.stroke) g.stroke(strokeStyle(p.stroke));
      break;
    case "polygon":
      g.poly([...p.points], true);
      if (p.fill !== undefined) g.fill({ color: p.fill });
      if (p.stroke) g.stroke(strokeStyle(p.stroke));
      break;
    case "line": {
      const [x0 = 0, y0 = 0, ...rest] = p.points;
      g.moveTo(x0, y0);
      for (let i = 0; i + 1 < rest.length; i += 2) g.lineTo(rest[i]!, rest[i + 1]!);
      g.stroke(strokeStyle(p.stroke));
      break;
    }
    case "bar": {
      const value = Math.max(0, Math.min(1, p.value));
      g.rect(p.x, p.y, p.width, p.height).fill({ color: p.background });
      if (value > 0) g.rect(p.x, p.y, p.width * value, p.height).fill({ color: p.fill });
      break;
    }
  }
  g.alpha = p.alpha ?? 1;
}

function drawText(t: Text, p: Extract<Primitive, { kind: "text" }>): void {
  const scale = p.size / TEXT_RASTER_SIZE;
  t.text = p.text;
  t.style = {
    fontFamily: "system-ui, sans-serif",
    fontSize: TEXT_RASTER_SIZE,
    fill: p.color,
    ...(p.stroke ? { stroke: { color: p.stroke.color, width: p.stroke.width / scale, alpha: p.stroke.alpha ?? 1 } } : {}),
  };
  t.anchor.set(p.align === "left" ? 0 : p.align === "right" ? 1 : 0.5, 0.5);
  t.scale.set(scale);
  t.position.set(p.x, p.y);
  t.alpha = p.alpha ?? 1;
}

function createNode(p: Primitive): Node {
  if (p.kind === "text") {
    const t = new Text({ text: p.text });
    drawText(t, p);
    return t;
  }
  const g = new Graphics();
  drawGraphics(g, p);
  return g;
}

function updateNode(node: Node, p: Primitive): void {
  if (p.kind === "text") drawText(node as Text, p);
  else drawGraphics(node as Graphics, p);
}

function fit(scene: Pick<Scene, "width" | "height"> | undefined, width: number, height: number): Viewport {
  if (!scene || scene.width <= 0 || scene.height <= 0) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(width / scene.width, height / scene.height);
  return { x: (width - scene.width * scale) / 2, y: (height - scene.height * scale) / 2, scale };
}

/** 渲染全部按需进行：停掉 Pixi 的全局 ticker，避免空转。 */
function stopTickers(): void {
  for (const ticker of [Ticker.shared, Ticker.system]) {
    ticker.autoStart = false;
    ticker.stop();
  }
}

export async function createSceneView(options: SceneViewOptions): Promise<SceneView> {
  stopTickers();
  let width = options.width;
  let height = options.height;
  const renderer: SceneRenderer =
    options.renderer ??
    (await autoDetectRenderer({
      width,
      height,
      resolution: options.resolution ?? globalThis.devicePixelRatio ?? 1,
      autoDensity: true,
      antialias: true,
      preference: "webgl",
    }));
  const schedule = options.schedule ?? ((frame: () => void) => requestAnimationFrame(frame));

  const stage = new Container();
  const world = new Container({ sortableChildren: true });
  stage.addChild(world);

  const entries = new Map<string, Entry>();
  let current: Scene | undefined;
  let manualViewport: Viewport | undefined;
  let viewport: Viewport = fit(undefined, width, height);
  let pending = false;
  let destroyed = false;

  const frame = () => {
    pending = false;
    if (destroyed) return;
    renderer.render({ container: stage });
  };
  const requestRender = () => {
    if (pending || destroyed) return;
    pending = true;
    schedule(frame);
  };

  const applyViewport = () => {
    const next = manualViewport ?? fit(current, width, height);
    const changed = next.x !== viewport.x || next.y !== viewport.y || next.scale !== viewport.scale;
    viewport = next;
    world.position.set(viewport.x, viewport.y);
    world.scale.set(viewport.scale);
    return changed;
  };

  /** 把 Scene 同步进显示树；返回是否有任何可见变化。 */
  const sync = (scene: Scene): boolean => {
    let changed = false;
    const seen = new Set<string>();
    for (const primitive of scene.primitives) {
      seen.add(primitive.key);
      const entry = entries.get(primitive.key);
      if (!entry || (entry.primitive.kind === "text") !== (primitive.kind === "text")) {
        if (entry) entry.node.destroy();
        const node = createNode(primitive);
        node.zIndex = primitive.layer;
        world.addChild(node);
        entries.set(primitive.key, { primitive, node });
        changed = true;
        continue;
      }
      if (!samePrimitive(entry.primitive, primitive)) {
        updateNode(entry.node, primitive);
        entry.node.zIndex = primitive.layer;
        changed = true;
      }
      entry.primitive = primitive;
    }
    for (const [key, entry] of entries) {
      if (seen.has(key)) continue;
      world.removeChild(entry.node);
      entry.node.destroy();
      entries.delete(key);
      changed = true;
    }
    return changed;
  };

  stage.position.set(0, 0);
  applyViewport();

  return {
    canvas: renderer.canvas as HTMLCanvasElement,
    get viewport() {
      return viewport;
    },
    show(scene) {
      if (destroyed || scene === current) return;
      const previous = current;
      current = scene;
      let changed = sync(scene);
      if (!previous || previous.background !== scene.background) {
        renderer.background.color = scene.background;
        changed = true;
      }
      if (applyViewport()) changed = true;
      if (!previous) changed = true;
      if (changed) requestRender();
    },
    requestRender,
    resize(nextWidth, nextHeight) {
      if (destroyed || (nextWidth === width && nextHeight === height)) return;
      width = nextWidth;
      height = nextHeight;
      renderer.resize(width, height);
      applyViewport();
      requestRender();
    },
    setViewport(next) {
      manualViewport = next;
      if (applyViewport()) requestRender();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stage.destroy({ children: true });
      entries.clear();
      renderer.destroy();
    },
  };
}
