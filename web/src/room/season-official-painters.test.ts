/**
 * #47：官方画风下，赛季对象（reactor、钍矿、掉落的钍）用赛季服下发的贴图；
 * 没有配置、贴图还没加载好或加载失败时，这几类对象的输出与几何画法完全相同。
 */
import { describe, expect, it } from "vitest";
import { seasonArt, type SeasonArt } from "../art/season-art.ts";
import type { ImagePrimitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";
import { THORIUM } from "./season-painters.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);
const { renderer } = await new FixtureSource(bundle, { speed: Infinity }).getVersion();
if (!renderer) throw new Error("赛季版本录制里应有渲染器配置");

const theme = DEFAULT_THEME;
const users = { me1: { _id: "me1", username: "Me" } };
const ALL = new Set(["T", "reactor-core", "reactor-edge"]);

const OBJECTS = {
  r: { type: "reactor", x: 25, y: 25, user: "me1", store: { T: 500 }, storeCapacityResource: { T: 1000 } },
  idle: { type: "reactor", x: 10, y: 10, store: {}, storeCapacityResource: { T: 1000 } },
  m: { type: "mineral", x: 5, y: 5, mineralType: "T", mineralAmount: 1000 },
  h: { type: "mineral", x: 6, y: 6, mineralType: "H", mineralAmount: 1000 },
  d: { type: "energy", x: 7, y: 7, resourceType: "T", amount: 1000 },
  e: { type: "energy", x: 8, y: 8, resourceType: "energy", energy: 100 },
};

function scene(view: Partial<RoomSceneView>): Scene {
  return buildRoomScene({ state: roomStateFrom({ objects: OBJECTS, users }) }, { theme, me: "me1", ...view });
}

const images = (s: Scene, id: string) =>
  s.primitives.filter((p): p is ImagePrimitive => p.objectId === id && p.kind === "image");
const of = (s: Scene, id: string) => s.primitives.filter((p) => p.objectId === id);

describe("赛季对象的官方贴图", () => {
  it("有配置且贴图可用时：reactor 是 1.5 格的炉芯 + 外圈，按下发的同源地址引用", () => {
    const s = scene({ artStyle: "official", seasonArt: seasonArt(renderer, ALL) });
    expect(images(s, "r")).toEqual([
      expect.objectContaining({ url: "/season-static/season11/renderer/reactor-core.png", x: 24.75, y: 24.75, width: 1.5, height: 1.5 }),
      expect.objectContaining({ url: "/season-static/season11/renderer/reactor-edge.png", x: 24.75, y: 24.75, width: 1.5, height: 1.5 }),
    ]);
    // 有主人时有徽章位，没主人时没有
    expect(of(s, "r").some((p) => p.key === "r/badge")).toBe(true);
    expect(of(s, "idle").some((p) => p.key === "idle/badge")).toBe(false);
    expect(images(s, "idle")).toHaveLength(2);
  });

  it("钍矿用 1.28 格的钍贴图，掉落的钍按数量缩放；别的矿物与能量不受影响", () => {
    const s = scene({ artStyle: "official", seasonArt: seasonArt(renderer, ALL) });
    const geo = scene({ artStyle: "official" });
    expect(images(s, "m")).toEqual([
      expect.objectContaining({ url: "/season-static/season11/renderer/T.png", x: 4.86, y: 4.86, width: 1.28, height: 1.28 }),
    ]);
    const dropped = images(s, "d");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.url).toBe("/season-static/season11/renderer/T.png");
    expect(dropped[0]!.width).toBeGreaterThan(0.2);
    expect(dropped[0]!.width).toBeLessThan(1);
    expect(of(s, "h")).toEqual(of(geo, "h"));
    expect(of(s, "e")).toEqual(of(geo, "e"));
  });

  it("没有配置、贴图还没可用或加载失败时，赛季对象与几何画法完全相同", () => {
    const geometric = scene({});
    const cases: (SeasonArt | undefined)[] = [
      undefined,
      seasonArt(renderer, new Set()),
      seasonArt({ resources: {}, metadata: {} }, ALL),
      seasonArt({ resources: renderer.resources, metadata: {} }, ALL),
    ];
    const official = scene({ artStyle: "official" });
    for (const art of cases) {
      const s = scene({ artStyle: "official", ...(art ? { seasonArt: art } : {}) });
      // 赛季对象退回几何画法（#13），别的对象照官方画法
      for (const id of ["r", "idle", "m", "d"]) expect(of(s, id), id).toEqual(of(geometric, id));
      for (const id of ["h", "e"]) expect(of(s, id), id).toEqual(of(official, id));
      // 钍矿与掉落的钍是钍色，不是官方表里的灰色
      for (const id of ["m", "d"]) expect(of(s, id).find((p) => p.key === `${id}/body`), id).toMatchObject({ fill: THORIUM });
    }
  });

  it("只有炉芯可用、外圈失败时 reactor 整个退回几何，不画半个", () => {
    const s = scene({ artStyle: "official", seasonArt: seasonArt(renderer, new Set(["reactor-core", "T"])) });
    expect(of(s, "r")).toEqual(of(scene({}), "r"));
    expect(images(s, "m")).toHaveLength(1);
  });

  it("几何画风不用赛季贴图", () => {
    const s = scene({ seasonArt: seasonArt(renderer, ALL) });
    expect(of(s, "r")).toEqual(of(scene({}), "r"));
    expect(images(s, "m")).toEqual([]);
  });
});
