/**
 * 官方画风里对象中心的主人徽章（#48，对应官方 `userBadge` processor，screeps/renderer
 * `engine/src/lib/processors/userBadge.js`，ISC，commit a2db4a7）。
 *
 * - 徽章取房间流的 `users[obj.user].badge`，经 parseBadge → badgeSvg 成 `data:image/svg+xml` URL 的 image 图元。
 *   URL 按徽章内容缓存（badgeSvgUrl），适配层按 URL 只栅格化一次，同一玩家的所有对象共用一张纹理。
 * - 官方尺寸：controller 半径 37、spawn 与 powerSpawn 38（各自 metadata 的 ellipse3 / ellipse4）、creep / powerCreep 26。
 * - 没有主人：不画。有主人但没有可用徽章（如 Source Keeper）：照官方退路画主人色的纯色圆。
 * - creep 等小徽章在缩放低于 {@link BADGE_MIN_ZOOM} 时也退成纯色圆。
 */
import { badgeSvgUrl } from "../badge/badge-image.ts";
import { parseBadge } from "../badge/badge.ts";
import { center, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

/**
 * 画布上 1 格不足这么多像素时，creep 的徽章退成主人色圆。creep 徽章直径约半格，16 px/格时约 8 px，
 * 再小就只剩一团色块、认不出图案，主人色圆传达的信息相同且更清楚。比进度条的 BAR_MIN_ZOOM（14）
 * 略高，是因为徽章的图案比一根进度条需要更多像素才可读；整房间铺满常见窗口（约 18–20 px/格）时仍显示。
 */
export const BADGE_MIN_ZOOM = 16;

export interface OwnerBadgeOptions {
  /** 官方单位（100 = 1 格） */
  readonly radius: number;
  readonly layer: number;
  /** 缩放低于 {@link BADGE_MIN_ZOOM} 时退成纯色圆（creep、powerCreep） */
  readonly minZoom?: boolean;
  /**
   * 不以格子中心为圆心的方形徽章（powerCreep，官方 `width/height` + `pivot.y`）：边长 size，
   * 上沿在中心上方 top 处；官方单位。纯色圆退路仍在格子中心、按 radius。
   */
  readonly box?: { readonly size: number; readonly top: number };
}

const u = (value: number) => value / 100;

export function ownerBadge(obj: RoomObject, ctx: PaintContext, options: OwnerBadgeOptions): PrimitiveDraft[] {
  const user = obj["user"];
  if (typeof user !== "string") return [];
  const { x, y } = center(obj);
  const badge = parseBadge(ctx.users[user]?.["badge"]);
  if (!badge || (options.minZoom && ctx.zoom < BADGE_MIN_ZOOM)) {
    return [{ part: "badge", kind: "circle", layer: options.layer, x, y, radius: u(options.radius), fill: ctx.ownerColor(user) }];
  }
  const size = u(options.box?.size ?? 2 * options.radius);
  const top = options.box ? y - u(options.box.top) : y - size / 2;
  return [{ part: "badge", kind: "image", layer: options.layer, x: x - size / 2, y: top, width: size, height: size, url: badgeSvgUrl(badge) }];
}
