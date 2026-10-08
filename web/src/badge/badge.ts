/**
 * Badge（徽章）的数据形状（#43）：房间流的 users、`user/find`、`auth/me`、map-stats 的 users 都带同一形状
 * `{type, color1, color2, color3, param, flip}`（docs/research/official-art-and-badges.md B7）。
 *
 * - type：1–24 的数字，或自定义路径对象 `{path1, path2}`（如 Invader）
 * - color1–3：`#rrggbb`，或历史格式的调色板下标 0–79
 * - param：-100..100（自定义路径可以没有，按 0）；flip：布尔
 *
 * 徽章按 Server 分别存储：同一玩家在 MMO 与赛季服可以不同，所以徽章总是随它所在的 Source 走。
 */

export interface CustomBadgePaths {
  readonly path1: string;
  readonly path2?: string;
}

/** 颜色：`#rrggbb` 或调色板下标（0–79） */
export type BadgeColor = string | number;

export interface Badge {
  readonly type: number | CustomBadgePaths;
  readonly color1: BadgeColor;
  readonly color2: BadgeColor;
  readonly color3: BadgeColor;
  readonly param: number;
  readonly flip: boolean;
}

export const BADGE_TYPES = 24;
export const BADGE_PALETTE_SIZE = 80;

const HEX = /^#[0-9a-f]{6}$/i;
/** SVG path 数据只含命令字母、数字与分隔符；其余字符一律拒绝（徽章最终拼进 SVG 文本） */
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function color(v: unknown): BadgeColor | undefined {
  if (typeof v === "string") return HEX.test(v) ? v : undefined;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v < BADGE_PALETTE_SIZE ? v : undefined;
  return undefined;
}

function type(v: unknown): Badge["type"] | undefined {
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= BADGE_TYPES ? v : undefined;
  if (!isRecord(v) || typeof v.path1 !== "string" || !PATH.test(v.path1)) return undefined;
  if (v.path2 === undefined) return { path1: v.path1 };
  return typeof v.path2 === "string" && PATH.test(v.path2) ? { path1: v.path1, path2: v.path2 } : undefined;
}

/** 从接口数据读出徽章；没有徽章（如 Source Keeper）或不合法时为 undefined。 */
export function parseBadge(raw: unknown): Badge | undefined {
  if (!isRecord(raw)) return undefined;
  const t = type(raw.type);
  const c1 = color(raw.color1);
  const c2 = color(raw.color2);
  const c3 = color(raw.color3);
  if (t === undefined || c1 === undefined || c2 === undefined || c3 === undefined) return undefined;
  const param = typeof raw.param === "number" && Number.isFinite(raw.param) ? Math.max(-100, Math.min(100, raw.param)) : 0;
  return { type: t, color1: c1, color2: c2, color3: c3, param, flip: raw.flip === true };
}

/** 徽章内容的稳定键（缓存用）：同一内容同一键 */
export function badgeKey(badge: Badge): string {
  const t = typeof badge.type === "number" ? badge.type : [badge.type.path1, badge.type.path2 ?? ""];
  return JSON.stringify([t, badge.color1, badge.color2, badge.color3, badge.param, badge.flip]);
}
