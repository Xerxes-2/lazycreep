/**
 * Pixi 适配层的烟雾测试。jsdom 没有 WebGL，也没有真正的 2D canvas（getContext 返回 null），
 * 所以这里给 HTMLCanvasElement 装一个“什么都接受”的假 2D context：Pixi 的探测会跳过
 * WebGL / WebGPU、落到它自带的 Canvas 渲染器，整条渲染管线（显示树、Graphics 构建、
 * 文字测量、逐对象绘制调用）都真实走一遍，只是像素不落地。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDetectRenderer, Texture } from "pixi.js";
import type { Scene } from "./scene.ts";
import { createSceneView, type SceneRenderer, type SceneView } from "./pixi-scene-view.ts";

function fake2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => undefined;
  const special: Record<string | symbol, unknown> = {
    canvas,
    measureText: (text: string) => ({
      width: text.length * 10,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 10,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    getTransform: () => new DOMMatrix(),
    getContextAttributes: () => ({ alpha: true }),
    isPointInPath: () => false,
  };
  const store: Record<string | symbol, unknown> = {};
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_, key) => (key in special ? special[key] : key in store ? store[key] : noop),
    set: (_, key, value) => {
      store[key] = value;
      return true;
    },
    has: () => true,
  });
}

const scene: Scene = {
  width: 50,
  height: 50,
  background: 0x202020,
  primitives: [
    { key: "t", kind: "rect", layer: 0, x: 0, y: 0, width: 3, height: 1, fill: 0x111111 },
    { key: "r", kind: "rect", layer: 20, x: 5, y: 5, width: 1, height: 1, radius: 0.2, fill: 0x333333, stroke: { color: 0xffffff, width: 0.05 } },
    { key: "c", kind: "circle", layer: 30, objectId: "creep1", x: 10.5, y: 10.5, radius: 0.4, fill: 0x5d9cec },
    { key: "l", kind: "line", layer: 100, points: [1, 1, 5, 5, 9, 1], stroke: { color: 0xff0000, width: 0.1, alpha: 0.5 } },
    { key: "p", kind: "polygon", layer: 20, points: [20, 20, 21, 20, 20.5, 21], fill: 0x00ff00 },
    { key: "x", kind: "text", layer: 60, x: 25, y: 25, text: "8", size: 0.5, color: 0xffffff, stroke: { color: 0, width: 0.04 } },
    { key: "b", kind: "bar", layer: 50, objectId: "creep1", x: 10.1, y: 10.8, width: 0.8, height: 0.12, value: 0.25, fill: 0x00ff00, background: 0 },
  ],
};

/** 手动推进的帧调度：测试决定什么时候“到下一帧”。 */
function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    schedule: (frame: () => void) => void queue.push(frame),
    flush: () => {
      for (const frame of queue.splice(0)) frame();
    },
    get pending() {
      return queue.length;
    },
  };
}

let views: SceneView[] = [];

beforeEach(() => {
  // Pixi 用它的原型探测 letterSpacing 支持；jsdom 没有这个全局
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, id: string) {
    return id === "2d" ? fake2dContext(this) : null;
  } as unknown as HTMLCanvasElement["getContext"]);
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function canvasRenderer(): Promise<SceneRenderer> {
  return autoDetectRenderer({ width: 400, height: 300, preference: "canvas" });
}

describe("Pixi 适配层", () => {
  it("在 jsdom 下初始化并渲染一帧不抛错", async () => {
    const frames = manualFrames();
    const view = await createSceneView({ width: 400, height: 300, resolution: 1, schedule: frames.schedule });
    views.push(view);
    expect(view.canvas).toBeInstanceOf(HTMLCanvasElement);

    view.show(scene);
    expect(() => frames.flush()).not.toThrow();
    // 自动适配：50×50 的 Scene 放进 400×300，居中
    expect(view.viewport).toEqual({ x: 50, y: 0, scale: 6 });
  });

  describe("只在需要时渲染", () => {
    async function counted() {
      const frames = manualFrames();
      const renderer = await canvasRenderer();
      const render = vi.spyOn(renderer, "render");
      const view = await createSceneView({ width: 400, height: 300, renderer, schedule: frames.schedule });
      views.push(view);
      const step = () => {
        frames.flush();
        return render.mock.calls.length;
      };
      return { view, frames, step };
    }

    it("第一个 Scene 渲染一次；没有新 Scene 时不再渲染", async () => {
      const { view, frames, step } = await counted();
      expect(step()).toBe(0);
      view.show(scene);
      expect(step()).toBe(1);
      expect(step()).toBe(1);
      view.show(scene);
      expect(frames.pending).toBe(0);
      expect(step()).toBe(1);
    });

    it("内容相同的新 Scene 对象不触发渲染", async () => {
      const { view, step } = await counted();
      view.show(scene);
      step();
      view.show(structuredClone(scene));
      expect(step()).toBe(1);
    });

    it("图元变化、增加或消失时渲染；同一帧内多次变化合并成一次", async () => {
      const { view, step } = await counted();
      view.show(scene);
      step();

      const [first, ...rest] = scene.primitives;
      view.show({ ...scene, primitives: [{ ...first!, x: 1 } as typeof first & {}, ...rest] });
      view.show({ ...scene, primitives: rest });
      view.show({ ...scene, primitives: [...rest, { key: "new", kind: "circle", layer: 1, x: 1, y: 1, radius: 1 }] });
      expect(step()).toBe(2);
    });

    it("显式请求、改尺寸、改视口时渲染", async () => {
      const { view, step } = await counted();
      view.show(scene);
      step();
      view.requestRender();
      view.requestRender();
      expect(step()).toBe(2);
      view.resize(200, 200);
      expect(step()).toBe(3);
      view.setViewport({ x: 0, y: 0, scale: 10 });
      expect(step()).toBe(4);
      view.setViewport({ x: 0, y: 0, scale: 10 });
      expect(step()).toBe(4);
    });

    describe("image 图元", () => {
      const tile = (key: string, url: string, x = 0): Scene["primitives"][number] => ({
        key,
        kind: "image",
        layer: 0,
        x,
        y: 0,
        width: 1,
        height: 1,
        url,
      });

      /** 手动兑现的纹理加载：测试决定每个 url 何时加载完成或失败。 */
      function manualTextures() {
        const pending = new Map<string, { resolve: (t: Texture) => void; reject: (e: Error) => void }>();
        const loads: string[] = [];
        const unloads: string[] = [];
        return {
          loads,
          unloads,
          textures: {
            load: (url: string) => {
              loads.push(url);
              return new Promise<Texture>((resolve, reject) => pending.set(url, { resolve, reject }));
            },
            unload: (url: string) => void unloads.push(url),
          },
          async resolve(url: string) {
            pending.get(url)!.resolve(Texture.WHITE);
            await Promise.resolve();
          },
          async reject(url: string) {
            pending.get(url)!.reject(new Error("403"));
            await Promise.resolve();
          },
        };
      }

      async function withTextures(cacheSize?: number) {
        const frames = manualFrames();
        const renderer = await canvasRenderer();
        const render = vi.spyOn(renderer, "render");
        const textures = manualTextures();
        const view = await createSceneView({
          width: 400,
          height: 300,
          renderer,
          schedule: frames.schedule,
          textures: textures.textures,
          ...(cacheSize === undefined ? {} : { textureCacheSize: cacheSize }),
        });
        views.push(view);
        const step = () => {
          frames.flush();
          return render.mock.calls.length;
        };
        return { view, step, textures };
      }

      const imageScene = (...primitives: Scene["primitives"]): Scene => ({ ...scene, primitives });

      it("纹理加载完成后再渲染一次；同一 url 只加载一次", async () => {
        const { view, step, textures } = await withTextures();
        view.show(imageScene(tile("a", "/t/a.png"), tile("b", "/t/a.png", 1)));
        expect(step()).toBe(1);
        expect(textures.loads).toEqual(["/t/a.png"]);
        await textures.resolve("/t/a.png");
        expect(step()).toBe(2);
        expect(step()).toBe(2);
      });

      it("加载失败不抛错，也不触发渲染", async () => {
        const { view, step, textures } = await withTextures();
        view.show(imageScene(tile("a", "/t/missing.png")));
        expect(step()).toBe(1);
        await textures.reject("/t/missing.png");
        expect(step()).toBe(1);
      });

      it("图元消失时纹理留在缓存里，回来时不重新加载；超出缓存上限的闲置纹理被卸载", async () => {
        const { view, step, textures } = await withTextures(1);
        view.show(imageScene(tile("a", "/t/a.png")));
        await textures.resolve("/t/a.png");
        view.show(imageScene(tile("b", "/t/b.png")));
        await textures.resolve("/t/b.png");
        view.show(imageScene(tile("a", "/t/a.png")));
        step();
        expect(textures.loads).toEqual(["/t/a.png", "/t/b.png"]);
        expect(textures.unloads).toEqual([]);
        view.show(imageScene(tile("c", "/t/c.png")));
        await textures.resolve("/t/c.png");
        // 闲置的 a、b 超出上限 1：最早闲置的 b 被卸载
        expect(textures.unloads).toEqual(["/t/b.png"]);
      });
    });

    it("销毁后不再渲染", async () => {
      const { view, step } = await counted();
      view.show(scene);
      view.destroy();
      expect(step()).toBe(0);
      views = [];
    });
  });
});
