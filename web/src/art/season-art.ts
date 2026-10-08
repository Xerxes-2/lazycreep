/**
 * 赛季贴图（#47）：赛季服在版本信息里下发的渲染器覆盖配置（source/season-renderer.ts）→
 * Scene 构建能用的贴图。
 *
 * 适配层加载贴图失败时什么都不画，所以 Scene 构建必须事先知道贴图能不能用：
 * {@link seasonArtFor} 先把下发的贴图逐张预检（取到并能解码），只有预检通过的贴图才会出现在
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

export interface SeasonSprite {
  readonly url: string;
  /** 官方单位（100 = 1 格），取自下发的 metadata */
  readonly width: number;
  readonly height: number;
}

/** 对象类型的主贴图：metadata 里 objects 图层上第一个贴图可用的 sprite */
export interface SeasonMainSprite extends SeasonSprite {
  /** 染色：主人色（metadata 的 `{$calc: "playerColor"}`）或固定颜色；不染色时没有 */
  readonly tint?: "owner" | number;
  readonly alpha?: number;
  /** metadata 的 zIndex（官方先后），没有时 0 */
  readonly zIndex: number;
}

export interface SeasonArt {
  /**
   * 对象类型 metadata 里用 `texture` 的 sprite（objects 图层）：贴图可用、metadata 里有它时给出 URL 与尺寸，
   * 否则 undefined（画法退回几何）。
   */
  sprite(objectType: string, texture: string): SeasonSprite | undefined;
  /** 对象类型的主贴图（通用画法用）；metadata 里没有这个类型或贴图都不可用时 undefined */
  mainSprite(objectType: string): SeasonMainSprite | undefined;
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

/** metadata 里 objects 图层上第一个贴图可用（usable）的 sprite */
function mainSpriteOf(metadata: unknown, usable: (texture: string) => string | undefined): SeasonMainSprite | undefined {
  if (!isRecord(metadata) || !Array.isArray(metadata["processors"])) return undefined;
  const zIndex = typeof metadata["zIndex"] === "number" && Number.isFinite(metadata["zIndex"]) ? metadata["zIndex"] : 0;
  for (const processor of metadata["processors"]) {
    if (!isRecord(processor) || processor["type"] !== "sprite" || !isRecord(processor["payload"])) continue;
    const layer = processor["layer"];
    if (layer !== undefined && layer !== "objects") continue;
    const { texture, width, height, tint, alpha } = processor["payload"];
    const url = typeof texture === "string" ? usable(texture) : undefined;
    if (url === undefined || !isSize(width)) continue;
    const owner = isRecord(tint) && tint["$calc"] === "playerColor";
    return {
      url,
      width,
      height: isSize(height) ? height : width,
      zIndex,
      ...(owner ? { tint: "owner" as const } : typeof tint === "number" ? { tint } : {}),
      ...(typeof alpha === "number" && alpha >= 0 && alpha <= 1 ? { alpha } : {}),
    };
  }
  return undefined;
}

/** 覆盖配置 + 已确认可用的贴图名 → 画法用的赛季贴图 */
export function seasonArt(renderer: RendererOverride, ready: ReadonlySet<string>): SeasonArt {
  const usable = (texture: string) => (ready.has(texture) ? renderer.resources[texture] : undefined);
  const main = new Map<string, SeasonMainSprite | undefined>();
  return {
    sprite(objectType, texture) {
      const url = usable(texture);
      if (url === undefined) return undefined;
      const size = spriteSize(renderer.metadata[objectType], texture);
      return size && { url, ...size };
    },
    mainSprite(objectType) {
      if (!main.has(objectType)) {
        main.set(objectType, Object.hasOwn(renderer.metadata, objectType) ? mainSpriteOf(renderer.metadata[objectType], usable) : undefined);
      }
      return main.get(objectType);
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
          // 下发的每一张都预检：新赛季的对象类型不需要本地登记贴图名
          for (const [name, url] of Object.entries(renderer.resources)) {
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
