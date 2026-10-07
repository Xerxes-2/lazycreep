/**
 * `fixtures/` 录制文件的格式。fixture 保存的是服务器原样返回的数据（wire 格式）加元数据，
 * 由 Source 实现负责把它们转换成 Source 接口的类型，所以回放也会经过同一套转换。
 * 录制脚本（scripts/record-fixtures.ts）与 FixtureSource 共用这些类型。
 */
import type { ServerConfig } from "./source.ts";

export const FIXTURE_FORMAT_VERSION = 1;

export type FixtureKind =
  | "room"
  | "roomMap2"
  | "console"
  | "history"
  | "pvp"
  | "nukes"
  | "time"
  | "shards"
  | "terrain"
  | "me";

export interface FixtureMeta<K extends FixtureKind = FixtureKind> {
  readonly format: typeof FIXTURE_FORMAT_VERSION;
  readonly kind: K;
  /** ISO 8601 */
  readonly recordedAt: string;
  readonly server: ServerConfig;
  /** 录制时实际请求的源站，例如 https://screeps.com */
  readonly origin: string;
  readonly shard?: string;
  readonly room?: string;
  /** 首尾 Tick（含） */
  readonly tickRange?: readonly [number, number];
  readonly note?: string;
}

/** 流里的一帧；at 为相对录制开始的毫秒数。 */
export interface StreamFrame<T> {
  readonly at: number;
  readonly data: T;
}

// ---- wire 格式（只声明用到的字段） ----

export interface WireRoomPayload {
  readonly gameTime?: number;
  readonly objects?: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>;
  readonly users?: Readonly<Record<string, { readonly _id: string; readonly username: string }>> | null;
  readonly visual?: string;
  readonly [key: string]: unknown;
}

export type WireRoomMap = Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;

export interface WireConsole {
  readonly messages?: { readonly log: readonly string[]; readonly results: readonly string[] };
  readonly error?: string;
  readonly shard?: string | null;
}

export interface WireHistoryChunk {
  readonly timestamp: number;
  readonly room: string;
  readonly base: number;
  readonly ticks: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>> | null>>>>;
}

export interface WirePvp {
  readonly pvp: Readonly<
    Record<string, { readonly time: number; readonly rooms: ReadonlyArray<{ readonly _id: string; readonly lastPvpTime: number }> }>
  >;
}

export interface WireNukes {
  readonly nukes: Readonly<
    Record<
      string,
      ReadonlyArray<{
        readonly _id: string;
        readonly room: string;
        readonly x: number;
        readonly y: number;
        readonly landTime: number;
        readonly launchRoomName: string;
      }>
    >
  >;
}

export interface WireTime {
  readonly time: number;
}

export interface WireShards {
  readonly shards: ReadonlyArray<{ readonly name: string; readonly rooms: number; readonly users: number; readonly tick: number }>;
}

export interface WireTerrain {
  readonly terrain: ReadonlyArray<{ readonly room: string; readonly terrain: string }>;
}

/** `user/find` 只保留 _id 与 username；`user/rooms` 原样。 */
export interface WireMe {
  readonly user: { readonly _id: string; readonly username: string };
  readonly rooms: { readonly shards: Readonly<Record<string, readonly string[]>> };
}

// ---- 文件 ----

export interface StreamFixture<K extends "room" | "roomMap2" | "console", T> {
  readonly meta: FixtureMeta<K>;
  readonly frames: ReadonlyArray<StreamFrame<T>>;
}

export interface ResponseFixture<K extends FixtureKind, T> {
  readonly meta: FixtureMeta<K>;
  /** HTTP 状态码；非 2xx 时 body 为 null */
  readonly status: number;
  readonly body: T | null;
}

export type RoomFixture = StreamFixture<"room", WireRoomPayload>;
export type RoomMapFixture = StreamFixture<"roomMap2", WireRoomMap>;
export type ConsoleFixture = StreamFixture<"console", WireConsole>;
export type HistoryFixture = ResponseFixture<"history", WireHistoryChunk> & {
  readonly meta: { readonly shard: string; readonly room: string; readonly base: number };
};
export type PvpFixture = ResponseFixture<"pvp", WirePvp> & { readonly meta: { readonly interval: number } };
export type NukesFixture = ResponseFixture<"nukes", WireNukes>;
export type TimeFixture = ResponseFixture<"time", WireTime>;
export type ShardsFixture = ResponseFixture<"shards", WireShards>;
export type TerrainFixture = ResponseFixture<"terrain", WireTerrain>;
export type MeFixture = ResponseFixture<"me", WireMe>;

export type FixtureFile =
  | RoomFixture
  | RoomMapFixture
  | ConsoleFixture
  | HistoryFixture
  | PvpFixture
  | NukesFixture
  | TimeFixture
  | ShardsFixture
  | TerrainFixture
  | MeFixture;

/** 一个 fixture 文件的推荐文件名（相对录制输出目录）。 */
export function fixtureFileName(meta: {
  readonly kind: FixtureKind;
  readonly shard?: string;
  readonly room?: string;
  readonly base?: number;
}): string {
  const parts: string[] = [meta.kind];
  if (meta.shard !== undefined) parts.push(meta.shard);
  if (meta.room !== undefined) parts.push(meta.room);
  if (meta.base !== undefined) parts.push(String(meta.base));
  return `${parts.join(".")}.json`;
}
