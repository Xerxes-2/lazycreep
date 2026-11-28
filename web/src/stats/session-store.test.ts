import { describe, expect, it } from "vitest";
import { createSessionStore } from "./session-store.ts";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), add: (ms: number) => (t += ms) };
}

describe("session-store", () => {
  it("同一秒内的样本并成一格，窗口里按桶给出 min / max / avg", () => {
    const c = clock();
    const store = createSessionStore({ now: c.now });
    store.record("cpu", 4, c.now());
    store.record("cpu", 8, c.now() + 300);
    c.add(10_000);
    const w = store.window(10_000, 10);
    expect(w.series("cpu")[0]).toEqual({ min: 4, max: 8, avg: 6 });
    expect(w.series("cpu").slice(1).every((b) => b === null)).toBe(true);
  });

  it("没记过的指标整列为 null", () => {
    const c = clock();
    const store = createSessionStore({ now: c.now });
    c.add(5000);
    expect(store.window(5000, 5).series("nope")).toEqual([null, null, null, null, null]);
  });

  it("超过保留期的格子丢掉", () => {
    const c = clock();
    const store = createSessionStore({ now: c.now, retainMs: 10_000 });
    store.record("cpu", 1);
    c.add(20_000);
    store.record("cpu", 2);
    const all = store.window(60_000, 60);
    const values = all.series("cpu").filter((b) => b !== null);
    expect(values).toEqual([{ min: 2, max: 2, avg: 2 }]);
  });

  it("“全部”从会话开始算起，不早于保留期", () => {
    const c = clock();
    const store = createSessionStore({ now: c.now, retainMs: 60_000 });
    c.add(30_000);
    expect(store.window("all", 10).from).toBe(c.now() - 30_000);
    c.add(100_000);
    expect(store.window("all", 10).from).toBe(c.now() - 60_000);
  });

  it("空档按桶标出：隐藏优先于断线，进行中的空档延伸到现在", () => {
    const c = clock(0);
    const store = createSessionStore({ now: c.now });
    store.setGap("offline", 2000);
    store.setGap(undefined, 4000);
    store.setGap("hidden", 7000);
    c.set(10_000);
    const w = store.window(10_000, 10);
    expect(w.gaps).toEqual([undefined, undefined, "offline", "offline", undefined, undefined, undefined, "hidden", "hidden", "hidden"]);
  });

  it("短缺口按直线补上，跨空档或太长的缺口不补", () => {
    const c = clock(0);
    const store = createSessionStore({ now: c.now, bridgeMs: 5000 });
    store.record("tick", 0, 0);
    store.record("tick", 3, 3000);
    store.setGap("hidden", 4000);
    store.setGap(undefined, 5000);
    store.record("tick", 9, 6000);
    store.record("tick", 9, 19_000);
    c.set(20_000);
    const s = store.window(20_000, 20).series("tick");
    expect(s[1]?.avg).toBe(1);
    expect(s[2]?.avg).toBe(2);
    expect(s[4]).toBeNull(); // 跨了隐藏的空档
    expect(s[5]).toBeNull();
    expect(s[10]).toBeNull(); // 6 秒到 19 秒，超过 bridgeMs
  });

  it("非有限值不记", () => {
    const c = clock();
    const store = createSessionStore({ now: c.now });
    store.record("x", Number.NaN);
    expect(store.keys()).toEqual([]);
  });
});
