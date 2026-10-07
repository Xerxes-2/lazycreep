import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRoomTick, roomStateAt, roomStateFrom, type RoomState } from "../room/room-state.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { HistoryChunk, HistoryTick } from "../source/source.ts";
import { chunkBase, createReplay, type HistoryFetcher, type ReplayEngine, type ReplaySnapshot } from "./replay-engine.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const SHARD = "shardSeason";
const ROOM = "W13S28";
const BASE = 1024900;

/** 录制的 100 Tick chunk。 */
async function recordedChunk(): Promise<HistoryChunk> {
  const chunk = await new FixtureSource(bundle).getHistoryChunk(SHARD, ROOM, BASE);
  if (!chunk) throw new Error("fixture 里没有历史 chunk");
  return chunk;
}

/** 逐 Tick 归并整段序列，作为重放结果的参照。 */
function foldTo(ticks: readonly HistoryTick[], target: number): RoomState {
  let state = roomStateFrom(ticks[0]!);
  for (const tick of ticks.slice(1)) if (tick.gameTime <= target) state = applyRoomTick(state, tick);
  return state;
}

/**
 * 把录制的 100 Tick chunk 切成两个 50 Tick 的 chunk（第二个的首 Tick 换成全量），
 * 用来测跨 chunk：对应 chunk 大小 50 的服务器。
 */
async function splitFetcher(): Promise<{ fetch: HistoryFetcher; calls: number[]; ticks: readonly HistoryTick[] }> {
  const chunk = await recordedChunk();
  const ticks = chunk.ticks;
  const secondBase = BASE + 50;
  const fullAtSecond = roomStateAt(ticks, secondBase);
  const chunks = new Map<number, HistoryChunk>([
    [BASE, { ...chunk, ticks: ticks.filter((t) => t.gameTime < secondBase) }],
    [
      secondBase,
      {
        ...chunk,
        base: secondBase,
        ticks: [
          { gameTime: secondBase, objects: fullAtSecond.objects },
          ...ticks.filter((t) => t.gameTime > secondBase),
        ],
      },
    ],
  ]);
  const calls: number[] = [];
  const fetch: HistoryFetcher = async (shard, room, base) => {
    calls.push(base);
    if (shard !== SHARD || room !== ROOM) return null;
    return chunks.get(base) ?? null;
  };
  return { fetch, calls, ticks };
}

let engine: ReplayEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

/** 等引擎安定在某个状态。 */
function settle(e: ReplayEngine, done: (s: ReplaySnapshot) => boolean): Promise<ReplaySnapshot> {
  return vi.waitFor(
    () => {
      const s = e.snapshot();
      if (!done(s)) throw new Error(`还没到：${s.status} ${s.target}`);
      return s;
    },
    { timeout: 2000, interval: 1 },
  );
}

const ready = (tick: number) => (s: ReplaySnapshot) => s.status === "ready" && s.target === tick;

describe("chunk 对齐", () => {
  it("任意 Tick 落到 floor(tick / size) * size", () => {
    expect(chunkBase(1024900, 100)).toBe(1024900);
    expect(chunkBase(1024999, 100)).toBe(1024900);
    expect(chunkBase(1025000, 100)).toBe(1025000);
    expect(chunkBase(1024977, 50)).toBe(1024950);
    expect(chunkBase(7, 100)).toBe(0);
  });
});

describe("Replay 引擎（FixtureSource 驱动）", () => {
  it("chunk 大小取自 Source 的版本接口；目标 Tick 的状态与逐 Tick 归并一致", async () => {
    const source = new FixtureSource(bundle);
    const requested: number[] = [];
    engine = createReplay({
      shard: SHARD,
      room: ROOM,
      start: 1024937,
      chunkSize: source.getVersion().then((v) => v.historyChunkSize),
      fetchChunk: (shard, room, base) => {
        requested.push(base);
        return source.getHistoryChunk(shard, room, base);
      },
    });
    const s = await settle(engine, ready(1024937));
    expect(requested[0]).toBe(BASE);
    expect(s.chunkSize).toBe(100);
    const chunk = await recordedChunk();
    expect(s.roomState).toEqual(foldTo(chunk.ticks, 1024937));
    expect(s.roomState?.gameTime).toBe(1024937);
  });

  it("跨 chunk 前进与后退都与逐 Tick 归并一致", async () => {
    const { fetch, ticks } = await splitFetcher();
    engine = createReplay({ shard: SHARD, room: ROOM, start: 1024940, chunkSize: 50, fetchChunk: fetch });
    await settle(engine, ready(1024940));

    for (let i = 0; i < 20; i++) engine.step(1);
    let s = await settle(engine, ready(1024960));
    expect(s.roomState?.objects).toEqual(foldTo(ticks, 1024960).objects);

    engine.seek(1024990);
    s = await settle(engine, ready(1024990));
    expect(s.roomState?.objects).toEqual(foldTo(ticks, 1024990).objects);

    engine.step(-45);
    s = await settle(engine, ready(1024945));
    expect(s.roomState?.objects).toEqual(foldTo(ticks, 1024945).objects);

    engine.step(-1);
    s = await settle(engine, ready(1024944));
    expect(s.roomState?.objects).toEqual(foldTo(ticks, 1024944).objects);
  });

  it("预取相邻 chunk", async () => {
    const { fetch, calls } = await splitFetcher();
    engine = createReplay({ shard: SHARD, room: ROOM, start: 1024960, chunkSize: 50, fetchChunk: fetch });
    await settle(engine, ready(1024960));
    await vi.waitFor(() => expect(new Set(calls)).toEqual(new Set([1024950, 1024900, 1025000])));
    // 再回到前一个 chunk 不重复下载
    engine.seek(1024910);
    await settle(engine, ready(1024910));
    expect(calls.filter((b) => b === 1024900)).toHaveLength(1);
  });

  it("拖动时目标立即跟手，只有最后一个目标的结果生效", async () => {
    const { fetch } = await splitFetcher();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: HistoryFetcher = async (...args) => {
      await gate;
      return fetch(...args);
    };
    engine = createReplay({ shard: SHARD, room: ROOM, start: 1024910, chunkSize: 50, fetchChunk: slow });
    engine.seek(1024920);
    expect(engine.snapshot().target).toBe(1024920);
    engine.seek(1024970);
    expect(engine.snapshot()).toMatchObject({ target: 1024970, status: "loading" });
    release();
    const s = await settle(engine, (x) => x.status === "ready");
    expect(s.target).toBe(1024970);
    expect(s.roomState?.gameTime).toBe(1024970);
  });

  it("历史不存在时进入 missing，而不是一直加载", async () => {
    const { fetch } = await splitFetcher();
    engine = createReplay({ shard: SHARD, room: ROOM, start: 1030000, chunkSize: 50, fetchChunk: fetch });
    const s = await settle(engine, (x) => x.status !== "loading");
    expect(s.status).toBe("missing");
  });

  it("请求失败时进入 error，可以重试", async () => {
    const { fetch } = await splitFetcher();
    let fail = true;
    const flaky: HistoryFetcher = async (...args) => {
      if (fail) throw new Error("网络断了");
      return fetch(...args);
    };
    engine = createReplay({ shard: SHARD, room: ROOM, start: 1024910, chunkSize: 50, fetchChunk: flaky });
    const s = await settle(engine, (x) => x.status !== "loading");
    expect(s).toMatchObject({ status: "error", error: "网络断了" });
    fail = false;
    engine.seek(1024910);
    await settle(engine, ready(1024910));
  });

  it("从 Live 进入：当前 Tick 的 chunk 还没生成时退到最近一个已有的 chunk 末尾", async () => {
    const { fetch } = await splitFetcher();
    engine = createReplay({
      shard: SHARD,
      room: ROOM,
      start: 1025030,
      latest: true,
      chunkSize: 50,
      fetchChunk: fetch,
    });
    const s = await settle(engine, (x) => x.status === "ready");
    expect(s.target).toBe(1024999);
    expect(s.roomState?.gameTime).toBe(1024999);
  });

  it("没有 Tick 的房间：一律 missing（不会把房间名错配到别的房间）", async () => {
    const { fetch } = await splitFetcher();
    engine = createReplay({ shard: SHARD, room: "E1N1", start: 1024910, chunkSize: 50, fetchChunk: fetch });
    expect((await settle(engine, (x) => x.status !== "loading")).status).toBe("missing");
  });

  describe("播放", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("1x 每秒前进一 Tick，16x 每秒十六 Tick；暂停后不动", async () => {
      const { fetch } = await splitFetcher();
      engine = createReplay({ shard: SHARD, room: ROOM, start: 1024910, chunkSize: 50, fetchChunk: fetch });
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.snapshot().status).toBe("ready");
      engine.play();
      expect(engine.snapshot().playing).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(engine.snapshot().target).toBe(1024913);
      engine.setSpeed(16);
      await vi.advanceTimersByTimeAsync(1000);
      expect(engine.snapshot().target).toBe(1024929);
      engine.pause();
      await vi.advanceTimersByTimeAsync(5000);
      expect(engine.snapshot()).toMatchObject({ target: 1024929, playing: false, speed: 16 });
    });

    it("播放到历史尽头时停下并提示 missing", async () => {
      const { fetch } = await splitFetcher();
      engine = createReplay({ shard: SHARD, room: ROOM, start: 1024995, chunkSize: 50, fetchChunk: fetch });
      await vi.advanceTimersByTimeAsync(0);
      engine.play();
      engine.setSpeed(4);
      await vi.advanceTimersByTimeAsync(5000);
      const s = engine.snapshot();
      expect(s.playing).toBe(false);
      expect(s.status).toBe("missing");
      expect(s.target).toBe(1025000);
    });
  });

  it("订阅者在每次变化时收到快照，dispose 后不再收到", async () => {
    const { fetch } = await splitFetcher();
    engine = createReplay({ shard: SHARD, room: ROOM, start: 1024910, chunkSize: 50, fetchChunk: fetch });
    const seen: ReplaySnapshot[] = [];
    const off = engine.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    await settle(engine, ready(1024910));
    expect(seen.at(-1)?.status).toBe("ready");
    off();
    const count = seen.length;
    engine.step(1);
    await settle(engine, ready(1024911));
    expect(seen).toHaveLength(count);
  });
});
