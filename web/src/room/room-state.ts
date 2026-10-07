/**
 * RoomState 归并器：把房间流（WebSocket）或历史 chunk 的 Tick 序列归并成某个 Tick 的完整房间状态。
 * 两者形状一致（首帧全量、后续增量、对象为 null 表示消失），Live 与 Replay 共用这里。
 *
 * 全部是纯函数：不修改输入，未变化的对象沿用旧引用（下游可以按引用判断“没变”）。
 */
import type { RoomObjectPatch, RoomTick, RoomUser } from "../source/source.ts";

/** 归并后的一个房间对象：至少有 `type`、`x`、`y`，其余属性随类型而定。 */
export type RoomObject = Readonly<Record<string, unknown>>;

export interface RoomState {
  /** WebSocket 订阅后的首帧不带 gameTime，此时为 undefined，直到下一帧。 */
  readonly gameTime: number | undefined;
  readonly objects: Readonly<Record<string, RoomObject>>;
  /** 出现过的用户，按 id 索引；只增不减。 */
  readonly users: Readonly<Record<string, RoomUser>>;
  /** 本 Tick 的 RoomVisual 序列化文本（每行一个 JSON 指令）；本 Tick 没画就是空串。 */
  readonly visual: string;
}

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把增量合并进旧值，返回新值：
 * - 增量是普通对象时逐层合并；旧值是数组时按下标打补丁（如 creep 的 `body: {"6": {...}}`）
 * - 增量里的 null 表示删除该属性
 * - 其他值直接替换
 */
function merge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  if (Array.isArray(base)) {
    const next: unknown[] = [...base];
    for (const [key, value] of Object.entries(patch)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) continue;
      if (value === null) delete next[index];
      else next[index] = merge(next[index], value);
    }
    return next.filter((item) => item !== undefined);
  }
  const next: Plain = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = merge(next[key], value);
  }
  return next;
}

function mergeObjects(
  base: Readonly<Record<string, RoomObject>>,
  patches: Readonly<Record<string, RoomObjectPatch | null>>,
): Record<string, RoomObject> {
  const next: Record<string, RoomObject> = { ...base };
  for (const [id, patch] of Object.entries(patches)) {
    if (patch === null) delete next[id];
    else next[id] = merge(next[id], patch) as RoomObject;
  }
  return next;
}

/** 以一帧全量建立状态（WebSocket 首帧，或历史 chunk 的首 Tick）。 */
export function roomStateFrom(tick: RoomTick): RoomState {
  return {
    gameTime: tick.gameTime,
    objects: mergeObjects({}, tick.objects),
    users: { ...tick.users },
    visual: tick.visual ?? "",
  };
}

/** 把一帧增量归并进状态。没带 gameTime 时沿用旧值。 */
export function applyRoomTick(state: RoomState, tick: RoomTick): RoomState {
  return {
    gameTime: tick.gameTime ?? state.gameTime,
    objects: mergeObjects(state.objects, tick.objects),
    users: tick.users ? { ...state.users, ...tick.users } : state.users,
    visual: tick.visual ?? "",
  };
}

/**
 * Live 房间流的归并：没有 gameTime 的帧是订阅（或断线重订阅）后的全量首帧，替换旧状态；
 * 其余帧是增量。全量帧沿用旧的 gameTime，直到下一帧带来新值。
 */
export function reduceLiveTick(state: RoomState | undefined, tick: RoomTick): RoomState {
  if (!state) return roomStateFrom(tick);
  if (tick.gameTime === undefined) return { ...roomStateFrom(tick), gameTime: state.gameTime };
  return applyRoomTick(state, tick);
}

/**
 * Replay 用：按升序的 Tick 序列（首个为全量，如一个历史 chunk）重放到目标 Tick（含）。
 * 目标早于首 Tick 时抛错；晚于末 Tick 时停在末 Tick。
 */
export function roomStateAt(ticks: readonly RoomTick[], target: number): RoomState {
  const [first, ...rest] = ticks;
  if (!first || first.gameTime === undefined || target < first.gameTime) {
    throw new RangeError(`Tick ${target} 不在这段序列里`);
  }
  let state = roomStateFrom(first);
  for (const tick of rest) {
    if (tick.gameTime === undefined || tick.gameTime > target) break;
    state = applyRoomTick(state, tick);
  }
  return state;
}
