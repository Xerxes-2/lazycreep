/**
 * 页面 UI 的明暗主题（#5）：手动选浅色 / 深色，或跟随系统（prefers-color-scheme，并响应系统变化）。
 * 结果写到 `<html data-theme>`，styles.css 按它切换 CSS 变量；脚本运行前由媒体查询兜底。
 * 只管页面 UI；Scene 的调色板另由 color-scheme.ts 管理。偏好存在 `msc.uiTheme`。
 */
import { createRenderEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const UI_THEME_KEY = "msc.uiTheme";
export const UI_THEME_STORAGE: StoredKey = { key: UI_THEME_KEY, kind: "json-string", role: "settings" };
export const UI_THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type UiThemePreference = (typeof UI_THEME_PREFERENCES)[number];
export type UiTheme = "light" | "dark";

/** MediaQueryList 的最小接口；测试里换成假的 */
export interface DarkQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export interface UiThemeOptions {
  readonly storage: KeyValueStorage | undefined;
  /** `(prefers-color-scheme: dark)`；undefined 表示不可用（按浅色） */
  readonly darkQuery: DarkQuery | undefined;
  /** 写 data-theme 的元素，默认 document.documentElement */
  readonly root?: HTMLElement;
}

export interface UiThemeStore {
  readonly preference: Accessor<UiThemePreference>;
  readonly resolved: Accessor<UiTheme>;
  setPreference(preference: UiThemePreference): void;
}

export function browserDarkQuery(): DarkQuery | undefined {
  try {
    return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-color-scheme: dark)") : undefined;
  } catch {
    return undefined;
  }
}

function isPreference(value: unknown): value is UiThemePreference {
  return (UI_THEME_PREFERENCES as readonly unknown[]).includes(value);
}

/** 需要在 Solid 的 owner 里调用（监听系统变化，随 owner 释放）。 */
export function createUiTheme(options: UiThemeOptions): UiThemeStore {
  const stored = readJson<UiThemePreference>(options.storage, UI_THEME_KEY, (v) => (isPreference(v) ? v : undefined), "system");
  const [preference, setSignal] = createSignal<UiThemePreference>(stored);
  const query = options.darkQuery;
  const [systemDark, setSystemDark] = createSignal(query?.matches ?? false);
  if (query) {
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));
  }
  const resolved = (): UiTheme => {
    const chosen = preference();
    if (chosen !== "system") return chosen;
    return systemDark() ? "dark" : "light";
  };

  const root = options.root ?? document.documentElement;
  createRenderEffect(() => {
    root.dataset["theme"] = resolved();
    root.style.colorScheme = resolved();
    // 浏览器地址栏 / PWA 标题栏颜色，与 styles.css 的 --bg 一致
    root.ownerDocument
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved() === "dark" ? "#1b1f24" : "#f6f7f9");
  });

  return {
    preference,
    resolved,
    setPreference(next) {
      if (!isPreference(next)) return;
      setSignal(next);
      writeJson(options.storage, UI_THEME_KEY, next);
    },
  };
}
