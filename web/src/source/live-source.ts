/**
 * LiveSource：连接真实 Server 的 Source。
 * HTTP 走同源 Gateway 路径（ADR 0001），token 放在 X-Token 请求头里转发；
 * WebSocket 流直连官方（Server 配置的 socketUrl），一个 LiveSource 至多一条连接，
 * 第一次订阅流时建立；任何时刻最多一条房间订阅（ADR 0002）由这里保证。
 */
import type {
  WireConsole,
  WireHistoryChunk,
  WireNukes,
  WirePvp,
  WireRoomPayload,
  WireShards,
  WireTerrain,
  WireTime,
  WireVersion,
} from "./fixture-format.ts";
import {
  SourceError,
  type ConnectionState,
  type ConsoleEvent,
  type CpuUpdate,
  type HistoryChunk,
  type Nuke,
  type PvpShard,
  type RoomMapUpdate,
  type RoomTick,
  type ServerConfig,
  type ServerVersion,
  type ShardInfo,
  type Source,
  type StreamErrorListener,
  type Terrain,
  type Unsubscribe,
  type UserInfo,
} from "./source.ts";
import { browserSocket, ChannelSocket, type ReconnectOptions, type SocketFactory } from "./socket.ts";
import {
  consoleEventFromWire,
  historyChunkFromWire,
  meFromWire,
  nukesFromWire,
  pvpFromWire,
  roomTickFromWire,
  shardsFromWire,
  terrainFromWire,
  versionFromWire,
} from "./wire.ts";

export type { ReconnectOptions, SocketFactory, SocketHandlers, RawSocket } from "./socket.ts";

export interface LiveSourceOptions {
  /** 全权限 token（ADR 0003）；不给时只能用匿名接口。 */
  readonly token?: string;
  /** 解析相对路径的基准；浏览器里省略即同源，Node 里指向 Gateway。 */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** 建立 WebSocket；测试里换成假 socket。 */
  readonly socket?: SocketFactory;
  readonly reconnect?: ReconnectOptions;
}

/** 当前那条房间订阅：同一房间可有多个监听者。 */
interface RoomSubscription {
  readonly channel: string;
  readonly members: Set<{ readonly off: Unsubscribe; readonly onError: StreamErrorListener | undefined }>;
}

type Query = Readonly<Record<string, string>>;

export class LiveSource implements Source {
  readonly server: ServerConfig;
  private readonly token: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly aborter = new AbortController();
  private readonly socket: ChannelSocket;
  private room: RoomSubscription | undefined;
  private userId: Promise<string> | undefined;

  constructor(server: ServerConfig, options: LiveSourceOptions = {}) {
    this.server = server;
    this.token = options.token === "" ? undefined : options.token;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.socket = new ChannelSocket(server.socketUrl, this.token, options.socket ?? browserSocket, options.reconnect);
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

  onConnection(listener: (state: ConnectionState) => void): Unsubscribe {
    return this.socket.onState(listener);
  }

  /** 分 Shard 的 Server 频道名带 `<shard>/`。 */
  private roomChannel(kind: "room" | "roomMap2", shard: string, room: string): string {
    return `${kind}:${this.server.sharded ? `${shard}/` : ""}${room}`;
  }

  private stream<T>(channel: string, listener: (data: T) => void, onError?: StreamErrorListener): Unsubscribe {
    return this.socket.subscribe(channel, {
      data: (payload) => listener(payload as T),
      error: (message) => onError?.({ kind: "server", message }),
    });
  }

  subscribeRoom(
    shard: string,
    room: string,
    listener: (tick: RoomTick) => void,
    onError?: StreamErrorListener,
  ): Unsubscribe {
    const channel = this.roomChannel("room", shard, room);
    if (this.room && this.room.channel !== channel) {
      // 先退订旧房间，再订阅新房间
      const replaced = this.room;
      this.room = undefined;
      for (const member of replaced.members) member.off();
      for (const member of replaced.members) member.onError?.({ kind: "replaced", message: replaced.channel });
      replaced.members.clear();
    }
    this.room ??= { channel, members: new Set() };
    const current = this.room;
    const member = {
      off: this.stream<WireRoomPayload>(channel, (data) => listener(roomTickFromWire(data)), onError),
      onError,
    };
    current.members.add(member);
    return () => {
      if (!current.members.delete(member)) return;
      member.off();
      if (current.members.size === 0 && this.room === current) this.room = undefined;
    };
  }

  subscribeRoomMap(
    shard: string,
    room: string,
    listener: (update: RoomMapUpdate) => void,
    onError?: StreamErrorListener,
  ): Unsubscribe {
    return this.stream(this.roomChannel("roomMap2", shard, room), listener, onError);
  }

  /** `user:<id>/<topic>`：id 取自 token 所属用户，取到之前先不订阅。 */
  private userStream<T>(topic: string, listener: (data: T) => void, onError?: StreamErrorListener): Unsubscribe {
    let off: Unsubscribe | undefined;
    let cancelled = false;
    const userId = (this.userId ??= this.api<{ _id: string }>("/auth/me").then((me) => me._id));
    userId.then(
      (id) => {
        if (!cancelled) off = this.stream(`user:${id}/${topic}`, listener, onError);
      },
      (error: unknown) => {
        if (this.userId === userId) this.userId = undefined;
        if (!cancelled) onError?.({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
      off?.();
    };
  }

  subscribeConsole(listener: (event: ConsoleEvent) => void, onError?: StreamErrorListener): Unsubscribe {
    return this.userStream<WireConsole>("console", (data) => listener(consoleEventFromWire(data)), onError);
  }

  subscribeCpu(listener: (update: CpuUpdate) => void, onError?: StreamErrorListener): Unsubscribe {
    return this.userStream<{ cpu: number; memory: number }>(
      "cpu",
      (data) => listener({ cpu: data.cpu, memory: data.memory }),
      onError,
    );
  }

  /** Console 命令走 HTTP POST，见 #6。 */
  async sendConsole(_shard: string, _expression: string): Promise<void> {
    throw new Error("LiveSource 尚未实现 Console 命令（见 #6）");
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

  /** 中止进行中的请求，断开 WebSocket 并停止重连。 */
  close(): void {
    this.aborter.abort();
    this.socket.close();
    this.room = undefined;
  }
}
