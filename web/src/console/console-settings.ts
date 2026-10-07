/**
 * Console 面板的偏好（#6）：每个 Shard 保留的条数、每个 Server 固定的 Shard。
 * 存在浏览器本地；存储不可用时只在内存里生效。
 */
import { createSignal, type Accessor } from "solid-js";
import type { SettingsStorage } from "../settings/settings.ts";
import { DEFAULT_CONSOLE_LIMIT } from "./console-log.ts";

const STORAGE_KEY = "msc.console";
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

function read(storage: SettingsStorage | undefined): Stored {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<keyof Stored, unknown>>) : {};
    const pinned =
      typeof parsed.pinned === "object" && parsed.pinned !== null
        ? Object.fromEntries(Object.entries(parsed.pinned).filter(([, v]) => typeof v === "string"))
        : {};
    return { limit: clampLimit(parsed.limit), pinned: pinned as Record<string, string> };
  } catch {
    return { limit: DEFAULT_CONSOLE_LIMIT, pinned: {} };
  }
}

export function createConsoleSettings(storage: SettingsStorage | undefined): ConsoleSettings {
  const [stored, setStored] = createSignal<Stored>(read(storage));
  const update = (change: Partial<Stored>) => {
    const next = { ...stored(), ...change };
    setStored(next);
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用：只在内存里生效
    }
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
