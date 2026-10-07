import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { MapStats } from "../source/source.ts";
import { PVP_FETCH_INTERVAL, aggregatePvp, battleReplayTick, type PvpFeedData } from "./pvp-overview.ts";

const season = new FixtureSource(
  fixtureBundle(Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }))),
);
const mmo = new FixtureSource(
  fixtureBundle(Object.values(import.meta.glob<unknown>("../../../fixtures/mmo/*.json", { eager: true, import: "default" }))),
);

async function feed(source: FixtureSource): Promise<PvpFeedData> {
  const [pvp, nukes] = await Promise.all([source.getPvp(PVP_FETCH_INTERVAL), source.getNukes()]);
  return { pvp, nukes };
}

describe("aggregatePvp", () => {
  it("MMO：按 Shard 分组，Shard 名按自然顺序", async () => {
    const groups = aggregatePvp(await feed(mmo), 500);
    expect(groups.map((g) => g.shard)).toEqual(["shard0", "shard1", "shard2", "shard3", "shardX"]);
    expect(groups.find((g) => g.shard === "shard1")!.time).toBe(74188622);
  });

  it("组内按最后战斗 Tick 降序：shard3 的接口返回是升序也照样排好", async () => {
    const shard3 = aggregatePvp(await feed(mmo), 500).find((g) => g.shard === "shard3")!;
    expect(shard3.rooms.map((r) => r.room)).toEqual(["W17S41", "W21S12", "E52N33", "W1S38", "E39S47", "W29S16"]);
    expect(shard3.rooms.map((r) => r.ago)).toEqual([9, 18, 97, 99, 464, 465]);
  });

  it("时间窗：只留距该 Shard 当前 Tick 不超过窗口的房间", async () => {
    const data = await feed(mmo);
    const rooms = (window: 20 | 100 | 500) =>
      aggregatePvp(data, window).find((g) => g.shard === "shard3")!.rooms.map((r) => r.room);
    expect(rooms(20)).toEqual(["W17S41", "W21S12"]);
    expect(rooms(100)).toEqual(["W17S41", "W21S12", "E52N33", "W1S38"]);
    expect(rooms(500)).toHaveLength(6);
  });

  it("窗口内没有战斗的 Shard 仍然列出（空组），便于看出它被查过", async () => {
    const groups = aggregatePvp(await feed(mmo), 20);
    const shard0 = groups.find((g) => g.shard === "shard0")!;
    expect(shard0.rooms.map((r) => r.room)).toEqual(["E12N13", "E12S12"]);
    const empty = aggregatePvp({ pvp: [{ shard: "shard9", time: 100, rooms: [{ room: "W1N1", lastPvpTime: 10 }] }], nukes: [] }, 20);
    expect(empty).toEqual([{ shard: "shard9", time: 100, rooms: [], nukes: [] }]);
  });

  it("赛季服：只有一个 Shard", async () => {
    const groups = aggregatePvp(await feed(season), 100);
    expect(groups.map((g) => g.shard)).toEqual(["shardSeason"]);
    expect(groups[0]!.rooms[0]).toMatchObject({ room: "E13N21", lastPvpTime: 1025187, ago: 0 });
    expect(groups[0]!.rooms).toHaveLength(16);
  });

  describe("所有者合并", () => {
    it("缓存里有的房间显示所有者与用户名；缓存里无主的为 none；没查过的为 unknown", async () => {
      const stats = await season.getMapStats("shardSeason", ["W17S22", "W20S28", "W15S8"]);
      const groups = aggregatePvp(await feed(season), 500, (shard) => (shard === "shardSeason" ? stats : undefined));
      const owner = (room: string) => groups[0]!.rooms.find((r) => r.room === room)!.owner;
      // fixture 里的实际值：见 fixtures/season/mapStats.shardSeason.json
      expect(owner("W20S28")).toEqual({ kind: "none" });
      expect(owner("W15S8")).toEqual({ kind: "unknown" });
      expect(owner("E13N21")).toEqual({ kind: "unknown" });
      expect(owner("W17S22")).toEqual({
        kind: "owned",
        userId: "6a6d8e05d28b9e0013ab3ad3",
        username: "Odiodin",
        level: 6,
      });
    });

    it("level 0 为预定；用户名取自 users，缺失时只给 id", () => {
      const stats: Pick<MapStats, "rooms" | "users"> = {
        rooms: {
          W1N1: { status: "normal", owner: { user: "u1", level: 0 } },
          W2N2: { status: "normal", owner: { user: "u2", level: 6 } },
        },
        users: { u1: { _id: "u1", username: "alice" } },
      };
      const groups = aggregatePvp(
        {
          pvp: [{ shard: "s", time: 10, rooms: [{ room: "W1N1", lastPvpTime: 9 }, { room: "W2N2", lastPvpTime: 8 }] }],
          nukes: [],
        },
        20,
        () => stats,
      );
      expect(groups[0]!.rooms.map((r) => r.owner)).toEqual([
        { kind: "reserved", userId: "u1", username: "alice", level: 0 },
        { kind: "owned", userId: "u2", level: 6 },
      ]);
    });
  });

  describe("核弹列表", () => {
    it("按 Shard 归组，按落地 Tick 升序，带剩余 Tick", async () => {
      const groups = aggregatePvp(await feed(mmo), 20);
      const shard3 = groups.find((g) => g.shard === "shard3")!;
      expect(shard3.nukes.map((n) => [n.room, n.launchRoom, n.landTime, n.landsIn])).toEqual([
        ["W47N19", "W42N18", 83498856, 83498856 - 83494341],
        ["W47N19", "W44N19", 83508856, 83508856 - 83494341],
        ["W47N19", "W43N14", 83518856, 83518856 - 83494341],
      ]);
      expect(groups.find((g) => g.shard === "shard1")!.nukes).toEqual([]);
    });

    it("核弹不受时间窗影响；已落地的不列", () => {
      const groups = aggregatePvp(
        {
          pvp: [{ shard: "s", time: 1000, rooms: [] }],
          nukes: [
            { id: "a", shard: "s", room: "W1N1", x: 1, y: 2, landTime: 999, launchRoom: "W2N2" },
            { id: "b", shard: "s", room: "W1N1", x: 1, y: 2, landTime: 60_000, launchRoom: "W2N2" },
          ],
        },
        20,
      );
      expect(groups[0]!.nukes.map((n) => n.id)).toEqual(["b"]);
    });

    it("只有核弹、PvP 列表里没有的 Shard 也列出，剩余 Tick 未知", () => {
      const groups = aggregatePvp(
        { pvp: [], nukes: [{ id: "a", shard: "s", room: "W1N1", x: 1, y: 2, landTime: 5, launchRoom: "W2N2" }] },
        20,
      );
      expect(groups).toEqual([
        {
          shard: "s",
          time: undefined,
          rooms: [],
          nukes: [{ id: "a", shard: "s", room: "W1N1", x: 1, y: 2, landTime: 5, launchRoom: "W2N2", landsIn: undefined }],
        },
      ]);
    });

    it("赛季服的核弹", async () => {
      const groups = aggregatePvp(await feed(season), 20);
      expect(groups[0]!.nukes).toMatchObject([{ room: "W17N21", launchRoom: "W12N25", landsIn: 1048646 - 1025187 }]);
    });
  });
});

describe("battleReplayTick", () => {
  it("从最后战斗 Tick 往前一小段开始", () => {
    expect(battleReplayTick(1025187)).toBe(1025137);
    expect(battleReplayTick(10)).toBe(0);
  });
});
