/**
 * Room View 的可读性规则（#12）：按玩家着色、按缩放显隐、选中高亮。
 * 由 buildRoomScene 统一套在所有画法之上，画法本身不必关心。
 */
import type { Color } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { RoomUser } from "../source/source.ts";
import { LAYER, center, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

/** 画布上 1 格不足这么多像素时隐藏玩家名与 say 气泡（选中对象除外）。 */
export const LABEL_MIN_ZOOM = 14;

/** 对象主人相对于“我”的归类 */
export type Relation = "me" | "ally" | "stranger" | "none";

export interface OwnerRules {
  /** 当前用户 id；未知时所有玩家都算陌生人 */
  readonly me?: string | undefined;
  /** Ally List：玩家用户名，不分大小写 */
  readonly allies?: ReadonlySet<string> | undefined;
}

export function relationOf(user: unknown, users: Readonly<Record<string, RoomUser>>, rules: OwnerRules): Relation {
  if (typeof user !== "string") return "none";
  if (user === rules.me) return "me";
  const name = users[user]?.username;
  if (name !== undefined && rules.allies && rules.allies.size > 0) {
    const lower = name.toLowerCase();
    for (const ally of rules.allies) if (ally.toLowerCase() === lower) return "ally";
  }
  return "stranger";
}

function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

export function ownerColorRule(
  theme: Theme,
  users: Readonly<Record<string, RoomUser>>,
  rules: OwnerRules,
): (user: unknown) => Color {
  const custom = theme.playerColors ?? {};
  const hasCustom = Object.keys(custom).length > 0;
  return (user) => {
    const relation = relationOf(user, users, rules);
    if (hasCustom && (relation === "ally" || relation === "stranger")) {
      const picked = custom[users[user as string]?.username?.toLowerCase() ?? ""];
      if (picked !== undefined) return picked;
    }
    switch (relation) {
      case "me":
        return theme.owned;
      case "ally":
        return theme.ally;
      case "none":
        return theme.neutral;
      case "stranger":
        if (theme.strangerColoring === "faction") return theme.strangers[0] ?? theme.neutral;
        return theme.strangers[hash(String(user)) % theme.strangers.length] ?? theme.neutral;
    }
  };
}

export function labelsVisible(ctx: PaintContext, objectId: string): boolean {
  return ctx.zoom >= LABEL_MIN_ZOOM || ctx.selectedId === objectId;
}

/** 选中对象的高亮框：框住整格，盖在对象的一切图元之上（RoomVisual 之下）。 */
export function selectionHighlight(obj: RoomObject, ctx: PaintContext): PrimitiveDraft {
  const { x, y } = center(obj);
  const half = 0.55;
  return {
    part: "selected",
    kind: "rect",
    layer: LAYER.label + 1,
    x: x - half,
    y: y - half,
    width: half * 2,
    height: half * 2,
    radius: 0.12,
    stroke: { color: ctx.theme.selection, width: 0.08 },
  };
}
