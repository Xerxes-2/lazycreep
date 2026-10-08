/**
 * 从地图瓦片解出房间地形：Minimap 与 World Map 已经取过（走浏览器 HTTP 缓存）的单房间瓦片（150×150，每格 3×3 像素）
 * 只有几种纯色，按格子中心的像素认地形，不必等 `game/room-terrain`（约 1.4 秒，有额度）。
 *
 * 实测（赛季服 90 个房间对照 `room-terrain`）：墙 (0,0,0)、沼泽 (35,37,19)、平地 (43,43,43) 一一对应；
 * 出口 (50,50,50)：房间四边上非墙的格子，底下多半是平地，偶尔是沼泽（90 个房间里 3 格），认不出来。瓦片不画道路。
 * - 没有出口像素：解出来的就是准确地形（exact）。几乎每个房间都有出口，所以实际上很少见
 * - 有出口像素：出口格按平地给出，只能先画着，等准确地形替换
 * - 有不认识的颜色（别的赛季、别的 Server 的配色）或尺寸不对：认不出，返回 undefined，照旧请求
 */
/** 房间边长（格） */
const ROOM_TERRAIN_SIZE = 50;

/** 瓦片像素（RGBA，逐行） */
export interface TilePixels {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface TileTerrain {
  /** 与 `room-terrain` 的 encoded 同一编码：每格一个字符，0 平地、1 墙、2 沼泽 */
  readonly encoded: string;
  /** 没有认不准的格子（出口）时为 true */
  readonly exact: boolean;
}

const WALL = "1";
const SWAMP = "2";
const PLAIN = "0";

/** 颜色 → 地形；undefined 表示出口（底下的地形认不出） */
const COLORS: ReadonlyMap<number, string | undefined> = new Map([
  [rgb(0, 0, 0), WALL],
  [rgb(35, 37, 19), SWAMP],
  [rgb(43, 43, 43), PLAIN],
  [rgb(50, 50, 50), undefined],
]);

function rgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

export function decodeTileTerrain(pixels: TilePixels): TileTerrain | undefined {
  const { width, height, data } = pixels;
  const scale = width / ROOM_TERRAIN_SIZE;
  if (!Number.isInteger(scale) || scale < 1 || height !== width || data.length < width * height * 4) return undefined;
  const middle = Math.floor(scale / 2);
  let encoded = "";
  let exact = true;
  for (let y = 0; y < ROOM_TERRAIN_SIZE; y++) {
    for (let x = 0; x < ROOM_TERRAIN_SIZE; x++) {
      const i = ((y * scale + middle) * width + x * scale + middle) * 4;
      if (data[i + 3] !== 255) return undefined;
      const color = rgb(data[i]!, data[i + 1]!, data[i + 2]!);
      if (!COLORS.has(color)) return undefined;
      const terrain = COLORS.get(color);
      if (terrain === undefined) exact = false;
      encoded += terrain ?? PLAIN;
    }
  }
  return { encoded, exact };
}

/** 浏览器里取瓦片像素：fetch（走 HTTP 缓存）→ 解码 → 读像素 */
export async function loadTilePixels(url: string): Promise<TilePixels> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}：${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const { width, height } = bitmap;
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("没有 2D 画布");
    context.drawImage(bitmap, 0, 0);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}
