/**
 * Scene 的帧率上限（设置里叫“帧率上限”）：高刷屏上房间动画会跟着刷新率跑满（实测 150 帧/秒），
 * 而 Tick 再快也就每秒 20 个左右，多出来的帧只是耗电。默认 60，即时生效，不用刷新。
 */
import { createSignal } from "solid-js";
import { browserStorage, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const FRAME_RATE_KEY = "msc.frameRate";
export const FRAME_RATE_STORAGE: StoredKey = { key: FRAME_RATE_KEY, kind: "json-string", role: "settings" };
export const FRAME_RATES = ["60", "30", "unlimited"] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
export const DEFAULT_FRAME_RATE: FrameRate = "60";

const isFrameRate = (value: unknown): value is FrameRate => (FRAME_RATES as readonly unknown[]).includes(value);

export function readFrameRate(storage: KeyValueStorage | undefined = browserStorage()): FrameRate {
  return readJson<FrameRate>(storage, FRAME_RATE_KEY, (v) => (isFrameRate(v) ? v : undefined), DEFAULT_FRAME_RATE);
}

const [current, setCurrent] = createSignal<FrameRate>(readFrameRate());
/** 当前的帧率上限；所有 Scene 视图每帧读它，改了立即生效 */
export const frameRate = current;

export function setFrameRate(rate: FrameRate, storage: KeyValueStorage | undefined = browserStorage()): void {
  writeJson(storage, FRAME_RATE_KEY, rate);
  setCurrent(rate);
}

/** 上限对应的最短帧间隔（毫秒）；不限时为 0 */
export const frameInterval = (rate: FrameRate): number => (rate === "unlimited" ? 0 : 1000 / Number(rate));

/**
 * 按上限节流的 requestAnimationFrame：没到间隔的 vsync 跳过、下一个 vsync 再看。
 * 上一帧的时刻对齐到间隔网格（扣掉超出的部分），144 Hz 屏上限 60 时平均仍是 60 帧，而不是退化成 48。
 */
export function throttledSchedule(
  raf: (callback: (time: number) => void) => void,
  interval: () => number,
): (frame: () => void) => void {
  let last = -Infinity;
  return (frame) => {
    const step = (time: number) => {
      const min = interval();
      const elapsed = time - last;
      // 留 1 ms 余量：vsync 时间戳有抖动，刚好卡在间隔上的那一帧不该被跳过
      if (min > 0 && elapsed < min - 1) {
        raf(step);
        return;
      }
      // 只扣超出间隔的那点（不用 %：间隔恰好整除时浮点取模会得到差一点点的整个间隔）
      last = min > 0 && elapsed < 2 * min ? time - Math.max(0, elapsed - min) : time;
      frame();
    };
    raf(step);
  };
}
