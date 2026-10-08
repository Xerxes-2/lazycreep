/**
 * World Map 的徽章图层（#43）：每个已占领房间中央画主人徽章，被预定的房间画预定者徽章（半透明）。
 *
 * 尺寸照官方新版世界地图（@screeps/map）：边长 `(0.05·level + 0.2)` 个房间宽，level 为 RCL，预定为 0，
 * 即 RCL 8 时 0.6 个房间宽；预定的 alpha 0.5（docs/research/official-art-and-badges.md B10）。
 *
 * 图层只决定“画在哪、多大”；徽章贴图的 URL 由调用方给（见 map-badges.ts：栅格化并按 Server + 用户 + 徽章缓存），
 * 还没有贴图的玩家先不画，贴图到了再随 Scene 重建出现。
 */
import type { Primitive } from "../scene/scene.ts";
import { roomOwnership, type RoomUser } from "../source/source.ts";
import { MAP_LAYER, type MapLayerPainter } from "./map-scene.ts";

/** 在所有权色块、单位像素（#44）与区域覆盖之上（徽章便于辨认），RCL 数字等标注之下 */
export const BADGE_LAYER = MAP_LAYER.zone + 5;

const RESERVED_ALPHA = 0.5;

/** 徽章边长（房间宽的比例）；level 0 为预定 */
export const badgeSize = (level: number): number => 0.05 * level + 0.2;

/**
 * 玩家的徽章贴图 URL；还没有时 undefined（不画）。
 * user 是 map-stats 里该玩家的资料（可能带 badge），map-stats 没给时为 undefined。
 */
export type MapBadgeUrl = (userId: string, user: RoomUser | undefined) => string | undefined;

export function badgeLayer(badgeUrl: MapBadgeUrl): MapLayerPainter {
  return (ctx) => {
    const out: Primitive[] = [];
    for (const room of ctx.visibleRooms) {
      const owner = roomOwnership(ctx.state.rooms[room.name]);
      if (owner.kind === "none") continue;
      const url = badgeUrl(owner.user, ctx.state.users[owner.user]);
      if (url === undefined) continue;
      const reserved = owner.kind === "reserved";
      const size = badgeSize(reserved ? 0 : owner.level);
      out.push({
        kind: "image",
        key: `badge:${room.name}`,
        layer: BADGE_LAYER,
        x: room.x + (1 - size) / 2,
        y: room.y + (1 - size) / 2,
        width: size,
        height: size,
        url,
        ...(reserved ? { alpha: RESERVED_ALPHA } : {}),
      });
    }
    return out;
  };
}
