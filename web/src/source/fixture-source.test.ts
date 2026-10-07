import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import type { RoomFixture } from "./fixture-format.ts";
import {
  SourceError,
  type ConnectionState,
  type ConsoleEvent,
  type RoomMapUpdate,
  type RoomObjectPatch,
  type RoomTick,
  type StreamError,
} from "./source.ts";

const files = Object.values(
  import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }),
);
const bundle = fixtureBundle(files);

const SHARD = "shardSeason";
const OWN_ROOM = "W13S28";
const USER_ID = "6253e4a3a3d173248b5a2691";

/** 全量对象一定带类型与坐标；增量只带变化的属性。 */
function isFullObject(obj: RoomObjectPatch | null): boolean {
  return obj !== null && typeof obj["type"] === "string" && typeof obj["x"] === "number";
}

function collectRoom(source: FixtureSource, shard: string, room: string): RoomTick[] {
  const ticks: RoomTick[] = [];
  source.subscribeRoom(shard, room, (tick) => ticks.push(tick));
  return ticks;
}

describe("FixtureSource 房间流", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("回放自己房间：首帧全量、后续增量、Tick 单调递增", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    const ticks = collectRoom(source, SHARD, OWN_ROOM);
    await vi.runAllTimersAsync();

    expect(ticks.length).toBeGreaterThanOrEqual(40);
    const [first, ...rest] = ticks;
    const firstObjects = Object.values(first!.objects);
    expect(firstObjects.length).toBeGreaterThan(20);
    expect(firstObjects.every(isFullObject)).toBe(true);
    expect(Object.keys(first!.users ?? {}).length).toBeGreaterThan(0);
    expect(ticks.some((tick) => (tick.visual ?? "") !== "")).toBe(true);

    const patches = rest.flatMap((tick) => Object.values(tick.objects));
    expect(patches.some((obj) => obj !== null && !isFullObject(obj))).toBe(true);

    const times = rest.map((tick) => tick.gameTime);
    expect(times.every((t) => typeof t === "number")).toBe(true);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
  });
});

describe("FixtureSource 回放时序", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // 录制里第 1、2 帧的间隔（测试输入，来自 fixture）
  const ownRoom = bundle.files.find(
    (f): f is RoomFixture => f.meta.kind === "room" && f.meta.room === OWN_ROOM,
  );
  const frames = ownRoom?.frames ?? [];
  const gap = frames[1]!.at - frames[0]!.at;

  it("speed 1 按录制的帧间隔投递", async () => {
    const source = new FixtureSource(bundle, { speed: 1 });
    const ticks = collectRoom(source, SHARD, OWN_ROOM);
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(gap - 1);
    expect(ticks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticks).toHaveLength(2);
  });

  it("speed 10 把间隔缩短到十分之一", async () => {
    const source = new FixtureSource(bundle, { speed: 10 });
    const ticks = collectRoom(source, SHARD, OWN_ROOM);
    await vi.advanceTimersByTimeAsync(Math.ceil(gap / 10));
    expect(ticks).toHaveLength(2);
  });

  it("退订后不再收到帧", async () => {
    const source = new FixtureSource(bundle, { speed: 1 });
    const ticks: RoomTick[] = [];
    const unsubscribe = source.subscribeRoom(SHARD, OWN_ROOM, (tick) => ticks.push(tick));
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.runAllTimersAsync();
    expect(ticks).toHaveLength(1);
  });

  it("任何时刻最多一条房间订阅：订阅另一个房间时旧订阅收到 replaced 并停止", async () => {
    const source = new FixtureSource(bundle, { speed: 1 });
    const oldTicks: RoomTick[] = [];
    const errors: StreamError[] = [];
    source.subscribeRoom(SHARD, OWN_ROOM, (tick) => oldTicks.push(tick), (e) => errors.push(e));
    await vi.advanceTimersByTimeAsync(0);
    const newTicks = collectRoom(source, SHARD, "E13N21");
    await vi.runAllTimersAsync();
    expect(oldTicks).toHaveLength(1);
    expect(errors.map((e) => e.kind)).toEqual(["replaced"]);
    expect(newTicks.length).toBeGreaterThan(10);
  });

  it("roomMap2 流按录制回放，带用户坐标", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    const updates: RoomMapUpdate[] = [];
    source.subscribeRoomMap(SHARD, OWN_ROOM, (update) => updates.push(update));
    await vi.runAllTimersAsync();
    expect(updates.length).toBeGreaterThan(10);
    expect(updates[0]![USER_ID]?.length).toBeGreaterThan(0);
  });

  it("close 停止所有流并报告断开", async () => {
    const source = new FixtureSource(bundle, { speed: 1 });
    const states: ConnectionState[] = [];
    source.onConnection((state) => states.push(state));
    const ticks = collectRoom(source, SHARD, OWN_ROOM);
    await vi.advanceTimersByTimeAsync(0);
    source.close();
    await vi.runAllTimersAsync();
    expect(ticks).toHaveLength(1);
    expect(states).toEqual(["authenticated", "disconnected"]);
  });
});

describe("FixtureSource 一次性数据", () => {
  const source = new FixtureSource(bundle);

  it("PvP 列表按 Shard 分组，interval 越小房间越少", async () => {
    const all = await source.getPvp(100);
    expect(all).toHaveLength(1);
    const season = all[0]!;
    expect(season.shard).toBe(SHARD);
    expect(season.time).toBe(1025187);
    expect(season.rooms).toHaveLength(16);
    expect(season.rooms[0]).toEqual({ room: "E13N21", lastPvpTime: 1025187 });

    // 只保留 lastPvpTime >= time - interval：1025187 - 5 = 1025182
    const recent = await source.getPvp(5);
    expect(recent[0]!.rooms.map((r) => r.room)).toEqual(["E13N21", "W17N21", "W7N15", "E26N3", "W5N29", "W15S8"]);
  });

  it("核弹列表带 Shard 与落地 Tick", async () => {
    expect(await source.getNukes()).toEqual([
      {
        id: "6ac4f8121c072b6c3382624a",
        shard: SHARD,
        room: "W17N21",
        x: 31,
        y: 29,
        landTime: 1048646,
        launchRoom: "W12N25",
      },
    ]);
  });

  it("服务器时间与 Shard 列表", async () => {
    expect(await source.getTime(SHARD)).toBe(1025187);
    const shards = await source.getShards();
    expect(shards.map((s) => s.name)).toEqual([SHARD]);
    expect(shards[0]!.tickMs).toBeCloseTo(3814.57, 1);
  });

  it("地形是 2500 个字符", async () => {
    const terrain = await source.getTerrain(SHARD, OWN_ROOM);
    expect(terrain.room).toBe(OWN_ROOM);
    expect(terrain.encoded).toMatch(/^[0-3]{2500}$/);
    expect(terrain.encoded.startsWith("11111111000")).toBe(true);
  });

  it("没录到的地形会拒绝", async () => {
    await expect(source.getTerrain(SHARD, "E0N0")).rejects.toThrow();
  });

  it("用户信息：id、用户名与各 Shard 的房间", async () => {
    expect(await source.getMe()).toEqual({
      id: USER_ID,
      username: "Xerxes_2",
      rooms: { [SHARD]: ["W13S28", "W12S28", "W15S28", "W17S29", "W17S25", "W12S26"] },
    });
  });

  it("按 id 查玩家名：取自录到的用户信息、map-stats 与房间流里的用户", async () => {
    expect(await source.getUsername(USER_ID)).toBe("Xerxes_2");
    expect(await source.getUsername("685da7c42df7a30011653e6a")).toBe("dump_table");
    await expect(source.getUsername("000000000000000000000000")).rejects.toThrow();
  });

  it("版本信息带历史 chunk 大小", async () => {
    expect(await source.getVersion()).toEqual({ package: 247, protocol: 14, historyChunkSize: 100 });
  });

  it("录到的 401 以 unauthorized 拒绝，和 LiveSource 一样", async () => {
    const unauthorized = new FixtureSource(
      fixtureBundle([
        ...files.filter((f) => (f as { meta: { kind: string } }).meta.kind !== "me"),
        {
          meta: { format: 1, kind: "me", recordedAt: "2026-10-08T00:00:00.000Z", server: bundle.server, origin: "test" },
          status: 401,
          body: null,
        },
      ]),
    );
    const error = await unauthorized.getMe().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ kind: "unauthorized", status: 401 });
  });

  it("瓦片 URL 来自 Server 配置", () => {
    expect(source.tileUrl(SHARD, OWN_ROOM)).toBe("/map-tiles/shardSeason/W13S28.png");
  });

  it("zoom2 块瓦片 URL 按块角房间命名", () => {
    expect(source.blockTileUrl(SHARD, "W16S28")).toBe("/map-tiles/shardSeason/zoom2/W16S28.png");
  });

  it("世界尺寸以房间计", async () => {
    expect(await source.getWorldSize(SHARD)).toEqual({ width: 102, height: 102 });
  });

  it("map-stats 只答所问的房间：所有者、等级、用户名", async () => {
    const stats = await source.getMapStats(SHARD, [OWN_ROOM, "W14S28", "W12S21", "E40N40"]);
    expect(stats.shard).toBe(SHARD);
    expect(stats.gameTime).toBeGreaterThan(1025000);
    expect(Object.keys(stats.rooms).sort()).toEqual(["W12S21", OWN_ROOM, "W14S28"]);
    expect(stats.rooms[OWN_ROOM]).toMatchObject({ status: "normal", owner: { user: USER_ID, level: 8 } });
    expect(stats.rooms["W14S28"]!.owner).toEqual({ user: USER_ID, level: 0 });
    const odiodin = stats.rooms["W12S21"]!.owner!.user;
    expect(stats.users[odiodin]!.username).toBe("Odiodin");
    expect(stats.users[USER_ID]!.username).toBe("Xerxes_2");
    // 只带与所问房间有关的用户
    expect(Object.values(stats.users).some((u) => u.username === "Kamots")).toBe(false);
  });
});

describe("FixtureSource Console", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // 录制脚本不录 Console（避免带出个人日志），这里用手写的最小 fixture。
  const consoleBundle = fixtureBundle([
    ...files,
    {
      meta: { format: 1, kind: "console", recordedAt: "2026-10-08T00:00:00.000Z", server: bundle.server, origin: "test" },
      frames: [
        { at: 0, data: { messages: { log: ["tick 1"], results: [] }, shard: SHARD } },
        { at: 3000, data: { messages: { log: [], results: ["42"] }, shard: SHARD } },
        { at: 6000, data: { error: "ReferenceError: foo is not defined", shard: SHARD } },
      ],
    },
  ]);

  it("按时序回放输出与错误", async () => {
    const source = new FixtureSource(consoleBundle);
    const events: ConsoleEvent[] = [];
    source.subscribeConsole((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(3000);
    expect(events).toEqual([
      { kind: "output", shard: SHARD, log: ["tick 1"], results: [] },
      { kind: "output", shard: SHARD, log: [], results: ["42"] },
    ]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(events[2]).toEqual({ kind: "error", shard: SHARD, error: "ReferenceError: foo is not defined" });
  });

  it("发送的命令被记下，不触网", async () => {
    const source = new FixtureSource(consoleBundle);
    await source.sendConsole(SHARD, "Game.time");
    expect(source.sentConsoleCommands).toEqual([{ shard: SHARD, expression: "Game.time" }]);
  });

  it("关闭后发送命令会拒绝", async () => {
    const source = new FixtureSource(consoleBundle);
    source.close();
    await expect(source.sendConsole(SHARD, "Game.time")).rejects.toThrow();
  });
});

/** 录制里该房间历史 chunk 的 base（测试输入，来自 fixture 元数据）。 */
function recordedHistoryBase(room: string): number {
  const file = bundle.files.find((f) => f.meta.kind === "history" && f.meta.room === room);
  if (!file || file.meta.kind !== "history") throw new Error(`没有 ${room} 的历史 fixture`);
  return file.meta.base;
}

describe("FixtureSource 历史 chunk", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("首 Tick 全量、后续 diff，形状与房间流一致", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    const base = recordedHistoryBase(OWN_ROOM);
    const chunk = await source.getHistoryChunk(SHARD, OWN_ROOM, base);
    if (!chunk) throw new Error("应当有历史 chunk");

    expect(chunk.base).toBe(base);
    expect(chunk.ticks.map((t) => t.gameTime)).toEqual(Array.from({ length: 100 }, (_, i) => base + i));

    const [first, ...rest] = chunk.ticks;
    const firstObjects = Object.values(first!.objects);
    expect(firstObjects.length).toBeGreaterThan(20);
    expect(firstObjects.every(isFullObject)).toBe(true);
    const patches = rest.flatMap((tick) => Object.values(tick.objects));
    expect(patches.some((obj) => obj !== null && !isFullObject(obj))).toBe(true);

    // 同一个对象在房间流首帧的属性，历史首 Tick 里都有（历史可多带 `_upgraded` 这类内部字段）
    const live = collectRoom(source, SHARD, OWN_ROOM);
    await vi.runAllTimersAsync();
    const liveObjects = live[0]!.objects;
    const shared = Object.keys(liveObjects).filter((id) => id in first!.objects);
    expect(shared.length).toBeGreaterThan(20);
    for (const id of shared) {
      const historyKeys = Object.keys(first!.objects[id] ?? {});
      expect(historyKeys).toEqual(expect.arrayContaining(Object.keys(liveObjects[id] ?? {})));
    }
  });

  it("没有录到的 chunk 视为历史不存在", async () => {
    const source = new FixtureSource(bundle);
    expect(await source.getHistoryChunk(SHARD, OWN_ROOM, 100)).toBeNull();
  });
});
