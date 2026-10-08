/**
 * 同格多个对象时的选择列表（#60）：条目的内容与顺序、列表在 Room View 里的位置。界面在 PickList.tsx。
 */
import type { Color } from "../scene/scene.ts";
import type { RoomUser } from "../source/source.ts";
import type { RoomObject } from "./room-state.ts";

export interface PickEntry {
  readonly id: string;
  readonly type: string;
  /** creep / power creep 的名字 */
  readonly name: string | undefined;
  /** 主人的用户名；没有主人或不认识时为 undefined */
  readonly owner: string | undefined;
  /** 主人颜色（与画面同一条 ownerColor 规则）；没有主人时为 undefined */
  readonly color: Color | undefined;
}

/** 排序分组：creep / power creep → 其他对象 → 道路 / rampart */
function rank(type: string): number {
  if (type === "creep" || type === "powerCreep") return 0;
  if (type === "road" || type === "rampart") return 2;
  return 1;
}

/** ids 是点选结果（自上而下）；同组内保持这个顺序。状态里已没有的对象跳过。 */
export function pickEntries(
  ids: readonly string[],
  objects: Readonly<Record<string, RoomObject>>,
  users: Readonly<Record<string, RoomUser>>,
  ownerColor: (user: unknown) => Color,
): PickEntry[] {
  const entries: PickEntry[] = [];
  for (const id of ids) {
    const obj = objects[id];
    if (!obj) continue;
    const type = typeof obj["type"] === "string" ? obj["type"] : "?";
    const user = obj["user"];
    const owned = typeof user === "string";
    entries.push({
      id,
      type,
      name: rank(type) === 0 && typeof obj["name"] === "string" ? obj["name"] : undefined,
      owner: owned ? users[user]?.username : undefined,
      color: owned ? ownerColor(user) : undefined,
    });
  }
  return entries.sort((a, b) => rank(a.type) - rank(b.type));
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** 列表与点击处的间距（CSS 像素） */
const GAP = 8;

function along(at: number, size: number, room: number): number {
  if (at + GAP + size <= room) return at + GAP;
  if (at - GAP - size >= 0) return at - GAP - size;
  return Math.max(0, Math.min(at + GAP, room - size));
}

/** 列表左上角（相对 Room View 画布）：默认在点击处右下方，放不下就翻到另一侧，再不行夹在画布之内。 */
export function placePickList(anchor: { readonly x: number; readonly y: number }, list: Size, frame: Size) {
  return { left: along(anchor.x, list.width, frame.width), top: along(anchor.y, list.height, frame.height) };
}
