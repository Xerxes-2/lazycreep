/**
 * 所有权加载器：按可见区域向 map-stats 要房间统计，并替调用方守住它的限额
 * （`POST game/map-stats` 每 Server 每小时 60 次，见 docs/research/screeps-api-facts.md 第 1、10 节）。
 *
 * 策略：
 * - 分批单位是 10×10 的扇区（按有符号坐标对齐，与游戏的 sector 一致）；只请求可见、且没有新鲜缓存的扇区
 * - 一次请求合并所有待取扇区，最多 maxRoomsPerRequest 个房间，按离可见区域中心的距离先近后远；
 *   剩下的在这次完成后接着取
 * - 结果缓存 ttlMs；任何时刻至多一个请求在途，在途期间的调用只记下最后的区域，完成后补一次
 * - 客户端自限每小时 maxPerHour 次（默认 30，给同一 Server 上的其他功能留余量），
 *   额度用完或被限流（429）时暂停，额度恢复后自动补上最后的区域
 *
 * 调用方应只在视口稳定后调用 request（例如拖动 / 缩放结束后一小段时间），见 MapView。
 */
import { SourceError, type MapStats, type WorldSize } from "../source/source.ts";
import { roomName, worldOffset } from "./map-state.ts";
import type { WorldRect } from "./map-scene.ts";

export interface OwnershipLoaderOptions {
  /** 通常是 Source.getMapStats */
  readonly fetch: (shard: string, rooms: readonly string[]) => Promise<MapStats>;
  readonly onStats: (stats: MapStats) => void;
  readonly onError?: (error: unknown) => void;
  /** 缓存有效期，默认 10 分钟 */
  readonly ttlMs?: number;
  /** 每小时最多请求几次，默认 30 */
  readonly maxPerHour?: number;
  /** 单次请求最多多少个房间，默认 2500（实测 2601 个房间一次可以答出） */
  readonly maxRoomsPerRequest?: number;
  /** 被限流后暂停多久，默认 15 分钟 */
  readonly rateLimitBackoffMs?: number;
}

export interface OwnershipLoader {
  /** 希望 shard 上 visible 区域（世界坐标）的所有权是新的。 */
  request(shard: string, size: WorldSize, visible: WorldRect): void;
  dispose(): void;
}

const SECTOR = 10;
const HOUR = 3_600_000;

interface Sector {
  readonly key: string;
  readonly rooms: readonly string[];
  /** 扇区中心到可见区域中心的距离平方 */
  readonly distance: number;
}

interface Want {
  readonly shard: string;
  readonly size: WorldSize;
  readonly visible: WorldRect;
}

export function createOwnershipLoader(options: OwnershipLoaderOptions): OwnershipLoader {
  const ttl = options.ttlMs ?? 10 * 60_000;
  const maxPerHour = options.maxPerHour ?? 30;
  const maxRooms = options.maxRoomsPerRequest ?? 2500;
  const backoff = options.rateLimitBackoffMs ?? 15 * 60_000;

  /** 扇区键 → 取到的时间 */
  const fetchedAt = new Map<string, number>();
  const inFlight = new Set<string>();
  const sent: number[] = [];
  let blockedUntil = 0;
  let busy = false;
  let last: Want | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  /** 与可见区域相交、还要取的扇区（世界之内的房间），先近后远 */
  const staleSectors = (want: Want, now: number): Sector[] => {
    const { size, visible, shard } = want;
    const offset = worldOffset(size);
    const clamp = (v: number, limit: number) => Math.max(0, Math.min(limit, v));
    const wx0 = clamp(Math.floor(visible.x0), size.width);
    const wx1 = clamp(Math.ceil(visible.x1), size.width);
    const wy0 = clamp(Math.floor(visible.y0), size.height);
    const wy1 = clamp(Math.ceil(visible.y1), size.height);
    if (wx0 >= wx1 || wy0 >= wy1) return [];
    const cx = (visible.x0 + visible.x1) / 2 - offset.x;
    const cy = (visible.y0 + visible.y1) / 2 - offset.y;
    const sectors: Sector[] = [];
    const first = (w: number, o: number) => Math.floor((w - o) / SECTOR);
    for (let sy = first(wy0, offset.y); sy <= first(wy1 - 1, offset.y); sy++) {
      for (let sx = first(wx0, offset.x); sx <= first(wx1 - 1, offset.x); sx++) {
        const key = `${shard}:${sx},${sy}`;
        const at = fetchedAt.get(key);
        if (inFlight.has(key) || (at !== undefined && now - at < ttl)) continue;
        const rooms: string[] = [];
        for (let y = sy * SECTOR; y < (sy + 1) * SECTOR; y++) {
          if (y + offset.y < 0 || y + offset.y >= size.height) continue;
          for (let x = sx * SECTOR; x < (sx + 1) * SECTOR; x++) {
            if (x + offset.x < 0 || x + offset.x >= size.width) continue;
            rooms.push(roomName({ x, y }));
          }
        }
        const dx = (sx + 0.5) * SECTOR - cx;
        const dy = (sy + 0.5) * SECTOR - cy;
        sectors.push({ key, rooms, distance: dx * dx + dy * dy });
      }
    }
    return sectors.sort((a, b) => a.distance - b.distance);
  };

  const wakeAt = (at: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, Math.max(0, at - Date.now()));
  };

  const run = () => {
    if (disposed || busy || !last) return;
    const want = last;
    const now = Date.now();
    const sectors = staleSectors(want, now);
    if (sectors.length === 0) return;

    if (now < blockedUntil) return wakeAt(blockedUntil);
    while (sent.length > 0 && now - sent[0]! >= HOUR) sent.shift();
    if (sent.length >= maxPerHour) return wakeAt(sent[0]! + HOUR);

    const batch: Sector[] = [];
    let count = 0;
    for (const sector of sectors) {
      if (batch.length > 0 && count + sector.rooms.length > maxRooms) break;
      batch.push(sector);
      count += sector.rooms.length;
    }
    const rooms = batch.flatMap((s) => s.rooms).slice(0, maxRooms);
    for (const sector of batch) inFlight.add(sector.key);
    sent.push(now);
    busy = true;
    options.fetch(want.shard, rooms).then(
      (stats) => {
        busy = false;
        for (const sector of batch) inFlight.delete(sector.key);
        if (disposed) return;
        const at = Date.now();
        for (const sector of batch) fetchedAt.set(sector.key, at);
        options.onStats(stats);
        run();
      },
      (error: unknown) => {
        busy = false;
        for (const sector of batch) inFlight.delete(sector.key);
        if (disposed) return;
        if (error instanceof SourceError && error.kind === "rateLimited") {
          blockedUntil = Date.now() + backoff;
          wakeAt(blockedUntil);
        }
        options.onError?.(error);
      },
    );
  };

  return {
    request(shard, size, visible) {
      last = { shard, size, visible };
      run();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
