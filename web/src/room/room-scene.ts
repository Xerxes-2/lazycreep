/**
 * buildRoomScene：RoomState（+ 地形）→ Room View 的 Scene。纯函数。
 * 对象按 `type` 查映射表（room-painters.ts）分发；表里没有的类型画成带类型名的占位图元。
 */
import type { Primitive, Scene } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { Terrain } from "../source/source.ts";
import { LAYER, center, num, type ObjectPainter, type ObjectPainters, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import { ROOM_OBJECT_PAINTERS } from "./room-painters.ts";
import type { RoomState } from "./room-state.ts";
import { roomVisualPrimitives } from "./room-visual.ts";

export { LAYER, ROOM_OBJECT_PAINTERS };
export type { ObjectPainter, ObjectPainters, PaintContext, PrimitiveDraft };

export const ROOM_SIZE = 50;

export interface RoomSceneInput {
  readonly state: RoomState;
  readonly terrain?: Terrain | undefined;
}

export interface RoomSceneView {
  readonly theme: Theme;
  /** 画布上 1 格对应的像素数，默认 1 */
  readonly zoom?: number;
  readonly selectedId?: string | undefined;
}

/** 未知类型：洋红虚框 + 类型名 */
const placeholder: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const type = typeof obj["type"] === "string" ? obj["type"] : "?";
  return [
    {
      part: "placeholder",
      kind: "rect",
      layer: LAYER.placeholder,
      x: x - 0.45,
      y: y - 0.45,
      width: 0.9,
      height: 0.9,
      stroke: { color: ctx.theme.placeholder, width: 0.08 },
    },
    {
      part: "placeholder-label",
      kind: "text",
      layer: LAYER.label,
      x,
      y,
      text: type,
      size: 0.28,
      color: ctx.theme.placeholder,
      stroke: { color: ctx.theme.labelOutline, width: 0.04 },
    },
  ];
};

/** 地形：墙与沼泽按行合并成矩形，平原不画。 */
function terrainPrimitives(terrain: Terrain, theme: Theme): Primitive[] {
  const prims: Primitive[] = [];
  const kindAt = (x: number, y: number) => {
    const code = Number(terrain.encoded[y * ROOM_SIZE + x] ?? 0);
    return code & 1 ? "wall" : code & 2 ? "swamp" : undefined;
  };
  for (let y = 0; y < ROOM_SIZE; y++) {
    let x = 0;
    while (x < ROOM_SIZE) {
      const kind = kindAt(x, y);
      let end = x + 1;
      while (end < ROOM_SIZE && kindAt(end, y) === kind) end++;
      if (kind) {
        prims.push({
          key: `terrain/${y}/${x}`,
          kind: "rect",
          layer: LAYER.terrain,
          x,
          y,
          width: end - x,
          height: 1,
          fill: kind === "wall" ? theme.terrainWall : theme.terrainSwamp,
        });
      }
      x = end;
    }
  }
  return prims;
}

export function buildRoomScene(
  room: RoomSceneInput,
  view: RoomSceneView,
  painters: ObjectPainters = ROOM_OBJECT_PAINTERS,
): Scene {
  const { theme } = view;
  const ctx: PaintContext = {
    theme,
    zoom: view.zoom ?? 1,
    selectedId: view.selectedId,
    users: room.state.users,
    ownerColor: (user) => (typeof user === "string" ? theme.owned : theme.neutral),
  };

  const primitives: Primitive[] = room.terrain ? terrainPrimitives(room.terrain, theme) : [];
  for (const [id, obj] of Object.entries(room.state.objects)) {
    if (num(obj, "x") === undefined || num(obj, "y") === undefined) continue;
    const type = obj["type"];
    const paint = (typeof type === "string" && Object.hasOwn(painters, type) && painters[type]) || placeholder;
    for (const { part, ...draft } of paint(obj, ctx)) {
      primitives.push({ ...draft, key: `${id}/${part}`, objectId: id } as Primitive);
    }
  }
  primitives.push(...roomVisualPrimitives(room.state.visual));
  // 稳定排序：同层按出现顺序
  primitives.sort((a, b) => a.layer - b.layer);
  return { width: ROOM_SIZE, height: ROOM_SIZE, background: theme.background, primitives };
}
