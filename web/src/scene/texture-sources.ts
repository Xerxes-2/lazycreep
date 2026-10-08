/**
 * image 图元的贴图来源（#42）：纹理尺寸档位、SVG 栅格化缓存与默认的纹理加载。
 *
 * - 尺寸：适配层按“图元世界尺寸 × 当前每格像素 × 像素比（上限 2）”请求纹理，每格像素不超过 Room View
 *   相机的最大缩放（短边只剩 {@link MAX_ZOOM_SPAN} 格）；长边向上取 2 的幂档位（{@link rasterTier}，
 *   上限 {@link MAX_RASTER}）。尺寸只增不减：放大或图元变大越过档位时才以更大的档位重新栅格化，
 *   每个档位至多一次。
 * - SVG（`.svg` 结尾的 URL 或 `data:image/svg+xml`）：全页共享一份栅格化缓存，按 URL 保留目前最大的一张；
 *   多个对象、多个视图共用（取其中最大的请求）。没有视图在用的栅格超过上限时按最久未用卸载。
 * - 其余 URL（PNG 等）：首次被图元用到时才 fetch，走浏览器 HTTP 缓存；尺寸固定，不升档。
 *
 * 取图与栅格化本身在 image-sources.ts。不用 Pixi 的 Assets（在本适配层下全局 ticker 已停，它的加载不完成）。
 */
import { ImageSource, Texture } from "pixi.js";
import { fetchBitmap, isSvgUrl, rasterizeSvgUrl, type RasterImage } from "./image-sources.ts";
import { MAX_ZOOM_SPAN } from "./scene-camera.ts";

export { MAX_ZOOM_SPAN };
/** 设备像素比的上限 */
export const MAX_RASTER_DPR = 2;
/** 栅格的最小 / 最大边长（像素）。2048² 的 RGBA 是 16 MB */
export const MIN_RASTER = 16;
export const MAX_RASTER = 2048;

/** 像素数 → 2 的幂档位，限制在 [MIN_RASTER, MAX_RASTER] */
export function rasterTier(pixels: number): number {
  const p = Math.max(MIN_RASTER, Math.min(MAX_RASTER, Number.isFinite(pixels) ? pixels : MIN_RASTER));
  return Math.min(MAX_RASTER, 2 ** Math.ceil(Math.log2(p)));
}

/**
 * 画布上每个世界单位的设备像素数（栅格化用）：当前缩放 × 像素比（上限 2），缩放不超过相机的最大缩放
 * （画布短边只剩 {@link MAX_ZOOM_SPAN} 个单位）。
 */
export function rasterPixelsPerUnit(scale: number, devicePixelRatio: number, canvasWidth: number, canvasHeight: number): number {
  const maxScale = Math.min(canvasWidth, canvasHeight) / MAX_ZOOM_SPAN;
  const dpr = Math.min(MAX_RASTER_DPR, Math.max(1, devicePixelRatio || 1));
  return Math.max(0, Math.min(scale, maxScale > 0 ? maxScale : scale)) * dpr;
}

/** 纹理的像素尺寸（设备像素） */
export interface TextureSize {
  readonly width: number;
  readonly height: number;
}

/** 世界尺寸 × 每单位像素 → 栅格尺寸：长边取档位，短边按比例 */
export function rasterSize(worldWidth: number, worldHeight: number, pixelsPerUnit: number): TextureSize {
  const w = Math.max(0, worldWidth);
  const h = Math.max(0, worldHeight);
  const long = Math.max(w, h);
  const side = rasterTier(long * pixelsPerUnit);
  if (long === 0) return { width: side, height: side };
  return { width: Math.max(1, Math.ceil((side * w) / long)), height: Math.max(1, Math.ceil((side * h) / long)) };
}

/** 把 url 指向的 SVG 画成 width×height 像素 */
export type SvgRasterizer = (url: string, width: number, height: number) => Promise<RasterImage>;

export interface SvgRasterCache {
  /**
   * url 的栅格：已有的不小于请求（按长边档位比）时直接给它，否则按请求尺寸重新栅格化并替换；
   * 失败后下次再请求会重试。
   */
  get(url: string, width: number, height: number): Promise<RasterImage>;
  /** 有视图在用 url 的栅格（不淘汰）；与 release 成对 */
  retain(url: string): void;
  release(url: string): void;
}

export interface SvgRasterCacheOptions {
  /** 栅格总字节数（按 RGBA 计）的上限；超出时按最久未用卸载没有视图在用的。默认 64 MB */
  readonly limitBytes?: number;
}

export function createSvgRasterCache(rasterize: SvgRasterizer = rasterizeSvgUrl, options: SvgRasterCacheOptions = {}): SvgRasterCache {
  interface Entry {
    raster: Promise<RasterImage>;
    side: number;
    bytes: number;
    refs: number;
  }
  const limit = options.limitBytes ?? 64 * 1024 * 1024;
  /** 插入顺序即最近使用顺序（用到时移到末尾） */
  const entries = new Map<string, Entry>();
  let total = 0;
  const touch = (url: string, entry: Entry) => {
    entries.delete(url);
    entries.set(url, entry);
  };
  /** keep：刚请求的那张（调用方随后才 retain）不卸载 */
  const evict = (keep?: string) => {
    for (const [url, entry] of entries) {
      if (total <= limit) break;
      if (entry.refs > 0 || url === keep) continue;
      entries.delete(url);
      total -= entry.bytes;
    }
  };
  return {
    get(url, width, height) {
      const w = Math.max(1, Math.ceil(width));
      const h = Math.max(1, Math.ceil(height));
      const side = Math.max(w, h);
      const hit = entries.get(url);
      if (hit && hit.side >= side) {
        touch(url, hit);
        return hit.raster;
      }
      const raster = rasterize(url, w, h);
      const entry: Entry = { raster, side, bytes: w * h * 4, refs: hit?.refs ?? 0 };
      if (hit) total -= hit.bytes;
      total += entry.bytes;
      touch(url, entry);
      raster.catch(() => {
        if (entries.get(url) !== entry) return;
        entries.delete(url);
        total -= entry.bytes;
      });
      evict(url);
      return raster;
    },
    retain(url) {
      const entry = entries.get(url);
      if (entry) entry.refs++;
    },
    release(url) {
      const entry = entries.get(url);
      if (!entry || entry.refs === 0) return;
      entry.refs--;
      evict();
    },
  };
}

let shared: SvgRasterCache | undefined;
/** 全页共享的 SVG 栅格化缓存 */
export function sharedSvgRasters(): SvgRasterCache {
  return (shared ??= createSvgRasterCache());
}

export interface TextureLoader {
  /**
   * url 的纹理；size 是请求的像素尺寸（可缩放的贴图按它栅格化，位图忽略）。同一 url 再次 load
   * （适配层在需要更大尺寸时才会这样做）时，新纹理就绪后加载器销毁该 url 的旧纹理。
   */
  load(url: string, size?: TextureSize): Promise<Texture>;
  unload(url: string): void;
  /** 为 true 的贴图没有图元在用时立即卸载，不闲置等淘汰（#46 的大张合成贴图）；默认 false */
  transient?(url: string): boolean;
  /** 为 true 的贴图（矢量）请求更大尺寸会更清晰，适配层放大越过档位时会再 load；默认 false */
  scalable?(url: string): boolean;
}

export interface DefaultTexturesOptions {
  /** SVG 栅格化缓存；默认全页共享的一份 */
  readonly svg?: SvgRasterCache;
  /** 位图的获取，默认 fetch + createImageBitmap（按需、走 HTTP 缓存） */
  readonly fetchBitmap?: (url: string) => Promise<RasterImage>;
}

/**
 * 默认的纹理加载（每个视图一份）：SVG 取共享的栅格化结果，其余按位图加载；
 * 纹理（GPU 侧）各视图自有，卸载时只销毁纹理并告诉共享缓存这个视图不再用它。
 */
export function defaultTextures(options: DefaultTexturesOptions = {}): TextureLoader {
  const loaded = new Map<string, Texture>();
  const retained = new Set<string>();
  const svg = options.svg ?? sharedSvgRasters();
  const bitmap = options.fetchBitmap ?? fetchBitmap;
  return {
    async load(url, size) {
      const vector = isSvgUrl(url);
      let pending: Promise<RasterImage>;
      if (vector) {
        pending = svg.get(url, size?.width ?? MIN_RASTER, size?.height ?? MIN_RASTER);
        if (!retained.has(url)) {
          retained.add(url);
          svg.retain(url);
        }
      } else pending = bitmap(url);
      const resource = await pending;
      const texture = new Texture({ source: new ImageSource({ resource, autoGenerateMipmaps: vector }) });
      loaded.get(url)?.destroy(true);
      loaded.set(url, texture);
      return texture;
    },
    unload(url) {
      const texture = loaded.get(url);
      loaded.delete(url);
      texture?.destroy(true);
      if (retained.delete(url)) svg.release(url);
    },
    scalable: isSvgUrl,
  };
}
