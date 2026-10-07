import { describe, expect, it } from "vitest";
import type { CirclePrimitive, Primitive, RectPrimitive, TextPrimitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { MapStats } from "../source/source.ts";
import { ICON_MIN_ZOOM, RCL_MIN_ZOOM } from "./map-info-layers.ts";
import { MAP_LAYER, buildMapScene, type MapView } from "./map-scene.ts";
import { applyMapStats, applyPowerBanks, mapStateFrom, withAllies, type MapState } from "./map-state.ts";

const ME = "me-id";
const ALLY = "ally-id";
const OTHER = "other-id";
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const tiles = { room: (room: string) => `/t/${room}.png`, block: (corner: string) => `/t/z2/${corner}.png` };

function world(stats: Partial<MapStats> = {}): MapState {
  const base = mapStateFrom({ shard: "s", size: { width: 102, height: 102 }, tiles, me: ME });
  return applyMapStats(base, { shard: "s", gameTime: 1, rooms: {}, users: {}, ...stats });
}

/** W13S28 在世界坐标 (37, 79) */
const W13S28 = { x: 37, y: 79 };

const state = world({
  rooms: {
    W13S28: { status: "normal", owner: { user: ME, level: 8 }, mineral: { type: "H", density: 2 } },
    W12S28: { status: "normal", owner: { user: ALLY, level: 5 } },
    W11S28: { status: "normal", owner: { user: OTHER, level: 3 } },
    W10S28: { status: "normal", owner: { user: ALLY, level: 0 } },
    W14S28: { status: "normal", novice: NOW + DAY },
    W15S28: { status: "normal", novice: NOW - DAY },
    W16S28: { status: "normal", respawnArea: NOW + DAY },
    W17S28: { status: "out of borders" },
    W18S28: { status: "normal", openTime: NOW + DAY },
  },
  users: {
    [ME]: { _id: ME, username: "Me" },
    [ALLY]: { _id: ALLY, username: "Alice" },
    [OTHER]: { _id: OTHER, username: "Bob" },
  },
});

function view(zoom: number, overrides: Partial<MapView> = {}): MapView {
  return { theme: DEFAULT_THEME, zoom, visible: { x0: 25, y0: 75, x1: 45, y1: 85 }, now: NOW, ...overrides };
}

const inLayer = (primitives: readonly Primitive[], layer: number) => primitives.filter((p) => p.layer === layer);
const byKey = (primitives: readonly Primitive[], key: string) => primitives.find((p) => p.key === key);

describe("World Map 信息层", () => {
  describe("新手区 / 重生区 / 禁区", () => {
    const zones = (zoom: number) => inLayer(buildMapScene(state, view(zoom)).primitives, MAP_LAYER.zone) as RectPrimitive[];

    it("仍有效的新手区、重生区各有覆盖，颜色不同；过期的新手区没有", () => {
      const all = zones(10);
      const novice = all.find((p) => p.key === "zone:W14S28");
      const respawn = all.find((p) => p.key === "zone:W16S28");
      expect(novice).toMatchObject({ kind: "rect", width: 1, height: 1 });
      expect(respawn).toBeDefined();
      expect(respawn!.fill).not.toBe(novice!.fill);
      expect(all.find((p) => p.key === "zone:W15S28")).toBeUndefined();
    });

    it("越界与尚未开放的房间压暗；普通房间没有覆盖", () => {
      const all = zones(10);
      const closed = all.find((p) => p.key === "zone:W17S28")!;
      expect(all.find((p) => p.key === "zone:W18S28")).toMatchObject({ fill: closed.fill });
      expect(all.find((p) => p.key === "zone:W13S28")).toBeUndefined();
    });

    it("远看近看都显示（整格覆盖本身就是远看的信息）", () => {
      expect(zones(2).map((p) => p.key).sort()).toEqual(zones(ICON_MIN_ZOOM * 2).map((p) => p.key).sort());
      expect(zones(2).length).toBe(4);
    });
  });

  describe("RCL", () => {
    const texts = (zoom: number) =>
      inLayer(buildMapScene(state, view(zoom)).primitives, MAP_LAYER.info).filter(
        (p): p is TextPrimitive => p.kind === "text" && p.key.startsWith("rcl:"),
      );

    it(`每房间不到 ${RCL_MIN_ZOOM} 像素时不显示数字`, () => {
      expect(texts(RCL_MIN_ZOOM * 0.9)).toEqual([]);
    });

    it("放大后占有的房间显示 RCL，预定的房间不显示", () => {
      const shown = texts(RCL_MIN_ZOOM);
      expect(Object.fromEntries(shown.map((p) => [p.key, p.text]))).toEqual({
        "rcl:W13S28": "8",
        "rcl:W12S28": "5",
        "rcl:W11S28": "3",
      });
      expect(byKey(shown, "rcl:W13S28")).toMatchObject({ x: W13S28.x + 0.5, y: W13S28.y + 0.5 });
    });
  });

  describe("矿物与 Power Bank", () => {
    const withBank = applyPowerBanks(state, "W11S28", [[10, 40]]);
    const icons = (zoom: number) => inLayer(buildMapScene(withBank, view(zoom)).primitives, MAP_LAYER.info);

    it(`每房间不到 ${ICON_MIN_ZOOM} 像素时不显示矿物与 Power Bank`, () => {
      const shown = icons(ICON_MIN_ZOOM * 0.9);
      expect(shown.filter((p) => p.key.startsWith("mineral:") || p.key.startsWith("pb:"))).toEqual([]);
    });

    it("放大后显示矿物类型", () => {
      expect(byKey(icons(ICON_MIN_ZOOM), "mineral:W13S28")).toMatchObject({ kind: "text", text: "H" });
    });

    it("Power Bank 画在它在房间里的位置", () => {
      const bank = byKey(icons(ICON_MIN_ZOOM), "pb:W11S28:0") as CirclePrimitive;
      expect(bank).toMatchObject({ kind: "circle", fill: DEFAULT_THEME.power });
      // W11S28 在世界 x = 39；格 (10, 40) 的中心
      expect(bank.x).toBeCloseTo(39 + 10.5 / 50);
      expect(bank.y).toBeCloseTo(79 + 40.5 / 50);
    });

    it("Power Bank 消失后不再画", () => {
      const gone = applyPowerBanks(withBank, "W11S28", []);
      expect(byKey(inLayer(buildMapScene(gone, view(ICON_MIN_ZOOM)).primitives, MAP_LAYER.info), "pb:W11S28:0")).toBeUndefined();
    });
  });

  describe("我方 / 盟友 / 陌生人", () => {
    const allied = withAllies(state, new Set(["alice"]));
    const scene = (s: MapState, zoom = 4) => buildMapScene(s, view(zoom)).primitives;
    const fill = (s: MapState, room: string) => (byKey(scene(s), `own:${room}`) as RectPrimitive).fill;

    it("所有权着色：我方用己方色，Ally List 里的玩家（不分大小写）用盟友色，其他人用陌生人色", () => {
      expect(fill(allied, "W13S28")).toBe(DEFAULT_THEME.owned);
      expect(fill(allied, "W12S28")).toBe(DEFAULT_THEME.ally);
      expect(fill(allied, "W10S28")).toBe(DEFAULT_THEME.ally);
      expect(DEFAULT_THEME.strangers).toContain(fill(allied, "W11S28"));
    });

    it("不在 Ally List 里时盟友按陌生人着色", () => {
      expect(DEFAULT_THEME.strangers).toContain(fill(state, "W12S28"));
    });

    it("我方与盟友占有的房间远看近看都有高亮框；陌生人与预定的房间没有", () => {
      for (const zoom of [2, ICON_MIN_ZOOM * 2]) {
        const marks = inLayer(scene(allied, zoom), MAP_LAYER.highlight) as RectPrimitive[];
        expect(marks.map((p) => p.key).sort()).toEqual(["mine:W12S28", "mine:W13S28"]);
        expect(byKey(marks, "mine:W13S28")).toMatchObject({ stroke: { color: DEFAULT_THEME.owned } });
        expect(byKey(marks, "mine:W12S28")).toMatchObject({ stroke: { color: DEFAULT_THEME.ally } });
      }
    });

    it("高亮框远看时不会粗到盖住整个房间", () => {
      const far = byKey(scene(allied, 2), "mine:W13S28") as RectPrimitive;
      expect(far.stroke!.width).toBeLessThan(0.5);
    });
  });
});
