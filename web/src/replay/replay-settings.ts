/**
 * Replay 的本地设置：历史缓存上限（MB）。单独存一个键，不并进连接设置。
 * 还有全页共用的一个历史缓存实例（按需打开，IndexedDB 不可用时为 undefined）。
 */
import { createSignal, type Accessor } from "solid-js";
import { DEFAULT_CACHE_LIMIT_MB, openHistoryCache, type HistoryCache } from "./history-cache.ts";

const STORAGE_KEY = "msc.replay";
const MB = 1024 * 1024;

export type ReplaySettingsStorage = Pick<Storage, "getItem" | "setItem">;

export interface ReplaySettings {
  readonly cacheLimitMb: Accessor<number>;
  /** 非正数或非数字时忽略 */
  setCacheLimitMb(mb: number): void;
}

export function mbToBytes(mb: number): number {
  return Math.round(mb * MB);
}

function readLimit(storage: ReplaySettingsStorage | undefined): number {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}") as { cacheLimitMb?: unknown };
    const mb = parsed.cacheLimitMb;
    return typeof mb === "number" && mb > 0 ? mb : DEFAULT_CACHE_LIMIT_MB;
  } catch {
    return DEFAULT_CACHE_LIMIT_MB;
  }
}

export function createReplaySettings(storage: ReplaySettingsStorage | undefined): ReplaySettings {
  const [cacheLimitMb, setLimit] = createSignal(readLimit(storage));
  return {
    cacheLimitMb,
    setCacheLimitMb(mb) {
      if (!Number.isFinite(mb) || mb <= 0) return;
      setLimit(mb);
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify({ cacheLimitMb: mb }));
      } catch {
        // 存储不可用时本次会话内仍生效。
      }
    },
  };
}

export function browserReplayStorage(): ReplaySettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

let shared: Promise<HistoryCache | undefined> | undefined;

/** 全页共用的历史缓存；首次调用时按本地设置的上限打开。 */
export function sharedHistoryCache(): Promise<HistoryCache | undefined> {
  shared ??= (async () => {
    let factory: IDBFactory | undefined;
    try {
      factory = globalThis.indexedDB;
    } catch {
      factory = undefined;
    }
    const limitBytes = mbToBytes(readLimit(browserReplayStorage()));
    return openHistoryCache({ indexedDB: factory, limitBytes }).catch(() => undefined);
  })();
  return shared;
}
