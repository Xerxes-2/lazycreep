/**
 * 动作动画（Action Animation，ADR 0008）：照官方渲染器（screeps/renderer，ISC）`engine/src/lib/processors/creepActions.js`
 * 与 `tower.metadata.js` 的范围、画法与时长，见 #53 Further Notes 的表。
 *
 * 两部分：
 * - 通用构件（光束 {@link beam}、目标处闪光 {@link coverFlash}、“去—回”的 {@link pulse}、转向 {@link turnAnimation}）：
 *   产出带动画描述的图元草稿，终态不可见（光束长度为 0、闪光透明度为 0），只在有 AnimationContext 时调用。
 * - {@link actionEffects}：房间里各对象本 Tick 的动作产生的独立图元（不属于对象、不参与点选），
 *   按对象类型查 {@link ACTION_EFFECTS}。塔（#55）是第一个使用者；creep 的动作（#56）在表里加条目。
 *
 * 改变对象自身图元的动画（炮塔转向、冲撞、移动补间）不在这里，而是在对象的画法里给自己的图元加 animation。
 */
import { officialArtUrl } from "../art/official-art.ts";
import { officialTextureUrl } from "../art/official-textures.ts";
import type { AnimatedProperty, Color, Primitive, PrimitiveAnimation, Tween } from "../scene/scene.ts";
import { LAYER, center, num, type AnimationContext, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject, RoomState } from "./room-state.ts";
import { u } from "./official-sprite.ts";

/** 官方 effects 图层：对象（含 rampart）与光照之上 */
export const EFFECTS_LAYER = LAYER.rampart + 1;

/** 官方 creepActions 的 COLORS */
export const ACTION_COLORS = {
  /** 采集、建造、升级、维修 */
  work: 0xffe533,
  attack: 0xff3333,
  attackAndHeal: 0xffff33,
  heal: 0x2ce328,
  rangedAttack: 0x3c75c7,
  reserveController: 0xb99cfb,
  /** 群体远程攻击的圆环（官方 creep.metadata 的 rangedMassAttack 圆） */
  rangedMassAttack: 0x5d80b2,
} as const;

/** 光束的时长占 Tick 间隔的比例（官方 TWEEN_DURATION） */
export const BEAM_DURATION = 0.6;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 动画描述：id 取本 Tick，所以下一个 Tick 同样的动作会重播 */
export function animationOf(anim: AnimationContext, tweens: readonly Tween[], origin?: Point): PrimitiveAnimation {
  return { id: anim.tick, tweens, ...(origin ? { originX: origin.x, originY: origin.y } : {}) };
}

/**
 * “去—回”：从 from 用 upMs 升到 peak，再用 downMs 回到终态（图元自身的值）；先等 delay 毫秒。
 * 官方的 Sequence(AlphaTo(peak, up), AlphaTo(final, down))。
 */
export function pulse(property: AnimatedProperty, from: number, peak: number, upMs: number, downMs: number, delay = 0): Tween {
  return { property, from, ...(delay ? { delay } : {}), steps: [{ to: peak, duration: upMs }, { duration: downMs }] };
}

/**
 * 转向：图元绕 origin 从“比终态多转 fromTurn 弧度”转到终态，durationMs 毫秒，线性（官方 RotateTo）。
 * fromTurn 先规整到 (-π, π]，走近的一边；为 0 时返回 undefined（不必动）。
 */
export function turnAnimation(anim: AnimationContext, origin: Point, fromTurn: number, durationMs: number): PrimitiveAnimation | undefined {
  let turn = fromTurn % (2 * Math.PI);
  if (turn > Math.PI) turn -= 2 * Math.PI;
  else if (turn <= -Math.PI) turn += 2 * Math.PI;
  if (Math.abs(turn) < 1e-9) return undefined;
  return animationOf(anim, [{ property: "turn", from: turn, steps: [{ duration: durationMs }] }], origin);
}

export interface BeamOptions {
  readonly color: Color;
  /** 官方单位（100 = 1 格）：creep 12，塔 18 */
  readonly width: number;
  /** 毫秒；默认 BEAM_DURATION × Tick 间隔 */
  readonly duration?: number;
}

/** 光束外圈（官方是同一条线加 BlurFilter(5)、透明度 0.7）：更宽的半透明线 */
const BEAM_HALO_EXTRA = u(10);
const BEAM_HALO_ALPHA = 0.35;

/**
 * 光束（官方 pushRangedShotActionWithBlur）：一条清晰线叠一条更宽的半透明线，加色混合。
 * 前一半时间从源点伸到目标，后一半从源点一端收向目标；终态长度为 0。部件名 `<part>`、`<part>-halo`。
 */
export function beam(part: string, from: Point, to: Point, options: BeamOptions, anim: AnimationContext): PrimitiveDraft[] {
  const half = (options.duration ?? BEAM_DURATION * anim.tickMs) / 2;
  const animation = animationOf(anim, [
    { property: "trimEnd", from: 0, steps: [{ duration: half }] },
    { property: "trimStart", from: 0, delay: half, steps: [{ duration: half }] },
  ]);
  const line = (suffix: string, width: number, alpha?: number): PrimitiveDraft => ({
    part: part + suffix,
    kind: "line",
    layer: EFFECTS_LAYER,
    points: [from.x, from.y, to.x, to.y],
    stroke: { color: options.color, width, ...(alpha === undefined ? {} : { alpha }) },
    blend: "add",
    trimStart: 1,
    trimEnd: 1,
    animation,
  });
  return [line("-halo", u(options.width) + BEAM_HALO_EXTRA, BEAM_HALO_ALPHA), line("", u(options.width))];
}

export interface FlashTiming {
  /** 开始前等待的毫秒数 */
  readonly delay?: number;
  /** 从动作开始算起，闪光结束的毫秒数 */
  readonly end: number;
}

/**
 * 目标处的 cover 闪光（官方 createCoverSprite + createCoverSpriteAction）：cover（透明度 0.3，染色）、
 * flare2（300²，加色，0.05，染色）与光照层的 glow（500²，0.5）；整体在 delay 之后用 1/4 时间升到峰值、
 * 3/4 时间降到 0。部件名 `<part>-cover`、`<part>-flare`、`<part>-glow`（没有光照时没有 glow）。
 */
export function coverFlash(part: string, at: Point, color: Color, timing: FlashTiming, anim: AnimationContext, options: EffectOptions): PrimitiveDraft[] {
  const delay = timing.delay ?? 0;
  const length = Math.max(0, timing.end - delay);
  const sprite = (suffix: string, url: string, size: number, peak: number, layer: number, tint?: Color, add = false): PrimitiveDraft => {
    const side = u(size);
    return {
      part: part + suffix,
      kind: "image",
      layer,
      x: at.x - side / 2,
      y: at.y - side / 2,
      width: side,
      height: side,
      url,
      alpha: 0,
      ...(tint === undefined ? {} : { tint }),
      ...(add ? { blend: "add" as const } : {}),
      animation: animationOf(anim, [pulse("alpha", 0, peak, length / 4, (3 * length) / 4, delay)]),
    };
  };
  const out = [
    sprite("-cover", officialArtUrl("cover"), 128, 0.3, EFFECTS_LAYER, color),
    sprite("-flare", officialTextureUrl("flare2"), 300, 0.05, EFFECTS_LAYER, color, true),
  ];
  const { lighting } = options;
  if (lighting) out.push(sprite("-glow", officialTextureUrl("glow"), 500, 0.5 * lighting.gain, lighting.layer, undefined, true));
  return out;
}

/** actionLog 里某个动作的目标格中心；没有这个动作时 undefined */
export function actionTarget(obj: RoomObject | undefined, action: string): Point | undefined {
  const log = obj?.["actionLog"];
  if (typeof log !== "object" || log === null) return undefined;
  const target = (log as Record<string, unknown>)[action];
  if (typeof target !== "object" || target === null) return undefined;
  const { x, y } = target as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" ? { x: x + 0.5, y: y + 0.5 } : undefined;
}

/** 塔本 Tick 的射击：官方 tower.metadata 的 shotAnim（attack || heal || repair） */
export const TOWER_ACTIONS = ["attack", "heal", "repair"] as const;
export type TowerAction = (typeof TOWER_ACTIONS)[number];

export function towerShot(obj: RoomObject | undefined): { readonly action: TowerAction; readonly target: Point } | undefined {
  for (const action of TOWER_ACTIONS) {
    const target = actionTarget(obj, action);
    if (target) return { action, target };
  }
  return undefined;
}

/** 塔射击时塔身闪光的升、降时长占 Tick 间隔的比例（官方 0.1td 升、0.3td 降） */
export const TOWER_FLASH = { up: 0.1, down: 0.3 } as const;

const TOWER_BEAM: Readonly<Record<TowerAction, Color>> = {
  attack: ACTION_COLORS.rangedAttack,
  heal: ACTION_COLORS.heal,
  repair: ACTION_COLORS.work,
};

export interface EffectOptions {
  /** 光照开启时给出光照层与增益（official-lighting.ts 的 LIGHTING_LAYER、GLOW_GAIN）：目标闪光的 glow 属于光照层 */
  readonly lighting: { readonly layer: number; readonly gain: number } | undefined;
}

/** id 是对象在房间状态里的 id（取上一个状态里的同一对象用） */
type EffectRule = (obj: RoomObject, anim: AnimationContext, options: EffectOptions, id: string) => readonly PrimitiveDraft[];

const tower: EffectRule = (obj, anim, options) => {
  const out: PrimitiveDraft[] = [];
  const origin = center(obj);
  for (const action of TOWER_ACTIONS) {
    const target = actionTarget(obj, action);
    if (!target) continue;
    out.push(...beam(`${action}-beam`, origin, target, { color: TOWER_BEAM[action], width: 18 }, anim));
    // 塔维修与 creep 的维修一样在目标处闪黄光：0.3td 开始、0.9td 结束
    if (action === "repair") {
      out.push(...coverFlash("repair-target", target, ACTION_COLORS.work, { delay: 0.3 * anim.tickMs, end: 0.9 * anim.tickMs }, anim, options));
    }
  }
  if (out.length === 0) return out;
  // 塔身的 flare1（400²，加色）：0 → 0.2 → 0
  const side = u(400);
  out.push({
    part: "flare",
    kind: "image",
    layer: EFFECTS_LAYER,
    x: origin.x - side / 2,
    y: origin.y - side / 2,
    width: side,
    height: side,
    url: officialTextureUrl("flare1"),
    blend: "add",
    alpha: 0,
    animation: animationOf(anim, [pulse("alpha", 0, 0.2, TOWER_FLASH.up * anim.tickMs, TOWER_FLASH.down * anim.tickMs)]),
  });
  return out;
};

/** creep 的光束类动作（官方 creepActions）：动作、颜色与有没有目标闪光 */
const CREEP_BEAMS: readonly { readonly action: string; readonly color: Color; readonly targetFlash: boolean }[] = [
  { action: "rangedAttack", color: ACTION_COLORS.rangedAttack, targetFlash: false },
  { action: "rangedHeal", color: ACTION_COLORS.heal, targetFlash: false },
  { action: "build", color: ACTION_COLORS.work, targetFlash: true },
  { action: "upgradeController", color: ACTION_COLORS.work, targetFlash: true },
  { action: "repair", color: ACTION_COLORS.work, targetFlash: true },
];

/** 群体远程攻击圆环的半径（官方单位） */
const MASS_ATTACK_RADIUS = 300;

/**
 * creep 动作时所在的格子中心：官方 creepActions 在移动补间开始前取 creep 容器的位置，即上一个 Tick 的格子
 * （游戏也在移动前结算动作）。上一个状态里没有它、或位移超过一格（跨出口、刚出生）时取当前位置。
 */
function actingPosition(obj: RoomObject, id: string, anim: AnimationContext): Point {
  const now = center(obj);
  const before = anim.previous.objects[id];
  if (!before) return now;
  const bx = num(before, "x");
  const by = num(before, "y");
  if (bx === undefined || by === undefined) return now;
  const dx = bx + 0.5 - now.x;
  const dy = by + 0.5 - now.y;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= 1 ? { x: bx + 0.5, y: by + 0.5 } : now;
}

/**
 * creep 与 powerCreep（官方两者都用 creepActions）：远程攻击、远程治疗、建造、升级、维修的光束与目标闪光，
 * 群体远程攻击的圆环。冲撞、采集与预定的闪光、受击闪光在 #58；拆除、攻击控制器、transfer / withdraw 不画。
 */
const creep: EffectRule = (obj, anim, options, id) => {
  const out: PrimitiveDraft[] = [];
  const from = actingPosition(obj, id, anim);
  const flash = { delay: 0.3 * anim.tickMs, end: 0.9 * anim.tickMs };
  for (const { action, color, targetFlash } of CREEP_BEAMS) {
    const target = actionTarget(obj, action);
    if (!target) continue;
    out.push(...beam(`${action}-beam`, from, target, { color, width: 12 }, anim));
    if (targetFlash) out.push(...coverFlash(`${action}-target`, target, color, flash, anim, options));
  }
  const log = obj["actionLog"];
  if (typeof log === "object" && log !== null && (log as Record<string, unknown>)["rangedMassAttack"]) {
    out.push(massAttackRing(center(obj), from, anim));
  }
  return out;
};

/**
 * 群体远程攻击（官方 creep.metadata 的 rangedMassAttack）：半径 3 格的实心圆，加色，scale 0→1、透明度 0.4→0，
 * easeOutQuad，0.6td。官方的圆挂在 creep 上，creep 本 Tick 移动时随它从旧格（from）滑到新格（easeInOutQuad，td）。
 */
function massAttackRing(at: Point, from: Point, anim: AnimationContext): PrimitiveDraft {
  const ms = BEAM_DURATION * anim.tickMs;
  const tweens: Tween[] = [
    { property: "scale", from: 0, steps: [{ duration: ms, easing: "easeOutQuad" }] },
    { property: "alpha", from: 0.4, steps: [{ duration: ms, easing: "easeOutQuad" }] },
  ];
  const slide = (property: "offsetX" | "offsetY", delta: number) => {
    if (delta !== 0) tweens.push({ property, from: delta, steps: [{ duration: anim.tickMs, easing: "easeInOutQuad" }] });
  };
  slide("offsetX", from.x - at.x);
  slide("offsetY", from.y - at.y);
  return {
    part: "rangedMassAttack",
    kind: "circle",
    layer: EFFECTS_LAYER,
    x: at.x,
    y: at.y,
    radius: u(MASS_ATTACK_RADIUS),
    fill: ACTION_COLORS.rangedMassAttack,
    blend: "add",
    alpha: 0,
    animation: animationOf(anim, tweens, at),
  };
}

/** 各类对象本 Tick 的动作产生的独立图元 */
export const ACTION_EFFECTS: Readonly<Record<string, EffectRule>> = { tower, creep, powerCreep: creep };

/**
 * 房间里所有对象本 Tick 的动作效果图元（key 为 `action/<对象 id>/<部件>`）。不带 objectId：光束等不参与点选。
 */
export function actionEffects(state: RoomState, anim: AnimationContext, options: EffectOptions): Primitive[] {
  const out: Primitive[] = [];
  for (const [id, obj] of Object.entries(state.objects)) {
    const type = obj["type"];
    if (typeof type !== "string" || !Object.hasOwn(ACTION_EFFECTS, type)) continue;
    if (num(obj, "x") === undefined || num(obj, "y") === undefined) continue;
    for (const { part, ...draft } of ACTION_EFFECTS[type]!(obj, anim, options, id)) {
      out.push({ ...draft, key: `action/${id}/${part}` } as Primitive);
    }
  }
  return out;
}
