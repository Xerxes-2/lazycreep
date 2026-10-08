/**
 * 从地图瓦片解地形：每格 3×3 像素，按格子中心认颜色；出口认不准，不认识的颜色或尺寸不对时认不出。
 */
import { describe, expect, it } from "vitest";
import { decodeTileTerrain, type TilePixels } from "./tile-terrain.ts";

const COLOR: Record<string, readonly [number, number, number]> = {
  "0": [43, 43, 43],
  "1": [0, 0, 0],
  "2": [35, 37, 19],
  exit: [50, 50, 50],
};

/** 按每格的颜色名画一张 150×150 的瓦片 */
function tile(cell: (x: number, y: number) => readonly [number, number, number], scale = 3): TilePixels {
  const size = 50 * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const [r, g, b] = cell(Math.floor(px / scale), Math.floor(py / scale));
      data.set([r, g, b, 255], (py * size + px) * 4);
    }
  return { width: size, height: size, data };
}

/** 一个地形：第一行墙，第二行沼泽，其余平地 */
const encoded = Array.from({ length: 2500 }, (_, i) => (i < 50 ? "1" : i < 100 ? "2" : "0")).join("");
const cellOf = (x: number, y: number) => encoded[y * 50 + x]!;

describe("从地图瓦片解地形", () => {
  it("墙、沼泽、平地一一对应；没有出口时是准确地形", () => {
    expect(decodeTileTerrain(tile((x, y) => COLOR[cellOf(x, y)]!))).toEqual({ encoded, exact: true });
  });

  it("出口格按平地给出，标为不准确", () => {
    const result = decodeTileTerrain(tile((x, y) => (x === 0 && y === 10 ? COLOR["exit"]! : COLOR[cellOf(x, y)]!)));
    expect(result).toEqual({ encoded, exact: false });
  });

  it("不认识的颜色、透明像素或尺寸不对时认不出", () => {
    expect(decodeTileTerrain(tile((x, y) => (x === 1 && y === 1 ? [200, 0, 0] : COLOR[cellOf(x, y)]!)))).toBeUndefined();
    const transparent = tile((x, y) => COLOR[cellOf(x, y)]!);
    (transparent.data as Uint8ClampedArray)[((4 * 150) + 4) * 4 + 3] = 0;
    expect(decodeTileTerrain(transparent)).toBeUndefined();
    expect(decodeTileTerrain({ width: 100, height: 120, data: new Uint8ClampedArray(100 * 120 * 4) })).toBeUndefined();
    expect(decodeTileTerrain({ width: 140, height: 140, data: new Uint8ClampedArray(140 * 140 * 4) })).toBeUndefined();
  });

  it("其他整数倍尺寸（每格 2 像素）也按格子中心认", () => {
    expect(decodeTileTerrain(tile((x, y) => COLOR[cellOf(x, y)]!, 2))).toEqual({ encoded, exact: true });
  });
});
