/**
 * 赛季对象的官方画法（#47）：reactor、钍矿、掉落的钍用赛季服下发的贴图（art/season-art.ts）。
 * 贴图不可用（没有配置、还在预检、预检失败、metadata 里没有尺寸）时这些赛季对象整个退回
 * season-painters.ts 的兜底画法（钍色、reactor 的简单图形），而不是官方表里不认识钍的画法（会画成灰色）；
 * 非钍的矿物与掉落资源照官方表原来的画法。
 *
 * 照下发 metadata 改写成静态图元：reactor 是炉芯 `reactor-core` + 外圈 `reactor-edge`（官方在装着钍时
 * 让外圈旋转，我们不做动画）+ 有主人时的徽章位（半径 29）；钍矿是 `T` 贴图；lighting 图层的 glow 见 official-lighting.ts（#49）。
 * 掉落的钍官方没有专门的画法，用同一张 `T` 贴图，按数量缩放（与兜底画法的大小一致）。
 * 这几类有本地增强（徽章、数量缩放），保留专用画法；其余 metadata 里出现的新类型走
 * {@link seasonMetadataPainter} 的通用画法。
 */
import type { SeasonArt } from "../art/season-art.ts";
import { LAYER, num, type ObjectPainter, type ObjectPainters, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";
import { droppedDiameter, reactorFallback, thoriumDroppedFallback, thoriumMineralFallback } from "./season-painters.ts";
import { ownerBadge } from "./owner-badge.ts";
import { spriteAt, zLayer } from "./official-sprite.ts";

const THORIUM_TYPE = "T";

/** 以格子中心为中心、官方单位尺寸的一张赛季贴图；不可用时 undefined */
function sprite(
  obj: RoomObject,
  ctx: PaintContext,
  part: string,
  objectType: string,
  texture: string,
  layer: number,
  scale = 1,
): PrimitiveDraft | undefined {
  const found = ctx.seasonArt?.sprite(objectType, texture);
  return found && spriteAt(obj, part, found.url, { width: found.width * scale, height: found.height * scale, layer });
}

/** 画法表里的一项；缺失时什么都不画 */
const paint = (painter: ObjectPainter | undefined): ObjectPainter => painter ?? (() => []);

const reactor: ObjectPainter = (obj, ctx) => {
  const core = sprite(obj, ctx, "body", "reactor", "reactor-core", LAYER.structure);
  const edge = sprite(obj, ctx, "edge", "reactor", "reactor-edge", LAYER.structure);
  if (!core || !edge) return reactorFallback(obj, ctx);
  return [core, edge, ...ownerBadge(obj, ctx, { radius: 29, layer: LAYER.structure })];
};

const mineral =
  (base: ObjectPainter): ObjectPainter =>
  (obj, ctx) => {
    if (obj["mineralType"] !== THORIUM_TYPE) return base(obj, ctx);
    const body = sprite(obj, ctx, "body", "mineral", "T", LAYER.structure);
    return body ? [body] : thoriumMineralFallback(obj, ctx);
  };

/** 掉落的钍：直径与兜底画法相同（0.2–0.7 格），贴图按 mineral 里 T 的尺寸等比缩放 */
const dropped =
  (base: ObjectPainter): ObjectPainter =>
  (obj, ctx) => {
    if (obj["resourceType"] !== THORIUM_TYPE) return base(obj, ctx);
    const diameter = droppedDiameter(num(obj, "amount") ?? num(obj, THORIUM_TYPE) ?? 0);
    const full = ctx.seasonArt?.sprite("mineral", "T");
    const body = full && sprite(obj, ctx, "body", "mineral", "T", LAYER.ground, (diameter * 100) / full.width);
    return body ? [body] : thoriumDroppedFallback(obj, ctx);
  };

/**
 * 给官方画法映射表加上赛季对象：reactor、钍矿、掉落的钍用赛季贴图，贴图不可用时用兜底画法；
 * 其余对象用表里原来的画法。
 */
export function withSeasonArt(painters: ObjectPainters): ObjectPainters {
  return {
    ...painters,
    reactor,
    mineral: mineral(paint(painters["mineral"])),
    energy: dropped(paint(painters["energy"])),
    resource: dropped(paint(painters["resource"])),
  };
}

/**
 * 官方表与本地赛季画法都没有条目、但服务器下发的 metadata 里有的对象类型（新赛季的对象）：
 * 按 metadata 的尺寸以格子中心画它的主贴图（objects 图层上第一个贴图可用的 sprite），
 * metadata 指定主人色时按主人色染色，层级按 metadata 的 zIndex。主贴图不可用时为 undefined（照旧画占位）。
 */
export function seasonMetadataPainter(objectType: string, art: SeasonArt | undefined): ObjectPainter | undefined {
  const main = art?.mainSprite(objectType);
  if (!main) return undefined;
  return (obj, ctx) => {
    const tint = main.tint === "owner" ? ctx.ownerColor(obj["user"]) : main.tint;
    return [
      spriteAt(obj, "body", main.url, {
        width: main.width,
        height: main.height,
        layer: zLayer(main.zIndex),
        ...(tint === undefined ? {} : { tint }),
        ...(main.alpha === undefined ? {} : { alpha: main.alpha }),
      }),
    ];
  };
}
