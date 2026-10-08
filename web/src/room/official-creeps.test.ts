/**
 * #48：官方画风下 creep / powerCreep 的画法与 spawn、controller 的主人徽章（buildRoomScene 的输出）。
 */
import { describe, expect, it } from "vitest";
import { officialArtUrl } from "../art/official-art.ts";
import { badgeSvgUrl } from "../badge/badge-image.ts";
import { parseBadge } from "../badge/badge.ts";
import type { ImagePrimitive, PolygonPrimitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { BAR_MIN_ZOOM } from "./room-detail-rules.ts";
import { BADGE_MIN_ZOOM } from "./owner-badge.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";
import { seasonArt } from "../art/season-art.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

const theme = DEFAULT_THEME;
const MY_BADGE = { type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false };
const FOE_BADGE = { type: 24, color1: "#112233", color2: "#445566", color3: "#778899", param: 0, flip: true };
const users = {
  me1: { _id: "me1", username: "Me", badge: MY_BADGE },
  foe1: { _id: "foe1", username: "Foe", badge: FOE_BADGE },
  plain: { _id: "plain", username: "NoBadge" },
};
const near: RoomSceneView = { theme, me: "me1", artStyle: "official", zoom: 40 };

function scene(objects: Record<string, Record<string, unknown>>, view: RoomSceneView = near): Scene {
  return buildRoomScene({ state: roomStateFrom({ objects, users }) }, view);
}

const of = (s: Scene, id: string) => s.primitives.filter((p) => p.objectId === id);
const images = (s: Scene, id: string) => of(s, id).filter((p): p is ImagePrimitive => p.kind === "image");
const badgeUrl = (raw: unknown) => badgeSvgUrl(parseBadge(raw));
const badgeOf = (s: Scene, id: string) => images(s, id).filter((p) => p.url.startsWith("data:image/svg+xml"));

/** 身体环的弧段：外半径 0.5、内半径 0.32（官方半径 50、线宽 18） */
const OUTER = 0.5;
const INNER = 0.32;
const ringOf = (s: Scene, id: string) =>
  of(s, id).filter((p): p is PolygonPrimitive => p.kind === "polygon" && p.key.split("/")[1]!.startsWith("ring"));

function area(points: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 2) {
    const j = (i + 2) % points.length;
    sum += points[i]! * points[j + 1]! - points[j]! * points[i + 1]!;
  }
  return Math.abs(sum) / 2;
}
/** 环形扇区的圆心角：面积 = 角 / 2 × (R² − r²) */
const span = (p: PolygonPrimitive) => (2 * area(p.points)) / (OUTER ** 2 - INNER ** 2);
/** 扇区中点相对于圆心的方位：0 = 正上方，顺时针为正（−π..π） */
function bearing(p: PolygonPrimitive, cx: number, cy: number): number {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < p.points.length; i += 2) {
    sx += p.points[i]! - cx;
    sy += p.points[i + 1]! - cy;
  }
  return Math.atan2(sx, -sy);
}

/** 官方：每 100 HP 的部件在左右各占 π/50 */
const PART = Math.PI / 50;

describe("官方 creep：身体部件环（creepBuildBody）", () => {
  const body = [
    { type: "tough", hits: 0 },
    { type: "work", hits: 100 },
    { type: "work", hits: 50 },
    { type: "work", hits: 0 },
    { type: "carry", hits: 100 },
    { type: "attack", hits: 100 },
    { type: "move", hits: 100 },
    { type: "move", hits: 100 },
  ];
  const s = scene({ c: { type: "creep", x: 10, y: 10, user: "me1", body, hits: 550, hitsMax: 800 } });
  const ring = ringOf(s, "c");

  it("同类部件合并成一段、左右对称各一块；carry、tough 与 0 HP 部件不进环", () => {
    const byType = new Map<number, number>();
    for (const p of ring) byType.set(p.fill!, (byType.get(p.fill!) ?? 0) + 1);
    expect(byType).toEqual(new Map([
      [0xfde574, 2], // work
      [0xf72e41, 2], // attack
      [0xaab7c5, 2], // move
    ]));
  });

  it("弧长按存活 HP 计（每 100 HP 一份），受伤部件按比例缩短", () => {
    const spans = (fill: number) => ring.filter((p) => p.fill === fill).map(span);
    for (const v of spans(0xfde574)) expect(v).toBeCloseTo(1.5 * PART, 3);
    for (const v of spans(0xf72e41)) expect(v).toBeCloseTo(PART, 3);
    for (const v of spans(0xaab7c5)) expect(v).toBeCloseTo(2 * PART, 3);
  });

  it("前侧从正上方往两边排、HP 少的在前；move 在背面从正下方往两边排", () => {
    const at = (fill: number) => ring.filter((p) => p.fill === fill).map((p) => bearing(p, 10.5, 10.5));
    const [attackA, attackB] = at(0xf72e41).map(Math.abs);
    const [workA, workB] = at(0xfde574).map(Math.abs);
    expect(attackA).toBeCloseTo(PART / 2, 3);
    expect(attackB).toBeCloseTo(PART / 2, 3);
    expect(workA).toBeCloseTo(PART + 0.75 * PART, 3);
    expect(workB).toBeCloseTo(PART + 0.75 * PART, 3);
    for (const b of at(0xaab7c5)) expect(Math.PI - Math.abs(b)).toBeCloseTo(PART, 3);
    // 左右各一块
    expect(at(0xf72e41).map(Math.sign).sort()).toEqual([-1, 1]);
  });

  it("有存活的 tough 时叠一圈 tough 贴图（120 单位），没有就不画；boost 不改变画法", () => {
    const toughUrl = officialArtUrl("tough");
    expect(images(s, "c").map((p) => p.url)).not.toContain(toughUrl);
    const plainBody = [{ type: "tough", hits: 40 }, { type: "move", hits: 100 }];
    const boosted = [{ type: "tough", hits: 40, boost: "XGHO2" }, { type: "move", hits: 100, boost: "XZHO2" }];
    const a = scene({ c: { type: "creep", x: 1, y: 1, user: "me1", body: plainBody } });
    const b = scene({ c: { type: "creep", x: 1, y: 1, user: "me1", body: boosted } });
    expect(images(a, "c").find((p) => p.url === toughUrl)).toMatchObject({ x: 0.9, y: 0.9, width: 1.2, height: 1.2 });
    expect(of(b, "c")).toEqual(of(a, "c"));
  });
});

type Bar = Extract<Scene["primitives"][number], { kind: "bar" }>;

describe("官方 creep：中心徽章", () => {
  const objects = {
    mine: { type: "creep", x: 10, y: 10, user: "me1", body: [{ type: "move", hits: 100 }] },
    foe: { type: "creep", x: 12, y: 10, user: "foe1", body: [{ type: "move", hits: 100 }] },
    nobadge: { type: "creep", x: 14, y: 10, user: "plain", body: [{ type: "move", hits: 100 }] },
    keeper: { type: "creep", x: 16, y: 10, user: "3", body: [{ type: "attack", hits: 100 }] },
  };

  it("中心是主人的徽章（半径 26），在身体环与黑色内圆之上", () => {
    const s = scene(objects);
    expect(badgeOf(s, "mine")).toEqual([expect.objectContaining({ x: 10.24, y: 10.24, width: 0.52, height: 0.52, url: badgeUrl(MY_BADGE) })]);
    expect(badgeOf(s, "foe")[0]!.url).toBe(badgeUrl(FOE_BADGE));
    expect(badgeUrl(MY_BADGE)).not.toBe(badgeUrl(FOE_BADGE));
    const order = of(s, "mine").map((p) => p.key.split("/")[1]);
    expect(order.indexOf("badge")).toBeGreaterThan(order.indexOf("core"));
    expect(order.indexOf("core")).toBeGreaterThan(order.indexOf("ring-move-r"));
  });

  it("没有徽章的玩家画主人色圆；NPC 只有官方 NPC 贴图，没有身体环与徽章", () => {
    const s = scene(objects);
    expect(badgeOf(s, "nobadge")).toEqual([]);
    expect(of(s, "nobadge").find((p) => p.key === "nobadge/badge")).toMatchObject({ kind: "circle", radius: 0.26 });
    expect(images(s, "keeper").map((p) => p.url)).toEqual([officialArtUrl("creep-npc")]);
    expect(ringOf(s, "keeper")).toEqual([]);
    expect(of(s, "keeper").find((p) => p.key === "keeper/badge")).toBeUndefined();
  });

  it(`缩放低于 ${BADGE_MIN_ZOOM} px/格时省略徽章，退成主人色圆`, () => {
    const far = scene(objects, { ...near, zoom: BADGE_MIN_ZOOM - 1 });
    expect(badgeOf(far, "mine")).toEqual([]);
    expect(of(far, "mine")).toContainEqual(expect.objectContaining({ kind: "circle", radius: 0.26, fill: theme.owned }));
    expect(badgeOf(scene(objects, { ...near, zoom: BADGE_MIN_ZOOM }), "mine")).toHaveLength(1);
  });

  it("血条在下、资源条在上（#36），选中高亮照常；中心按装载量画资源圆", () => {
    const s = scene(
      { c: { type: "creep", x: 5, y: 5, user: "me1", body: [{ type: "carry", hits: 100 }], hits: 50, hitsMax: 100, store: { energy: 25 }, storeCapacity: 50 } },
      { ...near, zoom: BAR_MIN_ZOOM + 10, selectedId: "c" },
    );
    const part = (name: string) => of(s, "c").find((p) => p.key === `c/${name}`);
    expect((part("hits") as Bar).y).toBeGreaterThan((part("store") as Bar).y);
    expect(part("selected")).toBeDefined();
    expect(part("store-energy")).toMatchObject({ kind: "circle", radius: 0.1, fill: 0xffe56d });
  });
});

describe("官方 powerCreep", () => {
  it("按职业与等级用官方贴图（180 单位、红色染色），徽章按官方尺寸与位置", () => {
    const s = scene({
      op: { type: "powerCreep", x: 20, y: 20, user: "me1", className: "operator", level: 13 },
      cmd: { type: "powerCreep", x: 22, y: 20, user: "foe1", className: "commander", level: 0 },
    });
    const body = (id: string) => images(s, id).find((p) => !p.url.startsWith("data:"));
    expect(body("op")).toMatchObject({ url: officialArtUrl("operator-lvl3"), width: 1.8, height: 1.8, tint: 0xcc3d3e });
    expect(body("op")!.x).toBeCloseTo(19.6);
    // operator：边长 63，上沿在中心上方 15
    const op = badgeOf(s, "op")[0]!;
    expect(op).toMatchObject({ url: badgeUrl(MY_BADGE), width: 0.63, height: 0.63 });
    expect(op.x).toBeCloseTo(20.5 - 0.315);
    expect(op.y).toBeCloseTo(20.35);
    expect(body("cmd")!.url).toBe(officialArtUrl("commander-lvl0"));
    // commander：边长 65，上沿在中心上方 30
    expect(badgeOf(s, "cmd")[0]!.y).toBeCloseTo(20.2);
    expect(badgeOf(s, "cmd")[0]!.width).toBeCloseTo(0.65);
  });
});

describe("官方 spawn、powerSpawn、controller：主人徽章", () => {
  it("有主时中心是主人徽章（spawn、powerSpawn 半径 38，controller 37），无主不画", () => {
    const s = scene({
      sp: { type: "spawn", x: 5, y: 5, user: "foe1" },
      ps: { type: "powerSpawn", x: 8, y: 5, user: "me1" },
      c: { type: "controller", x: 25, y: 25, user: "me1", level: 3 },
      free: { type: "controller", x: 40, y: 40, level: 0 },
    });
    expect(badgeOf(s, "sp")).toEqual([expect.objectContaining({ x: 5.12, y: 5.12, width: 0.76, height: 0.76, url: badgeUrl(FOE_BADGE) })]);
    expect(badgeOf(s, "ps")).toEqual([expect.objectContaining({ x: 8.12, y: 5.12, width: 0.76, url: badgeUrl(MY_BADGE) })]);
    expect(of(s, "ps").filter((p) => p.key === "ps/badge")).toHaveLength(1);
    expect(badgeOf(s, "c")).toEqual([expect.objectContaining({ x: 25.13, y: 25.13, width: 0.74, url: badgeUrl(MY_BADGE) })]);
    expect(badgeOf(s, "free")).toEqual([]);
    expect(of(s, "free").find((p) => p.key === "free/badge")).toBeUndefined();
  });

  it("spawn、controller 的徽章不随缩放省略", () => {
    const s = scene({ c: { type: "controller", x: 25, y: 25, user: "me1", level: 3 } }, { ...near, zoom: 1 });
    expect(badgeOf(s, "c")).toHaveLength(1);
  });
});

describe("官方 reactor（赛季）：主人徽章", () => {
  it("有主时中心是半径 29 的主人徽章，无主不画", async () => {
    const bundle = fixtureBundle(
      Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
    );
    const { renderer } = await new FixtureSource(bundle, { speed: Infinity }).getVersion();
    const art = seasonArt(renderer!, new Set(["T", "reactor-core", "reactor-edge"]));
    const s = scene(
      {
        r: { type: "reactor", x: 25, y: 25, user: "me1", store: {}, storeCapacityResource: { T: 1000 } },
        idle: { type: "reactor", x: 10, y: 10, store: {}, storeCapacityResource: { T: 1000 } },
      },
      { ...near, seasonArt: art },
    );
    expect(badgeOf(s, "r")).toEqual([expect.objectContaining({ x: 25.21, y: 25.21, width: 0.58, url: badgeUrl(MY_BADGE) })]);
    expect(of(s, "idle").find((p) => p.key === "idle/badge")).toBeUndefined();
  });
});
