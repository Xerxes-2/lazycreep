/**
 * 静态数据缓存（#35）：Shard 列表与世界尺寸在同一 Source 内在途去重，并按 Server 持久化到本地存储；
 * 新鲜时不发请求，过期后先给旧值、后台刷新。用记账的假 Source 与内存存储观察请求次数。
 */
import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import type { ServerConfig, ServerVersion, ShardInfo, Source, WorldSize } from "./source.ts";
import { SHARDS_FRESH_MS, WORLD_SIZE_FRESH_MS, staticCached } from "./static-cache.ts";

const bundle = fixtureBundle(
  Object.values(
    import.meta.glob<unknown>("../../../fixtures/season/*.json", {
      eager: true,
      import: "default",
    }),
  ),
);

const SEASON = SERVER_PRESETS.season;
const MMO = SERVER_PRESETS.mmo;

interface Pending<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

/** 记下每次 getShards / getWorldSize，响应由测试放行 */
function network() {
  const shards: Pending<readonly ShardInfo[]>[] = [];
  const sizes: { shard: string; pending: Pending<WorldSize> }[] = [];
  const versions: Pending<ServerVersion>[] = [];
  const factory = (server: ServerConfig): Source => {
    const base = new FixtureSource({ ...bundle, server }, { speed: Infinity });
    base.getShards = () => new Promise((resolve, reject) => shards.push({ resolve, reject }));
    base.getWorldSize = (shard) =>
      new Promise((resolve, reject) => sizes.push({ shard, pending: { resolve, reject } }));
    base.getVersion = () => new Promise((resolve, reject) => versions.push({ resolve, reject }));
    return base;
  };
  return { factory, shards, sizes, versions };
}

/** 内存里的 localStorage */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    keys: () => [...map.keys()],
  };
}

const LIST: readonly ShardInfo[] = [{ name: "shardSeason", rooms: 2628, users: 68, tickMs: 3790 }];
const LIST2: readonly ShardInfo[] = [{ name: "shardSeason", rooms: 2700, users: 70, tickMs: 3500 }];
const SIZE: WorldSize = { width: 102, height: 102 };

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("静态数据：在途去重", () => {
  it("同时多处要 Shard 列表只发一个请求，大家拿到同一结果", async () => {
    const net = network();
    const source = staticCached(net.factory, { storage: memoryStorage() })(SEASON, "t");
    const a = source.getShards();
    const b = source.getShards();
    const c = source.getShards();
    expect(net.shards).toHaveLength(1);
    net.shards[0]!.resolve(LIST);
    expect(await Promise.all([a, b, c])).toEqual([LIST, LIST, LIST]);
  });

  it("世界尺寸按 Shard 去重：同一 Shard 一个请求，不同 Shard 各一个", async () => {
    const net = network();
    const source = staticCached(net.factory, { storage: memoryStorage() })(SEASON, "t");
    void source.getWorldSize("shard0");
    void source.getWorldSize("shard0");
    void source.getWorldSize("shard1");
    expect(net.sizes.map((s) => s.shard)).toEqual(["shard0", "shard1"]);
  });

  it("失败不缓存：之后再要会重新请求", async () => {
    const net = network();
    const source = staticCached(net.factory, { storage: memoryStorage() })(SEASON, "t");
    const failed = source.getShards();
    net.shards[0]!.reject(new Error("down"));
    await expect(failed).rejects.toThrow("down");
    void source.getShards();
    expect(net.shards).toHaveLength(2);
  });
});

describe("静态数据：持久化缓存", () => {
  it("拿到过的 Shard 列表与世界尺寸，下次启动（新的 Source）直接给出，不发请求", async () => {
    const storage = memoryStorage();
    const first = network();
    const before = staticCached(first.factory, { storage })(SEASON, "t");
    const shards = before.getShards();
    const size = before.getWorldSize("shardSeason");
    first.shards[0]!.resolve(LIST);
    first.sizes[0]!.pending.resolve(SIZE);
    await Promise.all([shards, size]);
    before.close();

    const second = network();
    const after = staticCached(second.factory, { storage })(SEASON, "other-token");
    expect(await after.getShards()).toEqual(LIST);
    expect(await after.getWorldSize("shardSeason")).toEqual(SIZE);
    expect(second.shards).toHaveLength(0);
    expect(second.sizes).toHaveLength(0);
  });

  it("按 Server 分开：别的 Server 不用这份缓存；世界尺寸按 Shard 分开", async () => {
    const storage = memoryStorage();
    const first = network();
    const season = staticCached(first.factory, { storage })(SEASON, "t");
    const got = season.getWorldSize("shardSeason");
    first.sizes[0]!.pending.resolve(SIZE);
    await got;

    const second = network();
    const cached = staticCached(second.factory, { storage });
    void cached(MMO, "t").getWorldSize("shardSeason");
    void cached(SEASON, "t").getWorldSize("shard0");
    expect(second.sizes.map((s) => s.shard)).toEqual(["shardSeason", "shard0"]);
    expect(storage.keys().every((key) => key.startsWith("msc."))).toBe(true);
  });

  it("过期后先给旧值、不等网络，后台刷新一次；刷新结果供之后使用", async () => {
    const storage = memoryStorage();
    let now = 1_000_000;
    const clock = () => now;
    const first = network();
    const before = staticCached(first.factory, { storage, now: clock })(SEASON, "t");
    const got = before.getShards();
    first.shards[0]!.resolve(LIST);
    await got;

    now += SHARDS_FRESH_MS + 1;
    const second = network();
    const after = staticCached(second.factory, { storage, now: clock })(SEASON, "t");
    // 后台请求一直没回来，也立即拿到旧值
    expect(await after.getShards()).toEqual(LIST);
    expect(await after.getShards()).toEqual(LIST);
    expect(second.shards).toHaveLength(1);

    second.shards[0]!.resolve(LIST2);
    await flush();
    expect(await after.getShards()).toEqual(LIST2);
    const third = network();
    expect(await staticCached(third.factory, { storage, now: clock })(SEASON, "t").getShards()).toEqual(LIST2);
    expect(third.shards).toHaveLength(0);
  });

  it("后台刷新失败时照旧用旧值，不报错", async () => {
    const storage = memoryStorage();
    let now = 0;
    const first = network();
    const before = staticCached(first.factory, { storage, now: () => now })(SEASON, "t");
    const got = before.getWorldSize("shardSeason");
    first.sizes[0]!.pending.resolve(SIZE);
    await got;

    now += WORLD_SIZE_FRESH_MS + 1;
    const second = network();
    const after = staticCached(second.factory, { storage, now: () => now })(SEASON, "t");
    expect(await after.getWorldSize("shardSeason")).toEqual(SIZE);
    second.sizes[0]!.pending.reject(new Error("down"));
    await flush();
    expect(await after.getWorldSize("shardSeason")).toEqual(SIZE);
  });

  it("版本信息（含赛季渲染器配置）同样在途去重、持久化，下次启动不发请求（#47）", async () => {
    const storage = memoryStorage();
    const version = await new FixtureSource(bundle, { speed: Infinity }).getVersion();
    expect(version.renderer).toBeDefined();
    const first = network();
    const before = staticCached(first.factory, { storage })(SEASON, "t");
    const a = before.getVersion();
    const b = before.getVersion();
    expect(first.versions).toHaveLength(1);
    first.versions[0]!.resolve(version);
    expect(await Promise.all([a, b])).toEqual([version, version]);

    const second = network();
    expect(await staticCached(second.factory, { storage })(SEASON, "t").getVersion()).toEqual(version);
    expect(second.versions).toHaveLength(0);
  });

  it("旧版缓存里的版本信息没有瓦片根地址：丢弃并重新取，不用旧赛季的瓦片", async () => {
    const storage = memoryStorage();
    const version = await new FixtureSource(bundle, { speed: Infinity }).getVersion();
    expect(version.mapTileRoot).toBe("/season-static/season11/map");
    const first = network();
    const got = staticCached(first.factory, { storage })(SEASON, "t").getVersion();
    first.versions[0]!.resolve(version);
    await got;
    for (const key of storage.keys()) {
      const stored = JSON.parse(storage.getItem(key)!);
      delete stored.version.value.mapTileRoot;
      storage.setItem(key, JSON.stringify(stored));
    }

    const second = network();
    void staticCached(second.factory, { storage })(SEASON, "t").getVersion();
    expect(second.versions).toHaveLength(1);
  });

  it("存储里的内容损坏时当作没有缓存", async () => {
    const storage = memoryStorage();
    const first = network();
    const before = staticCached(first.factory, { storage })(SEASON, "t");
    const got = before.getShards();
    first.shards[0]!.resolve(LIST);
    await got;
    for (const key of storage.keys()) storage.setItem(key, '{"shards":{"at":"x","value":[1]}}');

    const second = network();
    void staticCached(second.factory, { storage })(SEASON, "t").getShards();
    expect(second.shards).toHaveLength(1);
  });

  it("其余方法原样转给底层 Source", async () => {
    const net = network();
    const source = staticCached(net.factory, { storage: memoryStorage() })(SEASON, "t");
    expect(source.server).toBe(SEASON);
    expect(source.mapTiles("shardSeason", undefined).sector("W9N9")).toBe("/map-tiles/shardSeason/zoom1/W9N9.png");
    expect(await source.getTime("shardSeason")).toBeGreaterThan(0);
  });
});
