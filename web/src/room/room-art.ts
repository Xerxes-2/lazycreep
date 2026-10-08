/**
 * Art Style（GLOSSARY）→ Room View 的画法策略：对象画法映射表、房间级图层（地形 / 道路 / rampart）、
 * 光照层、是否用赛季贴图。buildRoomScene 与 Room View 只查这张表，不再各自判断画风。
 */
import type { ArtStyle } from "../art/art-style.ts";
import { seasonArtFor, type SeasonArt } from "../art/season-art.ts";
import type { Primitive } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { Source, Terrain } from "../source/source.ts";
import { officialLighting } from "./official-lighting.ts";
import { OFFICIAL_PAINTERS } from "./official-painters.ts";
import { officialRoomLayers } from "./official-terrain.ts";
import { LAYER, type ObjectPainter, type ObjectPainters, type PaintContext } from "./room-paint.ts";
import { ROOM_OBJECT_PAINTERS } from "./room-painters.ts";
import type { RoomState } from "./room-state.ts";
import { seasonMetadataPainter, withSeasonArt } from "./season-official-painters.ts";

export interface RoomArt {
  /** 对象类型 → 画法；没有条目的类型由 {@link RoomArt.extraPainter} 补，再没有就画占位 */
  readonly painters: ObjectPainters;
  /** 表里没有的类型的补充画法（官方画风：赛季 metadata 驱动的通用画法） */
  extraPainter(type: string, seasonArt: SeasonArt | undefined): ObjectPainter | undefined;
  /** 房间级图层：地形、道路连线、合并的 rampart */
  roomLayers(state: RoomState, terrain: Terrain | undefined, ctx: PaintContext): Primitive[];
  /** 光照层（显示选项里的光照开着时） */
  lighting(state: RoomState): Primitive[];
  /** 是否取版本信息、预检并使用赛季贴图 */
  readonly seasonArt: boolean;
  /**
   * 是否叠加进度条（通用的血条 / 资源条，以及画法自带的条）。官方画风不叠加：
   * 资源量由建筑填充与 creep 中心的资源圆表达，creep 血量由部件环表达。
   */
  readonly bars: boolean;
}

const N = 50;

/** 几何地形：墙与沼泽按行合并成矩形，平原不画。 */
function terrainPrimitives(terrain: Terrain, theme: Theme): Primitive[] {
  const prims: Primitive[] = [];
  const kindAt = (x: number, y: number) => {
    const code = Number(terrain.encoded[y * N + x] ?? 0);
    return code & 1 ? "wall" : code & 2 ? "swamp" : undefined;
  };
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const kind = kindAt(x, y);
      let end = x + 1;
      while (end < N && kindAt(end, y) === kind) end++;
      if (kind) {
        prims.push({
          key: `terrain/${y}/${x}`,
          kind: "rect",
          layer: LAYER.terrain,
          x,
          y,
          width: end - x,
          height: 1,
          fill: kind === "wall" ? theme.terrainWall : theme.terrainSwamp,
        });
      }
      x = end;
    }
  }
  return prims;
}

const GEOMETRIC: RoomArt = {
  painters: ROOM_OBJECT_PAINTERS,
  extraPainter: () => undefined,
  roomLayers: (_state, terrain, ctx) => (terrain ? terrainPrimitives(terrain, ctx.theme) : []),
  lighting: () => [],
  seasonArt: false,
  bars: true,
};

/** 官方表缺条目的类型退回几何画法；赛季对象贴图不可用时也退回几何 */
const OFFICIAL: RoomArt = {
  painters: withSeasonArt({ ...ROOM_OBJECT_PAINTERS, ...OFFICIAL_PAINTERS }),
  extraPainter: seasonMetadataPainter,
  roomLayers: officialRoomLayers,
  lighting: officialLighting,
  seasonArt: true,
  bars: false,
};

export const ROOM_ART: Readonly<Record<ArtStyle, RoomArt>> = { official: OFFICIAL, geometric: GEOMETRIC };

/**
 * Room View 用：这个画风下该 Source 当前可用的赛季贴图（在响应式上下文里读，预检完成时 Scene 重建一次）；
 * 不用赛季贴图的画风不取版本信息、不预检。
 */
export function seasonArtOf(source: Source | undefined, style: ArtStyle): SeasonArt | undefined {
  return source && ROOM_ART[style].seasonArt ? seasonArtFor(source)() : undefined;
}
