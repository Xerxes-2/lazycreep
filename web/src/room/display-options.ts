/**
 * Room View 的显示选项（#26）：say 气泡、RoomVisual、血条、玩家名四个开关，存 `msc.roomDisplay`（可导出）；
 * #49 加了光照（官方画风的发光图元）。
 *
 * RoomVisual、血条、玩家名经 `RoomSceneView.display` 作用于 buildRoomScene；
 * say 开关这里只存储，画 say 气泡的代码用 `showSayBubbles(view.display)` 读它。
 */
import { createSignal, type Accessor } from "solid-js";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const ROOM_DISPLAY_STORAGE: StoredKey = { key: "msc.roomDisplay", kind: "json-object", role: "settings" };

export interface RoomDisplay {
  /** creep 的 say 气泡 */
  readonly say: boolean;
  /** 脚本画的 RoomVisual */
  readonly visual: boolean;
  /** 血条 */
  readonly bars: boolean;
  /** creep 上方的玩家名 */
  readonly names: boolean;
  /** 官方画风的光照（#49） */
  readonly lighting: boolean;
}

export type RoomDisplayKey = keyof RoomDisplay;

export const ROOM_DISPLAY_KEYS: readonly RoomDisplayKey[] = ["say", "visual", "bars", "names", "lighting"];

export const DEFAULT_ROOM_DISPLAY: RoomDisplay = { say: true, visual: true, bars: true, names: true, lighting: true };

function decode(value: unknown): RoomDisplay | undefined {
  if (!isRecord(value)) return undefined;
  const pick = (key: RoomDisplayKey) => (typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_ROOM_DISPLAY[key]);
  return { say: pick("say"), visual: pick("visual"), bars: pick("bars"), names: pick("names"), lighting: pick("lighting") };
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
