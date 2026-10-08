/**
 * PvP Overview 的参战者数据流（#34）：为时间窗内的 PvP 房间订阅 roomMap2，得出各房间的参战玩家。
 *
 * - 订阅集合跟随 PvP feed 的分组（即所选时间窗）：房间离开时间窗即退订；区块折叠 / 不可见（active 为 false）时全部退订
 * - 经全页的 roomMap2 订阅中心订阅（source/room-map-hub.ts）：与地图、告警、Minimap 的同一频道只订阅一次；
 *   总预算由中心执行，PvP 参战者的优先级低于告警与 Minimap、高于 World Map，被截断的房间显示“超出订阅上限”
 * - 本 feed 自己至多要 maxRooms 个（默认 50，最近的优先）：MMO 500 Tick 窗口可有数百个房间，给地图留些预算
 * - 无 token 时 roomMap2 不可订阅：不订阅，各房间为 needsToken
 * - 玩家资料（名字、GCL）用 Source.getPlayer 查；同一玩家只请求一次（本 feed 记下已请求的，Source 自己也缓存）
 */
import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { playerPoints, type PlayerProfile, type RoomMapUpdate, type Source } from "../source/source.ts";
import { ROOM_MAP_PRIORITY, roomMapKey, useRoomMapLease, type RoomMapHub, type RoomRef } from "../source/room-map-hub.ts";
import { combatantsFrom, type Combatant } from "./pvp-combatants.ts";
import type { PvpShardGroup } from "./pvp-overview.ts";

export const MAX_COMBATANT_ROOMS = 50;

export type RoomCombatants =
  /** 没有 token，roomMap2 不可订阅 */
  | { readonly kind: "needsToken" }
  /** 超出订阅上限（本 feed 的 maxRooms 或订阅中心的总预算）或区块不可见而没有订阅 */
  | { readonly kind: "unwatched" }
  /** 已订阅，还没收到帧 */
  | { readonly kind: "waiting" }
  | { readonly kind: "ready"; readonly players: readonly Combatant[] };

export interface CombatantFeedOptions {
  readonly source: Accessor<Source>;
  /** 全页共用的 roomMap2 订阅中心 */
  readonly roomMaps: Accessor<RoomMapHub>;
  /** PvP feed 按所选时间窗聚合的分组 */
  readonly groups: Accessor<readonly PvpShardGroup[] | undefined>;
  /** 区块是否在屏幕上；false 时不订阅 */
  readonly active: Accessor<boolean>;
  /** 有 token 才能订阅 roomMap2 */
  readonly canSubscribe: Accessor<boolean>;
  readonly allies: Accessor<ReadonlySet<string>>;
  readonly maxRooms?: number;
}

export interface CombatantFeed {
  of(shard: string, room: string): RoomCombatants;
}

/** 帧里只留玩家（去掉地形 / 道路类键、NPC 与空列表） */
function playersOnly(frame: RoomMapUpdate): RoomMapUpdate {
  return Object.fromEntries(playerPoints(frame));
}

const countsKey = (frame: RoomMapUpdate) =>
  Object.entries(frame)
    .map(([id, points]) => `${id}:${points.length}`)
    .sort()
    .join(",");

export function createCombatantFeed(options: CombatantFeedOptions): CombatantFeed {
  const max = options.maxRooms ?? MAX_COMBATANT_ROOMS;

  /** 想订阅的房间（最近的优先，截到上限） */
  const wanted = createMemo<readonly RoomRef[]>(
    () => {
      if (!options.canSubscribe() || !options.active()) return [];
      return (options.groups() ?? [])
        .flatMap((g) => g.rooms.map((r) => ({ shard: g.shard, room: r.room, ago: r.ago })))
        .sort((a, b) => a.ago - b.ago)
        .slice(0, max)
        .map(({ shard, room }) => ({ shard, room }));
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((r, i) => r.shard === b[i]!.shard && r.room === b[i]!.room) },
  );

  /** `shard/room` → 最近一帧（只含玩家） */
  const [frames, setFrames] = createSignal<ReadonlyMap<string, RoomMapUpdate>>(new Map());
  const [profiles, setProfiles] = createSignal<ReadonlyMap<string, PlayerProfile>>(new Map());

  // 玩家资料：每个 Source 各查一次
  let requested = new Set<string>();
  createEffect(
    on(options.source, () => {
      requested = new Set();
      setFrames(new Map());
      setProfiles(new Map());
    }),
  );
  const lookUp = (id: string) => {
    if (requested.has(id)) return;
    const asked = requested;
    asked.add(id);
    const src = options.source();
    src.getPlayer(id).then(
      (profile) => {
        if (options.source() === src) setProfiles((all) => new Map(all).set(id, profile));
      },
      () => asked.delete(id),
    );
  };

  const granted = useRoomMapLease(
    options.roomMaps,
    {
      priority: ROOM_MAP_PRIORITY.pvp,
      onFrame: (shard, room, update) => {
        const key = roomMapKey(shard, room);
        const players = playersOnly(update);
        for (const id of Object.keys(players)) lookUp(id);
        setFrames((all) => {
          const prev = all.get(key);
          if (prev && countsKey(prev) === countsKey(players)) return all;
          return new Map(all).set(key, players);
        });
      },
    },
    wanted,
  );

  // 不再订阅的房间丢掉旧帧（再订阅时重新等帧）
  createEffect(() => {
    const keep = granted();
    setFrames((all) => {
      if ([...all.keys()].every((key) => keep.has(key))) return all;
      return new Map([...all].filter(([key]) => keep.has(key)));
    });
  });

  return {
    of(shard, room) {
      if (!options.canSubscribe()) return { kind: "needsToken" };
      const key = roomMapKey(shard, room);
      if (!granted().has(key)) return { kind: "unwatched" };
      const frame = frames().get(key);
      if (!frame) return { kind: "waiting" };
      const known = profiles();
      return { kind: "ready", players: combatantsFrom(frame, (id) => known.get(id), options.allies()) };
    },
  };
}
