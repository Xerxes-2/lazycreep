/**
 * 官方画风的光照（#49、#64，ADR 0009）：照官方渲染器（screeps/renderer，ISC，commit a2db4a7）
 * `metadata/src/index.js` 的 lighting 图层与 `metadata/src/objects/*.metadata.js` 里 `layer: 'lighting'` 的部件。
 *
 * 官方的 lighting 图层是一张光照图：不透明的环境光底色（0x808080，普通混合）之上，层内其余元素一律以 SCREEN 叠加；
 * 整层经滤镜以 MULTIPLY 盖住 terrain 与 objects 图层，effects 图层（rampart、工地、名字、闪光）不受影响。
 * 没被照到的对象亮度减半，glow 最多把亮度提回原色、不会更亮。我们照做：
 * - Scene 的光照组（`group: "lighting"` 的图元 + `Scene.lighting`），适配层画成一个以 MULTIPLY 混合的容器，
 *   层级 LAYER.lighting（对象与 creep 之上，rampart 与 effects 之下）。
 * - 底色（环境光、墙的模糊阴影与墙本身的 0x808080）来自地形，见 official-terrain.ts 的 LIGHTING_BASE_KEY；
 *   光照打开时地形贴图与道路颜色不再预乘环境光。
 * - 这里给出各对象的光：glow（`glow.png`，线性径向衰减）与只照对象自己的遮罩（creep-mask、powerCreep 与
 *   deposit 的贴图、tombstone / ruin 的 tombstone-resource、掉落资源的 resourceCircle），按官方 alpha 原样、
 *   以 SCREEN 叠加。#49 的近似（加色、GLOW_GAIN、不画小 glow 与遮罩）作废。
 *
 * 取舍：
 * - 闪烁（flickering）、缩放与 spawn 孵化时的闪光取静止时的样子（ADR 0008 不做常驻动画）。tower 开火时的 glow 闪光（#55）
 *   随动画开关：开火的塔的 `light` glow 透明度 0.5 → 1 →（0.1td 升、0.3td 降）回到 0.5。
 * - 官方 lighting 为 low 时整层 alpha 0.5，不做。
 * - 遮罩与 glow 不带 objectId（不参与点选），key 为 `lighting/<id>/<序号>`，随移动补间与冲撞位移（movement-tween.ts）；
 *   powerCreep 的遮罩是身体贴图，随身体朝向一起转。
 */
import { officialArtUrl } from "../art/official-art.ts";
import { officialTextureUrl } from "../art/official-textures.ts";
import type { Color, ImagePrimitive, Primitive } from "../scene/scene.ts";
import { LAYER, center, num, type PaintContext, type PrimitiveDraft } from "./room-paint.ts";
import { TOWER_FLASH, animationOf, pulse, towerShot } from "./action-animation.ts";
import { OFFICIAL_CREEP_PAINTERS } from "./official-creeps.ts";
import { capacityOf, energyStore, storeTotal, u } from "./official-sprite.ts";
import { OFFICIAL_WORLD_PAINTERS } from "./official-world-objects.ts";
import type { RoomObject, RoomState } from "./room-state.ts";

/** 光照组的层级（适配层的容器位置，也是底色的层级） */
export const LIGHTING_LAYER = LAYER.lighting;
/** 光照组里 glow 与遮罩的层级：盖在底色之上 */
export const LIGHT_LAYER = LIGHTING_LAYER + 0.5;

/** 光照组里的光：滤色混合 */
export const LIGHT = { group: "lighting", layer: LIGHT_LAYER, blend: "screen" } as const;

interface Glow {
  /** 官方单位（100 = 1 格），方形 */
  readonly size: number;
  readonly alpha?: number;
  readonly tint?: Color;
  /** 官方 `id: 'light'`：塔开火时闪一下 */
  readonly flash?: true;
}

/** 只照对象自己的遮罩：对象画法里同形的部件 */
interface Mask {
  readonly mask: PrimitiveDraft;
}

type Light = Glow | Mask;
type LightRule = (obj: RoomObject, ctx: PaintContext) => readonly (Light | false | undefined)[];

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

/** extension 按容量的小 glow（官方按 storeCapacityResource.energy 恰好等于 50 / 100 / 200） */
const EXTENSION_GLOW: Readonly<Record<number, number>> = { 50: 200, 100: 220, 200: 250 };

const isNpc = (user: unknown) => user === "2" || user === "3";

/** 以格子中心为中心、宽 size（官方单位）的遮罩贴图 */
function maskSprite(obj: RoomObject, url: string, size: number): Mask {
  const { x, y } = center(obj);
  const side = u(size);
  return { mask: { part: "mask", kind: "image", layer: LIGHT_LAYER, x: x - side / 2, y: y - side / 2, width: side, height: side, url } };
}

/** 对象画法里某个部件作为遮罩：去掉染色与透明度（官方的光照副本不染色、alpha 1） */
function maskOf(drafts: readonly PrimitiveDraft[], part: string): Mask | undefined {
  const draft = drafts.find((d) => d.part === part);
  if (!draft) return undefined;
  const { tint: _tint, alpha: _alpha, ...rest } = draft as PrimitiveDraft & { tint?: Color };
  return { mask: rest as PrimitiveDraft };
}

const stored: LightRule = (obj) => [storeTotal(obj) > 0 && { size: 200, alpha: 1 }, { size: 800, alpha: 0.5 }];

/** 每类对象的光（官方 metadata 的 lighting 部件，按 metadata 的先后） */
const RULES: Readonly<Record<string, LightRule>> = {
  spawn: (obj) => [energyStore(obj) > 0 && { size: 100, alpha: 1 }, { size: 600, alpha: 0.5 }],
  extension: (obj) => {
    const energy = energyStore(obj);
    const small = EXTENSION_GLOW[capacityOf(obj, "energy") ?? -1];
    return [energy > 0 && { size: 100, alpha: 1 }, energy > 0 && small !== undefined && { size: small, alpha: 0.7 }];
  },
  tower: (obj) => [energyStore(obj) > 0 && { size: 100, alpha: 1 }, { size: 600, alpha: 0.5, flash: true }],
  link: (obj) => [energyStore(obj) > 0 && { size: 100, alpha: 1 }, energyStore(obj) > 0 && { size: 400, alpha: 0.5 }],
  container: (obj) => [storeTotal(obj) > 0 && { size: 100, alpha: 1 }],
  storage: stored,
  terminal: stored,
  factory: stored,
  lab: (obj) => {
    const minerals = storeTotal(obj) - energyStore(obj) > 0;
    return [minerals && { size: 150, alpha: 1 }, minerals && { size: 500, alpha: 0.3 }];
  },
  nuker: () => [{ size: 100 }, { size: 800, alpha: 0.5 }],
  observer: () => [{ size: 800, alpha: 0.5 }],
  // 大 glow 没给宽度：glow.png 原始的 256 像素
  powerSpawn: () => [{ size: 150, alpha: 1 }, { size: 256, alpha: 0.5 }],
  controller: (obj) => [{ size: 1200, alpha: 0.5 }, typeof obj["user"] === "string" && { size: 500, alpha: 1 }],
  source: (obj) => [{ size: 800, alpha: 0.5, tint: 0xffff50 }, (num(obj, "energy") ?? 0) > 0 && { size: 150, tint: 0xffffff }],
  mineral: (obj) => {
    const kind = obj["mineralType"];
    return [{ size: 200, alpha: 1 }, { size: 700, alpha: 0.7, tint: (typeof kind === "string" && MINERAL_GLOW[kind]) || 0xffffff }];
  },
  deposit: (obj) => {
    const type = String(obj["depositType"]);
    const tint = DEPOSIT_GLOW[type];
    if (tint === undefined) return [];
    return [maskSprite(obj, officialArtUrl(`deposit-${type}` as Parameters<typeof officialArtUrl>[0]), 160), { size: 700, alpha: 1, tint }];
  },
  creep: (obj) => {
    const spawning = !!obj["spawning"];
    return [
      isNpc(obj["user"]) ? { size: 100, alpha: 0.5 } : !spawning && maskSprite(obj, officialTextureUrl("creep-mask"), 100),
      !spawning && { size: 400, alpha: 0.2 },
    ];
  },
  // 遮罩是身体贴图本身（随朝向转），不染色
  powerCreep: (obj, ctx) => [maskOf(OFFICIAL_CREEP_PAINTERS["powerCreep"]!(obj, ctx), "body"), { size: 400, alpha: 1, tint: 0xff5555 }],
  tombstone: (obj) => [maskSprite(obj, officialArtUrl("tombstone-resource"), 100)],
  ruin: (obj) => [maskSprite(obj, officialArtUrl("tombstone-resource"), 100)],
  // resourceCircle 的光照副本：与对象自己的圆同色同大
  energy: (obj, ctx) => [maskOf(OFFICIAL_WORLD_PAINTERS["energy"]!(obj, ctx), "body")],
  resource: (obj, ctx) => [maskOf(OFFICIAL_WORLD_PAINTERS["resource"]!(obj, ctx), "body")],
  invaderCore: () => [{ size: 100, alpha: 1 }, { size: 800, tint: 0xff8080 }],
  keeperLair: () => [{ size: 800, alpha: 0.5, tint: 0xff0000 }, { size: 150 }],
  portal: () => [{ size: 700, alpha: 0.7, tint: 0x9999ff }, { size: 150, tint: 0x7777ff }],
  powerBank: () => [{ size: 800, tint: 0xff8080 }],
  nuke: (obj, ctx) => {
    const landTime = num(obj, "landTime");
    const landed = landTime !== undefined && ctx.gameTime !== undefined && ctx.gameTime >= landTime;
    return [!landed && { size: 700, tint: 0xff4444 }];
  },
  // 赛季服 metadata（reactor 外圈的三个小光点随外圈旋转，取未旋转时的位置）
  reactor: () => [{ size: 800, alpha: 0.8, tint: 0x67a700 }],
};

/**
 * 房间里所有对象的光（buildRoomScene 在光照打开时用）：光照组里以滤色叠加的 glow 与遮罩。
 * 不带 objectId，不参与点选；底色在 official-terrain.ts。
 */
export function officialLighting(state: RoomState, ctx: PaintContext): Primitive[] {
  const url = officialTextureUrl("glow");
  const animation = ctx.animation;
  const out: Primitive[] = [];
  for (const [id, obj] of Object.entries(state.objects)) {
    const type = obj["type"];
    if (typeof type !== "string" || !Object.hasOwn(RULES, type)) continue;
    if (num(obj, "x") === undefined || num(obj, "y") === undefined) continue;
    const { x, y } = center(obj);
    const fired = animation !== undefined && type === "tower" && towerShot(obj) !== undefined;
    let i = 0;
    for (const light of RULES[type]!(obj, ctx)) {
      if (!light) continue;
      const key = `lighting/${id}/${i++}`;
      if ("mask" in light) {
        const { part: _part, ...draft } = light.mask;
        out.push({ ...draft, key, ...LIGHT } as Primitive);
        continue;
      }
      const size = u(light.size);
      const alpha = light.alpha ?? 1;
      out.push({
        key,
        kind: "image",
        x: x - size / 2,
        y: y - size / 2,
        width: size,
        height: size,
        url,
        alpha,
        ...LIGHT,
        ...(light.tint === undefined ? {} : { tint: light.tint }),
        ...(fired && light.flash && animation
          ? { animation: animationOf(animation, [pulse("alpha", alpha, 1, TOWER_FLASH.up * animation.tickMs, TOWER_FLASH.down * animation.tickMs)]) }
          : {}),
      } satisfies ImagePrimitive);
    }
  }
  return out;
}
