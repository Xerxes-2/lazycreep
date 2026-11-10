import { describe, expect, it } from "vitest";
import { frameInterval, readFrameRate, throttledSchedule } from "./frame-rate.ts";

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
