/**
 * #45：非玩家建筑的官方画法——自然物（mineral、deposit）、地面上的东西（掉落资源、墓碑、废墟、工地）、
 * NPC 与中立对象（keeper lair、invader core、power bank、portal）以及 nuke。
 * 照 screeps/renderer `metadata/src/objects/<类型>.metadata.js`（commit 见 public/official-art/SOURCE.txt）改写；
 * lighting 图层（glow）、补间与常驻动画都不做，动画部件取一个静态画面。并入 official-painters.ts 的映射表。
 */
import type { Color } from "../scene/scene.ts";
import { LAYER, center, hitsBar, num, type ObjectPainter, type ObjectPainters, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";
import { ENERGY, circle, clamp01, officialSprite, ownerTint, progressArc, progressPie, storeAmounts, storeTotal, u, zLayer } from "./official-sprite.ts";

/** 官方 effects 图层：盖在对象与 creep 之上 */
const EFFECTS = LAYER.rampart + 1;

// ---- mineral（mineral.metadata.js：前景色描边的背景色圆 + 矿物字母） ----
const MINERAL_COLORS: Readonly<Record<string, { readonly foreground: Color; readonly background: Color }>> = {
  L: { foreground: 0x89f4a5, background: 0x3f6147 },
  U: { foreground: 0x88d6f7, background: 0x1b617f },
  K: { foreground: 0x9370ff, background: 0x331a80 },
  Z: { foreground: 0xf2d28b, background: 0x594d33 },
  X: { foreground: 0xff7a7a, background: 0x4f2626 },
  O: { foreground: 0xcccccc, background: 0x4d4d4d },
  H: { foreground: 0xcccccc, background: 0x4d4d4d },
};
const mineral: ObjectPainter = (obj) => {
  const layer = zLayer(2);
  const { x, y } = center(obj);
  const kind = typeof obj["mineralType"] === "string" ? obj["mineralType"] : "";
  // 官方表里没有的矿物（赛季矿物由 #47 另画）用 O / H 的灰色
  const { foreground, background } = MINERAL_COLORS[kind] ?? MINERAL_COLORS["O"]!;
  const prims: PrimitiveDraft[] = [{ part: "body", kind: "circle", layer, x, y, radius: u(54), fill: background, stroke: { color: foreground, width: u(10) } }];
  if (kind) prims.push({ part: "kind", kind: "text", layer, x, y, text: kind, size: u(82), color: foreground });
  return prims;
};

// ---- deposit（deposit.metadata.js：按类型的贴图与染色 + 随开采次数变淡的填充） ----
const DEPOSIT_COLORS: Readonly<Record<string, Color>> = { biomass: 0x84b012, metal: 0x956f5c, mist: 0xda6bf5, silicon: 0x4ca7e5 };
const deposit: ObjectPainter = (obj) => {
  const layer = zLayer(1);
  const type = obj["depositType"];
  if (type !== "biomass" && type !== "metal" && type !== "mist" && type !== "silicon") return [];
  const tint = DEPOSIT_COLORS[type]!;
  const fillAlpha = Math.max(0, 0.6 - (num(obj, "harvested") ?? 0) / 100_000);
  const prims: PrimitiveDraft[] = [];
  if (fillAlpha > 0) prims.push(officialSprite(obj, "fill", `deposit-${type}-fill`, { width: 160, tint, alpha: fillAlpha, layer }));
  prims.push(officialSprite(obj, "body", `deposit-${type}`, { width: 160, tint, layer }));
  return prims;
};

// ---- 掉落资源（energy.metadata.js → resourceCircle processor：按数量 / 容量缩放的圆） ----
const RESOURCE_CIRCLE: Readonly<Record<string, { readonly color: Color; readonly radius: number }>> = {
  energy: { color: ENERGY, radius: 30 },
  power: { color: 0xf41f33, radius: 45 },
};
const droppedResource: ObjectPainter = (obj) => {
  const kind = typeof obj["resourceType"] === "string" ? obj["resourceType"] : "energy";
  const amount = num(obj, kind) ?? 0;
  const capacity = num(obj, `${kind}Capacity`) ?? 1250;
  const { color, radius } = RESOURCE_CIRCLE[kind] ?? { color: 0xffffff, radius: 45 };
  const scale = capacity !== 0 ? Math.min(1, amount / capacity) : 0;
  return scale > 0 ? [circle(obj, "body", radius * scale, color, zLayer(1))] : [];
};

// ---- tombstone / ruin（tombstone.metadata.js、ruin.metadata.js：随衰减变淡的外形 + 有资源时主人色的内芯） ----
function decayAlpha(obj: RoomObject, startKey: string, gameTime: number | undefined): number {
  const start = num(obj, startKey);
  const end = num(obj, "decayTime");
  if (gameTime === undefined || start === undefined || end === undefined || end <= start) return 1;
  return clamp01(1 - (gameTime - start) / (end - start));
}
function remains(shape: "tombstone-border" | "ruin", startKey: string): ObjectPainter {
  return (obj, ctx) => {
    const layer = zLayer(5);
    const alpha = decayAlpha(obj, startKey, ctx.gameTime);
    const prims: PrimitiveDraft[] = [];
    if (alpha > 0) prims.push({ ...officialSprite(obj, "body", shape, { width: 100, alpha, layer }), blend: "add" } as PrimitiveDraft);
    const resourceColor = storeTotal(obj) > 0 ? ownerTint(obj, ctx) : 0x000000;
    prims.push(officialSprite(obj, "resource", "tombstone-resource", { width: 100, tint: resourceColor, alpha: 0.8, layer }));
    return prims;
  };
}

// ---- constructionSite（constructionSite.metadata.js → siteProgress：主人色的圆环 + 按进度填充的扇形） ----
const constructionSite: ObjectPainter = (obj, ctx) => {
  const color = ownerTint(obj, ctx);
  const { x, y } = center(obj);
  // 官方的闪烁从 0.8 开始，静态画面取 0.8
  const alpha = 0.8;
  const prims: PrimitiveDraft[] = [{ part: "body", kind: "circle", layer: EFFECTS, x, y, radius: u(25), stroke: { color, width: u(10), alpha }, alpha }];
  const total = num(obj, "progressTotal") ?? 0;
  const pie = progressPie(obj, "progress", 20, total > 0 ? (num(obj, "progress") ?? 0) / total : 0, color, EFFECTS, alpha);
  if (pie) prims.push(pie);
  return prims;
};

// ---- keeperLair / portal（只有图形；官方的扩散动画取一个静态画面：外圈 + 色环 + 收缩到 0.3 的内圈） ----
const keeperLair: ObjectPainter = (obj) => {
  const layer = zLayer(3);
  return [circle(obj, "body", 60, 0x000000, layer), circle(obj, "ring", 50, 0x780207, layer), circle(obj, "core", 15, 0x000000, layer)];
};
const portal: ObjectPainter = (obj) => {
  const layer = zLayer(3);
  const half = (d: PrimitiveDraft) => ({ ...d, alpha: 0.5 }) as PrimitiveDraft;
  return [half(circle(obj, "body", 45, 0x111133, layer)), half(circle(obj, "ring", 40, 0x61c0ed, layer)), half(circle(obj, "core", 12, 0x111133, layer))];
};

// ---- powerBank（powerBank.metadata.js：贴图 + 面积与 power 成正比的红圆） ----
/** 官方 constants.POWER_BANK_CAPACITY_MAX */
const POWER_BANK_CAPACITY_MAX = 5000;
const powerBank: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(11);
  const power = storeAmounts(obj)["power"] ?? num(obj, "power") ?? 0;
  const radius = Math.sqrt((clamp01(power / POWER_BANK_CAPACITY_MAX) * 3000) / Math.PI);
  const { x, y } = center(obj);
  const prims: PrimitiveDraft[] = [officialSprite(obj, "body", "powerBank", { width: 200, layer })];
  if (radius > 0) prims.push({ part: "power", kind: "circle", layer, x, y, radius: u(radius), fill: 0xf41f33, stroke: { color: 0x8d000d, width: u(10) } });
  return [...prims, ...hitsBar(obj, ctx)];
};

// ---- invaderCore（invaderCore.metadata.js：贴图 + 剩余寿命扇形 + 孵化进度弧） ----
/** 官方 constants.STRONGHOLD_DECAY_TICKS */
const STRONGHOLD_DECAY_TICKS = 75_000;
const invaderCore: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(17);
  const prims: PrimitiveDraft[] = [officialSprite(obj, "body", "invaderCore", { width: 200, layer })];
  const decayTime = num(obj, "decayTime");
  if (ctx.gameTime !== undefined && decayTime !== undefined) {
    const ttl = Math.floor((decayTime - ctx.gameTime) / 100) * 100;
    const pie = progressPie(obj, "ttl", 23, ttl / STRONGHOLD_DECAY_TICKS, 0xff0d39, layer);
    if (pie) prims.push(pie);
  }
  const spawning = obj["spawning"];
  if (ctx.gameTime !== undefined && typeof spawning === "object" && spawning !== null) {
    const { spawnTime, needTime } = spawning as Record<string, unknown>;
    if (typeof spawnTime === "number" && typeof needTime === "number" && needTime > 0) {
      const arc = progressArc(obj, "spawning", 40, (needTime - (spawnTime - ctx.gameTime)) / needTime, 0xcccccc, 10, layer);
      if (arc) prims.push(arc);
    }
  }
  return [...prims, ...hitsBar(obj, ctx)];
};

// ---- nuke（nuke.metadata.js：落地前在 effects 图层画半透明的核弹标记与红晕；落地闪光不做） ----
const nuke: ObjectPainter = (obj, ctx) => {
  const landTime = num(obj, "landTime");
  if (landTime !== undefined && ctx.gameTime !== undefined && landTime <= ctx.gameTime) return [];
  const { x, y } = center(obj);
  return [
    // nuke.svg 原始尺寸 260×260
    officialSprite(obj, "body", "nuke", { width: 260, alpha: 0.7, layer: EFFECTS }),
    { part: "glow", kind: "circle", layer: EFFECTS, x, y, radius: u(110), fill: 0xff2222, alpha: 0.5 },
  ];
};

export const OFFICIAL_WORLD_PAINTERS: ObjectPainters = {
  mineral,
  deposit,
  energy: droppedResource,
  resource: droppedResource,
  tombstone: remains("tombstone-border", "deathTime"),
  ruin: remains("ruin", "destroyTime"),
  constructionSite,
  keeperLair,
  portal,
  powerBank,
  invaderCore,
  nuke,
};
