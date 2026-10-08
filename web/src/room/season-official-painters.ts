/**
 * 赛季对象的官方画法（#47）：reactor、钍矿、掉落的钍用赛季服下发的贴图（art/season-art.ts）。
 * 贴图不可用（没有配置、还在预检、预检失败、metadata 里没有尺寸）时这些赛季对象整个退回几何画法
 * （#13 的赛季画法：钍色、reactor 的几何画法），而不是官方表里不认识钍的画法（会画成灰色）；
 * 非钍的矿物与掉落资源照官方表原来的画法。
 *
 * 照下发 metadata 改写成静态图元：reactor 是炉芯 `reactor-core` + 外圈 `reactor-edge`（官方在装着钍时
 * 让外圈旋转，我们不做动画）+ 有主人时的徽章位（半径 29）；钍矿是 `T` 贴图；lighting 图层的 glow 不做。
 * 掉落的钍官方没有专门的画法，用同一张 `T` 贴图，按数量缩放（与几何画法的大小一致）。
 */
import type { ArtStyle } from "../art/art-style.ts";
import { seasonArtFor, type SeasonArt, type SeasonTexture } from "../art/season-art.ts";
import type { Source } from "../source/source.ts";
import { ROOM_OBJECT_PAINTERS } from "./room-painters.ts";
import { LAYER, center, num, storeFraction, tileBar, type ObjectPainter, type ObjectPainters, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";
import { THORIUM } from "./season-painters.ts";

const THORIUM_TYPE = "T";

/** 以格子中心为中心、官方单位尺寸的一张赛季贴图；不可用时 undefined */
function sprite(
  obj: RoomObject,
  ctx: PaintContext,
  part: string,
  objectType: string,
  texture: SeasonTexture,
  layer: number,
  scale = 1,
): PrimitiveDraft | undefined {
  const found = ctx.seasonArt?.sprite(objectType, texture);
  if (!found) return undefined;
  const { x, y } = center(obj);
  const width = (found.width / 100) * scale;
  const height = (found.height / 100) * scale;
  return { part, kind: "image", layer, x: x - width / 2, y: y - height / 2, width, height, url: found.url };
}

/** 画法表里的一项；缺失时什么都不画 */
const paint = (painter: ObjectPainter | undefined): ObjectPainter => painter ?? (() => []);

const reactor =
  (fallback: ObjectPainter): ObjectPainter =>
  (obj, ctx) => {
    const core = sprite(obj, ctx, "body", "reactor", "reactor-core", LAYER.structure);
    const edge = sprite(obj, ctx, "edge", "reactor", "reactor-edge", LAYER.structure);
    if (!core || !edge) return fallback(obj, ctx);
    const prims: PrimitiveDraft[] = [core, edge];
    if (obj["user"] !== undefined) {
      const { x, y } = center(obj);
      // 徽章位：与 #42 的 spawn / controller 一样先用主人色圆占位
      prims.push({ part: "badge", kind: "circle", layer: LAYER.structure, x, y, radius: 0.29, fill: ctx.ownerColor(obj["user"]) });
    }
    const fraction = storeFraction(obj);
    if (fraction !== undefined) prims.push(tileBar(obj, "store", fraction, THORIUM, ctx));
    return prims;
  };

const mineral =
  (base: ObjectPainter, geometric: ObjectPainter): ObjectPainter =>
  (obj, ctx) => {
    if (obj["mineralType"] !== THORIUM_TYPE) return base(obj, ctx);
    const body = sprite(obj, ctx, "body", "mineral", "T", LAYER.structure);
    return body ? [body] : geometric(obj, ctx);
  };

/** 掉落的钍：直径与几何画法相同（0.2–0.7 格），贴图按 mineral 里 T 的尺寸等比缩放 */
const dropped =
  (base: ObjectPainter, geometric: ObjectPainter): ObjectPainter =>
  (obj, ctx) => {
    if (obj["resourceType"] !== THORIUM_TYPE) return base(obj, ctx);
    const amount = num(obj, "amount") ?? num(obj, THORIUM_TYPE) ?? 0;
    const diameter = 2 * (0.1 + 0.25 * Math.min(1, Math.sqrt(amount / 1000)));
    const full = ctx.seasonArt?.sprite("mineral", "T");
    const body = full && sprite(obj, ctx, "body", "mineral", "T", LAYER.ground, (diameter * 100) / full.width);
    return body ? [body] : geometric(obj, ctx);
  };

/**
 * 给一张（已合并的）画法映射表加上赛季贴图：赛季对象贴图不可用时用几何画法（geometric，默认几何映射表），
 * 其余对象用表里原来的画法。
 */
export function withSeasonArt(painters: ObjectPainters, geometric: ObjectPainters = ROOM_OBJECT_PAINTERS): ObjectPainters {
  const geo = (type: string) => paint(geometric[type]);
  return {
    ...painters,
    reactor: reactor(geo("reactor")),
    mineral: mineral(paint(painters["mineral"]), geo("mineral")),
    energy: dropped(paint(painters["energy"]), geo("energy")),
    resource: dropped(paint(painters["resource"]), geo("resource")),
  };
}

/**
 * Room View 用：官方画风下这个 Source 当前可用的赛季贴图（在响应式上下文里读，预检完成时 Scene 重建一次）；
 * 几何画风不取版本信息、不预检。
 */
export function seasonArtOf(source: Source | undefined, style: ArtStyle | undefined): SeasonArt | undefined {
  return source && style === "official" ? seasonArtFor(source)() : undefined;
}
