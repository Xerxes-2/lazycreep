/**
 * PvP Overview 的聚合器（#3）：把 PvP 列表、核弹列表与所有权缓存合成按 Shard 分组的视图数据。纯函数。
 *
 * - PvP 接口一次返回所有 Shard；轮询时总按最大窗口（PVP_FETCH_INTERVAL）取，切换时间窗只在本地过滤，不多发请求
 * - 接口声称按 lastPvpTime 降序，但实测 MMO shard3 是升序（2026-10-08），所以这里自己排
 * - 所有者来自 World Map 的所有权缓存（map-stats）；缓存里没有的房间为 unknown，不阻塞列表
 */
import { roomOwnership, type MapStats, type Nuke, type PvpShard } from "../source/source.ts";

/** 可切换的时间窗（Tick） */
export const PVP_WINDOWS = [20, 100, 500] as const;
export type PvpWindow = (typeof PVP_WINDOWS)[number];
export const DEFAULT_PVP_WINDOW: PvpWindow = 100;
/** 轮询时向接口要的窗口：最大的那个，本地再按所选窗口过滤 */
export const PVP_FETCH_INTERVAL: number = Math.max(...PVP_WINDOWS);

/**
 * “回看这场战斗”从最后战斗 Tick 往前多少 Tick 开始。
 * lastPvpTime 是最后一次交火，不是开始；50 Tick（半个历史 chunk）能看到收尾阶段的来龙去脉，
 * 又通常与 lastPvpTime 落在同一或相邻 chunk 里（Replay 会预取相邻 chunk），往前拖动也方便。
 */
export const REPLAY_LEAD_TICKS = 50;

export function battleReplayTick(lastPvpTime: number): number {
  return Math.max(0, lastPvpTime - REPLAY_LEAD_TICKS);
}

export interface PvpFeedData {
  readonly pvp: readonly PvpShard[];
  readonly nukes: readonly Nuke[];
}

/** 某 Shard 的所有权缓存（map-stats 的累积结果）；没查过任何房间时为 undefined。 */
export type OwnershipLookup = (shard: string) => Pick<MapStats, "rooms" | "users"> | undefined;

export type RoomOwner =
  /** 缓存里没有这个房间 */
  | { readonly kind: "unknown" }
  /** 查过，无主 */
  | { readonly kind: "none" }
  | {
      readonly kind: "owned" | "reserved";
      readonly userId: string;
      readonly username?: string;
      /** 0 为预定，1–8 为 RCL */
      readonly level: number;
    };

export interface PvpRoomEntry {
  readonly room: string;
  readonly lastPvpTime: number;
  /** 距该 Shard 当前 Tick 多少 Tick */
  readonly ago: number;
  readonly owner: RoomOwner;
}

export interface NukeEntry extends Nuke {
  /** 还有多少 Tick 落地；该 Shard 的当前 Tick 未知时为 undefined */
  readonly landsIn: number | undefined;
}

export interface PvpShardGroup {
  readonly shard: string;
  /** 该 Shard 的当前 Tick（PvP 接口给出）；只出现在核弹列表里的 Shard 为 undefined */
  readonly time: number | undefined;
  /** 窗口内的房间，最近的在前 */
  readonly rooms: readonly PvpRoomEntry[];
  /** 飞行中的核弹，先落地的在前 */
  readonly nukes: readonly NukeEntry[];
}

const byName = new Intl.Collator("en", { numeric: true });

function ownerOf(stats: Pick<MapStats, "rooms" | "users"> | undefined, room: string): RoomOwner {
  const entry = stats?.rooms[room];
  if (!entry) return { kind: "unknown" };
  const owner = roomOwnership(entry);
  if (owner.kind === "none") return { kind: "none" };
  const username = stats!.users[owner.user]?.username;
  return {
    kind: owner.kind,
    userId: owner.user,
    ...(username === undefined ? {} : { username }),
    level: owner.kind === "owned" ? owner.level : 0,
  };
}

export function aggregatePvp(data: PvpFeedData, window: number, ownership?: OwnershipLookup): PvpShardGroup[] {
  const times = new Map<string, number>();
  const rooms = new Map<string, PvpRoomEntry[]>();
  for (const shard of data.pvp) {
    times.set(shard.shard, shard.time);
    const stats = ownership?.(shard.shard);
    rooms.set(
      shard.shard,
      shard.rooms
        .filter((r) => shard.time - r.lastPvpTime <= window)
        .map((r) => ({ room: r.room, lastPvpTime: r.lastPvpTime, ago: shard.time - r.lastPvpTime, owner: ownerOf(stats, r.room) }))
        .sort((a, b) => b.lastPvpTime - a.lastPvpTime || byName.compare(a.room, b.room)),
    );
  }
  const nukes = new Map<string, NukeEntry[]>();
  for (const nuke of data.nukes) {
    const time = times.get(nuke.shard);
    if (time !== undefined && nuke.landTime <= time) continue;
    const list = nukes.get(nuke.shard) ?? [];
    list.push({ ...nuke, landsIn: time === undefined ? undefined : nuke.landTime - time });
    nukes.set(nuke.shard, list);
  }
  const shards = [...new Set([...times.keys(), ...nukes.keys()])].sort(byName.compare);
  return shards.map((shard) => ({
    shard,
    time: times.get(shard),
    rooms: rooms.get(shard) ?? [],
    nukes: (nukes.get(shard) ?? []).sort((a, b) => a.landTime - b.landTime || byName.compare(a.id, b.id)),
  }));
}
