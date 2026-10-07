import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentVisibility, manualVisibility, pollWhileVisible, whileVisible } from "./visibility.ts";

/** 一个可以改 visibilityState 的假 document。 */
function fakeDocument(initial: DocumentVisibilityState = "visible") {
  let state = initial;
  return new (class extends EventTarget {
    get visibilityState() {
      return state;
    }
    set(next: DocumentVisibilityState) {
      state = next;
      this.dispatchEvent(new Event("visibilitychange"));
    }
  })();
}

describe("documentVisibility", () => {
  it("跟随 document.visibilityState，变化时通知订阅者", () => {
    const doc = fakeDocument();
    const signal = documentVisibility(doc);
    const seen: boolean[] = [];
    const off = signal.subscribe((v) => seen.push(v));
    expect(signal.visible()).toBe(true);
    doc.set("hidden");
    expect(signal.visible()).toBe(false);
    doc.set("visible");
    off();
    doc.set("hidden");
    expect(seen).toEqual([false, true]);
  });

  it("状态没变的事件不重复通知", () => {
    const doc = fakeDocument("hidden");
    const signal = documentVisibility(doc);
    const seen: boolean[] = [];
    signal.subscribe((v) => seen.push(v));
    doc.set("hidden");
    expect(seen).toEqual([]);
  });
});

describe("whileVisible", () => {
  it("可见时启动，隐藏时停止，回到前台再启动；退订后不再启动", () => {
    const signal = manualVisibility(true);
    const log: string[] = [];
    const off = whileVisible(signal, () => {
      log.push("start");
      return () => log.push("stop");
    });
    signal.set(false);
    signal.set(true);
    off();
    signal.set(false);
    signal.set(true);
    expect(log).toEqual(["start", "stop", "start", "stop"]);
  });

  it("一开始就不可见时等到可见才启动", () => {
    const signal = manualVisibility(false);
    const start = vi.fn();
    whileVisible(signal, start);
    expect(start).not.toHaveBeenCalled();
    signal.set(true);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("pollWhileVisible", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("可见时立即拉一次，之后按间隔轮询；隐藏期间不拉，回到前台立即补拉", async () => {
    const signal = manualVisibility(true);
    const task = vi.fn(async () => {});
    const off = pollWhileVisible(signal, task, 10_000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(2);

    signal.set(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    signal.set(true);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(4);

    off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("上一次还没完成时不叠加；失败也继续轮询", async () => {
    const signal = manualVisibility(true);
    let finish!: () => void;
    let calls = 0;
    const task = () => {
      calls += 1;
      if (calls === 1) return new Promise<void>((resolve) => (finish = resolve));
      return Promise.reject(new Error("boom"));
    };
    pollWhileVisible(signal, task, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(3);
  });

  it("隐藏时进行中的那次完成后不再排下一次", async () => {
    const signal = manualVisibility(true);
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    pollWhileVisible(signal, task, 1000);
    signal.set(false);
    finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
