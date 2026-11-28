/**
 * map-stats 的客户端额度记录（ownership-loader.ts）按 Server 存进本地存储：
 * 服务器的额度（每 Server 每小时 60 次）跨页面刷新累计，客户端的计数若只在内存里，
 * 每次刷新都会清零、以为额度还够，反复刷新就会把服务器的额度用完而被限流。
 * 多个标签页共用同一份记录（加载器每次判断额度前重新读）。
 */
import { isOfficialServer } from "../source/servers.ts";
import type { ServerConfig } from "../source/source.ts";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import type { OwnershipLoaderOptions } from "./ownership-loader.ts";

/** 每个 Server 一个键：`msc.mapStatsBudget.<server id>` */
export const OWNERSHIP_BUDGET_STORAGE: StoredKey = {
  key: "msc.mapStatsBudget.",
  kind: "json-object",
  role: "runtime",
  prefix: true,
};

export interface OwnershipBudgetState {
  /** 最近一小时内发出请求的时间（Unix 毫秒，升序） */
  readonly sent: readonly number[];
  /** 被限流后暂停到这个时间（Unix 毫秒）；0 表示没有 */
  readonly blockedUntil: number;
}

export interface OwnershipBudgetStore {
  load(): OwnershipBudgetState;
  save(state: OwnershipBudgetState): void;
}

const EMPTY: OwnershipBudgetState = { sent: [], blockedUntil: 0 };
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function decode(value: unknown): OwnershipBudgetState | undefined {
  if (!isRecord(value) || !Array.isArray(value["sent"]) || !isTime(value["blockedUntil"])) return undefined;
  return { sent: value["sent"].filter(isTime).sort((a, b) => a - b), blockedUntil: value["blockedUntil"] };
}

export function ownershipBudgetStore(storage: KeyValueStorage | undefined, serverId: string): OwnershipBudgetStore {
  const key = OWNERSHIP_BUDGET_STORAGE.key + serverId;
  return {
    load: () => readJson(storage, key, decode, EMPTY),
    save: (state) => writeJson(storage, key, state),
  };
}

/**
 * 按官服 / 私服（servers.ts 的 isOfficialServer）给所有权加载器的限额选项。
 * - 官服：每小时 60 次是服务器的限额，加载器默认自限 30 次；给了 storage 时额度记录持久化（见上）
 * - 私服：没有这个限额，套上它反复刷新几次所有权就不再来，也就不必为省额度把缓存放长：不限次数、一分钟一刷。
 *   429 照样退避
 */
export function ownershipLimits(
  server: Pick<ServerConfig, "id">,
  storage?: KeyValueStorage,
): Pick<OwnershipLoaderOptions, "budget" | "maxPerHour" | "ttlMs" | "backgroundTtlMs"> {
  if (!isOfficialServer(server)) return { maxPerHour: Infinity, ttlMs: 60_000, backgroundTtlMs: 60_000 };
  return storage ? { budget: ownershipBudgetStore(storage, server.id) } : {};
}
