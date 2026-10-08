import { describe, expect, it } from "vitest";
import type { ImagePrimitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { RoomUser } from "../source/source.ts";
import { badgeLayer } from "./map-badge-layer.ts";
import { buildMapScene } from "./map-scene.ts";
import { applyMapStats, mapStateFrom } from "./map-state.ts";

/** 102×102 的世界：W13S28 在世界坐标 (37, 79)，W12S28 在 (38, 79)，W14S28 在 (36, 79) */
const BADGE = { type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false };
const state = applyMapStats(
  mapStateFrom({
    shard: "s",
    size: { width: 102, height: 102 },
    tiles: { room: (r) => `/tile/${r}`, block: (r) => `/block/${r}`, sector: (r) => `/sector/${r}` },
  }),
  {
    shard: "s",
    gameTime: 1,
    rooms: {
      W13S28: { status: "normal", owner: { user: "a", level: 8 } },
      W12S28: { status: "normal", owner: { user: "b", level: 1 } },
      W14S28: { status: "normal", owner: { user: "a", level: 0 } },
      W15S28: { status: "normal" },
    },
    users: { a: { _id: "a", username: "A", badge: BADGE }, b: { _id: "b", username: "B" } },
  },
);

function badges(url: (userId: string, user: RoomUser | undefined) => string | undefined) {
  return buildMapScene(state, { theme: DEFAULT_THEME, zoom: 64, visible: { x0: 30, y0: 70, x1: 45, y1: 85 } }, [
    badgeLayer(url),
  ]).primitives as ImagePrimitive[];
}

const byKey = (list: readonly ImagePrimitive[]) => Object.fromEntries(list.map((p) => [p.key, p]));

describe("World Map 徽章图层", () => {
  it("已占领房间中央显示主人徽章，边长为 (0.05·RCL + 0.2) 个房间宽", () => {
    const out = byKey(badges((id) => `/badge/${id}`));
    expect(out["badge:W13S28"]).toMatchObject({ kind: "image", url: "/badge/a", x: 37.2, y: 79.2 });
    expect(out["badge:W13S28"]!.width).toBeCloseTo(0.6);
    expect(out["badge:W13S28"]!.height).toBeCloseTo(0.6);
    expect(out["badge:W13S28"]!.alpha ?? 1).toBe(1);
    expect(out["badge:W12S28"]).toMatchObject({ url: "/badge/b" });
    expect(out["badge:W12S28"]!.width).toBeCloseTo(0.25);
    expect(out["badge:W12S28"]!.x).toBeCloseTo(38.375);
  });

  it("被预定的房间显示预定者徽章：level 0 的尺寸、半透明", () => {
    const reserved = byKey(badges((id) => `/badge/${id}`))["badge:W14S28"]!;
    expect(reserved).toMatchObject({ url: "/badge/a", alpha: 0.5 });
    expect(reserved.width).toBeCloseTo(0.2);
    expect(reserved.x).toBeCloseTo(36.4);
  });

  it("无主房间没有徽章；贴图还没准备好的玩家先不画", () => {
    const out = byKey(badges((id) => (id === "a" ? "/badge/a" : undefined)));
    expect(Object.keys(out).sort()).toEqual(["badge:W13S28", "badge:W14S28"]);
  });

  it("查贴图时带上 map-stats 里该玩家的资料（含徽章）", () => {
    const seen = new Map<string, RoomUser | undefined>();
    badges((id, user) => {
      seen.set(id, user);
      return undefined;
    });
    expect(seen.get("a")).toMatchObject({ username: "A", badge: BADGE });
    expect(seen.get("b")).toMatchObject({ username: "B" });
  });
});
