/**
 * PvP Overview 的参战者（#34）：从一个房间的 roomMap2 帧得出在场玩家与各自的单位数。纯函数。
 *
 * - roomMap2 每帧按用户 id 给出该玩家在房间里的位置点（官方世界地图的小点）；键里另有地形 / 道路类（w、r、pb……）
 *   与 NPC（2 Invader、3 Source Keeper），沿用 Attack Alert 的 NOT_PLAYERS 排除
 * - “单位数”即位置点数：roomMap2 不区分 creep 与建筑，房间所有者的建筑也计在内
 * - 名字与 GCL 来自 Source.getPlayer（user/find）；资料未到时只有 id
 */
import { NOT_PLAYERS } from "../alert/alert-detector.ts";
import type { PlayerProfile, RoomMapUpdate } from "../source/source.ts";

/** 引擎常量（screeps/common lib/constants.js） */
const GCL_POW = 2.4;
const GCL_MULTIPLY = 1_000_000;

/** GCL 点数 → 等级；与引擎 game.js 的 `Math.floor(Math.pow(gcl / GCL_MULTIPLY, 1 / GCL_POW)) + 1` 一致 */
export function gclLevel(points: number): number {
  return Math.floor(Math.pow(Math.max(0, points) / GCL_MULTIPLY, 1 / GCL_POW)) + 1;
}

export interface Combatant {
  readonly id: string;
  /** 资料未到时没有 */
  readonly username?: string;
  /** GCL 等级；资料未到或不带 GCL 时没有 */
  readonly gcl?: number;
  /** 该玩家在房间里的位置点数 */
  readonly units: number;
  /** 在 Ally List 里（按名字，不分大小写） */
  readonly ally: boolean;
}

const byName = new Intl.Collator("en", { numeric: true });

export function combatantsFrom(
  frame: RoomMapUpdate,
  profile: (id: string) => PlayerProfile | undefined,
  allies: ReadonlySet<string>,
): Combatant[] {
  const lowerAllies = new Set([...allies].map((a) => a.toLowerCase()));
  const list: Combatant[] = [];
  for (const [id, points] of Object.entries(frame)) {
    if (NOT_PLAYERS.has(id) || points.length === 0) continue;
    const found = profile(id);
    list.push({
      id,
      ...(found ? { username: found.username } : {}),
      ...(found?.gcl === undefined ? {} : { gcl: gclLevel(found.gcl) }),
      units: points.length,
      ally: found !== undefined && lowerAllies.has(found.username.toLowerCase()),
    });
  }
  return list.sort((a, b) => b.units - a.units || byName.compare(a.username ?? a.id, b.username ?? b.id));
}
