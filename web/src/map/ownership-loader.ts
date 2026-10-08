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
 *
 * 按房间补查（requestRooms，PvP Overview 等用）：与地图共用同一份扇区缓存与每小时额度，
 * 但排在地图的可见区域之后，只用额度里留给地图（backgroundReserve）之外的部分，
 * 结果按更长的有效期（backgroundTtlMs）算；每个 Shard 一次请求，依次取。
 */
import { SourceError, type MapStats, type WorldSize } from "../source/source.ts";
import { parseRoomName, roomName, worldOffset } from "./map-state.ts";
import type { WorldRect } from "./map-scene.ts";
import type { OwnershipBudgetStore } from "./ownership-budget.ts";

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
  /** 按房间补查时缓存的有效期，默认 60 分钟 */
  readonly backgroundTtlMs?: number;
  /** 每小时额度里留给地图、补查不能用的次数，默认 10 */
  readonly backgroundReserve?: number;
  /** 额度与限流退避的持久记录（ownership-budget.ts）；不给时只在内存里，刷新页面即清零 */
  readonly budget?: OwnershipBudgetStore;
}

export interface RoomRef {
  readonly shard: string;
  readonly room: string;
}

export interface OwnershipLoader {
  /** 希望 shard 上 visible 区域（世界坐标）的所有权是新的。 */
  request(shard: string, size: WorldSize, visible: WorldRect): void;
  /** 希望这些房间（可跨 Shard）的所有权已知；替换上一次的清单。优先级低于 request。 */
  requestRooms(rooms: readonly RoomRef[]): void;
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
  const backgroundTtl = options.backgroundTtlMs ?? 60 * 60_000;
  const backgroundLimit = Math.max(0, maxPerHour - (options.backgroundReserve ?? 10));

  /** 扇区键 → 取到的时间 */
  const fetchedAt = new Map<string, number>();
  const inFlight = new Set<string>();
  const stored = options.budget?.load();
  const sent: number[] = [...(stored?.sent ?? [])];
  let blockedUntil = stored?.blockedUntil ?? 0;
  /**
   * 有持久记录时以它为准：判断额度前读回（别的标签页 / 上一个页面记下的），
   * 记账时“读出 → 加一条 → 写回”，多个标签页的记录互相累加而不覆盖。
   */
  const sync = () => {
    const latest = options.budget?.load();
    if (!latest) return;
    sent.splice(0, sent.length, ...latest.sent);
    blockedUntil = Math.max(blockedUntil, latest.blockedUntil);
  };
  const persist = () => options.budget?.save({ sent: [...sent], blockedUntil });
  let busy = false;
  let last: Want | undefined;
  let background: readonly RoomRef[] = [];
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

  /** 补查清单里还要取的扇区：第一个有待取扇区的 Shard */
  const staleBackground = (now: number): { shard: string; sectors: Sector[] } | undefined => {
    const byShard = new Map<string, Map<string, Sector>>();
    for (const { shard, room } of background) {
      const coord = parseRoomName(room);
      if (!coord) continue;
      const sx = Math.floor(coord.x / SECTOR);
      const sy = Math.floor(coord.y / SECTOR);
      const key = `${shard}:${sx},${sy}`;
      const at = fetchedAt.get(key);
      if (inFlight.has(key) || (at !== undefined && now - at < backgroundTtl)) continue;
      const sectors = byShard.get(shard) ?? new Map<string, Sector>();
      byShard.set(shard, sectors);
      if (sectors.has(key)) continue;
      const rooms: string[] = [];
      for (let y = sy * SECTOR; y < (sy + 1) * SECTOR; y++) {
        for (let x = sx * SECTOR; x < (sx + 1) * SECTOR; x++) rooms.push(roomName({ x, y }));
      }
      sectors.set(key, { key, rooms, distance: 0 });
    }
    const first = byShard.entries().next().value;
    return first && { shard: first[0], sectors: [...first[1].values()] };
  };

  /** 额度够时返回 true；不够时安排在额度腾出时重试 */
  const budget = (now: number, limit: number): boolean => {
    sync();
    if (now < blockedUntil) {
      wakeAt(blockedUntil);
      return false;
    }
    while (sent.length > 0 && now - sent[0]! >= HOUR) sent.shift();
    if (sent.length < limit) return true;
    if (limit > 0) wakeAt(sent[sent.length - limit]! + HOUR);
    return false;
  };

  const run = () => {
    if (disposed || busy) return;
    const now = Date.now();
    const visibleSectors = last ? staleSectors(last, now) : [];
    if (visibleSectors.length > 0) {
      if (budget(now, maxPerHour)) send(last!.shard, visibleSectors, now);
      return;
    }
    const extra = staleBackground(now);
    if (extra && budget(now, backgroundLimit)) send(extra.shard, extra.sectors, now);
  };

  const send = (shard: string, sectors: readonly Sector[], now: number) => {
    const batch: Sector[] = [];
    let count = 0;
    for (const sector of sectors) {
      if (batch.length > 0 && count + sector.rooms.length > maxRooms) break;
      batch.push(sector);
      count += sector.rooms.length;
    }
    const rooms = batch.flatMap((s) => s.rooms).slice(0, maxRooms);
    for (const sector of batch) inFlight.add(sector.key);
    sync();
    sent.push(now);
    persist();
    busy = true;
    options.fetch(shard, rooms).then(
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
          sync();
          blockedUntil = Math.max(blockedUntil, Date.now() + backoff);
          persist();
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
    requestRooms(rooms) {
      background = rooms;
      run();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
