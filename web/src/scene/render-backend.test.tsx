/**
 * 渲染后端偏好：默认 WebGL，可选 WebGPU（试验）；存在 `msc.renderBackend`，刷新后生效。
 * 外观设置里显示实际用上的渲染接口；选的和页面打开时不同就提示刷新。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { AppearanceSettings } from "../customize/AppearanceSettings.tsx";
import { createColorScheme } from "../customize/color-scheme.ts";
import { createUiTheme } from "../customize/ui-theme.ts";
import { STORED_KEYS } from "../customize/settings-transfer.ts";
import { RENDER_BACKEND_KEY, RENDER_BACKEND_STORAGE, readRenderBackend, reportRenderBackend, writeRenderBackend } from "./render-backend.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe("渲染后端偏好", () => {
  it("默认 WebGL；存进去的 WebGPU 读得回来；不认识的值回到 WebGL", () => {
    const storage = memoryStorage();
    expect(readRenderBackend(storage)).toBe("webgl");
    writeRenderBackend("webgpu", storage);
    expect(readRenderBackend(storage)).toBe("webgpu");
    storage.setItem(RENDER_BACKEND_KEY, JSON.stringify("vulkan"));
    expect(readRenderBackend(storage)).toBe("webgl");
  });

  it("登记为可导出的设置", () => {
    expect(STORED_KEYS).toContain(RENDER_BACKEND_STORAGE);
    expect(RENDER_BACKEND_STORAGE.role).toBe("settings");
  });
});

describe("外观设置里的渲染后端", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  function mount() {
    dispose = render(
      () => (
        <I18nProvider>
          <AppearanceSettings uiTheme={createUiTheme({ storage: localStorage, darkQuery: undefined })} colors={createColorScheme(localStorage)} />
        </I18nProvider>
      ),
      container,
    );
  }
  const group = () => container.querySelector<HTMLElement>("[data-testid=render-backend]")!;

  it("显示实际用上的后端；改选后存起来并提示刷新，改回来提示消失", () => {
    reportRenderBackend("webgl");
    mount();
    expect(group().querySelector<HTMLInputElement>("input[value=webgl]")!.checked).toBe(true);
    expect(group().querySelector("[data-render-backend-active]")!.textContent).toBe("当前实际使用：WebGL");
    expect(group().querySelector("[data-render-backend-reload]")).toBeNull();

    group().querySelector<HTMLInputElement>("input[value=webgpu]")!.click();
    expect(readRenderBackend(localStorage)).toBe("webgpu");
    expect(group().querySelector("[data-render-backend-reload]")!.textContent).toContain("刷新页面后生效");

    group().querySelector<HTMLInputElement>("input[value=webgl]")!.click();
    expect(group().querySelector("[data-render-backend-reload]")).toBeNull();
  });

  it("不支持时退回的后端照实显示", () => {
    reportRenderBackend("canvas");
    mount();
    expect(group().querySelector("[data-render-backend-active]")!.textContent).toContain("Canvas");
  });
});
