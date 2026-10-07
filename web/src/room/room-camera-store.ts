/**
 * Room View 每个房间的视口（相机）存在浏览器本地，键按 Server + Shard + 房间区分。
 * 存储不可用或内容损坏时当作没有记录。
 */
import type { Camera } from "../scene/scene-camera.ts";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

/** 每个房间一个键：前缀 + Server/Shard/房间 */
export const ROOM_CAMERA_STORAGE: StoredKey = { key: "msc.roomCamera.", kind: "json-object", role: "settings", prefix: true };

export function cameraKey(serverId: string, shard: string, room: string): string {
  return `${ROOM_CAMERA_STORAGE.key}${serverId}/${shard}/${room}`;
}

function decode(value: unknown): Camera | undefined {
  if (!isRecord(value)) return undefined;
  const { cx, cy, span } = value;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!finite(cx) || !finite(cy) || !finite(span) || span <= 0) return undefined;
  return { cx, cy, span };
}

export function loadCamera(storage: KeyValueStorage | undefined, key: string): Camera | undefined {
  return readJson<Camera | undefined>(storage, key, decode, undefined);
}

export function saveCamera(storage: KeyValueStorage | undefined, key: string, camera: Camera): void {
  writeJson(storage, key, { cx: camera.cx, cy: camera.cy, span: camera.span });
}
