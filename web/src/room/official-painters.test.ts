/**
 * #42：官方画风（Art Style = 官方）下 buildRoomScene 的输出。
 */
import { describe, expect, it } from "vitest";
import { officialArtUrl } from "../art/official-art.ts";
import type { ImagePrimitive, Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { BAR_MIN_ZOOM } from "./room-detail-rules.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

const theme = DEFAULT_THEME;
const users = {
  me1: { _id: "me1", username: "Me" },
  ally1: { _id: "ally1", username: "Friend" },
  foe1: { _id: "foe1", username: "Foe" },
};
const official: RoomSceneView = { theme, me: "me1", allies: new Set(["friend"]), artStyle: "official" };

function scene(objects: Record<string, Record<string, unknown>>, view: RoomSceneView = official): Scene {
  return buildRoomScene({ state: roomStateFrom({ objects, users }) }, view);
}

const of = (s: Scene, id: string) => s.primitives.filter((p) => p.objectId === id);
const images = (s: Scene, id: string) => of(s, id).filter((p): p is ImagePrimitive => p.kind === "image");
const urls = (s: Scene, id: string) => images(s, id).map((p) => p.url);
const imageOf = (s: Scene, id: string, name: Parameters<typeof officialArtUrl>[0]) =>
  images(s, id).find((p) => p.url === officialArtUrl(name));

describe("官方画风：贴图", () => {
  it("extension 按容量用对应边框，主体随容量变大，边框按主人染色", () => {
    const s = scene({
      e50: { type: "extension", x: 1, y: 1, user: "me1", store: { energy: 0 }, storeCapacityResource: { energy: 50 } },
      e200: { type: "extension", x: 3, y: 1, user: "me1", store: { energy: 200 }, storeCapacityResource: { energy: 200 } },
    });
    expect(urls(s, "e50")).toEqual([officialArtUrl("extension-border50"), officialArtUrl("extension")]);
    expect(urls(s, "e200")).toEqual([officialArtUrl("extension-border200"), officialArtUrl("extension")]);
    expect(imageOf(s, "e50", "extension-border50")).toMatchObject({ x: 1, y: 1, width: 1, height: 1, tint: theme.owned });
    expect(imageOf(s, "e50", "extension")!.width).toBeCloseTo(0.68);
    expect(imageOf(s, "e200", "extension")!.width).toBeCloseTo(1);
  });

  it("storage 是 2×2 的边框 + 主体，边框染色、主体不染色", () => {
    const s = scene({ st: { type: "storage", x: 10, y: 10, user: "foe1", store: { energy: 1000 }, storeCapacity: 1000000 } });
    expect(urls(s, "st")).toEqual([officialArtUrl("storage-border"), officialArtUrl("storage")]);
    const border = imageOf(s, "st", "storage-border")!;
    expect(border).toMatchObject({ x: 9.5, y: 9.5, width: 2, height: 2 });
    expect(border.tint).not.toBeUndefined();
    expect(border.tint).not.toBe(theme.owned);
    expect(imageOf(s, "st", "storage")!.tint).toBeUndefined();
  });

  it("tower：底座按主人染色，炮塔朝向本 Tick 的射击目标旋转；NPC 用 NPC 炮塔", () => {
    const s = scene({
      t: { type: "tower", x: 20, y: 20, user: "me1", actionLog: { attack: { x: 20, y: 10 } } },
      idle: { type: "tower", x: 30, y: 20, user: "me1" },
      npc: { type: "tower", x: 40, y: 20, user: "2" },
    });
    expect(imageOf(s, "t", "tower-base")).toMatchObject({ width: 2, height: 2, tint: theme.owned });
    const turret = imageOf(s, "t", "tower-rotatable")!;
    // 目标在正上方：炮管（默认朝下）转半圈；绕塔中心旋转
    expect(turret.rotation).toBeCloseTo(Math.PI);
    expect(turret).toMatchObject({ pivotX: 20.5, pivotY: 20.5 });
    expect(imageOf(s, "idle", "tower-rotatable")!.rotation ?? 0).toBe(0);
    expect(urls(s, "npc")).toContain(officialArtUrl("tower-rotatable-npc"));
    expect(urls(s, "npc")).not.toContain(officialArtUrl("tower-rotatable"));
  });

  it("controller：黑色底座，等级几级就有几段等级刻度，每段转 1/8 圈", () => {
    const s = scene({ c: { type: "controller", x: 25, y: 25, user: "me1", level: 3 } });
    expect(imageOf(s, "c", "controller")).toMatchObject({ x: 24.5, y: 24.5, width: 2, height: 2, tint: 0x000000 });
    const levels = images(s, "c").filter((p) => p.url === officialArtUrl("controller-level"));
    expect(levels.map((p) => p.rotation ?? 0)).toEqual([0, Math.PI / 4, Math.PI / 2]);
    // 刻度在中心上方，绕中心旋转
    for (const p of levels) expect(p).toMatchObject({ x: 25, y: 24.5, width: 1, height: 1, pivotX: 25.5, pivotY: 25.5 });
    const unowned = scene({ c: { type: "controller", x: 25, y: 25, level: 0 } });
    expect(images(unowned, "c").filter((p) => p.url === officialArtUrl("controller-level"))).toEqual([]);
  });

  it("spawn 与 source 照官方画法（官方本身就用图形画它们，没有贴图）", () => {
    const s = scene({
      sp: { type: "spawn", x: 5, y: 5, user: "me1", store: { energy: 150 }, storeCapacityResource: { energy: 300 } },
      so: { type: "source", x: 7, y: 7, energy: 1500, energyCapacity: 3000 },
    });
    const sp = of(s, "sp");
    // 浅灰外圈 r=0.7、黑色内圈、主人色的徽章位、按能量比例缩放的能量圈
    expect(sp).toContainEqual(expect.objectContaining({ kind: "circle", x: 5.5, y: 5.5, radius: 0.7, fill: 0xcccccc }));
    expect(sp).toContainEqual(expect.objectContaining({ kind: "circle", radius: 0.59, fill: 0x181818 }));
    expect(sp).toContainEqual(expect.objectContaining({ kind: "circle", radius: 0.38, fill: theme.owned }));
    expect(sp).toContainEqual(expect.objectContaining({ kind: "circle", radius: 0.19, fill: 0xffe56d }));
    const so = of(s, "so").filter((p): p is Extract<Primitive, { kind: "rect" }> => p.kind === "rect");
    expect(so.map((p) => p.width)).toEqual([0.4, 0.3]);
    expect(so[1]!.fill).toBe(0xffe56d);
  });
});

describe("官方画风：染色按我方 / 盟友 / 陌生人", () => {
  it("三种主人的边框颜色与几何画风的主人色一致", () => {
    const objects = {
      mine: { type: "extension", x: 1, y: 1, user: "me1" },
      ally: { type: "extension", x: 2, y: 1, user: "ally1" },
      foe: { type: "extension", x: 3, y: 1, user: "foe1" },
      creep: { type: "creep", x: 4, y: 1, user: "foe1" },
    };
    const s = scene(objects);
    const tint = (id: string) => images(s, id)[0]!.tint;
    expect(tint("mine")).toBe(theme.owned);
    expect(tint("ally")).toBe(theme.ally);
    // 陌生人与几何画风 creep 的主人色相同
    const creepFill = of(scene(objects, { ...official, artStyle: "geometric" }), "creep").find((p) => p.kind === "circle");
    expect(tint("foe")).toBe(creepFill && "fill" in creepFill ? creepFill.fill : undefined);
    expect(new Set([tint("mine"), tint("ally"), tint("foe")]).size).toBe(3);
  });
});

describe("官方画风：没有映射的类型退回几何画法", () => {
  it("未知类型与几何画风输出相同", () => {
    const objects = {
      odd: { type: "scoreCollector", x: 3, y: 3 },
    };
    const view = { ...official, zoom: BAR_MIN_ZOOM + 1 };
    const a = scene(objects, view);
    const b = scene(objects, { ...view, artStyle: "geometric" });
    for (const id of Object.keys(objects)) expect(of(a, id)).toEqual(of(b, id));
  });

  it("官方画风不叠加通用血条与资源条；选中高亮照常", () => {
    const view = { ...official, zoom: BAR_MIN_ZOOM + 1, selectedId: "t" };
    const objects = {
      t: { type: "tower", x: 20, y: 20, user: "foe1", hits: 1000, hitsMax: 3000 },
      r: { type: "reactor", x: 25, y: 25, user: "foe1", store: { T: 500 }, storeCapacityResource: { T: 1000 } },
    };
    const s = scene(objects, view);
    expect(s.primitives.filter((p) => p.kind === "bar")).toEqual([]);
    expect(of(s, "t").map((p) => p.key.split("/")[1])).toContain("selected");
  });

  it("几何画风仍然叠加血条与资源条", () => {
    const s = scene(
      { t: { type: "tower", x: 20, y: 20, user: "foe1", hits: 1000, hitsMax: 3000 } },
      { ...official, artStyle: "geometric", zoom: BAR_MIN_ZOOM + 1 },
    );
    expect(of(s, "t").map((p) => p.key.split("/")[1])).toContain("hits");
  });
});

describe("tower 能量条与炮塔对齐（官方 tower.metadata.js）", () => {
  // 官方能量条是炮塔精灵的子 Graphics：本地像素坐标 (-45, 0, 90, h)，经炮塔缩放 115/128（SVG 原始 128px）
  // 并以 pivot y=32 为旋转中心，所以世界坐标（官方单位）为 x ∈ ±45·s，y ∈ [-32, -32 + h·s]，s = 115/128。
  const s = 115 / 128;
  const full = { type: "tower", x: 20, y: 20, user: "me1", store: { energy: 1000 }, storeCapacityResource: { energy: 1000 } };
  const half = { ...full, store: { energy: 500 } };
  const energyPoints = (sc: Scene, id: string) => {
    const p = sc.primitives.find((q) => q.objectId === id && q.key === `${id}/energy`);
    if (p?.kind !== "polygon") throw new Error(`没有能量条：${JSON.stringify(p)}`);
    const xs = p.points.filter((_, i) => i % 2 === 0);
    const ys = p.points.filter((_, i) => i % 2 === 1);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };

  it("满能量、未旋转：条从塔中心上方 0.32 格开始，长 66.7·s/100 格，宽 90·s/100 格", () => {
    const b = energyPoints(scene({ t: full }), "t");
    const cx = 20.5;
    const cy = 20.5;
    expect(b.minY - cy).toBeCloseTo(-0.32, 3);
    expect(b.maxY - cy).toBeCloseTo(-0.32 + (66.7 * s) / 100, 3);
    expect(b.minX - cx).toBeCloseTo((-45 * s) / 100, 3);
    expect(b.maxX - cx).toBeCloseTo((45 * s) / 100, 3);
  });

  it("半能量：条的上沿不变，长度减半", () => {
    const b = energyPoints(scene({ t: half }), "t");
    expect(b.minY - 20.5).toBeCloseTo(-0.32, 3);
    expect(b.maxY - b.minY).toBeCloseTo((33.35 * s) / 100, 3);
  });

  it("能量条整体落在炮塔贴图之内（未旋转时）", () => {
    const sc = scene({ t: full });
    const turret = imageOf(sc, "t", "tower-rotatable")!;
    const b = energyPoints(sc, "t");
    expect(b.minY).toBeGreaterThanOrEqual(turret.y - 1e-9);
    expect(b.maxY).toBeLessThanOrEqual(turret.y + turret.height + 1e-9);
    expect(b.minX).toBeGreaterThanOrEqual(turret.x - 1e-9);
    expect(b.maxX).toBeLessThanOrEqual(turret.x + turret.width + 1e-9);
  });
});
