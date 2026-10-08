import { describe, expect, it } from "vitest";
import { createRoot, createMemo } from "solid-js";
import { badgeSvg, BADGE_PLACEHOLDER_SVG } from "./badge-svg.ts";
import { badgeSvgUrl, createBadgeRasters } from "./badge-image.ts";
import type { Badge } from "./badge.ts";

/** 同一玩家（Xerxes_2）在两个 Server 上的徽章（docs/research/official-art-and-badges.md B7） */
const MMO: Badge = { type: 5, color1: "#c8100b", color2: "#f8c420", color3: "#f8c420", param: -68, flip: false };
const SEASON: Badge = { type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false };

function fakeRasterizer() {
  const calls: string[] = [];
  let release: Array<() => void> = [];
  const rasterize = (svg: string, size: number) =>
    new Promise<string>((resolve) => {
      calls.push(svg);
      release.push(() => resolve(`raster:${size}:${svg}`));
    });
  const flushQueue: Array<() => void> = [];
  return {
    calls,
    rasters: createBadgeRasters({ rasterize, size: 64, schedule: (flush) => flushQueue.push(flush) }),
    async finish() {
      for (const r of release) r();
      release = [];
      await Promise.resolve();
      await Promise.resolve();
      for (const f of flushQueue.splice(0)) f();
    },
  };
}

describe("徽章图片", () => {
  it("DOM 用的 SVG data URL：内容即生成器输出；没有徽章时是中性占位", () => {
    expect(decodeURIComponent(badgeSvgUrl(SEASON).split(",")[1]!)).toBe(badgeSvg(SEASON));
    expect(decodeURIComponent(badgeSvgUrl(undefined).split(",")[1]!)).toBe(BADGE_PLACEHOLDER_SVG);
  });

  it("地图用的位图：栅格化完成前没有，完成后通知读取方重算", async () => {
    const fake = fakeRasterizer();
    await createRoot(async (dispose) => {
      const url = createMemo(() => fake.rasters.url("season", "u1", SEASON));
      expect(url()).toBeUndefined();
      await fake.finish();
      expect(url()).toBe(`raster:64:${badgeSvg(SEASON)}`);
      dispose();
    });
  });

  it("同一玩家在不同 Server 的徽章互不混用", async () => {
    const fake = fakeRasterizer();
    fake.rasters.url("mmo", "u1", MMO);
    fake.rasters.url("season", "u1", SEASON);
    await fake.finish();
    expect(fake.rasters.url("mmo", "u1", MMO)).toBe(`raster:64:${badgeSvg(MMO)}`);
    expect(fake.rasters.url("season", "u1", SEASON)).toBe(`raster:64:${badgeSvg(SEASON)}`);
  });

  it("同一徽章内容只栅格化一次；没有徽章的玩家共用一张中性占位", async () => {
    const fake = fakeRasterizer();
    fake.rasters.url("season", "u1", SEASON);
    fake.rasters.url("season", "u2", { ...SEASON });
    fake.rasters.url("season", "u1", SEASON);
    fake.rasters.url("season", "sk", null);
    fake.rasters.url("season", "other", null);
    await fake.finish();
    expect(fake.rasters.url("season", "u2", SEASON)).toBe(`raster:64:${badgeSvg(SEASON)}`);
    expect(fake.rasters.url("season", "sk", null)).toBe(`raster:64:${BADGE_PLACEHOLDER_SVG}`);
    expect(fake.calls).toEqual([badgeSvg(SEASON), BADGE_PLACEHOLDER_SVG]);
  });
});
