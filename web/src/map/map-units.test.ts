import { describe, expect, it } from "vitest";
import type { ImagePrimitive } from "../scene/scene.ts";
import { decodePixelImage, encodePixelImage } from "../scene/pixel-image.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { RoomMapUpdate } from "../source/source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import { buildMapScene, MAP_LAYER, MAP_LAYERS, type MapLayerPainter } from "./map-scene.ts";
import { applyMapStats, mapStateFrom, type MapState } from "./map-state.ts";
import { applyRoomUnits, createUnitsPainter, retainUnits } from "./map-units.ts";

const ME = "5a0000000000000000000001";
const ALLY = "5a0000000000000000000002";
const STRANGER = "5a0000000000000000000003";

/** 102×102 的世界：W13S28 在世界坐标 (37, 79)，W12S28 在 (38, 79) */
function world(): MapState {
  const base = mapStateFrom({
    shard: "s",
    size: { width: 102, height: 102 },
    tiles: { room: (r) => `/tile/${r}`, block: (r) => `/block/${r}`, sector: (r) => `/sector/${r}` },
    me: ME,
  });
  return {
    ...applyMapStats(base, {
      shard: "s",
      gameTime: 1,
      rooms: {},
      users: {
        [ME]: { _id: ME, username: "Me" },
        [ALLY]: { _id: ALLY, username: "Friend" },
        [STRANGER]: { _id: STRANGER, username: "Other" },
      },
    }),
    allies: new Set(["friend"]),
  };
}

const zoomed = { theme: DEFAULT_THEME, zoom: ICON_MIN_ZOOM, visible: { x0: 36, y0: 78, x1: 40, y1: 81 } };

function unitImages(state: MapState, layers: readonly MapLayerPainter[] = MAP_LAYERS, zoom = ICON_MIN_ZOOM) {
  return buildMapScene(state, { ...zoomed, zoom }, layers).primitives.filter(
    (p): p is ImagePrimitive => p.kind === "image" && p.key.startsWith("units:"),
  );
}

/** 像素图里 (x, y) 处的 [r, g, b, a] */
function pixel(image: ImagePrimitive, x: number, y: number): number[] {
  const decoded = decodePixelImage(image.url)!;
  const i = (y * decoded.width + x) * 4;
  return [...decoded.rgba.slice(i, i + 4)];
}

const rgb = (color: number) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 255];

describe("World Map 单位图层", () => {
  it("每个房间一张 50×50 的像素图盖满房间格，以加色混合叠在地形瓦片之上", () => {
    const state = applyRoomUnits(world(), "W13S28", { s: [[10, 20]] });
    const [image, ...rest] = unitImages(state);
    expect(rest).toEqual([]);
    expect(image).toMatchObject({ x: 37, y: 79, width: 1, height: 1, blend: "add" });
    expect(image!.layer).toBeGreaterThan(MAP_LAYER.tile);
    const decoded = decodePixelImage(image!.url)!;
    expect([decoded.width, decoded.height]).toEqual([50, 50]);
  });

  it("一格一像素：点的房间内坐标就是像素坐标，其余像素透明", () => {
    const state = applyRoomUnits(world(), "W13S28", { s: [[10, 20]], c: [[0, 49]], m: [[49, 0]] });
    const [image] = unitImages(state);
    expect(pixel(image!, 10, 20)).toEqual([255, 242, 70, 255]);
    expect(pixel(image!, 0, 49)).toEqual([80, 80, 80, 255]);
    expect(pixel(image!, 49, 0)).toEqual([170, 170, 170, 255]);
    expect(pixel(image!, 20, 10)).toEqual([0, 0, 0, 0]);
    expect(pixel(image!, 25, 25)).toEqual([0, 0, 0, 0]);
  });

  it("固定类别用官方颜色", () => {
    const frame: RoomMapUpdate = {
      w: [[1, 1]],
      r: [[2, 1]],
      pb: [[3, 1]],
      m: [[4, 1]],
      p: [[5, 1]],
      k: [[6, 1]],
      c: [[7, 1]],
      s: [[8, 1]],
      "2": [[9, 1]],
      "3": [[10, 1]],
    };
    const [image] = unitImages(applyRoomUnits(world(), "W13S28", frame));
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => pixel(image!, x, 1))).toEqual([
      [0, 0, 0, 255],
      [60, 60, 60, 255],
      [255, 255, 255, 255],
      [170, 170, 170, 255],
      [0, 200, 255, 255],
      [100, 0, 0, 255],
      [80, 80, 80, 255],
      [255, 242, 70, 255],
      [255, 150, 0, 255],
      [255, 150, 0, 255],
    ]);
  });

  it("玩家的物体按我方 / 盟友 / 陌生人着色，与所有权同一条规则", () => {
    const state = applyRoomUnits(world(), "W13S28", { [ME]: [[1, 1]], [ALLY]: [[2, 2]], [STRANGER]: [[3, 3]] });
    const [image] = unitImages(state);
    expect(pixel(image!, 1, 1)).toEqual(rgb(DEFAULT_THEME.owned));
    expect(pixel(image!, 2, 2)).toEqual(rgb(DEFAULT_THEME.ally));
    expect(DEFAULT_THEME.strangers.map(rgb)).toContainEqual(pixel(image!, 3, 3));
  });

  it("未知键用官方的红色", () => {
    const [image] = unitImages(applyRoomUnits(world(), "W13S28", { zz: [[4, 4]] }));
    expect(pixel(image!, 4, 4)).toEqual([235, 85, 71, 255]);
  });

  it("同一格上玩家的点盖过道路等固定类别", () => {
    const [image] = unitImages(applyRoomUnits(world(), "W13S28", { [ME]: [[5, 5]], r: [[5, 5]] }));
    expect(pixel(image!, 5, 5)).toEqual(rgb(DEFAULT_THEME.owned));
  });

  it("门槛以下不画；没收到 roomMap2 的房间与不可见的房间不画", () => {
    let state = applyRoomUnits(world(), "W13S28", { s: [[1, 1]] });
    state = applyRoomUnits(state, "E40S40", { s: [[1, 1]] });
    expect(unitImages(state).map((p) => p.key)).toEqual(["units:W13S28"]);
    expect(unitImages(state, MAP_LAYERS, ICON_MIN_ZOOM - 1)).toEqual([]);
  });

  it("只保留仍订阅着的房间的点", () => {
    let state = applyRoomUnits(world(), "W13S28", { s: [[1, 1]] });
    state = applyRoomUnits(state, "W12S28", { s: [[1, 1]] });
    const kept = retainUnits(state, new Set(["W12S28"]));
    expect(unitImages(kept).map((p) => p.key)).toEqual(["units:W12S28"]);
    expect(retainUnits(kept, new Set(["W12S28", "W1S1"]))).toBe(kept);
  });

  it("同一房间的同一帧在多次构建 Scene 时只生成一次像素图；新的一帧或着色变化才重建", () => {
    const encoded: number[] = [];
    const paint = createUnitsPainter((pixels) => {
      encoded.push(pixels.width);
      return encodePixelImage(pixels);
    });
    const frame: RoomMapUpdate = { [STRANGER]: [[1, 1]] };
    let state = applyRoomUnits(world(), "W13S28", frame);
    unitImages(state, [paint]);
    // 同一动画帧里别的房间更新，Scene 重建
    state = applyRoomUnits(state, "W12S28", { s: [[1, 1]] });
    unitImages(state, [paint]);
    unitImages(state, [paint]);
    expect(encoded).toHaveLength(2);

    state = applyRoomUnits(state, "W13S28", { [STRANGER]: [[2, 2]] });
    unitImages(state, [paint]);
    expect(encoded).toHaveLength(3);

    // 陌生人被加进 Ally List：颜色变了，重建
    const before = unitImages(state, [paint]).find((p) => p.key === "units:W13S28")!;
    state = { ...state, allies: new Set(["friend", "other"]) };
    const after = unitImages(state, [paint]).find((p) => p.key === "units:W13S28")!;
    expect(encoded).toHaveLength(4);
    expect(pixel(after, 2, 2)).toEqual(rgb(DEFAULT_THEME.ally));
    expect(after.url).not.toBe(before.url);
  });
});
