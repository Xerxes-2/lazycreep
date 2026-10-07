/**
 * Theme：Scene 构建用的调色板，外加两条可编辑的着色规则（#5）：陌生玩家按玩家还是按阵营着色、
 * 按玩家指定的颜色。规则的套用在 ownerColorRule（room-detail-rules.ts），Room View 与 World Map 共用。
 * 用户编辑过的 Theme 由 customize/color-scheme.ts 管理。
 */
import type { Color } from "./scene.ts";

export interface Theme {
  readonly background: Color;
  readonly terrainWall: Color;
  readonly terrainSwamp: Color;

  /** 我方对象 */
  readonly owned: Color;
  /** 盟友（Ally List 里的玩家） */
  readonly ally: Color;
  /** 陌生玩家：按玩家 id 稳定地挑一种 */
  readonly strangers: readonly Color[];
  /** 无主或主人未知 */
  readonly neutral: Color;

  readonly structure: Color;
  readonly structureOutline: Color;
  readonly road: Color;
  readonly wall: Color;
  readonly energy: Color;
  readonly power: Color;
  readonly mineral: Color;
  readonly controller: Color;
  readonly decay: Color;

  readonly hitsBar: Color;
  readonly barBackground: Color;
  readonly label: Color;
  readonly labelOutline: Color;
  readonly placeholder: Color;
  /** 选中对象的高亮框 */
  readonly selection: Color;

  /** 陌生玩家着色：perPlayer 按玩家 id 从 strangers 里稳定地挑；faction 一律用 strangers[0] */
  readonly strangerColoring: StrangerColoring;
  /** 按玩家指定的颜色：用户名（小写）→ 颜色；优先于盟友与陌生人着色，不作用于自己 */
  readonly playerColors: Readonly<Record<string, Color>>;
}

export type StrangerColoring = "perPlayer" | "faction";

/** 深色简约几何画风 */
export const DEFAULT_THEME: Theme = {
  background: 0x2b2b2b,
  terrainWall: 0x111111,
  terrainSwamp: 0x2c3a1e,

  owned: 0x5d9cec,
  ally: 0x6ccf8e,
  strangers: [0xe5534b, 0xf0883e, 0xd16dd1, 0xe0b040, 0xff7b9c, 0xb08a5a],
  neutral: 0x9e9e9e,

  structure: 0x3c3c3c,
  structureOutline: 0x8a8a8a,
  road: 0x4a4a4a,
  wall: 0x1c1c1c,
  energy: 0xffe56d,
  power: 0xf41f33,
  mineral: 0xb4b4f0,
  controller: 0x6c6c6c,
  decay: 0x6b5a4a,

  hitsBar: 0x6ccf5e,
  barBackground: 0x101010,
  label: 0xffffff,
  labelOutline: 0x000000,
  placeholder: 0xff4fd8,
  selection: 0xffffff,

  strangerColoring: "perPlayer",
  playerColors: {},
};
