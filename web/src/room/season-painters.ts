/**
 * 当前赛季（Season，shardSeason，2026-10 实测）特有对象的画法，并入 room-painters.ts 的映射表。
 *
 * 来源：docs-season.screeps.com/api 的 Reactor 一节与 Season constants（RESOURCE_THORIUM = 'T'、
 * FIND_REACTORS）；匿名 room-objects 抽查：reactor 在扇区中心房（如 W15S25、E15N25），
 * 字段 store {T}、storeCapacityResource {T: 1000}、user、launchTime；钍矿是 mineralType 为 "T" 的 mineral。
 */
import type { Color } from "../scene/scene.ts";
import {
  LAYER,
  center,
  regularPolygon,
  storeFraction,
  tileBar,
  type ObjectPainter,
  type ObjectPainters,
  type PrimitiveDraft,
} from "./room-paint.ts";

/** 钍：赛季资源 RESOURCE_THORIUM */
export const THORIUM: Color = 0x8cf04a;
const THORIUM_TYPE = "T";

/** Reactor：主人色外环 + 六边形炉膛 + 随装载量变大的钍芯 + 装载条 */
const reactor: ObjectPainter = (obj, ctx) => {
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
  if (fraction !== undefined) prims.push(tileBar(obj, "store", fraction, THORIUM, ctx));
  return prims;
};

/** 赛季新增的对象类型 */
export const SEASON_PAINTERS: ObjectPainters = { reactor };

/** 包一层：钍矿与掉落的钍把主体换成钍色，其他照原画法。 */
export function withThorium(base: ObjectPainter): ObjectPainter {
  return (obj, ctx) => {
    const prims = base(obj, ctx);
    if (obj["mineralType"] !== THORIUM_TYPE && obj["resourceType"] !== THORIUM_TYPE) return prims;
    return prims.map((p) => (p.part === "body" && "fill" in p ? { ...p, fill: THORIUM } : p));
  };
}
