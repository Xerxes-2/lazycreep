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
  | "lifeLeft"
  | "saying"
  | "creepId"
  | "destroyed"
  | "structureType"
  | "structureHitsMax"
  | "structureOwner"
  | "structureId"
  | "streak"
  | "fuelLeft";

type AddField = (key: DetailKey, value: string | undefined, text?: DetailField["text"]) => void;

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
  // 废墟
  "destroyTime",
  "structure",
  // 赛季 reactor
  "launchTime",
]);

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

/** 发生在几 Tick 前（Tick 未知时只给发生的 Tick） */
function happened(time: number, gameTime: number | undefined): Pick<DetailField, "value" | "text"> {
  return gameTime !== undefined
    ? { value: `${gameTime - time} (${time})`, text: { key: "ago", params: { ago: gameTime - time, tick: time } } }
    : { value: String(time), text: { key: "at", params: { tick: time } } };
}

/** 墓碑（死去的 creep）：死于几 Tick 前、死前剩余寿命、最后说的话、原 creep id；名字与生前 body 在通用字段里 */
function tombstoneFields(obj: RoomObject, gameTime: number | undefined, add: AddField) {
  const deathTime = obj["deathTime"];
  if (isNum(deathTime)) {
    const { value, text } = happened(deathTime, gameTime);
    add("died", value, text);
  }
  add("lifeLeft", isNum(obj["creepTicksToLive"]) ? String(obj["creepTicksToLive"]) : undefined);
  const saying = obj["creepSaying"];
  if (typeof saying === "string") add("saying", saying);
  else if (typeof saying === "object" && saying !== null && typeof (saying as Record<string, unknown>)["message"] === "string") {
    add("saying", (saying as Record<string, unknown>)["message"] as string);
  }
  add("creepId", typeof obj["creepId"] === "string" ? obj["creepId"] : undefined);
}

/** 废墟（被毁的建筑）：毁于几 Tick 前、原建筑的类型、血量上限与 id；废墟没有主人时用原建筑的主人 */
function ruinFields(obj: RoomObject, users: Readonly<Record<string, RoomUser>>, gameTime: number | undefined, add: AddField) {
  const destroyTime = obj["destroyTime"];
  if (isNum(destroyTime)) {
    const { value, text } = happened(destroyTime, gameTime);
    add("destroyed", value, text);
  }
  const structure = obj["structure"];
  if (typeof structure !== "object" || structure === null) return;
  const s = structure as Record<string, unknown>;
  add("structureType", typeof s["type"] === "string" ? s["type"] : undefined);
  add("structureHitsMax", isNum(s["hitsMax"]) ? String(s["hitsMax"]) : undefined);
  if (typeof obj["user"] !== "string" && typeof s["user"] === "string") add("structureOwner", users[s["user"]]?.username ?? s["user"]);
  add("structureId", typeof s["id"] === "string" ? s["id"] : undefined);
}

/**
 * 赛季 reactor：连续运转了多少 Tick（当前 Tick − launchTime；没在运转时 launchTime 为 null），
 * 运转中还能撑多少 Tick（每 Tick 烧 1 个钍 T，实测）。
 */
function reactorFields(obj: RoomObject, gameTime: number | undefined, add: AddField) {
  if (obj["type"] !== "reactor" || !("launchTime" in obj)) return;
  const launchTime = obj["launchTime"];
  if (!isNum(launchTime)) {
    add("streak", "idle", { key: "idle" });
    return;
  }
  if (gameTime !== undefined) {
    const streak = gameTime - launchTime;
    add("streak", `${streak} (${launchTime})`, { key: "since", params: { ticks: streak, tick: launchTime } });
  } else add("streak", String(launchTime), { key: "sinceTick", params: { tick: launchTime } });
  const store = obj["store"];
  const fuel = typeof store === "object" && store !== null ? (store as Record<string, unknown>)["T"] : undefined;
  add("fuelLeft", isNum(fuel) ? String(fuel) : undefined);
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
  const add: AddField = (key, value, text) => {
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
  tombstoneFields(obj, gameTime, add);
  ruinFields(obj, users, gameTime, add);
  reactorFields(obj, gameTime, add);

  const raw = Object.entries(obj)
    .filter(([key]) => !KNOWN.has(key))
    .map(([key, value]) => [key, rawText(value)] as const);

  return { id: String(obj["_id"] ?? ""), fields, raw, ...(body.length > 0 ? { body } : {}) };
}
