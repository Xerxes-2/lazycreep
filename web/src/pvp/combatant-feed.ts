/**
 * PvP Overview 的参战者数据流（#34）：为时间窗内的 PvP 房间订阅 roomMap2，得出各房间的参战玩家。
 *
 * - 订阅集合跟随 PvP feed 的分组（即所选时间窗）：房间离开时间窗即退订；区块折叠 / 不可见（active 为 false）时全部退订
 * - 经共享 Source 的租约订阅；LiveSource 按监听者计数，与地图、告警、Minimap 的同一频道订阅互不退订
 * - 上限 maxRooms（默认 50，最近的优先）：MMO 500 Tick 窗口可有数百个房间，而同一连接实测只验证到 100 个 roomMap2，
 *   还要给地图（至多 100）与告警留余量
 * - 无 token 时 roomMap2 不可订阅：不订阅，各房间为 needsToken
 * - 玩家资料（名字、GCL）用 Source.getPlayer 查；同一玩家只请求一次（本 feed 记下已请求的，Source 自己也缓存）
 */
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import type { PlayerProfile, RoomMapUpdate, Source, Unsubscribe } from "../source/source.ts";
import { NOT_PLAYERS } from "../alert/alert-detector.ts";
import { combatantsFrom, type Combatant } from "./pvp-combatants.ts";
import type { PvpShardGroup } from "./pvp-overview.ts";

export const MAX_COMBATANT_ROOMS = 50;

export type RoomCombatants =
  /** 没有 token，roomMap2 不可订阅 */
  | { readonly kind: "needsToken" }
  /** 超出订阅上限（或区块不可见）而没有订阅 */
  | { readonly kind: "unwatched" }
  /** 已订阅，还没收到帧 */
  | { readonly kind: "waiting" }
  | { readonly kind: "ready"; readonly players: readonly Combatant[] };

export interface CombatantFeedOptions {
  readonly source: Accessor<Source>;
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

const keyOf = (shard: string, room: string) => `${shard}/${room}`;

/** 帧里只留玩家（去掉地形 / 道路类键、NPC 与空列表） */
function playersOnly(frame: RoomMapUpdate): RoomMapUpdate {
  const out: Record<string, ReadonlyArray<readonly [number, number]>> = {};
  for (const [id, points] of Object.entries(frame)) if (!NOT_PLAYERS.has(id) && points.length > 0) out[id] = points;
  return out;
}

const countsKey = (frame: RoomMapUpdate) =>
  Object.entries(frame)
    .map(([id, points]) => `${id}:${points.length}`)
    .sort()
    .join(",");

export function createCombatantFeed(options: CombatantFeedOptions): CombatantFeed {
  const max = options.maxRooms ?? MAX_COMBATANT_ROOMS;

  /** 想订阅的房间（最近的优先，截到上限） */
  const wanted = createMemo<readonly { shard: string; room: string }[]>(
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
  const wantedKeys = createMemo(() => new Set(wanted().map((r) => keyOf(r.shard, r.room))));

  /** `shard/room` → 最近一帧（只含玩家） */
  const [frames, setFrames] = createSignal<ReadonlyMap<string, RoomMapUpdate>>(new Map());
  const [profiles, setProfiles] = createSignal<ReadonlyMap<string, PlayerProfile>>(new Map());

  createEffect(() => {
    const src = options.source();
    const active = new Map<string, Unsubscribe>();
    const requested = new Set<string>();
    setFrames(new Map());
    setProfiles(new Map());

    const lookUp = (id: string) => {
      if (requested.has(id)) return;
      requested.add(id);
      src.getPlayer(id).then(
        (profile) => {
          if (options.source() === src) setProfiles((all) => new Map(all).set(id, profile));
        },
        () => requested.delete(id),
      );
    };

    const drop = (key: string) => {
      active.get(key)?.();
      active.delete(key);
      setFrames((all) => {
        if (!all.has(key)) return all;
        const next = new Map(all);
        next.delete(key);
        return next;
      });
    };

    createEffect(() => {
      const rooms = wanted();
      untrack(() => {
        const keep = new Set(rooms.map((r) => keyOf(r.shard, r.room)));
        for (const key of [...active.keys()]) if (!keep.has(key)) drop(key);
        for (const { shard, room } of rooms) {
          const key = keyOf(shard, room);
          if (active.has(key)) continue;
          let open = true;
          const off = src.subscribeRoomMap(shard, room, (update) => {
            if (!open) return;
            const players = playersOnly(update);
            for (const id of Object.keys(players)) lookUp(id);
            setFrames((all) => {
              const prev = all.get(key);
              if (prev && countsKey(prev) === countsKey(players)) return all;
              return new Map(all).set(key, players);
            });
          });
          active.set(key, () => {
            open = false;
            off();
          });
        }
      });
    });

    onCleanup(() => {
      for (const key of [...active.keys()]) drop(key);
    });
  });

  return {
    of(shard, room) {
      if (!options.canSubscribe()) return { kind: "needsToken" };
      const key = keyOf(shard, room);
      if (!wantedKeys().has(key)) return { kind: "unwatched" };
      const frame = frames().get(key);
      if (!frame) return { kind: "waiting" };
      const known = profiles();
      return { kind: "ready", players: combatantsFrom(frame, (id) => known.get(id), options.allies()) };
    },
  };
}
