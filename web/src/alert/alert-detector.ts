/**
 * Attack Alert 的判定器（#4，ADR 0002）：纯逻辑，时间由调用方传入。
 *
 * 三类触发：
 * - pvp：我的房间出现在 PvP 列表里，且 lastPvpTime 新于该房间上次告警时的值
 * - nuke：有尚未告警过的核弹瞄准我的房间
 * - stranger：非我、非盟友、非 NPC 的玩家在我的房间停留满 strangerTicks（按 roomMap2 帧计，每 Tick 一帧）
 *
 * 同一房间同一原因在冷却窗口内只告警一次；冷却内被压下的事件不作废，冷却过后仍成立就再告警。
 * 冷却与“已告警过什么”记在 AlertMemory 里，由调用方持久化（alert-memory.ts），刷新页面后沿用。
 *
 * 首次打开（记忆里没有该 Shard）：最后战斗早于“第一轮数据里该 Shard 的服务器 Tick − FRESH_PVP_TICKS”
 * 的视为打开前的旧战斗，不告警。之后（包括刷新）以这条基线和已告警的战斗为准，
 * 所以关页期间打过、仍在 PvP 列表里的战斗重新打开时会补报一次。
 */
import type { PvpFeedData, PvpShardGroup } from "../pvp/pvp-overview.ts";
import { playerPoints, type RoomMapUpdate, type UserInfo } from "../source/source.ts";
import { emptyAlertMemory, type AlertMemory } from "./alert-memory.ts";

export type AlertReason = "pvp" | "nuke" | "stranger";

export interface AlertConfig {
  readonly pvp: boolean;
  readonly nuke: boolean;
  readonly stranger: boolean;
  /** 同房间同原因的冷却（分钟，墙钟） */
  readonly cooldownMinutes: number;
  /** 陌生人连续停留多少 Tick 才告警 */
  readonly strangerTicks: number;
}

/**
 * 默认值：
 * - 冷却 15 分钟：一场持续的围攻每 15 分钟告警一次，足够让人知道“还在打”，又不至于刷屏；
 *   PvP 列表每 10 秒一轮，没有冷却会每轮都报
 * - 停留 60 Tick：只有 MOVE 的侦察兵每 Tick 走一格（沼泽也不减速），横穿 50×50 的房间不超过约 50 Tick；
 *   60 Tick 把直线路过排除在外，又能在攻击部队站定后几分钟内报出（赛季服约 3 秒一 Tick）
 */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  pvp: true,
  nuke: true,
  stranger: true,
  cooldownMinutes: 15,
  strangerTicks: 60,
};

/**
 * 首次打开时，最后战斗距当前服务器 Tick 不超过这么多 Tick 的算“正在进行”，照常告警。
 * PvP 列表每 10 秒一轮（赛季服约 3 秒一 Tick），10 Tick 覆盖一轮多的间隔。
 */
export const FRESH_PVP_TICKS = 10;

/** 缺席不超过这么多帧不清零：边界上进进出出的 creep 仍算在场 */
export const ABSENCE_GRACE_TICKS = 5;

export interface AlertContext {
  /** 我的用户 id */
  readonly me: string;
  /** Shard → 我的房间 */
  readonly rooms: ReadonlyMap<string, ReadonlySet<string>>;
  /** Ally List（玩家名，不分大小写） */
  readonly allies: ReadonlySet<string>;
  /** 已知的用户 id → 玩家名 */
  readonly usernames: Readonly<Record<string, string>>;
}

interface AlertBase {
  readonly shard: string;
  readonly room: string;
}

export type Alert =
  | (AlertBase & { readonly reason: "pvp"; readonly lastPvpTime: number })
  | (AlertBase & { readonly reason: "nuke"; readonly landTime: number; readonly launchRoom: string; readonly count: number })
  | (AlertBase & {
      readonly reason: "stranger";
      readonly users: readonly { readonly id: string; readonly username?: string }[];
      /** 停留最久的那位已停留的 Tick 数 */
      readonly ticks: number;
    });

export interface AlertDetector {
  /** 每轮 PvP / 核弹数据到来时调用 */
  feed(data: PvpFeedData, context: AlertContext, config: AlertConfig, now: number): Alert[];
  /** 我的某个房间的一帧 roomMap2 */
  roomMap(shard: string, room: string, frame: RoomMapUpdate, context: AlertContext, config: AlertConfig, now: number): Alert[];
}

interface Presence {
  /** 第一次出现以来的帧数 */
  ticks: number;
  /** 连续缺席的帧数 */
  absent: number;
}

const roomKey = (shard: string, room: string) => `${shard}/${room}`;

function isAlly(context: AlertContext, userId: string): boolean {
  const name = context.usernames[userId]?.toLowerCase();
  if (name === undefined) return false;
  for (const ally of context.allies) if (ally.toLowerCase() === name) return true;
  return false;
}

/** memory 由调用方持有并持久化；判定器就地更新它 */
export function createAlertDetector(memory: AlertMemory = emptyAlertMemory()): AlertDetector {
  const { lastAlert, pvpAlerted, nukesAlerted, watched } = memory;
  /** `shard/room` → 用户 id → 在场情况 */
  const presence = new Map<string, Map<string, Presence>>();

  /** 冷却已过则记下本次并返回 true */
  const take = (shard: string, room: string, reason: AlertReason, config: AlertConfig, now: number) => {
    const key = `${roomKey(shard, room)}/${reason}`;
    const last = lastAlert.get(key);
    if (last !== undefined && now - last < config.cooldownMinutes * 60_000) return false;
    lastAlert.set(key, now);
    return true;
  };

  const mine = (context: AlertContext, shard: string, room: string) => context.rooms.get(shard)?.has(room) ?? false;

  return {
    feed(data, context, config, now) {
      const alerts: Alert[] = [];
      if (config.pvp) {
        for (const shard of data.pvp) {
          // since：这个 Tick 及以前的战斗都算旧的
          const since = watched.get(shard.shard)?.since ?? shard.time - FRESH_PVP_TICKS - 1;
          watched.set(shard.shard, { since, at: now });
          for (const entry of shard.rooms) {
            if (!mine(context, shard.shard, entry.room)) continue;
            const key = roomKey(shard.shard, entry.room);
            if (entry.lastPvpTime <= Math.max(since, pvpAlerted.get(key)?.tick ?? -Infinity)) continue;
            if (!take(shard.shard, entry.room, "pvp", config, now)) continue;
            pvpAlerted.set(key, { tick: entry.lastPvpTime, at: now });
            alerts.push({ shard: shard.shard, room: entry.room, reason: "pvp", lastPvpTime: entry.lastPvpTime });
          }
        }
      }
      if (config.nuke) {
        const times = new Map(data.pvp.map((s) => [s.shard, s.time]));
        const fresh = new Map<string, typeof data.nukes[number][]>();
        for (const nuke of data.nukes) {
          if (nukesAlerted.has(nuke.id) || !mine(context, nuke.shard, nuke.room)) continue;
          if (nuke.landTime <= (times.get(nuke.shard) ?? -Infinity)) continue;
          const key = roomKey(nuke.shard, nuke.room);
          fresh.set(key, [...(fresh.get(key) ?? []), nuke]);
        }
        for (const nukes of fresh.values()) {
          const first = [...nukes].sort((a, b) => a.landTime - b.landTime)[0]!;
          if (!take(first.shard, first.room, "nuke", config, now)) continue;
          for (const nuke of nukes) nukesAlerted.set(nuke.id, now);
          alerts.push({
            shard: first.shard,
            room: first.room,
            reason: "nuke",
            landTime: first.landTime,
            launchRoom: first.launchRoom,
            count: nukes.length,
          });
        }
      }
      return alerts;
    },

    roomMap(shard, room, frame, context, config, now) {
      if (!mine(context, shard, room)) return [];
      const key = roomKey(shard, room);
      const seen = presence.get(key) ?? new Map<string, Presence>();
      presence.set(key, seen);
      for (const [id] of playerPoints(frame)) {
        if (id === context.me) continue;
        const entry = seen.get(id);
        if (entry) {
          entry.ticks += 1;
          entry.absent = 0;
        } else seen.set(id, { ticks: 1, absent: 0 });
      }
      for (const [id, entry] of seen) {
        if ((frame[id]?.length ?? 0) > 0) continue;
        entry.absent += 1;
        entry.ticks += 1;
        if (entry.absent > ABSENCE_GRACE_TICKS) seen.delete(id);
      }
      if (!config.stranger) return [];
      const staying = [...seen]
        .filter(([id, p]) => p.absent === 0 && p.ticks >= config.strangerTicks && !isAlly(context, id))
        .sort((a, b) => b[1].ticks - a[1].ticks);
      if (staying.length === 0 || !take(shard, room, "stranger", config, now)) return [];
      return [
        {
          shard,
          room,
          reason: "stranger",
          users: staying.map(([id]) => {
            const username = context.usernames[id];
            return username === undefined ? { id } : { id, username };
          }),
          ticks: staying[0]![1].ticks,
        },
      ];
    },
  };
}

/**
 * 我的房间：用户信息（各 Shard 的房间，权威）加上所有权数据里归我所有的房间
 * （用户信息定期刷新，中间新占的房间先从所有权缓存里补上）。预定的房间不算。
 */
export function myRoomsFrom(me: UserInfo, groups: readonly PvpShardGroup[] = []): Map<string, Set<string>> {
  const rooms = new Map<string, Set<string>>();
  const add = (shard: string, room: string) => {
    const set = rooms.get(shard) ?? new Set<string>();
    set.add(room);
    rooms.set(shard, set);
  };
  for (const [shard, list] of Object.entries(me.rooms)) for (const room of list) add(shard, room);
  for (const group of groups) {
    for (const entry of group.rooms) {
      if (entry.owner.kind === "owned" && entry.owner.userId === me.id) add(group.shard, entry.room);
    }
  }
  return rooms;
}
