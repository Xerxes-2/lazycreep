/**
 * 调试信息叠加层的数据：各 Scene 视图实际出了多少帧、每帧 render 花多少 CPU 时间、画布多少像素。
 * 开关存在 `msc.debugOverlay`（"1" 为开）；关着时视图不记录，开销只有一次判断。
 */
import { createSignal } from "solid-js";
import { browserStorage, readText, writeText, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const DEBUG_OVERLAY_KEY = "msc.debugOverlay";
export const DEBUG_OVERLAY_STORAGE: StoredKey = { key: DEBUG_OVERLAY_KEY, kind: "raw", role: "settings" };

const [enabled, setEnabled] = createSignal(readText(browserStorage(), DEBUG_OVERLAY_KEY) === "1");
export const debugOverlayEnabled = enabled;

export function setDebugOverlay(on: boolean, storage: KeyValueStorage | undefined = browserStorage()): void {
  writeText(storage, DEBUG_OVERLAY_KEY, on ? "1" : "0");
  setEnabled(on);
}

/** 统计窗口：最近这么多毫秒内的帧 */
const WINDOW_MS = 1000;

interface Track {
  readonly label: string;
  /** 最近 WINDOW_MS 内每帧的 [时刻, render 耗时] */
  frames: Array<readonly [number, number]>;
  /** 画布像素现取：没出帧的视图也显示真实尺寸 */
  readonly canvas: { readonly width: number; readonly height: number };
}

export interface ViewStats {
  readonly label: string;
  readonly fps: number;
  /** 平均每帧 render 的 CPU 耗时（毫秒）；窗口内没出帧时 undefined */
  readonly renderMs: number | undefined;
  readonly width: number;
  readonly height: number;
}

const tracks = new Map<number, Track>();
let nextId = 0;

/** 视图创建时登记；返回记一帧与注销的函数 */
export function trackView(
  label: string,
  canvas: { readonly width: number; readonly height: number },
): { frame(at: number, renderMs: number): void; dispose(): void } {
  const id = nextId++;
  const track: Track = { label, frames: [], canvas };
  tracks.set(id, track);
  return {
    frame(at, renderMs) {
      if (!enabled()) return;
      track.frames.push([at, renderMs]);
      while (track.frames.length > 0 && track.frames[0]![0] <= at - WINDOW_MS) track.frames.shift();
    },
    dispose: () => void tracks.delete(id),
  };
}

/** 当前各视图的统计（叠加层定时读） */
export function viewStats(now: number): ViewStats[] {
  return [...tracks.values()].map((t) => {
    const recent = t.frames.filter(([at]) => at > now - WINDOW_MS);
    const total = recent.reduce((sum, [, ms]) => sum + ms, 0);
    return {
      label: t.label,
      fps: (recent.length * 1000) / WINDOW_MS,
      renderMs: recent.length > 0 ? total / recent.length : undefined,
      width: t.canvas.width,
      height: t.canvas.height,
    };
  });
}
