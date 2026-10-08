import { describe, expect, it } from "vitest";
import { decodePixelImage } from "../scene/pixel-image.ts";
import type { ImagePrimitive, Primitive, RectPrimitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { buildMinimapScene, minimapRoomAt, type MinimapInput } from "./minimap-scene.ts";

/** 赛季服的世界：102×102 个房间，W50N50 在左上角 */
const SIZE = { width: 102, height: 102 };

function input(patch: Partial<MinimapInput> = {}): MinimapInput {
  return {
    center: "W13S28",
    size: SIZE,
    tileUrl: (room) => `/tiles/${room}.png`,
    rooms: {},
    positions: {},
    ownerColor: (user) => (user === "me" ? 0x0000ff : 0xff0000),
    theme: DEFAULT_THEME,
    ...patch,
  };
}

const of = <K extends Primitive["kind"]>(prims: readonly Primitive[], kind: K) =>
  prims.filter((p): p is Extract<Primitive, { kind: K }> => p.kind === kind);

const tiles = (prims: readonly Primitive[]) =>
  of(prims, "image").filter((p) => p.key.startsWith("tile:")).map((p: ImagePrimitive) => ({ x: p.x, y: p.y, url: p.url }));

/** 像素图里 (x, y) 处的 [r, g, b, a] */
function pixel(image: ImagePrimitive, x: number, y: number): number[] {
  const decoded = decodePixelImage(image.url)!;
  const i = (y * decoded.width + x) * 4;
  return [...decoded.rgba.slice(i, i + 4)];
}

describe("Minimap 的 Scene", () => {
  it("3×3 格、每格一张单房间瓦片，当前房间在中心", () => {
    const scene = buildMinimapScene(input());
    expect(scene.width).toBe(3);
    expect(scene.height).toBe(3);
    expect(tiles(scene.primitives)).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0, url: "/tiles/W14S27.png" },
        { x: 1, y: 0, url: "/tiles/W13S27.png" },
        { x: 2, y: 0, url: "/tiles/W12S27.png" },
        { x: 0, y: 1, url: "/tiles/W14S28.png" },
        { x: 1, y: 1, url: "/tiles/W13S28.png" },
        { x: 2, y: 1, url: "/tiles/W12S28.png" },
        { x: 0, y: 2, url: "/tiles/W14S29.png" },
        { x: 1, y: 2, url: "/tiles/W13S29.png" },
        { x: 2, y: 2, url: "/tiles/W12S29.png" },
      ]),
    );
    expect(of(scene.primitives, "image").every((p) => p.width === 1 && p.height === 1)).toBe(true);
    expect(tiles(scene.primitives)).toHaveLength(9);
  });

  it("跨越 0 线：E0S0 的西北是 W0N0", () => {
    const urls = tiles(buildMinimapScene(input({ center: "E0S0" })).primitives);
    expect(urls).toContainEqual({ x: 0, y: 0, url: "/tiles/W0N0.png" });
    expect(urls).toContainEqual({ x: 2, y: 2, url: "/tiles/E1S1.png" });
  });

  it("世界边缘外的格子为空：左上角的房间只有 4 格", () => {
    const scene = buildMinimapScene(input({ center: "W50N50", rooms: {}, positions: {} }));
    expect(tiles(scene.primitives)).toEqual(
      expect.arrayContaining([
        { x: 1, y: 1, url: "/tiles/W50N50.png" },
        { x: 2, y: 1, url: "/tiles/W49N50.png" },
        { x: 1, y: 2, url: "/tiles/W50N49.png" },
        { x: 2, y: 2, url: "/tiles/W49N49.png" },
      ]),
    );
    expect(tiles(scene.primitives)).toHaveLength(4);
    // 空格上什么都不画
    expect(scene.primitives.every((p) => !("x" in p) || (p.x >= 1 && p.y >= 1))).toBe(true);
  });

  it("按所有者着色：占有的房间整格着色，预定的更淡", () => {
    const scene = buildMinimapScene(
      input({
        rooms: {
          W12S28: { status: "normal", owner: { user: "me", level: 8 } },
          W13S27: { status: "normal", owner: { user: "foe", level: 0 } },
          W14S29: { status: "normal" },
        },
      }),
    );
    const rects = of(scene.primitives, "rect").filter((r) => r.fill !== undefined);
    const at = (x: number, y: number) => rects.find((r: RectPrimitive) => r.x === x && r.y === y);
    expect(at(2, 1)).toMatchObject({ width: 1, height: 1, fill: 0x0000ff });
    expect(at(1, 0)).toMatchObject({ width: 1, height: 1, fill: 0xff0000 });
    expect(at(1, 0)!.alpha!).toBeLessThan(at(2, 1)!.alpha!);
    expect(at(0, 2)).toBeUndefined();
  });

  it("roomMap2 与 World Map 同一画法：每房间一张 50×50 像素图（一格一像素），加色混合叠在瓦片与所有权之上", () => {
    const ME = "5a0000000000000000000001";
    const FOE = "5a0000000000000000000002";
    const scene = buildMinimapScene(
      input({
        ownerColor: (user) => (user === ME ? 0x0000ff : 0xff0000),
        positions: {
          W12S28: { [ME]: [[10, 20]], s: [[5, 5]] },
          W14S27: { [FOE]: [[0, 49]] },
        },
      }),
    );
    expect(of(scene.primitives, "circle")).toEqual([]);
    const units = of(scene.primitives, "image").filter((p) => p.key.startsWith("units:"));
    expect(units).toHaveLength(2);
    const east = units.find((p) => p.key === "units:W12S28")!;
    const northWest = units.find((p) => p.key === "units:W14S27")!;
    expect(east).toMatchObject({ x: 2, y: 1, width: 1, height: 1, blend: "add" });
    expect(northWest).toMatchObject({ x: 0, y: 0, width: 1, height: 1, blend: "add" });
    expect(pixel(east, 10, 20)).toEqual([0, 0, 255, 255]);
    // 固定类别用官方颜色（Source 黄）
    expect(pixel(east, 5, 5)).toEqual([0xff, 0xf2, 0x46, 255]);
    expect(pixel(east, 11, 20)[3]).toBe(0);
    expect(pixel(northWest, 0, 49)).toEqual([255, 0, 0, 255]);
    const tileLayer = of(scene.primitives, "image").find((p) => p.key.startsWith("tile:"))!.layer;
    const ownLayer = 10;
    expect(units.every((p) => p.layer > tileLayer && p.layer > ownLayer)).toBe(true);
  });

  it("世界坐标换算到格子里的房间；边缘外与画面外为 undefined", () => {
    expect(minimapRoomAt("W13S28", SIZE, 2.5, 1.5)).toBe("W12S28");
    expect(minimapRoomAt("W13S28", SIZE, 1.2, 0.1)).toBe("W13S27");
    expect(minimapRoomAt("W13S28", SIZE, 1.5, 1.5)).toBe("W13S28");
    expect(minimapRoomAt("W13S28", SIZE, 3.1, 1.5)).toBeUndefined();
    expect(minimapRoomAt("W13S28", SIZE, -0.1, 1.5)).toBeUndefined();
    expect(minimapRoomAt("W50N50", SIZE, 0.5, 1.5)).toBeUndefined();
  });
});
