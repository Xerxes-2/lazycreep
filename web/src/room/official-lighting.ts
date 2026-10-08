/**
 * 官方画风的光照（#49，ADR 0006）：照官方渲染器（screeps/renderer，ISC，commit a2db4a7）
 * `metadata/src/objects/*.metadata.js` 里 `layer: 'lighting'` 的 glow 精灵，给对象加静态的发光图元。
 *
 * 官方的 lighting 图层：0x808080 的环境光加上各个 glow（SCREEN 混合）合成一张光照图，再以 MULTIPLY
 * 盖住地形与对象——没有光的地方变暗一半，glow 附近恢复原亮度。#46 已把环境光与墙阴影乘进地形与道路，
 * 建筑保持原色；这里只补 glow：每个 glow 是一个 `glow.png` 的 image 图元，加色混合，透明度是官方
 * alpha × {@link GLOW_GAIN}（官方 glow 最多把变暗一半的地面提回原亮度，加色只需要很小的增量）。
 *
 * 取舍：
 * - 只做照亮周围地面的大 glow（宽 256–1200，即半径 1.3 格以上）。官方还有两类只照对象自己的：与对象
 *   同形的“遮罩”（creep-mask、deposit / powerCreep 贴图、tombstone-resource、掉落能量的 resourceCircle）
 *   与盖在对象上的小 glow（宽 100–250，如有能量的 extension / spawn / tower、有物资的 storage）。
 *   它们在官方里只是让对象本身不被环境光压暗；我们的对象本来就不变暗，再加色只会把对象冲白，所以不做。
 *   于是“有能量才亮”这类条件大多随小 glow 一起消失，只剩 link、lab 的大 glow 仍按物资点亮。
 * - 闪烁、缩放与 spawn 孵化时的闪光取静止时的样子（ADR 0008 不做常驻动画）。tower 开火时的 glow 闪光（#55）
 *   随动画开关：给了 AnimationContext 时，开火的塔的 glow 透明度 0.5 → 1 →（0.1td 升、0.3td 降）回到 0.5。
 * - 关闭光照时官方地形也自带等量的压暗（地面 0x202020，与 0x555555 × 0x808080 相近；沼泽染 0x808080），
 *   对象全亮——与我们“#46 的压暗保留、只去掉 glow”一致，所以开关只决定 glow 图元的有无。
 * - 加色不会像 SCREEN 那样饱和：GLOW_GAIN 按密集基地中心（十几个大 glow 叠加）提亮约 0.2 选定，
 *   与官方把地面从环境光的一半提回原亮度相当；孤立的光源（source、mineral）因此比官方淡。
 */
import { officialTextureUrl } from "../art/official-textures.ts";
import type { Color, ImagePrimitive, Primitive } from "../scene/scene.ts";
import { LAYER, center, num, type AnimationContext } from "./room-paint.ts";
import { TOWER_FLASH, animationOf, pulse, towerShot } from "./action-animation.ts";
import { energyStore, storeTotal, u } from "./official-sprite.ts";
import type { RoomObject, RoomState } from "./room-state.ts";

/** 光照的层级：对象（含 creep、rampart）之上，官方 effects 图层（工地等，LAYER.rampart + 1）之下 */
export const LIGHTING_LAYER = LAYER.rampart + 0.5;

/** 官方 glow 的 alpha 换成加色混合的透明度 */
export const GLOW_GAIN = 0.12;

interface Glow {
  /** 官方单位（100 = 1 格），方形 */
  readonly size: number;
  readonly alpha?: number;
  readonly tint?: Color;
}

type GlowRule = (obj: RoomObject, gameTime: number | undefined) => readonly (Glow | false | undefined)[];

/** 官方 mineral 的 foregroundColor（赛季服 metadata 加了钍） */
const MINERAL_GLOW: Readonly<Record<string, Color>> = {
  L: 0x89f4a5,
  U: 0x88d6f7,
  K: 0x9370ff,
  Z: 0xf2d28b,
  X: 0xff7a7a,
  O: 0xcccccc,
  H: 0xcccccc,
  T: 0xbcff50,
};

/** 官方 deposit 的 color */
const DEPOSIT_GLOW: Readonly<Record<string, Color>> = { biomass: 0x84b012, metal: 0x956f5c, mist: 0xda6bf5, silicon: 0x4ca7e5 };

const storeGlows: GlowRule = () => [{ size: 800, alpha: 0.5 }];

/** 每类对象照亮周围的 glow（宽不小于 256 的那些） */
const RULES: Readonly<Record<string, GlowRule>> = {
  spawn: () => [{ size: 600, alpha: 0.5 }],
  tower: () => [{ size: 600, alpha: 0.5 }],
  link: (obj) => [energyStore(obj) > 0 && { size: 400, alpha: 0.5 }],
  storage: storeGlows,
  terminal: storeGlows,
  factory: storeGlows,
  lab: (obj) => [storeTotal(obj) - energyStore(obj) > 0 && { size: 500, alpha: 0.3 }],
  nuker: () => [{ size: 800, alpha: 0.5 }],
  observer: () => [{ size: 800, alpha: 0.5 }],
  powerSpawn: () => [{ size: 256, alpha: 0.5 }],
  controller: (obj) => [{ size: 1200, alpha: 0.5 }, typeof obj["user"] === "string" && { size: 500 }],
  source: () => [{ size: 800, alpha: 0.5, tint: 0xffff50 }],
  mineral: (obj) => {
    const kind = obj["mineralType"];
    return [{ size: 700, alpha: 0.7, tint: (typeof kind === "string" && MINERAL_GLOW[kind]) || 0xffffff }];
  },
  deposit: (obj) => {
    const tint = DEPOSIT_GLOW[String(obj["depositType"])];
    return [tint !== undefined && { size: 700, tint }];
  },
  creep: (obj) => [!obj["spawning"] && { size: 400, alpha: 0.2 }],
  powerCreep: () => [{ size: 400, tint: 0xff5555 }],
  invaderCore: () => [{ size: 800, tint: 0xff8080 }],
  keeperLair: () => [{ size: 800, alpha: 0.5, tint: 0xff0000 }],
  portal: () => [{ size: 700, alpha: 0.7, tint: 0x9999ff }],
  powerBank: () => [{ size: 800, tint: 0xff8080 }],
  nuke: (obj, gameTime) => {
    const landTime = num(obj, "landTime");
    const landed = landTime !== undefined && gameTime !== undefined && gameTime >= landTime;
    return [!landed && { size: 700, tint: 0xff4444 }];
  },
  // 赛季服 metadata（reactor 外圈的三个小光点随外圈旋转，取未旋转时的位置）
  reactor: () => [{ size: 800, alpha: 0.8, tint: 0x67a700 }],
};

/** 房间里所有对象的发光图元（buildRoomScene 在光照开启时用）；不带 objectId，不参与点选 */
export function officialLighting(state: RoomState, animation?: AnimationContext): Primitive[] {
  const url = officialTextureUrl("glow");
  const out: Primitive[] = [];
  for (const [id, obj] of Object.entries(state.objects)) {
    const type = obj["type"];
    if (typeof type !== "string" || !Object.hasOwn(RULES, type)) continue;
    if (num(obj, "x") === undefined || num(obj, "y") === undefined) continue;
    const { x, y } = center(obj);
    let i = 0;
    const fired = animation !== undefined && type === "tower" && towerShot(obj) !== undefined;
    for (const glow of RULES[type]!(obj, state.gameTime)) {
      if (!glow) continue;
      const size = u(glow.size);
      const alpha = (glow.alpha ?? 1) * GLOW_GAIN;
      out.push({
        key: `lighting/${id}/${i++}`,
        kind: "image",
        layer: LIGHTING_LAYER,
        x: x - size / 2,
        y: y - size / 2,
        width: size,
        height: size,
        url,
        blend: "add",
        alpha,
        ...(glow.tint === undefined ? {} : { tint: glow.tint }),
        ...(fired && animation
          ? { animation: animationOf(animation, [pulse("alpha", alpha, GLOW_GAIN, TOWER_FLASH.up * animation.tickMs, TOWER_FLASH.down * animation.tickMs)]) }
          : {}),
      } satisfies ImagePrimitive);
    }
  }
  return out;
}
