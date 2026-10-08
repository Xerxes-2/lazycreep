/**
 * #26：显示选项（say 气泡、RoomVisual、血条、玩家名）作用于 Room View 的 Scene 构建，并在重新挂载后恢复。
 */
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

/** 足够大，血条与玩家名都按缩放显示 */
const near: RoomSceneView = { theme: DEFAULT_THEME, zoom: 40 };

const build = (view: RoomSceneView): Scene => buildRoomScene({ state }, view);
const visuals = (scene: Scene) => scene.primitives.filter((p) => p.layer === LAYER.visual);
const hitsBars = (scene: Scene) => scene.primitives.filter((p) => p.kind === "bar" && p.key.endsWith("/hits"));
const nameLabels = (scene: Scene) =>
  scene.primitives.filter((p) => p.kind === "text" && p.text === "Xerxes_2");

describe("显示选项 → Room View 的 Scene", () => {
  it("默认四项全开：RoomVisual、血条、creep 上方的玩家名都画出来", () => {
    const display = createRoomDisplayOptions(memoryStorage()).display();
    expect(display).toEqual({ say: true, visual: true, bars: true, names: true });
    const scene = build({ ...near, display });
    expect(visuals(scene)).toHaveLength(1);
    expect(hitsBars(scene).map((p) => p.objectId).sort()).toEqual(["c1", "s1"]);
    const [label, ...more] = nameLabels(scene);
    expect(more).toEqual([]);
    expect(label).toMatchObject({ objectId: "c1", kind: "text" });
    expect(label!.kind === "text" && label!.y).toBeLessThan(10.5);
  });

  it("玩家名与血条一样，缩小到看不清时只给选中对象画", () => {
    const far = { theme: DEFAULT_THEME, zoom: 4 };
    expect(nameLabels(build(far))).toEqual([]);
    expect(nameLabels(build({ ...far, selectedId: "c1" }))).toHaveLength(1);
  });

  it("关闭 RoomVisual / 血条 / 玩家名后对应图元不出现，其余图元不受影响", () => {
    const options = createRoomDisplayOptions(memoryStorage());
    const before = build({ ...near, display: options.display() });

    options.set("visual", false);
    const noVisual = build({ ...near, display: options.display() });
    expect(visuals(noVisual)).toEqual([]);
    expect(hitsBars(noVisual)).toHaveLength(2);
    expect(nameLabels(noVisual)).toHaveLength(1);

    options.set("visual", true);
    options.set("bars", false);
    const noBars = build({ ...near, display: options.display() });
    expect(hitsBars(noBars)).toEqual([]);
    expect(visuals(noBars)).toHaveLength(1);

    options.set("bars", true);
    options.set("names", false);
    const noNames = build({ ...near, display: options.display() });
    expect(nameLabels(noNames)).toEqual([]);
    expect(noNames.primitives.find((p) => p.key === "c1/body")).toEqual(before.primitives.find((p) => p.key === "c1/body"));
  });

  it("开关在重新挂载（按同一存储重建）后恢复；say 开关只存储，经读取函数给出", () => {
    const storage = memoryStorage();
    const first = createRoomDisplayOptions(storage);
    first.set("visual", false);
    first.set("names", false);
    first.set("say", false);

    const again = createRoomDisplayOptions(storage).display();
    expect(again).toEqual({ say: false, visual: false, bars: true, names: false });
    const scene = build({ ...near, display: again });
    expect(visuals(scene)).toEqual([]);
    expect(nameLabels(scene)).toEqual([]);
    expect(hitsBars(scene)).toHaveLength(2);
    expect(showSayBubbles(again)).toBe(false);
    expect(showSayBubbles(undefined)).toBe(true);
  });

  it("存储内容损坏时退回默认", () => {
    const storage = memoryStorage();
    storage.setItem("msc.roomDisplay", '{"visual": "nope", "bars": false');
    expect(createRoomDisplayOptions(storage).display()).toEqual({ say: true, visual: true, bars: true, names: true });
    storage.setItem("msc.roomDisplay", '{"visual": "nope", "bars": false}');
    expect(createRoomDisplayOptions(storage).display()).toEqual({ say: true, visual: true, bars: false, names: true });
  });
});
