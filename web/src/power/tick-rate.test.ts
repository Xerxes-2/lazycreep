import { describe, expect, it } from "vitest";
import { createTickRate } from "./tick-rate.ts";

describe("Tick 速度：最近若干 Tick 的到达间隔", () => {
  it("不足两个 Tick 时没有读数", () => {
    const rate = createTickRate();
    expect(rate.msPerTick()).toBeUndefined();
    rate.record(100, 0);
    expect(rate.msPerTick()).toBeUndefined();
  });

  it("按到达时间与 Tick 号之差求平均毫秒数", () => {
    const rate = createTickRate();
    rate.record(100, 0);
    rate.record(101, 3000);
    rate.record(102, 7000);
    expect(rate.msPerTick()).toBe(3500);
  });

  it("跳过的 Tick 计入分母（一帧跨两个 Tick）", () => {
    const rate = createTickRate();
    rate.record(100, 0);
    rate.record(102, 6000);
    expect(rate.msPerTick()).toBe(3000);
  });

  it("只看最近 window 个 Tick，早先的慢 Tick 移出窗口后不再影响读数", () => {
    const rate = createTickRate({ window: 3 });
    rate.record(1, 0);
    rate.record(2, 60_000); // 一次卡顿
    rate.record(3, 61_000);
    rate.record(4, 62_000);
    expect(rate.msPerTick()).toBe(1000);
  });

  it("重复或倒退的 Tick 号忽略；reset 清空", () => {
    const rate = createTickRate();
    rate.record(100, 0);
    rate.record(100, 500);
    rate.record(99, 800);
    rate.record(101, 2000);
    expect(rate.msPerTick()).toBe(2000);
    rate.reset();
    expect(rate.msPerTick()).toBeUndefined();
  });
});
