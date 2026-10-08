/**
 * Room View 的可读性规则（#12）：按玩家着色、通用进度条、按缩放显隐、选中高亮。
 * 由 buildRoomScene 统一套在所有画法之上，画法本身不必关心。
 */
import type { Color } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { RoomUser } from "../source/source.ts";
import { LAYER, center, hitsFraction, storeFraction, tileBar, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

/** 画布上 1 格不足这么多像素时隐藏血条与资源条（选中对象除外）。 */
export const BAR_MIN_ZOOM = 14;

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

const CREEP_TYPES = new Set(["creep", "powerCreep"]);
/** 不画通用血条的类型：墙与 rampart 血量上限极高，道路受损是常态、画了只添噪音 */
const NO_HITS_BAR = new Set(["constructedWall", "rampart", "road"]);
const BAR_STEP = 0.16;
/** 进度条从格子下沿往上的固定顺序；不在表里的条排在它们之后，保持出现顺序。 */
const BAR_ORDER = ["hits", "store"] as const;

/**
 * 画法没有画的通用进度条：creep 的血条与能量条、受损建筑的血条。
 * 画法已经给出的同名 part 优先。位置统一由 {@link stackBars} 决定。
 */
export function extraBars(obj: RoomObject, drafts: readonly PrimitiveDraft[], ctx: PaintContext): PrimitiveDraft[] {
  const parts = new Set(drafts.map((d) => d.part));
  const type = obj["type"];
  const isCreep = typeof type === "string" && CREEP_TYPES.has(type);
  const out: PrimitiveDraft[] = [];

  const hits = hitsFraction(obj);
  if (!parts.has("hits") && hits !== undefined && !(typeof type === "string" && NO_HITS_BAR.has(type))) {
    if (isCreep || hits < 1) out.push(tileBar(obj, "hits", hits, ctx.theme.hitsBar, ctx));
  }
  const store = storeFraction(obj);
  if (isCreep && !parts.has("store") && store !== undefined) out.push(tileBar(obj, "store", store, ctx.theme.energy, ctx));
  return out;
}

/**
 * 同一对象的进度条按固定顺序叠放：血条贴格子下沿，资源条在它正上方，其余依次往上。
 * 不论条是画法画的还是通用规则补的，顺序都一样；应在显隐过滤之后调用，
 * 这样被隐藏的条不占位置。
 */
export function stackBars(drafts: readonly PrimitiveDraft[]): PrimitiveDraft[] {
  const bars = drafts.filter((d): d is Extract<PrimitiveDraft, { kind: "bar" }> => d.kind === "bar");
  if (bars.length === 0) return [...drafts];
  const base = Math.max(...bars.map((b) => b.y));
  const rank = (part: string) => {
    const i = (BAR_ORDER as readonly string[]).indexOf(part);
    return i === -1 ? BAR_ORDER.length : i;
  };
  const ordered = [...bars].sort((a, b) => rank(a.part) - rank(b.part));
  const slot = new Map(ordered.map((b, i) => [b, base - i * BAR_STEP]));
  return drafts.map((d) => (d.kind === "bar" ? { ...d, y: slot.get(d) ?? d.y } : d));
}

export function barsVisible(ctx: PaintContext, objectId: string): boolean {
  return ctx.zoom >= BAR_MIN_ZOOM || ctx.selectedId === objectId;
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
