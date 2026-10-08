import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Primitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { LAYER, buildRoomScene } from "./room-scene.ts";
import { reduceLiveTick, roomStateFrom, type RoomState } from "./room-state.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 把若干条 RoomVisual 指令（官方序列化：每行一个 JSON）画成 Scene，只取 visual 层的图元。 */
function visuals(...commands: unknown[]): Primitive[] {
  const visual = commands.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n") + "\n";
  const state = { ...roomStateFrom({ objects: {} }), visual };
  return buildRoomScene({ state }, { artStyle: "geometric", theme: DEFAULT_THEME }).primitives.filter((p) => p.layer === LAYER.visual);
}

describe("RoomVisual → Scene", () => {
  it("没有 visual 时不产生图元", () => {
    expect(visuals()).toEqual([]);
  });

  it("circle：坐标从格子中心换成格子左上角为原点，默认样式按官方文档", () => {
    const [p, ...rest] = visuals({ t: "c", x: 10, y: 20 });
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ kind: "circle", x: 10.5, y: 20.5, radius: 0.15, fill: 0xffffff, alpha: 0.5 });
    expect(p).not.toHaveProperty("stroke");
    expect(p).not.toHaveProperty("objectId");
  });

  it("circle：radius、fill、opacity、stroke、strokeWidth", () => {
    const [p] = visuals({ t: "c", x: 1, y: 2, s: { radius: 0.55, fill: "#f00", opacity: 0.8, stroke: "#00ff00", strokeWidth: 0.2 } });
    expect(p).toMatchObject({ kind: "circle", radius: 0.55, fill: 0xff0000, alpha: 0.8, stroke: { color: 0x00ff00, width: 0.2 } });
  });

  it("fill: 'transparent' 表示不填充", () => {
    const [p] = visuals({ t: "c", x: 1, y: 2, s: { fill: "transparent", stroke: "red" } });
    expect(p).not.toHaveProperty("fill");
    expect(p).toMatchObject({ stroke: { color: 0xff0000, width: 0.1 } });
  });

  it("line：默认白色、宽 0.1、透明度 0.5", () => {
    const [p] = visuals({ t: "l", x1: 0, y1: 0, x2: 10, y2: 20 });
    expect(p).toMatchObject({ kind: "line", points: [0.5, 0.5, 10.5, 20.5], stroke: { color: 0xffffff, width: 0.1 }, alpha: 0.5 });
  });

  it("line：color、width、opacity", () => {
    const [p] = visuals({ t: "l", x1: 1, y1: 1, x2: 2, y2: 1, s: { color: "#123456", width: 0.3, opacity: 1 } });
    expect(p).toMatchObject({ kind: "line", stroke: { color: 0x123456, width: 0.3 }, alpha: 1 });
  });

  it("rect：(x, y) 是左上角；默认白色填充、无描边", () => {
    const [p] = visuals({ t: "r", x: 1.5, y: 1.5, w: 9, h: 9 });
    expect(p).toMatchObject({ kind: "rect", x: 2, y: 2, width: 9, height: 9, fill: 0xffffff, alpha: 0.5 });
    expect(p).not.toHaveProperty("stroke");
  });

  it("rect：fill、stroke、strokeWidth", () => {
    const [p] = visuals({ t: "r", x: 0, y: 0, w: 1, h: 2, s: { fill: "transparent", stroke: "#f00", strokeWidth: 0.05 } });
    expect(p).not.toHaveProperty("fill");
    expect(p).toMatchObject({ kind: "rect", stroke: { color: 0xff0000, width: 0.05 } });
  });

  it("poly：默认只描边（白色）为折线，不闭合", () => {
    const [p, ...rest] = visuals({ t: "p", points: [[1, 1], [2, 3], [4, 1]] });
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ kind: "line", points: [1.5, 1.5, 2.5, 3.5, 4.5, 1.5], stroke: { color: 0xffffff, width: 0.1 }, alpha: 0.5 });
  });

  it("poly：有 fill 时多一个填充多边形，在描边之下", () => {
    const prims = visuals({ t: "p", points: [[1, 1], [2, 3], [4, 1]], s: { fill: "aqua", stroke: "#fff", strokeWidth: 0.15, opacity: 0.2 } });
    expect(prims.map((p) => p.kind)).toEqual(["polygon", "line"]);
    expect(prims[0]).toMatchObject({ kind: "polygon", points: [1.5, 1.5, 2.5, 3.5, 4.5, 1.5], fill: 0x00ffff, alpha: 0.2 });
    expect(prims[0]).not.toHaveProperty("stroke");
    expect(prims[1]).toMatchObject({ kind: "line", stroke: { color: 0xffffff, width: 0.15 }, alpha: 0.2 });
  });

  it("text：默认居中、白色、不透明；y 是基线，锚点上移到文字中部", () => {
    const [p] = visuals({ t: "t", text: "hi", x: 10, y: 15 });
    expect(p).toMatchObject({ kind: "text", text: "hi", x: 10.5, color: 0xffffff, align: "center", alpha: 1 });
    expect(p).not.toHaveProperty("stroke");
    if (p?.kind !== "text") throw new Error("not text");
    expect(p.y).toBeLessThan(15.5);
    expect(p.y).toBeGreaterThan(15.5 - p.size);
  });

  it("text：录到的样本（左对齐、字号 0.6、黑色描边 0.12）", () => {
    const [p] = visuals({
      t: "t",
      text: "bucket 9997",
      x: 1,
      y: 1,
      s: { align: "left", font: 0.6, color: "#ffffff", stroke: "#000000", strokeWidth: 0.12 },
    });
    expect(p).toMatchObject({ kind: "text", text: "bucket 9997", x: 1.5, size: 0.6, align: "left", stroke: { color: 0, width: 0.12 } });
  });

  it("text：stroke 默认宽 0.15；opacity；align right", () => {
    const [p] = visuals({ t: "t", text: "x", x: 0, y: 0, s: { stroke: "#000", opacity: 0.4, align: "right" } });
    expect(p).toMatchObject({ align: "right", alpha: 0.4, stroke: { color: 0, width: 0.15 } });
  });

  it.each([
    ["0.7", 0.7],
    ["0.8 serif", 0.8],
    ["bold italic 1.5 Times New Roman", 1.5],
    ["20px", 0.2],
    ["bold 30px Arial", 0.3],
  ])("text：font %j → 字号 %d 格", (font, size) => {
    const [p] = visuals({ t: "t", text: "x", x: 0, y: 0, s: { font } });
    expect(p).toMatchObject({ kind: "text", size });
  });

  it("text：backgroundColor 画背景矩形（在文字之下），文字改为垂直居中于 y", () => {
    const prims = visuals({ t: "t", text: "abc", x: 10, y: 10, s: { font: 1, backgroundColor: "#333333", backgroundPadding: 0.2 } });
    expect(prims.map((p) => p.kind)).toEqual(["rect", "text"]);
    const [bg, text] = prims;
    expect(text).toMatchObject({ y: 10.5 });
    if (bg?.kind !== "rect") throw new Error("not rect");
    expect(bg.fill).toBe(0x333333);
    expect(bg.y).toBeCloseTo(10.5 - 0.5 - 0.2);
    expect(bg.height).toBeCloseTo(1 + 0.4);
    // 居中：背景以 x 为中线
    expect(bg.x + bg.width / 2).toBeCloseTo(10.5);
  });

  it.each([
    ["dashed", "line"],
    ["dotted", "line"],
  ])("lineStyle %s：线拆成多段，每段都在原线上", (lineStyle) => {
    const prims = visuals({ t: "l", x1: 0, y1: 0, x2: 10, y2: 0, s: { lineStyle, width: 0.1 } });
    expect(prims.length).toBeGreaterThan(3);
    for (const p of prims) {
      expect(p.kind).toBe("line");
      if (p.kind !== "line") continue;
      expect(p.points.filter((_, i) => i % 2 === 1).every((y) => y === 0.5)).toBe(true);
      expect(p.points.every((v, i) => i % 2 === 1 || (v >= 0.5 && v <= 10.5))).toBe(true);
    }
    // 有空隙：总长小于原线
    const total = prims.reduce((sum, p) => sum + (p.kind === "line" ? Math.abs(p.points[2]! - p.points[0]!) : 0), 0);
    expect(total).toBeLessThan(10);
    expect(total).toBeGreaterThan(2);
  });

  it("dotted 比 dashed 段更多", () => {
    const dashed = visuals({ t: "l", x1: 0, y1: 0, x2: 10, y2: 0, s: { lineStyle: "dashed" } });
    const dotted = visuals({ t: "l", x1: 0, y1: 0, x2: 10, y2: 0, s: { lineStyle: "dotted" } });
    expect(dotted.length).toBeGreaterThan(dashed.length);
  });

  it("虚线描边的矩形：填充保留，描边改为沿边的虚线段", () => {
    const prims = visuals({ t: "r", x: 0, y: 0, w: 4, h: 2, s: { stroke: "#f00", lineStyle: "dashed" } });
    const [body, ...dashes] = prims;
    expect(body).toMatchObject({ kind: "rect", fill: 0xffffff });
    expect(body).not.toHaveProperty("stroke");
    expect(dashes.length).toBeGreaterThan(4);
    expect(dashes.every((p) => p.kind === "line" && p.stroke.color === 0xff0000)).toBe(true);
  });

  it("虚线描边的圆与折线也拆段", () => {
    const circle = visuals({ t: "c", x: 5, y: 5, s: { radius: 2, fill: "transparent", stroke: "#fff", lineStyle: "dashed" } });
    expect(circle.length).toBeGreaterThan(4);
    expect(circle.every((p) => p.kind === "line")).toBe(true);
    const poly = visuals({ t: "p", points: [[0, 0], [5, 0], [5, 5]], s: { lineStyle: "dotted" } });
    expect(poly.length).toBeGreaterThan(4);
    expect(poly.every((p) => p.kind === "line")).toBe(true);
  });

  it("颜色：#rgb、#rrggbb、rgb()、常见颜色名", () => {
    const fills = ["#abc", "#a1b2c3", "rgb(255, 0, 128)", "orange", "Blue"].map(
      (fill) => visuals({ t: "c", x: 0, y: 0, s: { fill } })[0],
    );
    expect(fills.map((p) => (p?.kind === "circle" ? p.fill : undefined))).toEqual([0xaabbcc, 0xa1b2c3, 0xff0080, 0xffa500, 0x0000ff]);
  });

  it("未知样式与无法识别的值被忽略：退回默认值，不报错", () => {
    const [p] = visuals({ t: "c", x: 1, y: 1, s: { fill: "not-a-color", radius: "big", opacity: null, glow: true, lineStyle: "wavy" } });
    expect(p).toMatchObject({ kind: "circle", fill: 0xffffff, radius: 0.15, alpha: 0.5 });
    expect(p).not.toHaveProperty("stroke");
  });

  it("坏行、未知指令、缺坐标的指令被跳过，其余照画", () => {
    const prims = visuals(
      "not json",
      { t: "z", x: 1, y: 1 },
      { t: "c", y: 1 },
      { t: "p", points: "nope" },
      { t: "t", x: 1, y: 1 },
      null,
      { t: "c", x: 3, y: 3 },
    );
    expect(prims).toHaveLength(1);
    expect(prims[0]).toMatchObject({ kind: "circle", x: 3.5, y: 3.5 });
  });

  it("visual 在一切之上，key 唯一且不挂对象 id，保持指令顺序", () => {
    const state = {
      ...roomStateFrom({ objects: { s: { _id: "s", type: "spawn", x: 1, y: 1, user: "u" } } }),
      visual: [
        { t: "c", x: 1, y: 1 },
        { t: "r", x: 0, y: 0, w: 1, h: 1, s: { stroke: "#fff", lineStyle: "dashed" } },
        { t: "t", text: "a", x: 1, y: 1, s: { backgroundColor: "#000" } },
      ]
        .map((c) => JSON.stringify(c))
        .join("\n"),
    };
    const scene = buildRoomScene({ state }, { artStyle: "geometric", theme: DEFAULT_THEME });
    const last = scene.primitives.at(-1);
    expect(last).toMatchObject({ kind: "text", layer: LAYER.visual });
    const vis = scene.primitives.filter((p) => p.layer === LAYER.visual);
    expect(vis[0]).toMatchObject({ kind: "circle" });
    expect(vis.every((p) => p.objectId === undefined)).toBe(true);
    const keys = scene.primitives.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...scene.primitives.filter((p) => p.objectId).map((p) => p.layer))).toBeLessThan(LAYER.visual);
  });
});

describe("RoomVisual：录制的房间", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("W13S28 的脚本文字（bucket / cpu）在 Scene 的 visual 层可见，落在房间内", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    const seen: string[] = [];
    let state: RoomState | undefined;
    source.subscribeRoom("shardSeason", "W13S28", (tick) => {
      state = reduceLiveTick(state, tick);
      const scene = buildRoomScene({ state }, { artStyle: "geometric", theme: DEFAULT_THEME });
      for (const p of scene.primitives) {
        if (p.layer !== LAYER.visual || p.kind !== "text") continue;
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(scene.width);
        expect(p.y).toBeLessThan(scene.height);
        seen.push(p.text);
      }
    });
    await vi.runAllTimersAsync();
    expect(seen.some((t) => t.startsWith("bucket "))).toBe(true);
    expect(seen.some((t) => t.startsWith("cpu "))).toBe(true);
  });
});
