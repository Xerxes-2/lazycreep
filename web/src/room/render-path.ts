/**
 * 官方 pathHelper（screeps/renderer `engine/src/lib/pathHelper.js` 的 getRenderPath，ISC，commit a2db4a7）
 * 的移植（#46）：把一组格子合并成一条 SVG path，外凸的角画成半径半格的圆弧、贴房间边缘的角是直角。
 * 墙、沼泽、非公开 rampart 都用它。
 *
 * 坐标沿用官方：100 单位 = 1 格，格 (x, y) 占 [100x, 100x+100) × [100y, 100y+100)。
 * 结果是若干相互重叠的子路径（官方逐格向右 / 向下递归），按 nonzero 填充即是格子的并集；
 * 描边要先画（`paint-order: stroke`），否则子路径相交处会露出描边。
 * 与官方的差别：输入是格子位图而不是对象数组，没有 md5（缓存由调用方按输入做）。
 */

export const PATH_ROOM_SIZE = 50;

/** 50×50 的格子位图，下标 y * 50 + x，非 0 表示有 */
export type CellGrid = Uint8Array;

export function cellGrid(): CellGrid {
  return new Uint8Array(PATH_ROOM_SIZE * PATH_ROOM_SIZE);
}

/**
 * 官方 getRenderPath(options, [objects], filter, md5, diagonalConnect) 的移植；没有格子时为空串。
 * diagonalConnect 默认 false（官方的墙、沼泽、rampart 都不开）。
 */
export function renderPath(cells: CellGrid, diagonalConnect = false): string {
  const N = PATH_ROOM_SIZE;
  const last = N - 1;
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && cells[y * N + x] !== 0;
  const visited = new Uint8Array(N * N);
  let path = "";

  const topLeftDownR = (x: number, y: number) => {
    path += x > 0 && y > 0 && !has(x - 1, y) ? "a 50 50 0 0 0 -50 -50 h 50 " : "v -50 ";
  };
  const topLeftUpR = (x: number, y: number) => {
    path += y > 0 && x > 0 && !has(x, y - 1) ? "v -50 a 50 50 0 0 0 50 50 " : "h 50 ";
  };
  const topLeftR = (x: number, y: number) => {
    path += x === 0 || has(x - 1, y) || y === 0 || has(x, y - 1) ? "v -50 h 50 " : "a 50 50 0 0 1 50 -50 ";
  };
  const topRightUpR = (x: number, y: number) => {
    path += y > 0 && x < last && !has(x, y - 1) ? "a 50 50 0 0 0 50 -50 v 50 " : "h 50 ";
  };
  const topRightDownR = (x: number, y: number) => {
    path += x < last && y > 0 && !has(x + 1, y) ? "h 50 a 50 50 0 0 0 -50 50 " : "v 50 ";
  };
  const topRightR = (x: number, y: number) => {
    path += x === last || has(x + 1, y) || y === 0 || has(x, y - 1) ? "h 50 v 50 " : "a 50 50 0 0 1 50 50 ";
  };
  const bottomRightR = (x: number, y: number) => {
    const square =
      x === last || has(x + 1, y) || y === last || has(x, y + 1) || (has(x + 1, y + 1) && (has(x + 1, y) || diagonalConnect));
    path += square ? "v 50 h -50 " : "a 50 50 0 0 1 -50 50 ";
  };
  const bottomLeftR = (x: number, y: number) => {
    const square =
      x === 0 || has(x - 1, y) || y === last || has(x, y + 1) || (has(x - 1, y + 1) && (has(x - 1, y) || diagonalConnect));
    path += square ? "h -50 v -50 " : "a 50 50 0 0 1 -50 -50 ";
  };
  /** 左上角与左上斜邻相连（或在边缘）：两段直边 / 内凹弧 */
  const topLeftJoined = (x: number, y: number) =>
    x === 0 || y === 0 || (has(x - 1, y - 1) && (diagonalConnect || has(x - 1, y) || has(x, y - 1)));
  const topRightJoined = (x: number, y: number) =>
    x === last || y === 0 || (has(x + 1, y - 1) && (diagonalConnect || has(x + 1, y) || has(x, y - 1)));

  const recurs = (x: number, y: number, horizontal: boolean): void => {
    if (visited[y * N + x]) {
      path += horizontal ? "v 100 " : "h -100 ";
      return;
    }
    if (horizontal) {
      if (topLeftJoined(x, y)) topLeftUpR(x, y);
      else path += "h 50 ";
      if (x < last && has(x + 1, y)) {
        if (topRightJoined(x, y)) topRightUpR(x, y);
        else path += "h 50 ";
        recurs(x + 1, y, true);
        path += "h -100 ";
      } else {
        if (topRightJoined(x, y)) {
          topRightUpR(x, y);
          topRightDownR(x, y);
        } else topRightR(x, y);
        bottomRightR(x, y);
        path += "h -50 ";
      }
    } else {
      if (topRightJoined(x, y)) topRightDownR(x, y);
      else path += "v 50 ";
      if (y < last && has(x, y + 1)) {
        path += "v 50 ";
        recurs(x, y + 1, false);
        path += "v -50 ";
      } else {
        bottomRightR(x, y);
        bottomLeftR(x, y);
      }
      // 官方这里不看 diagonalConnect 与正交邻居
      if (x === 0 || y === 0 || has(x - 1, y - 1)) topLeftDownR(x, y);
      else path += "v -50 ";
    }
    visited[y * N + x] = 1;
  };

  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      if (!has(x, y) || visited[y * N + x]) continue;
      path += `M ${x * 100} ${y * 100 + 50} `;
      visited[y * N + x] = 1;
      let horizontal = 0;
      do horizontal++;
      while (x + horizontal < N && has(x + horizontal, y));
      let vertical = 0;
      do vertical++;
      while (y + vertical < N && has(x, y + vertical));

      if (topLeftJoined(x, y)) {
        topLeftDownR(x, y);
        topLeftUpR(x, y);
      } else topLeftR(x, y);

      if (vertical < horizontal) {
        if (x < last && has(x + 1, y)) {
          if (topRightJoined(x, y)) topRightUpR(x, y);
          else path += "h 50 ";
          recurs(x + 1, y, true);
          path += "h -50 ";
        } else {
          if (topRightJoined(x, y)) {
            topRightUpR(x, y);
            topRightDownR(x, y);
          } else topRightR(x, y);
          bottomRightR(x, y);
        }
        bottomLeftR(x, y);
      } else {
        if (topRightJoined(x, y)) {
          topRightUpR(x, y);
          topRightDownR(x, y);
        } else topRightR(x, y);
        if (y < last && has(x, y + 1)) {
          path += "v 50 ";
          recurs(x, y + 1, false);
          path += "v -50 ";
        } else {
          bottomRightR(x, y);
          bottomLeftR(x, y);
        }
      }
      path += "Z ";
    }
  }
  return path;
}
