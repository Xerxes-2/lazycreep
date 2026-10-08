/**
 * World Map 的 roomMap2（Power Bank）想要哪些房间：放大到 ICON_MIN_ZOOM 以上时取可见房间，按离中心先近后远。
 * 订阅本身经 roomMap2 订阅中心（source/room-map-hub.ts）：总预算与去重在那里，World Map 优先级最低。
 */
import type { WorldSize } from "../source/source.ts";
import type { WorldRect } from "./map-scene.ts";
import { roomName, worldOffset } from "./map-state.ts";

/** 与 rect（世界坐标）相交、在世界之内的房间，按离 rect 中心先近后远 */
export function roomsByDistance(size: WorldSize, rect: WorldRect): string[] {
  const offset = worldOffset(size);
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(size.width, Math.ceil(rect.x1));
  const y1 = Math.min(size.height, Math.ceil(rect.y1));
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const rooms: Array<{ name: string; d: number }> = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      rooms.push({ name: roomName({ x: x - offset.x, y: y - offset.y }), d });
    }
  }
  return rooms.sort((a, b) => a.d - b.d).map((r) => r.name);
}
