/**
 * #58：creep 的冲撞、采集 / 预定的目标闪光与受击闪光（Scene 构建，纯数据）。照官方 creepActions（td = Tick 间隔）：
 * - 冲撞（近战 attack、harvest、heal、reserveController）：整个 creep 沿目标方向（每个轴取符号）前冲
 *   ATTACK_PENETRATION（10 官方单位 = 0.1 格），td/4 去、3td/4 回；身体转向目标，max(td/5, 0.4 秒)；
 *   本 Tick 位置变了的 creep 不冲撞；目标在自己格子上（治疗自己）不冲撞。
 * - 采集目标闪黄 0xffe533、预定的控制器闪紫 0xb99cfb，0.9td。
 * - 受击闪光：attacked 红 0xff3333、healed 绿 0x2ce328、两者都有黄 0xffff33；挂在 creep 上，加色，
 *   透明度 0 → 0.5 → 0，0.9td 的 1/4 升、3/4 降。
 */
import { describe, expect, it } from "vitest";
import { animationDuration } from "../scene/animation.ts";
import type { Primitive, Scene, Tween } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom, type RoomState } from "./room-state.ts";
import { nextFacings } from "./movement-tween.ts";
import { pickObjects } from "../scene/scene-camera.ts";

const TD = 2000;

const creepAt = (x: number, y: number, actionLog: Record<string, unknown> = {}) => ({
  _id: "c1",
  type: "creep",
  x,
  y,
  user: "u1",
  name: "Worker",
  body: [{ type: "work", hits: 100 }, { type: "move", hits: 100 }],
  actionLog,
});
const roomAt = (gameTime: number, objects: Record<string, Record<string, unknown>>): RoomState =>
  roomStateFrom({ gameTime, objects, users: { u1: { _id: "u1", username: "me" } } });

const view: RoomSceneView = { theme: DEFAULT_THEME, tickMs: TD, zoom: 40, selectedId: "c1", me: "u1" };
const build = (state: RoomState, previous: RoomState | undefined, v: RoomSceneView = view, facing?: ReadonlyMap<string, number>): Scene =>
  buildRoomScene({ state, previous, ...(facing ? { facing } : {}) }, v);
const ofCreep = (scene: Scene) => scene.primitives.filter((p) => p.key.startsWith("c1/"));
const tweensOf = (p: Primitive, property: Tween["property"]) => p.animation?.tweens.filter((t) => t.property === property) ?? [];
const byKey = (scene: Scene, key: string) => {
  const found = scene.primitives.find((p) => p.key === key);
  if (!found) throw new Error(`没有 ${key}：${scene.primitives.map((p) => p.key).join(", ")}`);
  return found;
};

const idle = roomAt(100, { c1: creepAt(20, 20) });
const acting = (actionLog: Record<string, unknown>, at = { x: 20, y: 20 }) => roomAt(101, { c1: creepAt(at.x, at.y, actionLog) });
const bite = (to: number) => ({ steps: [{ to, duration: TD / 4 }, { duration: (3 * TD) / 4 }] });

describe("冲撞（Scene）", () => {
  it.each(["attack", "harvest", "heal", "reserveController"])("%s：整个 creep 沿目标方向前冲 0.1 格再退回，td/4 去、3td/4 回", (action) => {
    // 目标在右上（斜向），距离不止一格也只按方向前冲 0.1 格（官方每个轴取符号）
    const scene = build(acting({ [action]: { x: 22, y: 19 } }), idle);
    const parts = ofCreep(scene);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) {
      expect(p.animation?.id, p.key).toBe(101);
      expect(tweensOf(p, "offsetX"), p.key).toEqual([{ property: "offsetX", from: 0, ...bite(0.1) }]);
      expect(tweensOf(p, "offsetY"), p.key).toEqual([{ property: "offsetY", from: 0, ...bite(-0.1) }]);
    }
    // 终态在原格
    expect(byKey(scene, "c1/base")).toMatchObject({ kind: "circle", x: 20.5, y: 20.5 });
    expect(animationDuration(byKey(scene, "c1/owner-name").animation!)).toBe(TD);
  });

  it("正对一个轴时只在那个轴上前冲；creep 的发光也跟着冲撞", () => {
    const scene = build(acting({ harvest: { x: 20, y: 21 } }), idle);
    const base = byKey(scene, "c1/base");
    expect(tweensOf(base, "offsetX")).toEqual([]);
    expect(tweensOf(base, "offsetY")).toEqual([{ property: "offsetY", from: 0, ...bite(0.1) }]);
    const glow = scene.primitives.filter((p) => p.key.startsWith("lighting/c1/"));
    expect(glow.length).toBeGreaterThan(0);
    for (const p of glow) expect(tweensOf(p, "offsetY"), p.key).toEqual([{ property: "offsetY", from: 0, ...bite(0.1) }]);
  });

  it("身体转向目标，用 max(td/5, 400 ms)；绕格子中心", () => {
    const scene = build(acting({ attack: { x: 21, y: 20 } }), idle);
    expect(byKey(scene, "c1/base").animation).toMatchObject({ originX: 20.5, originY: 20.5 });
    expect(tweensOf(byKey(scene, "c1/base"), "turn")).toEqual([{ property: "turn", from: -Math.PI / 2, steps: [{ duration: 400 }] }]);
    expect(byKey(scene, "c1/ring-work-r").kind === "polygon").toBe(true);
    const slow = build(acting({ attack: { x: 21, y: 20 } }), idle, { ...view, tickMs: 3000 });
    expect(tweensOf(byKey(slow, "c1/base"), "turn")[0]?.steps).toEqual([{ duration: 600 }]);
    const fast = build(acting({ attack: { x: 21, y: 20 } }), idle, { ...view, tickMs: 500 });
    expect(tweensOf(byKey(fast, "c1/base"), "turn")[0]?.steps).toEqual([{ duration: 400 }]);
  });

  it("已经朝着目标时不转", () => {
    const scene = build(acting({ attack: { x: 21, y: 20 } }), idle, view, new Map([["c1", Math.PI / 2]]));
    expect(tweensOf(byKey(scene, "c1/base"), "turn")).toEqual([]);
    expect(tweensOf(byKey(scene, "c1/base"), "offsetX")).toHaveLength(1);
  });

  it("本 Tick 移动了的 creep 不冲撞（只有移动补间，身体按移动方向 0.2td 转）", () => {
    const scene = build(acting({ attack: { x: 22, y: 20 } }, { x: 21, y: 20 }), idle);
    for (const p of ofCreep(scene)) {
      expect(tweensOf(p, "offsetX"), p.key).toEqual([{ property: "offsetX", from: -1, steps: [{ duration: TD, easing: "easeInOutQuad" }] }]);
    }
    expect(tweensOf(byKey(scene, "c1/base"), "turn")[0]?.steps).toEqual([{ duration: 0.2 * TD }]);
  });

  it("跨出口等位置变了（不止一格）、刚出现、目标在自己格子上时不冲撞", () => {
    const noBite = (scene: Scene) => ofCreep(scene).every((p) => tweensOf(p, "offsetX").length + tweensOf(p, "offsetY").length === 0);
    expect(noBite(build(acting({ attack: { x: 21, y: 20 } }), roomAt(100, { c1: creepAt(20, 49) })))).toBe(true);
    expect(noBite(build(acting({ attack: { x: 21, y: 20 } }), roomAt(100, {})))).toBe(true);
    expect(noBite(build(acting({ heal: { x: 20, y: 20 } }), idle))).toBe(true);
  });

  it("powerCreep 同样冲撞（官方 powerCreep 也用 creepActions）", () => {
    const pc = (actionLog: Record<string, unknown>) => ({ c1: { _id: "c1", type: "powerCreep", x: 5, y: 5, user: "u1", className: "operator", level: 3, actionLog } });
    const scene = build(roomAt(101, pc({ attack: { x: 4, y: 5 } })), roomAt(100, pc({})));
    expect(tweensOf(byKey(scene, "c1/body"), "offsetX")).toEqual([{ property: "offsetX", from: 0, ...bite(-0.1) }]);
  });
});

describe("nextFacings：冲撞转向目标后保持", () => {
  it("没移动且冲撞时朝向目标；下一个 Tick 不动也不冲撞时保持", () => {
    const after = nextFacings(undefined, idle, acting({ harvest: { x: 20, y: 21 } }));
    expect(after.get("c1")).toBeCloseTo(Math.PI);
    expect(nextFacings(after, acting({ harvest: { x: 20, y: 21 } }), roomAt(102, { c1: creepAt(20, 20) })).get("c1")).toBeCloseTo(Math.PI);
  });

  it("移动了以移动方向为准；目标在自己格子上沿用原来的朝向", () => {
    expect(nextFacings(undefined, idle, acting({ attack: { x: 20, y: 19 } }, { x: 21, y: 20 })).get("c1")).toBeCloseTo(Math.PI / 2);
    expect(nextFacings(new Map([["c1", 1]]), idle, acting({ heal: { x: 20, y: 20 } })).get("c1")).toBe(1);
  });
});

describe("采集与预定的目标闪光（Scene）", () => {
  it.each([
    ["harvest", 0xffe533],
    ["reserveController", 0xb99cfb],
  ] as const)("%s：目标处 cover 闪光，颜色 %i，立即开始、0.9td 结束；不随 creep 动、不参与点选", (action, color) => {
    const scene = build(acting({ [action]: { x: 21, y: 21 } }), idle);
    const cover = byKey(scene, `action/c1/${action}-target-cover`);
    expect(cover).toMatchObject({ kind: "image", alpha: 0, tint: color });
    expect(cover.kind === "image" && cover.x + cover.width / 2).toBeCloseTo(21.5);
    expect(cover.objectId).toBeUndefined();
    expect(cover.animation?.tweens).toEqual([{ property: "alpha", from: 0, steps: [{ to: 0.3, duration: 450 }, { duration: 1350 }] }]);
    expect(animationDuration(cover.animation!)).toBe(0.9 * TD);
    expect(byKey(scene, `action/c1/${action}-target-flare`)).toMatchObject({ blend: "add", tint: color });
  });

  it("移动了也照样闪（官方只有冲撞看是否移动）", () => {
    const scene = build(acting({ harvest: { x: 22, y: 20 } }, { x: 21, y: 20 }), idle);
    expect(byKey(scene, "action/c1/harvest-target-cover").animation).toBeDefined();
  });
});

describe("受击闪光（Scene）", () => {
  it.each([
    [{ attacked: { x: 21, y: 21 } }, 0xff3333],
    [{ healed: { x: 21, y: 21 } }, 0x2ce328],
    [{ attacked: { x: 21, y: 21 }, healed: { x: 19, y: 19 } }, 0xffff33],
  ])("%o：creep 身上加色闪光 %i，透明度 0 → 0.5 → 0，0.9td 的 1/4 升、3/4 降", (log, color) => {
    const scene = build(acting(log), idle);
    const flash = byKey(scene, "effect/c1/hit-flash");
    expect(flash).toMatchObject({ kind: "image", alpha: 0, tint: color, blend: "add" });
    // 不带 objectId：闪光比格子大（1.28 格），带上就会让相邻格边缘的点选命中这个 creep
    expect(flash.objectId).toBeUndefined();
    expect(flash.kind === "image" && flash.x + flash.width / 2).toBeCloseTo(20.5);
    expect(flash.kind === "image" && flash.y + flash.height / 2).toBeCloseTo(20.5);
    expect(flash.animation?.tweens).toEqual([{ property: "alpha", from: 0, steps: [{ to: 0.5, duration: 450 }, { duration: 1350 }] }]);
    expect(animationDuration(flash.animation!)).toBe(0.9 * TD);
  });

  it("不参与点选：点相邻格子的边缘不会选中这个 creep", () => {
    const scene = build(acting({ attacked: { x: 21, y: 21 } }), idle);
    expect(pickObjects(scene, 20.5, 20.5)).toContain("c1");
    for (const [x, y] of [[19.9, 20.5], [21.1, 20.5], [20.5, 19.9], [20.5, 21.1]] as const) {
      expect(pickObjects(scene, x, y)).not.toContain("c1");
    }
  });

  it("没有被攻击或治疗时没有受击闪光", () => {
    const scene = build(acting({ attacked: null, healed: null }), idle);
    expect(scene.primitives.some((p) => p.key === "effect/c1/hit-flash")).toBe(false);
  });

  it("跟着 creep 移动", () => {
    const scene = build(acting({ attacked: { x: 22, y: 20 } }, { x: 21, y: 20 }), idle);
    expect(tweensOf(byKey(scene, "effect/c1/hit-flash"), "offsetX")).toEqual([{ property: "offsetX", from: -1, steps: [{ duration: TD, easing: "easeInOutQuad" }] }]);
  });
});

describe("开关关闭", () => {
  it("动画开关关闭或没有上一个状态时：没有冲撞、目标闪光与受击闪光，静止画面不变", () => {
    const log = { attack: { x: 21, y: 20 }, harvest: { x: 21, y: 21 }, attacked: { x: 21, y: 20 }, healed: { x: 21, y: 20 } };
    const off = build(acting(log), idle, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, animation: false } });
    expect(off.primitives.filter((p) => p.animation)).toEqual([]);
    expect(off.primitives.some((p) => p.key === "effect/c1/hit-flash" || p.key.startsWith("action/"))).toBe(false);
    const quiet = build(acting({}), idle, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, animation: false } });
    expect(off.primitives).toEqual(quiet.primitives);
    expect(build(acting(log), undefined).primitives.filter((p) => p.animation)).toEqual([]);
  });
});
