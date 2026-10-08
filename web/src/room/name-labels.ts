/**
 * 玩家名（#26 的显示选项）：creep 与 power creep 下方标出主人的玩家名。
 * 放在下方、格子之外：上方留给 say 气泡（#22），也避开格子下沿以内的血条 / 资源条。
 * 与血条同一条缩放规则（barsVisible）：看不清时只给选中对象画。
 */
import { LAYER, center, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

const NAMED_TYPES = new Set(["creep", "powerCreep"]);

export function nameLabel(obj: RoomObject, ctx: PaintContext): PrimitiveDraft | undefined {
  const type = obj["type"];
  if (typeof type !== "string" || !NAMED_TYPES.has(type)) return undefined;
  const user = obj["user"];
  const name = typeof user === "string" ? ctx.users[user]?.username : undefined;
  if (name === undefined) return undefined;
  const { x, y } = center(obj);
  return {
    part: "owner-name",
    kind: "text",
    layer: LAYER.label,
    x,
    y: y + 0.7,
    text: name,
    size: 0.32,
    color: ctx.ownerColor(user),
    stroke: { color: ctx.theme.labelOutline, width: 0.05 },
  };
}
