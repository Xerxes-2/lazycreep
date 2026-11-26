import { describe, expect, it } from "vitest";
import { cappedFrameScheduler, frameInterval, readFrameRate, throttledSchedule } from "./frame-rate.ts";
import { createFrameThrottle } from "../room/frame-throttle.ts";

/** 假的 vsync：每 period 毫秒一次，跑 duration 毫秒，数出帧数 */
function framesOver(period: number, interval: number, duration: number): number {
  let queue: ((t: number) => void)[] = [];
  const schedule = throttledSchedule((cb) => void queue.push(cb), () => interval);
  let frames = 0;
  const loop = () => {
    frames++;
    schedule(loop);
  };
  schedule(loop);
  for (let t = period; t <= duration; t += period) {
    const due = queue;
    queue = [];
    for (const cb of due) cb(t);
  }
  return frames;
}

describe("帧率上限", () => {
  it("没存过时默认 60；存的值不认识时也退回 60", () => {
    expect(readFrameRate(undefined)).toBe("60");
    const storage = { getItem: () => JSON.stringify("144"), setItem: () => {} };
    expect(readFrameRate(storage)).toBe("60");
  });

  it("不限时每个 vsync 都出帧", () => {
    expect(framesOver(1000 / 144, frameInterval("unlimited"), 1000)).toBeGreaterThanOrEqual(143);
  });

  it("144 Hz 屏上限 60 时平均仍约 60 帧（不退化成 48），上限 30 约 30 帧", () => {
    expect(framesOver(1000 / 144, frameInterval("60"), 1000)).toBeGreaterThanOrEqual(58);
    expect(framesOver(1000 / 144, frameInterval("60"), 1000)).toBeLessThanOrEqual(61);
    const thirty = framesOver(1000 / 144, frameInterval("30"), 1000);
    expect(thirty).toBeGreaterThanOrEqual(29);
    expect(thirty).toBeLessThanOrEqual(31);
  });

  it("60 Hz 屏上限 60 不丢帧，上限 30 隔一帧出一帧", () => {
    expect(framesOver(1000 / 60, frameInterval("60"), 1000)).toBeGreaterThanOrEqual(59);
    expect(framesOver(1000 / 60, frameInterval("30"), 1000)).toBe(30);
  });
});

describe("按帧率上限的提交调度（Room View 的状态提交）", () => {
  /** 60 Hz 的假 vsync；数据每 3 ms 一个 Tick（私服 3 ms/Tick），跑 1 秒，数出提交次数 */
  function commitsOver(rate: "60" | "30" | "unlimited"): number {
    const queue = new Map<number, (t: number) => void>();
    let nextId = 1;
    const schedule = cappedFrameScheduler(
      (cb) => {
        const id = nextId++;
        queue.set(id, cb);
        return id;
      },
      (id) => void queue.delete(id),
      () => frameInterval(rate),
    );
    let commits = 0;
    const throttle = createFrameThrottle(schedule, () => commits++);
    const vsync = 1000 / 60;
    let nextVsync = vsync;
    for (let t = 0; t <= 1000; t += 3) {
      while (nextVsync <= t) {
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) cb(nextVsync);
        nextVsync += vsync;
      }
      throttle.push(t);
    }
    throttle.dispose();
    return commits;
  }

  it("上限 30 时每秒约 30 次提交，而不是跟着 vsync 的 60 次", () => {
    const thirty = commitsOver("30");
    expect(thirty).toBeGreaterThanOrEqual(29);
    expect(thirty).toBeLessThanOrEqual(32);
  });

  it("上限 60 与不限时每个 vsync 一次", () => {
    expect(commitsOver("60")).toBeGreaterThanOrEqual(59);
    expect(commitsOver("60")).toBeLessThanOrEqual(61);
    expect(commitsOver("unlimited")).toBeGreaterThanOrEqual(59);
  });

  it("取消后不再调用", () => {
    const queue: Array<(t: number) => void> = [];
    let cancelled = 0;
    const schedule = cappedFrameScheduler((cb) => queue.push(cb), () => void cancelled++, () => 0);
    let flushed = 0;
    const cancel = schedule(() => flushed++);
    cancel();
    expect(cancelled).toBe(1);
    expect(flushed).toBe(0);
  });
});
