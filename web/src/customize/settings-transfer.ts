/**
 * 设置导出 / 导入（#5）：把浏览器本地的全部 `msc.*` 设置打包成一个 JSON 文件，在另一个浏览器还原。
 *
 * - 每个功能在自己的模块里声明并导出存储键（StoredKey，见 storage/local-store.ts），这里只汇总到
 *   STORED_KEYS。role 为 settings 的进导出范围；runtime（运行状态）不导出、导入时也不动。
 *   新增存储键时：在功能模块里声明，再把声明加进 STORED_KEYS；测试扫描源码里的 `msc.*` 字面量，
 *   没汇总进来的键会让测试变红。
 * - 不含 token：导出时从 `msc.settings` 去掉；导入时忽略文件里的 token，保留本机已有的 token。
 * - 导入是“还原”：登记范围内、文件里没有的本机键会被删掉；未知键与类型不对的值忽略并报告。
 *   每个功能读存储时自己再做一遍字段级校验，所以这里只校验到值的类型。
 * - 导入只写存储；让页面生效由调用方负责（App 重建整个界面，见 App.tsx）。
 */

import { ALERT_MEMORY_STORAGE } from "../alert/alert-memory.ts";
import { ALERT_SETTINGS_STORAGE } from "../alert/alert-settings.ts";
import { ALLY_LIST_STORAGE } from "../allies/ally-list.ts";
import { CONSOLE_SETTINGS_STORAGE } from "../console/console-settings.ts";
import { LOCALE_STORAGE } from "../i18n/locale.ts";
import { REPLAY_SETTINGS_STORAGE } from "../replay/replay-settings.ts";
import { ROOM_CAMERA_STORAGE } from "../room/room-camera-store.ts";
import { CONNECTION_STORAGE } from "../settings/settings.ts";
import { MAIN_VIEW_STORAGE, SHELL_STORAGE } from "../shell/shell-state.ts";
import type { StoredKey, StoredKind } from "../storage/local-store.ts";
import { COLOR_SCHEME_STORAGE } from "./color-scheme.ts";
import { KEYBINDINGS_STORAGE } from "./keybindings.ts";
import { UI_THEME_STORAGE } from "./ui-theme.ts";

export const SETTINGS_FORMAT = "my-screeps-client/settings";
export const SETTINGS_VERSION = 1;

/** 全部 `msc.*` 存储键（含不导出的运行状态），由各功能模块声明 */
export const STORED_KEYS: readonly StoredKey[] = [
  CONNECTION_STORAGE,
  LOCALE_STORAGE,
  UI_THEME_STORAGE,
  COLOR_SCHEME_STORAGE,
  KEYBINDINGS_STORAGE,
  ALLY_LIST_STORAGE,
  ALERT_SETTINGS_STORAGE,
  REPLAY_SETTINGS_STORAGE,
  SHELL_STORAGE,
  CONSOLE_SETTINGS_STORAGE,
  ROOM_CAMERA_STORAGE,
  /** 不导出的运行状态 */
  ALERT_MEMORY_STORAGE,
  MAIN_VIEW_STORAGE,
];

const EXPORTED = STORED_KEYS.filter((s) => s.role === "settings");

/** 导出范围：整键与前缀 */
export const SETTINGS_KEYS: readonly string[] = EXPORTED.filter((s) => !s.prefix).map((s) => s.key);
export const SETTINGS_PREFIXES: readonly string[] = EXPORTED.filter((s) => s.prefix).map((s) => s.key);

const CONNECTION_KEY = CONNECTION_STORAGE.key;

export type TransferStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export interface SettingsFile {
  readonly format: typeof SETTINGS_FORMAT;
  readonly version: number;
  readonly exportedAt: string;
  readonly settings: Record<string, unknown>;
}

export interface ImportReport {
  /** 写入的键 */
  readonly applied: readonly string[];
  /** 忽略的键（未知键、值的类型不对） */
  readonly ignored: readonly string[];
}

export type ImportFailure = "notSettings" | "newerVersion";

export class SettingsImportError extends Error {
  constructor(readonly reason: ImportFailure) {
    super(reason);
  }
}

/** 存储键对应的声明；不在任何声明范围内时为 undefined */
export function storedKeyOf(key: string): StoredKey | undefined {
  return STORED_KEYS.find((s) => (s.prefix ? key.startsWith(s.key) && key.length > s.key.length : key === s.key));
}

/** 导出范围内的键的值形态 */
function kindOf(key: string): StoredKind | undefined {
  const declared = storedKeyOf(key);
  return declared?.role === "settings" ? declared.kind : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fits(kind: StoredKind, value: unknown): boolean {
  switch (kind) {
    case "json-object":
      return isObject(value);
    case "json-array":
      return Array.isArray(value);
    case "json-string":
    case "raw":
      return typeof value === "string";
  }
}

function withoutToken(value: Record<string, unknown>): Record<string, unknown> {
  const { token: _token, ...rest } = value;
  return rest;
}

/** 本机存储里在登记范围内的键 */
function storedKeys(storage: TransferStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && kindOf(key) !== undefined) keys.push(key);
  }
  return keys.sort();
}

export function exportSettings(storage: TransferStorage, now: Date = new Date()): SettingsFile {
  const settings: Record<string, unknown> = {};
  for (const key of storedKeys(storage)) {
    const kind = kindOf(key)!;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    let value: unknown = raw;
    if (kind !== "raw") {
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    if (!fits(kind, value)) continue;
    settings[key] = key === CONNECTION_KEY ? withoutToken(value as Record<string, unknown>) : value;
  }
  return { format: SETTINGS_FORMAT, version: SETTINGS_VERSION, exportedAt: now.toISOString(), settings };
}

/** 校验通过才改动存储；不是设置文件或版本更新时抛 SettingsImportError，存储不变。 */
export function importSettings(storage: TransferStorage, file: unknown): ImportReport {
  if (!isObject(file) || file["format"] !== SETTINGS_FORMAT || !isObject(file["settings"])) {
    throw new SettingsImportError("notSettings");
  }
  const version = file["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new SettingsImportError("notSettings");
  if (version > SETTINGS_VERSION) throw new SettingsImportError("newerVersion");

  const accepted = new Map<string, string>();
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(file["settings"])) {
    const kind = kindOf(key);
    if (kind === undefined || !fits(kind, value)) {
      ignored.push(key);
      continue;
    }
    accepted.set(key, kind === "raw" ? (value as string) : JSON.stringify(value));
  }

  // token 只来自本机
  const connection = accepted.get(CONNECTION_KEY);
  let localToken: unknown;
  try {
    const local: unknown = JSON.parse(storage.getItem(CONNECTION_KEY) ?? "{}");
    localToken = isObject(local) ? local["token"] : undefined;
  } catch {
    localToken = undefined;
  }
  if (connection !== undefined) {
    const imported = withoutToken(JSON.parse(connection) as Record<string, unknown>);
    accepted.set(CONNECTION_KEY, JSON.stringify(typeof localToken === "string" && localToken ? { ...imported, token: localToken } : imported));
  }

  for (const key of storedKeys(storage)) {
    if (accepted.has(key)) continue;
    // 文件里没有连接设置时，保留本机的（至少 token 不能丢）
    if (key === CONNECTION_KEY) continue;
    storage.removeItem(key);
  }
  for (const [key, value] of accepted) storage.setItem(key, value);
  return { applied: [...accepted.keys()], ignored };
}
