/**
 * 录制 fixture：用用户 token 录真实数据，写到 fixtures/<server>/。
 *
 *   pnpm record --user Xerxes_2 [--server season] [--own W13S28] [--foreign auto] [--ticks 50]
 *
 * token 从环境变量 SCREEPS_TOKEN 读取（pnpm record 会加载 .env.local），只用于 WebSocket `auth`，
 * 绝不写入输出；写文件前会检查输出里不含 token。
 * 房间流与 roomMap2 走 WebSocket（需要 token）；map-stats 是带 token 的 POST（每 Server 每小时 60 次，录一次只用 1 次）；
 * 其余都走匿名 HTTP。
 * 只读：不发送 Console 命令、不读写 memory、不订阅 console 频道。
 *
 * 参数：
 *   --server   预置 Server id（season | mmo | ptr），默认 season
 *   --origin   源站，默认 https://screeps.com
 *   --shard    默认取 shards/info 的第一个
 *   --user     用户名（必填，用于 me 与选出"自己的房间"）
 *   --own      自己的房间，默认该用户在该 Shard 的第一个房间
 *   --foreign  陌生房间；auto = PvP 列表里最新的、不属于该用户的房间
 *   --ticks    每个房间录多少个带 gameTime 的 Tick，默认 50
 *   --pvp-interval  PvP 列表的 interval，默认 100
 *   --history-lag   历史 chunk 至少落后当前 Tick 多少，默认 300
 *   --map-radius    map-stats 录自己房间周围多少格房间（正方形半径），默认 10
 *   --only     逗号分隔的种类子集：version,me,time,shards,pvp,nukes,terrain,room,roomMap2,history,worldSize,mapStats
 *   --out      输出目录，默认 fixtures/<server>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SERVER_PRESETS, type ServerPresetId } from "../web/src/source/servers.ts";
import {
  FIXTURE_FORMAT_VERSION,
  fixtureFileName,
  type FixtureKind,
  type FixtureMeta,
  type StreamFrame,
  type WireHistoryChunk,
  type WirePvp,
  type WireRoomMap,
  type WireRoomPayload,
} from "../web/src/source/fixture-format.ts";
import type { ServerConfig } from "../web/src/source/source.ts";

const ALL_KINDS = ["version", "me", "time", "shards", "pvp", "nukes", "terrain", "room", "roomMap2", "history", "worldSize", "mapStats", "users"] as const;

const { values: args } = parseArgs({
  options: {
    server: { type: "string", default: "season" },
    origin: { type: "string", default: "https://screeps.com" },
    shard: { type: "string" },
    user: { type: "string" },
    own: { type: "string" },
    foreign: { type: "string", default: "auto" },
    ticks: { type: "string", default: "50" },
    "pvp-interval": { type: "string", default: "100" },
    "history-lag": { type: "string", default: "300" },
    "map-radius": { type: "string", default: "10" },
    only: { type: "string", default: ALL_KINDS.join(",") },
    out: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(`record-fixtures: ${message}`);
  process.exit(1);
}

const serverId = args.server as ServerPresetId;
const server: ServerConfig = SERVER_PRESETS[serverId] ?? fail(`未知 Server：${args.server}`);
const origin = args.origin.replace(/\/$/, "");
const kinds = new Set(args.only.split(",").map((k) => k.trim()));
for (const k of kinds) if (!(ALL_KINDS as readonly string[]).includes(k)) fail(`未知种类：${k}`);
const want = (k: (typeof ALL_KINDS)[number]) => kinds.has(k);
const tickTarget = Number(args.ticks);
const pvpInterval = Number(args["pvp-interval"]);
const historyLag = Number(args["history-lag"]);
const outDir = resolve(args.out ?? join("fixtures", server.id));
const username = args.user ?? fail("缺少 --user");
const token = process.env["SCREEPS_TOKEN"] ?? "";
if ((want("room") || want("roomMap2") || want("mapStats")) && token === "") fail("录制房间流需要环境变量 SCREEPS_TOKEN");

const startedAt = new Date();
const recordedAt = startedAt.toISOString();

// ---- HTTP（匿名） ----

async function getJson<T>(path: string, query: Record<string, string> = {}): Promise<{ status: number; body: T | null }> {
  const url = new URL(origin + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) return { status: res.status, body: null };
  const body = (await res.json()) as T & { ok?: number; error?: string };
  if (body.error !== undefined) fail(`${url.pathname} 返回错误：${body.error}`);
  return { status: res.status, body };
}

const api = (path: string, query: Record<string, string> = {}) => getJson<any>(server.apiRoot + path, query);
const shardQuery = (shard: string): Record<string, string> => (server.sharded ? { shard } : {});

// ---- 写文件 ----

function meta<K extends FixtureKind>(kind: K, extra: Partial<FixtureMeta<K>> & Record<string, unknown> = {}) {
  return { format: FIXTURE_FORMAT_VERSION, kind, recordedAt, server, origin, ...extra };
}

function assertClean(text: string, file: string) {
  if (token !== "" && text.includes(token)) fail(`${file} 含 token，拒绝写入`);
}

/** 顶层字段一行一个，数组字段（frames）每个元素一行，便于 diff 又不至于太大。 */
function writeFixture(file: string, value: Record<string, unknown>, arrayKey?: string) {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === arrayKey && Array.isArray(v)) {
      lines.push(`${JSON.stringify(k)}:[\n${v.map((item) => JSON.stringify(item)).join(",\n")}\n]`);
    } else {
      lines.push(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
    }
  }
  const text = `{\n${lines.join(",\n")}\n}\n`;
  JSON.parse(text);
  assertClean(text, file);
  const path = join(outDir, file);
  writeFileSync(path, text);
  console.log(`写入 ${path}（${(text.length / 1024).toFixed(1)} KiB）`);
}

// ---- WebSocket ----

interface StreamRecording {
  channel: string;
  kind: "room" | "roomMap2";
  room: string;
  frames: StreamFrame<unknown>[];
  ticks: number;
  errors: string[];
}

function recordStreams(streams: StreamRecording[], shard: string): Promise<void> {
  const prefix = server.sharded ? `${shard}/` : "";
  return new Promise((resolveDone, reject) => {
    const ws = new WebSocket(server.socketUrl.replace(/^wss:\/\/screeps\.com/, origin.replace(/^http/, "ws")));
    const start = Date.now();
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`超时：${streams.map((s) => `${s.channel}=${s.ticks}`).join(", ")}`));
    }, Math.max(60_000, tickTarget * 15_000));
    const roomStreams = streams.filter((s) => s.kind === "room");
    const done = () => roomStreams.every((s) => s.ticks >= tickTarget);

    ws.onopen = () => ws.send(`auth ${token}`);
    ws.onerror = () => reject(new Error("WebSocket 出错"));
    ws.onclose = (event) => {
      clearTimeout(timeout);
      if (!done()) reject(new Error(`WebSocket 提前关闭：${event.code} ${event.reason}`));
    };
    ws.onmessage = (event) => {
      const text = String(event.data);
      if (text.startsWith("auth ")) {
        if (!text.startsWith("auth ok")) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error("WebSocket 认证失败"));
          return;
        }
        console.log("WebSocket 认证成功");
        for (const s of streams) ws.send(`subscribe ${s.kind}:${prefix}${s.room}`);
        return;
      }
      if (!text.startsWith("[")) return; // time / protocol / package
      const [channel, payload] = JSON.parse(text) as [string, unknown];
      const errStream = streams.find((s) => `err@${s.channel}` === channel);
      if (errStream) {
        errStream.errors.push(String(payload));
        return;
      }
      const stream = streams.find((s) => s.channel === channel);
      if (!stream) return;
      stream.frames.push({ at: Date.now() - start, data: payload });
      if (stream.kind === "room" && typeof (payload as WireRoomPayload).gameTime === "number") {
        stream.ticks += 1;
        if (stream.ticks % 10 === 0) console.log(`${channel}: ${stream.ticks}/${tickTarget}`);
      }
      if (done()) {
        clearTimeout(timeout);
        for (const s of streams) ws.send(`unsubscribe ${s.kind}:${prefix}${s.room}`);
        ws.close();
        resolveDone();
      }
    };
  });
}

// ---- 主流程 ----

mkdirSync(outDir, { recursive: true });

if (want("version")) {
  const res = await api("/version");
  writeFixture(fixtureFileName({ kind: "version" }), {
    meta: meta("version", { note: "serverData 只保留 historyChunkSize、renderer 与 features 中的 map-url-replace" }),
    status: res.status,
    body: res.body && {
      package: res.body.package,
      protocol: res.body.protocol,
      // renderer：赛季服的渲染器覆盖配置（#47），MMO 为空；map-url-replace：赛季服本赛季的地图瓦片根地址
      serverData: {
        historyChunkSize: res.body.serverData.historyChunkSize,
        renderer: res.body.serverData.renderer,
        features: (res.body.serverData.features ?? []).filter((f: { name?: unknown }) => f.name === "map-url-replace"),
      },
    },
  });
}

const shardsRes = await api("/game/shards/info");
const shard = args.shard ?? shardsRes.body?.shards?.[0]?.name ?? fail("无法确定 Shard");
console.log(`Server ${server.name}，Shard ${shard}，输出到 ${outDir}`);

if (want("shards")) {
  writeFixture(fixtureFileName({ kind: "shards" }), {
    meta: meta("shards"),
    status: shardsRes.status,
    body: { shards: shardsRes.body.shards.map(({ name, rooms, users, tick }: any) => ({ name, rooms, users, tick })) },
  });
}

const timeRes = await api("/game/time", shardQuery(shard));
const now: number = timeRes.body?.time ?? fail("无法读取服务器时间");
if (want("time")) writeFixture(fixtureFileName({ kind: "time", shard }), { meta: meta("time", { shard }), ...timeRes });

const found = await api("/user/find", { username });
const userId: string = found.body?.user?._id ?? fail(`找不到用户 ${username}`);
const roomsRes = await api("/user/rooms", { id: userId });
const ownedRooms: string[] = roomsRes.body?.shards?.[shard] ?? [];
if (want("me")) {
  writeFixture(fixtureFileName({ kind: "me" }), {
    meta: meta("me", { note: "user/find（仅 _id、username 与 badge）+ user/rooms（不含 reservations）" }),
    status: 200,
    body: {
      user: {
        _id: userId,
        username: found.body.user.username,
        ...(found.body.user.badge ? { badge: found.body.user.badge } : {}),
      },
      rooms: { shards: roomsRes.body.shards } },
  });
}

const pvpRes = await api("/experimental/pvp", { interval: String(pvpInterval) });
const pvp = pvpRes.body as WirePvp | null;
if (want("pvp")) {
  writeFixture(fixtureFileName({ kind: "pvp" }), {
    meta: meta("pvp", { interval: pvpInterval }),
    status: pvpRes.status,
    body: pvp && { pvp: pvp.pvp },
  });
}

if (want("nukes")) {
  const nukesRes = await api("/experimental/nukes");
  writeFixture(fixtureFileName({ kind: "nukes" }), {
    meta: meta("nukes"),
    status: nukesRes.status,
    body: nukesRes.body && { nukes: nukesRes.body.nukes },
  });
}

const own = args.own ?? ownedRooms[0] ?? fail(`${username} 在 ${shard} 没有房间，请用 --own 指定`);
let foreign = args.foreign;
if (foreign === "auto") {
  const candidates = pvp?.pvp[shard]?.rooms ?? [];
  foreign = candidates.find((r) => !ownedRooms.includes(r._id))?._id ?? fail("PvP 列表里没有陌生房间");
}
const rooms = [own, foreign];

if (want("worldSize")) {
  const res = await api("/game/world-size", shardQuery(shard));
  writeFixture(fixtureFileName({ kind: "worldSize", shard }), {
    meta: meta("worldSize", { shard }),
    status: res.status,
    body: res.body && { width: res.body.width, height: res.body.height },
  });
}

if (want("mapStats")) {
  // 以自己的房间为中心的正方形区域；房间名与有符号坐标：W/N 为 -n-1，E/S 为 n
  const match = /^([WE])(\d+)([NS])(\d+)$/.exec(own) ?? fail(`无法解析房间名 ${own}`);
  const cx = match[1] === "W" ? -Number(match[2]) - 1 : Number(match[2]);
  const cy = match[3] === "N" ? -Number(match[4]) - 1 : Number(match[4]);
  const radius = Number(args["map-radius"]);
  const names: string[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      names.push(`${x < 0 ? `W${-x - 1}` : `E${x}`}${y < 0 ? `N${-y - 1}` : `S${y}`}`);
    }
  }
  const statName = "minerals0";
  const res = await fetch(origin + server.apiRoot + "/game/map-stats", {
    method: "POST",
    headers: { "X-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ rooms: names, statName, ...shardQuery(shard) }),
  });
  console.log(`map-stats 剩余额度 ${res.headers.get("x-ratelimit-remaining")}/${res.headers.get("x-ratelimit-limit")}`);
  const body = res.ok ? ((await res.json()) as any) : null;
  if (body !== null && body.error !== undefined) fail(`map-stats 返回错误：${body.error}`);
  writeFixture(fixtureFileName({ kind: "mapStats", shard }), {
    meta: meta("mapStats", {
      shard,
      statName,
      note: `以 ${own} 为中心、半径 ${radius} 的 ${names.length} 个房间；users 只保留 _id、username 与 badge`,
    }),
    status: res.status,
    body: body && {
      gameTime: body.gameTime,
      stats: body.stats,
      users: Object.fromEntries(
        Object.entries(body.users as Record<string, any>).map(([id, u]) => [id, { _id: u._id, username: u.username, ...(u.badge ? { badge: u.badge } : {}) }]),
      ),
    },
  });
}
console.log(`自己的房间 ${own}，陌生房间 ${foreign}`);

if (want("terrain")) {
  for (const room of rooms) {
    const res = await api("/game/room-terrain", { room, encoded: "1", ...shardQuery(shard) });
    writeFixture(fixtureFileName({ kind: "terrain", shard, room }), {
      meta: meta("terrain", { shard, room }),
      status: res.status,
      body: res.body && { terrain: res.body.terrain.map(({ room: r, terrain }: any) => ({ room: r, terrain })) },
    });
  }
}

/** roomMap2 帧里出现的玩家 id（user/find 补录用；NPC 与地形类键不是 24 位十六进制） */
const seenPlayers = new Set<string>();

if (want("room") || want("roomMap2")) {
  const prefix = server.sharded ? `${shard}/` : "";
  const streams: StreamRecording[] = [];
  for (const room of rooms) {
    for (const kind of ["room", "roomMap2"] as const) {
      // 订阅 room 才知道何时录够；只要 roomMap2 时也订阅 room，但不写文件。
      if (kind === "roomMap2" && !want("roomMap2")) continue;
      streams.push({ channel: `${kind}:${prefix}${room}`, kind, room, frames: [], ticks: 0, errors: [] });
    }
  }
  console.log(`开始录制 WebSocket，目标 ${tickTarget} Tick（约 ${Math.round((tickTarget * 4) / 60)} 分钟）`);
  await recordStreams(streams, shard);
  for (const s of streams) {
    if (s.kind === "room" && !want("room")) continue;
    const times = s.frames
      .map((f) => (f.data as WireRoomPayload).gameTime)
      .filter((t): t is number => typeof t === "number");
    const roomStream = streams.find((r) => r.kind === "room" && r.room === s.room);
    const roomTimes = (roomStream?.frames ?? [])
      .map((f) => (f.data as WireRoomPayload).gameTime)
      .filter((t): t is number => typeof t === "number");
    const range = s.kind === "room" ? times : roomTimes;
    const extra: Record<string, unknown> = { shard, room: s.room };
    if (range.length > 0) extra["tickRange"] = [range[0], range[range.length - 1]];
    if (s.kind === "roomMap2") extra["note"] = "roomMap2 帧不带 gameTime；tickRange 取同时录制的房间流";
    if (s.errors.length > 0) extra["serverErrors"] = [...new Set(s.errors)];
    if (s.kind === "roomMap2") {
      for (const f of s.frames) for (const key of Object.keys(f.data as WireRoomMap)) if (/^[0-9a-f]{24}$/.test(key)) seenPlayers.add(key);
    }
    writeFixture(
      fixtureFileName({ kind: s.kind, shard, room: s.room }),
      { meta: meta(s.kind, extra), frames: s.frames as StreamFrame<WireRoomPayload | WireRoomMap>[] },
      "frames",
    );
  }
}

if (want("users") && seenPlayers.size > 0) {
  const users: Record<string, { _id: string; username: string; gcl?: number; badge?: unknown }> = {};
  for (const id of seenPlayers) {
    const user = (await api("/user/find", { id })).body?.user;
    if (typeof user?.username !== "string") continue;
    users[id] = {
      _id: id,
      username: user.username,
      ...(typeof user.gcl === "number" ? { gcl: user.gcl } : {}),
      ...(user.badge ? { badge: user.badge } : {}),
    };
  }
  writeFixture(fixtureFileName({ kind: "users" }), {
    meta: meta("users", { note: "roomMap2 录制里出现的玩家的 user/find（仅 _id、username、gcl、badge）" }),
    status: 200,
    body: users,
  });
}

if (want("history")) {
  const time = (await api("/game/time", shardQuery(shard))).body?.time ?? now;
  for (const room of rooms) {
    let base = Math.floor((time - historyLag) / 100) * 100;
    for (let attempt = 0; attempt < 5; attempt++, base -= 100) {
      const res = await getJson<WireHistoryChunk>(`${server.historyRoot}/${shard}/${room}/${base}.json`);
      if (res.status === 404) continue;
      if (res.body === null) fail(`历史 chunk ${room}/${base} 返回 ${res.status}`);
      const ticks = Object.keys(res.body.ticks).map(Number).sort((a, b) => a - b);
      writeFixture(
        fixtureFileName({ kind: "history", shard, room, base }),
        {
          meta: meta("history", { shard, room, base, tickRange: [ticks[0], ticks[ticks.length - 1]] }),
          status: res.status,
          body: { timestamp: res.body.timestamp, room: res.body.room, base: res.body.base, ticks: res.body.ticks },
        },
      );
      break;
    }
  }
}

console.log("完成");
