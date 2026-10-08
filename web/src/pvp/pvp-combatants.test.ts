import { describe, expect, it } from "vitest";
import type { RoomMapFixture } from "../source/fixture-format.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { PlayerProfile } from "../source/source.ts";
import { combatantsFrom, gclLevel } from "./pvp-combatants.ts";

const season = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);
const fixture = new FixtureSource(season);

/** 录制的 E13N21（PvP 列表里的房间）roomMap2 首帧：volotsyouga 2 个点、dump_table 1 个点 */
const e13n21 = (season.files.find((f) => f.meta.kind === "roomMap2" && f.meta.room === "E13N21") as RoomMapFixture).frames[0]!.data;

const VOLOTSYOUGA = "65b2ded6e582880012134da6";
const DUMP_TABLE = "685da7c42df7a30011653e6a";

async function profiles(ids: readonly string[]): Promise<Map<string, PlayerProfile>> {
  return new Map(await Promise.all(ids.map(async (id) => [id, await fixture.getPlayer(id)] as const)));
}

describe("GCL 等级（引擎公式 floor((点数 / 1e6) ^ (1 / 2.4)) + 1）", () => {
  it("按已知点数换算", () => {
    expect(gclLevel(0)).toBe(1);
    expect(gclLevel(999_999)).toBe(1);
    expect(gclLevel(1_000_000)).toBe(2);
    expect(gclLevel(50_784_664)).toBe(6);
    expect(gclLevel(115_491_280)).toBe(8);
  });
});

describe("参战玩家（roomMap2 一帧）", () => {
  it("每个玩家的名字、GCL 等级与物体数（位置点数），物体多的在前", async () => {
    const players = await profiles([VOLOTSYOUGA, DUMP_TABLE]);
    expect(combatantsFrom(e13n21, (id) => players.get(id), new Set())).toEqual([
      { id: VOLOTSYOUGA, username: "volotsyouga", gcl: 8, objects: 2, ally: false, badge: expect.objectContaining({ color1: "#080811" }) },
      { id: DUMP_TABLE, username: "dump_table", gcl: 6, objects: 1, ally: false, badge: expect.objectContaining({ color1: "#000000" }) },
    ]);
  });

  it("地形 / 道路类键与 NPC（Invader、Source Keeper）不算参战玩家；资料未到时只有 id 与物体数", () => {
    const frame = { ...e13n21, "2": [[10, 10], [11, 11]] as [number, number][], "3": [[5, 5]] as [number, number][] };
    expect(combatantsFrom(frame, () => undefined, new Set()).map((c) => c.id)).toEqual([VOLOTSYOUGA, DUMP_TABLE]);
    expect(combatantsFrom(frame, () => undefined, new Set())[1]).toEqual({ id: DUMP_TABLE, objects: 1, ally: false });
  });

  it("Ally List 里的玩家（不分大小写）标为盟友", async () => {
    const players = await profiles([VOLOTSYOUGA, DUMP_TABLE]);
    const list = combatantsFrom(e13n21, (id) => players.get(id), new Set(["Dump_Table"]));
    expect(list.map((c) => [c.username, c.ally])).toEqual([
      ["volotsyouga", false],
      ["dump_table", true],
    ]);
  });

  it("点数为 0 的玩家不算在场", () => {
    expect(combatantsFrom({ w: [], [DUMP_TABLE]: [] }, () => undefined, new Set())).toEqual([]);
  });
});
