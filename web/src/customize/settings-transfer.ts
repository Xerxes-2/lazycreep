/**
 * 设置导出 / 导入（#5）：把浏览器本地的全部 `msc.*` 设置打包成一个 JSON 文件，在另一个浏览器还原。
 *
 * - 覆盖范围是下面的登记表（SETTINGS_KEYS / SETTINGS_PREFIXES）；新增存储键时在这里加一行，
 *   测试会扫描源码里的 `msc.*` 字面量，漏登记时报错。
 * - 不含 token：导出时从 `msc.settings` 去掉；导入时忽略文件里的 token，保留本机已有的 token。
 * - 导入是“还原”：登记范围内、文件里没有的本机键会被删掉；未知键与类型不对的值忽略并报告。
 *   每个功能读存储时自己再做一遍字段级校验，所以这里只校验到值的类型。
 * - 导入只写存储；让页面生效由调用方负责（App 重建整个界面，见 App.tsx）。
 */

export const SETTINGS_FORMAT = "my-screeps-client/settings";
export const SETTINGS_VERSION = 1;

/** 值的形态：json-* 存的是 JSON；raw 存的是原样字符串 */
type Kind = "json-object" | "json-array" | "json-string" | "raw";

const KEYS = {
  /** Server 列表、所选 Server、各 Server 的 Shard（token 另行处理） */
  "msc.settings": "json-object",
  "msc.locale": "raw",
  "msc.uiTheme": "json-string",
  "msc.colors": "json-object",
  "msc.keys": "json-object",
  "msc.allies": "json-array",
  "msc.alerts": "json-object",
  "msc.replay": "json-object",
  "msc.layout.desktop": "json-object",
  "msc.layout.monitor": "json-object",
  /** Console 面板的跟随 Shard、过滤与上限（#6） */
  "msc.console": "json-object",
} as const satisfies Record<string, Kind>;

const PREFIXES = {
  /** Room View 每个房间的视口 */
  "msc.roomCamera.": "json-object",
} as const satisfies Record<string, Kind>;

export const SETTINGS_KEYS = Object.keys(KEYS) as readonly (keyof typeof KEYS)[];
export const SETTINGS_PREFIXES = Object.keys(PREFIXES) as readonly string[];

const CONNECTION_KEY = "msc.settings";

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

function kindOf(key: string): Kind | undefined {
  if (key in KEYS) return KEYS[key as keyof typeof KEYS];
  const prefix = SETTINGS_PREFIXES.find((p) => key.startsWith(p) && key.length > p.length);
  return prefix === undefined ? undefined : PREFIXES[prefix as keyof typeof PREFIXES];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fits(kind: Kind, value: unknown): boolean {
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
