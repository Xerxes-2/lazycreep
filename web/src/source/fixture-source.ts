/**
 * FixtureSource：从 `fixtures/` 的录制文件回放的 Source。
 * 流按录制时的帧间隔回放，`speed` 为加速倍数（Infinity = 不等待，仍按顺序异步投递）。
 */
import {
  FIXTURE_FORMAT_VERSION,
  type FixtureFile,
  type ConsoleFixture,
  type FixtureKind,
  type HistoryFixture,
  type MapStatsFixture,
  type MeFixture,
  type WorldSizeFixture,
  type NukesFixture,
  type PvpFixture,
  type RoomFixture,
  type RoomMapFixture,
  type ShardsFixture,
  type StreamFrame,
  type TerrainFixture,
  type TimeFixture,
  type VersionFixture,
} from "./fixture-format.ts";
import {
  SourceError,
  type ConnectionState,
  type ConsoleEvent,
  type CpuUpdate,
  type HistoryChunk,
  type MapStats,
  type Nuke,
  type WorldSize,
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
import {
  consoleEventFromWire,
  historyChunkFromWire,
  mapStatsFromWire,
  meFromWire,
  nukesFromWire,
  pvpFromWire,
  roomTickFromWire,
  shardsFromWire,
  terrainFromWire,
  versionFromWire,
} from "./wire.ts";

/** 按种类索引好的一组 fixture，来自同一个 Server。 */
export interface FixtureBundle {
  readonly server: ServerConfig;
  readonly files: readonly FixtureFile[];
}

const KINDS: readonly FixtureKind[] = [
  "room",
  "roomMap2",
  "console",
  "history",
  "pvp",
  "nukes",
  "time",
  "shards",
  "terrain",
  "me",
  "version",
  "worldSize",
  "mapStats",
];

function isFixtureFile(value: unknown): value is FixtureFile {
  if (typeof value !== "object" || value === null) return false;
  const meta = (value as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return false;
  const { format, kind } = meta as { format?: unknown; kind?: unknown };
  return format === FIXTURE_FORMAT_VERSION && KINDS.includes(kind as FixtureKind);
}

/** 把一组已解析的 fixture 文件（JSON）收成 bundle；格式不对或混了多个 Server 时抛错。 */
export function fixtureBundle(files: Iterable<unknown>): FixtureBundle {
  const valid: FixtureFile[] = [];
  for (const file of files) {
    if (!isFixtureFile(file)) throw new Error("不是可识别的 fixture 文件");
    valid.push(file);
  }
  const first = valid[0];
  if (!first) throw new Error("没有 fixture 文件");
  const server = first.meta.server;
  if (valid.some((f) => f.meta.server.id !== server.id)) throw new Error("fixture 混有多个 Server");
  return { server, files: valid };
}

export interface FixtureSourceOptions {
  /** 回放加速倍数，默认 1（原始时序） */
  readonly speed?: number;
}

export class FixtureSource implements Source {
  readonly server: ServerConfig;
  private readonly files: readonly FixtureFile[];
  private readonly speed: number;
  private readonly playbacks = new Set<() => void>();
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>();
  /** 回放没有真实连接：从一开始就视为已认证，close 后断开。 */
  private state: ConnectionState = "authenticated";
  private readonly sent: { shard: string; expression: string }[] = [];
  /** 与 LiveSource 相同的约束：任何时刻最多一条房间订阅。 */
  private room:
    | {
        readonly key: string;
        readonly members: Set<{ readonly cancel: Unsubscribe; readonly onError: StreamErrorListener | undefined }>;
      }
    | undefined;

  constructor(bundle: FixtureBundle, options: FixtureSourceOptions = {}) {
    this.server = bundle.server;
    this.files = bundle.files;
    this.speed = options.speed ?? 1;
    if (!(this.speed > 0)) throw new Error("speed 必须为正数");
  }

  private find<F extends FixtureFile>(kind: F["meta"]["kind"], match: (file: F) => boolean = () => true) {
    return this.files.find((f): f is F => f.meta.kind === kind && match(f as F));
  }

  /** 按录制的帧间隔依次投递；返回取消函数。 */
  private play<T>(frames: ReadonlyArray<StreamFrame<T>>, emit: (data: T) => void): Unsubscribe {
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      this.playbacks.delete(cancel);
    };
    const next = () => {
      const frame = frames[index];
      if (!frame) {
        cancel();
        return;
      }
      const previousAt = frames[index - 1]?.at ?? frame.at;
      timer = setTimeout(() => {
        index += 1;
        emit(frame.data);
        next();
      }, (frame.at - previousAt) / this.speed);
    };
    this.playbacks.add(cancel);
    next();
    return cancel;
  }

  onConnection(listener: (state: ConnectionState) => void): Unsubscribe {
    this.connectionListeners.add(listener);
    listener(this.state);
    return () => this.connectionListeners.delete(listener);
  }

  subscribeRoom(
    shard: string,
    room: string,
    listener: (tick: RoomTick) => void,
    onError?: StreamErrorListener,
  ): Unsubscribe {
    const key = `${shard}/${room}`;
    if (this.room && this.room.key !== key) {
      const replaced = this.room;
      this.room = undefined;
      for (const member of replaced.members) {
        member.cancel();
        member.onError?.({ kind: "replaced", message: replaced.key });
      }
    }
    this.room ??= { key, members: new Set() };
    const fixture = this.find<RoomFixture>("room", (f) => f.meta.shard === shard && f.meta.room === room);
    const cancel = fixture ? this.play(fixture.frames, (data) => listener(roomTickFromWire(data))) : () => {};
    const current = this.room;
    const member = { cancel, onError };
    current.members.add(member);
    return () => {
      current.members.delete(member);
      cancel();
      if (current.members.size === 0 && this.room === current) this.room = undefined;
    };
  }

  subscribeRoomMap(
    shard: string,
    room: string,
    listener: (update: RoomMapUpdate) => void,
    _onError?: StreamErrorListener,
  ): Unsubscribe {
    const fixture = this.find<RoomMapFixture>("roomMap2", (f) => f.meta.shard === shard && f.meta.room === room);
    if (!fixture) return () => {};
    return this.play(fixture.frames, listener);
  }

  subscribeConsole(listener: (event: ConsoleEvent) => void, _onError?: StreamErrorListener): Unsubscribe {
    const fixture = this.find<ConsoleFixture>("console");
    if (!fixture) return () => {};
    return this.play(fixture.frames, (data) => listener(consoleEventFromWire(data)));
  }

  /** 录制格式没有 CPU 流：不投递任何帧。 */
  subscribeCpu(_listener: (update: CpuUpdate) => void, _onError?: StreamErrorListener): Unsubscribe {
    return () => {};
  }

  /** 不触网，只把命令记进 sentConsoleCommands。 */
  async sendConsole(shard: string, expression: string): Promise<void> {
    if (this.state === "disconnected") throw new Error("已断开");
    this.sent.push({ shard, expression });
  }

  get sentConsoleCommands(): ReadonlyArray<{ readonly shard: string; readonly expression: string }> {
    return this.sent;
  }

  /** 取一次性响应的 body；没录到或录到的是错误响应时拒绝（错误按状态码归类，与 LiveSource 一致）。 */
  private async body<F extends Extract<FixtureFile, { body: unknown }>>(
    kind: F["meta"]["kind"],
    what: string,
    match?: (file: F) => boolean,
  ): Promise<NonNullable<F["body"]>> {
    const fixture = this.find<F>(kind, match);
    if (!fixture) throw new Error(`没有录到 ${what}`);
    if (fixture.body === null) throw SourceError.fromStatus(fixture.status, what);
    return fixture.body as NonNullable<F["body"]>;
  }

  async getPvp(interval: number): Promise<readonly PvpShard[]> {
    return pvpFromWire(await this.body<PvpFixture>("pvp", "PvP 列表"), interval);
  }

  async getNukes(): Promise<readonly Nuke[]> {
    return nukesFromWire(await this.body<NukesFixture>("nukes", "核弹列表"));
  }

  async getVersion(): Promise<ServerVersion> {
    return versionFromWire(await this.body<VersionFixture>("version", "版本信息"));
  }

  async getTime(shard: string): Promise<number> {
    const body = await this.body<TimeFixture>("time", `${shard} 的时间`, (f) => f.meta.shard === shard);
    return body.time;
  }

  async getShards(): Promise<readonly ShardInfo[]> {
    return shardsFromWire(await this.body<ShardsFixture>("shards", "Shard 列表"));
  }

  async getTerrain(shard: string, room: string): Promise<Terrain> {
    const body = await this.body<TerrainFixture>(
      "terrain",
      `${shard}/${room} 的地形`,
      (f) => f.meta.shard === shard && f.meta.room === room,
    );
    return terrainFromWire(shard, room, body);
  }

  tileUrl(shard: string, room: string): string {
    return `${this.server.tileRoot}/${shard}/${room}.png`;
  }

  blockTileUrl(shard: string, cornerRoom: string): string {
    return `${this.server.tileRoot}/${shard}/zoom2/${cornerRoom}.png`;
  }

  async getWorldSize(shard: string): Promise<WorldSize> {
    const body = await this.body<WorldSizeFixture>("worldSize", `${shard} 的世界尺寸`, (f) => f.meta.shard === shard);
    return { width: body.width, height: body.height };
  }

  /** 录到的是一个区域：区域外的房间与不存在的房间一样不出现在结果里。 */
  async getMapStats(shard: string, rooms: readonly string[]): Promise<MapStats> {
    const body = await this.body<MapStatsFixture>("mapStats", `${shard} 的 map-stats`, (f) => f.meta.shard === shard);
    return mapStatsFromWire(shard, body, rooms);
  }

  async getMe(): Promise<UserInfo> {
    return meFromWire(await this.body<MeFixture>("me", "用户信息"));
  }

  async getHistoryChunk(shard: string, room: string, base: number): Promise<HistoryChunk | null> {
    const fixture = this.find<HistoryFixture>(
      "history",
      (f) => f.meta.shard === shard && f.meta.room === room && f.meta.base === base,
    );
    if (!fixture?.body) return null;
    return historyChunkFromWire(shard, fixture.body);
  }

  close(): void {
    for (const cancel of [...this.playbacks]) cancel();
    if (this.state === "disconnected") return;
    this.state = "disconnected";
    for (const listener of [...this.connectionListeners]) listener(this.state);
  }
}
