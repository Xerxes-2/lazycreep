/**
 * 合成贴图（#46）：一整张房间大小的 SVG（官方画风的地形、合并后的 rampart），用 SVG 的图案、裁剪与混合
 * 把官方 PNG 噪声纹理“遮罩”进墙与沼泽——Scene 的图元没有遮罩，这样只占一个 image 图元。
 *
 * URL 由 image-sources.ts 的 compositeSvgUrl 编码（`data:image/svg+xml;msc=composite,…`），本身就是合法的 SVG 图片
 * （交给普通的 SVG 栅格化也能画，只是 `<image>` 引用的位图在 <img> 里不加载）。这里的加载：
 * - 把 SVG 里 `href` 引用的同源 PNG 取来（首次用到时 fetch、走 HTTP 缓存，全页只取一次）内联成 data URL，
 *   再按适配层请求的像素尺寸栅格化（档位规则与 SVG 贴图相同，见 texture-sources.ts：50 格 × 当前每格像素
 *   × min(像素比, 2)，2 的幂，上限 2048；手机整房间约 1024）。放大越过档位时适配层以更大尺寸再加载，
 *   这里重新合成并换掉旧纹理。不进全页共享的 SVG 栅格化缓存。
 * - 栅格化用的画布留作纹理资源：Pixi v8 在 WebGL 上下文丢失恢复后要从 `source.resource` 重新上传，
 *   释放了就恢复不了；内存靠按需的档位控制（1024² 4 MB，上限 2048² 16 MB）。
 * - {@link TextureLoader.transient}：没有图元在用就立即卸载。每个房间、每次 rampart 变化都是新 URL，
 *   一张就是几 MB，不能像官方小贴图那样闲置着等淘汰。
 */
import { ImageSource, Texture } from "pixi.js";
import { compositeSvgText, fetchDataUrl, isCompositeUrl, rasterizeSvgText, type RasterImage } from "./image-sources.ts";
import type { TextureLoader, TextureSize } from "./texture-sources.ts";

/** SVG 里引用的同源位图（`href="/…png"`） */
export function referencedImages(svg: string): string[] {
  return [...new Set([...svg.matchAll(/href="(\/[^"]+\.png)"/g)].map((m) => m[1]!))];
}

export interface CompositeOptions {
  /** 位图 URL → data URL；默认 fetch（HTTP 缓存）+ base64，全页共享 */
  readonly inlineImage?: (url: string) => Promise<string>;
  /** 内联后的 SVG 文本 → width×height 像素的栅格；默认共享的 SVG 栅格化（image-sources.ts） */
  readonly rasterize?: (svg: string, width: number, height: number) => Promise<RasterImage>;
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

/** 没给尺寸时的栅格边长 */
const DEFAULT_SIZE = 1024;

/** 合成贴图自己加载、其余 URL 交给 inner。 */
export function withCompositeImages(inner: TextureLoader, options: CompositeOptions = {}): TextureLoader {
  const inline = options.inlineImage ?? sharedInline;
  const rasterize = options.rasterize ?? rasterizeSvgText;
  const made = new Map<string, Texture>();
  const loadComposite = async (url: string, text: string, size: TextureSize | undefined) => {
    let svg = text;
    for (const ref of referencedImages(text)) {
      const data = await inline(ref);
      svg = svg.split(`href="${ref}"`).join(`href="${data}"`);
    }
    const resource = await rasterize(svg, size?.width ?? DEFAULT_SIZE, size?.height ?? DEFAULT_SIZE);
    // 保留 mipmap：档位只增不减，放大到 2048 后再缩回整房间时要缩小 2–4 倍，没有 mipmap 噪声纹理会闪烁出摩尔纹
    const texture = new Texture({ source: new ImageSource({ resource, autoGenerateMipmaps: true }) });
    made.get(url)?.destroy(true);
    made.set(url, texture);
    return texture;
  };
  return {
    // 不是合成贴图时原样转交（不多包一层 Promise，像素图仍然同步可用）
    load(url, size) {
      const text = compositeSvgText(url);
      return text === undefined ? inner.load(url, size) : loadComposite(url, text, size);
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
      return isCompositeUrl(url) || (inner.scalable?.(url) ?? false);
    },
  };
}
