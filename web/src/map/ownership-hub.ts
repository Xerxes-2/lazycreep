/**
 * OwnershipHub：一个 Server 上所有 map-stats 用途共用的入口（World Map 的可见区域、Battle Overview 的补查）。
 * 内部只有一个所有权加载器，所以缓存与每小时额度是同一份；取到的结果按 Shard 累积，
 * 任何订阅者（包括后加入的）都能从 stats(shard) 读到已知的房间。
 *
 * 按房间补查有两种入口，提交给加载器的是两者的并集：requestRooms 是一份“替换式”清单（Battle Overview）；
 * wantRooms 是可以并存的认领，各用途（Minimap 等）各拿一份、用完释放，彼此不会顶掉。
 *
 * map-stats 有限额，缓存要几分钟到一小时才重取；Room View 实际看到的房间（当前房间的房间流、邻居快照）
 * 经 observe 直接改写那个房间的所有者与 RCL，地图与 Minimap 不必等下一次 map-stats。
 */
import type { MapStats, RoomObjectPatch, RoomStats, RoomUser, Unsubscribe } from "../source/source.ts";
import {
  createOwnershipLoader,
  type OwnershipLoader,
  type OwnershipLoaderOptions,
  type RoomRef,
} from "./ownership-loader.ts";

export interface OwnershipHub extends OwnershipLoader {
  /** 该 Shard 至今取到的全部房间；还没取过时为 undefined */
  stats(shard: string): MapStats | undefined;
  /** 每次取到结果（或失败）时通知 */
  subscribe(onStats: (stats: MapStats) => void, onError?: (error: unknown) => void): Unsubscribe;
  /** 认领一份要补查的房间清单，与其他认领及 requestRooms 并存；返回释放函数 */
  wantRooms(rooms: readonly RoomRef[]): Unsubscribe;
  /** 看到了房间的全部对象（房间流或快照）：按其中的 controller 更新所有者与 RCL；有变化才通知 */
  observe(shard: string, room: string, seen: ObservedRoom): void;
}

export interface ObservedRoom {
  readonly objects: Readonly<Record<string, RoomObjectPatch | null>>;
  readonly users: Readonly<Record<string, RoomUser>>;
}

/**
 * 房间对象里 controller 的所有者，形状同 map-stats（level 0 为预定）。
 * 没有 controller 的房间（过道、中心房间）返回 null：看不出所有权，不改写。
 */
export function observedOwner(objects: ObservedRoom["objects"]): { owner: RoomStats["owner"] } | null {
  for (const obj of Object.values(objects)) {
    if (!obj || obj["type"] !== "controller") continue;
    const user = obj["user"];
    const level = obj["level"];
    if (typeof user === "string" && user && typeof level === "number" && level > 0) return { owner: { user, level } };
    const reservation = obj["reservation"];
    const reserver =
      typeof reservation === "object" && reservation !== null ? (reservation as Record<string, unknown>)["user"] : undefined;
    return { owner: typeof reserver === "string" && reserver ? { user: reserver, level: 0 } : undefined };
  }
  return null;
}

export function createOwnershipHub(options: Omit<OwnershipLoaderOptions, "onStats" | "onError">): OwnershipHub {
  const known = new Map<string, MapStats>();
  const listeners = new Set<{ onStats: (stats: MapStats) => void; onError: ((error: unknown) => void) | undefined }>();
  const notify = (stats: MapStats) => {
    for (const listener of [...listeners]) listener.onStats(stats);
  };
  const loader = createOwnershipLoader({
    ...options,
    onStats: (stats) => {
      const previous = known.get(stats.shard);
      known.set(
        stats.shard,
        previous
          ? {
              shard: stats.shard,
              gameTime: Math.max(previous.gameTime, stats.gameTime),
              rooms: { ...previous.rooms, ...stats.rooms },
              users: { ...previous.users, ...stats.users },
            }
          : stats,
      );
      notify(stats);
    },
    onError: (error) => {
      for (const listener of [...listeners]) listener.onError?.(error);
    },
  });
  let replaced: readonly RoomRef[] = [];
  const claims = new Set<{ rooms: readonly RoomRef[] }>();
  const submit = () => loader.requestRooms([...replaced, ...[...claims].flatMap((c) => c.rooms)]);
  return {
    request: loader.request,
    requestRooms(rooms) {
      replaced = rooms;
      submit();
    },
    wantRooms(rooms) {
      const claim = { rooms };
      claims.add(claim);
      submit();
      return () => {
        if (claims.delete(claim)) submit();
      };
    },
    dispose: () => {
      listeners.clear();
      loader.dispose();
    },
    observe(shard, room, seen) {
      const found = observedOwner(seen.objects);
      if (!found) return;
      const previous = known.get(shard);
      const before = previous?.rooms[room];
      const owner = found.owner;
      if (before?.owner?.user === owner?.user && before?.owner?.level === owner?.level) return;
      const { owner: _, ...rest } = before ?? { status: "normal" };
      const merged: RoomStats = owner ? { ...rest, owner } : rest;
      const user = owner && seen.users[owner.user];
      const users = user ? { [owner.user]: user } : {};
      const update: MapStats = { shard, gameTime: previous?.gameTime ?? 0, rooms: { [room]: merged }, users };
      known.set(shard, {
        shard,
        gameTime: update.gameTime,
        rooms: { ...previous?.rooms, [room]: merged },
        users: { ...previous?.users, ...users },
      });
      notify(update);
    },
    stats: (shard) => known.get(shard),
    subscribe(onStats, onError) {
      const entry = { onStats, onError };
      listeners.add(entry);
      return () => void listeners.delete(entry);
    },
  };
}
