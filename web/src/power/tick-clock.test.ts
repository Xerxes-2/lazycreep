/**
 * Top Bar 的 Tick 时钟：房间流 > 服务器平均 Tick 时长 > 校准估计；Tick 号从最近一个样本往前推。
 */
import { describe, expect, it } from "vitest";
import { LIVE_FRESH_MS, createTickClock } from "./tick-clock.ts";

function clockAt(start = 0) {
  const time = { now: start };
  return { clock: createTickClock(() => time.now), time };
}

describe("Tick 时钟", () => {
  it("没有样本时 Tick 未知；只有服务器平均值时用它当速度", () => {
    const { clock } = clockAt();
    expect(clock.tick()).toBeUndefined();
    expect(clock.msPerTick()).toBeUndefined();
    clock.setServerMs(4000);
    expect(clock.msPerTick()).toBe(4000);
  });

  it("从校准结果按服务器平均 Tick 时长往前推 Tick 号；再校准时以校准为准（可以跳回）", () => {
    const { clock, time } = clockAt();
    clock.setServerMs(4000);
    clock.calibrate(100);
    time.now = 3999;
    expect(clock.tick()).toBe(100);
    time.now = 8000;
    expect(clock.tick()).toBe(102);
    clock.calibrate(101);
    expect(clock.tick()).toBe(101);
  });

  it("没有服务器平均值时，用相邻校准估速度", () => {
    const { clock, time } = clockAt();
    clock.calibrate(100);
    expect(clock.msPerTick()).toBeUndefined();
    expect(clock.tick()).toBe(100);
    time.now = 60_000;
    clock.calibrate(115);
    expect(clock.msPerTick()).toBe(4000);
  });

  it("房间流在流时速度用实测，Tick 号用流里的；断流后回到服务器平均值", () => {
    const { clock, time } = clockAt();
    clock.setServerMs(4000);
    clock.live(200);
    time.now = 3000;
    clock.live(201);
    time.now = 6000;
    clock.live(202);
    expect(clock.streaming()).toBe(true);
    expect(clock.msPerTick()).toBe(3000);
    expect(clock.tick()).toBe(202);
    time.now = 6000 + LIVE_FRESH_MS;
    expect(clock.streaming()).toBe(false);
    expect(clock.msPerTick()).toBe(4000);
  });

  it("断流后重新进来不把中间空档算进速度", () => {
    const { clock, time } = clockAt();
    clock.live(200);
    time.now = 3000;
    clock.live(201);
    time.now = 100_000;
    clock.live(240);
    time.now = 103_000;
    clock.live(241);
    expect(clock.msPerTick()).toBe(3000);
  });
});
