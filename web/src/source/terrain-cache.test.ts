/**
 * 房间地形缓存：地形在一个赛季内不变，进过的房间不再请求 `game/room-terrain`（有每小时限额，约 1.4 秒一次）。
 * 内存 + 按 Server 持久化；以版本信息里的本赛季瓦片根地址为“赛季”标识，换赛季时整体作废；条目有上限，按最近使用淘汰。
 */
import { describe, expect, it } from "vitest";
import { STORED_KEYS } from "../customize/settings-transfer.ts";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import type { ServerConfig, ServerVersion, Source, Terrain } from "./source.ts";
import { STATIC_CACHE_STORAGE, staticCached } from "./static-cache.ts";
import { TERRAIN_CACHE_MAX_ROOMS, TERRAIN_CACHE_STORAGE } from "./terrain-cache.ts";

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
    keys: () => [...map.keys()],
  };
}

const terrainOf = (room: string): Terrain => ({ shard: SHARD, room, encoded: room.padEnd(2500, "0").slice(0, 2500) });

/** 记下每次 getTerrain；版本信息的瓦片根地址可换（模拟换赛季） */
function network(season: { root: string | null } = { root: "/season-static/season11/map" }) {
  const terrain: string[] = [];
  let fail = false;
  const factory = (server: ServerConfig): Source => {
    const base = new FixtureSource({ ...bundle, server }, { speed: Infinity });
    const version = base.getVersion.bind(base);
    base.getVersion = async (): Promise<ServerVersion> => ({ ...(await version()), mapTileRoot: season.root });
    base.getTerrain = async (shard, room) => {
      terrain.push(room);
      if (fail) throw new Error("down");
      return { ...terrainOf(room), shard };
    };
    return base;
  };
  return { factory, terrain, season, setFail: (value: boolean) => (fail = value) };
}

const open = (net: ReturnType<typeof network>, storage = memoryStorage()) => staticCached(net.factory, { storage })(SEASON, "t");

describe("房间地形缓存", () => {
  it("同一个房间第二次不再请求；结果与第一次相同", async () => {
    const net = network();
    const source = open(net);
    expect(await source.getTerrain(SHARD, "W18S26")).toEqual(terrainOf("W18S26"));
    expect(await source.getTerrain(SHARD, "W17S25")).toEqual(terrainOf("W17S25"));
    expect(await source.getTerrain(SHARD, "W18S26")).toEqual(terrainOf("W18S26"));
    expect(net.terrain).toEqual(["W18S26", "W17S25"]);
  });

  it("同时要同一个房间只发一次", async () => {
    const net = network();
    const source = open(net);
    await Promise.all([source.getTerrain(SHARD, "W1N1"), source.getTerrain(SHARD, "W1N1")]);
    expect(net.terrain).toEqual(["W1N1"]);
  });

  it("持久化：刷新页面（新的 Source、同一存储）后不再请求", async () => {
    const storage = memoryStorage();
    await open(network(), storage).getTerrain(SHARD, "W18S26");
    const next = network();
    expect(await open(next, storage).getTerrain(SHARD, "W18S26")).toEqual(terrainOf("W18S26"));
    expect(next.terrain).toEqual([]);
  });

  it("按 Shard 区分", async () => {
    const net = network();
    const source = open(net);
    await source.getTerrain(SHARD, "W1N1");
    await source.getTerrain("shard3", "W1N1");
    expect(net.terrain).toEqual(["W1N1", "W1N1"]);
  });

  it("换赛季（版本信息里的瓦片根地址变了）时旧地形作废", async () => {
    const storage = memoryStorage();
    await open(network({ root: "/season-static/season11/map" }), storage).getTerrain(SHARD, "W18S26");
    // 版本信息本身缓存一天（static-cache.ts）；这里模拟它已刷新到新赛季，地形与瓦片根地址同时切换
    for (const key of storage.keys()) if (key.startsWith(STATIC_CACHE_STORAGE.key)) storage.removeItem(key);
    const next = network({ root: "/season-static/season12/map" });
    await open(next, storage).getTerrain(SHARD, "W18S26");
    expect(next.terrain).toEqual(["W18S26"]);
  });

  it("请求失败不缓存，下次重新请求", async () => {
    const net = network();
    const source = open(net);
    net.setFail(true);
    await expect(source.getTerrain(SHARD, "W1N1")).rejects.toThrow();
    net.setFail(false);
    expect(await source.getTerrain(SHARD, "W1N1")).toEqual(terrainOf("W1N1"));
    expect(net.terrain).toEqual(["W1N1", "W1N1"]);
  });

  it(`条目有上限（${TERRAIN_CACHE_MAX_ROOMS} 个房间），按最近使用淘汰`, async () => {
    const storage = memoryStorage();
    const source = open(network(), storage);
    await source.getTerrain(SHARD, "W0N0");
    for (let i = 1; i <= TERRAIN_CACHE_MAX_ROOMS; i++) {
      await source.getTerrain(SHARD, `W${i}N0`);
      if (i === TERRAIN_CACHE_MAX_ROOMS - 1) await source.getTerrain(SHARD, "W0N0"); // 用过一次，变成最近使用
    }
    const next = network();
    const reopened = open(next, storage);
    await reopened.getTerrain(SHARD, "W0N0");
    await reopened.getTerrain(SHARD, "W1N0");
    expect(next.terrain).toEqual(["W1N0"]);
  });

  it("存储里的内容损坏时当作没有缓存", async () => {
    const storage = memoryStorage();
    storage.setItem(TERRAIN_CACHE_STORAGE.key + SEASON.id, '{"season":1,"rooms":"x"}');
    const net = network();
    expect(await open(net, storage).getTerrain(SHARD, "W1N1")).toEqual(terrainOf("W1N1"));
    expect(net.terrain).toEqual(["W1N1"]);
  });

  it("存储键登记为不导出的运行状态", () => {
    expect(STORED_KEYS).toContain(TERRAIN_CACHE_STORAGE);
    expect(TERRAIN_CACHE_STORAGE).toMatchObject({ role: "runtime", prefix: true });
  });
});
