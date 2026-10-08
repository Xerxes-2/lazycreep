/**
 * 服务器 wire 格式到 Source 类型的转换。FixtureSource 与 LiveSource 共用，
 * 保证录制数据与即时数据经过同一套转换。
 */
import { mapTileRootFromFeatures } from "./map-tiles.ts";
import { rendererFromWire } from "./season-renderer.ts";
import type {
  WireConsole,
  WireHistoryChunk,
  WireMapStats,
  WireMe,
  WireNukes,
  WirePvp,
  WireRoomPayload,
  WireShards,
  WireTerrain,
  WireVersion,
} from "./fixture-format.ts";
import { parseBadge } from "../badge/badge.ts";
import type {
  ConsoleEvent,
  HistoryChunk,
  MapStats,
  Nuke,
  RoomStats,
  PvpShard,
  RoomTick,
  RoomUser,
  ServerVersion,
  ShardInfo,
  Terrain,
  UserInfo,
} from "./source.ts";

/** interval 由服务器按 Tick 截取；播放录制数据时按 lastPvpTime >= time - interval 截取同样的结果。 */
export function pvpFromWire(wire: WirePvp, interval: number): PvpShard[] {
  return Object.entries(wire.pvp).map(([shard, { time, rooms }]) => ({
    shard,
    time,
    rooms: rooms
      .filter((r) => r.lastPvpTime >= time - interval)
      .map((r) => ({ room: r._id, lastPvpTime: r.lastPvpTime })),
  }));
}

export function versionFromWire(wire: WireVersion): ServerVersion {
  const renderer = rendererFromWire(wire.serverData.renderer);
  return {
    package: wire.package,
    protocol: wire.protocol,
    historyChunkSize: wire.serverData.historyChunkSize,
    ...(renderer ? { renderer } : {}),
    mapTileRoot: mapTileRootFromFeatures(wire.serverData.features),
  };
}

export function nukesFromWire(wire: WireNukes): Nuke[] {
  return Object.entries(wire.nukes).flatMap(([shard, nukes]) =>
    nukes.map((n) => ({
      id: n._id,
      shard,
      room: n.room,
      x: n.x,
      y: n.y,
      landTime: n.landTime,
      launchRoom: n.launchRoomName,
    })),
  );
}

export function shardsFromWire(wire: WireShards): ShardInfo[] {
  return wire.shards.map((s) => ({ name: s.name, rooms: s.rooms, users: s.users, tickMs: s.tick }));
}

export function terrainFromWire(shard: string, room: string, wire: WireTerrain): Terrain {
  const entry = wire.terrain.find((t) => t.room === room);
  if (!entry) throw new Error(`地形响应里没有 ${room}`);
  return { shard, room, encoded: entry.terrain };
}

export function meFromWire(wire: WireMe): UserInfo {
  const badge = parseBadge(wire.user.badge);
  return { id: wire.user._id, username: wire.user.username, rooms: wire.rooms.shards, ...(badge ? { badge } : {}) };
}

export function consoleEventFromWire(wire: WireConsole): ConsoleEvent {
  const shard = wire.shard ?? null;
  if (wire.error !== undefined) return { kind: "error", shard, error: wire.error };
  return { kind: "output", shard, log: wire.messages?.log ?? [], results: wire.messages?.results ?? [] };
}

export function historyChunkFromWire(shard: string, chunk: WireHistoryChunk): HistoryChunk {
  const ticks = Object.entries(chunk.ticks)
    .map(([time, objects]) => ({ gameTime: Number(time), objects }))
    .sort((a, b) => a.gameTime - b.gameTime);
  return { shard, room: chunk.room, base: chunk.base, ticks };
}

/** 只保留所问的房间与它们涉及的用户（所有者、签名者）。 */
export function mapStatsFromWire(shard: string, wire: WireMapStats, rooms: readonly string[]): MapStats {
  const out: Record<string, RoomStats> = {};
  const users: Record<string, RoomUser> = {};
  const addUser = (id: string) => {
    const user = wire.users[id];
    if (user) users[id] = { _id: user._id, username: user.username, ...(user.badge === undefined ? {} : { badge: user.badge }) };
  };
  for (const room of rooms) {
    const stats = wire.stats[room];
    if (!stats) continue;
    const entry: { -readonly [K in keyof RoomStats]: RoomStats[K] } = { status: stats.status };
    if (stats.own) {
      entry.owner = { user: stats.own.user, level: stats.own.level };
      addUser(stats.own.user);
    }
    if (stats.sign) {
      entry.sign = { user: stats.sign.user, text: stats.sign.text, time: stats.sign.time };
      addUser(stats.sign.user);
    }
    if (stats.minerals0) entry.mineral = { type: stats.minerals0.type, density: stats.minerals0.density };
    if (typeof stats.novice === "number") entry.novice = stats.novice;
    if (typeof stats.respawnArea === "number") entry.respawnArea = stats.respawnArea;
    if (typeof stats.openTime === "number") entry.openTime = stats.openTime;
    if (stats.safeMode === true) entry.safeMode = true;
    out[room] = entry;
  }
  return { shard, gameTime: wire.gameTime, rooms: out, users };
}

export function roomTickFromWire(payload: WireRoomPayload): RoomTick {
  const tick: { -readonly [K in keyof RoomTick]: RoomTick[K] } = { objects: payload.objects ?? {} };
  if (typeof payload.gameTime === "number") tick.gameTime = payload.gameTime;
  if (payload.users) tick.users = payload.users as Readonly<Record<string, RoomUser>>;
  if (typeof payload.visual === "string") tick.visual = payload.visual;
  return tick;
}
