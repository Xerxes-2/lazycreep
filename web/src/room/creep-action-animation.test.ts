/**
 * #56：creep 的光束类动作动画（Scene 构建，纯数据）。数值照 #53 Further Notes 的表（td = Tick 间隔）：
 * 远程攻击蓝光束、远程治疗绿光束（宽 12，0.6td）；建造、升级、维修黄光束 0.6td 加目标闪光（0.3td 开始、0.9td 结束）；
 * 群体远程攻击是半径 3 格的圆 0x5d80b2，加色，scale 0→1、透明度 0.4→0，easeOutQuad，0.6td；
 * 拆除、攻击控制器、transfer / withdraw 不画。
 * 起点照官方 creepActions：光束从 creep 动作时所在的格子（本 Tick 移动前的位置）射出。
 */
import { describe, expect, it } from "vitest";
import { animationDuration } from "../scene/animation.ts";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom, type RoomState } from "./room-state.ts";

const TD = 2000;

const roomAt = (gameTime: number, actionLog: Record<string, unknown> = {}, at = { x: 20, y: 20 }, type = "creep"): RoomState =>
  roomStateFrom({
    gameTime,
    objects: {
      c1: { _id: "c1", type, x: at.x, y: at.y, user: "u1", body: [], actionLog },
      w1: { _id: "w1", type: "constructedWall", x: 23, y: 24, hits: 10, hitsMax: 100 },
    },
    users: { u1: { _id: "u1", username: "me" } },
  });

const view: RoomSceneView = { theme: DEFAULT_THEME, tickMs: TD };
const build = (state: RoomState, previous: RoomState | undefined, v: RoomSceneView = view): Scene =>
  buildRoomScene({ state, previous }, v);
const byKey = (scene: Scene, key: string) => {
  const found = scene.primitives.find((p) => p.key === key);
  if (!found) throw new Error(`没有 ${key}：${scene.primitives.map((p) => p.key).join(", ")}`);
  return found;
};
const effects = (scene: Scene) => scene.primitives.filter((p) => p.key.startsWith("action/"));
const strokeOf = (p: Primitive) => (p.kind === "line" ? p.stroke : undefined);

const idle = roomAt(100);
const target = { x: 23, y: 24 };

describe("creep 的光束（Scene）", () => {
  it.each([
    ["rangedAttack", 0x3c75c7],
    ["rangedHeal", 0x2ce328],
    ["build", 0xffe533],
    ["upgradeController", 0xffe533],
    ["repair", 0xffe533],
  ] as const)("%s：从 creep 中心射向目标，颜色 %i、宽 12，先伸后收共 0.6td，终态长度为 0，不参与点选", (action, color) => {
    const scene = build(roomAt(101, { [action]: target }), idle);
    const sharp = byKey(scene, `action/c1/${action}-beam`);
    const halo = byKey(scene, `action/c1/${action}-beam-halo`);
    for (const line of [sharp, halo]) {
      expect(line).toMatchObject({ kind: "line", points: [20.5, 20.5, 23.5, 24.5], blend: "add", trimStart: 1, trimEnd: 1 });
      expect(strokeOf(line)?.color).toBe(color);
      expect(line.objectId).toBeUndefined();
      expect(line.animation?.tweens).toEqual([
        { property: "trimEnd", from: 0, steps: [{ duration: 600 }] },
        { property: "trimStart", from: 0, delay: 600, steps: [{ duration: 600 }] },
      ]);
      expect(animationDuration(line.animation!)).toBe(0.6 * TD);
    }
    expect(strokeOf(sharp)?.width).toBeCloseTo(0.12);
  });

  it.each(["build", "upgradeController", "repair"])("%s：目标处黄色 cover 闪光，0.3td 开始、0.9td 结束", (action) => {
    const scene = build(roomAt(101, { [action]: target }), idle);
    const cover = byKey(scene, `action/c1/${action}-target-cover`);
    expect(cover).toMatchObject({ kind: "image", alpha: 0, tint: 0xffe533 });
    expect(cover.kind === "image" && cover.x + cover.width / 2).toBeCloseTo(23.5);
    expect(cover.kind === "image" && cover.y + cover.height / 2).toBeCloseTo(24.5);
    expect(cover.animation?.tweens).toEqual([
      { property: "alpha", from: 0, delay: 600, steps: [{ to: 0.3, duration: 300 }, { duration: 900 }] },
    ]);
    expect(animationDuration(cover.animation!)).toBe(0.9 * TD);
    expect(byKey(scene, `action/c1/${action}-target-flare`)).toMatchObject({ blend: "add", tint: 0xffe533 });
    expect(byKey(scene, `action/c1/${action}-target-glow`)).toMatchObject({ group: "lighting", blend: "screen" });
  });

  it("远程攻击、远程治疗没有目标闪光", () => {
    for (const action of ["rangedAttack", "rangedHeal"]) {
      const scene = build(roomAt(101, { [action]: target }), idle);
      expect(effects(scene).some((p) => p.key.includes("target"))).toBe(false);
    }
  });

  it("本 Tick 移动了一格：光束从移动前的格子射出（官方与游戏规则都在移动前结算动作）", () => {
    const moved = build(roomAt(101, { rangedAttack: target }, { x: 21, y: 20 }), idle);
    expect(byKey(moved, "action/c1/rangedAttack-beam")).toMatchObject({ points: [20.5, 20.5, 23.5, 24.5] });
    // 位移超过一格（跨出口、上一个状态里没有）：从新位置射出
    const jumped = build(roomAt(101, { rangedAttack: target }, { x: 40, y: 20 }), idle);
    expect(byKey(jumped, "action/c1/rangedAttack-beam")).toMatchObject({ points: [40.5, 20.5, 23.5, 24.5] });
  });

  it("powerCreep 同样按表画（官方 powerCreep 也用 creepActions）", () => {
    const scene = build(roomAt(101, { repair: target }, undefined, "powerCreep"), roomAt(100, {}, undefined, "powerCreep"));
    expect(byKey(scene, "action/c1/repair-beam")).toMatchObject({ stroke: { color: 0xffe533 } });
    expect(byKey(scene, "action/c1/repair-target-cover")).toMatchObject({ tint: 0xffe533 });
  });
});

describe("群体远程攻击的圆环（Scene）", () => {
  it("以 creep 为中心半径 3 格的圆，0x5d80b2 加色；scale 0→1、透明度 0.4→0，easeOutQuad，0.6td；终态不可见", () => {
    const scene = build(roomAt(101, { rangedMassAttack: {} }), idle);
    const ring = byKey(scene, "action/c1/rangedMassAttack");
    expect(ring).toMatchObject({ kind: "circle", x: 20.5, y: 20.5, radius: 3, fill: 0x5d80b2, blend: "add", alpha: 0 });
    expect(ring.objectId).toBeUndefined();
    expect(ring.animation).toMatchObject({ originX: 20.5, originY: 20.5 });
    expect(ring.animation?.tweens).toEqual([
      { property: "scale", from: 0, steps: [{ duration: 1200, easing: "easeOutQuad" }] },
      { property: "alpha", from: 0.4, steps: [{ duration: 1200, easing: "easeOutQuad" }] },
    ]);
  });

  it("本 Tick 移动了：圆环跟着 creep 从旧格移到新格（官方圆环挂在 creep 上），终态在新格", () => {
    const scene = build(roomAt(101, { rangedMassAttack: {} }, { x: 21, y: 19 }), idle);
    const ring = byKey(scene, "action/c1/rangedMassAttack");
    expect(ring).toMatchObject({ x: 21.5, y: 19.5 });
    expect(ring.animation?.tweens).toEqual(
      expect.arrayContaining([
        { property: "offsetX", from: -1, steps: [{ duration: TD, easing: "easeInOutQuad" }] },
        { property: "offsetY", from: 1, steps: [{ duration: TD, easing: "easeInOutQuad" }] },
      ]),
    );
  });
});

describe("不画的动作与开关", () => {
  it.each(["dismantle", "attackController", "transfer", "withdraw"])("%s 没有效果图元", (action) => {
    const scene = build(roomAt(101, { [action]: target }), idle);
    expect(effects(scene)).toEqual([]);
  });

  it("连续两个 Tick 同样的动作：动画标识不同（会重播）", () => {
    const first = build(roomAt(101, { rangedAttack: target }), idle);
    const second = build(roomAt(102, { rangedAttack: target }), roomAt(101, { rangedAttack: target }));
    const id = (scene: Scene) => byKey(scene, "action/c1/rangedAttack-beam").animation!.id;
    expect(id(first)).not.toEqual(id(second));
  });

  it("动画开关关闭或没有上一个状态：没有效果图元，与静止画面相同", () => {
    const state = roomAt(101, { build: target, rangedMassAttack: {}, rangedHeal: target });
    const still = buildRoomScene({ state }, { theme: DEFAULT_THEME });
    expect(build(state, idle, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, animation: false } })).toEqual(still);
    expect(build(state, undefined)).toEqual(still);
    expect(effects(still)).toEqual([]);
    expect(still.primitives.filter((p) => p.animation !== undefined)).toEqual([]);
  });
});
