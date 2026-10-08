/**
 * 选中对象的详情：把房间对象整理成“标签 → 值”的行，界面只负责翻译标签与排版。
 * 认识的字段整理成可读形式；不认识的字段按原始键值列出，什么都不丢。
 */
import type { RoomUser } from "../source/source.ts";
import { BODY_PART_COLORS } from "./official-creeps.ts";
import type { RoomObject } from "./room-state.ts";

export type DetailKey =
  | "type"
  | "owner"
  | "name"
  | "position"
  | "hits"
  | "ticksToLive"
  | "body"
  | "store"
  | "energy"
  | "mineral"
  | "level"
  | "progress"
  | "downgrade"
  | "spawning"
  | "fatigue"
  | "decay"
  | "cooldown"
  | "died"
  | "deathCause"
  | "lived"
  | "saying"
  | "creepId";

export interface DetailField {
  readonly key: DetailKey;
  readonly value: string;
  /** 需要翻译的值：界面按 `roomDetails.value.<key>` 与参数格式化，value 只作退路 */
  readonly text?: { readonly key: string; readonly params?: Readonly<Record<string, string | number>> };
}

export interface ObjectDetails {
  readonly id: string;
  readonly fields: readonly DetailField[];
  /** 未整理的字段：[键, 原始值的文本] */
  readonly raw: ReadonlyArray<readonly [string, string]>;
  /** 有 body 时的部件网格（#59）；文字汇总在 `body` 字段 */
  readonly body?: readonly BodyCell[];
}

/** 已经在 fields 里展示（或纯内部）的字段，不再出现在 raw 里 */
const KNOWN = new Set([
  "_id",
  "type",
  "room",
  "x",
  "y",
  "user",
  "name",
  "hits",
  "hitsMax",
  "ageTime",
  "ticksToLive",
  "body",
  "store",
  "storeCapacity",
  "storeCapacityResource",
  "energy",
  "energyCapacity",
  "mineralType",
  "mineralAmount",
  "level",
  "progress",
  "progressTotal",
  "downgradeTime",
  "spawning",
  "fatigue",
  "decayTime",
  "nextDecayTime",
  "cooldownTime",
  // 墓碑
  "deathTime",
  "creepId",
  "creepName",
  "creepTicksToLive",
  "creepBody",
  "creepSaying",
]);

/** creep 的寿命（CREEP_LIFE_TIME）；带 CLAIM 部件的是 CREEP_CLAIM_LIFE_TIME */
const CREEP_LIFE_TIME = 1500;
const CREEP_CLAIM_LIFE_TIME = 600;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 部件网格的一格（#59）：按 body 顺序，第一格是最先挨打的部件 */
export interface BodyCell {
  readonly type: string;
  /** 剩余血量（满血 100）；墓碑里的 body 只有类型，血量未知 */
  readonly hits?: number;
  /** 填充比例 hits / 100，夹在 0…1 */
  readonly fill: number;
  /** 部件颜色（`#rrggbb`），与 Room View 身体环同一张表 */
  readonly color: string;
  /** 强化矿物 */
  readonly boost?: string;
}

/** 网格每行 10 格，最多 5 行（MAX_CREEP_SIZE = 50） */
export const BODY_GRID_COLUMNS = 10;
const MAX_BODY_SIZE = 50;
const PART_HITS = 100;
const UNKNOWN_PART_COLOR = 0x999999;

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** body 可能是数组或官方 safeBody 的 `{ "0": {...} }` */
export function bodyCells(body: unknown): BodyCell[] {
  if (typeof body !== "object" || body === null) return [];
  const list = Array.isArray(body)
    ? body
    : Object.keys(body)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => (body as Record<string, unknown>)[k]);
  const cells: BodyCell[] = [];
  for (const part of list.slice(0, MAX_BODY_SIZE)) {
    if ((typeof part !== "object" || part === null) && typeof part !== "string") continue;
    // 墓碑的 creepBody 是类型字符串的数组：血量未知，画成满格
    const { type, hits, boost } = (typeof part === "string" ? { type: part } : part) as Record<string, unknown>;
    if (typeof type !== "string") continue;
    const h = typeof part === "string" ? undefined : isNum(hits) ? Math.max(0, hits) : 0;
    cells.push({
      type,
      ...(h === undefined ? {} : { hits: h }),
      fill: h === undefined ? 1 : Math.min(1, h / PART_HITS),
      color: hex(BODY_PART_COLORS[type] ?? UNKNOWN_PART_COLOR),
      ...(typeof boost === "string" && boost !== "" ? { boost } : {}),
    });
  }
  return cells;
}

const PART_ABBREVIATIONS: Readonly<Record<string, string>> = {
  tough: "T",
  work: "W",
  carry: "C",
  move: "M",
  attack: "A",
  ranged_attack: "R",
  heal: "H",
  claim: "CL",
};

/** 缩写计数，例如 `5W 3C 8M`；按 body 中首次出现的顺序 */
export function bodySummary(cells: readonly BodyCell[]): string {
  const counts = new Map<string, number>();
  for (const { type } of cells) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n}${PART_ABBREVIATIONS[type] ?? type}`).join(" ");
}

function storeSummary(obj: RoomObject): string | undefined {
  const store = obj["store"];
  if (typeof store !== "object" || store === null) return undefined;
  const items = Object.entries(store).filter(([, v]) => isNum(v) && v > 0);
  let capacity = isNum(obj["storeCapacity"]) ? obj["storeCapacity"] : undefined;
  const perResource = obj["storeCapacityResource"];
  if (!capacity && typeof perResource === "object" && perResource !== null) {
    capacity = Object.values(perResource).reduce<number>((sum, v) => sum + (isNum(v) ? v : 0), 0) || undefined;
  }
  const content = items.length > 0 ? items.map(([k, v]) => `${k} ${v}`).join(", ") : "0";
  return capacity ? `${content} / ${capacity}` : content;
}

/**
 * 墓碑（死去的 creep）：死于几 Tick 前、推断死因、活了多久、最后说的话。
 * 推断：死时剩余寿命为 1（官方老死那一 Tick 留下的值）算寿终，否则是提前死亡（被杀、自杀或被回收，墓碑分不出）。
 * 寿命按 body 有无 CLAIM 取 600 或 1500；活了多久 = 寿命 − 死时剩余寿命（孵化期间不计）。
 */
function tombstoneFields(
  obj: RoomObject,
  body: readonly BodyCell[],
  gameTime: number | undefined,
  add: (key: DetailKey, value: string | undefined, text?: DetailField["text"]) => void,
) {
  const deathTime = obj["deathTime"];
  if (isNum(deathTime)) {
    const ago = gameTime !== undefined ? gameTime - deathTime : undefined;
    add(
      "died",
      ago !== undefined ? `${ago} (${deathTime})` : String(deathTime),
      ago !== undefined ? { key: "diedAgo", params: { ago, tick: deathTime } } : { key: "diedAt", params: { tick: deathTime } },
    );
  }
  const left = obj["creepTicksToLive"];
  if (isNum(left)) {
    add("deathCause", left <= 1 ? "aged" : "early", left <= 1 ? { key: "aged" } : { key: "early", params: { left } });
    if (body.length > 0) {
      const lifetime = body.some((cell) => cell.type === "claim") ? CREEP_CLAIM_LIFE_TIME : CREEP_LIFE_TIME;
      add("lived", `${Math.max(0, lifetime - left)} / ${lifetime}`);
    }
  }
  const saying = obj["creepSaying"];
  if (typeof saying === "string") add("saying", saying);
  else if (typeof saying === "object" && saying !== null && typeof (saying as Record<string, unknown>)["message"] === "string") {
    add("saying", (saying as Record<string, unknown>)["message"] as string);
  }
  add("creepId", typeof obj["creepId"] === "string" ? obj["creepId"] : undefined);
}

function rawText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function describeObject(
  obj: RoomObject,
  users: Readonly<Record<string, RoomUser>>,
  gameTime: number | undefined,
): ObjectDetails {
  const fields: DetailField[] = [];
  const add = (key: DetailKey, value: string | undefined, text?: DetailField["text"]) => {
    if (value !== undefined && value !== "") fields.push({ key, value, ...(text ? { text } : {}) });
  };
  const until = (time: unknown) => (isNum(time) && gameTime !== undefined ? String(time - gameTime) : undefined);
  const ratio = (a: unknown, b: unknown) => (isNum(a) ? (isNum(b) ? `${a} / ${b}` : String(a)) : undefined);

  add("type", typeof obj["type"] === "string" ? obj["type"] : undefined);
  const user = obj["user"];
  if (typeof user === "string") add("owner", users[user]?.username ?? user);
  add("name", typeof obj["name"] === "string" ? obj["name"] : typeof obj["creepName"] === "string" ? obj["creepName"] : undefined);
  if (isNum(obj["x"]) && isNum(obj["y"])) add("position", `${obj["x"]}, ${obj["y"]}`);
  add("hits", ratio(obj["hits"], obj["hitsMax"]));
  add("ticksToLive", isNum(obj["ticksToLive"]) ? String(obj["ticksToLive"]) : until(obj["ageTime"]));
  const body = bodyCells(obj["body"] ?? obj["creepBody"]);
  if (body.length > 0) add("body", bodySummary(body));
  add("store", storeSummary(obj));
  add("energy", ratio(obj["energy"], obj["energyCapacity"]));
  if (typeof obj["mineralType"] === "string") {
    add("mineral", isNum(obj["mineralAmount"]) ? `${obj["mineralType"]} ${obj["mineralAmount"]}` : obj["mineralType"]);
  }
  add("level", isNum(obj["level"]) ? String(obj["level"]) : undefined);
  add("progress", isNum(obj["progressTotal"]) ? ratio(obj["progress"], obj["progressTotal"]) : undefined);
  add("downgrade", until(obj["downgradeTime"]));
  const spawning = obj["spawning"];
  if (typeof spawning === "object" && spawning !== null) {
    const s = spawning as Record<string, unknown>;
    const left = until(s["spawnTime"]);
    add("spawning", `${typeof s["name"] === "string" ? s["name"] : "?"}${left !== undefined ? ` (${left})` : ""}`);
  }
  add("fatigue", isNum(obj["fatigue"]) && obj["fatigue"] > 0 ? String(obj["fatigue"]) : undefined);
  add("decay", until(obj["nextDecayTime"] ?? obj["decayTime"]));
  const cooldown = until(obj["cooldownTime"]);
  add("cooldown", cooldown !== undefined && Number(cooldown) > 0 ? cooldown : undefined);
  tombstoneFields(obj, body, gameTime, add);

  const raw = Object.entries(obj)
    .filter(([key]) => !KNOWN.has(key))
    .map(([key, value]) => [key, rawText(value)] as const);

  return { id: String(obj["_id"] ?? ""), fields, raw, ...(body.length > 0 ? { body } : {}) };
}
