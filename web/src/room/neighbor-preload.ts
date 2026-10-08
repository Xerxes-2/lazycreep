/**
 * Room View 预加载四个邻居房间的地形、装饰（#61）与房间快照（#63）：切到相邻房间时地形与对象立即出现
 * （地形每次请求约 1.4 秒；实时订阅的第一帧要等服务器下一次广播，1–4 秒）。
 * 不提前订阅邻居——订阅房间是重量级操作；对象先用快照顶着，第一帧到了整体替换。
 * 走 Source 的地形缓存（source/terrain-cache.ts），每个房间每赛季只请求一次，不多耗 room-terrain 的限额；
 * 装饰走装饰缓存（source/decoration-cache.ts），一天一次；快照走快照缓存（source/snapshot-cache.ts），只在内存里留约 10 秒。
 */
import { minimapCells } from "../minimap/minimap-scene.ts";
import { NO_DECORATIONS, type RoomDecorations } from "../source/room-decorations.ts";
import type { RoomSnapshot, Source, WorldSize } from "../source/source.ts";

/** 上、左、右、下（3×3 格里的位置）的相邻房间；世界边缘外的不算 */
const ORTHOGONAL = [
  [1, 0],
  [0, 1],
  [2, 1],
  [1, 2],
] as const;

export function neighborRooms(center: string, size: WorldSize): string[] {
  const cells = minimapCells(center, size);
  return ORTHOGONAL.flatMap(([col, row]) => cells.filter((c) => c.col === col && c.row === row).map((c) => c.room));
}

export interface PreloadOptions {
  /** 同时取快照（默认是）；Replay 期间不取 */
  readonly snapshots?: boolean;
}

/** 逐个在后台取邻居的地形、装饰与快照；`alive()` 变 false（换房间、页面隐藏）就停；任何失败都静默（预加载只是优化），从不拒绝 */
export async function preloadNeighbors(
  source: Source,
  shard: string,
  room: string,
  alive: () => boolean,
  options: PreloadOptions = {},
): Promise<void> {
  try {
    const size = await source.getWorldSize(shard);
    for (const neighbor of neighborRooms(room, size)) {
      if (!alive()) return;
      await Promise.all([
        source.getTerrain(shard, neighbor).catch(() => undefined),
        roomDecorations(source, shard, neighbor),
        options.snapshots === false ? undefined : roomSnapshot(source, shard, neighbor),
      ]);
    }
  } catch {
    // 取不到世界尺寸等：不预加载
  }
}

/** 房间的装饰；失败（含 Source 没有这个方法）时为“没有装饰”，从不拒绝 */
export async function roomDecorations(source: Source, shard: string, room: string): Promise<RoomDecorations> {
  try {
    return await source.getRoomDecorations(shard, room);
  } catch {
    return NO_DECORATIONS;
  }
}

/** 房间快照（#63）；失败（含 Source 没有这个方法）时为 undefined，从不拒绝 */
export async function roomSnapshot(source: Source, shard: string, room: string): Promise<RoomSnapshot | undefined> {
  try {
    return await source.getRoomSnapshot(shard, room);
  } catch {
    return undefined;
  }
}
