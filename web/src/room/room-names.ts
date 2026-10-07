/** 房间名（如 W13S28）的坐标换算。 */

export type Direction = "north" | "south" | "east" | "west";

const ROOM_NAME = /^([WE])(\d+)([NS])(\d+)$/;

/** 相邻房间名；不是常规房间名（如 sim）时为 undefined。 */
export function adjacentRoom(name: string, direction: Direction): string | undefined {
  const match = ROOM_NAME.exec(name.trim().toUpperCase());
  if (!match) return undefined;
  const [, we, xs, ns, ys] = match;
  // 世界坐标：E0 = 0、W0 = -1；S0 = 0、N0 = -1（y 向南增大）
  let x = we === "E" ? Number(xs) : -Number(xs) - 1;
  let y = ns === "S" ? Number(ys) : -Number(ys) - 1;
  if (direction === "north") y--;
  else if (direction === "south") y++;
  else if (direction === "east") x++;
  else x--;
  const horizontal = x >= 0 ? `E${x}` : `W${-x - 1}`;
  const vertical = y >= 0 ? `S${y}` : `N${-y - 1}`;
  return horizontal + vertical;
}
