/**
 * #46：合成贴图的加载——PNG 只在贴图真正被加载（首次进入 Room View 画地形）时才请求，内联后栅格化。
 */
import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import { COMPOSITE_SVG_PREFIX, compositeSvgText, compositeSvgUrl, withCompositeImages } from "./composite-textures.ts";
import type { TextureLoader } from "./texture-sources.ts";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><pattern id="n"><image href="/official-art/textures/noise1.png"/></pattern><path d="M 0 50 h 10 Z" fill="#111"/><rect fill="url(#n)"/></svg>`;

function setup() {
  const fetched: string[] = [];
  const rasterized: string[] = [];
  const innerLoads: string[] = [];
  const inner: TextureLoader = {
    load: async (url) => (innerLoads.push(url), Texture.WHITE),
    unload: () => undefined,
  };
  const loader = withCompositeImages(inner, {
    inlineImage: async (url) => (fetched.push(url), "data:image/png;base64,AAAA"),
    rasterize: async (text) => {
      rasterized.push(text);
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      return canvas;
    },
  });
  return { loader, fetched, rasterized, innerLoads };
}

describe("合成贴图 URL", () => {
  it("是带标记的 SVG data URL，可以原样还原出 SVG 文本（# 与 % 已转义）", () => {
    const url = compositeSvgUrl(svg);
    expect(url.startsWith(COMPOSITE_SVG_PREFIX)).toBe(true);
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    expect(url).not.toContain("#");
    expect(compositeSvgText(url)).toBe(svg);
    expect(compositeSvgText("/official-art/storage.svg")).toBeUndefined();
  });
});

describe("withCompositeImages", () => {
  it("构建 URL 时不请求任何 PNG；加载时才取，内联成 data URL 后栅格化", async () => {
    const { loader, fetched, rasterized } = setup();
    const url = compositeSvgUrl(svg);
    expect(fetched).toEqual([]);
    const texture = await loader.load(url);
    expect(fetched).toEqual(["/official-art/textures/noise1.png"]);
    expect(rasterized).toHaveLength(1);
    expect(rasterized[0]).toContain('href="data:image/png;base64,AAAA"');
    expect(rasterized[0]).not.toContain("/official-art/textures/noise1.png");
    expect(texture.width).toBe(64);
    loader.unload(url);
    expect(texture.destroyed).toBe(true);
  });

  it("合成贴图闲置即卸载（transient），其他 URL 交给原加载器", async () => {
    const { loader, innerLoads } = setup();
    expect(loader.transient?.(compositeSvgUrl(svg))).toBe(true);
    expect(loader.transient?.("/official-art/storage.svg")).toBe(false);
    await loader.load("/official-art/storage.svg");
    expect(innerLoads).toEqual(["/official-art/storage.svg"]);
  });
});
