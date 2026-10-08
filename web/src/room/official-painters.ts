/**
 * 官方画法映射表（#42，ADR 0006）：与几何映射表（room-painters.ts）同形——对象类型 → 画法 → 图元草稿。
 * 画法照官方渲染器的 metadata（screeps/renderer `metadata/src/objects/*.metadata.js`，ISC，
 * commit a2db4a7）改写成静态图元：官方贴图用 image 图元（{@link officialSprite}），官方用 Graphics
 * 画的部分用现有图元；补间、闪烁、旋转等动画不做；lighting 图层的 glow 见 official-lighting.ts（#49）。
 *
 * 新增一种对象的官方画法：在 {@link OFFICIAL_PAINTERS} 里加一个条目，用 officialSprite 摆贴图
 * （尺寸、锚点用官方的 100 单位 = 1 格），官方 `tint: { $calc: 'playerColor' }` 的部件传
 * `tint: ctx.ownerColor(obj.user)`。没有条目的类型由 {@link paintersFor} 退回几何画法。
 *
 * 染色：官方 metadata 里按主人染色（playerColor）的部件是 extension-border50/100/200、storage-border、
 * tower-base、link-border、lab、terminal-border、factory-border、nuker-border、extractor、flag 的贴图，
 * 以及 constructionSite、creep 身体环、observer 用 playerColor 画的图形；spawn 与 controller 中心是
 * 主人徽章（徽章缺失时是纯色圆）。我们的 playerColor 是 ownerColorRule（我方 / 盟友 / 陌生人）。
 */
import type { ArtStyle } from "../art/art-style.ts";
import { type OfficialSvgName } from "../art/official-art.ts";
import type { Color } from "../scene/scene.ts";
import { center, num, type ObjectPainter, type ObjectPainters, type PrimitiveDraft } from "./room-paint.ts";
import { ROOM_OBJECT_PAINTERS } from "./room-painters.ts";
import { withSeasonArt } from "./season-official-painters.ts";
import { CONNECTED_PAINTERS } from "./official-terrain.ts";
import type { RoomObject } from "./room-state.ts";
import { ENERGY, circle, energyCapacity, energyStore, officialSprite, ownerTint, u, zLayer } from "./official-sprite.ts";
import { OFFICIAL_STRUCTURE_PAINTERS, controllerProgress } from "./official-structures.ts";
import { OFFICIAL_WORLD_PAINTERS } from "./official-world-objects.ts";
import { OFFICIAL_CREEP_PAINTERS } from "./official-creeps.ts"; // #48
import { ownerBadge } from "./owner-badge.ts"; // #48

export { officialSprite, type SpriteOptions } from "./official-sprite.ts";

// ---- spawn（spawn.metadata.js：三个同心圆 + 徽章 + 按能量缩放的能量圈；没有贴图） ----
const spawn: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(8);
  const cap = energyCapacity(obj);
  const scale = cap ? energyStore(obj) / cap : 0;
  const prims: PrimitiveDraft[] = [
    circle(obj, "body", 70, 0xcccccc, layer),
    circle(obj, "inner", 59, 0x181818, layer),
    ...ownerBadge(obj, ctx, { radius: 38, layer }),
  ];
  if (scale > 0) prims.push(circle(obj, "energy", 38 * Math.min(1, scale), ENERGY, layer));
  return prims;
};

// ---- extension（extension.metadata.js） ----
const EXTENSION_SIZE = { small: 68, medium: 80, large: 100 };
const extension: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(7);
  const cap = energyCapacity(obj);
  const size = cap !== undefined && cap >= 200 ? EXTENSION_SIZE.large : cap !== undefined && cap >= 100 ? EXTENSION_SIZE.medium : EXTENSION_SIZE.small;
  const border: OfficialSvgName | undefined =
    cap === undefined || cap < 100 ? "extension-border50" : cap === 100 ? "extension-border100" : cap === 200 ? "extension-border200" : undefined;
  const prims: PrimitiveDraft[] = [];
  if (border) prims.push(officialSprite(obj, "border", border, { width: 100, tint: ownerTint(obj, ctx), layer }));
  prims.push(officialSprite(obj, "body", "extension", { width: size, layer }));
  const scale = cap ? Math.min(1, energyStore(obj) / cap) : 0;
  if (scale > 0) prims.push(circle(obj, "energy", size * 0.32 * scale, ENERGY, layer));
  return prims;
};

// ---- storage（storage.metadata.js：边框 + 主体 + 从下往上的资源柱） ----
const STORAGE_CAPACITY = 1_000_000;
const STORAGE_BAR = { width: 110, height: 140 };
const storage: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(7);
  const { x, y } = center(obj);
  const store = (typeof obj["store"] === "object" && obj["store"] !== null ? obj["store"] : {}) as Record<string, unknown>;
  const amount = (key: string) => (typeof store[key] === "number" ? (store[key] as number) : 0);
  let total = 0;
  for (const v of Object.values(store)) if (typeof v === "number") total += v;
  const max = Math.max(num(obj, "storeCapacity") || STORAGE_CAPACITY, total);
  const bar = (part: string, value: number, fill: Color): PrimitiveDraft => {
    const height = u(value * STORAGE_BAR.height) / max;
    return {
      part,
      kind: "rect",
      layer,
      x: x - u(STORAGE_BAR.width) / 2,
      y: y + u(STORAGE_BAR.height) / 2 - height,
      width: u(STORAGE_BAR.width),
      height,
      fill,
    };
  };
  const prims: PrimitiveDraft[] = [
    officialSprite(obj, "border", "storage-border", { width: 200, tint: ownerTint(obj, ctx), layer }),
    officialSprite(obj, "body", "storage", { width: 200, layer }),
  ];
  const energy = amount("energy");
  const power = amount("power");
  if (energy + power < total) prims.push(bar("other", total, 0xffffff));
  if (power > 0) prims.push(bar("power", power + energy, 0xf41f33));
  if (energy > 0) prims.push(bar("energy", energy, ENERGY));
  return prims;
};

// ---- tower（tower.metadata.js：染色底座 + 炮塔 + 炮塔上的能量条） ----
const TOWER_ENERGY_HEIGHT = 66.7;
const isNpc = (user: unknown) => user === "2" || user === "3";

/** 官方 mathHelper.calculateAngle：炮塔从 (x0, y0) 指向自己时的旋转 */
function calculateAngle(x0: number, y0: number, x: number, y: number): number {
  let angle = Math.atan2(y - y0, x - x0) + Math.PI / 2;
  if (angle > Math.PI) angle -= 2 * Math.PI;
  else if (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function shotTarget(obj: RoomObject): { x: number; y: number } | undefined {
  const log = obj["actionLog"];
  if (typeof log !== "object" || log === null) return undefined;
  for (const key of ["attack", "heal", "repair"]) {
    const target = (log as Record<string, unknown>)[key];
    if (typeof target === "object" && target !== null) {
      const { x, y } = target as Record<string, unknown>;
      if (typeof x === "number" && typeof y === "number") return { x, y };
    }
  }
  return undefined;
}

const tower: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(13);
  const npc = isNpc(obj["user"]);
  const shot = shotTarget(obj);
  const rotation = shot ? calculateAngle(shot.x, shot.y, num(obj, "x") ?? 0, num(obj, "y") ?? 0) : 0;
  const prims: PrimitiveDraft[] = [
    officialSprite(obj, "base", "tower-base", { width: 200, tint: ownerTint(obj, ctx), layer }),
    officialSprite(obj, "turret", npc ? "tower-rotatable-npc" : "tower-rotatable", { width: 115, anchorY: 32 / 115, rotation, layer }),
  ];
  const cap = energyCapacity(obj);
  const height = cap ? Math.min(TOWER_ENERGY_HEIGHT, (TOWER_ENERGY_HEIGHT * energyStore(obj)) / cap) / 100 : 0;
  if (!npc && height > 0) {
    // 炮塔局部坐标里的 (-45, 0, 90, h)，随炮塔绕塔中心旋转
    const { x, y } = center(obj);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const corners = [
      [-0.45, 0],
      [0.45, 0],
      [0.45, height],
      [-0.45, height],
    ] as const;
    const points = corners.flatMap(([dx, dy]) => [x + dx * cos - dy * sin, y + dx * sin + dy * cos]);
    prims.push({ part: "energy", kind: "polygon", layer, points, fill: ENERGY });
  }
  return prims;
};

// ---- controller（controller.metadata.js：黑色底座 + 等级刻度 + 徽章 + 升级进度扇形 + 外圈） ----
const controller: ObjectPainter = (obj, ctx) => {
  const layer = zLayer(4);
  const level = Math.max(0, Math.min(8, num(obj, "level") ?? 0));
  const { x, y } = center(obj);
  const prims: PrimitiveDraft[] = [
    { part: "halo", kind: "circle", layer, x, y, radius: u(92), fill: 0xffffff, alpha: 0.05 },
    officialSprite(obj, "body", "controller", { width: 200, tint: 0x000000, layer }),
  ];
  for (let i = 0; i < level; i++) {
    prims.push(officialSprite(obj, `level${i + 1}`, "controller-level", { width: 100, anchorY: 1, rotation: (i * 2 * Math.PI) / 8, layer }));
  }
  prims.push(...ownerBadge(obj, ctx, { radius: 37, layer }));
  prims.push(...controllerProgress(obj, layer)); // #45
  prims.push({ part: "ring", kind: "circle", layer, x, y, radius: u(40), stroke: { color: 0x080808, width: u(10) } });
  return prims;
};

// ---- source（source.metadata.js：描边方块 + 按能量缩放的能量方块；没有贴图） ----
const source: ObjectPainter = (obj) => {
  const layer = zLayer(2);
  const { x, y } = center(obj);
  const capacity = num(obj, "energyCapacity") ?? 0;
  const size = capacity > 0 ? (60 * (num(obj, "energy") ?? 0)) / capacity : 0;
  const prims: PrimitiveDraft[] = [
    {
      part: "body",
      kind: "rect",
      layer,
      x: x - 0.2,
      y: y - 0.2,
      width: 0.4,
      height: 0.4,
      radius: 0.15,
      fill: 0x111111,
      stroke: { color: 0x595026, width: 0.15 },
    },
  ];
  if (size > 0) {
    const s = u(size);
    prims.push({ part: "energy", kind: "rect", layer, x: x - s / 2, y: y - s / 2, width: s, height: s, radius: Math.min(0.15, s / 2), fill: ENERGY });
  }
  return prims;
};

/** 已有官方画法的类型；不在这里的类型用几何画法 */
export const OFFICIAL_PAINTERS: ObjectPainters = {
  spawn,
  extension,
  storage,
  tower,
  controller,
  source,
  ...OFFICIAL_STRUCTURE_PAINTERS, ...OFFICIAL_WORLD_PAINTERS, // #45
  ...CONNECTED_PAINTERS, // #46
  ...OFFICIAL_CREEP_PAINTERS, // #48
};

const OFFICIAL_OBJECT_PAINTERS: ObjectPainters = withSeasonArt({ ...ROOM_OBJECT_PAINTERS, ...OFFICIAL_PAINTERS });

/** Art Style 对应的对象画法映射表 */
export function paintersFor(style: ArtStyle): ObjectPainters {
  return style === "official" ? OFFICIAL_OBJECT_PAINTERS : ROOM_OBJECT_PAINTERS;
}
