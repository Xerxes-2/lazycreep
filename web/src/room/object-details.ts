/**
 * 选中对象的详情：把房间对象整理成“标签 → 值”的行，界面只负责翻译标签与排版。
 * 认识的字段整理成可读形式；不认识的字段按原始键值列出，什么都不丢。
 */
import type { RoomUser } from "../source/source.ts";
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
  | "cooldown";

export interface DetailField {
  readonly key: DetailKey;
  readonly value: string;
}

export interface ObjectDetails {
  readonly id: string;
  readonly fields: readonly DetailField[];
  /** 未整理的字段：[键, 原始值的文本] */
  readonly raw: ReadonlyArray<readonly [string, string]>;
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
]);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function bodySummary(body: unknown): string | undefined {
  if (!Array.isArray(body) || body.length === 0) return undefined;
  const groups = new Map<string, { count: number; boosts: Map<string, number>; broken: number }>();
  for (const part of body) {
    const type = typeof part === "string" ? part : typeof part?.type === "string" ? part.type : "?";
    const group = groups.get(type) ?? { count: 0, boosts: new Map(), broken: 0 };
    group.count++;
    if (typeof part === "object" && part !== null) {
      if (typeof part.boost === "string") group.boosts.set(part.boost, (group.boosts.get(part.boost) ?? 0) + 1);
      if (part.hits === 0) group.broken++;
    }
    groups.set(type, group);
  }
  return [...groups]
    .map(([type, g]) => {
      const notes = [...g.boosts].map(([boost, n]) => `${boost} ×${n}`);
      if (g.broken > 0) notes.push(`0 HP ×${g.broken}`);
      return `${type} ×${g.count}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
    })
    .join(", ");
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
  const add = (key: DetailKey, value: string | undefined) => {
    if (value !== undefined && value !== "") fields.push({ key, value });
  };
  const until = (time: unknown) => (isNum(time) && gameTime !== undefined ? String(time - gameTime) : undefined);
  const ratio = (a: unknown, b: unknown) => (isNum(a) ? (isNum(b) ? `${a} / ${b}` : String(a)) : undefined);

  add("type", typeof obj["type"] === "string" ? obj["type"] : undefined);
  const user = obj["user"];
  if (typeof user === "string") add("owner", users[user]?.username ?? user);
  add("name", typeof obj["name"] === "string" ? obj["name"] : undefined);
  if (isNum(obj["x"]) && isNum(obj["y"])) add("position", `${obj["x"]}, ${obj["y"]}`);
  add("hits", ratio(obj["hits"], obj["hitsMax"]));
  add("ticksToLive", isNum(obj["ticksToLive"]) ? String(obj["ticksToLive"]) : until(obj["ageTime"]));
  add("body", bodySummary(obj["body"]));
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

  const raw = Object.entries(obj)
    .filter(([key]) => !KNOWN.has(key))
    .map(([key, value]) => [key, rawText(value)] as const);

  return { id: String(obj["_id"] ?? ""), fields, raw };
}
