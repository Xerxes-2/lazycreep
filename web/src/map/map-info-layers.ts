/**
 * World Map 的信息层（#17）：新手区 / 重生区 / 禁区覆盖、RCL、矿物、Power Bank、我方与盟友高亮。
 *
 * 数据来源（实测见 docs/research/screeps-api-facts.md 第 5 节）：
 * - RCL、矿物、新手区 / 重生区 / 开放时间、越界：map-stats（statName `minerals0`，经所有权加载器，不额外占额度）
 * - Power Bank：roomMap2 的 `pb`（只在放大到 ICON_MIN_ZOOM 以上时订阅可见房间，见 room-map-feed.ts）
 *
 * 远看自动降密：RCL 数字在 RCL_MIN_ZOOM 以上才画，矿物与 Power Bank 在 ICON_MIN_ZOOM 以上才画；
 * 区域覆盖与我方 / 盟友高亮任何缩放都画。
 *
 * 用函数声明（会提升）：本模块与 map-scene.ts 互相引用，MAP_LAYERS 在模块求值时就要拿到这些函数。
 */
import type { Primitive } from "../scene/scene.ts";
import { relationOf } from "../room/room-detail-rules.ts";
import { MAP_LAYER, type MapPaintContext } from "./map-scene.ts";

/** 每个房间至少这么多 CSS 像素时显示 RCL 数字 */
export const RCL_MIN_ZOOM = 20;
/** 每个房间至少这么多 CSS 像素时显示矿物与 Power Bank（并订阅 roomMap2） */
export const ICON_MIN_ZOOM = 48;

/** 区域覆盖的颜色与透明度，取自官方客户端的世界地图 */
const ZONE = {
  novice: { fill: 0x57ff59, alpha: 0.1 },
  respawn: { fill: 0x006eff, alpha: 0.15 },
  closed: { fill: 0x000000, alpha: 0.4 },
} as const;

/** 新手区、重生区、禁区（越界或尚未开放）各画一个整格覆盖；禁区优先。 */
export function paintZones(ctx: MapPaintContext): Primitive[] {
  const out: Primitive[] = [];
  for (const room of ctx.visibleRooms) {
    const stats = ctx.state.rooms[room.name];
    if (!stats) continue;
    const closed = (stats.status !== "normal" && !stats.safeMode) || (stats.openTime ?? 0) > ctx.now;
    const zone = closed
      ? ZONE.closed
      : (stats.novice ?? 0) > ctx.now
        ? ZONE.novice
        : (stats.respawnArea ?? 0) > ctx.now
          ? ZONE.respawn
          : undefined;
    if (!zone) continue;
    out.push({
      kind: "rect",
      key: `zone:${room.name}`,
      layer: MAP_LAYER.zone,
      x: room.x,
      y: room.y,
      width: 1,
      height: 1,
      fill: zone.fill,
      alpha: zone.alpha,
    });
  }
  return out;
}

/** RCL（房间中央）、矿物类型（右下角）、Power Bank（房间内的实际位置）。 */
export function paintInfo(ctx: MapPaintContext): Primitive[] {
  if (ctx.zoom < RCL_MIN_ZOOM) return [];
  const icons = ctx.zoom >= ICON_MIN_ZOOM;
  const { theme } = ctx;
  const outline = (width: number) => ({ color: theme.labelOutline, width });
  const out: Primitive[] = [];
  for (const room of ctx.visibleRooms) {
    const stats = ctx.state.rooms[room.name];
    const level = stats?.owner?.level ?? 0;
    if (level > 0) {
      out.push({
        kind: "text",
        key: `rcl:${room.name}`,
        layer: MAP_LAYER.info,
        x: room.x + 0.5,
        y: room.y + 0.5,
        text: String(level),
        size: 0.4,
        color: theme.label,
        align: "center",
        stroke: outline(0.06),
      });
    }
    if (!icons) continue;
    if (stats?.mineral) {
      out.push({
        kind: "text",
        key: `mineral:${room.name}`,
        layer: MAP_LAYER.info,
        x: room.x + 0.92,
        y: room.y + 0.86,
        text: stats.mineral.type,
        size: 0.2,
        color: theme.mineral,
        align: "right",
        stroke: outline(0.04),
      });
    }
    const banks = ctx.state.powerBanks[room.name] ?? [];
    banks.forEach(([x, y], i) => {
      out.push({
        kind: "circle",
        key: `pb:${room.name}:${i}`,
        layer: MAP_LAYER.info,
        x: room.x + (x + 0.5) / 50,
        y: room.y + (y + 0.5) / 50,
        radius: 0.06,
        fill: theme.power,
        stroke: outline(0.015),
      });
    });
  }
  return out;
}

/** 我方与盟友占有（RCL ≥ 1）的房间：一圈醒目的边框，远看也能找到。 */
export function paintAlliedHighlight(ctx: MapPaintContext): Primitive[] {
  const { state } = ctx;
  // 约 2 个屏幕像素，但不超过房间的 0.15
  const width = Math.min(0.15, 2 / ctx.zoom);
  const out: Primitive[] = [];
  for (const room of ctx.visibleRooms) {
    const owner = state.rooms[room.name]?.owner;
    if (!owner || owner.level === 0) continue;
    const relation = relationOf(owner.user, state.users, { me: state.me, allies: state.allies });
    if (relation !== "me" && relation !== "ally") continue;
    out.push({
      kind: "rect",
      key: `mine:${room.name}`,
      layer: MAP_LAYER.highlight,
      x: room.x + width / 2,
      y: room.y + width / 2,
      width: 1 - width,
      height: 1 - width,
      stroke: { color: relation === "me" ? ctx.theme.owned : ctx.theme.ally, width },
    });
  }
  return out;
}
