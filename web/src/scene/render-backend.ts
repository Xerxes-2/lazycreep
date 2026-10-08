/**
 * Scene 的渲染接口偏好（设置里叫“渲染接口”；“后端”在词表里指 Server）：WebGL（默认）或 WebGPU（试验）。偏好存在 `msc.renderBackend`，新建的视图按它选；
 * 已建好的视图换不了渲染器，所以改了要刷新页面才生效。
 *
 * 选 WebGPU 时浏览器不支持就由 Pixi 的 autoDetectRenderer 退回 WebGL（再不行 Canvas）；
 * 实际用上的接口记在 activeRenderBackend()，设置里显示，方便对比。
 */
import { createSignal } from "solid-js";
import { browserStorage, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const RENDER_BACKEND_KEY = "msc.renderBackend";
export const RENDER_BACKEND_STORAGE: StoredKey = { key: RENDER_BACKEND_KEY, kind: "json-string", role: "settings" };
export const RENDER_BACKENDS = ["webgl", "webgpu"] as const;
export type RenderBackend = (typeof RENDER_BACKENDS)[number];
/** 实际用上的接口（Canvas 是两者都不可用时的退路） */
export type ActiveRenderBackend = RenderBackend | "canvas";

const isBackend = (value: unknown): value is RenderBackend => (RENDER_BACKENDS as readonly unknown[]).includes(value);

export function readRenderBackend(storage: KeyValueStorage | undefined = browserStorage()): RenderBackend {
  return readJson<RenderBackend>(storage, RENDER_BACKEND_KEY, (v) => (isBackend(v) ? v : undefined), "webgl");
}

export function writeRenderBackend(backend: RenderBackend, storage: KeyValueStorage | undefined = browserStorage()): void {
  writeJson(storage, RENDER_BACKEND_KEY, backend);
}

const [active, setActive] = createSignal<ActiveRenderBackend>();
/** 本页最近建好的视图实际用的接口；还没有视图时 undefined */
export const activeRenderBackend = active;
export const reportRenderBackend = (backend: ActiveRenderBackend): void => void setActive(backend);
