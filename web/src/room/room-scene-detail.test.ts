/**
 * #12：buildRoomScene 的可读性规则——按玩家着色、血条 / 资源条按缩放显隐、选中高亮。
 */
import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { BAR_MIN_ZOOM } from "./room-detail-rules.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom, type RoomState } from "./room-state.ts";

const theme = DEFAULT_THEME;

const users = {
  me1: { _id: "me1", username: "Xerxes_2" },
  al1: { _id: "al1", username: "Friend" },
  st1: { _id: "st1", username: "Stranger" },
  st2: { _id: "st2", username: "Another" },
};

function stateWith(objects: Record<string, Record<string, unknown>>): RoomState {
  return roomStateFrom({ objects, users });
}

const ofObject = (scene: Scene, id: string) => scene.primitives.filter((p) => p.objectId === id);
const part = (scene: Scene, id: string, name: string): Primitive | undefined =>
  scene.primitives.find((p) => p.key === `${id}/${name}`);

function creepFill(scene: Scene, id: string) {
  const body = part(scene, id, "body");
  return body?.kind === "circle" ? body.fill : undefined;
}

describe("buildRoomScene：按玩家着色", () => {
  const creeps = stateWith({
    a: { _id: "a", type: "creep", x: 1, y: 1, user: "me1" },
    b: { _id: "b", type: "creep", x: 2, y: 1, user: "al1" },
    c: { _id: "c", type: "creep", x: 3, y: 1, user: "st1" },
    d: { _id: "d", type: "creep", x: 4, y: 1, user: "st2" },
  });
  const view: RoomSceneView = { theme, me: "me1", allies: new Set(["friend"]) };

  it("我方、盟友、陌生人三类颜色互不相同", () => {
    const scene = buildRoomScene({ state: creeps }, view);
    expect(creepFill(scene, "a")).toBe(theme.owned);
    expect(creepFill(scene, "b")).toBe(theme.ally);
    const stranger = creepFill(scene, "c");
    expect(theme.strangers).toContain(stranger);
    expect(stranger).not.toBe(theme.owned);
    expect(stranger).not.toBe(theme.ally);
  });

  it("不同陌生人按玩家区分，同一玩家颜色稳定", () => {
    const scene = buildRoomScene({ state: creeps }, view);
    expect(creepFill(scene, "c")).not.toBe(creepFill(scene, "d"));
    const again = buildRoomScene({ state: creeps }, { theme, me: "me1" });
    expect(creepFill(again, "c")).toBe(creepFill(scene, "c"));
  });

  it("盟友集合默认为空：盟友当陌生人画", () => {
    const scene = buildRoomScene({ state: creeps }, { theme, me: "me1" });
    expect(theme.strangers).toContain(creepFill(scene, "b"));
  });

  it("盟友名单按用户名匹配，不分大小写", () => {
    const scene = buildRoomScene({ state: creeps }, { theme, me: "me1", allies: new Set(["FRIEND"]) });
    expect(creepFill(scene, "b")).toBe(theme.ally);
  });

  it("建筑轮廓与 rampart 用同一套规则", () => {
    const scene = buildRoomScene(
      {
        state: stateWith({
          s: { _id: "s", type: "spawn", x: 5, y: 5, user: "al1" },
          r: { _id: "r", type: "rampart", x: 6, y: 5, user: "st1" },
        }),
      },
      view,
    );
    const spawn = part(scene, "s", "body");
    expect(spawn?.kind === "circle" && spawn.stroke?.color).toBe(theme.ally);
    const rampart = part(scene, "r", "body");
    expect(rampart?.kind === "rect" && rampart.fill).toBe(creepFill(buildRoomScene({ state: creeps }, view), "c"));
  });
});

describe("buildRoomScene：血条与资源条按缩放显隐", () => {
  const state = stateWith({
    c: { _id: "c", type: "creep", x: 1, y: 1, user: "me1", hits: 30, hitsMax: 120, store: { energy: 25 }, storeCapacity: 50 },
    s: { _id: "s", type: "storage", x: 3, y: 3, user: "me1", hits: 5000, hitsMax: 10000, store: { energy: 1000 }, storeCapacity: 1000000 },
    t: { _id: "t", type: "tower", x: 5, y: 5, user: "me1", hits: 3000, hitsMax: 3000 },
    w: { _id: "w", type: "constructedWall", x: 7, y: 7, hits: 1000, hitsMax: 300000000 },
    r: { _id: "r", type: "road", x: 9, y: 9, hits: 3300, hitsMax: 5000 },
  });
  const bars = (scene: Scene, id: string) => ofObject(scene, id).filter((p) => p.kind === "bar");
  const near = (zoom: number) => buildRoomScene({ state }, { theme, me: "me1", zoom });

  it("阈值以上：creep 有血条与能量条，受损建筑有血条与资源条", () => {
    const scene = near(BAR_MIN_ZOOM);
    expect(part(scene, "c", "hits")).toMatchObject({ kind: "bar", value: 0.25 });
    expect(part(scene, "c", "store")).toMatchObject({ kind: "bar", value: 0.5 });
    expect(part(scene, "s", "hits")).toMatchObject({ kind: "bar", value: 0.5 });
    expect(part(scene, "s", "store")).toMatchObject({ kind: "bar", value: 0.001 });
  });

  it("同一对象的几条进度条不重叠", () => {
    const scene = near(BAR_MIN_ZOOM);
    for (const id of ["c", "s"]) {
      const [a, b] = bars(scene, id);
      expect(a?.kind === "bar" && b?.kind === "bar" && (a.y + a.height <= b.y || b.y + b.height <= a.y)).toBe(true);
    }
  });

  it("满血建筑、墙与道路不画血条", () => {
    const scene = near(BAR_MIN_ZOOM * 2);
    expect(bars(scene, "t")).toEqual([]);
    expect(bars(scene, "w")).toEqual([]);
    expect(bars(scene, "r")).toEqual([]);
  });

  it("阈值以下：所有进度条隐藏，对象本体仍在", () => {
    const scene = near(BAR_MIN_ZOOM - 0.01);
    expect(scene.primitives.filter((p) => p.kind === "bar")).toEqual([]);
    expect(part(scene, "c", "body")).toBeDefined();
    expect(part(scene, "s", "body")).toBeDefined();
  });

  it("阈值以下，选中对象的进度条仍然显示", () => {
    const scene = buildRoomScene({ state }, { theme, zoom: 1, selectedId: "c" });
    expect(bars(scene, "c")).toHaveLength(2);
    expect(bars(scene, "s")).toEqual([]);
  });
});

describe("buildRoomScene：选中态", () => {
  const state = stateWith({
    c: { _id: "c", type: "creep", x: 10, y: 12, user: "me1" },
    r: { _id: "r", type: "road", x: 11, y: 12 },
  });

  it("选中对象多一个高亮框，盖在对象之上、框住它的格子", () => {
    const scene = buildRoomScene({ state }, { theme, selectedId: "c" });
    const highlight = part(scene, "c", "selected");
    expect(highlight).toMatchObject({ kind: "rect", stroke: { color: theme.selection } });
    if (highlight?.kind !== "rect") throw new Error("高亮应为矩形");
    expect(highlight.x).toBeLessThanOrEqual(10);
    expect(highlight.y).toBeLessThanOrEqual(12);
    expect(highlight.x + highlight.width).toBeGreaterThanOrEqual(11);
    expect(highlight.y + highlight.height).toBeGreaterThanOrEqual(13);
    const others = ofObject(scene, "c").filter((p) => p !== highlight);
    expect(others.every((p) => p.layer < highlight.layer)).toBe(true);
    expect(part(scene, "r", "selected")).toBeUndefined();
  });

  it("没有选中或选中的对象不在房间里时没有高亮", () => {
    expect(buildRoomScene({ state }, { theme }).primitives.some((p) => p.key.endsWith("/selected"))).toBe(false);
    expect(
      buildRoomScene({ state }, { theme, selectedId: "gone" }).primitives.some((p) => p.key.endsWith("/selected")),
    ).toBe(false);
  });
});

describe("buildRoomScene：同时有血条与资源条时顺序固定", () => {
  // 建筑的画法自己画资源条、creep 的条全由通用规则补上，两条路径都必须得到同一顺序：
  // 血条贴格子下沿，资源条在它正上方。
  const state = stateWith({
    box: { _id: "box", type: "container", x: 5, y: 5, hits: 100_000, hitsMax: 250_000, store: { energy: 1000 }, storeCapacity: 2000 },
    hauler: { _id: "hauler", type: "creep", x: 7, y: 5, user: "me1", hits: 300, hitsMax: 500, body: [{ type: "carry", hits: 100 }, { type: "move", hits: 100 }], store: { energy: 25 }, storeCapacity: 50 },
  });
  const scene = buildRoomScene({ state }, { theme, me: "me1", zoom: BAR_MIN_ZOOM + 10 });
  const barY = (id: string, name: string) => {
    const p = part(scene, id, name);
    if (p?.kind !== "bar") throw new Error(`${id}/${name} 不是进度条：${JSON.stringify(p)}`);
    return p.y;
  };

  for (const id of ["box", "hauler"]) {
    it(`${id}：血条在资源条下方`, () => {
      expect(barY(id, "hits")).toBeGreaterThan(barY(id, "store"));
    });
  }

  it("建筑与 creep 的两条进度条相对格子的位置完全一致", () => {
    const offset = (id: string, x: number) => ({ hits: barY(id, "hits") - 5, store: barY(id, "store") - 5, x });
    const box = offset("box", 5);
    const hauler = offset("hauler", 7);
    expect(hauler.hits).toBeCloseTo(box.hits);
    expect(hauler.store).toBeCloseTo(box.store);
  });

  it("显示选项关掉血条后，资源条落到血条原来的位置", () => {
    const noHits = buildRoomScene({ state }, { theme, me: "me1", zoom: BAR_MIN_ZOOM + 10, display: { say: true, visual: true, bars: false, names: true } });
    for (const id of ["box", "hauler"]) {
      expect(part(noHits, id, "hits")).toBeUndefined();
      const store = part(noHits, id, "store");
      expect(store?.kind === "bar" ? store.y : undefined).toBeCloseTo(barY(id, "hits"));
    }
  });
});
