/**
 * OwnershipHub：一个 Server 上所有 map-stats 用途共用的入口（World Map 的可见区域、PvP Overview 的补查）。
 * 内部只有一个所有权加载器，所以缓存与每小时额度是同一份；取到的结果按 Shard 累积，
 * 任何订阅者（包括后加入的）都能从 stats(shard) 读到已知的房间。
 */
import type { MapStats, Unsubscribe } from "../source/source.ts";
import { createOwnershipLoader, type OwnershipLoader, type OwnershipLoaderOptions } from "./ownership-loader.ts";

export interface OwnershipHub extends OwnershipLoader {
  /** 该 Shard 至今取到的全部房间；还没取过时为 undefined */
  stats(shard: string): MapStats | undefined;
  /** 每次取到结果（或失败）时通知 */
  subscribe(onStats: (stats: MapStats) => void, onError?: (error: unknown) => void): Unsubscribe;
}

export function createOwnershipHub(options: Omit<OwnershipLoaderOptions, "onStats" | "onError">): OwnershipHub {
  const known = new Map<string, MapStats>();
  const listeners = new Set<{ onStats: (stats: MapStats) => void; onError: ((error: unknown) => void) | undefined }>();
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
      for (const listener of [...listeners]) listener.onStats(stats);
    },
    onError: (error) => {
      for (const listener of [...listeners]) listener.onError?.(error);
    },
  });
  return {
    request: loader.request,
    requestRooms: loader.requestRooms,
    dispose: () => {
      listeners.clear();
      loader.dispose();
    },
    stats: (shard) => known.get(shard),
    subscribe(onStats, onError) {
      const entry = { onStats, onError };
      listeners.add(entry);
      return () => void listeners.delete(entry);
    },
  };
}
