/**
 * 服务器 wire 格式到 Source 类型的转换。FixtureSource 与 LiveSource 共用，
 * 保证回放与即时数据经过同一套转换。
 */
import type {
  WireConsole,
  WireHistoryChunk,
  WireMe,
  WireNukes,
  WirePvp,
  WireRoomPayload,
  WireShards,
  WireTerrain,
  WireVersion,
} from "./fixture-format.ts";
import type {
  ConsoleEvent,
  HistoryChunk,
  Nuke,
  PvpShard,
  RoomTick,
  RoomUser,
  ServerVersion,
  ShardInfo,
  Terrain,
  UserInfo,
} from "./source.ts";

/** interval 由服务器按 Tick 截取；回放时按 lastPvpTime >= time - interval 截取同样的结果。 */
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
  return { package: wire.package, protocol: wire.protocol, historyChunkSize: wire.serverData.historyChunkSize };
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
  return { id: wire.user._id, username: wire.user.username, rooms: wire.rooms.shards };
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

export function roomTickFromWire(payload: WireRoomPayload): RoomTick {
  const tick: { -readonly [K in keyof RoomTick]: RoomTick[K] } = { objects: payload.objects ?? {} };
  if (typeof payload.gameTime === "number") tick.gameTime = payload.gameTime;
  if (payload.users) tick.users = payload.users as Readonly<Record<string, RoomUser>>;
  if (typeof payload.visual === "string") tick.visual = payload.visual;
  return tick;
}
