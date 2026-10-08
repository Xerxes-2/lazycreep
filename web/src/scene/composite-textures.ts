/**
 * 合成贴图（#46）：一整张房间大小的 SVG（官方画风的地形、合并后的 rampart），用 SVG 的图案、裁剪与混合
 * 把官方 PNG 噪声纹理“遮罩”进墙与沼泽——Scene 的图元没有遮罩，这样只占一个 image 图元。
 *
 * URL 是带 {@link COMPOSITE_SVG_PREFIX} 的 `data:image/svg+xml`，本身就是合法的 SVG 图片
 * （交给普通的 SVG 栅格化也能画，只是 `<image>` 引用的位图在 <img> 里不加载）。这里的加载：
 * - 把 SVG 里 `href` 引用的同源 PNG 取来（首次用到时 fetch、走 HTTP 缓存，全页只取一次）内联成 data URL，
 *   再按 SVG 根元素自带的 width/height（像素）栅格化；不进全页共享的 SVG 栅格化缓存。
 * - {@link TextureLoader.transient}：没有图元在用就立即卸载。每个房间、每次 rampart 变化都是新 URL，
 *   一张就是几 MB，不能像官方小贴图那样闲置着等淘汰。
 */
import { ImageSource, Texture } from "pixi.js";
import { fetchDataUrl, rasterizeSvgText, type RasterImage } from "./image-sources.ts";
import type { TextureLoader } from "./texture-sources.ts";

export const COMPOSITE_SVG_PREFIX = "data:image/svg+xml;msc=composite,";

/** SVG 文本 → 合成贴图 URL（只转义 data URL 里有特殊含义的 `%` 与 `#`） */
export function compositeSvgUrl(svg: string): string {
  return COMPOSITE_SVG_PREFIX + svg.replace(/[%#]/g, (c) => encodeURIComponent(c));
}

export function isCompositeUrl(url: string): boolean {
  return url.startsWith(COMPOSITE_SVG_PREFIX);
}

/** 合成贴图 URL → SVG 文本；不是合成贴图时为 undefined */
export function compositeSvgText(url: string): string | undefined {
  return isCompositeUrl(url) ? decodeURIComponent(url.slice(COMPOSITE_SVG_PREFIX.length)) : undefined;
}

/** SVG 里引用的同源位图（`href="/…png"`） */
export function referencedImages(svg: string): string[] {
  return [...new Set([...svg.matchAll(/href="(\/[^"]+\.png)"/g)].map((m) => m[1]!))];
}

export interface CompositeOptions {
  /** 位图 URL → data URL；默认 fetch（HTTP 缓存）+ base64，全页共享 */
  readonly inlineImage?: (url: string) => Promise<string>;
  /** 内联后的 SVG 文本 → 栅格（按根元素的 width/height）；默认经 <img> 画进画布 */
  readonly rasterize?: (svg: string) => Promise<RasterImage>;
}

const inlined = new Map<string, Promise<string>>();

/** 全页共享：每个位图只取一次（失败后下次重试） */
function sharedInline(url: string): Promise<string> {
  const hit = inlined.get(url);
  if (hit) return hit;
  const made = fetchDataUrl(url);
  inlined.set(url, made);
  made.catch(() => inlined.delete(url));
  return made;
}

function svgSize(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const attr = (name: string) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(root)?.[1] ?? 0) || 1;
  return { width: attr("width"), height: attr("height") };
}

function rasterizeAtOwnSize(svg: string): Promise<RasterImage> {
  const { width, height } = svgSize(svg);
  return rasterizeSvgText(svg, width, height);
}

/** 合成贴图自己加载、其余 URL 交给 inner。 */
export function withCompositeImages(inner: TextureLoader, options: CompositeOptions = {}): TextureLoader {
  const inline = options.inlineImage ?? sharedInline;
  const rasterize = options.rasterize ?? rasterizeAtOwnSize;
  const made = new Map<string, Texture>();
  const loadComposite = async (url: string, text: string) => {
    let svg = text;
    for (const ref of referencedImages(text)) {
      const data = await inline(ref);
      svg = svg.split(`href="${ref}"`).join(`href="${data}"`);
    }
    const resource = await rasterize(svg);
    const texture = new Texture({ source: new ImageSource({ resource, autoGenerateMipmaps: true }) });
    made.set(url, texture);
    return texture;
  };
  return {
    // 不是合成贴图时原样转交（不多包一层 Promise，像素图仍然同步可用）
    load(url, size) {
      const text = compositeSvgText(url);
      return text === undefined ? inner.load(url, size) : loadComposite(url, text);
    },
    unload(url) {
      const texture = made.get(url);
      if (!texture) return inner.unload(url);
      made.delete(url);
      texture.destroy(true);
    },
    transient(url) {
      return isCompositeUrl(url) || (inner.transient?.(url) ?? false);
    },
    scalable(url) {
      return !isCompositeUrl(url) && (inner.scalable?.(url) ?? false);
    },
  };
}
