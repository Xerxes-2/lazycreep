/**
 * Scene 的帧率上限（设置里叫“帧率上限”）：高刷屏上房间动画会跟着刷新率跑满（实测 150 帧/秒），
 * 多出来的帧只是耗电。默认 60，即时生效，不用刷新。
 * 既限 Pixi 出帧（throttledSchedule），也限 Room View 的房间状态提交（cappedFrameScheduler）：
 * 私服几毫秒一个 Tick 时，每次提交都要重建 Room Scene 并逐个比较图元，只限出帧省不下这部分。
 */
import type { FlushScheduler } from "../source/room-map-hub.ts";
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
 * 按上限放行 vsync：没到间隔的返回 false（跳过，下一个 vsync 再看）。
 * 上一帧的时刻对齐到间隔网格（扣掉超出的部分），144 Hz 屏上限 60 时平均仍是 60 帧，而不是退化成 48。
 */
function frameGate(interval: () => number): (time: number) => boolean {
  let last = -Infinity;
  return (time) => {
    const min = interval();
    const elapsed = time - last;
    // 留 1 ms 余量：vsync 时间戳有抖动，刚好卡在间隔上的那一帧不该被跳过
    if (min > 0 && elapsed < min - 1) return false;
    // 只扣超出间隔的那点（不用 %：间隔恰好整除时浮点取模会得到差一点点的整个间隔）
    last = min > 0 && elapsed < 2 * min ? time - Math.max(0, elapsed - min) : time;
    return true;
  };
}

/** 按上限节流的 requestAnimationFrame：没到间隔的 vsync 跳过、下一个 vsync 再看。 */
export function throttledSchedule(
  raf: (callback: (time: number) => void) => void,
  interval: () => number,
): (frame: () => void) => void {
  const admit = frameGate(interval);
  return (frame) => {
    const step = (time: number) => (admit(time) ? frame() : raf(step));
    raf(step);
  };
}

/**
 * 同样按上限放行，但形如 FlushScheduler（可取消），给 frame-throttle.ts 用。每个实例各记各的上一帧。
 * 不带隐藏页面的兜底定时器：Room View 在页面隐藏时退订房间流，没有要提交的。
 */
export function cappedFrameScheduler(
  raf: (callback: (time: number) => void) => number,
  cancel: (id: number) => void,
  interval: () => number,
): FlushScheduler {
  const admit = frameGate(interval);
  return (flush) => {
    let id: number | undefined;
    const step = (time: number) => {
      if (admit(time)) {
        id = undefined;
        flush();
      } else id = raf(step);
    };
    id = raf(step);
    return () => {
      if (id !== undefined) cancel(id);
      id = undefined;
    };
  };
}
