/**
 * 地图瓦片地址。默认根地址是 Server 配置的 Gateway 路径（转发到官方 CDN 的 `/map/`）；
 * 赛季服在版本信息的 `serverData.features` 里用 `map-url-replace` 给出本赛季的根地址
 * （官方客户端同样优先用它）。不用它时，默认根地址下的 `shardSeason` 是旧赛季留下的瓦片，地形对不上。
 * 本赛季的瓦片在官方静态资源主机上，经 Gateway 的只读路径 `/season-static/` 同源取（season-renderer.ts）。
 */
import { seasonStaticUrl } from "./season-renderer.ts";

/** 一个 Shard 的瓦片地址 */
export interface MapTiles {
  /** 单房间瓦片 */
  room(room: string): string;
  /**
   * zoom2 块瓦片：一张图覆盖 4×4 个房间，按块西北角的房间命名；
   * 传入的房间必须是块角（有符号坐标都是 4 的倍数），否则 CDN 返回 403。
   */
  block(cornerRoom: string): string;
  /**
   * zoom1 扇区瓦片：一张图（200×200）覆盖 10×10 个房间，按扇区西北角的房间命名；
   * 传入的房间必须是扇区角（有符号坐标都是 10 的倍数，如 W9N9、E0S0、E10S10），否则 CDN 返回 403。
   */
  sector(cornerRoom: string): string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `serverData.features` → 本赛季瓦片的同源根地址；没有覆盖或认不出地址时为 null（用 Server 的默认根地址） */
export function mapTileRootFromFeatures(features: unknown): string | null {
  if (!Array.isArray(features)) return null;
  const replace = features.find((f) => isRecord(f) && f["name"] === "map-url-replace");
  const url = isRecord(replace) ? replace["mapUrl"] : undefined;
  if (typeof url !== "string") return null;
  return seasonStaticUrl(url.replace(/\/+$/, "")) ?? null;
}

/** 根地址下某个 Shard 的瓦片地址 */
export function mapTileUrls(root: string, shard: string): MapTiles {
  return {
    room: (room) => `${root}/${shard}/${room}.png`,
    block: (corner) => `${root}/${shard}/zoom2/${corner}.png`,
    sector: (corner) => `${root}/${shard}/zoom1/${corner}.png`,
  };
}
