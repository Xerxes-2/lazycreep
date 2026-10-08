/**
 * 移动补间（Movement Tween，ADR 0008）与“整个对象一起动”的位移动画。照官方渲染器（screeps/renderer，ISC）
 * `creep.metadata.js` / `powerCreep.metadata.js` 的 moveTo（easeInOutQuad 用满 td）与 rotateTo（0.2td）。
 *
 * 两部分：
 * - **对象位移（ObjectMotion）**：一组 `offsetX` / `offsetY` tween，加到一个对象的**所有**图元上——画法的图元、
 *   选中框、玩家名、say 气泡（key `<id>/…`），以及它的发光（`lighting/<id>/…`）。动作效果（`action/<id>/…`）
 *   不在内：光束从移动前的格子出发、不随 creep 动，群体远程攻击的圆环自带滑动（action-animation.ts）。
 *   由 buildRoomScene 在最后统一附加（{@link applyObjectMotions}），画法不必各写一遍。移动补间是第一个来源；
 *   冲撞（#58）也是整个 creep 的位移，往 {@link objectMotions} 的结果里加条目即可。
 * - **朝向（Facings）**：creep 身体的朝向（顺时针弧度，0 = 朝上），官方由上一个位置算出、不移动时保持。
 *   Scene 构建是纯函数，所以朝向的记忆由调用方（RoomView）沿 Tick 传下去：{@link nextFacings}。
 */
import type { Primitive, Tween } from "../scene/scene.ts";
import { num, type AnimationContext } from "./room-paint.ts";
import type { RoomObject, RoomState } from "./room-state.ts";

/** 会移动的对象类型（官方有 moveTo 的） */
const MOVING_TYPES: ReadonlySet<unknown> = new Set(["creep", "powerCreep"]);

/** 身体转向占 Tick 间隔的比例（官方 rotateTo 的 koef 0.2） */
export const FACING_TURN = 0.2;

/** 对象 id → 朝向（顺时针弧度，0 = 朝上，(-π, π]） */
export type Facings = ReadonlyMap<string, number>;

/**
 * “本 Tick 移动了”的唯一判定（移动补间、动作的起点共用）：creep / powerCreep 从上一个状态走了恰好一格时的位移
 * （新格 − 旧格）；没有上一个位置（刚出现）、没动或位移超过 1 格（跨出口等）时 undefined
 */
export function stepOf(previous: RoomObject | undefined, obj: RoomObject): { readonly dx: number; readonly dy: number } | undefined {
  if (!MOVING_TYPES.has(obj["type"]) || !previous || previous["type"] !== obj["type"]) return undefined;
  const x = num(obj, "x"), y = num(obj, "y"), px = num(previous, "x"), py = num(previous, "y");
  if (x === undefined || y === undefined || px === undefined || py === undefined) return undefined;
  const dx = x - px, dy = y - py;
  if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return undefined;
  return { dx, dy };
}

/** 朝 (dx, dy) 的朝向（官方 mathHelper.calculateAngle） */
export function facingOf(dx: number, dy: number): number {
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle > Math.PI) angle -= 2 * Math.PI;
  else if (angle <= -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * 本 Tick 的朝向：走了一格的转向移动方向，其余沿用 before（没有记录就是朝上，不写进结果）。
 * 不在 state 里的对象被丢掉。没有上一个状态时原样沿用 before。
 */
export function nextFacings(before: Facings | undefined, previous: RoomState | undefined, state: RoomState): Facings {
  const out = new Map<string, number>();
  for (const [id, obj] of Object.entries(state.objects)) {
    if (!MOVING_TYPES.has(obj["type"])) continue;
    const step = stepOf(previous?.objects[id], obj);
    const facing = step ? facingOf(step.dx, step.dy) : before?.get(id);
    if (facing !== undefined && facing !== 0) out.set(id, facing);
  }
  return out;
}

/** 对象 id → 加到它所有图元上的位移 tween（只用 `offsetX` / `offsetY`） */
export type ObjectMotions = Map<string, readonly Tween[]>;

/** 本 Tick 的对象位移：走了一格的 creep / powerCreep 从旧格补间到新格 */
export function objectMotions(state: RoomState, anim: AnimationContext): ObjectMotions {
  const motions: ObjectMotions = new Map();
  for (const [id, obj] of Object.entries(state.objects)) {
    const step = stepOf(anim.previous.objects[id], obj);
    if (!step) continue;
    const steps = [{ duration: anim.tickMs, easing: "easeInOutQuad" as const }];
    motions.set(id, [
      { property: "offsetX", from: 0 - step.dx, steps },
      { property: "offsetY", from: 0 - step.dy, steps },
    ]);
  }
  return motions;
}

/** 图元属于哪个对象：objectId，或发光的 key（`lighting/<id>/…`，不参与点选、不带 objectId） */
function motionOwner(p: Primitive): string | undefined {
  if (p.objectId !== undefined) return p.objectId;
  const match = /^lighting\/([^/]+)\//.exec(p.key);
  return match?.[1];
}

/**
 * 把对象位移加到它的每个图元上：图元已有本 Tick 的动画（如身体的转向）时并进同一份 tweens，否则新建。
 * 转向绕终态的中心转，位移叠加在转向之后，所以二者可以同时进行。
 */
export function applyObjectMotions(primitives: readonly Primitive[], motions: ObjectMotions, anim: AnimationContext): Primitive[] {
  if (motions.size === 0) return [...primitives];
  return primitives.map((p) => {
    const owner = motionOwner(p);
    const tweens = owner === undefined ? undefined : motions.get(owner);
    if (!tweens) return p;
    const animation = p.animation
      ? { ...p.animation, tweens: [...p.animation.tweens, ...tweens] }
      : { id: anim.tick, tweens };
    return { ...p, animation };
  });
}
