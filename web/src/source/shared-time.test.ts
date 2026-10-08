/**
 * game/time 去重（#38）：同一 Source 内同一 Shard 的当前时间请求在途去重，刚拿到的结果在很短的窗口内复用；
 * 调用方可用 maxAgeMs 收紧复用（Top Bar 的 Tick 速度估算要真实到达时刻，传 0 只并入在途请求）。
 * 经 staticCached（与 #35 的静态数据同一层）观察底层请求次数。
 */
import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import type { ServerConfig, Source } from "./source.ts";
import { staticCached } from "./static-cache.ts";
import { TIME_REUSE_MS } from "./shared-time.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 记下每次底层 getTime，响应由测试放行 */
function network() {
  const requests: { shard: string; resolve: (tick: number) => void; reject: (error: unknown) => void }[] = [];
  const factory = (server: ServerConfig): Source => {
    const base = new FixtureSource({ ...bundle, server }, { speed: Infinity });
    base.getTime = (shard) => new Promise((resolve, reject) => requests.push({ shard, resolve, reject }));
    return base;
  };
  return { factory, requests };
}

function setup() {
  const net = network();
  let clock = 1_000_000;
  const source = staticCached(net.factory, { storage: undefined, now: () => clock })(SERVER_PRESETS.season, "t");
  return { net, source, advance: (ms: number) => (clock += ms) };
}

describe("game/time 去重", () => {
  it("同时多次要同一 Shard 的时间只发一个请求，大家拿到同一结果", async () => {
    const { net, source } = setup();
    const all = Promise.all([source.getTime("shardSeason"), source.getTime("shardSeason"), source.getTime("shardSeason")]);
    expect(net.requests).toHaveLength(1);
    net.requests[0]!.resolve(42);
    expect(await all).toEqual([42, 42, 42]);
  });

  it("不同 Shard 不互相复用", async () => {
    const { net, source } = setup();
    void source.getTime("shard0");
    void source.getTime("shard1");
    void source.getTime("shard0");
    expect(net.requests.map((r) => r.shard)).toEqual(["shard0", "shard1"]);
    net.requests[0]!.resolve(1);
    await source.getTime("shard0");
    void source.getTime("shard1");
    expect(net.requests).toHaveLength(2);
  });

  it("复用窗口远小于一个 Tick（赛季服约 3.7 秒）", () => {
    expect(TIME_REUSE_MS).toBeGreaterThan(0);
    expect(TIME_REUSE_MS).toBeLessThanOrEqual(1000);
  });

  it("刚拿到的结果在复用窗口内直接给，过了窗口重新请求", async () => {
    const { net, source, advance } = setup();
    const first = source.getTime("shardSeason");
    net.requests[0]!.resolve(100);
    await first;
    advance(TIME_REUSE_MS - 1);
    expect(await source.getTime("shardSeason")).toBe(100);
    expect(net.requests).toHaveLength(1);
    advance(1);
    void source.getTime("shardSeason");
    expect(net.requests).toHaveLength(2);
  });

  it("maxAgeMs: 0 不拿已到达的旧结果，但并入在途请求（到达时刻仍是真实的）", async () => {
    const { net, source } = setup();
    const first = source.getTime("shardSeason");
    const joined = source.getTime("shardSeason", { maxAgeMs: 0 });
    expect(net.requests).toHaveLength(1);
    net.requests[0]!.resolve(100);
    expect(await Promise.all([first, joined])).toEqual([100, 100]);

    // 刚到达的结果不复用给要新采样的调用方
    const fresh = source.getTime("shardSeason", { maxAgeMs: 0 });
    expect(net.requests).toHaveLength(2);
    net.requests[1]!.resolve(101);
    expect(await fresh).toBe(101);
    // 普通调用方照常复用这次新结果
    expect(await source.getTime("shardSeason")).toBe(101);
    expect(net.requests).toHaveLength(2);
  });

  it("失败不复用：之后再要会重新请求", async () => {
    const { net, source } = setup();
    const failed = source.getTime("shardSeason");
    net.requests[0]!.reject(new Error("down"));
    await expect(failed).rejects.toThrow("down");
    void source.getTime("shardSeason");
    expect(net.requests).toHaveLength(2);
  });
});
