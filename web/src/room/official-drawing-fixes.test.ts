/**
 * #64 顺带修：与光照无关、但与官方 metadata 不一致的几处画法（source、公开 rampart、powerSpawn 的徽章退路、
 * controller 的三个 0.05 透明圆、spawn 的孵化弧）。纯数据。
 */
import { describe, expect, it } from "vitest";
import { officialArtUrl } from "../art/official-art.ts";
import type { LinePrimitive, Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

const users = { me1: { _id: "me1", username: "Me" }, foe1: { _id: "foe1", username: "Foe" } };
const view: RoomSceneView = { theme: DEFAULT_THEME, me: "me1" };
const GAME_TIME = 1000;

const scene = (objects: Record<string, Record<string, unknown>>, v: RoomSceneView = view): Scene =>
  buildRoomScene({ state: roomStateFrom({ objects, users, gameTime: GAME_TIME }) }, v);
const part = (s: Scene, key: string) => s.primitives.find((p) => p.key === key);
const parts = (s: Scene, id: string) => s.primitives.filter((p) => p.objectId === id).map((p) => p.key.slice(id.length + 1));

describe("source（官方整块 Graphics 染 0x595026）", () => {
  it("填充是 0x111111 × 0x595026 ≈ 0x060502；描边取染色动画的起点 0x595026（官方在它与 0x0e0c04 之间来回，常驻动画不做）", () => {
    const s = scene({ so: { type: "source", x: 7, y: 7, energy: 0, energyCapacity: 3000 } });
    expect(part(s, "so/body")).toMatchObject({ kind: "rect", fill: 0x060502, stroke: { color: 0x595026, width: 0.15 } });
  });
});

describe("公开 rampart（官方固定颜色，不按主人色）", () => {
  it("自己的 0x44FF44，别人的 0xFF4444；不知道自己是谁时都算别人", () => {
    const objects = {
      mine: { type: "rampart", x: 1, y: 1, user: "me1", isPublic: true },
      theirs: { type: "rampart", x: 3, y: 1, user: "foe1", isPublic: true },
    };
    const s = scene(objects);
    expect(part(s, "mine/body")).toMatchObject({ kind: "image", url: officialArtUrl("rampart"), tint: 0x44ff44, alpha: 0.5 });
    expect(part(s, "theirs/body")).toMatchObject({ tint: 0xff4444 });
    expect(part(scene(objects, { theme: DEFAULT_THEME }), "mine/body")).toMatchObject({ tint: 0xff4444 });
  });
});

describe("powerSpawn 没有徽章时的退路圆（官方 ellipse4 0x555555）", () => {
  it("是 0x555555，不是主人色；spawn 的退路仍是主人色", () => {
    const s = scene({
      ps: { type: "powerSpawn", x: 5, y: 5, user: "me1" },
      sp: { type: "spawn", x: 9, y: 9, user: "me1" },
    });
    expect(part(s, "ps/badge")).toMatchObject({ kind: "circle", radius: 0.38, fill: 0x555555 });
    expect(part(s, "sp/badge")).toMatchObject({ kind: "circle", fill: DEFAULT_THEME.owned });
  });
});

describe("controller 的三种 0.05 透明圆（半径 110，官方闪烁取静止值 0.05）", () => {
  const controller = (extra: Record<string, unknown>) => scene({ c: { type: "controller", x: 20, y: 20, level: 0, ...extra } });
  const circles = (s: Scene) =>
    s.primitives
      .filter((p): p is Extract<Primitive, { kind: "circle" }> => p.objectId === "c" && p.kind === "circle" && p.radius === 1.1)
      .map((p) => [p.key.slice(2), p.fill, p.alpha]);

  it("自己预定：绿色 0x33ff33", () => {
    expect(circles(controller({ reservation: { user: "me1", endTime: GAME_TIME + 100 } }))).toEqual([["reserved", 0x33ff33, 0.05]]);
  });

  it("别人预定或禁止升级：红色 0xff3333，官方画两层", () => {
    const red = [
      ["blocked", 0xff3333, 0.05],
      ["blocked-2", 0xff3333, 0.05],
    ];
    expect(circles(controller({ reservation: { user: "foe1", endTime: GAME_TIME + 100 } }))).toEqual(red);
    expect(circles(controller({ user: "me1", level: 3, upgradeBlocked: GAME_TIME + 1 }))).toEqual(red);
    expect(circles(controller({ user: "me1", level: 3, upgradeBlocked: GAME_TIME }))).toEqual([]);
  });

  it("安全模式：0xffd180；画在其他部件之下（官方最先画）", () => {
    const s = controller({ user: "me1", level: 3, safeMode: GAME_TIME + 1 });
    expect(circles(s)).toEqual([["safe-mode", 0xffd180, 0.05]]);
    expect(parts(s, "c").indexOf("safe-mode")).toBeLessThan(parts(s, "c").indexOf("halo"));
    expect(circles(controller({ user: "me1", level: 3, safeMode: GAME_TIME }))).toEqual([]);
  });

  it("什么都没有时没有这几个圆", () => {
    expect(circles(controller({ user: "me1", level: 3 }))).toEqual([]);
  });
});

describe("spawn 的孵化弧（官方 arc：0xCCCCCC，半径 50，宽 10，从正上方顺时针）", () => {
  it("孵化中按进度画弧，不孵化时没有", () => {
    const spawning = scene({ sp: { type: "spawn", x: 9, y: 9, user: "me1", spawning: { name: "x", needTime: 30, spawnTime: GAME_TIME + 10 } } });
    const arc = part(spawning, "sp/spawning") as LinePrimitive;
    expect(arc).toMatchObject({ kind: "line", stroke: { color: 0xcccccc, width: 0.1 } });
    // 从正上方开始，已过 20/30 圈
    expect(arc.points.slice(0, 2).map((v) => +v.toFixed(6))).toEqual([9.5, 9]);
    const [x, y] = arc.points.slice(-2);
    const angle = Math.atan2(y! - 9.5, x! - 9.5) + Math.PI / 2;
    expect((angle + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo((2 * Math.PI * 20) / 30);
    expect(part(scene({ sp: { type: "spawn", x: 9, y: 9, user: "me1" } }), "sp/spawning")).toBeUndefined();
  });
});
