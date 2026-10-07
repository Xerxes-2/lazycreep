/**
 * Attack Alert 的记忆（#4）：冷却、已告警的战斗与核弹、各 Shard 开始监视的基线。
 * 存在浏览器本地，按 Server 分键，刷新页面后沿用，保证“同一房间同一原因在冷却窗口内只告警一次”。
 *
 * 这是运行状态，不是用户设置：不进设置导出，导入设置时也不动它。
 * 每条记录带墙钟时刻，超过 ALERT_MEMORY_TTL_MS 的在读写时清掉。
 */
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

/** 每个 Server 一个键：前缀 + Server id */
export const ALERT_MEMORY_STORAGE: StoredKey = { key: "msc.alertState.", kind: "json-object", role: "runtime", prefix: true };

/**
 * 记录保留 7 天：远长于任何合理的冷却；核弹飞行 50000 Tick，Tick 不超过 12 秒时也在 7 天内落地。
 * 7 天没打开过的 Server 按首次打开处理。
 */
export const ALERT_MEMORY_TTL_MS = 7 * 24 * 3_600_000;

export interface AlertMemory {
  /** `shard/room/reason` → 上次告警时刻（墙钟毫秒） */
  readonly lastAlert: Map<string, number>;
  /** `shard/room` → 上次告警的 lastPvpTime 与告警时刻 */
  readonly pvpAlerted: Map<string, { readonly tick: number; readonly at: number }>;
  /** 核弹 id → 告警时刻 */
  readonly nukesAlerted: Map<string, number>;
  /**
   * Shard → 开始监视时的基线 Tick（since，这个 Tick 及以前的战斗不告警）与最近一次收到该 Shard PvP 数据的时刻（at）。
   * 没有记录的 Shard 即“首次打开”，见 alert-detector.ts 的 FRESH_PVP_TICKS。
   */
  readonly watched: Map<string, { readonly since: number; readonly at: number }>;
}

export function emptyAlertMemory(): AlertMemory {
  return { lastAlert: new Map(), pvpAlerted: new Map(), nukesAlerted: new Map(), watched: new Map() };
}

const keyOf = (serverId: string) => `${ALERT_MEMORY_STORAGE.key}${serverId}`;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fresh = (at: number, now: number) => now - at <= ALERT_MEMORY_TTL_MS;

function entries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

function decode(value: unknown, now: number): AlertMemory | undefined {
  if (!isRecord(value)) return undefined;
  const memory = emptyAlertMemory();
  for (const [key, at] of entries(value["lastAlert"])) if (finite(at) && fresh(at, now)) memory.lastAlert.set(key, at);
  for (const [key, entry] of entries(value["pvpAlerted"])) {
    if (!isRecord(entry) || !finite(entry["tick"]) || !finite(entry["at"]) || !fresh(entry["at"], now)) continue;
    memory.pvpAlerted.set(key, { tick: entry["tick"], at: entry["at"] });
  }
  for (const [id, at] of entries(value["nukesAlerted"])) if (finite(at) && fresh(at, now)) memory.nukesAlerted.set(id, at);
  for (const [shard, entry] of entries(value["watched"])) {
    if (!isRecord(entry) || !finite(entry["since"]) || !finite(entry["at"]) || !fresh(entry["at"], now)) continue;
    memory.watched.set(shard, { since: entry["since"], at: entry["at"] });
  }
  return memory;
}

export function loadAlertMemory(storage: KeyValueStorage | undefined, serverId: string, now: number): AlertMemory {
  return readJson(storage, keyOf(serverId), (v) => decode(v, now), emptyAlertMemory());
}

/** 清掉过期条目后写入 */
export function saveAlertMemory(storage: KeyValueStorage | undefined, serverId: string, memory: AlertMemory, now: number): void {
  const prune = <V>(map: Map<string, V>, at: (v: V) => number) => {
    for (const [key, value] of map) if (!fresh(at(value), now)) map.delete(key);
    return Object.fromEntries(map);
  };
  writeJson(storage, keyOf(serverId), {
    lastAlert: prune(memory.lastAlert, (at) => at),
    pvpAlerted: prune(memory.pvpAlerted, (e) => e.at),
    nukesAlerted: prune(memory.nukesAlerted, (at) => at),
    watched: prune(memory.watched, (e) => e.at),
  });
}
