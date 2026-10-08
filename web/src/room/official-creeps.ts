/**
 * 官方画风的 creep 与 powerCreep（#48，ADR 0006）。照官方渲染器改写成静态图元（screeps/renderer，ISC，
 * commit a2db4a7：`metadata/src/objects/creep.metadata.js`、`powerCreep.metadata.js`、
 * `engine/src/lib/processors/creepBuildBody.js`）；移动补间、转向、creepActions 射线与 lighting 都不做，
 * 所以 creep 总是朝上（官方的 rotation 由上一 Tick 的位置算出，我们不追踪）。
 *
 * 身体部件环（creepBuildBody）：
 * - 只算 HP > 0 的部件，carry 与 tough 不进环；同类部件的 HP 相加成一段，各段按总 HP 从少到多排。
 * - 每 100 HP 在左右各占 π/50（50 个满血部件恰好一整圈），受伤部件按比例缩短，0 HP 的部件不画。
 * - move 画在背面，从正下方往两边排；其余从正上方往两边排；左右对称。
 * - 至少一个 tough 存活时叠一张 tough 贴图（120 单位）。
 * - boost 不改变画法（官方也不看 boost）。
 *
 * 中心依次是黑色圆、主人徽章（{@link ownerBadge}，半径 26）、按装载量缩放的资源圆（能量黄、power 红、
 * 其余白）。NPC（Invader `2`、Source Keeper `3`）只有一张 creep-npc 贴图。
 */
import type { Color } from "../scene/scene.ts";
import { LAYER, center, num, type ObjectPainter, type ObjectPainters, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";
import { ownerBadge } from "./owner-badge.ts";
import { circle as disc, officialSprite, u } from "./official-sprite.ts";

/** 官方 zIndex 在 creep 层内微调 */
const creepLayer = (zIndex: number) => LAYER.creep + zIndex / 100;

const isNpc = (user: unknown) => user === "2" || user === "3";

// ---- 身体部件环 ----
const RING_OUTER = 50;
const RING_WIDTH = 18;
const MAX_PART_HITS = 100;
/** 每 100 HP 在一侧占的圆心角 */
const PART_ANGLE = Math.PI / 50;
/** 弧线细分：每段不超过 5° */
const ARC_STEP = Math.PI / 36;

const BODY_COLORS: Readonly<Record<string, { readonly color: Color; readonly back?: true }>> = {
  move: { color: 0xaab7c5, back: true },
  work: { color: 0xfde574 },
  attack: { color: 0xf72e41 },
  ranged_attack: { color: 0x7fa7e5 },
  heal: { color: 0x56cf5e },
  claim: { color: 0xb99cfb },
};

interface BodyPart {
  readonly type: string;
  readonly hits: number;
}

/** body 可能是数组或 `{ "0": {...} }`（官方 safeBody） */
function bodyOf(obj: RoomObject): BodyPart[] {
  const raw = obj["body"];
  if (typeof raw !== "object" || raw === null) return [];
  const list = Array.isArray(raw) ? raw : Object.keys(raw).sort().map((k) => (raw as Record<string, unknown>)[k]);
  const parts: BodyPart[] = [];
  for (const p of list) {
    if (typeof p !== "object" || p === null) continue;
    const { type, hits } = p as Record<string, unknown>;
    if (typeof type === "string" && typeof hits === "number" && Number.isFinite(hits)) parts.push({ type, hits });
  }
  return parts;
}

/** 以 (cx, cy) 为圆心的环形扇区；角度 0 = 正上方，顺时针为正 */
function annularSector(cx: number, cy: number, inner: number, outer: number, from: number, to: number): number[] {
  const steps = Math.max(1, Math.ceil((to - from) / ARC_STEP));
  const at = (i: number) => from + ((to - from) * i) / steps;
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) points.push(cx + outer * Math.sin(at(i)), cy - outer * Math.cos(at(i)));
  for (let i = steps; i >= 0; i--) points.push(cx + inner * Math.sin(at(i)), cy - inner * Math.cos(at(i)));
  return points;
}

function bodyRing(obj: RoomObject, layer: number): PrimitiveDraft[] {
  const totals = new Map<string, number>();
  for (const { type, hits } of bodyOf(obj)) {
    if (type === "tough" || type === "carry" || hits <= 0) continue;
    totals.set(type, (totals.get(type) ?? 0) + hits);
  }
  const ordered = [...totals].sort((a, b) => a[1] - b[1]);
  const { x, y } = center(obj);
  const outer = u(RING_OUTER);
  const inner = u(RING_OUTER - RING_WIDTH);
  let front = 0;
  let back = Math.PI;
  const prims: PrimitiveDraft[] = [];
  for (const [type, hits] of ordered) {
    const spec = BODY_COLORS[type];
    if (!spec) continue;
    const start = spec.back ? back : front;
    const angle = PART_ANGLE * (hits / MAX_PART_HITS);
    prims.push(
      { part: `ring-${type}-r`, kind: "polygon", layer, points: annularSector(x, y, inner, outer, start, start + angle), fill: spec.color },
      { part: `ring-${type}-l`, kind: "polygon", layer, points: annularSector(x, y, inner, outer, -(start + angle), -start), fill: spec.color },
    );
    if (spec.back) back += angle;
    else front += angle;
  }
  return prims;
}

// ---- creep ----
const STORE_RADIUS = 20;

function storeCircles(obj: RoomObject, layer: number): PrimitiveDraft[] {
  const store = (typeof obj["store"] === "object" && obj["store"] !== null ? obj["store"] : {}) as Record<string, unknown>;
  const capacity = num(obj, "storeCapacity");
  if (!capacity) return [];
  let total = 0;
  for (const v of Object.values(store)) if (typeof v === "number") total += v;
  const amount = (key: string) => (typeof store[key] === "number" ? (store[key] as number) : 0);
  const energy = amount("energy");
  const power = amount("power");
  const radius = (value: number) => Math.min(1, value / capacity) * STORE_RADIUS;
  const prims: PrimitiveDraft[] = [];
  if (total > 0 && energy + power < total) prims.push(disc(obj, "store-other", radius(total), 0xffffff, layer));
  if (power > 0) prims.push(disc(obj, "store-power", radius(energy + power), 0xf41f33, layer));
  if (energy > 0) prims.push(disc(obj, "store-energy", radius(energy), 0xffe56d, layer));
  return prims;
}

const creep: ObjectPainter = (obj, ctx) => {
  const layer = creepLayer(6);
  if (isNpc(obj["user"])) return [officialSprite(obj, "body", "creep-npc", { width: 100, layer })];
  const toughAlive = bodyOf(obj).some((p) => p.type === "tough" && p.hits > 0);
  return [
    disc(obj, "base", 50, 0x202020, layer),
    ...bodyRing(obj, layer),
    ...(toughAlive ? [officialSprite(obj, "tough", "tough", { width: 120, layer })] : []),
    disc(obj, "core", 32, 0x000000, layer),
    ...ownerBadge(obj, ctx, { radius: 26, layer, minZoom: true }),
    ...storeCircles(obj, layer),
  ];
};

// ---- powerCreep（powerCreep.metadata.js：按职业与等级的贴图 + 偏上的方形徽章） ----
const POWER_CLASSES = {
  operator: { size: 63, top: 15 },
  commander: { size: 65, top: 30 },
  executor: { size: 45, top: 30 },
} as const;
type PowerClass = keyof typeof POWER_CLASSES;

const powerCreep: ObjectPainter = (obj, ctx) => {
  const layer = creepLayer(13);
  const raw = obj["className"];
  const className: PowerClass = typeof raw === "string" && Object.hasOwn(POWER_CLASSES, raw) ? (raw as PowerClass) : "operator";
  const tier = Math.max(0, Math.min(4, Math.ceil((num(obj, "level") ?? 0) / 6))) as 0 | 1 | 2 | 3 | 4;
  return [
    officialSprite(obj, "body", `${className}-lvl${tier}`, { width: 180, layer, tint: 0xcc3d3e }),
    ...ownerBadge(obj, ctx, { radius: 26, layer, minZoom: true, box: POWER_CLASSES[className] }),
  ];
};

export const OFFICIAL_CREEP_PAINTERS: ObjectPainters = { creep, powerCreep };
