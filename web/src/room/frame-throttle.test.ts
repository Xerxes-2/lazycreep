import { describe, expect, it } from "vitest";
import { createFrameThrottle } from "./frame-throttle.ts";

/** 手动的帧：flush() 跑一次已安排的分发 */
function manualFrames() {
  let queued: (() => void) | undefined;
  return {
    schedule: (run: () => void) => {
      queued = run;
      return () => void (queued = undefined);
    },
    flush() {
      const run = queued;
      queued = undefined;
      run?.();
    },
    get pending() {
      return queued !== undefined;
    },
  };
}

describe("每帧至多提交一次", () => {
  it("这一帧还没提交过：立即提交", () => {
    const frames = manualFrames();
    const committed: number[] = [];
    const throttle = createFrameThrottle(frames.schedule, (v: number) => committed.push(v));
    throttle.push(1);
    expect(committed).toEqual([1]);
  });

  it("同一帧里后来的只留最新的，下一帧提交（服务器 Tick 比帧快）", () => {
    const frames = manualFrames();
    const committed: number[] = [];
    const throttle = createFrameThrottle(frames.schedule, (v: number) => committed.push(v));
    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    expect(committed).toEqual([1]);
    frames.flush();
    expect(committed).toEqual([1, 3]);
    // 刚提交过，这一帧再来的仍等下一帧
    throttle.push(4);
    expect(committed).toEqual([1, 3]);
    frames.flush();
    expect(committed).toEqual([1, 3, 4]);
  });

  it("一帧里没有新的：不提交，也不再占着帧，下一个立即提交", () => {
    const frames = manualFrames();
    const committed: number[] = [];
    const throttle = createFrameThrottle(frames.schedule, (v: number) => committed.push(v));
    throttle.push(1);
    frames.flush();
    expect(frames.pending).toBe(false);
    throttle.push(2);
    expect(committed).toEqual([1, 2]);
  });

  it("dispose 后丢掉没提交的，不再提交", () => {
    const frames = manualFrames();
    const committed: number[] = [];
    const throttle = createFrameThrottle(frames.schedule, (v: number) => committed.push(v));
    throttle.push(1);
    throttle.push(2);
    throttle.dispose();
    expect(frames.pending).toBe(false);
    frames.flush();
    expect(committed).toEqual([1]);
  });
});
