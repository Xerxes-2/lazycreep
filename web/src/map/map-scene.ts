/**
 * buildMapScene：MapState → Scene（World Map）。世界单位 1 = 一个房间，Scene 覆盖整个世界。
 * 只为与可见区域相交的房间产出图元；缩放级别决定用单房间瓦片、zoom2 块瓦片还是 zoom1 扇区瓦片。
 *
 * 由若干“层”组成（MAP_LAYERS），每层是 `(ctx) => Primitive[]`：层级常量在 MAP_LAYER 里，
 * 按缩放降密在层内看 ctx.zoom 决定，房间遍历用 ctx.visibleRooms。
 * 信息层（区域、RCL、矿物、Power Bank、我方与盟友高亮）在 map-info-layers.ts。
 */
import type { Color, Primitive, Scene } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import { ownerColorRule } from "../room/room-detail-rules.ts";
import { roomOwnership } from "../source/source.ts";
import { paintAlliedHighlight, paintMinerals, paintPowerBanks, paintRcl, paintZones } from "./map-info-layers.ts";
import { roomName, worldOffset, type MapState } from "./map-state.ts";

/** 越大越靠上 */
export const MAP_LAYER = {
  tile: 0,
  ownership: 10,
  /** 新手区 / 重生区 / 禁区等整格覆盖 */
  zone: 20,
  /** RCL、矿物、Power Bank 等标注 */
  info: 30,
  /** 我方、盟友高亮；PvP 热点（#3） */
  highlight: 40,
} as const;

/** 每个房间至少这么多 CSS 像素时用单房间瓦片（150px），否则用 zoom2 块瓦片（每房间 50px）。 */
export const ROOM_TILE_MIN_ZOOM = 48;

/**
 * 每个房间至少这么多 CSS 像素时用 zoom2 块瓦片，否则用 zoom1 扇区瓦片（200px 盖 10 个房间，每房间 20px）。
 * 取 zoom1 的原生分辨率：再往下缩，zoom1 已不比 zoom2 糊，张数却只有约 1/6（赛季世界 144 张对 676 张）。
 */
export const BLOCK_TILE_MIN_ZOOM = 20;

/** 一张 zoom2 块瓦片覆盖的房间数（每边） */
export const BLOCK_ROOMS = 4;

/** 一张 zoom1 扇区瓦片覆盖的房间数（每边） */
export const SECTOR_ROOMS = 10;

/** 世界坐标的矩形 [x0, x1) × [y0, y1) */
export interface WorldRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface MapView {
  readonly theme: Theme;
  /** 每个房间占多少 CSS 像素 */
  readonly zoom: number;
  /** 当前可见的世界区域 */
  readonly visible: WorldRect;
  /** 所有者着色规则；默认见 defaultOwnerColor */
  readonly ownerColor?: (userId: string, state: MapState) => Color;
  /** 当前时间（Unix 毫秒），判断新手区等是否仍有效；默认 Date.now() */
  readonly now?: number;
}

/** 一个可见房间 */
export interface VisibleRoom {
  readonly name: string;
  /** 世界坐标（房间格左上角） */
  readonly x: number;
  readonly y: number;
}

export interface MapPaintContext {
  readonly state: MapState;
  readonly view: MapView;
  readonly theme: Theme;
  readonly zoom: number;
  /** 当前时间（Unix 毫秒） */
  readonly now: number;
  readonly ownerColor: (userId: string) => Color;
  /** 与可见区域相交、且在世界之内的房间 */
  readonly visibleRooms: readonly VisibleRoom[];
}

export type MapLayerPainter = (ctx: MapPaintContext) => readonly Primitive[];

/**
 * 默认着色：与 Room View 同一条规则（#12 的 ownerColorRule），同一玩家在地图与房间里颜色一致。
 * 自己用 theme.owned，Ally List（MapState.allies）里的玩家用 theme.ally，
 * 其他玩家按 id 稳定地取 theme.strangers 之一。
 */
export function defaultOwnerColor(theme: Theme): (userId: string, state: MapState) => Color {
  return (userId, state) => ownerColorRule(theme, state.users, { me: state.me, allies: state.allies })(userId);
}

/** 与 rect 相交的整数格 [from, to]（含），再夹到 [0, limit) */
function cells(from: number, to: number, limit: number): [number, number] {
  return [Math.max(0, Math.floor(from)), Math.min(limit, Math.ceil(to)) - 1];
}

function visibleRooms(state: MapState, rect: WorldRect): VisibleRoom[] {
  const [x0, x1] = cells(rect.x0, rect.x1, state.size.width);
  const [y0, y1] = cells(rect.y0, rect.y1, state.size.height);
  const offset = worldOffset(state.size);
  const rooms: VisibleRoom[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) rooms.push({ name: roomName({ x: x - offset.x, y: y - offset.y }), x, y });
  }
  return rooms;
}

export const paintTiles: MapLayerPainter = (ctx) => {
  const { state } = ctx;
  if (ctx.zoom >= ROOM_TILE_MIN_ZOOM) {
    return ctx.visibleRooms.map((room) => ({
      kind: "image",
      key: `tile:${room.name}`,
      layer: MAP_LAYER.tile,
      x: room.x,
      y: room.y,
      width: 1,
      height: 1,
      url: state.tiles.room(room.name),
    }));
  }
  return ctx.zoom >= BLOCK_TILE_MIN_ZOOM
    ? cornerTiles(ctx, BLOCK_ROOMS, "block", state.tiles.block)
    : cornerTiles(ctx, SECTOR_ROOMS, "sector", state.tiles.sector);
};

/** 一张瓦片盖 span×span 个房间，按西北角房间（有符号坐标为 span 的倍数）命名 */
function cornerTiles(ctx: MapPaintContext, span: number, kind: string, url: (corner: string) => string): Primitive[] {
  const offset = worldOffset(ctx.state.size);
  const corners = new Map<string, { x: number; y: number }>();
  for (const room of ctx.visibleRooms) {
    const sx = Math.floor((room.x - offset.x) / span) * span;
    const sy = Math.floor((room.y - offset.y) / span) * span;
    const name = roomName({ x: sx, y: sy });
    if (!corners.has(name)) corners.set(name, { x: sx + offset.x, y: sy + offset.y });
  }
  return [...corners].map(([name, at]) => ({
    kind: "image",
    key: `${kind}:${name}`,
    layer: MAP_LAYER.tile,
    x: at.x,
    y: at.y,
    width: span,
    height: span,
    url: url(name),
  }));
}

const OWNED_ALPHA = 0.45;
const RESERVED_ALPHA = 0.2;
const OWNED_BORDER = 0.08;

/** 占有（RCL ≥ 1）的房间：半透明填充加边框；预定（level 0）：更淡的填充，无边框。 */
export const paintOwnership: MapLayerPainter = (ctx) => {
  const out: Primitive[] = [];
  for (const room of ctx.visibleRooms) {
    const owner = roomOwnership(ctx.state.rooms[room.name]);
    if (owner.kind === "none") continue;
    const color = ctx.ownerColor(owner.user);
    const reserved = owner.kind === "reserved";
    out.push({
      kind: "rect",
      key: `own:${room.name}`,
      layer: MAP_LAYER.ownership,
      x: room.x,
      y: room.y,
      width: 1,
      height: 1,
      fill: color,
      alpha: reserved ? RESERVED_ALPHA : OWNED_ALPHA,
      ...(reserved ? {} : { stroke: { color, width: OWNED_BORDER } }),
    });
  }
  return out;
};

export const MAP_LAYERS: readonly MapLayerPainter[] = [
  paintTiles,
  paintOwnership,
  paintZones,
  paintRcl,
  paintMinerals,
  paintPowerBanks,
  paintAlliedHighlight,
];

export function buildMapScene(
  state: MapState,
  view: MapView,
  layers: readonly MapLayerPainter[] = MAP_LAYERS,
): Scene {
  const ownerColor = view.ownerColor ?? defaultOwnerColor(view.theme);
  const ctx: MapPaintContext = {
    state,
    view,
    theme: view.theme,
    zoom: view.zoom,
    now: view.now ?? Date.now(),
    ownerColor: (userId) => ownerColor(userId, state),
    visibleRooms: visibleRooms(state, view.visible),
  };
  return {
    width: state.size.width,
    height: state.size.height,
    background: view.theme.background,
    primitives: layers.flatMap((layer) => layer(ctx)),
  };
}
