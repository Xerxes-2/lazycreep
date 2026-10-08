/**
 * 徽章的图片形式（#43）。
 *
 * - DOM（Top Bar、PvP 卡片）：`badgeSvgUrl` 给 SVG 的 data URL，由浏览器按 <img> 尺寸矢量绘制；按徽章内容缓存。
 * - World Map（Pixi 纹理）：默认纹理加载器是 fetch + createImageBitmap，后者在 Chrome 里不解码 SVG，
 *   所以先在客户端栅格化成 PNG。`createBadgeRasters` 按“Server + 用户 id + 徽章内容”缓存结果
 *   （同一内容只栅格化一次，各用户共用）。
 *
 * 选 data URL 而不是 Blob URL：URL 由内容决定、Scene 仍是可序列化的纯数据，不需要跟着缓存淘汰去 revoke，
 * Pixi 适配层按 URL 共享纹理也就天然去重。代价是字符串稍大（一张 128px PNG 约几 KB）。
 */
import { createSignal } from "solid-js";
import { badgeKey, type Badge } from "./badge.ts";
import { badgeSvg, BADGE_PLACEHOLDER_SVG } from "./badge-svg.ts";
import { rasterizeSvgText, svgDataUrl } from "../scene/image-sources.ts";

const SVG_CACHE_LIMIT = 2000;
const svgUrls = new Map<string, string>();

/** 徽章的 SVG data URL；undefined（没有徽章或还不知道）给中性占位 */
export function badgeSvgUrl(badge: Badge | undefined): string {
  const key = badge ? badgeKey(badge) : "";
  let url = svgUrls.get(key);
  if (url === undefined) {
    if (svgUrls.size >= SVG_CACHE_LIMIT) svgUrls.clear();
    url = svgDataUrl(badge ? badgeSvg(badge) : BADGE_PLACEHOLDER_SVG);
    svgUrls.set(key, url);
  }
  return url;
}

/** 栅格化：SVG 文本 → 边长 size 像素的位图 URL */
export type Rasterize = (svg: string, size: number) => Promise<string>;

/**
 * 栅格化边长：照官方新版世界地图的徽章纹理（badge-svg 自带的 128×128）。
 * RCL 8 的徽章在本地图最大缩放（每房间 300 CSS 像素）下约 180 像素，会略软；换来每个玩家只占几 KB。
 */
export const BADGE_RASTER_SIZE = 128;

/** 浏览器里的栅格化：共享的 SVG 栅格化（scene/image-sources.ts），导出 PNG data URL */
export const browserRasterize: Rasterize = async (svg, size) => (await rasterizeSvgText(svg, size, size)).toDataURL("image/png");

export interface BadgeRasters {
  /**
   * 该玩家徽章的位图 URL（Solid 响应式：栅格化完成后读到它的计算会重算）；完成前与失败时为 undefined。
   * badge 为 null 表示已知没有徽章，给中性占位。
   */
  url(server: string, userId: string, badge: Badge | null): string | undefined;
}

export interface BadgeRasterOptions {
  readonly rasterize?: Rasterize;
  readonly size?: number;
  /** 合并通知：一批栅格化完成后只通知一次。默认下一动画帧（页面隐藏时自然推迟） */
  readonly schedule?: (flush: () => void) => void;
}

const defaultSchedule = (flush: () => void) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  else setTimeout(flush, 0);
};

export function createBadgeRasters(options: BadgeRasterOptions = {}): BadgeRasters {
  const rasterize = options.rasterize ?? browserRasterize;
  const size = options.size ?? BADGE_RASTER_SIZE;
  const schedule = options.schedule ?? defaultSchedule;

  /** 徽章内容 → 位图（undefined：进行中或失败） */
  const byContent = new Map<string, string | undefined>();
  /** Server + 用户 + 徽章内容 → 位图 */
  const byUser = new Map<string, string>();
  const [version, setVersion] = createSignal(0);
  let flushing = false;
  const changed = () => {
    if (flushing) return;
    flushing = true;
    schedule(() => {
      flushing = false;
      setVersion((v) => v + 1);
    });
  };

  return {
    url(server, userId, badge) {
      version();
      const content = badge ? badgeKey(badge) : "";
      const key = JSON.stringify([server, userId, content]);
      const known = byUser.get(key);
      if (known !== undefined) return known;
      if (!byContent.has(content)) {
        byContent.set(content, undefined);
        rasterize(badge ? badgeSvg(badge) : BADGE_PLACEHOLDER_SVG, size).then(
          (url) => {
            byContent.set(content, url);
            changed();
          },
          () => undefined,
        );
        return undefined;
      }
      const url = byContent.get(content);
      if (url !== undefined) byUser.set(key, url);
      return url;
    },
  };
}

let shared: BadgeRasters | undefined;

/** 全页共用的徽章位图缓存 */
export function badgeRasters(): BadgeRasters {
  return (shared ??= createBadgeRasters());
}
