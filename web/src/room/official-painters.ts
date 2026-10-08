/**
 * 官方画法映射表（#42，ADR 0006、0007）：对象类型 → 画法 → 图元草稿。Room View 只用这一套画法。
 * 画法照官方渲染器的 metadata（screeps/renderer `metadata/src/objects/*.metadata.js`，ISC，
 * commit a2db4a7）改写成静态图元：官方贴图用 image 图元（officialSprite），官方用 Graphics
 * 画的部分用现有图元；补间、闪烁、旋转等动画不做；lighting 图层的 glow 见 official-lighting.ts（#49）。
 *
 * 本文件只做组合：各类对象的画法在 official-structures.ts（建筑）、official-world-objects.ts（世界对象）、
 * official-terrain.ts（道路、rampart、constructedWall）、official-creeps.ts（creep 类）。
 *
 * 新增一种对象的官方画法：在对应文件的映射表里加一个条目，用 official-sprite.ts 的 officialSprite 摆贴图
 * （尺寸、锚点用官方的 100 单位 = 1 格），官方 `tint: { $calc: 'playerColor' }` 的部件传
 * `tint: ctx.ownerColor(obj.user)`。赛季对象由 season-official-painters.ts 的 withSeasonArt 加上；
 * 表里没有的类型由赛季 metadata 的通用画法补，再没有就画占位（组合见 room-scene.ts）。
 *
 * 染色：官方 metadata 里按主人染色（playerColor）的部件是 extension-border50/100/200、storage-border、
 * tower-base、link-border、lab、terminal-border、factory-border、nuker-border、extractor、flag 的贴图，
 * 以及 constructionSite、creep 身体环、observer 用 playerColor 画的图形；spawn 与 controller 中心是
 * 主人徽章（徽章缺失时是纯色圆）。我们的 playerColor 是 ownerColorRule（我方 / 盟友 / 陌生人）。
 */
import type { ObjectPainters } from "./room-paint.ts";
import { CONNECTED_PAINTERS } from "./official-terrain.ts";
import { OFFICIAL_STRUCTURE_PAINTERS } from "./official-structures.ts";
import { OFFICIAL_WORLD_PAINTERS } from "./official-world-objects.ts";
import { OFFICIAL_CREEP_PAINTERS } from "./official-creeps.ts";

/** 有官方画法的类型 */
export const OFFICIAL_PAINTERS: ObjectPainters = {
  ...OFFICIAL_STRUCTURE_PAINTERS,
  ...OFFICIAL_WORLD_PAINTERS,
  ...CONNECTED_PAINTERS,
  ...OFFICIAL_CREEP_PAINTERS,
};
