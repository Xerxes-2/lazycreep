import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { RoomMapUpdate, Source } from "../source/source.ts";
import { createCombatantFeed } from "./combatant-feed.ts";
import { roomMapHubFor } from "../source/room-map-hub.ts";
import { createPvpFeed } from "./pvp-feed.ts";

const season = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 录制的赛季服 PvP 列表（当前 Tick 1025187），按最近在前 */
const WINDOW_20 = ["E13N21", "W17N21", "W7N15", "E26N3", "W5N29", "W15S8"];

/** 记下当前订阅着的 roomMap2（`shard/room` → 订阅数） */
function tracked(source: FixtureSource) {
  const open = new Map<string, number>();
  const inner = source.subscribeRoomMap.bind(source);
  source.subscribeRoomMap = (shard, room, listener, onError, options) => {
    const key = `${shard}/${room}`;
    open.set(key, (open.get(key) ?? 0) + 1);
    const off = inner(shard, room, listener, onError, options);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      off();
      const left = open.get(key)! - 1;
      if (left === 0) open.delete(key);
      else open.set(key, left);
    };
  };
  const rooms = () => [...open.keys()].map((k) => k.split("/")[1]).sort();
  return { open, rooms };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

function setup(
  options: { token?: boolean; shown?: boolean; maxRooms?: number; budget?: number; allies?: string[]; frames?: Record<string, readonly RoomMapUpdate[]> } = {},
) {
  const source = new FixtureSource(season, { speed: Infinity });
  // 指定房间改按顺序推给定的帧（录制里没有 NPC 的帧），每帧隔一个宏任务
  const recorded = source.subscribeRoomMap.bind(source);
  source.subscribeRoomMap = (shard, room, listener, onError, opts) => {
    const frames = options.frames?.[room];
    if (!frames) return recorded(shard, room, listener, onError, opts);
    let live = true;
    frames.forEach((frame, i) => setTimeout(() => live && listener(frame), 20 * (i + 1)));
    return () => void (live = false);
  };
  const subs = tracked(source);
  const getPlayer = vi.spyOn(source, "getPlayer");
  const [shown, setShown] = createSignal(options.shown ?? true);
  const [token, setToken] = createSignal(options.token ?? true);
  return createRoot((d) => {
    dispose = d;
    const pvp = createPvpFeed({ source: () => source as Source });
    const feed = createCombatantFeed({
      source: () => source as Source,
      roomMaps: roomMapHubFor(() => source as Source, options.budget ? { budget: options.budget } : {}),
      groups: pvp.groups,
      active: shown,
      canSubscribe: token,
      allies: () => new Set(options.allies ?? []),
      ...(options.maxRooms ? { maxRooms: options.maxRooms } : {}),
    });
    return { pvp, feed, subs, getPlayer, setShown, setToken };
  });
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

describe("参战者订阅", () => {
  it("为时间窗内每个 PvP 房间订阅一个 roomMap2；缩小时间窗即退订离开的房间", async () => {
    const { pvp, subs } = setup();
    await settle(() => expect(subs.rooms()).toHaveLength(16));
    pvp.setWindow(20);
    expect(subs.rooms()).toEqual([...WINDOW_20].sort());
    expect([...subs.open.values()].every((n) => n === 1)).toBe(true);
  });

  it("超过上限时只订阅最近的房间，其余标为未订阅", async () => {
    const { feed, subs } = setup({ maxRooms: 4 });
    await settle(() => expect(subs.rooms()).toEqual(["E13N21", "W17N21", "W7N15", "E26N3"].sort()));
    expect(feed.of("shardSeason", "W5N29")).toEqual({ kind: "unwatched" });
  });

  it("订阅中心的总预算不够时，被截断的房间同样标为未订阅（超出订阅上限）", async () => {
    const { feed, subs } = setup({ budget: 3 });
    await settle(() => expect(subs.rooms()).toEqual(["E13N21", "E26N3", "W7N15"]));
    expect(feed.of("shardSeason", "W17N21")).toEqual({ kind: "unwatched" });
    expect(feed.of("shardSeason", "E13N21").kind).not.toBe("unwatched");
  });

  it("区块折叠 / 不可见时全部退订，重新显示时再订阅", async () => {
    const { subs, setShown } = setup();
    await settle(() => expect(subs.rooms()).toHaveLength(16));
    setShown(false);
    expect(subs.rooms()).toEqual([]);
    setShown(true);
    expect(subs.rooms()).toHaveLength(16);
  });

  it("无 token 时不订阅，参战者为“需要 token”；有了 token 才订阅", async () => {
    const { pvp, feed, subs, setToken } = setup({ token: false });
    await settle(() => expect(pvp.groups()).toBeDefined());
    expect(subs.rooms()).toEqual([]);
    expect(feed.of("shardSeason", "E13N21")).toEqual({ kind: "needsToken" });
    setToken(true);
    expect(subs.rooms()).toHaveLength(16);
  });

  it("收到帧后给出参战玩家（名字、GCL、物体数、盟友），每个玩家只查一次资料", async () => {
    const { feed, getPlayer } = setup({ allies: ["DUMP_TABLE"] });
    await settle(() => {
      const state = feed.of("shardSeason", "E13N21");
      expect(state.kind).toBe("ready");
      if (state.kind !== "ready") return;
      expect(state.players.find((p) => p.username === "volotsyouga")).toMatchObject({ gcl: 8 });
      expect(state.players.find((p) => p.username === "dump_table")).toMatchObject({ gcl: 6, ally: true });
    });
    // 录制 51 帧都放完后也只查过这两个玩家各一次
    await new Promise((r) => setTimeout(r, 50));
    const ids = getPlayer.mock.calls.map(([id]) => id);
    expect(ids.sort()).toEqual(["65b2ded6e582880012134da6", "685da7c42df7a30011653e6a"]);
  });

  it("看到过“有 NPC（2 Invader、3 Source Keeper）、玩家至多一个”的房间记为 PvE，并记下见过的 NPC", async () => {
    const { feed } = setup({
      frames: {
        W5N29: [{ "2": [[10, 10]], u1: [[11, 11]], w: [[0, 0]] }],
        W7N15: [{ "3": [[5, 5]], u1: [[6, 6]], u2: [[7, 7]] }],
        W15S8: [{ u1: [[6, 6]] }],
      },
    });
    await settle(() => expect(feed.pve("shardSeason", "W5N29")).toEqual(["invader"]));
    await settle(() => expect(feed.of("shardSeason", "W7N15").kind).toBe("ready"));
    // 两个玩家：即使有 Keeper 也算 PvP；一个玩家、没有 NPC：对手可能已死光，也算 PvP
    expect(feed.pve("shardSeason", "W7N15")).toBeUndefined();
    await settle(() => expect(feed.of("shardSeason", "W15S8").kind).toBe("ready"));
    expect(feed.pve("shardSeason", "W15S8")).toBeUndefined();
    // 还不知道的房间不算
    expect(feed.pve("shardSeason", "E26N3")).toBeUndefined();
  });

  it("NPC 被打死后仍记为 PvE；看到两个以上玩家才取消；退订再订阅记号还在", async () => {
    const { feed, setShown } = setup({
      frames: {
        W5N29: [{ "2": [[10, 10]], u1: [[11, 11]] }, { u1: [[11, 11]] }],
        W7N15: [{ "2": [[1, 1]] }, { u1: [[6, 6]], u2: [[7, 7]] }],
      },
    });
    await settle(() => expect(feed.of("shardSeason", "W5N29")).toMatchObject({ kind: "ready", npcs: [] }));
    expect(feed.pve("shardSeason", "W5N29")).toEqual(["invader"]);
    await settle(() => expect(feed.of("shardSeason", "W7N15")).toMatchObject({ kind: "ready", npcs: [] }));
    expect(feed.pve("shardSeason", "W7N15")).toBeUndefined();

    setShown(false);
    expect(feed.of("shardSeason", "W5N29").kind).toBe("unwatched");
    expect(feed.pve("shardSeason", "W5N29")).toEqual(["invader"]);
  });

  it("还没收到帧的房间是等待中", async () => {
    const { pvp, feed } = setup();
    await settle(() => expect(pvp.groups()).toBeDefined());
    expect(feed.of("shardSeason", "W5N29")).toEqual({ kind: "waiting" });
  });
});
