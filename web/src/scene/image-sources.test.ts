import { describe, expect, it } from "vitest";
import { ensureViewBox } from "./image-sources.ts";

const root = (attrs: string) =>
  new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`, "image/svg+xml").documentElement;

describe("SVG 栅格化前补 viewBox", () => {
  it("小写 viewbox 不算数：按原 width/height 补，放大时内容才跟着缩放（creep-npc、exit-*）", () => {
    const svg = root('width="32" height="32" viewbox="0 0 100 100"');
    ensureViewBox(svg);
    expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
  });

  it("已有 viewBox 不动；没有 width/height 时不补", () => {
    const own = root('width="100" height="100" viewBox="-50 -50 100 100"');
    ensureViewBox(own);
    expect(own.getAttribute("viewBox")).toBe("-50 -50 100 100");
    const bare = root("");
    ensureViewBox(bare);
    expect(bare.hasAttribute("viewBox")).toBe(false);
  });
});
