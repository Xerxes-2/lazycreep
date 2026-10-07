/**
 * “对象类型 → 画法”映射表。新增类型（包括赛季对象）只需在这里加一个条目；
 * 不在表里的类型由 buildRoomScene 画成带类型名的占位图元。
 */
import type { Color } from "../scene/scene.ts";
import {
  LAYER,
  center,
  hitsBar,
  num,
  regularPolygon,
  storeFraction,
  tileBar,
  type ObjectPainter,
  type ObjectPainters,
  type PaintContext,
  type PrimitiveDraft,
} from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";

const OUTLINE = 0.06;

function outline(ctx: PaintContext, color: Color = ctx.theme.structureOutline) {
  return { color, width: OUTLINE };
}

/** 有主建筑的轮廓用主人颜色 */
function ownedOutline(obj: RoomObject, ctx: PaintContext) {
  return outline(ctx, obj["user"] === undefined ? ctx.theme.structureOutline : ctx.ownerColor(obj["user"]));
}

/** 能量越满，内芯越大 */
function energyCore(obj: RoomObject, ctx: PaintContext, maxRadius: number): PrimitiveDraft[] {
  const fraction = storeFraction(obj);
  if (!fraction) return [];
  const { x, y } = center(obj);
  return [{ part: "energy", kind: "circle", layer: LAYER.structure, x, y, radius: maxRadius * fraction, fill: ctx.theme.energy }];
}

/** 方形建筑（storage、terminal 外框等） */
function square(obj: RoomObject, ctx: PaintContext, size: number, fill: Color = ctx.theme.structure): PrimitiveDraft {
  const { x, y } = center(obj);
  return {
    part: "body",
    kind: "rect",
    layer: LAYER.structure,
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
    radius: size * 0.15,
    fill,
    stroke: ownedOutline(obj, ctx),
  };
}

function disc(obj: RoomObject, ctx: PaintContext, radius: number, fill: Color = ctx.theme.structure, layer: number = LAYER.structure): PrimitiveDraft {
  const { x, y } = center(obj);
  return { part: "body", kind: "circle", layer, x, y, radius, fill, stroke: ownedOutline(obj, ctx) };
}

function polygon(obj: RoomObject, ctx: PaintContext, points: number[], fill: Color = ctx.theme.structure): PrimitiveDraft {
  return { part: "body", kind: "polygon", layer: LAYER.structure, points, fill, stroke: ownedOutline(obj, ctx) };
}

/** 存储类建筑：外形 + 装载条 */
function storeBar(obj: RoomObject, ctx: PaintContext): PrimitiveDraft[] {
  const fraction = storeFraction(obj);
  return fraction === undefined ? [] : [tileBar(obj, "store", fraction, ctx.theme.energy, ctx)];
}

const road: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [{ part: "body", kind: "circle", layer: LAYER.road, x, y, radius: 0.2, fill: ctx.theme.road }];
};

const constructedWall: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [
    {
      part: "body",
      kind: "rect",
      layer: LAYER.structure,
      x: x - 0.5,
      y: y - 0.5,
      width: 1,
      height: 1,
      fill: ctx.theme.wall,
      stroke: outline(ctx),
    },
  ];
};

const rampart: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const color = ctx.ownerColor(obj["user"]);
  return [
    {
      part: "body",
      kind: "rect",
      layer: LAYER.rampart,
      x: x - 0.5,
      y: y - 0.5,
      width: 1,
      height: 1,
      radius: 0.2,
      fill: color,
      alpha: 0.3,
      stroke: { color, width: 0.08 },
    },
  ];
};

const spawn: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.45), ...energyCore(obj, ctx, 0.3)];
const extension: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.28), ...energyCore(obj, ctx, 0.18)];

const tower: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [
    disc(obj, ctx, 0.4),
    { part: "turret", kind: "rect", layer: LAYER.structure, x: x - 0.12, y: y - 0.45, width: 0.24, height: 0.45, fill: ctx.theme.structureOutline },
    ...energyCore(obj, ctx, 0.22),
  ];
};

const storage: ObjectPainter = (obj, ctx) => [square(obj, ctx, 0.85), ...storeBar(obj, ctx)];
const terminal: ObjectPainter = (obj, ctx) => [polygon(obj, ctx, regularPolygon(obj, 8, 0.45, Math.PI / 8)), ...storeBar(obj, ctx)];
const container: ObjectPainter = (obj, ctx) => [square(obj, ctx, 0.5), ...storeBar(obj, ctx)];
const link: ObjectPainter = (obj, ctx) => [polygon(obj, ctx, regularPolygon(obj, 4, 0.35)), ...energyCore(obj, ctx, 0.15)];
const lab: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.38), ...storeBar(obj, ctx)];
const observer: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.25)];
const powerSpawn: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.45, ctx.theme.power)];
const nuker: ObjectPainter = (obj, ctx) => [polygon(obj, ctx, regularPolygon(obj, 3, 0.48))];
const factory: ObjectPainter = (obj, ctx) => [polygon(obj, ctx, regularPolygon(obj, 6, 0.45)), ...storeBar(obj, ctx)];

const extractor: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [{ part: "body", kind: "circle", layer: LAYER.structure, x, y, radius: 0.46, stroke: ownedOutline(obj, ctx) }];
};

const controller: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const level = num(obj, "level") ?? 0;
  const prims: PrimitiveDraft[] = [disc(obj, ctx, 0.48, ctx.theme.controller)];
  if (level > 0) {
    prims.push({ part: "level", kind: "text", layer: LAYER.label, x, y, text: String(level), size: 0.5, color: ctx.theme.label });
  }
  return prims;
};

const source: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const energy = num(obj, "energy") ?? 0;
  const capacity = num(obj, "energyCapacity") ?? 0;
  return [
    {
      part: "body",
      kind: "rect",
      layer: LAYER.structure,
      x: x - 0.4,
      y: y - 0.4,
      width: 0.8,
      height: 0.8,
      radius: 0.15,
      fill: ctx.theme.energy,
      alpha: capacity > 0 ? 0.3 + 0.7 * Math.min(1, energy / capacity) : 1,
    },
  ];
};

const mineral: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const prims: PrimitiveDraft[] = [{ part: "body", kind: "circle", layer: LAYER.structure, x, y, radius: 0.42, fill: ctx.theme.mineral }];
  const kind = obj["mineralType"];
  if (typeof kind === "string") {
    prims.push({ part: "kind", kind: "text", layer: LAYER.label, x, y, text: kind, size: 0.45, color: ctx.theme.labelOutline });
  }
  return prims;
};

const creep: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [
    {
      part: "body",
      kind: "circle",
      layer: LAYER.creep,
      x,
      y,
      radius: 0.38,
      fill: ctx.ownerColor(obj["user"]),
      stroke: { color: ctx.theme.labelOutline, width: OUTLINE },
    },
    ...hitsBar(obj, ctx),
  ];
};

/** 墓碑、废墟 */
const remains: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [{ part: "body", kind: "rect", layer: LAYER.ground, x: x - 0.25, y: y - 0.25, width: 0.5, height: 0.5, fill: ctx.theme.decay }];
};

/** 掉在地上的资源：数量越多越大 */
const droppedResource: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const kind = obj["resourceType"];
  const amount = num(obj, "amount") ?? num(obj, typeof kind === "string" ? kind : "energy") ?? 0;
  const radius = 0.1 + 0.25 * Math.min(1, Math.sqrt(amount / 1000));
  const fill = kind === undefined || kind === "energy" ? ctx.theme.energy : kind === "power" ? ctx.theme.power : ctx.theme.mineral;
  return [{ part: "body", kind: "circle", layer: LAYER.ground, x, y, radius, fill }];
};

const constructionSite: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [
    {
      part: "body",
      kind: "circle",
      layer: LAYER.ground,
      x,
      y,
      radius: 0.3,
      stroke: { color: ctx.ownerColor(obj["user"]), width: 0.08 },
    },
  ];
};

const keeperLair: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.45, ctx.theme.wall)];
const portal: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.45, ctx.theme.mineral)];
const powerBank: ObjectPainter = (obj, ctx) => [disc(obj, ctx, 0.45, ctx.theme.power), ...hitsBar(obj, ctx)];
const invaderCore: ObjectPainter = (obj, ctx) => [polygon(obj, ctx, regularPolygon(obj, 6, 0.45), ctx.theme.power), ...hitsBar(obj, ctx)];
const deposit: ObjectPainter = (obj, ctx) => [polygon(obj, ctx, regularPolygon(obj, 5, 0.42), ctx.theme.mineral)];

export const ROOM_OBJECT_PAINTERS: ObjectPainters = {
  road,
  constructedWall,
  rampart,
  spawn,
  extension,
  tower,
  storage,
  terminal,
  container,
  link,
  lab,
  observer,
  powerSpawn,
  nuker,
  factory,
  extractor,
  controller,
  source,
  mineral,
  creep,
  powerCreep: creep,
  tombstone: remains,
  ruin: remains,
  energy: droppedResource,
  resource: droppedResource,
  constructionSite,
  keeperLair,
  portal,
  powerBank,
  invaderCore,
  deposit,
};
