/**
 * #57：移动补间（Movement Tween，Scene 构建，纯数据）。照官方 creep.metadata 的 moveTo / rotateTo：
 * 从旧格到新格 easeInOutQuad、用满 td；身体转向移动方向 0.2td。挂在 creep 上的玩家名、say 气泡、
 * 选中框（以及发光、动作效果）带同样的位移；没有上一个位置或位移 > 1 格时不补间。
 */
import { describe, expect, it } from "vitest";
import { tweenValue } from "../scene/animation.ts";
import type { Primitive, Scene, Tween } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom, type RoomState } from "./room-state.ts";
import { nextFacings } from "./movement-tween.ts";

const TD = 2000;

const users = { u1: { _id: "u1", username: "me" }, u2: { _id: "u2", username: "foe" } };
const creepAt = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  _id: "c1",
  type: "creep",
  x,
  y,
  user: "u1",
  name: "Harvester",
  body: [{ type: "move", hits: 100 }, { type: "work", hits: 100 }],
  store: { energy: 20 },
  storeCapacity: 50,
  ...extra,
});
const roomAt = (gameTime: number, objects: Record<string, Record<string, unknown>>): RoomState =>
  roomStateFrom({ gameTime, objects, users });

/** 缩放够大：玩家名、徽章都画出来 */
const view: RoomSceneView = { theme: DEFAULT_THEME, tickMs: TD, zoom: 40, selectedId: "c1", me: "u1" };
const build = (state: RoomState, previous: RoomState | undefined, v: RoomSceneView = view, facing?: ReadonlyMap<string, number>): Scene =>
  buildRoomScene({ state, previous, ...(facing ? { facing } : {}) }, v);
const ofCreep = (scene: Scene) => scene.primitives.filter((p) => p.key.startsWith("c1/"));
const tweenOf = (p: Primitive, property: Tween["property"]) => p.animation?.tweens.find((t) => t.property === property);
const byKey = (scene: Scene, key: string) => {
  const found = scene.primitives.find((p) => p.key === key);
  if (!found) throw new Error(`没有 ${key}：${scene.primitives.map((p) => p.key).join(", ")}`);
  return found;
};

describe("移动补间（Scene）", () => {
  const before = roomAt(100, { c1: creepAt(10, 10) });
  const movedRight = roomAt(101, { c1: creepAt(11, 10, { actionLog: { say: { message: "hi", isPublic: true } } }) });

  it("移动了的 creep：每个图元都从旧格开始（位移 = 旧格 − 新格），easeInOutQuad，用满 td；终态在新格", () => {
    const scene = build(movedRight, before);
    const parts = ofCreep(scene);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) {
      expect(p.animation?.id, p.key).toBe(101);
      expect(tweenOf(p, "offsetX"), p.key).toEqual({ property: "offsetX", from: -1, steps: [{ duration: TD, easing: "easeInOutQuad" }] });
      expect(tweenOf(p, "offsetY"), p.key).toEqual({ property: "offsetY", from: 0, steps: [{ duration: TD, easing: "easeInOutQuad" }] });
    }
    // 终态（图元自身）在新格
    expect(byKey(scene, "c1/base")).toMatchObject({ kind: "circle", x: 11.5, y: 10.5 });
    // 中途：缓入缓出，一半时间走了一半
    const x = tweenOf(byKey(scene, "c1/base"), "offsetX")!;
    expect(tweenValue(x, 0, TD / 2)).toBeCloseTo(-0.5);
    expect(tweenValue(x, 0, TD / 4)).toBeCloseTo(-0.875);
  });

  it("玩家名、say 气泡、选中框带同样的位移", () => {
    const scene = build(movedRight, before);
    const keys = ofCreep(scene).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["c1/owner-name", "c1/selected"]));
    expect(keys.some((k) => k.startsWith("c1/say"))).toBe(true);
    for (const key of keys.filter((k) => k === "c1/owner-name" || k === "c1/selected" || k.startsWith("c1/say"))) {
      expect(tweenOf(byKey(scene, key), "offsetX")?.from, key).toBe(-1);
    }
  });

  it("没有上一个位置（刚出现）、位移 > 1 格（跨出口等）、没动时不补间", () => {
    const noOffset = (scene: Scene) => ofCreep(scene).every((p) => !tweenOf(p, "offsetX") && !tweenOf(p, "offsetY"));
    expect(noOffset(build(movedRight, roomAt(100, {})))).toBe(true);
    expect(noOffset(build(movedRight, roomAt(100, { c1: creepAt(9, 10) })))).toBe(true);
    expect(noOffset(build(movedRight, roomAt(100, { c1: creepAt(11, 49) })))).toBe(true);
    expect(noOffset(build(roomAt(101, { c1: creepAt(10, 10) }), before))).toBe(true);
  });

  it("动画开关关闭、没有 Tick 间隔或没有上一个状态时 Scene 不带动画", () => {
    const off = build(movedRight, before, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, animation: false } });
    expect(off.primitives.filter((p) => p.animation)).toEqual([]);
    expect(build(movedRight, undefined).primitives.filter((p) => p.animation)).toEqual([]);
    const { tickMs: _unused, ...noTick } = view;
    expect(build(movedRight, before, noTick).primitives.filter((p) => p.animation)).toEqual([]);
  });

  it("斜着走一格：两个方向都补间", () => {
    const scene = build(roomAt(101, { c1: creepAt(9, 11) }), before);
    expect(tweenOf(byKey(scene, "c1/base"), "offsetX")?.from).toBe(1);
    expect(tweenOf(byKey(scene, "c1/base"), "offsetY")?.from).toBe(-1);
  });

  it("powerCreep 同样补间（官方 powerCreep.metadata 也有 moveTo）", () => {
    const pc = (x: number) => ({ _id: "c1", type: "powerCreep", x, y: 5, user: "u1", className: "operator", level: 3 });
    const scene = build(roomAt(101, { c1: pc(6) }), roomAt(100, { c1: pc(5) }));
    for (const p of ofCreep(scene)) expect(tweenOf(p, "offsetX")?.from, p.key).toBe(-1);
    expect(byKey(scene, "c1/body")).toMatchObject({ rotation: Math.PI / 2, pivotX: 6.5, pivotY: 5.5 });
    expect(tweenOf(byKey(scene, "c1/body"), "turn")?.from).toBeCloseTo(-Math.PI / 2);
  });

  it("creep 的发光（不参与点选）也跟着移动；动作效果不叠加位移（光束从旧格出发，圆环自带滑动）；别的对象不动", () => {
    const tower = { _id: "t1", type: "tower", x: 20, y: 20, user: "u1", store: { energy: 10 }, storeCapacityResource: { energy: 1000 }, actionLog: { attack: { x: 11, y: 10 } } };
    const scene = build(roomAt(101, { c1: creepAt(11, 10), t1: tower }), roomAt(100, { c1: creepAt(10, 10), t1: tower }));
    const glow = scene.primitives.filter((p) => p.key.startsWith("lighting/c1/"));
    expect(glow.length).toBeGreaterThan(0);
    for (const p of glow) expect(tweenOf(p, "offsetX")?.from).toBe(-1);
    const shooting = roomAt(101, { c1: creepAt(11, 10, { actionLog: { rangedAttack: { x: 15, y: 10 }, rangedMassAttack: {} } }) });
    const effects = build(shooting, roomAt(100, { c1: creepAt(10, 10) })).primitives.filter((p) => p.key.startsWith("action/c1/"));
    expect(effects.length).toBeGreaterThan(1);
    for (const p of effects) {
      const offsets = p.animation?.tweens.filter((t) => t.property === "offsetX") ?? [];
      expect(offsets.length, p.key).toBeLessThanOrEqual(1);
      if (p.key.includes("beam")) expect(offsets, p.key).toEqual([]);
    }
    for (const p of scene.primitives.filter((q) => q.key.startsWith("action/t1/") || q.key.startsWith("t1/") || q.key.startsWith("lighting/t1/"))) {
      expect(tweenOf(p, "offsetX"), p.key).toBeUndefined();
    }
  });
});

describe("身体朝向（Scene）", () => {
  const before = roomAt(100, { c1: creepAt(10, 10, { body: [{ type: "work", hits: 100 }, { type: "tough", hits: 100 }] }) });
  const movedRight = roomAt(101, { c1: creepAt(11, 10, { body: [{ type: "work", hits: 100 }, { type: "tough", hits: 100 }] }) });
  /** 身体部件环（work 一段）的第一个顶点：朝上时在中心正上方 0.5 格 */
  const ringStart = (scene: Scene) => {
    const ring = byKey(scene, "c1/ring-work-r");
    if (ring.kind !== "polygon") throw new Error("不是多边形");
    return { x: ring.points[0]!, y: ring.points[1]! };
  };

  it("走了一格：身体终态朝向移动方向，0.2td 内从原来的朝向（没有记录时朝上）转过去，绕新格中心", () => {
    const scene = build(movedRight, before);
    const start = ringStart(scene);
    expect(start.x).toBeCloseTo(11.5 + 0.5);
    expect(start.y).toBeCloseTo(10.5);
    expect(byKey(scene, "c1/tough")).toMatchObject({ kind: "image", rotation: Math.PI / 2, pivotX: 11.5, pivotY: 10.5 });
    for (const key of ["c1/ring-work-r", "c1/ring-work-l", "c1/tough", "c1/base", "c1/core", "c1/badge", "c1/store-energy"]) {
      const p = byKey(scene, key);
      expect(tweenOf(p, "turn"), key).toEqual({ property: "turn", from: -Math.PI / 2, steps: [{ duration: 0.2 * TD }] });
      expect(p.animation).toMatchObject({ originX: 11.5, originY: 10.5 });
      // 转向与位移在同一份 tweens 里
      expect(tweenOf(p, "offsetX")?.from, key).toBe(-1);
    }
    // 玩家名、选中框不转
    for (const key of ["c1/owner-name", "c1/selected"]) expect(tweenOf(byKey(scene, key), "turn"), key).toBeUndefined();
  });

  it("从记住的朝向转过去；不动时保持记住的朝向、不转", () => {
    const facing = new Map([["c1", Math.PI]]);
    const turned = build(movedRight, before, view, facing);
    expect(tweenOf(byKey(turned, "c1/base"), "turn")?.from).toBeCloseTo(Math.PI / 2);
    const still = build(roomAt(102, { c1: movedRight.objects["c1"]! }), movedRight, view, new Map([["c1", Math.PI / 2]]));
    expect(ringStart(still).x).toBeCloseTo(12);
    expect(tweenOf(byKey(still, "c1/base"), "turn")).toBeUndefined();
  });

  it("动画开关关闭或没有朝向信息时朝上（静止画面不变）", () => {
    const off = build(movedRight, before, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, animation: false } }, new Map([["c1", Math.PI / 2]]));
    expect(ringStart(off).x).toBeCloseTo(11.5);
    expect(ringStart(off).y).toBeCloseTo(10);
    expect(ringStart(build(movedRight, undefined)).y).toBeCloseTo(10);
  });
});

describe("nextFacings：朝向沿 Tick 传下去", () => {
  const creep = (x: number, y: number) => ({ c1: creepAt(x, y) });
  it("走了一格就朝移动方向（顺时针弧度，0 = 朝上），否则沿用；消失的对象被丢掉", () => {
    expect(nextFacings(undefined, roomAt(1, creep(10, 10)), roomAt(2, creep(10, 11))).get("c1")).toBeCloseTo(Math.PI);
    expect(nextFacings(undefined, roomAt(1, creep(10, 10)), roomAt(2, creep(9, 10))).get("c1")).toBeCloseTo(-Math.PI / 2);
    expect(nextFacings(undefined, roomAt(1, creep(10, 10)), roomAt(2, creep(11, 9))).get("c1")).toBeCloseTo(Math.PI / 4);
    const remembered = new Map([["c1", 1]]);
    expect(nextFacings(remembered, roomAt(1, creep(10, 10)), roomAt(2, creep(10, 10))).get("c1")).toBe(1);
    expect(nextFacings(remembered, roomAt(1, creep(10, 10)), roomAt(2, creep(30, 10))).get("c1")).toBe(1);
    expect(nextFacings(remembered, undefined, roomAt(2, creep(30, 10))).get("c1")).toBe(1);
    expect(nextFacings(remembered, roomAt(1, creep(10, 10)), roomAt(2, {})).has("c1")).toBe(false);
  });
});
