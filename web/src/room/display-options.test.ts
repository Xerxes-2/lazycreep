/**
 * #26：显示选项（say 气泡、RoomVisual、玩家名、光照）作用于 Room View 的 Scene 构建，并在重新挂载后恢复。
 * #54：血条开关已删除，存储里旧的 `bars` 值被忽略。
 * #55：动画开关的默认值随系统的“减少动态效果”，用户设置过的值优先。
 */
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import type { Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { KeyValueStorage } from "../storage/local-store.ts";
import { createRoomDisplayOptions, showSayBubbles } from "./display-options.ts";
import { LAYER, buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const state = {
  ...roomStateFrom({
    objects: {
      c1: { _id: "c1", type: "creep", x: 10, y: 10, user: "u1", hits: 50, hitsMax: 100, name: "Harvester1" },
      s1: { _id: "s1", type: "spawn", x: 20, y: 20, user: "u1", hits: 1000, hitsMax: 5000 },
    },
    users: { u1: { _id: "u1", username: "Xerxes_2" } },
  }),
  visual: JSON.stringify({ t: "c", x: 5, y: 5 }) + "\n",
};

/** 足够大，玩家名按缩放显示 */
const near: RoomSceneView = { theme: DEFAULT_THEME, zoom: 40 };

const build = (view: RoomSceneView): Scene => buildRoomScene({ state }, view);
const visuals = (scene: Scene) => scene.primitives.filter((p) => p.layer === LAYER.visual);
/** 两个对象自身的图元（不含玩家名），用来确认开关只影响自己那类图元 */
const bodies = (scene: Scene) => scene.primitives.filter((p) => p.objectId !== undefined && p.kind !== "text");
const nameLabels = (scene: Scene) =>
  scene.primitives.filter((p) => p.kind === "text" && p.text === "Xerxes_2");

describe("显示选项 → Room View 的 Scene", () => {
  it("默认全开：RoomVisual、creep 下方的玩家名都画出来", () => {
    const display = createRoomDisplayOptions(memoryStorage()).display();
    expect(display).toEqual({ say: true, visual: true, names: true, lighting: true, animation: true });
    const scene = build({ ...near, display });
    expect(visuals(scene)).toHaveLength(1);
    expect(new Set(bodies(scene).map((p) => p.objectId))).toEqual(new Set(["c1", "s1"]));
    const [label, ...more] = nameLabels(scene);
    expect(more).toEqual([]);
    expect(label).toMatchObject({ objectId: "c1", kind: "text" });
    expect(label!.kind === "text" && label!.y).toBeGreaterThan(10.5);
  });

  it("玩家名缩小到看不清时只给选中对象画", () => {
    const far = { theme: DEFAULT_THEME, zoom: 4 } as const;
    expect(nameLabels(build(far))).toEqual([]);
    expect(nameLabels(build({ ...far, selectedId: "c1" }))).toHaveLength(1);
  });

  it("关闭 RoomVisual / 玩家名后对应图元不出现，其余图元不受影响", () => {
    const options = createRoomDisplayOptions(memoryStorage());
    const before = build({ ...near, display: options.display() });

    options.set("visual", false);
    const noVisual = build({ ...near, display: options.display() });
    expect(visuals(noVisual)).toEqual([]);
    expect(bodies(noVisual)).toEqual(bodies(before));
    expect(nameLabels(noVisual)).toHaveLength(1);

    options.set("visual", true);
    options.set("names", false);
    const noNames = build({ ...near, display: options.display() });
    expect(nameLabels(noNames)).toEqual([]);
    expect(visuals(noNames)).toHaveLength(1);
    expect(bodies(noNames)).toEqual(bodies(before));
  });

  it("开关在重新挂载（按同一存储重建）后恢复；say 开关只存储，经读取函数给出", () => {
    const storage = memoryStorage();
    const first = createRoomDisplayOptions(storage);
    first.set("visual", false);
    first.set("names", false);
    first.set("say", false);

    const again = createRoomDisplayOptions(storage).display();
    expect(again).toEqual({ say: false, visual: false, names: false, lighting: true, animation: true });
    const scene = build({ ...near, display: again });
    expect(visuals(scene)).toEqual([]);
    expect(nameLabels(scene)).toEqual([]);
    expect(showSayBubbles(again)).toBe(false);
    expect(showSayBubbles(undefined)).toBe(true);
  });

  it("存储内容损坏时退回默认", () => {
    const storage = memoryStorage();
    storage.setItem("msc.roomDisplay", '{"visual": "nope", "names": false');
    expect(createRoomDisplayOptions(storage).display()).toEqual({ say: true, visual: true, names: true, lighting: true, animation: true });
    storage.setItem("msc.roomDisplay", '{"visual": "nope", "names": false}');
    expect(createRoomDisplayOptions(storage).display()).toEqual({ say: true, visual: true, names: false, lighting: true, animation: true });
  });

  it("#54：存储里旧的血条开关被忽略，其余开关照读；之后写回时不再带它", () => {
    const storage = memoryStorage();
    storage.setItem("msc.roomDisplay", '{"say": true, "visual": false, "bars": false, "names": true, "lighting": false}');
    const options = createRoomDisplayOptions(storage);
    expect(options.display()).toEqual({ say: true, visual: false, names: true, lighting: false, animation: true });
    options.set("names", false);
    expect(JSON.parse(storage.getItem("msc.roomDisplay")!)).toEqual({ say: true, visual: false, names: false, lighting: false });
  });

  describe("#55 动画开关", () => {
    it("默认开；系统要求减少动态效果时默认关，并跟随系统偏好变化", () => {
      createRoot((dispose) => {
        const [reduced, setReduced] = createSignal(false);
        const options = createRoomDisplayOptions(memoryStorage(), { reducedMotion: reduced });
        expect(options.display().animation).toBe(true);
        setReduced(true);
        expect(options.display().animation).toBe(false);
        dispose();
      });
    });

    it("用户设置过的值优先于系统偏好，且被记住；设置别的开关不会把动画的默认值写死", () => {
      const storage = memoryStorage();
      const reduced = () => true;
      const first = createRoomDisplayOptions(storage, { reducedMotion: reduced });
      first.set("names", false);
      // 只设置了玩家名：动画仍是“未设置”，随系统偏好
      expect(JSON.parse(storage.getItem("msc.roomDisplay")!)).toEqual({ names: false });
      expect(createRoomDisplayOptions(storage, { reducedMotion: () => false }).display().animation).toBe(true);
      first.set("animation", true);
      expect(createRoomDisplayOptions(storage, { reducedMotion: reduced }).display()).toMatchObject({ names: false, animation: true });
      first.set("animation", false);
      expect(createRoomDisplayOptions(storage, { reducedMotion: () => false }).display().animation).toBe(false);
    });
  });
});
