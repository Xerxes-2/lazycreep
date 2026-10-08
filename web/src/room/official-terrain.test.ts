/**
 * #46：官方画风的地形与连接（墙 / 沼泽合并轮廓、道路连接、rampart 合并）与按房间的缓存。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officialArtUrl } from "../art/official-art.ts";
import { officialTextureUrl } from "../art/official-textures.ts";
import { compositeSvgText } from "../scene/image-sources.ts";
import type { ImagePrimitive, LinePrimitive, Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { Terrain } from "../source/source.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { createOfficialLayers, OFFICIAL_ROAD_COLOR } from "./official-terrain.ts";
import { LAYER, type PaintContext } from "./room-paint.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { reduceLiveTick, roomStateFrom, type RoomState } from "./room-state.ts";

const theme = DEFAULT_THEME;
const users = { me1: { _id: "me1", username: "Me" }, foe1: { _id: "foe1", username: "Foe" } };
const official: RoomSceneView = { theme, me: "me1" };

/** 50×50 的地形：cells 里的格子按给定代码（1 墙、2 沼泽） */
function terrainOf(cells: Record<string, number> = {}, room = "W1N1"): Terrain {
  const codes = Array.from({ length: 2500 }, () => "0");
  for (const [at, code] of Object.entries(cells)) {
    const [x, y] = at.split(",").map(Number);
    codes[y! * 50 + x!] = String(code);
  }
  return { shard: "shard0", room, encoded: codes.join("") };
}

type Objects = Record<string, Record<string, unknown>>;
const stateOf = (objects: Objects, gameTime = 1): RoomState => roomStateFrom({ gameTime, objects, users });
const sceneOf = (objects: Objects, terrain?: Terrain): Scene => buildRoomScene({ state: stateOf(objects), terrain }, official);

const byKey = (s: Scene, key: string) => s.primitives.find((p) => p.key === key);
const terrainImage = (s: Scene) => byKey(s, "official-terrain") as ImagePrimitive | undefined;
const svgOf = (p: ImagePrimitive | undefined) => compositeSvgText(p!.url)!;
const pathOf = (svg: string, id: string) => new RegExp(`<path id="${id}" d="([^"]*)"`).exec(svg)?.[1];
const roadLines = (s: Scene) =>
  s.primitives.filter((p): p is LinePrimitive => p.key.startsWith("official-road/")).map((p) => p.points.join(" "));

const road = (x: number, y: number) => ({ type: "road", x, y });
const terrainCtx = { ownerColor: () => 0x5d9cec } as unknown as PaintContext;

describe("官方画风：地形", () => {
  describe("加色混合（plus-lighter）的降级", () => {
    const terrain = terrainOf({ "1,1": 1, "4,4": 2 });
    const layerSvg = (blend: "plus-lighter" | "screen") =>
      svgOf(createOfficialLayers({ additiveBlend: blend }).layers(stateOf({}), terrain, terrainCtx)[0] as ImagePrimitive);

    it("支持 plus-lighter 时噪声纹理按官方的加色混合合成", () => {
      const svg = layerSvg("plus-lighter");
      expect(svg.match(/mix-blend-mode:plus-lighter/g)).toHaveLength(3);
    });

    it("不支持时改用 screen 近似，其余不变", () => {
      const add = layerSvg("plus-lighter");
      const screen = layerSvg("screen");
      expect(screen).not.toContain("plus-lighter");
      expect(screen.replace(/mix-blend-mode:screen/g, "")).toBe(add.replace(/mix-blend-mode:(plus-lighter|screen)/g, ""));
    });

    it("默认按浏览器是否支持选择", () => {
      const supports = vi.fn((property: string, value: string) => property === "mix-blend-mode" && value === "plus-lighter");
      vi.stubGlobal("CSS", { supports });
      try {
        expect(svgOf(createOfficialLayers().layers(stateOf({}), terrain, terrainCtx)[0] as ImagePrimitive)).toContain("plus-lighter");
        supports.mockReturnValue(false);
        expect(svgOf(createOfficialLayers().layers(stateOf({}), terrain, terrainCtx)[0] as ImagePrimitive)).not.toContain("plus-lighter");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("整块地形是一张铺满房间、在地形层的合成贴图；几何画风的逐行矩形不再出现", () => {
    const s = sceneOf({}, terrainOf({ "1,1": 1, "2,1": 1, "4,4": 2 }));
    expect(terrainImage(s)).toMatchObject({ kind: "image", layer: LAYER.terrain, x: 0, y: 0, width: 50, height: 50 });
    expect(s.primitives.filter((p) => p.key.startsWith("terrain/"))).toEqual([]);
  });

  it("相邻的墙格合成一条带圆角的轮廓；沼泽单独一条", () => {
    const svg = svgOf(terrainImage(sceneOf({}, terrainOf({ "1,1": 1, "2,1": 1, "4,4": 2 }))));
    // 两格墙：一个胶囊（左右两端是半圆，中间是直边）
    expect(pathOf(svg, "walls")).toBe(
      "M 100 150 a 50 50 0 0 1 50 -50 h 50 h 50 a 50 50 0 0 1 50 50 a 50 50 0 0 1 -50 50 h -50 h -50 a 50 50 0 0 1 -50 -50 Z ",
    );
    expect(pathOf(svg, "swamps")).toBe(
      "M 400 450 a 50 50 0 0 1 50 -50 a 50 50 0 0 1 50 50 a 50 50 0 0 1 -50 50 a 50 50 0 0 1 -50 -50 Z ",
    );
  });

  it("constructedWall 与自然墙合并在同一条轮廓里；对象本身叠一张加色的官方贴图", () => {
    const s = sceneOf({ w: { type: "constructedWall", x: 2, y: 1 } }, terrainOf({ "1,1": 1 }));
    expect(s.primitives.filter((p) => p.objectId === "w")).toEqual([
      expect.objectContaining({ kind: "image", url: officialArtUrl("constructedWall"), blend: "add", x: 2, y: 1, width: 1, height: 1 }),
    ]);
    const svg = svgOf(terrainImage(s));
    expect(pathOf(svg, "walls")).toMatch(/^M 100 150 a 50 50 0 0 1 50 -50 h 50 h 50 /);
    expect(pathOf(svg, "walls")!.match(/M /g)).toHaveLength(1);
  });

  it("官方噪声与地面纹理只以同源 URL 出现在贴图的 SVG 里，墙与沼泽的噪声用各自的轮廓裁剪", () => {
    const svg = svgOf(terrainImage(sceneOf({}, terrainOf({ "1,1": 1, "4,4": 2 }))));
    for (const name of ["ground", "ground-mask", "noise1", "noise2"] as const) expect(svg).toContain(`href="${officialTextureUrl(name)}"`);
    expect(svg).toMatch(/fill="url\(#wallNoise\)"[^>]*clip-path="url\(#wallClip\)"/);
    expect(svg).toMatch(/fill="url\(#swampNoiseA\)"[^>]*clip-path="url\(#swampClip\)"/);
  });

  it("没有装饰时的默认地形比官方原参数亮：墙底色 #1c1c1c、纹理加强、环境光 #8c8c8c（用户 2026-10-08 选定）", () => {
    const svg = svgOf(terrainImage(sceneOf({}, terrainOf({ "1,1": 1, "4,4": 2 }))));
    expect(svg).toContain(`<use href="#walls" fill="#1c1c1c"`);
    expect(svg).toMatch(/fill="url\(#wallNoise\)" opacity="0.3"/);
    expect(svg).toMatch(/fill="url\(#ground\)" opacity="0.7"/);
    expect(svg).toMatch(/fill="url\(#groundMask\)" opacity="0.3"/);
    expect(svg).toMatch(/<use href="#swamps" fill="#4a501e"[^>]*opacity="0.6"/);
    expect(svg).toMatch(/fill="url\(#swampNoiseA\)" opacity="0.15"/);
    expect(svg).toContain(`<rect x="0" y="0" width="5000" height="5000" fill="#8c8c8c"/>`);
  });

  it("地形还没到时没有地形贴图，道路照画", () => {
    const s = sceneOf({ a: road(1, 1), b: road(2, 1) });
    expect(terrainImage(s)).toBeUndefined();
    expect(roadLines(s)).toEqual(["1.5 1.5 2.5 1.5"]);
  });
});

describe("官方画风：道路连接", () => {
  it("八邻域相邻的道路连成线：横、竖、两条对角线；同方向连成一串的合成一条", () => {
    const s = sceneOf({
      a: road(5, 5),
      b: road(6, 5),
      c: road(7, 6), // b 的右下
      d: road(7, 7),
      e: road(7, 8),
      f: road(7, 9), // c–f 一串竖线
      g: road(20, 20),
      h: road(19, 21), // g 的左下
      lone: road(30, 30),
    });
    expect(roadLines(s).sort()).toEqual(
      ["5.5 5.5 6.5 5.5", "6.5 5.5 7.5 6.5", "7.5 6.5 7.5 9.5", "20.5 20.5 19.5 21.5"].sort(),
    );
    const line = byKey(s, "official-road/0/5/5") as LinePrimitive;
    expect(line).toMatchObject({ layer: LAYER.road, stroke: { color: OFFICIAL_ROAD_COLOR, width: 0.3 } });
  });

  it("每条道路仍是一个可点选的圆（官方半径 0.15 格）", () => {
    const s = sceneOf({ lone: road(30, 30) });
    expect(s.primitives.filter((p) => p.objectId === "lone")).toEqual([
      expect.objectContaining({ kind: "circle", x: 30.5, y: 30.5, radius: 0.15, layer: LAYER.road }),
    ]);
  });
});

describe("官方画风：rampart", () => {
  const rampart = (x: number, y: number, user: string, isPublic = false) => ({ type: "rampart", x, y, user, isPublic, hits: 1, hitsMax: 1 });

  it("非公开 rampart 按主人合并成一张加色混合的贴图，盖在 creep 上；每格只留一个不画东西的点选方块", () => {
    const s = sceneOf({ r1: rampart(10, 10, "me1"), r2: rampart(11, 10, "me1"), r3: rampart(30, 30, "foe1") });
    const mine = byKey(s, "official-rampart/me1") as ImagePrimitive;
    const theirs = byKey(s, "official-rampart/foe1") as ImagePrimitive;
    expect(mine).toMatchObject({ kind: "image", layer: LAYER.rampart, alpha: 0.4, blend: "add", width: 50, height: 50 });
    expect(LAYER.rampart).toBeGreaterThan(LAYER.creep);
    const svg = compositeSvgText(mine.url)!;
    expect(svg).toContain(
      'd="M 1000 1050 a 50 50 0 0 1 50 -50 h 50 h 50 a 50 50 0 0 1 50 50 a 50 50 0 0 1 -50 50 h -50 h -50 a 50 50 0 0 1 -50 -50 Z "',
    );
    // 主人色描边、主人色 × 0.3 填充
    expect(svg).toContain(`stroke="#5d9cec"`);
    expect(svg).toContain(`fill="#1c2f47"`);
    expect(compositeSvgText(theirs.url)).not.toContain(`stroke="#5d9cec"`);
    expect(s.primitives.filter((p) => p.objectId === "r1")).toEqual([
      { key: "r1/body", objectId: "r1", kind: "rect", layer: LAYER.rampart, x: 10, y: 10, width: 1, height: 1 },
    ]);
  });

  it("公开 rampart 逐格画官方 rampart 贴图，不进合并图层", () => {
    const s = sceneOf({ p: rampart(5, 5, "foe1", true) });
    expect(byKey(s, "official-rampart/foe1")).toBeUndefined();
    expect(s.primitives.filter((p) => p.objectId === "p")).toEqual([
      expect.objectContaining({ kind: "image", url: officialArtUrl("rampart"), alpha: 0.5, x: 5, y: 5, width: 1, height: 1 }),
    ]);
  });
});

describe("官方画风：按房间缓存，只在输入变化时重算", () => {
  const ctx = { ownerColor: () => 0x5d9cec } as unknown as PaintContext;
  const terrain = terrainOf({ "1,1": 1, "4,4": 2 });
  const base: Objects = {
    a: road(5, 5),
    b: road(6, 5),
    r: { type: "rampart", x: 9, y: 9, user: "me1" },
    w: { type: "constructedWall", x: 20, y: 20 },
  };
  const tick = (n: number): Objects => ({ ...base, creep: { type: "creep", x: n % 50, y: 3, user: "me1" } });

  it("地形、道路、rampart 不变时连续多个 Tick 不重算，图元原样复用", () => {
    const { layers, counters } = createOfficialLayers();
    const first = layers(stateOf(tick(0)), terrain, ctx);
    for (let n = 1; n < 10; n++) {
      const again = layers(stateOf(tick(n), n), terrain, ctx);
      expect(again).toHaveLength(first.length);
      again.forEach((p, i) => expect(p).toBe(first[i]));
    }
    expect(counters).toEqual({ terrain: 1, roads: 1, ramparts: 1 });
  });

  it("只重算变了的那一层；对象顺序不同但集合相同不算变化", () => {
    const { layers, counters } = createOfficialLayers();
    layers(stateOf(base), terrain, ctx);
    const more: Objects = { ...base, c: road(7, 5) };
    layers(stateOf(more), terrain, ctx);
    expect(counters).toEqual({ terrain: 1, roads: 2, ramparts: 1 });
    const walled: Objects = { ...more, w2: { type: "constructedWall", x: 21, y: 20 } };
    layers(stateOf(walled), terrain, ctx);
    expect(counters).toEqual({ terrain: 2, roads: 2, ramparts: 1 });
    const reversed = Object.fromEntries(Object.entries(walled).reverse());
    layers(stateOf(reversed), terrain, ctx);
    expect(counters).toEqual({ terrain: 2, roads: 2, ramparts: 1 });
  });

  it("buildRoomScene 在连续 Tick 里交给适配层的是同一批图元对象", () => {
    const one = buildRoomScene({ state: stateOf(tick(1)), terrain }, official);
    const two = buildRoomScene({ state: stateOf(tick(2), 2), terrain }, official);
    for (const key of ["official-terrain", "official-road/0/5/5", "official-rampart/me1"]) {
      expect(byKey(two, key), key).toBe(byKey(one, key));
    }
  });
});

describe("官方画风：录制的 W13S28", () => {
  const bundle = fixtureBundle(
    Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
  );
  let state: RoomState;
  let terrain: Terrain;
  let scene: Scene;

  beforeEach(async () => {
    vi.useFakeTimers();
    const source = new FixtureSource(bundle, { speed: Infinity });
    let s: RoomState | undefined;
    source.subscribeRoom("shardSeason", "W13S28", (t) => (s = reduceLiveTick(s, t)));
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    state = s!;
    terrain = await new FixtureSource(bundle).getTerrain("shardSeason", "W13S28");
    scene = buildRoomScene({ state, terrain }, official);
  });
  afterEach(() => vi.useRealTimers());

  it("墙与沼泽各合成为远少于格子数的子路径，路径闭合", () => {
    const svg = svgOf(terrainImage(scene));
    const count = (code: (c: number) => boolean) => [...terrain.encoded].filter((c) => code(Number(c))).length;
    const walls = pathOf(svg, "walls")!;
    const swamps = pathOf(svg, "swamps")!;
    const wallCells = count((c) => (c & 1) === 1);
    expect(wallCells).toBeGreaterThan(100);
    const subpaths = (p: string) => p.match(/M /g)?.length ?? 0;
    expect(subpaths(walls)).toBeGreaterThan(0);
    expect(subpaths(walls)).toBeLessThan(wallCells / 4);
    expect(subpaths(walls)).toBe(walls.match(/Z /g)!.length);
    if (count((c) => c === 2) > 0) expect(subpaths(swamps)).toBeGreaterThan(0);
  });

  it("任意两条八邻域相邻的道路之间都有一条连线经过", () => {
    const roads = Object.values(state.objects).filter((o) => o["type"] === "road");
    expect(roads.length).toBeGreaterThan(10);
    const at = new Set(roads.map((o) => `${o["x"]},${o["y"]}`));
    const lines = scene.primitives.filter((p): p is LinePrimitive => p.key.startsWith("official-road/"));
    const covered = (ax: number, ay: number, bx: number, by: number) =>
      lines.some(({ points: [x0, y0, x1, y1] }) => {
        const dx = Math.sign(x1! - x0!);
        const dy = Math.sign(y1! - y0!);
        if (dx !== bx - ax || dy !== by - ay) return false;
        const steps = Math.max(Math.abs(x1! - x0!), Math.abs(y1! - y0!));
        for (let k = 0; k < steps; k++) if (x0! - 0.5 + dx * k === ax && y0! - 0.5 + dy * k === ay) return true;
        return false;
      });
    let pairs = 0;
    for (const o of roads) {
      const x = o["x"] as number;
      const y = o["y"] as number;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        if (!at.has(`${x + dx},${y + dy}`)) continue;
        pairs++;
        expect(covered(x, y, x + dx, y + dy), `${x},${y} → ${x + dx},${y + dy}`).toBe(true);
      }
    }
    expect(pairs).toBeGreaterThan(5);
    // 没有多余的线：线段数之和等于相邻对数
    const total = lines.reduce((n, { points: [x0, y0, x1, y1] }) => n + Math.max(Math.abs(x1! - x0!), Math.abs(y1! - y0!)), 0);
    expect(total).toBe(pairs);
  });

  it("非公开 rampart 每个主人一张合并贴图", () => {
    const owners = new Set(
      Object.values(state.objects)
        .filter((o) => o["type"] === "rampart" && !o["isPublic"])
        .map((o) => o["user"]),
    );
    const merged = scene.primitives.filter((p: Primitive) => p.key.startsWith("official-rampart/"));
    expect(merged.map((p) => p.key.slice("official-rampart/".length)).sort()).toEqual([...owners].sort());
  });
});
