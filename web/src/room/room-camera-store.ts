/**
 * Room View 每个房间的视口（相机）存在浏览器本地，键按 Server + Shard + 房间区分。
 * 存储不可用或内容损坏时当作没有记录。
 */
import type { Camera } from "../scene/scene-camera.ts";

export type CameraStorage = Pick<Storage, "getItem" | "setItem">;

export function cameraKey(serverId: string, shard: string, room: string): string {
  return `msc.roomCamera.${serverId}/${shard}/${room}`;
}

export function loadCamera(storage: CameraStorage | undefined, key: string): Camera | undefined {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { cx, cy, span } = value as Record<string, unknown>;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (!finite(cx) || !finite(cy) || !finite(span) || span <= 0) return undefined;
    return { cx, cy, span };
  } catch {
    return undefined;
  }
}

export function saveCamera(storage: CameraStorage | undefined, key: string, camera: Camera): void {
  try {
    storage?.setItem(key, JSON.stringify({ cx: camera.cx, cy: camera.cy, span: camera.span }));
  } catch {
    // 存储满了或被禁用：视口只在本次会话有效
  }
}
