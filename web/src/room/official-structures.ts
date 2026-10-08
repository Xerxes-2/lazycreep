/**
 * #45：玩家建筑的官方画法（terminal、link、lab、factory、nuker、observer、power spawn、extractor、container）。
 * 照 screeps/renderer `metadata/src/objects/<类型>.metadata.js`（commit 见 public/official-art/SOURCE.txt）改写；
 * lighting 图层（glow）、补间与闪烁都不做，闪烁的部件取一个静态透明度。并入 official-painters.ts 的映射表。
 */
import type { Color } from "../scene/scene.ts";
import type { ObjectPainter, ObjectPainters, PrimitiveDraft } from "./room-paint.ts";
import { center, num } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";
import { ownerBadge } from "./owner-badge.ts"; // #48
import {
  ENERGY,
  capacityOf,
  circle,
  clamp01,
  ellipsePoints,
  officialRect,
  officialSprite,
  ownerTint,
  progressArc,
  progressPie,
  storeAmounts,
  storeTotal,
  zLayer,
} from "./official-sprite.ts";

const POWER = 0xf41f33;
const WHITE = 0xffffff;
/** 官方 constants.TERMINAL_CAPACITY */
const TERMINAL_CAPACITY = 300_000;

const isCooldown = (obj: RoomObject, gameTime: number | undefined) => {
  const cooldownTime = num(obj, "cooldownTime");
  return cooldownTime !== undefined && gameTime !== undefined && cooldownTime >= gameTime;
};

const notUndefined = (d: PrimitiveDraft | undefined): d is PrimitiveDraft => d !== undefined;

/**
 * container / factory 的资源柱：底边在格子中心下方 25，按 storeCapacity（没有时按总量）从下往上，
 * 白色（其他资源）垫底，其上红色（power + energy）、黄色（energy）。
 */
function resourceColumn(obj: RoomObject, width: number, fullHeight: number, energyColor: Color, layer: number): PrimitiveDraft[] {
  const store = storeAmounts(obj);
  const total = storeTotal(obj);
  const capacity = num(obj, "storeCapacity") || total;
  if (!capacity) return [];
  const energy = store["energy"] ?? 0;
  const power = store["power"] ?? 0;
  const bar = (part: string, amount: number, fill: Color) => {
    const height = Math.min(fullHeight, (amount * fullHeight) / capacity);
    return officialRect(obj, part, -width / 2, 25 - height, width, height, fill, layer);
  };
  const prims: PrimitiveDraft[] = [];
  if (energy + power < total) prims.push(bar("other", total, WHITE));
  if (power > 0) prims.push(bar("power", power + energy, POWER));
  if (energy > 0) prims.push(bar("energy", energy, energyColor));
  return prims;
}

// ---- container（container.metadata.js：两层 rectangle 贴图 + 资源柱） ----
const container: ObjectPainter = (obj) => {
  const layer = zLayer(4);
  return [
    officialSprite(obj, "border", "rectangle", { width: 60, height: 70, tint: 0x181818, layer }),
    officialSprite(obj, "inner", "rectangle", { width: 40, height: 50, tint: 0x555555, layer }),
    ...resourceColumn(obj, 40, 50, ENERGY, layer),
  ];
};

// ---- terminal（terminal.metadata.js：边框 + 主体 + 箭头（冷却时变淡）+ 三个同心资源方块） ----
const ENERGY_RECT_FULL_SIZE = 76;
const terminal: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(16);
  const store = storeAmounts(obj);
  const total = storeTotal(obj);
  const capacity = num(obj, "storeCapacity") || TERMINAL_CAPACITY;
  const energy = store["energy"] ?? 0;
  const power = store["power"] ?? 0;
  const side = (amount: number) => Math.min(ENERGY_RECT_FULL_SIZE, (ENERGY_RECT_FULL_SIZE * amount) / capacity);
  const square = (part: string, size: number, fill: Color) => (size > 0 ? officialRect(obj, part, -size / 2, -size / 2, size, size, fill, layer) : undefined);
  return [
    officialSprite(obj, "border", "terminal-border", { width: 200, tint: ownerTint(obj, ctx), layer }),
    officialSprite(obj, "body", "terminal", { width: 200, layer }),
    officialSprite(obj, "arrows", "terminal-arrows", { width: 200, layer, ...(isCooldown(obj, ctx.gameTime) ? { alpha: 0.1 } : {}) }),
    square("other", total <= energy + power ? 0 : side(total), WHITE),
    square("power", side(energy + power), POWER),
    square("energy", side(energy), ENERGY),
  ].filter(notUndefined);
};

// ---- link（link.metadata.js：边框 + 主体 + 按能量缩放的能量菱形） ----
const link: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(9);
  const cap = capacityOf(obj, "energy");
  const scale = cap ? clamp01((storeAmounts(obj)["energy"] ?? 0) / cap) : 0;
  const prims = [
    officialSprite(obj, "border", "link-border", { width: 100, tint: ownerTint(obj, ctx), layer }),
    officialSprite(obj, "body", "link", { width: 100, layer }),
  ];
  if (scale > 0) prims.push(officialSprite(obj, "energy", "link-energy", { width: 50 * scale, layer }));
  return prims;
};

// ---- lab（lab.metadata.js：主体 + 矿物槽（灰）+ 按矿物量缩放的矿物（白）+ 能量条） ----
/** lab-mineral.svg 的原始边长（128）× 官方 scale 0.6875 */
const LAB_MINERAL_SIZE = 128;
const LAB_MINERAL_SCALE = 0.6875;
const LAB_ENERGY = { y: 32, width: 67, height: 10 };
const lab: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(15);
  const store = storeAmounts(obj);
  const mineralType = Object.keys(store).find((k) => k !== "energy" && store[k]);
  let mineralScale = 0;
  if (mineralType) {
    const capacities = obj["storeCapacityResource"];
    let declared = 0;
    if (typeof capacities === "object" && capacities !== null) for (const v of Object.values(capacities)) if (typeof v === "number") declared += v;
    const mineralCapacity = capacityOf(obj, mineralType) || (num(obj, "storeCapacity") ?? 0) - declared;
    if (mineralCapacity > 0) mineralScale = (LAB_MINERAL_SCALE * (store[mineralType] ?? 0)) / mineralCapacity;
  }
  const energyCap = capacityOf(obj, "energy");
  const energyWidth = energyCap ? (LAB_ENERGY.width * (store["energy"] ?? 0)) / energyCap : 0;
  // 矿物贴图以底边中点对准格子中心下方 25
  const mineral = (part: string, scale: number, tint?: Color) => {
    const size = LAB_MINERAL_SIZE * scale;
    return officialSprite(obj, part, "lab-mineral", { width: size, anchorY: 1 - 25 / size, layer, ...(tint === undefined ? {} : { tint }) });
  };
  const prims: PrimitiveDraft[] = [
    officialSprite(obj, "body", "lab", { width: 200, tint: ownerTint(obj, ctx), layer }),
    mineral("mineral-slot", LAB_MINERAL_SCALE, 0x777777),
  ];
  if (mineralScale > 0) prims.push(mineral("mineral", Math.min(LAB_MINERAL_SCALE, mineralScale)));
  if (energyWidth > 0) {
    const w = Math.min(LAB_ENERGY.width, energyWidth);
    prims.push(officialRect(obj, "energy", -w / 2, LAB_ENERGY.y, w, LAB_ENERGY.height, ENERGY, layer));
  }
  return prims;
};

// ---- factory（factory.metadata.js：边框 + 主体 + 高光 + 等级 + 资源柱） ----
const FACTORY_LEVELS = ["factory-lvl1", "factory-lvl2", "factory-lvl3", "factory-lvl4", "factory-lvl5"] as const;
/** 官方 PWR_OPERATE_FACTORY */
const PWR_OPERATE_FACTORY = 19;
function powerOperated(obj: RoomObject, gameTime: number | undefined): boolean {
  const effects = obj["effects"];
  if (typeof effects !== "object" || effects === null) return false;
  return Object.values(effects).some((e) => {
    if (typeof e !== "object" || e === null) return false;
    const { power, endTime } = e as Record<string, unknown>;
    return power === PWR_OPERATE_FACTORY && typeof endTime === "number" && gameTime !== undefined && endTime >= gameTime;
  });
}
const factory: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(7);
  const level = Math.max(0, Math.min(5, Math.floor(num(obj, "level") ?? 0)));
  const prims: PrimitiveDraft[] = [
    officialSprite(obj, "border", "factory-border", { width: 200, tint: ownerTint(obj, ctx), layer }),
    officialSprite(obj, "body", "factory", { width: 200, layer }),
    officialSprite(obj, "highlight", "factory-highlight", { width: 200, alpha: 0.4, layer }),
    officialSprite(obj, "level0", "factory-lvl0", { width: 200, layer }),
  ];
  // 官方在没被 PWR_OPERATE_FACTORY 作用时让等级标记 0↔1 闪烁；静态画面取一半透明
  const levelName = FACTORY_LEVELS[level - 1];
  if (levelName) prims.push(officialSprite(obj, "level", levelName, { width: 200, layer, ...(powerOperated(obj, ctx.gameTime) ? {} : { alpha: 0.5 }) }));
  prims.push(officialSprite(obj, "inner", "rectangle", { width: 50, tint: 0x555555, layer }));
  prims.push(...resourceColumn(obj, 50, 50, 0xfadf7e, layer));
  return prims;
};

// ---- nuker（nuker.metadata.js：边框 + 主体（上移 40）+ 按能量放大的三角 + 按 G 变宽的白条） ----
const NUKER_TRIANGLE = { y: 10, width: 86, height: 118 };
const NUKER_G = { y: 35, width: 80, height: 15 };
const nuker: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(7);
  const store = storeAmounts(obj);
  // 贴图中心在格子中心上方 40
  const raised = { width: 300, anchorY: 0.5 + 40 / 300, layer };
  const prims: PrimitiveDraft[] = [
    officialSprite(obj, "border", "nuker-border", { ...raised, tint: ownerTint(obj, ctx) }),
    officialSprite(obj, "body", "nuker", raised),
  ];
  const energyCap = capacityOf(obj, "energy");
  const k = energyCap ? clamp01((store["energy"] ?? 0) / energyCap) : 0;
  if (k > 0) {
    const { x, y } = center(obj);
    const w = (NUKER_TRIANGLE.width * k) / 100;
    const h = (NUKER_TRIANGLE.height * k) / 100;
    const base = y + NUKER_TRIANGLE.y / 100;
    prims.push({ part: "energy", kind: "polygon", layer, points: [x - w / 2, base, x, base - h, x + w / 2, base], fill: ENERGY });
  }
  const gCap = capacityOf(obj, "G");
  const gWidth = gCap ? NUKER_G.width * clamp01((store["G"] ?? 0) / gCap) : 0;
  if (gWidth > 0) prims.push(officialRect(obj, "ghodium", -gWidth / 2, NUKER_G.y, gWidth, NUKER_G.height, WHITE, layer));
  return prims;
};

// ---- observer（observer.metadata.js：主人色描边的椭圆 + 主人色的眼睛；眼睛的转动不做） ----
const observer: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(10);
  const color = ownerTint(obj, ctx);
  return [
    { part: "body", kind: "polygon", layer, points: ellipsePoints(obj, 45, 40), fill: 0x111111, stroke: { color, width: 0.05 } },
    { part: "eye", kind: "polygon", layer, points: ellipsePoints(obj, 20, 20), fill: color },
  ];
};

// ---- powerSpawn（powerSpawn.metadata.js：三层圆 + 徽章 + power 弧 + 按能量缩放的能量圆） ----
const powerSpawn: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(12);
  const { x, y } = center(obj);
  const store = storeAmounts(obj);
  const powerCap = capacityOf(obj, "power");
  const energyCap = capacityOf(obj, "energy");
  const powerFraction = powerCap ? (store["power"] ?? 0) / powerCap : 0;
  const energyScale = energyCap ? clamp01((store["energy"] ?? 0) / energyCap) : 0;
  const prims: PrimitiveDraft[] = [
    { part: "outer", kind: "circle", layer, x, y, radius: 0.75, fill: 0x222222, stroke: { color: 0xcccccc, width: 0.07 } },
    { part: "ring", kind: "circle", layer, x, y, radius: 0.68, fill: 0x222222, stroke: { color: POWER, width: 0.1 } },
    circle(obj, "inner", 59, 0x181818, layer),
    ...ownerBadge(obj, ctx, { radius: 38, layer }),
  ];
  const arc = progressArc(obj, "power", 50, powerFraction, POWER, 10, layer);
  if (arc) prims.push(arc);
  if (energyScale > 0) prims.push(circle(obj, "energy", 38 * energyScale, ENERGY, layer));
  return prims;
};

// ---- extractor（extractor.metadata.js：主人色贴图；冷却时的旋转不做） ----
const extractor: ObjectPainter = (obj, ctx) => [officialSprite(obj, "body", "extractor", { width: 200, tint: ownerTint(obj, ctx), layer: zLayer(0) })];

export const OFFICIAL_STRUCTURE_PAINTERS: ObjectPainters = {
  container,
  terminal,
  link,
  lab,
  factory,
  nuker,
  observer,
  powerSpawn,
  extractor,
};

// ---- controller 的升级进度（controller.metadata.js 的 siteProgress：徽章上的白色扇形；画法本身在 official-painters.ts） ----
/** 官方 constants.CONTROLLER_LEVELS：升到下一级所需的进度；8 级没有 */
const CONTROLLER_LEVELS: Readonly<Record<number, number>> = { 1: 200, 2: 45_000, 3: 135_000, 4: 405_000, 5: 1_215_000, 6: 3_645_000, 7: 10_935_000 };
export function controllerProgress(obj: RoomObject, layer: number): PrimitiveDraft[] {
  const total = CONTROLLER_LEVELS[num(obj, "level") ?? 0];
  const progress = num(obj, "progress") ?? 0;
  if (!total || !(progress > 0)) return [];
  // 官方的闪烁从 0.8 开始，静态画面取 0.8
  const pie = progressPie(obj, "progress", 37, progress / total, WHITE, layer, 0.8);
  return pie ? [pie] : [];
}
