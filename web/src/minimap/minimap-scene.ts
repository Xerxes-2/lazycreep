/**
 * Minimap 的 Scene（#27）：以当前房间为中心的 3×3 房间格。纯函数，Pixi 适配层负责画。
 *
 * 世界单位 1 = 一个房间，Scene 是 [0, 3) × [0, 3)，当前房间占中心格 [1, 2) × [1, 2)。
 * 每格是该房间的单房间地形瓦片（与 World Map 同一份），上面叠所有者着色与 roomMap2 的位置
 * （官方客户端即如此：每格一个 roomMap2 订阅）。位置与 World Map 的单位图层同一种像素图：每房间一张
 * 50×50（一格一像素，units-raster.ts），但不加色、直接盖在地形上：照官方 Angular 小地图
 * （build.min.js 的 appGameMapRoomObjects，putImageData），人工墙是黑色，加色就看不见了
 * （World Map 同样不加色，见 map-units.ts）。路与墙另一张图，放在所有权色块之下（见 units-raster.ts）。世界之外的格子什么都不画，也不可点。
 */
import { parseRoomName, roomName, worldOffset } from "../map/map-state.ts";
import type { Color, Primitive, Scene } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import { createUnitsRaster } from "../map/units-raster.ts";
import { roomOwnership, type RoomMapUpdate, type RoomStats, type WorldSize } from "../source/source.ts";

export interface MinimapInput {
  /** 当前房间 */
  readonly center: string;
  readonly size: WorldSize;
  /** 单房间瓦片地址，通常是 Source.tileUrl */
  readonly tileUrl: (room: string) => string;
  /** 已知的房间统计（OwnershipHub） */
  readonly rooms: Readonly<Record<string, RoomStats>>;
  /** 各房间最近一帧 roomMap2 */
  readonly positions: Readonly<Record<string, RoomMapUpdate>>;
  /** 玩家 id → 颜色（与地图、Room View 同一条规则） */
  readonly ownerColor: (userId: string) => Color;
  /** 已知用户（roomMap2 的键不是标准 id 时据此认作玩家）；默认空 */
  readonly users?: Readonly<Record<string, unknown>>;
  readonly theme: Theme;
}

/** 一个在世界之内的格子 */
export interface MinimapCell {
  readonly room: string;
  /** 0–2 */
  readonly col: number;
  readonly row: number;
}

const LAYER = { tile: 0, ground: 5, ownership: 10, units: 20, frame: 30 } as const;

const OWNED_ALPHA = 0.35;
const RESERVED_ALPHA = 0.15;
const FRAME_WIDTH = 0.03;

/** 全页共用一份像素图缓存 */
const groundRaster = createUnitsRaster("ground");
const unitsRaster = createUnitsRaster("top");

/** 3×3 格里在世界之内的格子（按行）；不是常规房间名时为空 */
export function minimapCells(center: string, size: WorldSize): MinimapCell[] {
  const at = parseRoomName(center.trim().toUpperCase());
  if (!at) return [];
  const offset = worldOffset(size);
  const cells: MinimapCell[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = at.x + col - 1;
      const y = at.y + row - 1;
      const wx = x + offset.x;
      const wy = y + offset.y;
      if (wx < 0 || wy < 0 || wx >= size.width || wy >= size.height) continue;
      cells.push({ room: roomName({ x, y }), col, row });
    }
  }
  return cells;
}

/** Scene 坐标 (x, y) 处格子里的房间；画面外或世界外为 undefined */
export function minimapRoomAt(center: string, size: WorldSize, x: number, y: number): string | undefined {
  if (x < 0 || y < 0 || x >= 3 || y >= 3) return undefined;
  const col = Math.floor(x);
  const row = Math.floor(y);
  return minimapCells(center, size).find((c) => c.col === col && c.row === row)?.room;
}

export function buildMinimapScene(input: MinimapInput): Scene {
  const out: Primitive[] = [];
  const coloring = { ownerColor: input.ownerColor, knownUsers: input.users ?? {} };
  for (const { room, col, row } of minimapCells(input.center, input.size)) {
    out.push({ kind: "image", key: `tile:${room}`, layer: LAYER.tile, x: col, y: row, width: 1, height: 1, url: input.tileUrl(room) });
    const frame = input.positions[room];
    const groundUrl = frame && groundRaster(frame, coloring);
    if (groundUrl !== undefined) {
      out.push({ kind: "image", key: `ground:${room}`, layer: LAYER.ground, x: col, y: row, width: 1, height: 1, url: groundUrl });
    }

    const owner = roomOwnership(input.rooms[room]);
    if (owner.kind !== "none") {
      out.push({
        kind: "rect",
        key: `own:${room}`,
        layer: LAYER.ownership,
        x: col,
        y: row,
        width: 1,
        height: 1,
        fill: input.ownerColor(owner.user),
        alpha: owner.kind === "reserved" ? RESERVED_ALPHA : OWNED_ALPHA,
      });
    }

    const url = frame && unitsRaster(frame, coloring);
    if (url !== undefined) {
      out.push({ kind: "image", key: `units:${room}`, layer: LAYER.units, x: col, y: row, width: 1, height: 1, url });
    }
  }
  if (out.length > 0) {
    out.push({
      kind: "rect",
      key: "frame",
      layer: LAYER.frame,
      x: 1,
      y: 1,
      width: 1,
      height: 1,
      stroke: { color: input.theme.selection, width: FRAME_WIDTH },
    });
  }
  return { width: 3, height: 3, background: input.theme.background, primitives: out };
}
