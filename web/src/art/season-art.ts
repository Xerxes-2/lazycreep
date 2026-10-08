/**
 * 赛季贴图（#47）：赛季服在版本信息里下发的渲染器覆盖配置（source/season-renderer.ts）→
 * Scene 构建能用的贴图。
 *
 * 适配层加载贴图失败时什么都不画，所以 Scene 构建必须事先知道贴图能不能用：
 * {@link seasonArtFor} 先把用到的贴图逐张预检（取到并能解码），只有预检通过的贴图才会出现在
 * {@link SeasonArt} 里；没有配置、还在预检或预检失败的，画法退回几何。每张贴图预检完会更新一次，
 * 让 Room View 重建一次 Scene（不是常驻动画）。
 *
 * 贴图不打包进构建产物，运行时经 Gateway 的只读路径 `/season-static/` 取；没有 ISC 之类的许可声明，
 * 默认保留权利，只在浏览器里按需加载、不再分发。
 */
import { createSignal, type Accessor } from "solid-js";
import type { RendererOverride } from "../source/season-renderer.ts";
import type { Source } from "../source/source.ts";
import { checkImage } from "../scene/image-sources.ts";

/** 画法会用到的赛季贴图名（版本信息里 resources 的键） */
export const SEASON_TEXTURES = ["T", "reactor-core", "reactor-edge"] as const;
export type SeasonTexture = (typeof SEASON_TEXTURES)[number];

export interface SeasonSprite {
  readonly url: string;
  /** 官方单位（100 = 1 格），取自下发的 metadata */
  readonly width: number;
  readonly height: number;
}

export interface SeasonArt {
  /**
   * 对象类型 metadata 里用 `texture` 的 sprite（objects 图层）：贴图可用、metadata 里有它时给出 URL 与尺寸，
   * 否则 undefined（画法退回几何）。
   */
  sprite(objectType: string, texture: SeasonTexture): SeasonSprite | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** metadata 里 objects 图层上用 texture 的第一个 sprite 的尺寸 */
function spriteSize(metadata: unknown, texture: string): { width: number; height: number } | undefined {
  if (!isRecord(metadata) || !Array.isArray(metadata["processors"])) return undefined;
  for (const processor of metadata["processors"]) {
    if (!isRecord(processor) || processor["type"] !== "sprite" || !isRecord(processor["payload"])) continue;
    const layer = processor["layer"];
    if (layer !== undefined && layer !== "objects") continue;
    const { texture: name, width, height } = processor["payload"];
    if (name !== texture || !isSize(width)) continue;
    return { width, height: isSize(height) ? height : width };
  }
  return undefined;
}

/** 覆盖配置 + 已确认可用的贴图名 → 画法用的赛季贴图 */
export function seasonArt(renderer: RendererOverride, ready: ReadonlySet<string>): SeasonArt {
  return {
    sprite(objectType, texture) {
      const url = renderer.resources[texture];
      if (url === undefined || !ready.has(texture)) return undefined;
      const size = spriteSize(renderer.metadata[objectType], texture);
      return size && { url, ...size };
    },
  };
}

/** 预检一张贴图：取到并能解码才算可用 */
export type Preflight = (url: string) => Promise<void>;

export interface SeasonArtLoader {
  /** 这个 Source 的赛季贴图：没有配置或还没有一张可用时为 undefined；每张贴图预检完更新一次 */
  forSource(source: Source): Accessor<SeasonArt | undefined>;
}

export function createSeasonArtLoader(preflight: Preflight = checkImage): SeasonArtLoader {
  const loaded = new WeakMap<Source, Accessor<SeasonArt | undefined>>();
  return {
    forSource(source) {
      const known = loaded.get(source);
      if (known) return known;
      const [art, setArt] = createSignal<SeasonArt | undefined>(undefined, { equals: false });
      loaded.set(source, art);
      source.getVersion().then(
        ({ renderer }) => {
          if (!renderer) return;
          const ready = new Set<string>();
          for (const name of SEASON_TEXTURES) {
            const url = renderer.resources[name];
            if (url === undefined) continue;
            preflight(url).then(
              () => {
                ready.add(name);
                setArt(seasonArt(renderer, new Set(ready)));
              },
              () => {},
            );
          }
        },
        () => {},
      );
      return art;
    },
  };
}

let shared: SeasonArtLoader | undefined;
/** 全页共享的加载器：每个共享 Source 只取一次版本信息、每张贴图只预检一次 */
export function seasonArtFor(source: Source): Accessor<SeasonArt | undefined> {
  return (shared ??= createSeasonArtLoader()).forSource(source);
}
