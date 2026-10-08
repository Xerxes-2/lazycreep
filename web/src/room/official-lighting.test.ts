/**
 * #49：官方画风的光照——显示选项“光照”开启时，按官方 metadata 的 lighting 图层给对象加静态的发光图元。
 */
import { describe, expect, it } from "vitest";
import type { ImagePrimitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { LAYER, buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

const users = { me1: { _id: "me1", username: "Me" } };
const official: RoomSceneView = { theme: DEFAULT_THEME, me: "me1", artStyle: "official" };
const lit = { ...DEFAULT_ROOM_DISPLAY, lighting: true };
const unlit = { ...DEFAULT_ROOM_DISPLAY, lighting: false };

type Objects = Record<string, Record<string, unknown>>;
const scene = (objects: Objects, view: RoomSceneView = official): Scene =>
  buildRoomScene({ state: roomStateFrom({ objects, users }) }, view);

const glows = (s: Scene) =>
  s.primitives.filter((p): p is ImagePrimitive => p.kind === "image" && p.url.endsWith("/glow.png"));
const glowsOf = (s: Scene, id: string) => glows(s).filter((p) => p.key.startsWith(`lighting/${id}/`));
/** 官方单位（100 = 1 格）的宽度 */
const widths = (s: Scene, id: string) => glowsOf(s, id).map((p) => Math.round(p.width * 100)).sort((a, b) => a - b);

const BASE: Objects = {
  sp: { type: "spawn", x: 10, y: 10, user: "me1", store: { energy: 300 }, storeCapacityResource: { energy: 300 } },
  ex: { type: "extension", x: 12, y: 10, user: "me1", store: { energy: 0 }, storeCapacityResource: { energy: 50 } },
  so: { type: "source", x: 20, y: 20, energy: 3000, energyCapacity: 3000 },
  rd: { type: "road", x: 11, y: 11 },
  ct: { type: "creep", x: 15, y: 15, user: "me1", body: [] },
};

describe("官方画风的光照（#49）", () => {
  it("开启时给有光的对象加发光图元，关闭时一个都没有，其余图元不变", () => {
    const on = scene(BASE, { ...official, display: lit });
    const off = scene(BASE, { ...official, display: unlit });
    // 照亮周围的大 glow：spawn 600、source 800 黄光、creep 400
    expect(widths(on, "sp")).toEqual([600]);
    expect(widths(on, "so")).toEqual([800]);
    expect(widths(on, "ct")).toEqual([400]);
    // extension 只有盖在自己身上的小 glow，不做；道路没有光
    expect(glowsOf(on, "ex")).toEqual([]);
    expect(glowsOf(on, "rd")).toEqual([]);
    expect(glows(off)).toEqual([]);
    expect(on.primitives.filter((p) => !glows(on).includes(p as ImagePrimitive))).toEqual(off.primitives);
  });

  it("发光图元以对象为中心、加色混合、按官方染色，不能被点选", () => {
    const on = scene(BASE, { ...official, display: lit });
    const big = glowsOf(on, "so").find((p) => Math.round(p.width * 100) === 800)!;
    expect(big).toMatchObject({ x: 20.5 - 4, y: 20.5 - 4, width: 8, height: 8, blend: "add", tint: 0xffff50 });
    for (const p of glows(on)) expect(p.objectId).toBeUndefined();
  });

  it("层级在对象（含 creep、rampart）之上、施工中的工地与血条、名字、RoomVisual 之下", () => {
    const on = scene(
      { ...BASE, ra: { type: "rampart", x: 15, y: 15, user: "me1", isPublic: true }, cs: { type: "constructionSite", x: 30, y: 30, user: "me1", progress: 1, progressTotal: 2 } },
      { ...official, display: lit, zoom: 40 },
    );
    const layers = new Set(glows(on).map((p) => p.layer));
    expect(layers.size).toBe(1);
    const [layer] = [...layers] as [number];
    expect(layer).toBeGreaterThanOrEqual(LAYER.rampart);
    expect(layer).toBeLessThan(LAYER.bar);
    for (const p of on.primitives) {
      if (p.objectId === "cs") expect(p.layer).toBeGreaterThan(layer);
      else if (p.objectId && p.kind !== "bar" && p.kind !== "text") expect(p.layer).toBeLessThan(layer);
    }
  });

  it("默认（不给显示选项）开启；几何画风下没有光照", () => {
    expect(glows(scene(BASE))).not.toEqual([]);
    expect(glows(scene(BASE, { ...official, artStyle: "geometric", display: lit }))).toEqual([]);
  });

  it("按官方的条件点亮：link 有能量、lab 有矿物、矿物按种类染色、孵化中的 creep 不亮", () => {
    const on = scene(
      {
        st: { type: "storage", x: 5, y: 5, user: "me1", store: {} },
        ln: { type: "link", x: 5, y: 9, user: "me1", store: { energy: 0 } },
        ln2: { type: "link", x: 7, y: 9, user: "me1", store: { energy: 1 } },
        lab: { type: "lab", x: 9, y: 9, user: "me1", store: { energy: 2000 } },
        lab2: { type: "lab", x: 11, y: 9, user: "me1", store: { energy: 2000, H: 5 } },
        mi: { type: "mineral", x: 40, y: 40, mineralType: "K", mineralAmount: 1 },
        npc: { type: "creep", x: 2, y: 2, user: "3", body: [] },
        baby: { type: "creep", x: 10, y: 9, user: "me1", body: [], spawning: true },
      },
      { ...official, display: lit },
    );
    expect(widths(on, "st")).toEqual([800]);
    expect(widths(on, "ln")).toEqual([]);
    expect(widths(on, "ln2")).toEqual([400]);
    expect(widths(on, "lab")).toEqual([]);
    expect(widths(on, "lab2")).toEqual([500]);
    expect(glowsOf(on, "mi").map((p) => p.tint)).toEqual([0x9370ff]);
    expect(widths(on, "npc")).toEqual([400]);
    expect(glowsOf(on, "baby")).toEqual([]);
  });
});
