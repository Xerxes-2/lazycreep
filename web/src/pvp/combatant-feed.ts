/**
 * PvP Overview 的参战者数据流（#34）：为时间窗内的 PvP 房间订阅 roomMap2，得出各房间的参战玩家。
 *
 * - 订阅集合跟随 PvP feed 的分组（即所选时间窗）：房间离开时间窗即退订；区块折叠 / 不可见（active 为 false）时全部退订
 * - 经全页的 roomMap2 订阅中心订阅（source/room-map-hub.ts）：与地图、告警、Minimap 的同一频道只订阅一次；
 *   总预算由中心执行，PvP 参战者的优先级低于告警与 Minimap、高于 World Map，被截断的房间显示“超出订阅上限”
 * - 本 feed 自己至多要 maxRooms 个（默认 50，最近的优先）：MMO 500 Tick 窗口可有数百个房间，给地图留些预算
 * - 无 token 时 roomMap2 不可订阅：不订阅，各房间为 needsToken
 * - 也记下房间里有哪些 NPC：PvP / PvE 两个列表与地图图例据此分开（pve()）。看到过一帧“有 NPC、玩家至多一个”
 *   就记为 PvE，直到看到两个以上玩家；NPC 被打死后照样记得。记号不随退订丢掉（进 Room View 再回来还在），
 *   房间离开时间窗才丢；只在内存里，刷新页面后重新观察
 * - 全页一份（MapAndRoom 建），World Map 可见时订阅：地图上的 PvE 图例在区块折叠时也要分类
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
  /** npcs：房间里现在有哪些 NPC 的物体（Invader、Source Keeper） */
  | { readonly kind: "ready"; readonly players: readonly Combatant[]; readonly npcs: readonly Npc[] };

export type Npc = "invader" | "keeper";
/** roomMap2 里 NPC 的用户 id */
const NPC_IDS: ReadonlyMap<string, Npc> = new Map([
  ["2", "invader"],
  ["3", "keeper"],
]);

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
  /** 记为 PvE 时给出见过的 NPC（非空），否则 undefined（包括还不知道的房间） */
  pve(shard: string, room: string): readonly Npc[] | undefined;
}

/** 一帧里的玩家（去掉地形 / 道路类键、NPC 与空列表），以及有没有 NPC */
interface RoomFrame {
  readonly players: RoomMapUpdate;
  readonly npcs: readonly Npc[];
}

function frameOf(update: RoomMapUpdate): RoomFrame {
  const players = Object.fromEntries(playerPoints(update));
  const npcs = playerPoints(update, { includeNpc: true }).flatMap(([id]) => {
    const npc = NPC_IDS.get(id);
    return npc ? [npc] : [];
  });
  return { players, npcs };
}

const countsKey = ({ players, npcs }: RoomFrame) =>
  Object.entries(players)
    .map(([id, points]) => `${id}:${points.length}`)
    .sort()
    .join(",") + `|${npcs.join(",")}`;

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

  /** `shard/room` → 最近一帧 */
  const [frames, setFrames] = createSignal<ReadonlyMap<string, RoomFrame>>(new Map());
  const [profiles, setProfiles] = createSignal<ReadonlyMap<string, PlayerProfile>>(new Map());
  /** `shard/room` → 记为 PvE 时见过的 NPC */
  const [pveMarks, setPveMarks] = createSignal<ReadonlyMap<string, readonly Npc[]>>(new Map());

  // 玩家资料：每个 Source 各查一次
  let requested = new Set<string>();
  createEffect(
    on(options.source, () => {
      requested = new Set();
      setFrames(new Map());
      setPveMarks(new Map());
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
        const frame = frameOf(update);
        for (const id of Object.keys(frame.players)) lookUp(id);
        // 看起来是 PvE：有 NPC、玩家至多一个（PvP 接口不区分对手，只能看谁在场；只有一个玩家、没有 NPC 的可能是对手已死光，仍算 PvP）
        const players = Object.keys(frame.players).length;
        setPveMarks((marks) => {
          const seen = marks.get(key);
          if (frame.npcs.length > 0 && players <= 1) {
            const npcs = [...new Set([...(seen ?? []), ...frame.npcs])];
            return seen && npcs.length === seen.length ? marks : new Map(marks).set(key, npcs);
          }
          if (players >= 2 && seen) {
            const next = new Map(marks);
            next.delete(key);
            return next;
          }
          return marks;
        });
        setFrames((all) => {
          const prev = all.get(key);
          if (prev && countsKey(prev) === countsKey(frame)) return all;
          return new Map(all).set(key, frame);
        });
      },
    },
    wanted,
  );

  // 离开时间窗的房间丢掉 PvE 记号
  createEffect(() => {
    const inWindow = new Set((options.groups() ?? []).flatMap((g) => g.rooms.map((r) => roomMapKey(g.shard, r.room))));
    setPveMarks((marks) => ([...marks.keys()].every((key) => inWindow.has(key)) ? marks : new Map([...marks].filter(([key]) => inWindow.has(key)))));
  });

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
      return { kind: "ready", players: combatantsFrom(frame.players, (id) => known.get(id), options.allies()), npcs: frame.npcs };
    },
    pve: (shard, room) => pveMarks().get(roomMapKey(shard, room)),
  };
}
