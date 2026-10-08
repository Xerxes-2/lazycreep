/**
 * image 图元的贴图来源（#42）：SVG 栅格化缓存与默认的纹理加载。
 *
 * - SVG（`.svg` 结尾的 URL 或 `data:image/svg+xml`）：全页共享一份栅格化缓存，按 URL 只栅格化一次，
 *   尺寸取“第一次用到它的图元的世界尺寸 × 每单位像素数”，其中每单位像素数 = 最大缩放级别
 *   （{@link SVG_MAX_ZOOM}）× 设备像素比（上限 2）。缩放、新 Tick、多个对象、多个视图都复用这一份。
 * - 其余 URL（PNG 等）：首次被图元用到时才 fetch，走浏览器 HTTP 缓存。
 *
 * 取图与栅格化本身在 image-sources.ts。不用 Pixi 的 Assets（在本适配层下全局 ticker 已停，它的加载不完成）。
 */
import { ImageSource, Texture } from "pixi.js";
import { fetchBitmap, isSvgUrl, rasterizeSvgUrl, type RasterImage } from "./image-sources.ts";


/** 栅格化时假定的最大缩放：画布上 1 个世界单位（Room View 的 1 格）最多这么多 CSS 像素 */
export const SVG_MAX_ZOOM = 128;
/** 设备像素比的上限 */
export const MAX_RASTER_DPR = 2;

/** 把 url 指向的 SVG 画成 width×height 像素 */
export type SvgRasterizer = (url: string, width: number, height: number) => Promise<RasterImage>;

export interface SvgRasterCache {
  /** url 的栅格化结果；同一 url 只栅格化一次（尺寸以第一次请求为准），失败后下次再请求会重试 */
  get(url: string, width: number, height: number): Promise<RasterImage>;
}

/** 栅格化时每个世界单位的像素数 */
export function svgPixelsPerUnit(devicePixelRatio: number): number {
  return SVG_MAX_ZOOM * Math.min(MAX_RASTER_DPR, Math.max(1, devicePixelRatio || 1));
}

export function createSvgRasterCache(rasterize: SvgRasterizer = rasterizeSvgUrl): SvgRasterCache {
  const cache = new Map<string, Promise<RasterImage>>();
  return {
    get(url, width, height) {
      const hit = cache.get(url);
      if (hit) return hit;
      const made = rasterize(url, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
      cache.set(url, made);
      made.catch(() => {
        if (cache.get(url) === made) cache.delete(url);
      });
      return made;
    },
  };
}

let shared: SvgRasterCache | undefined;
/** 全页共享的 SVG 栅格化缓存 */
export function sharedSvgRasters(): SvgRasterCache {
  return (shared ??= createSvgRasterCache());
}

/** 第一个用到贴图的图元的世界尺寸；SVG 按它决定栅格化尺寸 */
export interface TextureSize {
  readonly width: number;
  readonly height: number;
}

export interface TextureLoader {
  load(url: string, size?: TextureSize): Promise<Texture>;
  unload(url: string): void;
  /** 为 true 的贴图没有图元在用时立即卸载，不闲置等淘汰（#46 的大张合成贴图）；默认 false */
  transient?(url: string): boolean;
}

export interface DefaultTexturesOptions {
  /** SVG 栅格化缓存；默认全页共享的一份 */
  readonly svg?: SvgRasterCache;
  /** 栅格化时每个世界单位的像素数；默认按设备像素比算 */
  readonly pixelsPerUnit?: number;
  /** 位图的获取，默认 fetch + createImageBitmap（按需、走 HTTP 缓存） */
  readonly fetchBitmap?: (url: string) => Promise<RasterImage>;
}

/**
 * 默认的纹理加载（每个视图一份）：SVG 取共享的栅格化结果，其余按位图加载；
 * 纹理（GPU 侧）各视图自有，卸载时只销毁纹理，栅格化结果留在共享缓存里。
 */
export function defaultTextures(options: DefaultTexturesOptions = {}): TextureLoader {
  const loaded = new Map<string, Texture>();
  const svg = options.svg ?? sharedSvgRasters();
  const ppu = options.pixelsPerUnit ?? svgPixelsPerUnit(globalThis.devicePixelRatio ?? 1);
  const bitmap = options.fetchBitmap ?? fetchBitmap;
  return {
    async load(url, size) {
      const vector = isSvgUrl(url);
      const resource = vector
        ? await svg.get(url, (size?.width ?? 1) * ppu, (size?.height ?? 1) * ppu)
        : await bitmap(url);
      const texture = new Texture({ source: new ImageSource({ resource, autoGenerateMipmaps: vector }) });
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
