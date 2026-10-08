/**
 * 浏览器本地存储的安全读写。存储不可用（隐私模式、被禁用、配额满）或内容损坏时，
 * 读回默认值、写入静默失败：各功能照常工作，只在本次会话内生效。
 */

/** 各功能需要的最小存储接口；测试里换成内存实现 */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** 页面的 localStorage；访问即抛错的环境下为 undefined */
export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readText(storage: KeyValueStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * 读 JSON 并交给 decode 做字段级校验。没有记录、解析失败、decode 抛错或返回 undefined 时
 * 返回 fallback。
 */
export function readJson<T>(
  storage: KeyValueStorage | undefined,
  key: string,
  decode: (value: unknown) => T | undefined,
  fallback: T,
): T {
  const raw = readText(storage, key);
  if (raw === null) return fallback;
  try {
    return decode(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeText(storage: KeyValueStorage | undefined, key: string, text: string): void {
  try {
    storage?.setItem(key, text);
  } catch {
    // 存储不可用：本次会话内仍生效
  }
}

export function writeJson(storage: KeyValueStorage | undefined, key: string, value: unknown): void {
  writeText(storage, key, JSON.stringify(value));
}

/** 删除一个键；存储不可用、不支持删除或抛错时静默（没什么可删的） */
export function removeKey(storage: (KeyValueStorage & Partial<Pick<Storage, "removeItem">>) | undefined, key: string): void {
  try {
    storage?.removeItem?.(key);
  } catch {
    // 存储不可用：没什么可删的
  }
}

/** 存储值的形态：json-* 存的是 JSON；raw 存的是原样字符串 */
export type StoredKind = "json-object" | "json-array" | "json-string" | "raw";

/**
 * 一个 `msc.*` 存储键的声明。各功能在自己的模块里声明并导出，
 * 设置导出 / 导入（customize/settings-transfer.ts）汇总全部声明。
 */
export interface StoredKey {
  readonly key: string;
  readonly kind: StoredKind;
  /** settings：用户设置，进导出 / 导入；runtime：运行状态，不导出、导入时也不动 */
  readonly role: "settings" | "runtime";
  /** true 时 key 是前缀，覆盖所有以它开头（且更长）的键 */
  readonly prefix?: boolean;
}

/** 普通对象（不含数组与 null） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
