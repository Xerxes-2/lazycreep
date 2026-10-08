import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceError, type MapStats } from "../source/source.ts";
import { STORED_KEYS } from "../customize/settings-transfer.ts";
import { OWNERSHIP_BUDGET_STORAGE, ownershipBudgetStore } from "./ownership-budget.ts";
import { createOwnershipLoader, type OwnershipLoaderOptions } from "./ownership-loader.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const SIZE = { width: 102, height: 102 };
const SHARD = "s";
const HOUR = 3_600_000;

/** W13S28 所在扇区 W19S20–W10S29：有符号 x -20..-11、y 20..29，世界坐标 x 31..40、y 71..80 */
const SECTOR = { x0: 31, y0: 71, x1: 41, y1: 81 };
const inSector = { x0: 35, y0: 75, x1: 37, y1: 77 };

interface Call {
  readonly shard: string;
  readonly rooms: readonly string[];
  resolve(): void;
  reject(error: unknown): void;
}

function harness(options: Partial<OwnershipLoaderOptions> = {}) {
  const calls: Call[] = [];
  const received: MapStats[] = [];
  const errors: unknown[] = [];
  const loader = createOwnershipLoader({
    fetch: (shard, rooms) =>
      new Promise<MapStats>((resolve, reject) => {
        calls.push({
          shard,
          rooms,
          resolve: () => resolve({ shard, gameTime: 1, rooms: {}, users: {} }),
          reject,
        });
      }),
    onStats: (stats) => received.push(stats),
    onError: (error) => errors.push(error),
    ...options,
  });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const finish = async (index = calls.length - 1) => {
    calls[index]!.resolve();
    await settle();
  };
  return { loader, calls, received, errors, finish, settle };
}

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

describe("所有权加载器", () => {
  it("按 10×10 扇区对齐分批：一次请求取可见扇区里的全部房间", async () => {
    const { loader, calls, received, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.shard).toBe(SHARD);
    expect(calls[0]!.rooms).toHaveLength(100);
    expect(calls[0]!.rooms).toContain("W13S28");
    expect(calls[0]!.rooms).toContain("W19S20");
    expect(calls[0]!.rooms).toContain("W10S29");
    expect(calls[0]!.rooms).not.toContain("W9S28");
    await finish();
    expect(received).toHaveLength(1);
  });

  it("结果缓存：同一区域在有效期内不再请求，过期后重新请求", async () => {
    const { loader, calls, finish } = harness({ ttlMs: 10 * 60_000 });
    loader.request(SHARD, SIZE, inSector);
    await finish();
    loader.request(SHARD, SIZE, SECTOR);
    vi.advanceTimersByTime(9 * 60_000);
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(2 * 60_000);
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(2);
  });

  it("只请求还没缓存的扇区", async () => {
    const { loader, calls, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    await finish();
    // 向东多看一个扇区
    loader.request(SHARD, SIZE, { ...SECTOR, x1: SECTOR.x1 + 5 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.rooms).toHaveLength(100);
    expect(calls[1]!.rooms).toContain("W5S28");
    expect(calls[1]!.rooms).not.toContain("W13S28");
  });

  it("请求进行中反复调用（例如拖动）不连发：完成后只按最后一次的区域补一次", async () => {
    const { loader, calls, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    for (let dx = 1; dx <= 30; dx++) loader.request(SHARD, SIZE, { ...inSector, x0: 35 + dx, x1: 37 + dx });
    expect(calls).toHaveLength(1);
    await finish();
    expect(calls).toHaveLength(2);
    // 最后一次区域 x 65..67：有符号 14..16，扇区 E10–E19
    expect(calls[1]!.rooms).toContain("E14S28");
    expect(calls[1]!.rooms).not.toContain("E4S28");
    await finish();
    expect(calls).toHaveLength(2);
  });

  it("每小时请求数不超过预算；时间窗腾出额度后自动补上最后的区域", async () => {
    const { loader, calls, finish } = harness({ maxPerHour: 2 });
    loader.request(SHARD, SIZE, inSector);
    await finish();
    loader.request(SHARD, SIZE, { x0: 60, y0: 75, x1: 61, y1: 76 });
    await finish();
    loader.request(SHARD, SIZE, { x0: 80, y0: 75, x1: 81, y1: 76 });
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(HOUR - 1000);
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.rooms).toContain("E29S28");
  });

  it("被限流（429）后退避一段时间，期间不请求", async () => {
    const { loader, calls, errors, settle } = harness({ rateLimitBackoffMs: 15 * 60_000 });
    loader.request(SHARD, SIZE, inSector);
    calls[0]!.reject(new SourceError("rateLimited", "429", 429));
    await settle();
    expect(errors).toHaveLength(1);
    loader.request(SHARD, SIZE, inSector);
    vi.advanceTimersByTime(14 * 60_000);
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(2 * 60_000);
    expect(calls).toHaveLength(2);
  });

  it("额度与限流退避存在额度存储里：刷新页面（新的加载器、同一存储）后接着算，不会清零", async () => {
    const storage = memoryStorage();
    const first = harness({ maxPerHour: 2, budget: ownershipBudgetStore(storage, "season") });
    first.loader.request(SHARD, SIZE, inSector);
    await first.finish();
    first.loader.request(SHARD, SIZE, { x0: 60, y0: 75, x1: 61, y1: 76 });
    await first.finish();
    first.loader.dispose();

    const second = harness({ maxPerHour: 2, budget: ownershipBudgetStore(storage, "season") });
    second.loader.request(SHARD, SIZE, { x0: 80, y0: 75, x1: 81, y1: 76 });
    expect(second.calls).toHaveLength(0);
    vi.advanceTimersByTime(HOUR + 1000);
    expect(second.calls).toHaveLength(1);

    // 被限流后的退避同样跨加载器
    second.calls[0]!.reject(new SourceError("rateLimited", "429", 429));
    await second.settle();
    second.loader.dispose();
    const third = harness({ maxPerHour: 30, rateLimitBackoffMs: 15 * 60_000, budget: ownershipBudgetStore(storage, "season") });
    third.loader.request(SHARD, SIZE, { x0: 60, y0: 75, x1: 61, y1: 76 });
    expect(third.calls).toHaveLength(0);
    // 别的 Server 不受影响
    const other = harness({ budget: ownershipBudgetStore(storage, "mmo") });
    other.loader.request(SHARD, SIZE, inSector);
    expect(other.calls).toHaveLength(1);
  });

  it("额度存储登记为不导出的运行状态；内容损坏时当作没有记录", () => {
    expect(STORED_KEYS).toContain(OWNERSHIP_BUDGET_STORAGE);
    expect(OWNERSHIP_BUDGET_STORAGE).toMatchObject({ role: "runtime", prefix: true });
    const storage = memoryStorage();
    storage.setItem(OWNERSHIP_BUDGET_STORAGE.key + "season", '{"sent":"x"}');
    expect(ownershipBudgetStore(storage, "season").load()).toEqual({ sent: [], blockedUntil: 0 });
  });

  it("其他失败报告错误，不缓存，下次调用重试", async () => {
    const { loader, calls, errors, settle } = harness();
    loader.request(SHARD, SIZE, inSector);
    calls[0]!.reject(new SourceError("network", "down"));
    await settle();
    expect(errors).toHaveLength(1);
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(2);
  });

  it("可见房间超过单次上限时先取离可见区域中心近的扇区，其余接着分批取", async () => {
    const { loader, calls, finish } = harness({ maxRoomsPerRequest: 200 });
    // 3×1 个扇区，中间那个离中心最近
    loader.request(SHARD, SIZE, { x0: 21, y0: 75, x1: 51, y1: 76 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rooms).toHaveLength(200);
    expect(calls[0]!.rooms).toContain("W15S25");
    await finish();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.rooms).toHaveLength(100);
    await finish();
    expect(calls).toHaveLength(2);
  });

  it("世界边缘的扇区只请求世界之内的房间", () => {
    const { loader, calls } = harness();
    loader.request(SHARD, SIZE, { x0: 0, y0: 0, x1: 1, y1: 1 });
    // 有符号 -51..-51 所在扇区 -60..-51 只有 x = -51 一列在世界内；y 同理
    expect(calls[0]!.rooms).toEqual(["W50N50"]);
  });

  it("不同 Shard 的缓存互不影响", async () => {
    const { loader, calls, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    await finish();
    loader.request("other", SIZE, inSector);
    expect(calls.map((c) => c.shard)).toEqual([SHARD, "other"]);
  });

  it("dispose 后不再请求，进行中的结果也丢弃", async () => {
    const { loader, calls, received, finish } = harness({ maxPerHour: 1 });
    loader.request(SHARD, SIZE, inSector);
    loader.dispose();
    await finish();
    expect(received).toEqual([]);
    loader.request(SHARD, SIZE, inSector);
    vi.advanceTimersByTime(2 * HOUR);
    expect(calls).toHaveLength(1);
  });
});

describe("所有权加载器：按房间补查（PvP Overview 等）", () => {
  it("取房间所在的整个扇区；每个 Shard 一次请求，依次取", async () => {
    const { loader, calls, received, finish } = harness();
    loader.requestRooms([
      { shard: SHARD, room: "W13S28" },
      { shard: SHARD, room: "W15S21" },
      { shard: "other", room: "E5N5" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.shard).toBe(SHARD);
    expect(calls[0]!.rooms).toHaveLength(100);
    expect(calls[0]!.rooms).toContain("W19S20");
    expect(calls[0]!.rooms).toContain("W10S29");
    await finish();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.shard).toBe("other");
    expect(calls[1]!.rooms).toContain("E0N9");
    expect(calls[1]!.rooms).toContain("E9N0");
    await finish();
    expect(calls).toHaveLength(2);
    expect(received).toHaveLength(2);
  });

  it("与地图共用缓存：地图取过的扇区不再补查，补查过的扇区地图也不再取", async () => {
    const { loader, calls, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    await finish();
    loader.requestRooms([{ shard: SHARD, room: "W13S28" }]);
    expect(calls).toHaveLength(1);
    loader.requestRooms([{ shard: SHARD, room: "E5S5" }]);
    expect(calls).toHaveLength(2);
    await finish();
    loader.request(SHARD, SIZE, { x0: 56, y0: 56, x1: 57, y1: 57 });
    expect(calls).toHaveLength(2);
  });

  it("地图的可见区域优先：两者都在等时先取地图", async () => {
    const { loader, calls, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    loader.requestRooms([{ shard: SHARD, room: "E5S5" }]);
    loader.request(SHARD, SIZE, { x0: 60, y0: 75, x1: 61, y1: 76 });
    await finish();
    expect(calls[1]!.rooms).toContain("E9S28");
    await finish();
    expect(calls[2]!.rooms).toContain("E5S5");
  });

  it("补查只用额度中留给地图之外的部分；地图仍可用剩下的", async () => {
    const { loader, calls, finish } = harness({ maxPerHour: 3, backgroundReserve: 1, ttlMs: 2 * HOUR });
    loader.requestRooms([{ shard: SHARD, room: "E5S5" }]);
    await finish();
    loader.requestRooms([{ shard: SHARD, room: "E15S5" }]);
    await finish();
    loader.requestRooms([{ shard: SHARD, room: "E25S5" }]);
    expect(calls).toHaveLength(2);
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(3);
    await finish();
    vi.advanceTimersByTime(HOUR + 1000);
    expect(calls).toHaveLength(4);
    expect(calls[3]!.rooms).toContain("E25S5");
  });

  it("补查的结果按更长的有效期算（所有权很少变）", async () => {
    const { loader, calls, finish } = harness({ ttlMs: 10 * 60_000, backgroundTtlMs: 60 * 60_000 });
    loader.requestRooms([{ shard: SHARD, room: "W13S28" }]);
    await finish();
    vi.advanceTimersByTime(30 * 60_000);
    loader.requestRooms([{ shard: SHARD, room: "W13S28" }]);
    expect(calls).toHaveLength(1);
    loader.request(SHARD, SIZE, inSector);
    expect(calls).toHaveLength(2);
  });

  it("新的补查清单替换旧的", async () => {
    const { loader, calls, finish } = harness();
    loader.request(SHARD, SIZE, inSector);
    loader.requestRooms([{ shard: SHARD, room: "E5S5" }]);
    loader.requestRooms([{ shard: SHARD, room: "E15S5" }]);
    await finish();
    expect(calls[1]!.rooms).toContain("E15S5");
    expect(calls[1]!.rooms).not.toContain("E5S5");
    await finish();
    expect(calls).toHaveLength(2);
  });
});
