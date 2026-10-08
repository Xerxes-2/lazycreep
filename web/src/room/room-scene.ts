/**
 * buildRoomScene：RoomState（+ 地形）→ Room View 的 Scene。纯函数。
 * 对象按 `type` 查映射表（room-painters.ts）分发；表里没有的类型画成带类型名的占位图元。
 */
import type { Primitive, Scene } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { Terrain } from "../source/source.ts";
import { LAYER, center, num, type ObjectPainter, type ObjectPainters, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import { barsVisible, extraBars, ownerColorRule, selectionHighlight, stackBars } from "./room-detail-rules.ts";
import { ROOM_OBJECT_PAINTERS } from "./room-painters.ts";
import type { RoomState } from "./room-state.ts";
import { roomVisualPrimitives } from "./room-visual.ts";
import { DEFAULT_ROOM_DISPLAY, type RoomDisplay } from "./display-options.ts";
import { nameLabel } from "./name-labels.ts";
import type { ArtStyle } from "../art/art-style.ts";
import type { SeasonArt } from "../art/season-art.ts";
import { ROOM_ART } from "./room-art.ts";

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
  /** 当前用户 id，按玩家着色用；未知时所有玩家都按陌生人着色 */
  readonly me?: string | undefined;
  /** Ally List（用户名，不分大小写），默认空 */
  readonly allies?: ReadonlySet<string> | undefined;
  /** 显示选项（#26）；默认全开 */
  readonly display?: RoomDisplay | undefined;
  /** Art Style：选画法策略（room-art.ts）。必须给出——默认值只有设置（DEFAULT_ART_STYLE）一处 */
  readonly artStyle: ArtStyle;
  /** 已确认可用的赛季贴图（#47），官方画风下用 */
  readonly seasonArt?: SeasonArt | undefined;
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

export function buildRoomScene(
  room: RoomSceneInput,
  view: RoomSceneView,
  painters?: ObjectPainters,
): Scene {
  const { theme } = view;
  const art = ROOM_ART[view.artStyle];
  const table = painters ?? art.painters;
  const display = view.display ?? DEFAULT_ROOM_DISPLAY;
  const ctx: PaintContext = {
    theme,
    zoom: view.zoom ?? 1,
    selectedId: view.selectedId,
    users: room.state.users,
    gameTime: room.state.gameTime,
    ownerColor: ownerColorRule(theme, room.state.users, { me: view.me, allies: view.allies }),
    ...(view.seasonArt ? { seasonArt: view.seasonArt } : {}),
  };

  const primitives: Primitive[] = art.roomLayers(room.state, room.terrain, ctx);
  for (const [id, obj] of Object.entries(room.state.objects)) {
    if (num(obj, "x") === undefined || num(obj, "y") === undefined) continue;
    const type = obj["type"];
    const paint =
      (typeof type === "string" && ((Object.hasOwn(table, type) && table[type]) || art.extraPainter(type, view.seasonArt))) ||
      placeholder;
    const painted = paint(obj, ctx);
    const drafts = [...painted, ...extraBars(obj, painted, ctx)];
    if (id === ctx.selectedId) drafts.push(selectionHighlight(obj, ctx));
    const showBars = barsVisible(ctx, id);
    const label = display.names && showBars ? nameLabel(obj, ctx) : undefined;
    if (label) drafts.push(label);
    const shown = drafts.filter(
      (d) => d.kind !== "bar" || (showBars && (display.bars || d.part !== "hits")),
    );
    for (const { part, ...draft } of stackBars(shown)) {
      primitives.push({ ...draft, key: `${id}/${part}`, objectId: id } as Primitive);
    }
  }
  if (display.lighting) primitives.push(...art.lighting(room.state));
  if (display.visual) primitives.push(...roomVisualPrimitives(room.state.visual));
  // 稳定排序：同层按出现顺序
  primitives.sort((a, b) => a.layer - b.layer);
  return { width: ROOM_SIZE, height: ROOM_SIZE, background: theme.background, primitives };
}
