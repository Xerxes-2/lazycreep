import { describe, expect, it } from "vitest";
import type { Source } from "../source/source.ts";
import { neighborRooms, preloadNeighbors } from "./neighbor-preload.ts";

/** 赛季服的世界：102×102 个房间，W50N50 在左上角 */
const SIZE = { width: 102, height: 102 };

describe("邻居房间", () => {
  it("上、左、右、下四个相邻房间", () => {
    expect(neighborRooms("W13S28", SIZE)).toEqual(["W13S27", "W14S28", "W12S28", "W13S29"]);
  });

  it("跨越 0 线", () => {
    expect(neighborRooms("E0S0", SIZE)).toEqual(["E0N0", "W0S0", "E1S0", "E0S1"]);
  });

  it("世界边缘外的不算", () => {
    expect(neighborRooms("W50N50", SIZE)).toEqual(["W49N50", "W50N49"]);
  });

  it("不是常规房间名时为空", () => {
    expect(neighborRooms("sim", SIZE)).toEqual([]);
  });
});

describe("预加载", () => {
  it("取不到世界尺寸（包括 Source 没有这个方法）时静默，不拒绝", async () => {
    const throwing = { getWorldSize: () => { throw new TypeError("no"); } } as unknown as Source;
    const rejecting = { getWorldSize: () => Promise.reject(new Error("down")) } as unknown as Source;
    await expect(preloadNeighbors(throwing, "shardSeason", "W13S28", () => true)).resolves.toBeUndefined();
    await expect(preloadNeighbors(rejecting, "shardSeason", "W13S28", () => true)).resolves.toBeUndefined();
  });

  it("alive 变 false 后不再请求后面的邻居", async () => {
    const requested: string[] = [];
    let alive = true;
    const source = {
      getWorldSize: async () => SIZE,
      getTerrain: async (_shard: string, room: string) => {
        requested.push(room);
        alive = false;
        return { shard: "shardSeason", room, encoded: "" };
      },
    } as unknown as Source;
    await preloadNeighbors(source, "shardSeason", "W13S28", () => alive);
    expect(requested).toEqual(["W13S27"]);
  });

  it("同时取邻居的装饰（#61）；装饰失败、Source 没有这个方法都静默", async () => {
    const requested: string[] = [];
    const source = {
      getWorldSize: async () => SIZE,
      getTerrain: async (_shard: string, room: string) => {
        requested.push(`terrain ${room}`);
        return { shard: "shardSeason", room, encoded: "" };
      },
      getRoomDecorations: async (_shard: string, room: string) => {
        requested.push(`decorations ${room}`);
        if (room === "W14S28") throw new Error("down");
        return { objects: [] };
      },
    } as unknown as Source;
    await preloadNeighbors(source, "shardSeason", "W13S28", () => true);
    expect(requested.filter((r) => r.startsWith("decorations"))).toEqual([
      "decorations W13S27",
      "decorations W14S28",
      "decorations W12S28",
      "decorations W13S29",
    ]);
    const old = { getWorldSize: async () => SIZE, getTerrain: async () => ({}) } as unknown as Source;
    await expect(preloadNeighbors(old, "shardSeason", "W13S28", () => true)).resolves.toBeUndefined();
  });

  it("同时取邻居的房间快照（#63）；快照失败、Source 没有这个方法都静默；不要快照时不取", async () => {
    const requested: string[] = [];
    const source = {
      getWorldSize: async () => SIZE,
      getTerrain: async (_shard: string, room: string) => ({ shard: "shardSeason", room, encoded: "" }),
      getRoomSnapshot: async (_shard: string, room: string) => {
        requested.push(room);
        if (room === "W14S28") throw new Error("down");
        return { objects: {}, users: {} };
      },
    } as unknown as Source;
    await expect(preloadNeighbors(source, "shardSeason", "W13S28", () => true)).resolves.toBeUndefined();
    expect(requested).toEqual(["W13S27", "W14S28", "W12S28", "W13S29"]);

    requested.length = 0;
    await preloadNeighbors(source, "shardSeason", "W13S28", () => true, { snapshots: false });
    expect(requested).toEqual([]);
  });
});
