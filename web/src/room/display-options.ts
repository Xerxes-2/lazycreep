/**
 * Room View 的显示选项（#26）：say 气泡、RoomVisual、玩家名、光照（#49，发光图元）四个开关，
 * 存 `msc.roomDisplay`（可导出）。#54 删除了只对几何画风有效的血条开关；存储里旧的 `bars` 值读取时忽略。
 *
 * 各开关经 `RoomSceneView.display` 作用于 buildRoomScene；
 * say 开关由 `showSayBubbles` 读出，气泡画法在 say-bubbles.ts（#22）。
 */
import { createSignal, type Accessor } from "solid-js";
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
}

export type RoomDisplayKey = keyof RoomDisplay;

export const ROOM_DISPLAY_KEYS: readonly RoomDisplayKey[] = ["say", "visual", "names", "lighting"];

export const DEFAULT_ROOM_DISPLAY: RoomDisplay = { say: true, visual: true, names: true, lighting: true };

function decode(value: unknown): RoomDisplay | undefined {
  if (!isRecord(value)) return undefined;
  const pick = (key: RoomDisplayKey) => (typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_ROOM_DISPLAY[key]);
  return { say: pick("say"), visual: pick("visual"), names: pick("names"), lighting: pick("lighting") };
}

export interface RoomDisplayOptions {
  readonly display: Accessor<RoomDisplay>;
  set(key: RoomDisplayKey, on: boolean): void;
}

export function createRoomDisplayOptions(storage: KeyValueStorage | undefined): RoomDisplayOptions {
  const [display, setDisplay] = createSignal<RoomDisplay>(readJson(storage, ROOM_DISPLAY_STORAGE.key, decode, DEFAULT_ROOM_DISPLAY));
  return {
    display,
    set(key, on) {
      const next = { ...display(), [key]: on };
      setDisplay(next);
      writeJson(storage, ROOM_DISPLAY_STORAGE.key, next);
    },
  };
}

/** say 气泡是否显示；没有给出显示选项时显示 */
export function showSayBubbles(display: RoomDisplay | undefined): boolean {
  return display?.say ?? DEFAULT_ROOM_DISPLAY.say;
}
