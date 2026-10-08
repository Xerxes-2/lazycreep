/**
 * Pixi 适配层：把 Scene 画到画布上。与 Scene 的来源无关（Room View、World Map 都用它）。
 *
 * - 按图元 key 复用显示对象：key 相同且内容没变的图元不重画，消失的销毁
 * - 不用 Pixi 的 Application 与自动 ticker；只在 Scene 变化、尺寸 / 视口变化
 *   或显式 requestRender() 时安排一帧，同一帧内多次请求合并成一次 render
 */
import {
  Container,
  Graphics,
  ImageSource,
  Sprite,
  Text,
  Texture,
  Ticker,
  autoDetectRenderer,
  type Renderer,
} from "pixi.js";
import { withPixelImages } from "./pixel-textures.ts";
import type { ImagePrimitive, Primitive, Scene, Stroke } from "./scene.ts";

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
  /** image 图元的纹理加载与卸载，默认 fetch + createImageBitmap；像素图（pixel-image.ts）总是就地解码，不经它 */
  readonly textures?: TextureLoader;
  /** 没有图元在用的纹理最多留多少张，超出时先卸载最早闲置的；默认 512 */
  readonly textureCacheSize?: number;
}

export interface TextureLoader {
  load(url: string): Promise<Texture>;
  unload(url: string): void;
}

/**
 * 默认的纹理加载：fetch → createImageBitmap → Texture，每个视图各一份。
 * 不用 Pixi 的 Assets：实测它在本适配层下（全局 ticker 已停）的加载永远不完成。
 */
function fetchTextures(): TextureLoader {
  const loaded = new Map<string, Texture>();
  return {
    async load(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}：HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const texture = new Texture({ source: new ImageSource({ resource: bitmap }) });
      loaded.set(url, texture);
      return texture;
    },
    unload(url) {
      const texture = loaded.get(url);
      loaded.delete(url);
      texture?.destroy(true);
    },
  };
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

type Node = Graphics | Text | Sprite;
type NodeKind = "graphics" | "text" | "image";

function nodeKind(p: Primitive): NodeKind {
  return p.kind === "text" ? "text" : p.kind === "image" ? "image" : "graphics";
}

interface Entry {
  primitive: Primitive;
  node: Node;
}

/**
 * image 图元的纹理：按 url 共享，加载完成后贴到所有在用的 Sprite 上并请求一帧。
 * 没有 Sprite 在用的纹理先闲置，闲置数超过上限时卸载最早闲置的。
 */
function createTextureCache(loader: TextureLoader, limit: number, onLoaded: () => void) {
  interface Slot {
    texture: Texture | undefined;
    readonly users: Map<Sprite, ImagePrimitive>;
  }
  const slots = new Map<string, Slot>();
  /** 插入顺序即闲置先后 */
  const idle = new Set<string>();
  let closed = false;

  const paint = (sprite: Sprite, p: ImagePrimitive, texture: Texture | undefined) => {
    sprite.texture = texture ?? Texture.EMPTY;
    sprite.visible = texture !== undefined;
    sprite.position.set(p.x, p.y);
    sprite.setSize(p.width, p.height);
    sprite.alpha = p.alpha ?? 1;
    sprite.blendMode = p.blend ?? "normal";
  };

  const evict = () => {
    for (const url of idle) {
      if (idle.size <= limit) break;
      idle.delete(url);
      const slot = slots.get(url);
      slots.delete(url);
      if (slot?.texture) loader.unload(url);
    }
  };

  const slotFor = (url: string): Slot => {
    const existing = slots.get(url);
    if (existing) return existing;
    const slot: Slot = { texture: undefined, users: new Map() };
    slots.set(url, slot);
    loader.load(url).then(
      (texture) => {
        if (closed || slots.get(url) !== slot) {
          // 加载期间已被淘汰或视图已销毁
          loader.unload(url);
          return;
        }
        slot.texture = texture;
        for (const [sprite, p] of slot.users) paint(sprite, p, texture);
        if (slot.users.size > 0) onLoaded();
      },
      () => {
        // 加载失败（例如 403 的非块角瓦片）：保持空白，不重试
      },
    );
    return slot;
  };

  return {
    /** 让 sprite 显示 p；url 变了就换纹理。 */
    attach(sprite: Sprite, p: ImagePrimitive, previous?: ImagePrimitive) {
      if (previous && previous.url !== p.url) this.detach(sprite, previous.url);
      const slot = slotFor(p.url);
      idle.delete(p.url);
      slot.users.set(sprite, p);
      paint(sprite, p, slot.texture);
    },
    detach(sprite: Sprite, url: string) {
      const slot = slots.get(url);
      if (!slot) return;
      slot.users.delete(sprite);
      if (slot.users.size === 0) {
        idle.add(url);
        evict();
      }
    },
    close() {
      closed = true;
      for (const [url, slot] of slots) if (slot.texture) loader.unload(url);
      slots.clear();
      idle.clear();
    },
  };
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

function drawGraphics(g: Graphics, p: Exclude<Primitive, { kind: "text" | "image" }>): void {
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

/** image 图元的显示对象由纹理缓存负责，这里只管 Graphics 与 Text。 */
function createNode(p: Exclude<Primitive, ImagePrimitive>): Node {
  if (p.kind === "text") {
    const t = new Text({ text: p.text });
    drawText(t, p);
    return t;
  }
  const g = new Graphics();
  drawGraphics(g, p);
  return g;
}

function updateNode(node: Node, p: Exclude<Primitive, ImagePrimitive>): void {
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

  const textures = createTextureCache(
    withPixelImages(options.textures ?? fetchTextures()),
    options.textureCacheSize ?? 512,
    () => requestRender(),
  );

  const make = (p: Primitive): Node => {
    if (p.kind !== "image") return createNode(p);
    const sprite = new Sprite();
    textures.attach(sprite, p);
    return sprite;
  };
  const update = (node: Node, p: Primitive, previous: Primitive) => {
    if (p.kind === "image") textures.attach(node as Sprite, p, previous as ImagePrimitive);
    else updateNode(node, p);
  };
  const drop = (entry: Entry) => {
    if (entry.primitive.kind === "image") textures.detach(entry.node as Sprite, entry.primitive.url);
    world.removeChild(entry.node);
    entry.node.destroy();
  };

  /** 把 Scene 同步进显示树；返回是否有任何可见变化。 */
  const sync = (scene: Scene): boolean => {
    let changed = false;
    const seen = new Set<string>();
    for (const primitive of scene.primitives) {
      seen.add(primitive.key);
      const entry = entries.get(primitive.key);
      if (!entry || nodeKind(entry.primitive) !== nodeKind(primitive)) {
        if (entry) drop(entry);
        const node = make(primitive);
        node.zIndex = primitive.layer;
        world.addChild(node);
        entries.set(primitive.key, { primitive, node });
        changed = true;
        continue;
      }
      if (!samePrimitive(entry.primitive, primitive)) {
        update(entry.node, primitive, entry.primitive);
        entry.node.zIndex = primitive.layer;
        changed = true;
      }
      entry.primitive = primitive;
    }
    for (const [key, entry] of entries) {
      if (seen.has(key)) continue;
      drop(entry);
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
      textures.close();
      renderer.destroy();
    },
  };
}
