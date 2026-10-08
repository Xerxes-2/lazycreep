import { describe, expect, it } from "vitest";
import { MAP_LAYER, MAP_LAYERS, buildMapScene, type MapView } from "../map/map-scene.ts";
import { mapStateFrom } from "../map/map-state.ts";
import type { CirclePrimitive, LinePrimitive, Primitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { Nuke } from "../source/source.ts";
import { aggregatePvp, type PvpFeedData } from "./pvp-overview.ts";
import { pvpMapLayers } from "./pvp-map-layer.ts";

/** 102×102 的世界：W13S28 在世界坐标 (37, 79)，E0S0 在 (51, 51) */
const state = mapStateFrom({
  shard: "s",
  size: { width: 102, height: 102 },
  tiles: { room: () => "", block: () => "", sector: () => "" },
});

const nuke: Nuke = { id: "n1", shard: "s", room: "E0S0", x: 25, y: 10, landTime: 60_000, launchRoom: "W13S28" };
const data: PvpFeedData = {
  pvp: [
    {
      shard: "s",
      time: 1000,
      rooms: [
        { room: "W13S28", lastPvpTime: 1000 },
        { room: "E0S0", lastPvpTime: 950 },
        { room: "W50N50", lastPvpTime: 700 },
      ],
    },
  ],
  nukes: [nuke],
};

function scene(window: 20 | 100 | 500, view: Partial<MapView> = {}) {
  const group = aggregatePvp(data, window).find((g) => g.shard === "s");
  return buildMapScene(
    state,
    { theme: DEFAULT_THEME, zoom: 10, visible: { x0: 0, y0: 0, x1: 102, y1: 102 }, ...view },
    [...MAP_LAYERS, ...pvpMapLayers(group)],
  ).primitives;
}

const hotspots = (primitives: readonly Primitive[]) =>
  primitives.filter((p): p is CirclePrimitive => p.kind === "circle" && p.key.startsWith("pvp:"));

describe("PvP 热点层", () => {
  it("时间窗内有战斗的房间各一个热点，画在房间中央、highlight 层", () => {
    const spots = hotspots(scene(100));
    expect(spots.map((s) => s.key).sort()).toEqual(["pvp:E0S0", "pvp:W13S28"]);
    const w13s28 = spots.find((s) => s.key === "pvp:W13S28")!;
    expect(w13s28).toMatchObject({ x: 37.5, y: 79.5, layer: MAP_LAYER.highlight });
  });

  it("随时间窗变化", () => {
    expect(hotspots(scene(20)).map((s) => s.key)).toEqual(["pvp:W13S28"]);
    expect(hotspots(scene(500))).toHaveLength(3);
  });

  it("越近的战斗越醒目", () => {
    const spots = hotspots(scene(500));
    const alpha = (key: string) => spots.find((s) => s.key === key)!.alpha ?? 1;
    expect(alpha("pvp:W13S28")).toBeGreaterThan(alpha("pvp:E0S0"));
    expect(alpha("pvp:E0S0")).toBeGreaterThan(alpha("pvp:W50N50"));
    expect(alpha("pvp:W50N50")).toBeGreaterThan(0.2);
  });

  it("只画可见区域里的", () => {
    const spots = hotspots(scene(500, { visible: { x0: 30, y0: 70, x1: 45, y1: 85 } }));
    expect(spots.map((s) => s.key)).toEqual(["pvp:W13S28"]);
  });

  it("远看时热点至少有几个像素大", () => {
    const far = hotspots(scene(100, { zoom: 2 }))[0]!;
    expect(far.radius * 2).toBeGreaterThanOrEqual(6 / 2);
    const near = hotspots(scene(100, { zoom: 150 }))[0]!;
    expect(near.radius).toBeLessThan(0.5);
  });
});

describe("核弹标记", () => {
  it("在目标房间里的落点画标记，并从发射房间连一条线", () => {
    const primitives = scene(20);
    const marker = primitives.find((p): p is CirclePrimitive => p.key === "nuke:n1" && p.kind === "circle");
    expect(marker).toBeDefined();
    expect(marker!.x).toBeCloseTo(51 + 25.5 / 50);
    expect(marker!.y).toBeCloseTo(51 + 10.5 / 50);
    expect(marker!.layer).toBe(MAP_LAYER.highlight);
    const path = primitives.find((p): p is LinePrimitive => p.key === "nuke-path:n1" && p.kind === "line");
    expect(path!.points.slice(0, 2)).toEqual([37.5, 79.5]);
    expect(path!.points[2]).toBeCloseTo(marker!.x);
    expect(path!.points[3]).toBeCloseTo(marker!.y);
  });

  it("没有该 Shard 的数据时什么都不画", () => {
    const primitives = buildMapScene(
      state,
      { theme: DEFAULT_THEME, zoom: 10, visible: { x0: 0, y0: 0, x1: 102, y1: 102 } },
      [...MAP_LAYERS, ...pvpMapLayers(undefined)],
    ).primitives;
    expect(primitives.filter((p) => p.layer === MAP_LAYER.highlight)).toEqual([]);
  });
});
