/**
 * World Map 上的 PvP 热点与核弹标记（#3），画在 MAP_LAYER.highlight 层。
 * 数据是聚合器给出的一个 Shard 的分组（已按时间窗过滤），所以热点随时间窗变化。
 */
import type { MapLayerPainter, MapPaintContext } from "../map/map-scene.ts";
import { MAP_LAYER } from "../map/map-scene.ts";
import { parseRoomName, worldOffset } from "../map/map-state.ts";
import type { Primitive } from "../scene/scene.ts";
import type { PvpShardGroup } from "./pvp-overview.ts";

/** 热点半径：房间的 0.3，但远看时至少这么多 CSS 像素 */
const HOTSPOT_RADIUS = 0.3;
const HOTSPOT_MIN_PX = 4;
const NUKE_RADIUS = 0.12;
const NUKE_MIN_PX = 3;
/** 一个房间有多少格 */
const ROOM_CELLS = 50;

function roomOrigin(ctx: MapPaintContext, room: string): { x: number; y: number } | undefined {
  const coord = parseRoomName(room);
  if (!coord) return undefined;
  const offset = worldOffset(ctx.state.size);
  return { x: coord.x + offset.x, y: coord.y + offset.y };
}

function inView(ctx: MapPaintContext, x: number, y: number, margin: number): boolean {
  const v = ctx.view.visible;
  return x >= v.x0 - margin && x < v.x1 + margin && y >= v.y0 - margin && y < v.y1 + margin;
}

export function pvpMapLayers(group: PvpShardGroup | undefined): readonly MapLayerPainter[] {
  return group ? [pvpHotspotLayer(group), nukeLayer(group)] : [];
}

/** PvP 热点（#28 的图层开关单独控制它与核弹层）：实心圆；pve 里的房间不画（交给 PvE 热点） */
export function pvpHotspotLayer(group: PvpShardGroup, pve: ReadonlySet<string> = new Set()): MapLayerPainter {
  return (ctx) => {
    const radius = Math.max(HOTSPOT_RADIUS, HOTSPOT_MIN_PX / ctx.zoom);
    // 最远的那个仍保留 0.35 的不透明度
    const oldest = Math.max(1, ...group.rooms.map((r) => r.ago));
    const out: Primitive[] = [];
    for (const entry of group.rooms) {
      if (pve.has(entry.room)) continue;
      const at = roomOrigin(ctx, entry.room);
      if (!at || !inView(ctx, at.x + 0.5, at.y + 0.5, radius)) continue;
      out.push({
        kind: "circle",
        key: `pvp:${entry.room}`,
        layer: MAP_LAYER.highlight,
        x: at.x + 0.5,
        y: at.y + 0.5,
        radius,
        fill: ctx.theme.power,
        alpha: 1 - 0.65 * (entry.ago / oldest),
        stroke: { color: ctx.theme.labelOutline, width: radius * 0.15 },
      });
    }
    return out;
  };
}

/** PvE 热点（打 Invader、Source Keeper 的房间）：空心圆环，与 PvP 热点同样按远近变淡 */
export function pveHotspotLayer(group: PvpShardGroup, pve: ReadonlySet<string>): MapLayerPainter {
  return (ctx) => {
    const radius = Math.max(HOTSPOT_RADIUS, HOTSPOT_MIN_PX / ctx.zoom);
    const oldest = Math.max(1, ...group.rooms.map((r) => r.ago));
    const out: Primitive[] = [];
    for (const entry of group.rooms) {
      if (!pve.has(entry.room)) continue;
      const at = roomOrigin(ctx, entry.room);
      if (!at || !inView(ctx, at.x + 0.5, at.y + 0.5, radius)) continue;
      out.push({
        kind: "circle",
        key: `pve:${entry.room}`,
        layer: MAP_LAYER.highlight,
        x: at.x + 0.5,
        y: at.y + 0.5,
        radius,
        alpha: 1 - 0.65 * (entry.ago / oldest),
        stroke: { color: ctx.theme.energy, width: radius * 0.3 },
      });
    }
    return out;
  };
}

/** 核弹落点与发射路径 */
export function nukeLayer(group: PvpShardGroup): MapLayerPainter {
  return (ctx) => {
    const radius = Math.max(NUKE_RADIUS, NUKE_MIN_PX / ctx.zoom);
    const out: Primitive[] = [];
    for (const nuke of group.nukes) {
      const target = roomOrigin(ctx, nuke.room);
      if (!target) continue;
      const x = target.x + (nuke.x + 0.5) / ROOM_CELLS;
      const y = target.y + (nuke.y + 0.5) / ROOM_CELLS;
      const launch = roomOrigin(ctx, nuke.launchRoom);
      if (launch) {
        out.push({
          kind: "line",
          key: `nuke-path:${nuke.id}`,
          layer: MAP_LAYER.highlight,
          points: [launch.x + 0.5, launch.y + 0.5, x, y],
          stroke: { color: ctx.theme.energy, width: radius * 0.4, alpha: 0.5 },
        });
      }
      out.push({
        kind: "circle",
        key: `nuke:${nuke.id}`,
        layer: MAP_LAYER.highlight,
        x,
        y,
        radius,
        stroke: { color: ctx.theme.energy, width: radius * 0.35 },
      });
    }
    return out;
  };
}
