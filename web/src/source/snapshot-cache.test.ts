/**
 * #63：房间快照缓存。只在内存里，约 60 秒内有效（过期不用、重新请求；后台刷新可要求更新）；同一房间并发只发一次；
 * 失败不缓存（照常拒绝，下次重新请求）；不持久化。
 */
import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import type { RoomSnapshot, ServerConfig, Source } from "./source.ts";
import { SNAPSHOT_FRESH_MS, SNAPSHOT_REFRESH_MS } from "./snapshot-cache.ts";
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

/** 每次请求的结果不同（版本号递增），借此分辨给的是缓存还是新请求 */
const snapshotOf = (room: string, version: number): RoomSnapshot => ({
  objects: { [`${room}#${version}`]: { type: "creep", x: 1, y: 1 } },
  users: {},
});

function network() {
  const calls: string[] = [];
  const state = { fail: false };
  const pending: (() => void)[] = [];
  let hold = false;
  const factory = (server: ServerConfig): Source => {
    const base = new FixtureSource({ ...bundle, server }, { speed: Infinity });
    base.getRoomSnapshot = async (_shard, room) => {
      calls.push(room);
      const version = calls.length;
      if (hold) await new Promise<void>((resolve) => pending.push(resolve));
      if (state.fail) throw new Error("down");
      return snapshotOf(room, version);
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

describe("房间快照缓存", () => {
  it("约 60 秒内同一个房间不再请求，给同一份快照", async () => {
    expect(SNAPSHOT_FRESH_MS).toBe(60_000);
    const net = network();
    const time = clock();
    const source = open(net, { now: time.now });
    expect(await source.getRoomSnapshot(SHARD, "W1N1")).toEqual(snapshotOf("W1N1", 1));
    time.advance(SNAPSHOT_FRESH_MS - 1);
    expect(await source.getRoomSnapshot(SHARD, "W1N1")).toEqual(snapshotOf("W1N1", 1));
    expect(net.calls).toEqual(["W1N1"]);
  });

  it("过期后不用旧值：重新请求，给新快照", async () => {
    const net = network();
    const time = clock();
    const source = open(net, { now: time.now });
    await source.getRoomSnapshot(SHARD, "W1N1");
    time.advance(SNAPSHOT_FRESH_MS);
    expect(await source.getRoomSnapshot(SHARD, "W1N1")).toEqual(snapshotOf("W1N1", 2));
    expect(net.calls).toEqual(["W1N1", "W1N1"]);
  });

  it("maxAgeMs：比它旧的快照重新请求（后台刷新用），新的快照之后照常命中", async () => {
    expect(SNAPSHOT_REFRESH_MS).toBe(30_000);
    const net = network();
    const time = clock();
    const source = open(net, { now: time.now });
    await source.getRoomSnapshot(SHARD, "W1N1");
    time.advance(SNAPSHOT_REFRESH_MS - 1);
    expect(await source.getRoomSnapshot(SHARD, "W1N1", { maxAgeMs: SNAPSHOT_REFRESH_MS })).toEqual(snapshotOf("W1N1", 1));
    time.advance(1);
    expect(await source.getRoomSnapshot(SHARD, "W1N1", { maxAgeMs: SNAPSHOT_REFRESH_MS })).toEqual(snapshotOf("W1N1", 2));
    expect(await source.getRoomSnapshot(SHARD, "W1N1")).toEqual(snapshotOf("W1N1", 2));
    expect(net.calls).toEqual(["W1N1", "W1N1"]);
  });

  it("同时要同一个房间只发一次", async () => {
    const net = network();
    const source = open(net);
    net.hold(true);
    const both = Promise.all([source.getRoomSnapshot(SHARD, "W1N1"), source.getRoomSnapshot(SHARD, "W1N1")]);
    await settle();
    net.release();
    const [a, b] = await both;
    expect(a).toEqual(b);
    expect(net.calls).toEqual(["W1N1"]);
  });

  it("按 Shard 与房间区分", async () => {
    const net = network();
    const source = open(net);
    await source.getRoomSnapshot(SHARD, "W1N1");
    await source.getRoomSnapshot("shard3", "W1N1");
    await source.getRoomSnapshot(SHARD, "W2N1");
    expect(net.calls).toEqual(["W1N1", "W1N1", "W2N1"]);
  });

  it("请求失败照常拒绝、不缓存，下次重新请求", async () => {
    const net = network();
    const source = open(net);
    net.state.fail = true;
    await expect(source.getRoomSnapshot(SHARD, "W1N1")).rejects.toThrow("down");
    net.state.fail = false;
    expect(await source.getRoomSnapshot(SHARD, "W1N1")).toEqual(snapshotOf("W1N1", 2));
    expect(net.calls).toEqual(["W1N1", "W1N1"]);
  });

  it("不持久化：新的 Source、同一存储时照样请求", async () => {
    const storage = memoryStorage();
    await open(network(), { storage }).getRoomSnapshot(SHARD, "W1N1");
    const next = network();
    await open(next, { storage }).getRoomSnapshot(SHARD, "W1N1");
    expect(next.calls).toEqual(["W1N1"]);
  });
});
