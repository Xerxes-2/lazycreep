/**
 * #12：buildRoomScene 的可读性规则——按玩家着色、选中高亮。
 */
import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
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

/** creep 中心的主人色：缩放低于徽章阈值（默认 1 px/格）时徽章退成主人色圆 */
function creepFill(scene: Scene, id: string) {
  const badge = part(scene, id, "badge");
  return badge?.kind === "circle" ? badge.fill : undefined;
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

  it("建筑的主人色染色用同一套规则", () => {
    const scene = buildRoomScene(
      {
        state: stateWith({
          l: { _id: "l", type: "link", x: 5, y: 5, user: "al1" },
          f: { _id: "f", type: "factory", x: 7, y: 5, user: "st1" },
        }),
      },
      view,
    );
    const border = (id: string) => {
      const p = part(scene, id, "border");
      return p?.kind === "image" ? p.tint : undefined;
    };
    expect(border("l")).toBe(theme.ally);
    expect(border("f")).toBe(creepFill(buildRoomScene({ state: creeps }, view), "c"));
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
