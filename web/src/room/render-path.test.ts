/**
 * #46：官方 pathHelper 的移植。期望值是按官方算法手推的路径（100 单位 = 1 格，格 (x, y) 占
 * [100x, 100x+100) × [100y, 100y+100)）。
 */
import { describe, expect, it } from "vitest";
import { cellGrid, renderPath } from "./render-path.ts";

const grid = (cells: readonly (readonly [number, number])[]) => {
  const g = cellGrid();
  for (const [x, y] of cells) g[y * 50 + x] = 1;
  return g;
};

describe("renderPath：格子合并成一条带圆角的 SVG path", () => {
  it("没有格子时为空", () => {
    expect(renderPath(cellGrid())).toBe("");
  });

  it("孤立的一格是一个圆", () => {
    expect(renderPath(grid([[1, 1]]))).toBe(
      "M 100 150 a 50 50 0 0 1 50 -50 a 50 50 0 0 1 50 50 a 50 50 0 0 1 -50 50 a 50 50 0 0 1 -50 -50 Z ",
    );
  });

  it("横向相邻的两格合成一个胶囊（一条子路径，中间没有缝）", () => {
    expect(renderPath(grid([[1, 1], [2, 1]]))).toBe(
      "M 100 150 a 50 50 0 0 1 50 -50 h 50 h 50 a 50 50 0 0 1 50 50 a 50 50 0 0 1 -50 50 h -50 h -50 a 50 50 0 0 1 -50 -50 Z ",
    );
  });

  it("贴着房间边缘的角是直角，其余角是圆角", () => {
    expect(renderPath(grid([[0, 0]]))).toBe("M 0 50 v -50 h 50 h 50 v 50 a 50 50 0 0 1 -50 50 h -50 v -50 Z ");
  });

  it("一条竖直的墙是一条子路径；分开的两片各一条", () => {
    const column = renderPath(grid([[5, 5], [5, 6], [5, 7]]));
    expect(column.match(/M /g)).toHaveLength(1);
    const apart = renderPath(grid([[5, 5], [20, 20]]));
    expect(apart.match(/M /g)).toHaveLength(2);
  });
});
