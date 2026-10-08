/**
 * Room View 的显示选项（#26）：say 气泡、RoomVisual、玩家名、光照（#49，发光图元）、动画（#55，ADR 0008）五个开关，
 * 存 `msc.roomDisplay`（可导出）。#54 删除了只对几何画风有效的血条开关；存储里旧的 `bars` 值读取时忽略。
 *
 * 存储里只有用户设置过的开关：没设置过的取默认值。动画的默认值随系统的“减少动态效果”
 * （`prefers-reduced-motion: reduce` 时关），所以“没设置”与“设置为开”要区分；用户设置过的值优先。
 *
 * 各开关经 `RoomSceneView.display` 作用于 buildRoomScene；
 * say 开关由 `showSayBubbles` 读出，气泡画法在 say-bubbles.ts（#22）。
 */
import { createSignal, type Accessor } from "solid-js";
import { mediaQuery } from "../shell/breakpoint.ts";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const ROOM_DISPLAY_STORAGE: StoredKey = { key: "msc.roomDisplay", kind: "json-object", role: "settings" };

export interface RoomDisplay {
  /** creep 的 say 气泡 */
  readonly say: boolean;
  /** 脚本画的 RoomVisual */
  readonly visual: boolean;
  /** creep 上方的玩家名 */
  readonly names: boolean;
  /** 光照（#49） */
  readonly lighting: boolean;
  /** 有界动画（#55）：动作动画、受击闪光、塔转向、移动补间 */
  readonly animation: boolean;
}

export type RoomDisplayKey = keyof RoomDisplay;

export const ROOM_DISPLAY_KEYS: readonly RoomDisplayKey[] = ["say", "visual", "names", "lighting", "animation"];

/** 没有系统偏好时的默认值（全开） */
export const DEFAULT_ROOM_DISPLAY: RoomDisplay = { say: true, visual: true, names: true, lighting: true, animation: true };

/** 系统要求减少动态效果 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 用户设置过的开关（未知键与非布尔值忽略） */
function decode(value: unknown): Partial<RoomDisplay> | undefined {
  if (!isRecord(value)) return undefined;
  const chosen: Partial<Record<RoomDisplayKey, boolean>> = {};
  for (const key of ROOM_DISPLAY_KEYS) if (typeof value[key] === "boolean") chosen[key] = value[key] as boolean;
  return chosen;
}

export interface RoomDisplayOptions {
  readonly display: Accessor<RoomDisplay>;
  set(key: RoomDisplayKey, on: boolean): void;
}

export interface RoomDisplayEnvironment {
  /** 系统是否要求减少动态效果；默认跟随 REDUCED_MOTION_QUERY（没有 matchMedia 时为否），需要 Solid 的 owner */
  readonly reducedMotion?: Accessor<boolean>;
}

export function createRoomDisplayOptions(storage: KeyValueStorage | undefined, env: RoomDisplayEnvironment = {}): RoomDisplayOptions {
  const reducedMotion = env.reducedMotion ?? mediaQuery(REDUCED_MOTION_QUERY);
  const [chosen, setChosen] = createSignal<Partial<RoomDisplay>>(readJson(storage, ROOM_DISPLAY_STORAGE.key, decode, {}));
  return {
    display: () => ({ ...DEFAULT_ROOM_DISPLAY, animation: !reducedMotion(), ...chosen() }),
    set(key, on) {
      const next = { ...chosen(), [key]: on };
      setChosen(next);
      writeJson(storage, ROOM_DISPLAY_STORAGE.key, next);
    },
  };
}

/** say 气泡是否显示；没有给出显示选项时显示 */
export function showSayBubbles(display: RoomDisplay | undefined): boolean {
  return display?.say ?? DEFAULT_ROOM_DISPLAY.say;
}
