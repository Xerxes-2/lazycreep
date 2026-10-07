/**
 * Console 面板的日志（#6）：把 Console 频道的事件拆成条目，按 Shard 归类，
 * 每个 Shard 只保留最近 limit 条。纯数据，没有新条目时沿用旧引用。
 */
import type { ConsoleEvent } from "../source/source.ts";

/** 默认每个 Shard 保留的条数 */
export const DEFAULT_CONSOLE_LIMIT = 500;

export interface ConsoleEntry {
  /** 全日志内唯一，按到达递增 */
  readonly id: number;
  readonly shard: string | null;
  /** log：脚本输出；result：命令的返回值；error：脚本或命令的错误 */
  readonly kind: "log" | "result" | "error";
  readonly text: string;
}

export interface ConsoleLog {
  /** 出现过输出的 Shard，按首次出现排序；不分 Shard 的 Server 为 null */
  readonly shards: readonly (string | null)[];
  readonly byShard: ReadonlyMap<string | null, readonly ConsoleEntry[]>;
  readonly nextId: number;
}

export function emptyConsoleLog(): ConsoleLog {
  return { shards: [], byShard: new Map(), nextId: 0 };
}

export function appendConsole(log: ConsoleLog, event: ConsoleEvent, limit: number): ConsoleLog {
  const parts: { kind: ConsoleEntry["kind"]; text: string }[] =
    event.kind === "error"
      ? [{ kind: "error", text: event.error }]
      : [
          ...event.log.map((text) => ({ kind: "log" as const, text })),
          ...event.results.map((text) => ({ kind: "result" as const, text })),
        ];
  if (parts.length === 0) return log;
  let nextId = log.nextId;
  const added = parts.map((p) => ({ id: nextId++, shard: event.shard, ...p }));
  const previous = log.byShard.get(event.shard) ?? [];
  const keep = Math.max(1, Math.floor(limit));
  const entries = [...previous, ...added].slice(-keep);
  const byShard = new Map(log.byShard);
  byShard.set(event.shard, entries);
  const shards = log.byShard.has(event.shard) ? log.shards : [...log.shards, event.shard];
  return { shards, byShard, nextId };
}

export interface ConsoleFilter {
  readonly shard: string | null;
  /** 不分大小写的子串；空白时不过滤 */
  readonly keyword: string;
}

export function filterConsole(log: ConsoleLog, filter: ConsoleFilter): readonly ConsoleEntry[] {
  const entries = log.byShard.get(filter.shard) ?? [];
  const keyword = filter.keyword.trim().toLowerCase();
  if (!keyword) return entries;
  return entries.filter((e) => e.text.toLowerCase().includes(keyword));
}
