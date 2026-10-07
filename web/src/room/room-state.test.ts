import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { HistoryTick, RoomTick } from "../source/source.ts";
import { applyRoomTick, reduceLiveTick, roomStateAt, roomStateFrom, type RoomState } from "./room-state.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const full: RoomTick = {
  objects: {
    a: {
      _id: "a",
      type: "creep",
      x: 10,
      y: 10,
      hits: 100,
      store: { energy: 50 },
      body: [
        { type: "work", hits: 100 },
        { type: "move", hits: 100 },
      ],
    },
    b: { _id: "b", type: "road", x: 5, y: 5, hits: 5000 },
  },
  users: { u1: { _id: "u1", username: "alice" } },
};

describe("RoomState 归并", () => {
  it("首帧全量建立对象表、用户表；没有 gameTime 时 Tick 未知", () => {
    const state = roomStateFrom(full);
    expect(state.gameTime).toBeUndefined();
    expect(state.objects["a"]).toEqual(full.objects["a"]);
    expect(Object.keys(state.objects)).toEqual(["a", "b"]);
    expect(state.users["u1"]?.username).toBe("alice");
    expect(state.visual).toBe("");
  });

  it("增量只改变化的属性，嵌套对象逐层合并，数组按下标打补丁", () => {
    const state = applyRoomTick(roomStateFrom(full), {
      gameTime: 101,
      objects: { a: { x: 11, store: { power: 3 }, body: { "1": { hits: 40 } } } },
      visual: '{"t":"c","x":1,"y":1}',
    });
    expect(state.gameTime).toBe(101);
    expect(state.objects["a"]).toEqual({
      _id: "a",
      type: "creep",
      x: 11,
      y: 10,
      hits: 100,
      store: { energy: 50, power: 3 },
      body: [
        { type: "work", hits: 100 },
        { type: "move", hits: 40 },
      ],
    });
    expect(Array.isArray(state.objects["a"]?.["body"])).toBe(true);
    expect(state.visual).toBe('{"t":"c","x":1,"y":1}');
  });

  it("属性值为 null 表示删除该属性", () => {
    const state = applyRoomTick(roomStateFrom(full), {
      gameTime: 2,
      objects: { a: { store: { energy: null }, hits: null } },
    });
    expect(state.objects["a"]).not.toHaveProperty("hits");
    expect(state.objects["a"]?.["store"]).toEqual({});
  });

  it("对象为 null 表示消失；没见过的 id 视为新对象", () => {
    const state = applyRoomTick(roomStateFrom(full), {
      gameTime: 2,
      objects: { b: null, c: { _id: "c", type: "tower", x: 1, y: 2 } },
    });
    expect(Object.keys(state.objects).sort()).toEqual(["a", "c"]);
    expect(state.objects["c"]?.["type"]).toBe("tower");
  });

  it("用户表按用户合并，新用户加入，旧用户保留", () => {
    const state = applyRoomTick(roomStateFrom(full), {
      gameTime: 2,
      objects: {},
      users: { u2: { _id: "u2", username: "bob" } },
    });
    expect(Object.keys(state.users).sort()).toEqual(["u1", "u2"]);
  });

  it("visual 只属于本 Tick：增量没带 visual 时清空", () => {
    const withVisual = applyRoomTick(roomStateFrom(full), { gameTime: 2, objects: {}, visual: "x" });
    expect(applyRoomTick(withVisual, { gameTime: 3, objects: {} }).visual).toBe("");
  });

  it("不修改输入：旧状态与增量保持原样，未变化的对象沿用同一引用", () => {
    const before = roomStateFrom(full);
    const snapshot = structuredClone(before);
    const patch: RoomTick = { gameTime: 2, objects: { a: { store: { energy: null } } } };
    const patchSnapshot = structuredClone(patch);
    const after = applyRoomTick(before, patch);
    expect(before).toEqual(snapshot);
    expect(patch).toEqual(patchSnapshot);
    expect(after.objects["b"]).toBe(before.objects["b"]);
    expect(after.objects["a"]).not.toBe(before.objects["a"]);
  });
});

describe("Live 流归并", () => {
  it("没有 gameTime 的帧是全量：重新订阅后的首帧替换旧状态而不是合并", () => {
    let state: RoomState = reduceLiveTick(undefined, full);
    state = reduceLiveTick(state, { gameTime: 5, objects: { b: null } });
    expect(Object.keys(state.objects)).toEqual(["a"]);
    state = reduceLiveTick(state, { objects: { z: { _id: "z", type: "source", x: 1, y: 1 } } });
    expect(Object.keys(state.objects)).toEqual(["z"]);
    expect(state.gameTime).toBe(5);
  });

  describe("用 FixtureSource 驱动", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("自己房间 51 帧归并后 Tick 逐帧前进，对象表与首帧规模相当", async () => {
      const source = new FixtureSource(bundle, { speed: Infinity });
      const states: RoomState[] = [];
      let state: RoomState | undefined;
      source.subscribeRoom("shardSeason", "W13S28", (tick) => {
        state = reduceLiveTick(state, tick);
        states.push(state);
      });
      await vi.runAllTimersAsync();
      expect(states.length).toBe(51);
      const last = states.at(-1)!;
      expect(last.gameTime).toBeGreaterThan(states[1]!.gameTime!);
      expect(Object.keys(last.objects).length).toBeGreaterThan(200);
      expect(Object.values(last.objects).every((o) => typeof o["type"] === "string")).toBe(true);
    });
  });
});

describe("Replay 复用：历史 chunk", () => {
  it("从 chunk 首 Tick 全量重放 diff 到目标 Tick，与逐 Tick 归并一致", async () => {
    const source = new FixtureSource(bundle);
    const chunk = await source.getHistoryChunk("shardSeason", "W13S28", 1024900);
    expect(chunk).not.toBeNull();
    const ticks: readonly HistoryTick[] = chunk!.ticks;
    const target = ticks[30]!.gameTime;

    const replayed = roomStateAt(ticks, target);
    let folded = roomStateFrom(ticks[0]!);
    for (const tick of ticks.slice(1, 31)) folded = applyRoomTick(folded, tick);

    expect(replayed.gameTime).toBe(target);
    expect(replayed).toEqual(folded);
    expect(Object.keys(replayed.objects).length).toBeGreaterThan(200);
  });

  it("目标 Tick 早于 chunk 首 Tick 时报错", () => {
    expect(() => roomStateAt([{ gameTime: 100, objects: {} }], 99)).toThrow();
  });
});
