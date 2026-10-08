/**
 * Room View 预加载四个邻居房间的地形：切到相邻房间时地形立即出现（每次请求约 1.4 秒）。
 * 只预加载地形——房间对象来自实时订阅，订阅房间是重量级操作，不提前做。
 * 走 Source 的地形缓存（source/terrain-cache.ts），每个房间每赛季只请求一次，不多耗 room-terrain 的限额。
 */
import { minimapCells } from "../minimap/minimap-scene.ts";
import type { Source, WorldSize } from "../source/source.ts";

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

/** 逐个在后台取邻居的地形；`alive()` 变 false（换房间、页面隐藏）就停；任何失败都静默（预加载只是优化），从不拒绝 */
export async function preloadNeighbors(source: Source, shard: string, room: string, alive: () => boolean): Promise<void> {
  try {
    const size = await source.getWorldSize(shard);
    for (const neighbor of neighborRooms(room, size)) {
      if (!alive()) return;
      await source.getTerrain(shard, neighbor).catch(() => undefined);
    }
  } catch {
    // 取不到世界尺寸等：不预加载
  }
}
