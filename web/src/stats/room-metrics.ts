/**
 * 从 Room View 的 Live 房间状态里取 Session Stats 的房间指标（#65），纯函数。
 *
 * - storage / terminal 里的能量（新格式 `store.energy`，旧格式 `energy`）
 * - controller 升到下一级的进度（%）：Server 不发 progressTotal，按官方表查；8 级没有
 * - 我的 creep 数与敌方 creep 数（含 power creep）：要知道“我”是谁才算；盟友不算敌方，
 *   Source Keeper 常驻在 SK 房间里，不算敌方
 */
import { CONTROLLER_LEVELS } from "../room/official-structures.ts";
import type { RoomObject, RoomState } from "../room/room-state.ts";

export const ROOM_METRICS = ["storage", "terminal", "controller", "mine", "hostile"] as const;
export type RoomMetric = (typeof ROOM_METRICS)[number];

/** Source Keeper 的用户 id */
const SOURCE_KEEPER = "3";

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function energyOf(obj: RoomObject): number | undefined {
  const store = obj["store"];
  if (typeof store === "object" && store !== null) return num((store as Record<string, unknown>)["energy"]) ?? 0;
  return num(obj["energy"]);
}

export interface RoomMetricsInput {
  /** 当前用户 id；不知道时不算我的 / 敌方 creep */
  readonly me: string | undefined;
  /** 盟友玩家名（不分大小写） */
  readonly allies: ReadonlySet<string> | undefined;
}

export function roomMetrics(state: RoomState, { me, allies }: RoomMetricsInput): Partial<Record<RoomMetric, number>> {
  const out: Partial<Record<RoomMetric, number>> = {};
  const allyNames = new Set([...(allies ?? [])].map((name) => name.toLowerCase()));
  let mine = 0;
  let hostile = 0;
  for (const obj of Object.values(state.objects)) {
    const type = obj["type"];
    if (type === "storage" || type === "terminal") {
      const energy = energyOf(obj);
      if (energy !== undefined) out[type] = (out[type] ?? 0) + energy;
    } else if (type === "controller") {
      const level = num(obj["level"]);
      const total = level === undefined ? undefined : CONTROLLER_LEVELS[level];
      if (total) out.controller = ((num(obj["progress"]) ?? 0) / total) * 100;
    } else if ((type === "creep" || type === "powerCreep") && me !== undefined) {
      const user = obj["user"];
      if (user === me) mine++;
      else if (typeof user === "string" && user !== SOURCE_KEEPER) {
        const name = state.users[user]?.username;
        if (name === undefined || !allyNames.has(name.toLowerCase())) hostile++;
      }
    }
  }
  if (me !== undefined) {
    out.mine = mine;
    out.hostile = hostile;
  }
  return out;
}
