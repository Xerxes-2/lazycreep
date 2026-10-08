/**
 * #61：房间装饰缓存。一天内不重复请求，过期先给旧值再后台刷新；内存 + 按 Server 持久化；
 * 同一房间并发只发一次；失败时给“没有装饰”（默认外观），不拒绝。
 */
import { describe, expect, it } from "vitest";
import { STORED_KEYS } from "../customize/settings-transfer.ts";
import { DECORATION_CACHE_MAX_ROOMS, DECORATION_CACHE_STORAGE, DECORATIONS_FRESH_MS } from "./decoration-cache.ts";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import { NO_DECORATIONS, type RoomDecorations } from "./room-decorations.ts";
import { SERVER_PRESETS } from "./servers.ts";
import type { ServerConfig, Source } from "./source.ts";
import { staticCached } from "./static-cache.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);
const SEASON = SERVER_PRESETS.season;
const SHARD = "shardSeason";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** 每个房间的装饰：一个以房间名为类型的对象装饰，版本号区分新旧 */
const decorationsOf = (room: string, version = 1): RoomDecorations => ({
  objects: [{ objectType: `${room}#${version}`, width: 100, height: 100, graphics: [{ url: "/season-static/x.svg" }] }],
});

function network() {
  const calls: string[] = [];
  const state = { fail: false, version: 1 };
  const pending: (() => void)[] = [];
  let hold = false;
  const factory = (server: ServerConfig): Source => {
    const base = new FixtureSource({ ...bundle, server }, { speed: Infinity });
    base.getRoomDecorations = async (_shard, room) => {
      calls.push(room);
      if (hold) await new Promise<void>((resolve) => pending.push(resolve));
      if (state.fail) throw new Error("down");
      return decorationsOf(room, state.version);
    };
    return base;
  };
  return {
    factory,
    calls,
    state,
    hold: (value: boolean) => (hold = value),
    release: () => pending.splice(0).forEach((resolve) => resolve()),
  };
}

function clock(start = 1_000_000) {
  const time = { now: start };
  return { now: () => time.now, advance: (ms: number) => (time.now += ms) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = (net: ReturnType<typeof network>, options: { storage?: ReturnType<typeof memoryStorage>; now?: () => number } = {}) =>
  staticCached(net.factory, { storage: options.storage ?? memoryStorage(), ...(options.now ? { now: options.now } : {}) })(SEASON, "t");

describe("房间装饰缓存", () => {
  it("同一个房间一天内只请求一次", async () => {
    const net = network();
    const time = clock();
    const source = open(net, { now: time.now });
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
    time.advance(DECORATIONS_FRESH_MS - 1);
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
    expect(net.calls).toEqual(["W1N1"]);
  });

  it("过期后先给旧值，后台刷新，之后给新值", async () => {
    const net = network();
    const time = clock();
    const source = open(net, { now: time.now });
    await source.getRoomDecorations(SHARD, "W1N1");
    time.advance(DECORATIONS_FRESH_MS);
    net.state.version = 2;
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1", 1));
    await settle();
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1", 2));
    expect(net.calls).toEqual(["W1N1", "W1N1"]);
  });

  it("同时要同一个房间只发一次", async () => {
    const net = network();
    const source = open(net);
    net.hold(true);
    const both = Promise.all([source.getRoomDecorations(SHARD, "W1N1"), source.getRoomDecorations(SHARD, "W1N1")]);
    await settle();
    net.release();
    await both;
    expect(net.calls).toEqual(["W1N1"]);
  });

  it("持久化：新的 Source、同一存储时不再请求", async () => {
    const storage = memoryStorage();
    await open(network(), { storage }).getRoomDecorations(SHARD, "W1N1");
    const next = network();
    expect(await open(next, { storage }).getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
    expect(next.calls).toEqual([]);
  });

  it("按 Shard 区分", async () => {
    const net = network();
    const source = open(net);
    await source.getRoomDecorations(SHARD, "W1N1");
    await source.getRoomDecorations("shard3", "W1N1");
    expect(net.calls).toEqual(["W1N1", "W1N1"]);
  });

  it("请求失败时给“没有装饰”、不缓存，下次重新请求", async () => {
    const net = network();
    const source = open(net);
    net.state.fail = true;
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(NO_DECORATIONS);
    net.state.fail = false;
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
    expect(net.calls).toEqual(["W1N1", "W1N1"]);
  });

  it("过期后后台刷新失败时照旧用旧值", async () => {
    const net = network();
    const time = clock();
    const source = open(net, { now: time.now });
    await source.getRoomDecorations(SHARD, "W1N1");
    time.advance(DECORATIONS_FRESH_MS);
    net.state.fail = true;
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
    await settle();
    expect(await source.getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
  });

  it(`条目有上限（${DECORATION_CACHE_MAX_ROOMS} 个房间），按最近使用淘汰`, async () => {
    const storage = memoryStorage();
    const source = open(network(), { storage });
    await source.getRoomDecorations(SHARD, "W0N0");
    for (let i = 1; i <= DECORATION_CACHE_MAX_ROOMS; i++) {
      await source.getRoomDecorations(SHARD, `W${i}N0`);
      if (i === DECORATION_CACHE_MAX_ROOMS - 1) await source.getRoomDecorations(SHARD, "W0N0");
    }
    const next = network();
    const reopened = open(next, { storage });
    await reopened.getRoomDecorations(SHARD, "W0N0");
    await reopened.getRoomDecorations(SHARD, "W1N0");
    expect(next.calls).toEqual(["W1N0"]);
  });

  it("存储里的内容损坏时当作没有缓存", async () => {
    const storage = memoryStorage();
    storage.setItem(DECORATION_CACHE_STORAGE.key + SEASON.id, '{"rooms":{"shardSeason/W1N1":{"at":1,"value":{"objects":"x"}}}}');
    const net = network();
    expect(await open(net, { storage }).getRoomDecorations(SHARD, "W1N1")).toEqual(decorationsOf("W1N1"));
    expect(net.calls).toEqual(["W1N1"]);
  });

  it("存储键登记为不导出的运行状态", () => {
    expect(STORED_KEYS).toContain(DECORATION_CACHE_STORAGE);
    expect(DECORATION_CACHE_STORAGE).toMatchObject({ role: "runtime", prefix: true });
  });
});
