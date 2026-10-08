/**
 * 房间的装饰（Decoration，#61）：`GET game/room-decorations?room=&shard=`（匿名可取）的数据形状与解析。
 *
 * 接口返回 `{ ok, decorations: [{ active, user, decoration }] }`：`decoration` 是装饰本身（类型、图片地址），
 * `active` 是挂到房间上时选的参数（颜色、亮度、尺寸）。赛季服每个房间都有同一套（`active.world: true`）；
 * MMO 只有玩家给自己房间挂的。官方渲染器把 `active` 的字段摊平到条目上使用（`i.swampColor`、
 * `i.decoration.tileScale`），这里解析成按用途分好的三类：
 *
 * - 墙（`wallLandscape`，或同时含墙与地面的 `landscape`）：底色、描边、前景图案；
 * - 地面（`floorLandscape` / `landscape`）：底色、前景图案（可平铺）、沼泽与道路颜色；
 * - 对象（`object`）：某类对象下面垫的贴图（赛季控制器）。
 *
 * 图片在官方静态资源主机上，换成同源的 Gateway 只读路径（season-renderer.ts 的 seasonStaticUrl）；
 * 认不出的地址整条丢弃，用默认外观。同一类多条时与官方一样取第一条。
 * 解析结果本身是纯 JSON，缓存（room-decoration-cache.ts）原样存储，读回时用 {@link decodeRoomDecorations} 再校验。
 */
import { isRecord } from "../storage/local-store.ts";
import { SEASON_STATIC_ROOT, seasonStaticUrl } from "./season-renderer.ts";

/** 墙的装饰（terrain.js 的 decorationWallLandscape 与 decorations.js 的前景） */
export interface WallLandscape {
  /** 前景图案（同源路径），拉伸铺满整个房间、只露在墙里 */
  readonly foregroundUrl: string;
  readonly foregroundColor: string;
  readonly foregroundAlpha: number;
  readonly foregroundBrightness: number;
  readonly backgroundColor: string;
  readonly backgroundBrightness: number;
  readonly strokeColor: string;
  readonly strokeBrightness: number;
  /** 墙描边在光照层里的亮度（HSL 的 l，0–1） */
  readonly strokeLighting: number;
  readonly strokeWidth: number;
}

/** 地面的装饰（terrain.js 的 decorationFloorLandscape 与 road.js） */
export interface FloorLandscape {
  /** 前景图案（同源路径） */
  readonly floorForegroundUrl: string;
  /** 有值时前景按这个倍数平铺（贴图像素 × tileScale 个官方单位一块），否则拉伸铺满整个房间 */
  readonly tileScale?: number;
  readonly floorBackgroundColor: string;
  readonly floorBackgroundBrightness: number;
  readonly floorForegroundColor: string;
  readonly floorForegroundAlpha: number;
  readonly floorForegroundBrightness: number;
  readonly swampColor: string;
  readonly swampStrokeColor: string;
  readonly swampStrokeWidth: number;
  readonly roadsColor: string;
  readonly roadsBrightness: number;
}

/** 对象装饰的一张贴图（objectDecoration.js） */
export interface DecorationGraphic {
  /** 同源路径 */
  readonly url: string;
  /** `active` 里给了透明度时 */
  readonly alpha?: number;
  /** `active` 里给了染色时：颜色与亮度（官方 colorBrightness(color, brightness)） */
  readonly color?: string;
  readonly brightness?: number;
}

/** 对象装饰：在某类对象下面垫一组贴图，以对象格子中心为中心 */
export interface ObjectDecoration {
  readonly objectType: string;
  /** 只作用于这个玩家的对象；没有时作用于所有 */
  readonly user?: string;
  /** 官方单位（100 = 1 格） */
  readonly width: number;
  readonly height: number;
  readonly graphics: readonly DecorationGraphic[];
}

export interface RoomDecorations {
  readonly wall?: WallLandscape;
  readonly floor?: FloorLandscape;
  readonly objects: readonly ObjectDecoration[];
}

/** 没有装饰 */
export const NO_DECORATIONS: RoomDecorations = { objects: [] };

const WALL_COLORS = ["foregroundColor", "backgroundColor", "strokeColor"] as const;
const WALL_NUMBERS = [
  "foregroundAlpha",
  "foregroundBrightness",
  "backgroundBrightness",
  "strokeBrightness",
  "strokeLighting",
  "strokeWidth",
] as const;
const FLOOR_COLORS = ["floorBackgroundColor", "floorForegroundColor", "swampColor", "swampStrokeColor", "roadsColor"] as const;
const FLOOR_NUMBERS = [
  "floorBackgroundBrightness",
  "floorForegroundAlpha",
  "floorForegroundBrightness",
  "swampStrokeWidth",
  "roadsBrightness",
] as const;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

/** 从 record 里取出全部颜色与数值字段；缺一个或类型不对就是 undefined */
function pick<C extends string, N extends string>(
  record: Record<string, unknown>,
  colors: readonly C[],
  numbers: readonly N[],
): (Record<C, string> & Record<N, number>) | undefined {
  const out: Record<string, string | number> = {};
  for (const key of colors) {
    const value = record[key];
    if (!isColor(value)) return undefined;
    out[key] = value;
  }
  for (const key of numbers) {
    const value = record[key];
    if (!isNumber(value)) return undefined;
    out[key] = value;
  }
  return out as Record<C, string> & Record<N, number>;
}

/** 已是同源路径（存储里读回） */
function localUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith(`${SEASON_STATIC_ROOT}/`)) return undefined;
  return value.split("/").slice(1).some((s) => s === "" || s === "." || s === "..") ? undefined : value;
}

/** 官方地址 → 同源路径 */
const wireUrl = (value: unknown) => (typeof value === "string" ? seasonStaticUrl(value) : undefined);

function wall(record: Record<string, unknown>, url: string | undefined): WallLandscape | undefined {
  const fields = pick(record, WALL_COLORS, WALL_NUMBERS);
  return fields && url ? { foregroundUrl: url, ...fields } : undefined;
}

function floor(record: Record<string, unknown>, url: string | undefined, tileScale: unknown): FloorLandscape | undefined {
  const fields = pick(record, FLOOR_COLORS, FLOOR_NUMBERS);
  if (!fields || !url) return undefined;
  return { floorForegroundUrl: url, ...(isNumber(tileScale) && tileScale > 0 ? { tileScale } : {}), ...fields };
}

function objectDecoration(
  objectType: unknown,
  user: unknown,
  width: unknown,
  height: unknown,
  graphics: readonly (DecorationGraphic | undefined)[],
): ObjectDecoration | undefined {
  if (typeof objectType !== "string" || !isNumber(width) || !isNumber(height)) return undefined;
  const usable = graphics.filter((g): g is DecorationGraphic => g !== undefined);
  if (usable.length === 0) return undefined;
  return { objectType, ...(typeof user === "string" && user !== "" ? { user } : {}), width, height, graphics: usable };
}

const WALL_TYPES = new Set(["landscape", "wallLandscape"]);
const FLOOR_TYPES = new Set(["landscape", "floorLandscape"]);

/** `game/room-decorations` 的响应 → 装饰；形状不对的条目跳过 */
export function roomDecorationsFromWire(wire: unknown): RoomDecorations {
  const list = isRecord(wire) && Array.isArray(wire["decorations"]) ? wire["decorations"] : [];
  let wallFound: WallLandscape | undefined;
  let floorFound: FloorLandscape | undefined;
  let wallSeen = false;
  let floorSeen = false;
  const objects: ObjectDecoration[] = [];
  for (const item of list) {
    if (!isRecord(item) || !isRecord(item["active"]) || !isRecord(item["decoration"])) continue;
    const active = item["active"];
    const decoration = item["decoration"];
    const type = decoration["type"];
    if (typeof type !== "string") continue;
    // 官方取第一条：第一条不可用时默认外观，不往后找
    if (WALL_TYPES.has(type) && !wallSeen) {
      wallSeen = true;
      wallFound = wall(active, wireUrl(decoration["foregroundUrl"]));
    }
    if (FLOOR_TYPES.has(type) && !floorSeen) {
      floorSeen = true;
      floorFound = floor(active, wireUrl(decoration["floorForegroundUrl"]), decoration["tileScale"]);
    }
    if (type === "object") {
      const graphics = Array.isArray(decoration["graphics"]) ? decoration["graphics"] : [];
      const parsed = objectDecoration(
        decoration["objectType"],
        item["user"],
        active["width"],
        active["height"],
        graphics.map((graphic: unknown): DecorationGraphic | undefined => {
          if (!isRecord(graphic)) return undefined;
          const url = wireUrl(graphic["url"]);
          if (!url) return undefined;
          // graphic.alpha / graphic.color 是 active 里的字段名
          const alphaKey = graphic["alpha"];
          const colorKey = graphic["color"];
          const alpha = typeof alphaKey === "string" ? active[alphaKey] : undefined;
          const color = typeof colorKey === "string" ? active[colorKey] : undefined;
          const brightness = active["brightness"];
          return {
            url,
            ...(isNumber(alpha) ? { alpha } : {}),
            ...(isColor(color) ? { color, ...(isNumber(brightness) ? { brightness } : {}) } : {}),
          };
        }),
      );
      if (parsed) objects.push(parsed);
    }
  }
  return { ...(wallFound ? { wall: wallFound } : {}), ...(floorFound ? { floor: floorFound } : {}), objects };
}

/** 存储里读回的装饰（{@link roomDecorationsFromWire} 的结果）；形状不对时为 undefined */
export function decodeRoomDecorations(value: unknown): RoomDecorations | undefined {
  if (!isRecord(value) || !Array.isArray(value["objects"])) return undefined;
  const out: { wall?: WallLandscape; floor?: FloorLandscape; objects: ObjectDecoration[] } = { objects: [] };
  if (value["wall"] !== undefined) {
    const raw = value["wall"];
    const parsed = isRecord(raw) ? wall(raw, localUrl(raw["foregroundUrl"])) : undefined;
    if (!parsed) return undefined;
    out.wall = parsed;
  }
  if (value["floor"] !== undefined) {
    const raw = value["floor"];
    const parsed = isRecord(raw) ? floor(raw, localUrl(raw["floorForegroundUrl"]), raw["tileScale"]) : undefined;
    if (!parsed) return undefined;
    out.floor = parsed;
  }
  for (const raw of value["objects"]) {
    if (!isRecord(raw) || !Array.isArray(raw["graphics"])) return undefined;
    const graphics = raw["graphics"].map((g: unknown): DecorationGraphic | undefined => {
      if (!isRecord(g)) return undefined;
      const url = localUrl(g["url"]);
      if (!url) return undefined;
      const { alpha, color, brightness } = g;
      return {
        url,
        ...(isNumber(alpha) ? { alpha } : {}),
        ...(isColor(color) ? { color, ...(isNumber(brightness) ? { brightness } : {}) } : {}),
      };
    });
    if (graphics.some((g) => g === undefined)) return undefined;
    const parsed = objectDecoration(raw["objectType"], raw["user"], raw["width"], raw["height"], graphics);
    if (!parsed) return undefined;
    out.objects.push(parsed);
  }
  return out;
}
