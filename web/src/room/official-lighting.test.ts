/**
 * #49、#64（ADR 0009）：官方画风的光照——显示选项“光照”开启时，Scene 带光照组：底色（地形模块）与各对象的光
 * （glow 与遮罩，滤色），参数照官方 metadata 的 lighting 部件。纯数据。
 */
import { describe, expect, it } from "vitest";
import type { CirclePrimitive, ImagePrimitive, Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { officialArtUrl } from "../art/official-art.ts";
import { officialTextureUrl } from "../art/official-textures.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { LIGHT_LAYER, LIGHTING_LAYER } from "./official-lighting.ts";
import { LAYER, buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

const users = { me1: { _id: "me1", username: "Me" } };
const official: RoomSceneView = { theme: DEFAULT_THEME, me: "me1" };
const lit = { ...DEFAULT_ROOM_DISPLAY, lighting: true };
const unlit = { ...DEFAULT_ROOM_DISPLAY, lighting: false };

type Objects = Record<string, Record<string, unknown>>;
const scene = (objects: Objects, view: RoomSceneView = official): Scene =>
  buildRoomScene({ state: roomStateFrom({ objects, users, gameTime: 100 }) }, view);

/** 对象 id 的光（glow 与遮罩） */
const lightsOf = (s: Scene, id: string) => s.primitives.filter((p) => p.key.startsWith(`lighting/${id}/`));
const glowsOf = (s: Scene, id: string) =>
  lightsOf(s, id).filter((p): p is ImagePrimitive => p.kind === "image" && p.url === officialTextureUrl("glow"));
/** glow 的宽度（官方单位，100 = 1 格）与透明度 */
const glowSpec = (s: Scene, id: string) =>
  glowsOf(s, id)
    .map((p) => [Math.round(p.width * 100), p.alpha ?? 1] as const)
    .sort((a, b) => a[0] - b[0]);

const BASE: Objects = {
  sp: { type: "spawn", x: 10, y: 10, user: "me1", store: { energy: 300 }, storeCapacityResource: { energy: 300 } },
  ex: { type: "extension", x: 12, y: 10, user: "me1", store: { energy: 0 }, storeCapacityResource: { energy: 50 } },
  so: { type: "source", x: 20, y: 20, energy: 3000, energyCapacity: 3000 },
  rd: { type: "road", x: 11, y: 11 },
  ct: { type: "creep", x: 15, y: 15, user: "me1", body: [] },
};

describe("官方画风的光照组（#64，ADR 0009）", () => {
  it("开启时 Scene 带光照组（层级 LAYER.lighting），组里是底色与各对象的光；关闭时一个都没有", () => {
    const on = scene(BASE, { ...official, display: lit });
    const off = scene(BASE, { ...official, display: unlit });
    expect(on.lighting).toEqual({ layer: LIGHTING_LAYER });
    expect(LIGHTING_LAYER).toBe(LAYER.lighting);
    expect(on.primitives.filter((p) => p.group === "lighting").map((p) => p.key)).toEqual([
      "lighting/ambient",
      ...on.primitives.filter((p) => p.key.startsWith("lighting/") && p.key !== "lighting/ambient").map((p) => p.key),
    ]);
    expect(off.lighting).toBeUndefined();
    expect(off.primitives.filter((p) => p.group === "lighting" || p.key.startsWith("lighting/"))).toEqual([]);
  });

  it("除了光照组，开与关只差道路颜色（打开时不预乘环境光）", () => {
    const strip = (s: Scene) =>
      s.primitives
        .filter((p) => p.group !== "lighting")
        .map((p) => (p.key === "rd/body" ? { ...p, fill: 0 } : p));
    expect(strip(scene(BASE, { ...official, display: lit }))).toEqual(strip(scene(BASE, { ...official, display: unlit })));
  });

  it("glow 以对象为中心、滤色、官方 alpha 原样、按官方染色，在光照组里，不能被点选", () => {
    const on = scene(BASE);
    const big = glowsOf(on, "so").find((p) => Math.round(p.width * 100) === 800)!;
    expect(big).toMatchObject({ x: 20.5 - 4, y: 20.5 - 4, width: 8, height: 8, alpha: 0.5, tint: 0xffff50, blend: "screen", group: "lighting", layer: LIGHT_LAYER });
    for (const p of lightsOf(on, "so")) expect(p.objectId).toBeUndefined();
  });

  it("层级在对象与 creep 之上；rampart、工地、名字与 RoomVisual 在它之上", () => {
    const on = scene(
      {
        ...BASE,
        ra: { type: "rampart", x: 15, y: 15, user: "me1", isPublic: true },
        cs: { type: "constructionSite", x: 30, y: 30, user: "me1", progress: 1, progressTotal: 2 },
      },
      { ...official, zoom: 40 },
    );
    expect(LIGHT_LAYER).toBeGreaterThan(LIGHTING_LAYER);
    expect(LIGHT_LAYER).toBeLessThan(LAYER.rampart);
    for (const p of on.primitives) {
      if (p.group === "lighting") continue;
      if (p.objectId === "cs" || p.objectId === "ra" || p.kind === "text") expect(p.layer, p.key).toBeGreaterThan(LIGHT_LAYER);
      else if (p.objectId) expect(p.layer, p.key).toBeLessThan(LIGHTING_LAYER);
    }
  });

  it("默认（不给显示选项）开启", () => {
    expect(scene(BASE).lighting).toBeDefined();
  });
});

describe("glow：大 glow 照亮周围，小 glow（有物资时）照亮对象自己", () => {
  const S = (objects: Objects) => scene(objects);

  it("spawn、extension、tower、link：有能量时多一个小 glow；extension 按容量 50 / 100 / 200 再加 200 / 220 / 250（0.7）", () => {
    const energy = (type: string, energy: number, capacity: number) => ({ type, x: 5, y: 5, user: "me1", store: { energy }, storeCapacityResource: { energy: capacity } });
    expect(glowSpec(S({ a: energy("spawn", 1, 300) }), "a")).toEqual([[100, 1], [600, 0.5]]);
    expect(glowSpec(S({ a: energy("spawn", 0, 300) }), "a")).toEqual([[600, 0.5]]);
    expect(glowSpec(S({ a: energy("extension", 1, 50) }), "a")).toEqual([[100, 1], [200, 0.7]]);
    expect(glowSpec(S({ a: energy("extension", 1, 100) }), "a")).toEqual([[100, 1], [220, 0.7]]);
    expect(glowSpec(S({ a: energy("extension", 1, 200) }), "a")).toEqual([[100, 1], [250, 0.7]]);
    expect(glowSpec(S({ a: energy("extension", 0, 200) }), "a")).toEqual([]);
    expect(glowSpec(S({ a: energy("tower", 10, 1000) }), "a")).toEqual([[100, 1], [600, 0.5]]);
    expect(glowSpec(S({ a: energy("tower", 0, 1000) }), "a")).toEqual([[600, 0.5]]);
    expect(glowSpec(S({ a: energy("link", 1, 800) }), "a")).toEqual([[100, 1], [400, 0.5]]);
    expect(glowSpec(S({ a: energy("link", 0, 800) }), "a")).toEqual([]);
  });

  it("container、storage、terminal、factory 有物资时；lab 有矿物时", () => {
    const store = (type: string, store: Record<string, number>) => ({ type, x: 5, y: 5, user: "me1", store });
    expect(glowSpec(S({ a: store("container", { H: 1 }) }), "a")).toEqual([[100, 1]]);
    expect(glowSpec(S({ a: store("container", {}) }), "a")).toEqual([]);
    for (const type of ["storage", "terminal", "factory"]) {
      expect(glowSpec(S({ a: store(type, { energy: 1 }) }), "a")).toEqual([[200, 1], [800, 0.5]]);
      expect(glowSpec(S({ a: store(type, {}) }), "a")).toEqual([[800, 0.5]]);
    }
    expect(glowSpec(S({ a: store("lab", { energy: 2000, H: 5 }) }), "a")).toEqual([[150, 1], [500, 0.3]]);
    expect(glowSpec(S({ a: store("lab", { energy: 2000 }) }), "a")).toEqual([]);
  });

  it("source 有能量时 150；mineral 200 + 按种类染色的 700；keeperLair 150；invaderCore 100；nuker 100；powerSpawn 150；portal 150；controller 有主人时 500", () => {
    expect(glowSpec(S({ a: { type: "source", x: 5, y: 5, energy: 1, energyCapacity: 3000 } }), "a")).toEqual([[150, 1], [800, 0.5]]);
    expect(glowSpec(S({ a: { type: "source", x: 5, y: 5, energy: 0, energyCapacity: 3000 } }), "a")).toEqual([[800, 0.5]]);
    const mineral = S({ a: { type: "mineral", x: 5, y: 5, mineralType: "K", mineralAmount: 1 } });
    expect(glowSpec(mineral, "a")).toEqual([[200, 1], [700, 0.7]]);
    expect(glowsOf(mineral, "a").map((p) => p.tint)).toEqual([undefined, 0x9370ff]);
    expect(glowSpec(S({ a: { type: "keeperLair", x: 5, y: 5 } }), "a")).toEqual([[150, 1], [800, 0.5]]);
    expect(glowSpec(S({ a: { type: "invaderCore", x: 5, y: 5 } }), "a")).toEqual([[100, 1], [800, 1]]);
    expect(glowSpec(S({ a: { type: "nuker", x: 5, y: 5, user: "me1" } }), "a")).toEqual([[100, 1], [800, 0.5]]);
    expect(glowSpec(S({ a: { type: "powerSpawn", x: 5, y: 5, user: "me1" } }), "a")).toEqual([[150, 1], [256, 0.5]]);
    expect(glowSpec(S({ a: { type: "portal", x: 5, y: 5 } }), "a")).toEqual([[150, 1], [700, 0.7]]);
    expect(glowSpec(S({ a: { type: "controller", x: 5, y: 5, user: "me1", level: 1 } }), "a")).toEqual([[500, 1], [1200, 0.5]]);
    expect(glowSpec(S({ a: { type: "controller", x: 5, y: 5, level: 0 } }), "a")).toEqual([[1200, 0.5]]);
  });
});

describe("遮罩：只照对象自己（与对象同形，滤色，alpha 1）", () => {
  const masksOf = (s: Scene, id: string) => lightsOf(s, id).filter((p) => !(p.kind === "image" && p.url === officialTextureUrl("glow")));

  it("玩家 creep：creep-mask（1 格）+ 400 的 glow（0.2）；孵化中什么都没有；NPC 没有遮罩，是 100 的 glow（0.5）", () => {
    const s = scene({
      c: { type: "creep", x: 15, y: 15, user: "me1", body: [] },
      baby: { type: "creep", x: 10, y: 9, user: "me1", body: [], spawning: true },
      npc: { type: "creep", x: 2, y: 2, user: "3", body: [] },
    });
    expect(masksOf(s, "c")).toEqual([
      expect.objectContaining({ kind: "image", url: officialTextureUrl("creep-mask"), x: 15, y: 15, width: 1, height: 1, blend: "screen", group: "lighting", layer: LIGHT_LAYER }),
    ]);
    expect(masksOf(s, "c")[0]!.alpha).toBeUndefined();
    expect(glowSpec(s, "c")).toEqual([[400, 0.2]]);
    expect(lightsOf(s, "baby")).toEqual([]);
    expect(masksOf(s, "npc")).toEqual([]);
    expect(glowSpec(s, "npc")).toEqual([[100, 0.5], [400, 0.2]]);
  });

  it("powerCreep：身体贴图本身（不染色）随朝向转；另有 400 的红色 glow", () => {
    const pc = { type: "powerCreep", x: 5, y: 5, user: "me1", className: "operator", level: 1 };
    const s = scene({ pc });
    const body = s.primitives.find((p) => p.key === "pc/body") as ImagePrimitive;
    const [mask] = masksOf(s, "pc") as ImagePrimitive[];
    expect(mask).toMatchObject({ url: body.url, x: body.x, y: body.y, width: body.width, blend: "screen", group: "lighting" });
    expect(mask!.tint).toBeUndefined();
    expect(glowsOf(s, "pc").map((p) => [p.width, p.tint])).toEqual([[4, 0xff5555]]);
  });

  it("deposit 的贴图（160，不染色）、tombstone / ruin 的 tombstone-resource（100）", () => {
    const s = scene({
      d: { type: "deposit", x: 5, y: 5, depositType: "mist" },
      t: { type: "tombstone", x: 7, y: 7, store: {} },
      r: { type: "ruin", x: 9, y: 9, store: {} },
    });
    expect(masksOf(s, "d")).toEqual([expect.objectContaining({ url: officialArtUrl("deposit-mist"), width: 1.6 })]);
    expect((masksOf(s, "d")[0] as ImagePrimitive).tint).toBeUndefined();
    expect(glowsOf(s, "d").map((p) => [p.width, p.tint])).toEqual([[7, 0xda6bf5]]);
    for (const id of ["t", "r"]) expect(masksOf(s, id)).toEqual([expect.objectContaining({ url: officialArtUrl("tombstone-resource"), width: 1 })]);
  });

  it("掉落资源：与对象自己的圆同色同大（resourceCircle 的光照副本）", () => {
    const s = scene({ e: { type: "energy", x: 5, y: 5, resourceType: "energy", energy: 625 } });
    const own = s.primitives.find((p) => p.key === "e/body") as CirclePrimitive;
    expect(masksOf(s, "e")).toEqual([{ ...own, key: "lighting/e/0", objectId: undefined, group: "lighting", blend: "screen", layer: LIGHT_LAYER }].map(({ objectId: _, ...p }) => p));
  });
});

describe("遮罩与 glow 随移动补间位移", () => {
  it("本 Tick 走了一格的 creep：它的遮罩与 glow 都带与身体相同的位移动画", () => {
    const at = (x: number, gameTime: number) => roomStateFrom({ gameTime, users, objects: { c: { type: "creep", x, y: 5, user: "me1", body: [] } } });
    const s = buildRoomScene({ state: at(6, 101), previous: at(5, 100) }, { ...official, tickMs: 1000 });
    const body = s.primitives.find((p) => p.key === "c/base")!;
    const lights = lightsOf(s, "c");
    expect(lights).toHaveLength(2);
    const motion = (p: Primitive) => p.animation?.tweens.filter((t) => t.property === "offsetX" || t.property === "offsetY");
    expect(motion(body)).toHaveLength(2);
    for (const p of lights) expect(motion(p)).toEqual(motion(body));
  });
});
