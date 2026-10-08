/**
 * 像素图纹理（#44）：pixel-image.ts 编码的 data URL 直接同步解码成 Pixi 纹理（最近邻缩放，一格一像素不发糊），
 * 不经 fetch / createImageBitmap，换帧时不会先空白一下；其余 URL 交给原来的加载器。
 */
import { BufferImageSource, Texture } from "pixi.js";
import { decodePixelImage, isPixelImageUrl } from "./pixel-image.ts";
import type { TextureLoader } from "./pixi-scene-view.ts";

export function withPixelImages(loader: TextureLoader): TextureLoader {
  const made = new Map<string, Texture>();
  return {
    load(url, size) {
      const pixels = decodePixelImage(url);
      if (!pixels) return loader.load(url, size);
      const source = new BufferImageSource({
        resource: pixels.rgba,
        width: pixels.width,
        height: pixels.height,
        scaleMode: "nearest",
      });
      const texture = new Texture({ source });
      made.set(url, texture);
      return Promise.resolve(texture);
    },
    unload(url) {
      const texture = made.get(url);
      if (!texture) return loader.unload(url);
      made.delete(url);
      texture.destroy(true);
    },
    transient: (url) => loader.transient?.(url) ?? false,
    scalable: (url) => !isPixelImageUrl(url) && (loader.scalable?.(url) ?? false),
  };
}
