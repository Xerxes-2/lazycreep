/**
 * LiveSource：连接真实 Server 的 Source。
 * HTTP 走同源 Gateway 路径（ADR 0001），token 放在 X-Token 请求头里转发；
 * WebSocket 流直连官方，在 #10 实现，目前调用会抛错。
 */
import type {
  WireHistoryChunk,
  WireNukes,
  WirePvp,
  WireShards,
  WireTerrain,
  WireTime,
  WireVersion,
} from "./fixture-format.ts";
import {
  SourceError,
  type ConnectionState,
  type ConsoleEvent,
  type HistoryChunk,
  type Nuke,
  type PvpShard,
  type RoomMapUpdate,
  type RoomTick,
  type ServerConfig,
  type ServerVersion,
  type ShardInfo,
  type Source,
  type Terrain,
  type Unsubscribe,
  type UserInfo,
} from "./source.ts";
import {
  historyChunkFromWire,
  meFromWire,
  nukesFromWire,
  pvpFromWire,
  shardsFromWire,
  terrainFromWire,
  versionFromWire,
} from "./wire.ts";

export interface LiveSourceOptions {
  /** 全权限 token（ADR 0003）；不给时只能用匿名接口。 */
  readonly token?: string;
  /** 解析相对路径的基准；浏览器里省略即同源，Node 里指向 Gateway。 */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

type Query = Readonly<Record<string, string>>;

function notYet(what: string): never {
  throw new Error(`LiveSource 尚未实现 ${what}（WebSocket，见 #10）`);
}

export class LiveSource implements Source {
  readonly server: ServerConfig;
  private readonly token: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly aborter = new AbortController();

  constructor(server: ServerConfig, options: LiveSourceOptions = {}) {
    this.server = server;
    this.token = options.token === "" ? undefined : options.token;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private url(path: string, query: Query = {}): string {
    const search = new URLSearchParams(query).toString();
    const full = search ? `${path}?${search}` : path;
    return this.baseUrl === undefined ? full : new URL(full, this.baseUrl).href;
  }

  private shardQuery(shard: string): Query {
    return this.server.sharded ? { shard } : {};
  }

  /** 发 GET，返回 Response；网络失败归为 network。 */
  private async send(path: string, query: Query, withToken: boolean): Promise<Response> {
    const headers: Record<string, string> = {};
    if (withToken && this.token !== undefined) headers["X-Token"] = this.token;
    try {
      return await this.fetchImpl(this.url(path, query), { headers, signal: this.aborter.signal });
    } catch (error) {
      throw new SourceError("network", `${path}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async json<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) throw SourceError.fromStatus(response.status, what);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SourceError("http", `${what}：响应不是 JSON`, response.status);
    }
    const error = (body as { error?: unknown } | null)?.error;
    if (error !== undefined) throw new SourceError("server", `${what}：${String(error)}`, response.status);
    return body as T;
  }

  private async api<T>(path: string, query: Query = {}): Promise<T> {
    const response = await this.send(this.server.apiRoot + path, query, true);
    return this.json<T>(response, path);
  }

  onConnection(_listener: (state: ConnectionState) => void): Unsubscribe {
    return notYet("连接状态");
  }

  subscribeRoom(_shard: string, _room: string, _listener: (tick: RoomTick) => void): Unsubscribe {
    return notYet("房间流");
  }

  subscribeRoomMap(_shard: string, _room: string, _listener: (update: RoomMapUpdate) => void): Unsubscribe {
    return notYet("roomMap2 流");
  }

  subscribeConsole(_listener: (event: ConsoleEvent) => void): Unsubscribe {
    return notYet("Console 流");
  }

  async sendConsole(_shard: string, _expression: string): Promise<void> {
    notYet("Console 命令");
  }

  async getVersion(): Promise<ServerVersion> {
    return versionFromWire(await this.api<WireVersion>("/version"));
  }

  async getTime(shard: string): Promise<number> {
    return (await this.api<WireTime>("/game/time", this.shardQuery(shard))).time;
  }

  async getShards(): Promise<readonly ShardInfo[]> {
    return shardsFromWire(await this.api<WireShards>("/game/shards/info"));
  }

  async getPvp(interval: number): Promise<readonly PvpShard[]> {
    return pvpFromWire(await this.api<WirePvp>("/experimental/pvp", { interval: String(interval) }), interval);
  }

  async getNukes(): Promise<readonly Nuke[]> {
    return nukesFromWire(await this.api<WireNukes>("/experimental/nukes"));
  }

  async getTerrain(shard: string, room: string): Promise<Terrain> {
    const wire = await this.api<WireTerrain>("/game/room-terrain", { room, encoded: "1", ...this.shardQuery(shard) });
    return terrainFromWire(shard, room, wire);
  }

  tileUrl(shard: string, room: string): string {
    return `${this.server.tileRoot}/${shard}/${room}.png`;
  }

  async getMe(): Promise<UserInfo> {
    const user = await this.api<{ _id: string; username: string }>("/auth/me");
    const rooms = await this.api<{ shards: Readonly<Record<string, readonly string[]>> }>("/user/rooms", {
      id: user._id,
    });
    return meFromWire({ user: { _id: user._id, username: user.username }, rooms: { shards: rooms.shards } });
  }

  /** room-history 是公开文件，不带 token。 */
  async getHistoryChunk(shard: string, room: string, base: number): Promise<HistoryChunk | null> {
    const path = `${this.server.historyRoot}/${shard}/${room}/${base}.json`;
    const response = await this.send(path, {}, false);
    if (response.status === 404) return null;
    return historyChunkFromWire(shard, await this.json<WireHistoryChunk>(response, path));
  }

  /** 中止进行中的请求。 */
  close(): void {
    this.aborter.abort();
  }
}
