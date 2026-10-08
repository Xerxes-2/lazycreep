import { describe, expect, it } from "vitest";
import { pwaOptions } from "./pwa.config";

describe("PWA configuration", () => {
  it("declares an installable manifest", () => {
    const manifest = pwaOptions.manifest;
    if (!manifest) throw new Error("manifest missing");
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("only precaches static build assets and never caches at runtime", () => {
    const workbox = pwaOptions.workbox ?? {};
    expect(workbox.runtimeCaching ?? []).toEqual([]);
    for (const pattern of workbox.globPatterns ?? []) {
      expect(pattern).toMatch(/\.\{?[a-z0-9,]+\}?$/);
      expect(pattern).not.toMatch(/json/);
    }
  });

  it("does not answer Gateway paths with the cached app shell", () => {
    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    const denied = (path: string) => denylist.some((re) => re.test(path));
    for (const path of [
      "/api/version",
      "/season/api/auth/me",
      "/ptr/api/game/time",
      "/room-history/shardSeason/W1N1/100.json",
      "/map-tiles/shard0/W1N1.png",
      "/season-static/season11/renderer/T.png",
    ]) {
      expect(denied(path), path).toBe(true);
    }
    expect(denied("/")).toBe(false);
    expect(denied("/rooms/W1N1")).toBe(false);
  });
});
