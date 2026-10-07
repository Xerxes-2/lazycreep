import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scene } from "./scene.ts";
import { attachGestures, type GestureHandlers } from "./pointer-gestures.ts";
import { clampCamera, fromViewport, nextPick, pickObjects, screenToWorld, toViewport, zoomAround } from "./scene-camera.ts";

describe("相机与视口换算", () => {
  it("相机居中：世界中心落在画布中心，span 格铺满短边", () => {
    const vp = toViewport({ cx: 25, cy: 25, span: 50 }, 500, 500);
    expect(vp).toEqual({ x: 0, y: 0, scale: 10 });
    expect(screenToWorld(vp, 250, 250)).toEqual({ x: 25, y: 25 });
    const zoomed = toViewport({ cx: 10, cy: 20, span: 10 }, 400, 200);
    expect(zoomed.scale).toBe(20);
    expect(screenToWorld(zoomed, 200, 100)).toEqual({ x: 10, y: 20 });
  });

  it("视口与相机可以互相换算（画布尺寸变化后相机不变）", () => {
    const camera = { cx: 12, cy: 34, span: 8 };
    expect(fromViewport(toViewport(camera, 600, 600), 600, 600)).toEqual(camera);
    const vp = toViewport(camera, 300, 300);
    expect(screenToWorld(vp, 150, 150)).toEqual({ x: 12, y: 34 });
  });

  it("以指针为中心缩放：指针下的世界点不动", () => {
    const vp = { x: 10, y: -20, scale: 8 };
    const before = screenToWorld(vp, 123, 77);
    const after = zoomAround(vp, 123, 77, 2.5);
    expect(after.scale).toBe(20);
    const point = screenToWorld(after, 123, 77);
    expect(point.x).toBeCloseTo(before.x);
    expect(point.y).toBeCloseTo(before.y);
  });

  it("相机被限制在场景附近，缩放有上下限", () => {
    const scene = { width: 50, height: 50 };
    expect(clampCamera({ cx: -100, cy: 900, span: 50 }, scene)).toMatchObject({ cx: 0, cy: 50 });
    expect(clampCamera({ cx: 25, cy: 25, span: 0.1 }, scene).span).toBeGreaterThan(1);
    expect(clampCamera({ cx: 25, cy: 25, span: 10000 }, scene).span).toBeLessThan(100);
    expect(clampCamera({ cx: 20, cy: 30, span: 10 }, scene)).toEqual({ cx: 20, cy: 30, span: 10 });
  });
});

describe("点选", () => {
  const scene: Scene = {
    width: 50,
    height: 50,
    background: 0,
    primitives: [
      { key: "t", kind: "rect", layer: 0, x: 0, y: 0, width: 50, height: 1, fill: 1 },
      { key: "r/body", objectId: "r", kind: "circle", layer: 10, x: 3.5, y: 0.5, radius: 0.2, fill: 1 },
      { key: "c/body", objectId: "c", kind: "circle", layer: 30, x: 3.5, y: 0.5, radius: 0.38, fill: 1 },
      { key: "c/hits", objectId: "c", kind: "bar", layer: 50, x: 3.1, y: 0.82, width: 0.8, height: 0.12, value: 1, fill: 1, background: 0 },
      { key: "w/body", objectId: "w", kind: "rect", layer: 40, x: 3, y: 0, width: 1, height: 1, fill: 1 },
      { key: "s/body", objectId: "s", kind: "rect", layer: 20, x: 9, y: 9, width: 1, height: 1, fill: 1 },
    ],
  };

  it("按对象去重，自上而下排列；没有对象的点返回空", () => {
    expect(pickObjects(scene, 3.5, 0.5)).toEqual(["w", "c", "r"]);
    expect(pickObjects(scene, 9.5, 9.5)).toEqual(["s"]);
    expect(pickObjects(scene, 20.5, 0.5)).toEqual([]);
  });

  it("重复点同一处在重叠的对象间轮换", () => {
    const ids = pickObjects(scene, 3.5, 0.5);
    expect(nextPick(ids, undefined)).toBe("w");
    expect(nextPick(ids, "w")).toBe("c");
    expect(nextPick(ids, "c")).toBe("r");
    expect(nextPick(ids, "r")).toBe("w");
    expect(nextPick(ids, "s")).toBe("w");
    expect(nextPick([], "w")).toBeUndefined();
  });
});

describe("DOM 手势", () => {
  let el: HTMLDivElement;
  let calls: string[];
  let detach: () => void;

  const handlers: GestureHandlers = {
    pan: (dx, dy) => void calls.push(`pan ${dx},${dy}`),
    zoom: (x, y, factor) => void calls.push(`zoom ${x},${y},${factor.toFixed(2)}`),
    tap: (x, y) => void calls.push(`tap ${x},${y}`),
    end: () => void calls.push("end"),
  };

  function pointer(type: string, id: number, x: number, y: number, pointerType = "mouse") {
    el.dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType, bubbles: true, button: 0, isPrimary: id === 1 }),
    );
  }

  beforeEach(() => {
    el = document.createElement("div");
    document.body.append(el);
    calls = [];
    detach = attachGestures(el, handlers);
  });
  afterEach(() => {
    detach();
    el.remove();
  });

  it.each(["mouse", "touch"])("%s：按下抬起不动是点选", (kind) => {
    pointer("pointerdown", 1, 10, 20, kind);
    pointer("pointermove", 1, 11, 21, kind);
    pointer("pointerup", 1, 11, 21, kind);
    expect(calls).toEqual(["tap 11,21"]);
  });

  it.each(["mouse", "touch"])("%s：拖拽是平移，不触发点选", (kind) => {
    pointer("pointerdown", 1, 10, 10, kind);
    pointer("pointermove", 1, 30, 10, kind);
    pointer("pointermove", 1, 40, 25, kind);
    pointer("pointerup", 1, 40, 25, kind);
    expect(calls).toEqual(["pan 20,0", "pan 10,15", "end"]);
  });

  it("双指捏合：以两指中点缩放，结束后不触发点选", () => {
    pointer("pointerdown", 1, 100, 100, "touch");
    pointer("pointerdown", 2, 200, 100, "touch");
    pointer("pointermove", 2, 300, 100, "touch");
    pointer("pointerup", 2, 300, 100, "touch");
    pointer("pointerup", 1, 100, 100, "touch");
    expect(calls).toContain("zoom 200,100,2.00");
    expect(calls).toContain("pan 50,0");
    expect(calls.some((c) => c.startsWith("tap"))).toBe(false);
    expect(calls.at(-1)).toBe("end");
  });

  it("滚轮缩放：向上放大、向下缩小，阻止页面滚动", () => {
    const up = new WheelEvent("wheel", { deltaY: -100, clientX: 5, clientY: 6, cancelable: true });
    el.dispatchEvent(up);
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: 5, clientY: 6, cancelable: true }));
    expect(up.defaultPrevented).toBe(true);
    const factors = calls.filter((c) => c.startsWith("zoom")).map((c) => Number(c.split(",")[2]));
    expect(factors[0]).toBeGreaterThan(1);
    expect(factors[1]).toBeLessThan(1);
    expect(calls).toContain("end");
  });

  it("解绑后不再响应", () => {
    detach();
    pointer("pointerdown", 1, 10, 20);
    pointer("pointerup", 1, 10, 20);
    expect(calls).toEqual([]);
    detach = () => {};
  });
});
