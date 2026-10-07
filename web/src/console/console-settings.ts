/**
 * Console 面板的偏好（#6）：每个 Shard 保留的条数、每个 Server 固定的 Shard。
 * 存在浏览器本地；存储不可用时只在内存里生效。
 */
import { createSignal, type Accessor } from "solid-js";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import { DEFAULT_CONSOLE_LIMIT } from "./console-log.ts";

const STORAGE_KEY = "msc.console";
export const CONSOLE_SETTINGS_STORAGE: StoredKey = { key: STORAGE_KEY, kind: "json-object", role: "settings" };
export const MAX_CONSOLE_LIMIT = 5000;

interface Stored {
  readonly limit: number;
  /** Server id → 固定的 Shard；没有的跟随当前 Shard */
  readonly pinned: Readonly<Record<string, string>>;
}

export interface ConsoleSettings {
  readonly limit: Accessor<number>;
  setLimit(limit: number): void;
  pinned(serverId: string): string | undefined;
  /** undefined 表示跟随当前 Shard */
  setPinned(serverId: string, shard: string | undefined): void;
}

function clampLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_CONSOLE_LIMIT;
  return Math.min(MAX_CONSOLE_LIMIT, Math.max(1, n));
}

function decode(value: unknown): Stored | undefined {
  if (!isRecord(value)) return undefined;
  const pinned = isRecord(value["pinned"])
    ? Object.fromEntries(Object.entries(value["pinned"]).filter(([, v]) => typeof v === "string"))
    : {};
  return { limit: clampLimit(value["limit"]), pinned: pinned as Record<string, string> };
}

const DEFAULTS: Stored = { limit: DEFAULT_CONSOLE_LIMIT, pinned: {} };

export function createConsoleSettings(storage: KeyValueStorage | undefined): ConsoleSettings {
  const [stored, setStored] = createSignal<Stored>(readJson(storage, STORAGE_KEY, decode, DEFAULTS));
  const update = (change: Partial<Stored>) => {
    const next = { ...stored(), ...change };
    setStored(next);
    writeJson(storage, STORAGE_KEY, next);
  };
  return {
    limit: () => stored().limit,
    setLimit: (limit) => update({ limit: clampLimit(limit) }),
    pinned: (serverId) => stored().pinned[serverId],
    setPinned: (serverId, shard) => {
      const pinned = { ...stored().pinned };
      if (shard === undefined) delete pinned[serverId];
      else pinned[serverId] = shard;
      update({ pinned });
    },
  };
}
