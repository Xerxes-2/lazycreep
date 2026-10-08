import { describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import type { Badge } from "../badge/badge.ts";
import type { BadgeRasters } from "../badge/badge-image.ts";
import type { PlayerProfile, Source } from "../source/source.ts";
import { createMapBadges } from "./map-badges.ts";

const A: Badge = { type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false };
const B: Badge = { type: 5, color1: "#c8100b", color2: "#f8c420", color3: "#f8c420", param: -68, flip: false };

/** 位图缓存的替身：直接给出可辨认的 URL */
const rasters: BadgeRasters = {
  url: (server, userId, badge) => `${server}/${userId}/${badge ? String(badge.color1) : "none"}`,
};

function fakeSource(id: string, profiles: Record<string, PlayerProfile | undefined>) {
  const getPlayer = vi.fn(async (userId: string) => {
    const profile = profiles[userId];
    if (!profile) throw new Error("没有");
    return profile;
  });
  return { source: { server: { id }, getPlayer } as unknown as Source, getPlayer };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("World Map 徽章数据", () => {
  it("map-stats 带徽章时直接用，不补查", () =>
    createRoot(async (dispose) => {
      const { source, getPlayer } = fakeSource("season", {});
      const url = createMapBadges({ source: () => source, rasters });
      expect(url("u1", { _id: "u1", username: "U", badge: A })).toBe("season/u1/#ba0e09");
      expect(getPlayer).not.toHaveBeenCalled();
      dispose();
    }));

  it("map-stats 没给徽章时用 user/find 补查一次；查不到或没有徽章的给中性占位", () =>
    createRoot(async (dispose) => {
      const { source, getPlayer } = fakeSource("season", {
        u1: { id: "u1", username: "U", badge: A },
        sk: { id: "sk", username: "Source Keeper" },
      });
      const url = createMapBadges({ source: () => source, rasters });
      expect(url("u1", { _id: "u1", username: "U" })).toBeUndefined();
      expect(url("sk", undefined)).toBeUndefined();
      expect(url("gone", undefined)).toBeUndefined();
      url("u1", undefined);
      await flush();
      expect(url("u1", undefined)).toBe("season/u1/#ba0e09");
      expect(url("sk", undefined)).toBe("season/sk/none");
      expect(url("gone", undefined)).toBe("season/gone/none");
      expect(getPlayer.mock.calls.map(([id]) => id)).toEqual(["u1", "sk", "gone"]);
      dispose();
    }));

  it("换 Server（Source）后不沿用上一个 Server 查到的徽章", () =>
    createRoot(async (dispose) => {
      const mmo = fakeSource("mmo", { u1: { id: "u1", username: "U", badge: B } });
      const season = fakeSource("season", { u1: { id: "u1", username: "U", badge: A } });
      const [current, setCurrent] = createSignal(mmo.source);
      const url = createMapBadges({ source: current, rasters });
      url("u1", undefined);
      await flush();
      expect(url("u1", undefined)).toBe("mmo/u1/#c8100b");
      setCurrent(season.source);
      await flush();
      expect(url("u1", undefined)).toBeUndefined();
      await flush();
      expect(url("u1", undefined)).toBe("season/u1/#ba0e09");
      dispose();
    }));
});
