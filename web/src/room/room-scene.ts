/**
 * buildRoomScene：RoomState（+ 地形）→ Room View 的 Scene。纯函数。只有官方画风（ADR 0007）：
 * 官方地形 / 道路 / rampart 房间层、官方对象画法、光照、赛季贴图。
 * 对象按 `type` 查映射表（official-painters.ts，加上 withSeasonArt 的赛季对象）分发；表里没有的类型
 * 由赛季 metadata 的通用画法补，再没有就画成带类型名的占位图元。
 */
import type { Primitive, Scene } from "../scene/scene.ts";
import type { Theme } from "../scene/theme.ts";
import type { Terrain } from "../source/source.ts";
import { LAYER, center, num, type ObjectPainter, type ObjectPainters, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import { labelsVisible, ownerColorRule, selectionHighlight } from "./room-detail-rules.ts";
import type { RoomState } from "./room-state.ts";
import { roomVisualPrimitives } from "./room-visual.ts";
import { DEFAULT_ROOM_DISPLAY, showSayBubbles, type RoomDisplay } from "./display-options.ts";
import { nameLabel } from "./name-labels.ts";
import { sayBubble } from "./say-bubbles.ts";
import type { SeasonArt } from "../art/season-art.ts";
import { officialLighting } from "./official-lighting.ts";
import { OFFICIAL_PAINTERS } from "./official-painters.ts";
import { officialRoomLayers } from "./official-terrain.ts";
import { seasonMetadataPainter, withSeasonArt } from "./season-official-painters.ts";

/** Room View 的对象画法映射表：官方画法 + 赛季对象 */
export const ROOM_OBJECT_PAINTERS: ObjectPainters = withSeasonArt(OFFICIAL_PAINTERS);

export { LAYER };
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
  /** 已确认可用的赛季贴图（#47）；没有时赛季对象用兜底画法 */
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
  const table = painters ?? ROOM_OBJECT_PAINTERS;
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

  const primitives: Primitive[] = officialRoomLayers(room.state, room.terrain, ctx);
  for (const [id, obj] of Object.entries(room.state.objects)) {
    if (num(obj, "x") === undefined || num(obj, "y") === undefined) continue;
    const type = obj["type"];
    const paint =
      (typeof type === "string" && ((Object.hasOwn(table, type) && table[type]) || seasonMetadataPainter(type, view.seasonArt))) ||
      placeholder;
    const drafts = [...paint(obj, ctx)];
    if (id === ctx.selectedId) drafts.push(selectionHighlight(obj, ctx));
    const showLabels = labelsVisible(ctx, id);
    const label = display.names && showLabels ? nameLabel(obj, ctx) : undefined;
    if (label) drafts.push(label);
    if (showLabels && showSayBubbles(display)) drafts.push(...sayBubble(obj));
    for (const { part, ...draft } of drafts) {
      primitives.push({ ...draft, key: `${id}/${part}`, objectId: id } as Primitive);
    }
  }
  if (display.lighting) primitives.push(...officialLighting(room.state));
  if (display.visual) primitives.push(...roomVisualPrimitives(room.state.visual));
  // 稳定排序：同层按出现顺序
  primitives.sort((a, b) => a.layer - b.layer);
  return { width: ROOM_SIZE, height: ROOM_SIZE, background: theme.background, primitives };
}
