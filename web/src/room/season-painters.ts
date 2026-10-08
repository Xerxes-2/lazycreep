/**
 * 赛季（Season，shardSeason，2026-10 实测）对象的兜底画法（ADR 0007）：赛季贴图不可用时
 * （没有配置、还在预检、预检失败）由 season-official-painters.ts 的 withSeasonArt 退回这里；
 * reactor 没有官方画法，贴图不可用时也画这里的样子。
 *
 * 来源：docs-season.screeps.com/api 的 Reactor 一节与 Season constants（RESOURCE_THORIUM = 'T'、
 * FIND_REACTORS）；匿名 room-objects 抽查：reactor 在扇区中心房（如 W15S25、E15N25），
 * 字段 store {T}、storeCapacityResource {T: 1000}、user、launchTime；钍矿是 mineralType 为 "T" 的 mineral。
 */
import type { Color } from "../scene/scene.ts";
import { LAYER, center, num, regularPolygon, storeFraction, type ObjectPainter, type PrimitiveDraft } from "./room-paint.ts";

/** 钍：赛季资源 RESOURCE_THORIUM */
export const THORIUM: Color = 0x8cf04a;

/** Reactor：主人色外环 + 六边形炉膛 + 随装载量变大的钍芯 */
export const reactorFallback: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  const owner = obj["user"] === undefined ? ctx.theme.structureOutline : ctx.ownerColor(obj["user"]);
  const fraction = storeFraction(obj);
  const prims: PrimitiveDraft[] = [
    { part: "body", kind: "circle", layer: LAYER.structure, x, y, radius: 0.48, fill: ctx.theme.structure, stroke: { color: owner, width: 0.08 } },
    {
      part: "frame",
      kind: "polygon",
      layer: LAYER.structure,
      points: regularPolygon(obj, 6, 0.34, Math.PI / 6),
      fill: ctx.theme.wall,
      stroke: { color: THORIUM, width: 0.05, alpha: 0.6 },
    },
  ];
  if (fraction) {
    prims.push({ part: "thorium", kind: "circle", layer: LAYER.structure, x, y, radius: 0.08 + 0.2 * fraction, fill: THORIUM });
  }
  return prims;
};

/** 钍矿：钍色圆 + 矿物类型 */
export const thoriumMineralFallback: ObjectPainter = (obj, ctx) => {
  const { x, y } = center(obj);
  return [
    { part: "body", kind: "circle", layer: LAYER.structure, x, y, radius: 0.42, fill: THORIUM },
    { part: "kind", kind: "text", layer: LAYER.label, x, y, text: "T", size: 0.45, color: ctx.theme.labelOutline },
  ];
};

/** 掉在地上的钍的直径（格）：数量越多越大，0.2–0.7 格 */
export function droppedDiameter(amount: number): number {
  return 2 * (0.1 + 0.25 * Math.min(1, Math.sqrt(amount / 1000)));
}

/** 掉在地上的钍：钍色圆，数量越多越大 */
export const thoriumDroppedFallback: ObjectPainter = (obj) => {
  const { x, y } = center(obj);
  const amount = num(obj, "amount") ?? num(obj, "T") ?? 0;
  return [{ part: "body", kind: "circle", layer: LAYER.ground, x, y, radius: droppedDiameter(amount) / 2, fill: THORIUM }];
};
