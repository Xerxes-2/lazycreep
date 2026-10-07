import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { HistoryChunk } from "../source/source.ts";
import { cachedHistory, openHistoryCache, type HistoryCache, type HistoryCacheOptions } from "./history-cache.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const SHARD = "shardSeason";

/** 记录对 Source 的历史请求次数。 */
function countingSource() {
  const source = new FixtureSource(bundle);
  const calls: string[] = [];
  return {
    calls,
    source: {
      server: source.server,
      getHistoryChunk(shard: string, room: string, base: number) {
        calls.push(`${room}/${base}`);
        return source.getHistoryChunk(shard, room, base);
      },
    },
  };
}

/** 一个约 size 字节的假 chunk。 */
function fakeChunk(room: string, base: number, size: number): HistoryChunk {
  return {
    shard: SHARD,
    room,
    base,
    ticks: [{ gameTime: base, objects: { a: { type: "x", x: 0, y: 0, pad: "x".repeat(size) } } }],
  };
}

let cache: HistoryCache | undefined;

async function mustOpen(options: HistoryCacheOptions): Promise<HistoryCache> {
  const opened = await openHistoryCache(options);
  if (!opened) throw new Error("缓存没打开");
  return opened;
}
afterEach(() => {
  cache?.close();
  cache = undefined;
});

describe("历史 chunk 缓存（IndexedDB）", () => {
  it("命中时不重复请求，取回的内容与原始一致", async () => {
    cache = await mustOpen({ indexedDB: new IDBFactory(), limitBytes: 10_000_000 });
    const { source, calls } = countingSource();
    const fetch = cachedHistory(source, cache);

    const first = await fetch(SHARD, "W13S28", 1024900);
    const second = await fetch(SHARD, "W13S28", 1024900);
    expect(calls).toEqual(["W13S28/1024900"]);
    expect(second).toEqual(first);
    expect(second?.ticks).toHaveLength(100);
  });

  it("缓存跨会话保留（重新打开同一个数据库仍命中）", async () => {
    const indexedDB = new IDBFactory();
    const earlier = await mustOpen({ indexedDB, limitBytes: 10_000_000 });
    await cachedHistory(countingSource().source, earlier)(SHARD, "E13N21", 1024900);
    await vi.waitFor(async () => expect(await earlier.usage()).toBeGreaterThan(0));
    earlier.close();

    cache = await mustOpen({ indexedDB, limitBytes: 10_000_000 });
    const { source, calls } = countingSource();
    expect(await cachedHistory(source, cache)(SHARD, "E13N21", 1024900)).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it("历史不存在（null）不缓存，下次仍会请求", async () => {
    cache = await mustOpen({ indexedDB: new IDBFactory(), limitBytes: 10_000_000 });
    const { source, calls } = countingSource();
    const fetch = cachedHistory(source, cache);
    expect(await fetch(SHARD, "W13S28", 999900)).toBeNull();
    expect(await fetch(SHARD, "W13S28", 999900)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("超出上限时淘汰最久未访问的 chunk", async () => {
    let clock = 0;
    cache = await mustOpen({ indexedDB: new IDBFactory(), limitBytes: 3500, now: () => ++clock });
    await cache.put("s/A/0", fakeChunk("A", 0, 1000));
    await cache.put("s/B/0", fakeChunk("B", 0, 1000));
    await cache.put("s/C/0", fakeChunk("C", 0, 1000));
    // 访问 A，使 B 成为最久未访问
    expect(await cache.get("s/A/0")).toBeDefined();
    await cache.put("s/D/0", fakeChunk("D", 0, 1000));

    expect(await cache.get("s/B/0")).toBeUndefined();
    expect(await cache.get("s/A/0")).toBeDefined();
    expect(await cache.get("s/C/0")).toBeDefined();
    expect(await cache.get("s/D/0")).toBeDefined();
    expect(await cache.usage()).toBeLessThanOrEqual(3500);
  });

  it("调小上限时立即按新上限淘汰", async () => {
    let clock = 0;
    cache = await mustOpen({ indexedDB: new IDBFactory(), limitBytes: 10_000, now: () => ++clock });
    for (const room of ["A", "B", "C"]) await cache.put(`s/${room}/0`, fakeChunk(room, 0, 1000));
    await cache.setLimit(1500);
    expect(await cache.get("s/A/0")).toBeUndefined();
    expect(await cache.get("s/B/0")).toBeUndefined();
    expect(await cache.get("s/C/0")).toBeDefined();
  });

  it("键区分 Server：同名房间在不同 Server 上不串", async () => {
    cache = await mustOpen({ indexedDB: new IDBFactory(), limitBytes: 10_000_000 });
    const { source, calls } = countingSource();
    await cachedHistory(source, cache)(SHARD, "W13S28", 1024900);
    await cachedHistory({ ...source, server: { ...source.server, id: "other" } }, cache)(SHARD, "W13S28", 1024900);
    expect(calls).toHaveLength(2);
  });

  it("IndexedDB 不可用时退化为直接请求", async () => {
    const unavailable = await openHistoryCache({ indexedDB: undefined, limitBytes: 1000 });
    expect(unavailable).toBeUndefined();
    const { source, calls } = countingSource();
    const fetch = cachedHistory(source, unavailable);
    expect(await fetch(SHARD, "W13S28", 1024900)).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("读写出错时退化为不缓存，Replay 照常取到历史", async () => {
    const broken: HistoryCache = {
      get: () => Promise.reject(new Error("坏了")),
      put: () => Promise.reject(new Error("坏了")),
      setLimit: () => Promise.reject(new Error("坏了")),
      usage: () => Promise.reject(new Error("坏了")),
      close: () => {},
    };
    const { source } = countingSource();
    const chunk = await cachedHistory(source, broken)(SHARD, "W13S28", 1024900);
    expect(chunk?.ticks).toHaveLength(100);
  });
});
