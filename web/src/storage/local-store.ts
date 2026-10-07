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

/** 普通对象（不含数组与 null） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
