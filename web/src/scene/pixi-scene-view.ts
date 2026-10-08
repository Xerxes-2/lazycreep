/**
 * Pixi 适配层：把 Scene 画到画布上。与 Scene 的来源无关（Room View、World Map 都用它）。
 *
 * - 按图元 key 复用显示对象：key 相同且内容没变的图元不重画，消失的销毁
 * - 不用 Pixi 的 Application 与自动 ticker；只在 Scene 变化、尺寸 / 视口变化
 *   或显式 requestRender() 时安排一帧，同一帧内多次请求合并成一次 render
 * - 有界动画（ADR 0008）：带新动画描述的图元在 show() 时记下开始时刻、放进“进行中”集合；集合非空时
 *   每帧只插值这些显示对象（不重新比较整份 Scene），全部到期后停止请求帧。新 Scene 里描述变了或没了的
 *   动画先跳到终态；settle() 让所有动画立即跳到终态且不请求帧（Room View 隐藏时）
 */
import { Container, Graphics, Sprite, Text, Texture, Ticker, autoDetectRenderer, type Renderer } from "pixi.js";
import { withCompositeImages } from "./composite-textures.ts";
import { withPixelImages } from "./pixel-textures.ts";
import { animationDuration, finalValue, sameAnimation, tweenValue } from "./animation.ts";
import type { AnimatedProperty, ImagePrimitive, Primitive, Scene, Stroke } from "./scene.ts";
import { defaultTextures, rasterPixelsPerUnit, rasterSize, type SvgRasterCache, type TextureLoader, type TextureSize } from "./texture-sources.ts";


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
  /** 动画用的时钟（毫秒），默认 performance.now */
  readonly now?: () => number;
  /**
   * image 图元的纹理加载与卸载；默认见 texture-sources.ts 的 defaultTextures（SVG 栅格化、位图按需加载）。
   * 像素图（pixel-image.ts）总是就地解码，不经它
   */
  readonly textures?: TextureLoader;
  /** 默认纹理加载用的 SVG 栅格化缓存；默认全页共享的一份 */
  readonly svgRasters?: SvgRasterCache;
  /** 没有图元在用的纹理最多留多少张，超出时先卸载最早闲置的；默认 512 */
  readonly textureCacheSize?: number;
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
  /** 进行中的动画立即跳到终态，不请求帧（画面不在屏幕上时）；下一次 show() 时补画一帧终态 */
  settle(): void;
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

/** 进行中的动画 */
interface Run {
  readonly entry: Entry;
  readonly start: number;
  readonly duration: number;
}

/**
 * image 图元的纹理：按 url 共享，加载完成后贴到所有在用的 Sprite 上并请求一帧。
 * 没有 Sprite 在用的纹理先闲置，闲置数超过上限时卸载最早闲置的。
 *
 * 可缩放的贴图（loader.scalable）按“用到它的最大图元 × 当前每单位像素”请求，档位见 texture-sources.ts；
 * 图元变大或放大越过档位时再请求一次更大的（同一 url 同时只有一个请求在途），新纹理就绪前仍显示旧的。
 */
function createTextureCache(loader: TextureLoader, limit: number, pixelsPerUnit: () => number, onLoaded: () => void) {
  interface Slot {
    texture: Texture | undefined;
    readonly users: Map<Sprite, ImagePrimitive>;
    /** 用到它的图元里最大的世界尺寸（只增不减） */
    extentW: number;
    extentH: number;
    /** 已请求（含在途）的像素尺寸 */
    requested: TextureSize | undefined;
    loading: boolean;
  }
  const slots = new Map<string, Slot>();
  /** 插入顺序即闲置先后 */
  const idle = new Set<string>();
  let closed = false;

  const paint = (sprite: Sprite, p: ImagePrimitive, texture: Texture | undefined) => {
    sprite.texture = texture ?? Texture.EMPTY;
    sprite.visible = texture !== undefined;
    // 锚点放在旋转中心：未旋转时与“左上角在 (x, y)”的摆法完全一样
    const pivotX = p.pivotX ?? p.x + p.width / 2;
    const pivotY = p.pivotY ?? p.y + p.height / 2;
    sprite.anchor.set(p.width ? (pivotX - p.x) / p.width : 0, p.height ? (pivotY - p.y) / p.height : 0);
    sprite.position.set(pivotX, pivotY);
    sprite.setSize(p.width, p.height);
    sprite.rotation = p.rotation ?? 0;
    sprite.tint = p.tint ?? 0xffffff;
    sprite.alpha = p.alpha ?? 1;
    sprite.blendMode = p.blend ?? "normal";
  };

  const evict = () => {
    for (const url of idle) {
      if (idle.size <= limit) break;
      idle.delete(url);
      const slot = slots.get(url);
      slots.delete(url);
      if (slot?.texture || slot?.loading) loader.unload(url);
    }
  };

  /** 需要时（第一次、或可缩放且越过档位）发起加载 */
  const request = (url: string, slot: Slot) => {
    if (closed || slot.loading) return;
    const size = rasterSize(slot.extentW, slot.extentH, pixelsPerUnit());
    const previous = slot.requested;
    if (previous && !(loader.scalable?.(url) && (size.width > previous.width || size.height > previous.height))) return;
    slot.requested = previous ? { width: Math.max(size.width, previous.width), height: Math.max(size.height, previous.height) } : size;
    slot.loading = true;
    loader.load(url, slot.requested).then(
      (texture) => {
        slot.loading = false;
        if (closed || slots.get(url) !== slot) {
          // 加载期间已被淘汰或视图已销毁
          loader.unload(url);
          return;
        }
        slot.texture = texture;
        for (const [sprite, p] of slot.users) paint(sprite, p, texture);
        if (slot.users.size > 0) onLoaded();
        // 在途期间又需要更大的
        request(url, slot);
      },
      () => {
        // 加载失败（例如 403 的非块角瓦片）：保持原样（空白或旧纹理），不重试
        slot.loading = false;
      },
    );
  };

  const slotFor = (p: ImagePrimitive): Slot => {
    const existing = slots.get(p.url);
    if (existing) return existing;
    const slot: Slot = { texture: undefined, users: new Map(), extentW: 0, extentH: 0, requested: undefined, loading: false };
    slots.set(p.url, slot);
    return slot;
  };

  return {
    /** 让 sprite 显示 p；url 变了就换纹理。 */
    attach(sprite: Sprite, p: ImagePrimitive, previous?: ImagePrimitive) {
      if (previous && previous.url !== p.url) this.detach(sprite, previous.url);
      const slot = slotFor(p);
      idle.delete(p.url);
      slot.users.set(sprite, p);
      slot.extentW = Math.max(slot.extentW, Math.abs(p.width));
      slot.extentH = Math.max(slot.extentH, Math.abs(p.height));
      request(p.url, slot);
      paint(sprite, p, slot.texture);
    },
    detach(sprite: Sprite, url: string) {
      const slot = slots.get(url);
      if (!slot) return;
      slot.users.delete(sprite);
      if (slot.users.size === 0 && loader.transient?.(url)) {
        slots.delete(url);
        if (slot.texture || slot.loading) loader.unload(url);
      } else if (slot.users.size === 0) {
        idle.add(url);
        evict();
      }
    },
    /** 缩放变了：在用的可缩放贴图需要时升档 */
    rescale() {
      for (const [url, slot] of slots) if (slot.users.size > 0) request(url, slot);
    },
    close() {
      closed = true;
      for (const [url, slot] of slots) if (slot.texture || slot.loading) loader.unload(url);
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

/** 图元内容是否相同（按字段比较，points、stroke 与动画描述逐项比较）。 */
export function samePrimitive(a: Primitive, b: Primitive, options: { readonly ignoreAnimation?: boolean } = {}): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (options.ignoreAnimation) keys.delete("animation");
  for (const key of keys) {
    const x = (a as unknown as Record<string, unknown>)[key];
    const y = (b as unknown as Record<string, unknown>)[key];
    if (x === y) continue;
    if (key === "points") {
      if (!samePoints(x as readonly number[], y as readonly number[])) return false;
    } else if (key === "animation") {
      if (!sameAnimation(a.animation, b.animation)) return false;
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
      const points = p.trimStart === undefined && p.trimEnd === undefined ? p.points : trimPolyline(p.points, p.trimStart ?? 0, p.trimEnd ?? 1);
      if (points.length < 4) break;
      const [x0 = 0, y0 = 0, ...rest] = points;
      g.moveTo(x0, y0);
      for (let i = 0; i + 1 < rest.length; i += 2) g.lineTo(rest[i]!, rest[i + 1]!);
      g.stroke(strokeStyle(p.stroke));
      break;
    }
  }
  g.alpha = p.alpha ?? 1;
  g.blendMode = p.blend ?? "normal";
}

/** 折线按长度取 [from, to]（0–1）这一段；为空时返回空数组 */
function trimPolyline(points: readonly number[], from: number, to: number): number[] {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const length = Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
    lengths.push(length);
    total += length;
  }
  const start = Math.max(0, Math.min(1, from)) * total;
  const end = Math.max(0, Math.min(1, to)) * total;
  if (!(end > start)) return [];
  const out: number[] = [];
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    const a = Math.max(start, walked);
    const b = Math.min(end, walked + length);
    if (b >= a && length > 0) {
      const x0 = points[2 * i]!, y0 = points[2 * i + 1]!, x1 = points[2 * i + 2]!, y1 = points[2 * i + 3]!;
      const at = (d: number) => [x0 + ((x1 - x0) * (d - walked)) / length, y0 + ((y1 - y0) * (d - walked)) / length] as const;
      if (out.length === 0) out.push(...at(a));
      out.push(...at(b));
    }
    walked += length;
  }
  return out;
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
  t.blendMode = p.blend ?? "normal";
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
  const now = options.now ?? (() => performance.now());

  const stage = new Container();
  const world = new Container({ sortableChildren: true });
  stage.addChild(world);

  const entries = new Map<string, Entry>();
  let current: Scene | undefined;
  let manualViewport: Viewport | undefined;
  let viewport: Viewport = fit(undefined, width, height);
  let pending = false;
  let destroyed = false;
  /** 进行中的动画，按图元 key */
  const runs = new Map<string, Run>();
  /** settle() 之后画布上还是动画中途的样子，下一次 show() 要补画 */
  let stale = false;

  const frame = () => {
    pending = false;
    // settle() 之后（画面不在屏幕上）不画，等下一次 show() 或显式请求
    if (destroyed || stale) return;
    if (runs.size > 0) advance(now());
    renderer.render({ container: stage });
    // 还有动画没播完：下一帧继续
    if (runs.size > 0) requestRender();
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
    if (changed) textures.rescale();
    return changed;
  };

  const resolution = options.resolution ?? globalThis.devicePixelRatio ?? 1;
  const textures = createTextureCache(
    withCompositeImages(withPixelImages(options.textures ?? defaultTextures(options.svgRasters ? { svg: options.svgRasters } : {}))),
    options.textureCacheSize ?? 512,
    () => rasterPixelsPerUnit(viewport.scale, resolution, width, height),
    () => requestRender(),
  );

  const make = (p: Primitive): Node => {
    if (p.kind !== "image") return createNode(p);
    const sprite = new Sprite();
    textures.attach(sprite, p);
    return sprite;
  };

  /** 把一个动画推进到开始后 elapsed 毫秒（Infinity 即终态），只改这个显示对象 */
  const applyRun = (run: Run, elapsed: number) => {
    const { primitive: p, node } = run.entry;
    const animation = p.animation;
    if (!animation) return;
    const done = elapsed >= run.duration;
    const values: Partial<Record<AnimatedProperty, number>> = {};
    for (const tween of animation.tweens) {
      const final = finalValue(p, tween.property);
      values[tween.property] = done ? final : tweenValue(tween, final, elapsed);
    }
    if (p.kind === "line" && (values.trimStart !== undefined || values.trimEnd !== undefined)) {
      drawGraphics(node as Graphics, { ...p, trimStart: values.trimStart ?? p.trimStart ?? 0, trimEnd: values.trimEnd ?? p.trimEnd ?? 1 });
    }
    if (values.alpha !== undefined) node.alpha = values.alpha;
    const { offsetX = 0, offsetY = 0, turn = 0, scale = 1 } = values;
    if (values.offsetX === undefined && values.offsetY === undefined && values.turn === undefined && values.scale === undefined) return;
    // 图元自身的摆放（显示对象的 position / rotation / scale），再叠加绕 origin 的旋转、缩放与平移
    let baseX = 0, baseY = 0, baseRotation = 0, baseScaleX = 1, baseScaleY = 1;
    if (p.kind === "text") {
      baseX = p.x;
      baseY = p.y;
      baseScaleX = baseScaleY = p.size / TEXT_RASTER_SIZE;
    } else if (p.kind === "image") {
      const sprite = node as Sprite;
      baseX = p.pivotX ?? p.x + p.width / 2;
      baseY = p.pivotY ?? p.y + p.height / 2;
      baseRotation = p.rotation ?? 0;
      sprite.setSize(p.width, p.height);
      baseScaleX = sprite.scale.x;
      baseScaleY = sprite.scale.y;
    }
    const ox = animation.originX ?? 0;
    const oy = animation.originY ?? 0;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const rx = baseX - ox;
    const ry = baseY - oy;
    node.position.set(ox + offsetX + scale * (rx * cos - ry * sin), oy + offsetY + scale * (rx * sin + ry * cos));
    node.rotation = baseRotation + turn;
    node.scale.set(baseScaleX * scale, baseScaleY * scale);
  };

  const advance = (time: number) => {
    for (const [key, run] of runs) {
      const elapsed = time - run.start;
      applyRun(run, elapsed);
      if (elapsed >= run.duration) runs.delete(key);
    }
  };

  /** 结束一个进行中的动画：显示对象回到终态 */
  const finish = (key: string) => {
    const run = runs.get(key);
    if (!run) return;
    runs.delete(key);
    applyRun(run, Infinity);
  };

  /** 图元带来了新的动画描述：从头播放（先画出起始的样子） */
  const startRun = (key: string, entry: Entry) => {
    runs.delete(key);
    const animation = entry.primitive.animation;
    if (!animation) return;
    const run: Run = { entry, start: now(), duration: animationDuration(animation) };
    if (run.duration <= 0) return;
    runs.set(key, run);
    applyRun(run, 0);
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
      const key = primitive.key;
      seen.add(key);
      const entry = entries.get(key);
      if (!entry || nodeKind(entry.primitive) !== nodeKind(primitive)) {
        if (entry) {
          runs.delete(key);
          drop(entry);
        }
        const node = make(primitive);
        node.zIndex = primitive.layer;
        node.label = key;
        world.addChild(node);
        const created = { primitive, node };
        entries.set(key, created);
        if (primitive.animation) startRun(key, created);
        changed = true;
        continue;
      }
      if (samePrimitive(entry.primitive, primitive)) {
        entry.primitive = primitive;
        continue;
      }
      changed = true;
      const previous = entry.primitive;
      const restart = !sameAnimation(previous.animation, primitive.animation);
      // 旧动画被取代或取消：先回到旧的终态，再按新图元更新
      if (restart) finish(key);
      if (!samePrimitive(previous, primitive, { ignoreAnimation: true })) {
        update(entry.node, primitive, previous);
        entry.node.zIndex = primitive.layer;
      }
      entry.primitive = primitive;
      if (restart) startRun(key, entry);
      else {
        // 同一个动画继续播，但图元的终态变了：按当前进度重新叠加
        const run = runs.get(key);
        if (run) applyRun(run, now() - run.start);
      }
    }
    for (const [key, entry] of entries) {
      if (seen.has(key)) continue;
      runs.delete(key);
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
      // 先定视口（自动适配取决于 Scene）：新图元按这一帧的缩放请求纹理
      let changed = applyViewport();
      if (sync(scene)) changed = true;
      if (!previous || previous.background !== scene.background) {
        renderer.background.color = scene.background;
        changed = true;
      }
      if (!previous) changed = true;
      if (stale) {
        stale = false;
        changed = true;
      }
      if (changed) requestRender();
    },
    requestRender() {
      stale = false;
      requestRender();
    },
    settle() {
      if (runs.size === 0) return;
      for (const key of [...runs.keys()]) finish(key);
      stale = true;
    },
    resize(nextWidth, nextHeight) {
      if (destroyed || (nextWidth === width && nextHeight === height)) return;
      width = nextWidth;
      height = nextHeight;
      renderer.resize(width, height);
      // 尺寸变了，最大缩放也跟着变
      if (!applyViewport()) textures.rescale();
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
      runs.clear();
      textures.close();
      renderer.destroy();
    },
  };
}
