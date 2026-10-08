/**
 * 官方 PNG 纹理（#46）：screeps/renderer `metadata/images` 里地形用到的 4 张与光照的 glow（#49）（ISC，LICENSE 与来源见
 * `public/official-art/`），原样放在 `public/official-art/textures/`。
 *
 * 不进 PWA 预缓存（pwa.config.ts 的 globIgnores，build.test.ts 检查），也不由 JS 引用：只有官方画风的
 * 地形贴图被栅格化时（首次进入 Room View）、glow 在第一个发光图元被画时才按需请求，之后走 HTTP 缓存。
 */
import { OFFICIAL_ART_DIR } from "./official-art.ts";

export const OFFICIAL_TEXTURE_NAMES = ["ground", "ground-mask", "noise1", "noise2", "glow"] as const;

export type OfficialTextureName = (typeof OFFICIAL_TEXTURE_NAMES)[number];

/** 纹理所在的子目录（相对站点根） */
export const OFFICIAL_TEXTURE_DIR = `${OFFICIAL_ART_DIR}/textures`;

/** 同源 URL，例如 `/official-art/textures/noise1.png` */
export function officialTextureUrl(name: OfficialTextureName): string {
  return `${import.meta.env.BASE_URL}${OFFICIAL_TEXTURE_DIR}/${name}.png`;
}
