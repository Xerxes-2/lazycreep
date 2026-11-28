import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { manualVisibility } from "../power/visibility.ts";
import type { RoomState } from "../room/room-state.ts";
import type { ConnectionState, CpuUpdate, Source } from "../source/source.ts";
import { CPU_KEY, createSessionRecorder, MEMORY_KEY, roomKey, TICK_KEY } from "./session-recorder.ts";

/** 记录器只用到 Source 的这几样 */
function fakeSource() {
  const cpu = new Set<(u: CpuUpdate) => void>();
  const conn = new Set<(s: ConnectionState) => void>();
  const source = {
    getMe: async () => ({ id: "me", username: "Me", rooms: {} }),
    subscribeCpu(listener: (u: CpuUpdate) => void) {
      cpu.add(listener);
      return () => void cpu.delete(listener);
    },
    onConnection(listener: (s: ConnectionState) => void) {
      conn.add(listener);
      listener("authenticated");
      return () => void conn.delete(listener);
    },
  };
  return {
    source: source as unknown as Source,
    emitCpu: (u: CpuUpdate) => cpu.forEach((l) => l(u)),
    setConnection: (s: ConnectionState) => conn.forEach((l) => l(s)),
    cpuListeners: () => cpu.size,
  };
}

const frame = (gameTime: number | undefined, objects: RoomState["objects"] = {}): RoomState => ({ gameTime, objects, users: {}, visual: "" });

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

function setup(token = "t") {
  let t = 1_000_000;
  const fake = fakeSource();
  const visibility = manualVisibility(true);
  const [source, setSource] = createSignal(fake.source);
  const recorder = createRoot((d) => {
    dispose = d;
    return createSessionRecorder({ source, token: () => token, visibility, allies: () => undefined, now: () => t, notifyMs: 10 });
  });
  return { recorder, fake, visibility, setSource, advance: (ms: number) => (t += ms), now: () => t };
}

describe("session-recorder", () => {
  it("CPU 帧记成 CPU 与 Memory 两个指标", () => {
    const { recorder, fake, advance } = setup();
    fake.emitCpu({ cpu: 12, memory: 2048 });
    advance(5000);
    const w = recorder.store().window(5000, 5);
    expect(w.series(CPU_KEY)[0]?.avg).toBe(12);
    expect(w.series(MEMORY_KEY)[0]?.avg).toBe(2048);
  });

  it("没有 token 时不订阅 CPU", () => {
    const { fake } = setup("");
    expect(fake.cpuListeners()).toBe(0);
  });

  it("Live 帧算 Tick 速度与房间指标；快照与同一 Tick 的重复帧跳过", async () => {
    const { recorder, advance } = setup();
    await Promise.resolve(); // getMe
    const storage = { s: { type: "storage", x: 1, y: 1, store: { energy: 100 } } };
    recorder.observeRoom("shardA", "W1N1", { objects: storage, users: {} }); // 快照：没有 gameTime
    recorder.observeRoom("shardA", "W1N1", frame(10, storage));
    advance(3000);
    recorder.observeRoom("shardA", "W1N1", frame(11, storage));
    // 同一 Tick 的重复帧：若没跳过，平均值会被拉高
    recorder.observeRoom("shardA", "W1N1", frame(11, { s: { type: "storage", x: 1, y: 1, store: { energy: 900 } } }));
    advance(3000);
    // 两个桶各 3 秒，各含一帧
    const w = recorder.store().window(6000, 2);
    expect(w.series(TICK_KEY)[1]).toEqual({ min: 3000, max: 3000, avg: 3000 });
    expect(w.series(roomKey("shardA", "W1N1", "storage")).map((b) => b?.avg)).toEqual([100, 100]);
    expect(w.series(roomKey("shardA", "W1N1", "mine")).map((b) => b?.avg)).toEqual([0, 0]);
    expect(recorder.rooms().map((r) => r.room)).toEqual(["W1N1"]);
  });

  it("页面隐藏与断线记成空档，隐藏优先", () => {
    const { recorder, fake, visibility, advance } = setup();
    advance(2000);
    fake.setConnection("reconnecting");
    advance(2000);
    visibility.set(false);
    advance(2000);
    visibility.set(true);
    advance(2000);
    fake.setConnection("authenticated");
    advance(2000);
    const w = recorder.store().window(10_000, 5);
    expect(w.gaps).toEqual([undefined, "offline", "hidden", "offline", undefined]);
  });

  it("换 Source 时重新开始", () => {
    const { recorder, fake, setSource, advance } = setup();
    fake.emitCpu({ cpu: 5, memory: 1 });
    setSource(fakeSource().source);
    advance(1000);
    expect(recorder.store().keys()).toEqual([]);
  });

  it("界面通知节流：一批更新只递增一次 version", async () => {
    vi.useFakeTimers();
    const { recorder, fake } = setup();
    await vi.advanceTimersByTimeAsync(20);
    const before = recorder.version();
    for (let i = 0; i < 50; i++) fake.emitCpu({ cpu: i, memory: 1 });
    await vi.advanceTimersByTimeAsync(20);
    expect(recorder.version()).toBe(before + 1);
  });
});
