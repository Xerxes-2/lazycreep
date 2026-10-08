/**
 * map-stats 的客户端额度记录（ownership-loader.ts）按 Server 存进本地存储：
 * 服务器的额度（每 Server 每小时 60 次）跨页面刷新累计，客户端的计数若只在内存里，
 * 每次刷新都会清零、以为额度还够，反复刷新就会把服务器的额度用完而被限流。
 * 多个标签页共用同一份记录（加载器每次判断额度前重新读）。
 */
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

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
