/**
 * #45：其余对象在官方画风（Art Style = 官方）下的 Scene 输出：贴图、资源量、controller 等级样式。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officialArtUrl, type OfficialSvgName } from "../art/official-art.ts";
import type { ImagePrimitive, Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { reduceLiveTick, roomStateFrom, type RoomState } from "./room-state.ts";

const theme = DEFAULT_THEME;
const users = { me1: { _id: "me1", username: "Me" }, foe1: { _id: "foe1", username: "Foe" } };
const official: RoomSceneView = { theme, me: "me1", artStyle: "official" };
const geometric: RoomSceneView = { ...official, artStyle: "geometric" };

type Objects = Record<string, Record<string, unknown>>;
function scene(objects: Objects, view: RoomSceneView = official, gameTime?: number): Scene {
  return buildRoomScene({ state: { ...roomStateFrom({ objects, users }), gameTime } }, view);
}
const of = (s: Scene, id: string) => s.primitives.filter((p) => p.objectId === id);
const part = (s: Scene, id: string, name: string) => s.primitives.find((p) => p.key === `${id}/${name}`);
const urls = (s: Scene, id: string) => of(s, id).flatMap((p) => (p.kind === "image" ? [p.url] : []));
const art = (...names: OfficialSvgName[]) => names.map(officialArtUrl);
const image = (s: Scene, id: string, name: string) => part(s, id, name) as ImagePrimitive | undefined;

/** 一个图元的“大小”：矩形面积、圆半径、图片宽、多边形外接框面积 */
function size(p: Primitive | undefined): number {
  if (!p) return 0;
  switch (p.kind) {
    case "rect":
      return p.width * p.height;
    case "circle":
      return p.radius;
    case "image":
      return p.width * p.height;
    case "polygon":
    case "line": {
      const xs = p.points.filter((_, i) => i % 2 === 0);
      const ys = p.points.filter((_, i) => i % 2 === 1);
      // 扇形 / 弧用点数近似覆盖的角度
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) + p.points.length * 1e-6;
    }
    default:
      return 0;
  }
}

describe("官方画风：每类对象用对应的官方贴图", () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    ["terminal", { user: "me1", store: { energy: 1000 }, storeCapacity: 300000 }, art("terminal-border", "terminal", "terminal-arrows")],
    ["link", { user: "me1", store: { energy: 400 }, storeCapacityResource: { energy: 800 } }, art("link-border", "link", "link-energy")],
    ["lab", { user: "me1", store: { energy: 0 } }, art("lab", "lab-mineral")],
    ["factory", { user: "me1", store: {}, storeCapacity: 50000 }, art("factory-border", "factory", "factory-highlight", "factory-lvl0", "rectangle")],
    ["nuker", { user: "me1", store: {} }, art("nuker-border", "nuker")],
    ["extractor", { user: "me1" }, art("extractor")],
    ["container", { store: {}, storeCapacity: 2000 }, art("rectangle", "rectangle")],
    ["tombstone", { user: "foe1", store: {} }, art("tombstone-border", "tombstone-resource")],
    ["ruin", { store: {} }, art("ruin", "tombstone-resource")],
    ["powerBank", { store: { power: 3000 } }, art("powerBank")],
    ["invaderCore", { user: "2" }, art("invaderCore")],
    ["deposit", { depositType: "mist", harvested: 0 }, art("deposit-mist-fill", "deposit-mist")],
    ["nuke", { landTime: 2000 }, art("nuke")],
  ])("%s", (type, fields, expected) => {
    const s = scene({ o: { type, x: 10, y: 10, ...fields } }, official, 1000);
    expect(urls(s, "o")).toEqual(expected);
  });

  it("按主人染色的部件：terminal、link、lab、factory、nuker、extractor 的贴图，observer 的图形", () => {
    const tinted = { terminal: "border", link: "border", lab: "body", factory: "border", nuker: "border", extractor: "body" };
    const objects: Objects = { obs: { type: "observer", x: 1, y: 1, user: "me1" } };
    for (const type of Object.keys(tinted)) objects[type] = { type, x: 5, y: 5, user: "me1", store: {} };
    objects["foe"] = { type: "lab", x: 7, y: 7, user: "foe1", store: {} };
    const s = scene(objects);
    for (const [type, p] of Object.entries(tinted)) expect(image(s, type, p)?.tint).toBe(theme.owned);
    expect(image(s, "foe", "body")!.tint).not.toBe(theme.owned);
    // 主体贴图本身不染色
    expect(image(s, "terminal", "body")!.tint).toBeUndefined();
    expect(part(s, "obs", "eye")).toMatchObject({ fill: theme.owned });
    expect(part(s, "obs", "body")).toMatchObject({ stroke: expect.objectContaining({ color: theme.owned }) });
  });

  it("只有图形的对象照官方画：mineral、掉落资源、keeper lair、portal、power spawn、construction site", () => {
    const s = scene({
      min: { type: "mineral", x: 1, y: 1, mineralType: "K", mineralAmount: 35000 },
      res: { type: "energy", x: 2, y: 2, energy: 625, resourceType: "energy" },
      lair: { type: "keeperLair", x: 3, y: 3 },
      portal: { type: "portal", x: 4, y: 4 },
      ps: { type: "powerSpawn", x: 5, y: 5, user: "me1", store: { energy: 2500, power: 50 }, storeCapacityResource: { energy: 5000, power: 100 } },
      site: { type: "constructionSite", x: 6, y: 6, user: "me1", progress: 150, progressTotal: 300 },
    });
    expect(part(s, "min", "body")).toMatchObject({ kind: "circle", radius: 0.54, fill: 0x331a80, stroke: { color: 0x9370ff } });
    expect(part(s, "min", "kind")).toMatchObject({ kind: "text", text: "K", color: 0x9370ff });
    // energy：半径 30 × 625 / 1250
    expect(part(s, "res", "body")).toMatchObject({ kind: "circle", radius: 0.15, fill: 0xffe56d });
    expect(part(s, "lair", "body")).toMatchObject({ kind: "circle", radius: 0.6, fill: 0x000000 });
    expect(part(s, "portal", "ring")).toMatchObject({ kind: "circle", fill: 0x61c0ed, alpha: 0.5 });
    expect(part(s, "ps", "ring")).toMatchObject({ kind: "circle", radius: 0.68, stroke: { color: 0xf41f33 } });
    expect(part(s, "ps", "energy")).toMatchObject({ kind: "circle", radius: 0.19 });
    expect(part(s, "ps", "power")).toMatchObject({ kind: "line" });
    expect(part(s, "site", "body")).toMatchObject({ kind: "circle", stroke: expect.objectContaining({ color: theme.owned }) });
    expect(part(s, "site", "progress")).toMatchObject({ kind: "polygon", fill: theme.owned });
    // 盖在 creep 之上（官方 effects 图层）
    const creepLayer = of(scene({ c: { type: "creep", x: 1, y: 1 } }), "c")[0]!.layer;
    expect(part(s, "site", "body")!.layer).toBeGreaterThan(creepLayer);
  });

  it("随时间变化的部分按当前 Tick：墓碑随衰减变淡，terminal 冷却时箭头变淡，已落地的 nuke 不画", () => {
    const objects: Objects = {
      tomb: { type: "tombstone", x: 1, y: 1, deathTime: 1000, decayTime: 1100, store: {} },
      term: { type: "terminal", x: 3, y: 3, user: "me1", store: {}, cooldownTime: 1050 },
      nuke: { type: "nuke", x: 5, y: 5, landTime: 1040 },
    };
    const early = scene(objects, official, 1010);
    const late = scene(objects, official, 1060);
    expect(image(early, "tomb", "body")!.alpha!).toBeGreaterThan(image(late, "tomb", "body")!.alpha!);
    expect(image(early, "term", "arrows")!.alpha).toBe(0.1);
    expect(image(late, "term", "arrows")!.alpha).toBeUndefined();
    expect(of(early, "nuke")).not.toEqual([]);
    expect(of(late, "nuke")).toEqual([]);
  });
});

describe("官方画风：资源量从空到满单调变化", () => {
  const steps = [0, 0.1, 0.25, 0.5, 0.75, 1];
  const monotonic = (values: number[]) => {
    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
  };
  it.each<[string, string, (f: number) => Record<string, unknown>]>([
    ["container", "energy", (f) => ({ store: { energy: 2000 * f }, storeCapacity: 2000 })],
    ["terminal", "energy", (f) => ({ store: { energy: 300000 * f }, storeCapacity: 300000 })],
    ["factory", "energy", (f) => ({ store: { energy: 50000 * f }, storeCapacity: 50000 })],
    ["link", "energy", (f) => ({ store: { energy: 800 * f }, storeCapacityResource: { energy: 800 } })],
    ["lab", "energy", (f) => ({ store: { energy: 2000 * f }, storeCapacityResource: { energy: 2000, XGH2O: 3000 } })],
    ["lab", "mineral", (f) => ({ store: { XGH2O: 3000 * f }, storeCapacityResource: { energy: 2000, XGH2O: 3000 } })],
    ["nuker", "energy", (f) => ({ store: { energy: 300000 * f }, storeCapacityResource: { energy: 300000, G: 5000 } })],
    ["nuker", "ghodium", (f) => ({ store: { G: 5000 * f }, storeCapacityResource: { energy: 300000, G: 5000 } })],
    ["powerSpawn", "energy", (f) => ({ store: { energy: 5000 * f }, storeCapacityResource: { energy: 5000, power: 100 } })],
    ["powerSpawn", "power", (f) => ({ store: { power: 100 * f }, storeCapacityResource: { energy: 5000, power: 100 } })],
    ["powerBank", "power", (f) => ({ store: { power: 5000 * f } })],
    ["energy", "body", (f) => ({ resourceType: "energy", energy: 1250 * f })],
    ["constructionSite", "progress", (f) => ({ progress: 300 * f, progressTotal: 300 })],
  ])("%s 的 %s", (type, name, fields) => {
    monotonic(steps.map((f) => size(part(scene({ o: { type, x: 10, y: 10, user: "me1", ...fields(f) } }), "o", name))));
  });

  it("deposit 的填充随开采次数变淡", () => {
    const alpha = (harvested: number) => image(scene({ d: { type: "deposit", x: 1, y: 1, depositType: "metal", harvested } }), "d", "fill")?.alpha ?? 0;
    expect(alpha(0)).toBeGreaterThan(alpha(20000));
    expect(alpha(20000)).toBeGreaterThan(alpha(50000));
    expect(alpha(60000)).toBe(0);
  });

  it("墓碑有资源时内芯是主人色，空了是黑色", () => {
    const tint = (store: Record<string, number>) => image(scene({ t: { type: "tombstone", x: 1, y: 1, user: "foe1", store } }), "t", "resource")!.tint;
    expect(tint({ energy: 10 })).not.toBe(0x000000);
    expect(tint({})).toBe(0x000000);
  });
});

describe("官方画风：controller 按等级的样式", () => {
  it("等级刻度数随 RCL 增加，升级进度画成扇形，8 级没有进度", () => {
    const at = (level: number, progress = 0) => scene({ c: { type: "controller", x: 25, y: 25, user: "me1", level, progress } });
    const signature = (s: Scene) => JSON.stringify(of(s, "c").map((p) => p.key));
    const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => signature(at(l)));
    expect(new Set(levels).size).toBe(9);
    const half = part(at(3, 67500), "c", "progress");
    const quarter = part(at(3, 33750), "c", "progress");
    expect(half).toMatchObject({ kind: "polygon", fill: 0xffffff });
    expect(size(half)).toBeGreaterThan(size(quarter));
    expect(part(at(8, 1000), "c", "progress")).toBeUndefined();
  });
});

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

async function finalState(room: string): Promise<RoomState> {
  const source = new FixtureSource(bundle, { speed: Infinity });
  let state: RoomState | undefined;
  source.subscribeRoom("shardSeason", room, (tick) => (state = reduceLiveTick(state, tick)));
  await vi.runAllTimersAsync();
  return state!;
}

/** 由别的票接手的类型：creep（#48）、赛季对象（#47）；道路 / rampart / 墙已由 #46 接手 */
const OTHER_TICKETS = new Set(["creep", "powerCreep", "reactor"]);

describe("官方画风：录制房间里的对象都不再落到几何画法", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["W13S28", "E13N21"])("%s", async (room) => {
    const state = await finalState(room);
    vi.useRealTimers();
    const view = { theme, zoom: 40 };
    const a = buildRoomScene({ state }, { ...view, artStyle: "official" });
    const b = buildRoomScene({ state }, { ...view, artStyle: "geometric" });
    const byObject = (s: Scene) => {
      const map = new Map<string, Primitive[]>();
      for (const p of s.primitives) if (p.objectId) map.set(p.objectId, [...(map.get(p.objectId) ?? []), p]);
      return map;
    };
    const officialObjects = byObject(a);
    const geometricObjects = byObject(b);
    const checked = new Set<string>();
    for (const [id, obj] of Object.entries(state.objects)) {
      const type = String(obj["type"]);
      if (OTHER_TICKETS.has(type) || obj["x"] === undefined) continue;
      // 钍矿与掉落的钍（#47）：没有赛季贴图时有意退回几何画法的钍色
      if (obj["mineralType"] === "T" || obj["resourceType"] === "T") continue;
      checked.add(type);
      expect({ id, type, same: JSON.stringify(officialObjects.get(id)) === JSON.stringify(geometricObjects.get(id)) }).toEqual({ id, type, same: false });
    }
    expect(checked.size).toBeGreaterThan(3);
  });
});
