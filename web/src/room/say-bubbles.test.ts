/**
 * #22：creep 的 say 以气泡画在 creep 头顶（经 buildRoomScene 观察）。
 */
import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { LABEL_MIN_ZOOM } from "./room-detail-rules.ts";
import { LAYER } from "./room-paint.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom, type RoomState } from "./room-state.ts";
import { estimateTextWidth } from "./say-bubbles.ts";

const users = { u1: { _id: "u1", username: "Someone" } };

function stateWith(objects: Record<string, Record<string, unknown>>): RoomState {
  return roomStateFrom({ objects, users, visual: '{"t":"t","x":1,"y":1,"text":"v"}' });
}

const saying = (message: unknown, isPublic = false, extra: Record<string, unknown> = {}) =>
  stateWith({ c: { _id: "c", type: "creep", x: 10, y: 20, user: "u1", actionLog: { say: { message, isPublic } }, ...extra } });

const view: RoomSceneView = { theme: DEFAULT_THEME, zoom: 40 };

const part = (scene: Scene, name: string): Primitive | undefined => scene.primitives.find((p) => p.key === `c/${name}`);

function bubble(scene: Scene) {
  const shape = part(scene, "say");
  const text = part(scene, "say-text");
  return {
    shape: shape?.kind === "polygon" ? shape : undefined,
    text: text?.kind === "text" ? text : undefined,
  };
}

function bounds(points: readonly number[]) {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

describe("say 气泡", () => {
  it("私有 say：灰底黑边气泡与文字画在 creep 上方，尖角指向 creep", () => {
    const { shape, text } = bubble(buildRoomScene({ state: saying("⛏") }, view));
    expect(shape?.fill).toBe(0xcccccc);
    expect(shape?.stroke).toEqual({ color: 0x000000, width: 0.08 });
    expect(text).toMatchObject({ text: "⛏", color: 0x111111, size: 0.6, x: 10.5 });
    // creep 中心 (10.5, 20.5)：气泡上沿高 1.7 格、下沿 0.7 格，尖角伸到 0.44 格
    const b = bounds(shape!.points);
    expect(b.top).toBeCloseTo(18.8);
    expect(b.bottom).toBeCloseTo(20.06);
    expect(text!.y).toBeCloseTo(19.3);
    expect((b.left + b.right) / 2).toBeCloseTo(10.5);
  });

  it("公开 say 是粉底", () => {
    const { shape } = bubble(buildRoomScene({ state: saying("hi", true) }, view));
    expect(shape?.fill).toBe(0xdd8888);
  });

  it("气泡宽 = 估算的文字宽 + 0.6 格", () => {
    const { shape } = bubble(buildRoomScene({ state: saying("hello") }, view));
    const b = bounds(shape!.points);
    expect(b.right - b.left).toBeCloseTo(estimateTextWidth("hello", 0.6) + 0.6);
  });

  it("层级在对象与玩家名之上、RoomVisual 之下；文字盖在气泡上", () => {
    const scene = buildRoomScene({ state: saying("x") }, view);
    const { shape, text } = bubble(scene);
    expect(shape!.layer).toBeGreaterThan(LAYER.label + 1);
    expect(shape!.layer).toBeLessThan(LAYER.visual);
    const order = scene.primitives.map((p) => p.key);
    expect(order.indexOf("c/say-text")).toBeGreaterThan(order.indexOf("c/say"));
  });

  it("没有 say、message 不是字符串或为空时不画", () => {
    for (const state of [stateWith({ c: { type: "creep", x: 1, y: 1 } }), saying(undefined), saying("")]) {
      expect(bubble(buildRoomScene({ state }, view)).shape).toBeUndefined();
    }
  });

  it("power creep 也画；其他对象不画", () => {
    const state = stateWith({
      p: { type: "powerCreep", x: 1, y: 1, actionLog: { say: { message: "a", isPublic: true } } },
      s: { type: "spawn", x: 2, y: 2, actionLog: { say: { message: "a", isPublic: true } } },
    });
    const keys = buildRoomScene({ state }, view).primitives.map((p) => p.key);
    expect(keys).toContain("p/say");
    expect(keys).not.toContain("s/say");
  });

  it("显示选项关闭 say 时不画", () => {
    const scene = buildRoomScene({ state: saying("x") }, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, say: false } });
    expect(bubble(scene).shape).toBeUndefined();
  });

  it("缩放低于进度条阈值时隐藏，选中的 creep 除外", () => {
    const far = { ...view, zoom: LABEL_MIN_ZOOM - 1 };
    expect(bubble(buildRoomScene({ state: saying("x") }, far)).shape).toBeUndefined();
    expect(bubble(buildRoomScene({ state: saying("x") }, { ...far, selectedId: "c" })).shape).toBeDefined();
    expect(bubble(buildRoomScene({ state: saying("x") }, { ...view, zoom: LABEL_MIN_ZOOM })).shape).toBeDefined();
  });

  it("公开的 say 用红色气泡", () => {
    const { shape, text } = bubble(buildRoomScene({ state: saying("x", true) }, view));
    expect(shape?.fill).toBe(0xdd8888);
    expect(text?.text).toBe("x");
  });
});

describe("文字宽度估算", () => {
  it("拉丁字符 0.6 em，东亚宽字符与 emoji 1 em", () => {
    expect(estimateTextWidth("abc", 1)).toBeCloseTo(1.8);
    expect(estimateTextWidth("你好", 1)).toBeCloseTo(2);
    expect(estimateTextWidth("あＡ", 1)).toBeCloseTo(2);
    expect(estimateTextWidth("⛏🚬", 1)).toBeCloseTo(2);
  });

  it("组合 emoji、变体选择符与组合附加符号按一个字形算", () => {
    expect(estimateTextWidth("👍🏽", 1)).toBeCloseTo(1);
    expect(estimateTextWidth("👨‍👩‍👧", 1)).toBeCloseTo(1);
    expect(estimateTextWidth("❤️", 1)).toBeCloseTo(1);
    expect(estimateTextWidth("é", 1)).toBeCloseTo(0.6);
  });

  it("按字号缩放", () => {
    expect(estimateTextWidth("ab", 0.5)).toBeCloseTo(0.6);
  });
});
