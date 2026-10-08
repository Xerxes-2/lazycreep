/**
 * Pixi 适配层的烟雾测试。jsdom 没有 WebGL，也没有真正的 2D canvas（getContext 返回 null），
 * 所以这里给 HTMLCanvasElement 装一个“什么都接受”的假 2D context：Pixi 的探测会跳过
 * WebGL / WebGPU、落到它自带的 Canvas 渲染器，整条渲染管线（显示树、Graphics 构建、
 * 文字测量、逐对象绘制调用）都真实走一遍，只是像素不落地。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDetectRenderer, Graphics, Texture, type Container } from "pixi.js";
import type { ImagePrimitive, Primitive, PrimitiveAnimation, Scene } from "./scene.ts";
import { createSceneView, type SceneRenderer, type SceneView } from "./pixi-scene-view.ts";
import { encodePixelImage } from "./pixel-image.ts";
import { createSvgRasterCache, type SvgRasterCache } from "./texture-sources.ts";

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

      it("像素图就地解码成纹理、不经纹理加载器，以加色混合画出；淘汰时也不经加载器卸载", async () => {
        const { view, step, textures } = await withTextures(0);
        const rgba = new Uint8Array(2 * 2 * 4);
        rgba.set([255, 242, 70, 255], 0);
        const first = encodePixelImage({ width: 2, height: 2, rgba });
        rgba.set([255, 150, 0, 255], 12);
        const second = encodePixelImage({ width: 2, height: 2, rgba });
        const units = (url: string): ImagePrimitive => ({ ...(tile("u", url) as ImagePrimitive), blend: "add" });

        view.show(imageScene(tile("t", "/t/a.png"), units(first)));
        expect(step()).toBe(1);
        await Promise.resolve();
        expect(step()).toBe(2);
        view.show(imageScene(tile("t", "/t/a.png"), units(second)));
        await Promise.resolve();
        expect(step()).toBe(3);
        expect(textures.loads).toEqual(["/t/a.png"]);
        expect(textures.unloads).toEqual([]);
      });

      it("transient 的贴图（#46 的合成贴图）没有图元在用就立即卸载，不闲置", async () => {
        const frames = manualFrames();
        const textures = manualTextures();
        const view = await createSceneView({
          width: 400,
          height: 300,
          renderer: await canvasRenderer(),
          schedule: frames.schedule,
          textures: { ...textures.textures, transient: (url: string) => url.startsWith("/big/") },
        });
        views.push(view);
        view.show(imageScene(tile("t", "/big/W1N1"), tile("s", "/t/a.png", 1)));
        await textures.resolve("/big/W1N1");
        await textures.resolve("/t/a.png");
        view.show(imageScene(tile("t", "/big/W2N2")));
        expect(textures.unloads).toEqual(["/big/W1N1"]);
        // 回到原来的贴图要重新加载
        view.show(imageScene(tile("t", "/big/W1N1")));
        expect(textures.loads).toEqual(["/big/W1N1", "/t/a.png", "/big/W2N2", "/big/W1N1"]);
      });

      describe("可缩放的大贴图（房间级合成贴图）的档位", () => {
        const room = (url = "/big/W1N1"): ImagePrimitive => ({ key: "terrain", kind: "image", layer: 0, x: 0, y: 0, width: 50, height: 50, url });

        async function tiers(width: number, height: number, resolution: number) {
          const frames = manualFrames();
          const sizes: number[] = [];
          const view = await createSceneView({
            width,
            height,
            resolution,
            renderer: await canvasRenderer(),
            schedule: frames.schedule,
            textures: {
              load: async (_url: string, size?: { width: number; height: number }) => (sizes.push(size!.width), Texture.WHITE),
              unload: () => undefined,
              scalable: () => true,
            },
          });
          views.push(view);
          view.show(imageScene(room()));
          await new Promise((r) => setTimeout(r, 0));
          return { view, sizes, frames };
        }

        it("整房间铺满画布时：档位随画布尺寸与像素比（上限 2）变化", async () => {
          // 手机竖屏 390×700、像素比 3：每格 7.8 × 2 → 780 → 1024
          expect((await tiers(390, 700, 3)).sizes).toEqual([1024]);
          // 小窗口 400×300、像素比 1：每格 6 → 300 → 512
          expect((await tiers(400, 300, 1)).sizes).toEqual([512]);
          // 桌面 1600×1000、像素比 2：每格 20 × 2 → 2000 → 2048（上限）
          expect((await tiers(1600, 1000, 2)).sizes).toEqual([2048]);
        });

        it("放大越过档位才重新合成，同档位内缩放不重新合成", async () => {
          const { view, sizes, frames } = await tiers(400, 300, 1);
          for (const scale of [6.5, 7, 9, 10.2, 12, 20, 40, 80]) {
            view.setViewport({ x: 0, y: 0, scale });
            frames.flush();
            await new Promise((r) => setTimeout(r, 0));
          }
          // 6 → 512；10.24 以上 → 1024；20.48 以上 → 2048（上限；相机最大每格 75）
          expect(sizes).toEqual([512, 1024, 2048]);
        });
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

    describe("SVG 贴图（#42）", () => {
      const imageScene = (...primitives: Scene["primitives"]): Scene => ({ ...scene, primitives });
      const tile = (key: string, url: string): Scene["primitives"][number] => ({ key, kind: "image", layer: 0, x: 0, y: 0, width: 1, height: 1, url });
      const sprite = (key: string, x: number, extra: Partial<Extract<Scene["primitives"][number], { kind: "image" }>> = {}) =>
        ({ key, kind: "image", layer: 20, x, y: 0, width: 2, height: 2, url: "/official-art/storage.svg", ...extra }) as const;

      /** 记录栅格化调用的假栅格化：立即给出一块画布 */
      function countingRasterizer() {
        const calls: [string, number, number][] = [];
        const rasterize = async (url: string, width: number, height: number) => {
          calls.push([url, width, height]);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          return canvas;
        };
        return { calls, cache: createSvgRasterCache(rasterize) };
      }

      async function svgView(cache: SvgRasterCache, cacheSize?: number) {
        const frames = manualFrames();
        const renderer = await canvasRenderer();
        const render = vi.spyOn(renderer, "render");
        const view = await createSceneView({
          width: 400,
          height: 300,
          resolution: 3,
          renderer,
          schedule: frames.schedule,
          svgRasters: cache,
          ...(cacheSize === undefined ? {} : { textureCacheSize: cacheSize }),
        });
        views.push(view);
        const settleFrames = async () => {
          await vi.waitFor(() => expect(frames.pending).toBeGreaterThan(0));
          frames.flush();
        };
        return { view, frames, render, settleFrames };
      }

      /** 画布 400×300、像素比 3（按 2 算）：相机最多放大到短边 4 格，即每格 75 CSS 像素、150 设备像素 */
      const zoomTo = async (view: SceneView, scale: number, frames: ReturnType<typeof manualFrames>) => {
        view.setViewport({ x: 0, y: 0, scale });
        frames.flush();
        await new Promise((r) => setTimeout(r, 0));
      };
      const sizes = (calls: [string, number, number][]) => calls.map(([, w]) => w);

      it("同一贴图在多帧、多对象、多个视图下只栅格化一次；尺寸按当前每格像素 × 像素比（上限 2）取 2 的幂档位", async () => {
        const { calls, cache } = countingRasterizer();
        const { view, frames, render, settleFrames } = await svgView(cache);
        view.setViewport({ x: 0, y: 0, scale: 10 });

        view.show(imageScene(sprite("a", 0), sprite("b", 3, { rotation: Math.PI / 4, tint: 0xff0000, alpha: 0.5 })));
        frames.flush();
        // 纹理就绪后再画一帧
        await settleFrames();
        expect(render).toHaveBeenCalledTimes(2);

        // 新 Tick：对象移动、换染色；同一档位内缩放变化
        view.show(imageScene(sprite("a", 1), sprite("b", 4, { tint: 0x00ff00 }), sprite("c", 8)));
        await zoomTo(view, 12, frames);
        await zoomTo(view, 6, frames);

        // 另一个视图共用同一份栅格化缓存
        const other = await svgView(cache);
        other.view.setViewport({ x: 0, y: 0, scale: 10 });
        other.view.show(imageScene(sprite("z", 0)));
        other.frames.flush();
        await other.settleFrames();

        // 2 格 × 10 CSS 像素 × 2 = 40 → 64
        expect(calls).toEqual([["/official-art/storage.svg", 64, 64]]);
      });

      it("放大相机越过档位才重新栅格化：每个档位至多一次，上限取相机的最大缩放；缩小不再栅格化", async () => {
        const { calls, cache } = countingRasterizer();
        const { view, frames } = await svgView(cache);
        view.setViewport({ x: 0, y: 0, scale: 5 });
        view.show(imageScene(sprite("a", 0)));
        frames.flush();
        await new Promise((r) => setTimeout(r, 0));
        for (let scale = 5; scale < 1000; scale *= 1.1) await zoomTo(view, scale, frames);
        for (let scale = 1000; scale > 5; scale /= 1.3) await zoomTo(view, scale, frames);
        // 2 格 × 5 × 2 = 20 → 32；最大 2 格 × 75 × 2 = 300 → 512
        expect(sizes(calls)).toEqual([32, 64, 128, 256, 512]);
      });

      it("按存量缩放的贴图变大时重新栅格化到更大尺寸；再变小不重新栅格化", async () => {
        const { calls, cache } = countingRasterizer();
        const { view, frames } = await svgView(cache);
        view.setViewport({ x: 0, y: 0, scale: 50 });
        const energy = (width: number) => sprite("e", 0, { url: "/official-art/link-energy.svg", width, height: width });
        for (const width of [0.1, 0.1, 0.5, 0.3, 0.1]) {
          view.show(imageScene(energy(width)));
          frames.flush();
          await new Promise((r) => setTimeout(r, 0));
        }
        // 0.1 格 × 100 = 10 → 16；0.5 格 × 100 = 50 → 64
        expect(sizes(calls)).toEqual([16, 64]);
      });

      it("不同大小的图元共用一张贴图时按较大者栅格化", async () => {
        const { calls, cache } = countingRasterizer();
        const { view, frames } = await svgView(cache);
        view.setViewport({ x: 0, y: 0, scale: 50 });
        view.show(imageScene(sprite("small", 0, { width: 0.3, height: 0.3 }), sprite("big", 3, { width: 1.2, height: 1.2 })));
        frames.flush();
        await new Promise((r) => setTimeout(r, 0));
        expect(sizes(calls).at(-1)).toBe(128);
      });

      it("纹理被淘汰后再用到时重新上传，但不重新栅格化", async () => {
        const { calls, cache } = countingRasterizer();
        const { view, frames, settleFrames } = await svgView(cache, 0);
        view.setViewport({ x: 0, y: 0, scale: 10 });
        view.show(imageScene(sprite("a", 0)));
        frames.flush();
        await settleFrames();
        view.show(imageScene(tile("t", "/t/x.png")));
        frames.flush();
        view.show(imageScene(sprite("a", 0)));
        frames.flush();
        await settleFrames();
        expect(calls).toHaveLength(1);
      });

      it("共享栅格缓存超过上限时按最久未用卸载没有视图在用的；在用的不卸载", async () => {
        const calls: string[] = [];
        // 每张 16×16 = 1 KB，上限 2 KB
        const cache = createSvgRasterCache(
          async (url, width, height) => {
            calls.push(url);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            return canvas;
          },
          { limitBytes: 2048 },
        );
        const use = async (url: string) => {
          await cache.get(url, 16, 16);
          cache.retain(url);
        };
        await use("/a.svg");
        await use("/b.svg");
        await use("/c.svg");
        // 都在用：超过上限也不卸载
        await cache.get("/a.svg", 16, 16);
        expect(calls).toEqual(["/a.svg", "/b.svg", "/c.svg"]);
        cache.release("/b.svg");
        cache.release("/a.svg");
        // a 刚用过、b 最久未用：只卸载 b，回到上限之内
        await cache.get("/c.svg", 16, 16);
        await cache.get("/a.svg", 16, 16);
        expect(calls).toEqual(["/a.svg", "/b.svg", "/c.svg"]);
        await cache.get("/b.svg", 16, 16);
        expect(calls).toEqual(["/a.svg", "/b.svg", "/c.svg", "/b.svg"]);
      });

      it("栅格化失败不抛错；之后再请求会重试", async () => {
        let fail = true;
        let count = 0;
        const cache = createSvgRasterCache(async () => {
          count++;
          if (fail) throw new Error("bad svg");
          return document.createElement("canvas");
        });
        await expect(cache.get("/x.svg", 1, 1)).rejects.toThrow();
        fail = false;
        await expect(cache.get("/x.svg", 1, 1)).resolves.toBeInstanceOf(HTMLCanvasElement);
        await cache.get("/x.svg", 1, 1);
        expect(count).toBe(2);
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

describe("有界动画（ADR 0008）", () => {
  /** 假时钟 + 手动帧队列 + 计数渲染器；node(key) 取图元对应的显示对象 */
  async function animated() {
    const frames = manualFrames();
    let time = 0;
    const renderer = await canvasRenderer();
    const render = vi.spyOn(renderer, "render");
    const view = await createSceneView({ width: 400, height: 300, renderer, schedule: frames.schedule, now: () => time });
    views.push(view);
    return {
      view,
      frames,
      /** 把时钟拨到 at 并跑完已排队的帧；返回累计渲染次数 */
      at(ms: number) {
        time = ms;
        frames.flush();
        return render.mock.calls.length;
      },
      node(key: string) {
        const stage = render.mock.calls.at(-1)?.[0] as { container: Container } | undefined;
        const found = stage?.container.getChildByLabel(key, true);
        if (!found) throw new Error(`没有 ${key}`);
        return found;
      },
    };
  }

  /** 透明度 0 →（100 ms）1 →（300 ms）0 的闪光 */
  const flashAnimation = (id: number): PrimitiveAnimation => ({
    id,
    tweens: [{ property: "alpha", from: 0, steps: [{ to: 1, duration: 100 }, { duration: 300 }] }],
  });
  const flash = (id: number | undefined, extra: Partial<Primitive> = {}): Primitive =>
    ({ key: "flash", kind: "circle", layer: 50, x: 5, y: 5, radius: 1, fill: 0xffffff, alpha: 0, ...(id === undefined ? {} : { animation: flashAnimation(id) }), ...extra }) as Primitive;
  const withPrims = (...primitives: Primitive[]): Scene => ({ ...scene, primitives: [...scene.primitives, ...primitives] });

  it("没有动画时只渲染一帧，不再请求帧", async () => {
    const { view, frames, at } = await animated();
    view.show(withPrims(flash(undefined)));
    expect(at(0)).toBe(1);
    expect(frames.pending).toBe(0);
    expect(at(1000)).toBe(1);
  });

  it("有动画时逐帧推进，到期后停在终态并停止请求帧", async () => {
    const { view, frames, at, node } = await animated();
    view.show(withPrims(flash(7)));
    expect(at(0)).toBe(1);
    expect(node("flash").alpha).toBe(0);
    expect(frames.pending).toBe(1);
    expect(at(50)).toBe(2);
    expect(node("flash").alpha).toBeCloseTo(0.5);
    at(100);
    expect(node("flash").alpha).toBeCloseTo(1);
    at(250);
    expect(node("flash").alpha).toBeCloseTo(0.5);
    expect(at(400)).toBe(5);
    expect(node("flash").alpha).toBe(0);
    expect(frames.pending).toBe(0);
    expect(at(1000)).toBe(5);
  });

  it("同一动画（描述相同）的新 Scene 不重播；描述变了（下一个 Tick）从头播放", async () => {
    const { view, at, node, frames } = await animated();
    view.show(withPrims(flash(7)));
    at(0);
    at(50);
    // 同一 Tick 内重建 Scene（例如选中别的对象）：动画接着播
    view.show(structuredClone(withPrims(flash(7), { key: "other", kind: "rect", layer: 1, x: 0, y: 0, width: 1, height: 1 })));
    at(75);
    expect(node("flash").alpha).toBeCloseTo(0.75);
    at(400);
    expect(frames.pending).toBe(0);
    // 连续两个 Tick 同样内容的动作：标识不同，重播
    view.show(withPrims(flash(8)));
    expect(node("flash").alpha).toBe(0);
    at(450);
    expect(node("flash").alpha).toBeCloseTo(0.5);
    expect(frames.pending).toBe(1);
  });

  it("新 Scene 到来时，被取消的旧动画跳到终态", async () => {
    const { view, at, node, frames } = await animated();
    const turning: Primitive = {
      key: "turret",
      kind: "polygon",
      layer: 20,
      points: [10, 10, 12, 10, 11, 12],
      fill: 0xffffff,
      animation: { id: 1, originX: 11, originY: 11, tweens: [{ property: "turn", from: Math.PI / 2, steps: [{ duration: 300 }] }] },
    };
    view.show(withPrims(flash(1), turning));
    at(0);
    // 绕 (11, 11) 转了 90°：本地原点 (0, 0) 落在 (22, 0)
    expect(node("turret").rotation).toBeCloseTo(Math.PI / 2);
    expect(node("turret").position.x).toBeCloseTo(22);
    expect(node("turret").position.y).toBeCloseTo(0);
    at(150);
    expect(node("turret").rotation).toBeCloseTo(Math.PI / 4);

    // 下一个 Tick 没有这两个动画：立刻是终态，不再请求帧
    const { animation: _ignored, ...still } = turning;
    view.show(withPrims(flash(undefined), still as Primitive));
    expect(node("flash").alpha).toBe(0);
    expect(node("turret").rotation).toBe(0);
    expect(node("turret").position.x).toBeCloseTo(0);
    at(160);
    expect(frames.pending).toBe(0);
  });

  it("贴图的转向叠加在自身旋转上；平移与缩放绕 origin", async () => {
    const { view, at, node } = await animated();
    const url = encodePixelImage({ width: 2, height: 2, rgba: new Uint8Array(16).fill(255) });
    const sprite: Primitive = {
      key: "sprite",
      kind: "image",
      layer: 20,
      x: 4,
      y: 4,
      width: 2,
      height: 2,
      url,
      rotation: 1,
      pivotX: 5,
      pivotY: 5,
      animation: {
        id: 1,
        originX: 5,
        originY: 5,
        tweens: [
          { property: "turn", from: -1, steps: [{ duration: 100 }] },
          { property: "offsetX", from: -1, steps: [{ duration: 100, easing: "easeInOutQuad" }] },
          { property: "scale", from: 0, steps: [{ duration: 100 }] },
        ],
      },
    };
    view.show(withPrims(sprite));
    at(0);
    const shown = node("sprite");
    expect(shown.rotation).toBeCloseTo(0);
    expect(shown.position.x).toBeCloseTo(4);
    expect(shown.scale.x).toBeCloseTo(0);
    at(50);
    expect(shown.rotation).toBeCloseTo(0.5);
    expect(shown.position.x).toBeCloseTo(4.5);
    at(100);
    expect(shown.rotation).toBeCloseTo(1);
    expect(shown.position.x).toBe(5);
    expect(shown.position.y).toBe(5);
    expect(shown.width).toBeCloseTo(2);
  });

  it("光束按 trimStart / trimEnd 伸缩，终态长度为 0", async () => {
    const { view, at, node } = await animated();
    const beam: Primitive = {
      key: "beam",
      kind: "line",
      layer: 50,
      points: [0, 0, 10, 0],
      stroke: { color: 0x3c75c7, width: 0.18 },
      blend: "add",
      trimStart: 1,
      trimEnd: 1,
      animation: {
        id: 1,
        tweens: [
          { property: "trimEnd", from: 0, steps: [{ duration: 100 }] },
          { property: "trimStart", from: 0, delay: 100, steps: [{ duration: 100 }] },
        ],
      },
    };
    view.show(withPrims(beam));
    const width = () => (node("beam") as Graphics).getLocalBounds().width;
    at(0);
    expect(width()).toBe(0);
    at(50);
    expect(width()).toBeCloseTo(5, 0);
    at(150);
    expect((node("beam") as Graphics).getLocalBounds().x).toBeCloseTo(5, 0);
    at(200);
    expect(width()).toBe(0);
    expect((node("beam") as Graphics).blendMode).toBe("add");
  });

  it("逐帧插值只碰动画中的显示对象，不重画其余图元", async () => {
    const { view, at } = await animated();
    view.show(withPrims(flash(1)));
    at(0);
    const redraws = vi.spyOn(Graphics.prototype, "clear");
    at(50);
    at(100);
    at(200);
    expect(redraws).not.toHaveBeenCalled();
  });

  it("settle()：动画立即跳到终态且不请求帧；之后的 show() 补画一帧", async () => {
    const { view, at, node, frames } = await animated();
    view.show(withPrims(flash(1)));
    expect(at(0)).toBe(1);
    view.settle();
    expect(node("flash").alpha).toBe(0);
    // 已排队的那一帧不渲染，也不再排下一帧
    expect(at(100)).toBe(1);
    expect(frames.pending).toBe(0);
    // 回到屏幕：同一个动画不重播，但画布要补画终态
    view.show(structuredClone(withPrims(flash(1))));
    expect(at(150)).toBe(2);
    expect(frames.pending).toBe(0);
  });
});
