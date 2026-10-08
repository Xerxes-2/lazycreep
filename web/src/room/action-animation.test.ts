/**
 * #55：塔的射击动画（Scene 构建，纯数据）。数值照 #53 Further Notes 的表：td = Tick 间隔；
 * 光束 0.6td（先伸后收），塔身 glow 0.5 → 1 → 0.5 与 flare1 0 → 0.2 → 0（0.1td 升、0.3td 降），
 * 塔维修的目标闪光 0.3td 开始、0.9td 结束，炮塔转向固定 0.3 秒。
 */
import { describe, expect, it } from "vitest";
import { animationDuration } from "../scene/animation.ts";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { LIGHT_LAYER } from "./official-lighting.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom, type RoomState } from "./room-state.ts";

const TD = 2000;

const tower = (actionLog: Record<string, unknown> = {}) => ({
  _id: "t1",
  type: "tower",
  x: 10,
  y: 10,
  user: "u1",
  store: { energy: 500 },
  storeCapacityResource: { energy: 1000 },
  actionLog,
});

const roomAt = (gameTime: number, actionLog: Record<string, unknown> = {}): RoomState =>
  roomStateFrom({
    gameTime,
    objects: {
      t1: tower(actionLog),
      c1: { _id: "c1", type: "creep", x: 13, y: 14, user: "u2", body: [] },
      w1: { _id: "w1", type: "constructedWall", x: 7, y: 10, hits: 10, hitsMax: 100 },
    },
    users: { u1: { _id: "u1", username: "me" }, u2: { _id: "u2", username: "foe" } },
  });

const view: RoomSceneView = { theme: DEFAULT_THEME, tickMs: TD };
const build = (state: RoomState, previous: RoomState | undefined, v: RoomSceneView = view): Scene =>
  buildRoomScene({ state, previous }, v);
const byKey = (scene: Scene, key: string) => {
  const found = scene.primitives.find((p) => p.key === key);
  if (!found) throw new Error(`没有 ${key}：${scene.primitives.map((p) => p.key).join(", ")}`);
  return found;
};
const animated = (scene: Scene) => scene.primitives.filter((p) => p.animation !== undefined);

describe("塔的射击动画（Scene）", () => {
  const idle = roomAt(100);
  const attacking = roomAt(101, { attack: { x: 13, y: 14 } });

  it("攻击：蓝色光束从塔射向目标（清晰线 + 更宽的半透明线，加色），先伸后收、共 0.6td，终态长度为 0", () => {
    const scene = build(attacking, idle);
    const sharp = byKey(scene, "action/t1/attack-beam");
    const halo = byKey(scene, "action/t1/attack-beam-halo");
    for (const line of [sharp, halo]) {
      expect(line).toMatchObject({ kind: "line", points: [10.5, 10.5, 13.5, 14.5], blend: "add", trimStart: 1, trimEnd: 1 });
      expect(line.kind === "line" && line.stroke.color).toBe(0x3c75c7);
      expect(line.objectId).toBeUndefined();
      expect(line.animation?.tweens).toEqual([
        { property: "trimEnd", from: 0, steps: [{ duration: 600 }] },
        { property: "trimStart", from: 0, delay: 600, steps: [{ duration: 600 }] },
      ]);
      expect(animationDuration(line.animation!)).toBe(0.6 * TD);
    }
    expect(sharp.kind === "line" && sharp.stroke.width).toBeCloseTo(0.18);
    expect(halo.kind === "line" && halo.stroke.width).toBeGreaterThan(0.18);
    expect(halo.kind === "line" && halo.stroke.alpha).toBeLessThan(1);
  });

  it("塔身闪光：flare1 0 → 0.2 → 0、光照 glow 0.5 → 1 → 0.5（0.1td 升、0.3td 降）", () => {
    const scene = build(attacking, idle);
    const flare = byKey(scene, "action/t1/flare");
    expect(flare).toMatchObject({ kind: "image", blend: "add", alpha: 0, width: 4, height: 4, x: 8.5, y: 8.5 });
    expect(flare.kind === "image" && flare.url).toMatch(/flare1\.png$/);
    expect(flare.animation?.tweens).toEqual([{ property: "alpha", from: 0, steps: [{ to: 0.2, duration: 200 }, { duration: 600 }] }]);

    // 塔的 light glow（600，官方 alpha 0.5）在光照组里滤色叠加；有能量时的小 glow（100）不闪
    const glow = byKey(scene, "lighting/t1/1");
    expect(glow).toMatchObject({ group: "lighting", blend: "screen", alpha: 0.5, width: 6 });
    expect(glow.animation?.tweens).toEqual([{ property: "alpha", from: 0.5, steps: [{ to: 1, duration: 200 }, { duration: 600 }] }]);
    expect(byKey(scene, "lighting/t1/0")).toMatchObject({ width: 1, alpha: 1 });
    expect(byKey(scene, "lighting/t1/0").animation).toBeUndefined();
  });

  it("炮塔（与能量条）从上一个画面的朝向转向目标，0.3 秒，绕塔中心；终态就是静止画面的朝向", () => {
    const scene = build(attacking, idle);
    const still = build(attacking, undefined);
    for (const part of ["turret", "energy"]) {
      const moving = byKey(scene, `t1/${part}`);
      const { animation, ...rest } = moving;
      expect(rest).toEqual(byKey(still, `t1/${part}`));
      expect(animation).toMatchObject({ originX: 10.5, originY: 10.5 });
      const [turn] = animation!.tweens;
      expect(turn).toMatchObject({ property: "turn", steps: [{ duration: 300 }] });
      // 空闲时为 0，目标在右下 (3, 4)：终态是官方 calculateAngle 的 atan2(-4, -3) + π/2，起点比终态少转这么多
      const final = Math.atan2(-4, -3) + Math.PI / 2;
      expect(turn!.from).toBeCloseTo(0 - final);
    }
    // 上个 Tick 已经朝着同一个目标：不用转
    const again = build(roomAt(102, { attack: { x: 13, y: 14 } }), attacking);
    expect(byKey(again, "t1/turret").animation).toBeUndefined();
    // 转向走近的一边
    const behind = build(roomAt(102, { heal: { x: 10, y: 5 } }), roomAt(101, { attack: { x: 9, y: 14 } }));
    const from = byKey(behind, "t1/turret").animation!.tweens[0]!.from;
    expect(Math.abs(from)).toBeLessThanOrEqual(Math.PI);
  });

  it("治疗是绿色光束；维修是黄色光束，目标处 cover 闪光 0.3td 开始、0.9td 结束", () => {
    const healing = build(roomAt(101, { heal: { x: 13, y: 14 } }), idle);
    expect(byKey(healing, "action/t1/heal-beam")).toMatchObject({ stroke: { color: 0x2ce328 } });
    expect(healing.primitives.some((p) => p.key.includes("repair-target"))).toBe(false);

    const repairing = build(roomAt(101, { repair: { x: 7, y: 10 } }), idle);
    expect(byKey(repairing, "action/t1/repair-beam")).toMatchObject({ stroke: { color: 0xffe533 }, points: [10.5, 10.5, 7.5, 10.5] });
    const cover = byKey(repairing, "action/t1/repair-target-cover");
    expect(cover).toMatchObject({ kind: "image", alpha: 0, tint: 0xffe533 });
    expect(cover.kind === "image" && cover.x + cover.width / 2).toBeCloseTo(7.5);
    expect(cover.animation?.tweens).toEqual([
      { property: "alpha", from: 0, delay: 600, steps: [{ to: 0.3, duration: 300 }, { duration: 900 }] },
    ]);
    expect(animationDuration(cover.animation!)).toBe(0.9 * TD);
    expect(byKey(repairing, "action/t1/repair-target-flare")).toMatchObject({ blend: "add", tint: 0xffe533 });
    // 目标闪光的 glow 在光照组里：滤色，峰值是官方的 0.5
    const glow = byKey(repairing, "action/t1/repair-target-glow");
    expect(glow).toMatchObject({ group: "lighting", blend: "screen", layer: LIGHT_LAYER, alpha: 0 });
    expect(glow.animation?.tweens).toEqual([{ property: "alpha", from: 0, delay: 600, steps: [{ to: 0.5, duration: 300 }, { duration: 900 }] }]);
    // 光照关闭时目标闪光没有 glow
    const dark = build(roomAt(101, { repair: { x: 7, y: 10 } }), idle, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, lighting: false } });
    expect(dark.primitives.some((p) => p.key === "action/t1/repair-target-glow")).toBe(false);
  });

  it("时长按 Tick 间隔缩放；炮塔转向固定 0.3 秒", () => {
    const slow = build(attacking, idle, { ...view, tickMs: 3700 });
    expect(animationDuration(byKey(slow, "action/t1/attack-beam").animation!)).toBeCloseTo(0.6 * 3700);
    expect(animationDuration(byKey(slow, "action/t1/flare").animation!)).toBeCloseTo(0.4 * 3700);
    expect(animationDuration(byKey(slow, "t1/turret").animation!)).toBe(300);
  });

  it("连续两个 Tick 同样的动作：动画标识不同（会重播）；同一 Tick 内重建不变", () => {
    const first = build(attacking, idle);
    const second = build(roomAt(102, { attack: { x: 13, y: 14 } }), attacking);
    const id = (scene: Scene) => byKey(scene, "action/t1/attack-beam").animation!.id;
    expect(id(first)).not.toEqual(id(second));
    expect(build(attacking, idle, { ...view, selectedId: "c1", zoom: 40 }).primitives.find((p) => p.key === "action/t1/attack-beam")).toEqual(
      byKey(first, "action/t1/attack-beam"),
    );
  });

  it("动画开关关闭、没有上一个状态或没有 Tick 间隔时：没有动画字段，也没有只为动画存在的图元，与静止画面相同", () => {
    const still = buildRoomScene({ state: attacking }, { theme: DEFAULT_THEME });
    const off = build(attacking, idle, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, animation: false } });
    expect(off).toEqual(still);
    expect(build(attacking, undefined)).toEqual(still);
    expect(buildRoomScene({ state: attacking, previous: idle }, { theme: DEFAULT_THEME })).toEqual(still);
    expect(animated(still)).toEqual([]);
    // 关闭时炮塔仍静态指向本 Tick 的目标
    expect(byKey(still, "t1/turret").kind === "image" && (byKey(still, "t1/turret") as Primitive & { rotation: number }).rotation).toBeCloseTo(
      Math.atan2(-4, -3) + Math.PI / 2,
    );
  });

  it("塔空闲时不转、没有动作效果", () => {
    const scene = build(roomAt(101), idle);
    expect(animated(scene)).toEqual([]);
    expect(scene.primitives.some((p) => p.key.startsWith("action/"))).toBe(false);
  });
});
