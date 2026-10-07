/**
 * Source：前端与一切外部数据之间唯一的边界（spec #1 接缝 1）。
 * 实现：FixtureSource（播放 `fixtures/` 的录制数据）；LiveSource（HTTP 经同源 Gateway，WebSocket 直连官方）。
 */

/** 一个 Server 的连接配置。路径是相对 Gateway 的同源路径，WebSocket 是绝对地址。 */
export interface ServerConfig {
  readonly id: string;
  readonly name: string;
  /** 例如 `/api`、`/season/api` */
  readonly apiRoot: string;
  readonly socketUrl: string;
  /** 分 Shard 的 Server 在频道名与 HTTP 参数里带 Shard。 */
  readonly sharded: boolean;
  /** 地图瓦片根路径，`<tileRoot>/<shard>/<room>.png` */
  readonly tileRoot: string;
  /** 历史 chunk 根路径，`<historyRoot>/<shard>/<room>/<base>.json` */
  readonly historyRoot: string;
}

export type Unsubscribe = () => void;

/**
 * 流的连接状态：
 * - disconnected：没有连接（尚无流订阅，或已 close）
 * - connecting：首次连接，尚未认证
 * - authenticated：已认证，订阅生效
 * - reconnecting：连接断开，正在按指数退避重连；恢复后自动重订阅
 * - unauthorized：token 缺失或被服务器拒绝；不会自动重连，换 token 需要新建 Source
 */
export type ConnectionState = "connecting" | "authenticated" | "disconnected" | "reconnecting" | "unauthorized";

/**
 * 一条流订阅上的错误，经 subscribe* 的 `onError` 送达：
 * - replaced：被另一个房间的订阅顶替（任何时刻最多一条房间订阅，ADR 0002），之后不再收到帧
 * - server：服务器针对该频道的错误帧（如 `subscribe limit reached`），订阅保留，之后可能恢复
 * - failed：订阅没能建立（如取不到当前用户 id），之后不会收到帧
 */
export interface StreamError {
  readonly kind: "replaced" | "server" | "failed";
  readonly message: string;
}

export type StreamErrorListener = (error: StreamError) => void;

/** 当前用户的 CPU 与内存用量，每 Tick 一帧。 */
export interface CpuUpdate {
  readonly cpu: number;
  /** Memory 序列化后的字节数 */
  readonly memory: number;
}

/** 一个房间对象：首帧为全量（含 `type`、`x`、`y` 等），后续为只含变化属性的增量。 */
export type RoomObjectPatch = Readonly<Record<string, unknown>>;

export interface RoomUser {
  readonly _id: string;
  readonly username: string;
  readonly [key: string]: unknown;
}

/**
 * 房间的一个 Tick：房间流与历史 chunk 共用的形状。
 * `objects` 中值为 `null` 表示该对象消失。
 */
export interface RoomTick {
  /**
   * 实测：WebSocket 订阅后的首帧（全量）不带 gameTime，之后每帧都带。
   * 历史 chunk 的每个 Tick 都带。
   */
  readonly gameTime?: number;
  readonly objects: Readonly<Record<string, RoomObjectPatch | null>>;
  readonly users?: Readonly<Record<string, RoomUser>>;
  /** RoomVisual 序列化文本：每行一个 JSON 指令；空串表示本 Tick 无 visual。 */
  readonly visual?: string;
}

export interface HistoryTick extends RoomTick {
  readonly gameTime: number;
}

/** 一个历史 chunk：首 Tick 全量，后续为增量，按 Tick 升序。 */
export interface HistoryChunk {
  readonly shard: string;
  readonly room: string;
  readonly base: number;
  readonly ticks: readonly HistoryTick[];
}

/** roomMap2 一帧：键为类别（w 墙、r 路、pb、p、s、c、m、k）或用户 id，值为坐标列表。 */
export type RoomMapUpdate = Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;

export interface RoomMapOptions {
  /**
   * 页面不可见时也保留这条订阅（默认随页面隐藏暂停，#14）。
   * 给 Attack Alert 用：系统通知恰恰在标签页不可见时最有用。
   */
  readonly keepWhileHidden?: boolean;
}

export type ConsoleEvent =
  | {
      readonly kind: "output";
      readonly shard: string | null;
      readonly log: readonly string[];
      readonly results: readonly string[];
    }
  | { readonly kind: "error"; readonly shard: string | null; readonly error: string };

export interface PvpRoom {
  readonly room: string;
  readonly lastPvpTime: number;
}

export interface PvpShard {
  readonly shard: string;
  /** 服务器在生成列表时的 Tick */
  readonly time: number;
  /** 接口原样的顺序：通常按 lastPvpTime 降序，但不保证（实测 MMO shard3 为升序） */
  readonly rooms: readonly PvpRoom[];
}

export interface Nuke {
  readonly id: string;
  readonly shard: string;
  readonly room: string;
  readonly x: number;
  readonly y: number;
  readonly landTime: number;
  readonly launchRoom: string;
}

export interface ShardInfo {
  readonly name: string;
  readonly rooms: number;
  readonly users: number;
  /** 平均每 Tick 毫秒数 */
  readonly tickMs: number;
}

/** 房间地形：2500 个字符，按 y*50+x 排列；位 1 为墙、位 2 为沼泽。 */
export interface Terrain {
  readonly shard: string;
  readonly room: string;
  readonly encoded: string;
}

export interface UserInfo {
  readonly id: string;
  readonly username: string;
  /** 按 Shard 列出拥有的房间 */
  readonly rooms: Readonly<Record<string, readonly string[]>>;
}

/** 按 id 查到的玩家资料（`user/find`，匿名） */
export interface PlayerProfile {
  readonly id: string;
  readonly username: string;
  /** GCL 点数（不是等级；等级见 pvp/gcl.ts 的 gclLevel）；拿不到时为 undefined */
  readonly gcl?: number;
}

/** 一个 Shard 的世界尺寸，以房间计（`game/world-size`）。 */
export interface WorldSize {
  readonly width: number;
  readonly height: number;
}

/** map-stats 里一个房间的情况。 */
export interface RoomStats {
  /** 例如 `normal`、`out of borders` */
  readonly status: string;
  /** 所有者；level 0 表示预定，1–8 为 RCL */
  readonly owner?: { readonly user: string; readonly level: number };
  readonly sign?: { readonly user: string; readonly text: string; readonly time: number };
  /** 房间里的矿物（map-stats 的 `minerals0`）：类型如 `H`、`O`，density 1–4 */
  readonly mineral?: { readonly type: string; readonly density: number };
  /** 新手区截止时间（Unix 毫秒）；已过去的值表示曾经是新手区 */
  readonly novice?: number;
  /** 重生区截止时间（Unix 毫秒） */
  readonly respawnArea?: number;
  /** 房间开放时间（Unix 毫秒）；在此之前不可进入 */
  readonly openTime?: number;
  /** 控制器处于安全模式 */
  readonly safeMode?: boolean;
}

/** 一次 map-stats 查询的结果；不存在的房间不出现在 rooms 里。 */
export interface MapStats {
  readonly shard: string;
  readonly gameTime: number;
  readonly rooms: Readonly<Record<string, RoomStats>>;
  /** 出现在 rooms 里的用户 */
  readonly users: Readonly<Record<string, RoomUser>>;
}

export interface ServerVersion {
  readonly package: number;
  readonly protocol: number;
  /** 历史 chunk 的 Tick 数，Replay 按它对齐 base */
  readonly historyChunkSize: number;
}

/**
 * Source 的失败原因：
 * - unauthorized：token 缺失、无效或已失效（401）
 * - forbidden：被拒绝（403），例如 Gateway 的 POST 允许名单
 * - rateLimited：触发速率限制（429）
 * - http：其他非 2xx
 * - server：HTTP 200 但响应体带 `error`
 * - network：请求没有得到响应
 */
export type SourceErrorKind = "unauthorized" | "forbidden" | "rateLimited" | "http" | "server" | "network";

export class SourceError extends Error {
  override readonly name = "SourceError";

  constructor(
    readonly kind: SourceErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }

  /** 按 HTTP 状态码归类；`what` 用于消息。 */
  static fromStatus(status: number, what: string): SourceError {
    const kind: SourceErrorKind =
      status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 429 ? "rateLimited" : "http";
    return new SourceError(kind, `${what}：HTTP ${status}`, status);
  }
}

/** 所有返回 Promise 的方法失败时以 SourceError 拒绝。 */
export interface Source {
  readonly server: ServerConfig;

  /** 连接状态流；订阅时立即收到当前状态。 */
  onConnection(listener: (state: ConnectionState) => void): Unsubscribe;

  /**
   * 房间逐 Tick 流：首帧全量，后续增量。
   * 任何时刻最多一条房间订阅：订阅另一个房间会先退订旧房间，旧订阅收到 `replaced`。
   */
  subscribeRoom(
    shard: string,
    room: string,
    listener: (tick: RoomTick) => void,
    onError?: StreamErrorListener,
  ): Unsubscribe;
  subscribeRoomMap(
    shard: string,
    room: string,
    listener: (update: RoomMapUpdate) => void,
    onError?: StreamErrorListener,
    options?: RoomMapOptions,
  ): Unsubscribe;
  /** 当前用户的 Console 输出（所有 Shard；事件里带 Shard）。 */
  subscribeConsole(listener: (event: ConsoleEvent) => void, onError?: StreamErrorListener): Unsubscribe;
  /** 当前用户的 CPU 与内存用量。 */
  subscribeCpu(listener: (update: CpuUpdate) => void, onError?: StreamErrorListener): Unsubscribe;
  sendConsole(shard: string, expression: string): Promise<void>;

  /** 最近 interval 个 Tick 内有战斗的房间，按 Shard 分组。 */
  getPvp(interval: number): Promise<readonly PvpShard[]>;
  getNukes(): Promise<readonly Nuke[]>;
  getVersion(): Promise<ServerVersion>;
  getTime(shard: string): Promise<number>;
  getShards(): Promise<readonly ShardInfo[]>;
  getTerrain(shard: string, room: string): Promise<Terrain>;
  tileUrl(shard: string, room: string): string;
  /**
   * zoom2 块瓦片：一张图覆盖 4×4 个房间，按块西北角的房间命名；
   * 传入的房间必须是块角（有符号坐标都是 4 的倍数），否则 CDN 返回 403。
   */
  blockTileUrl(shard: string, cornerRoom: string): string;
  getWorldSize(shard: string): Promise<WorldSize>;
  /**
   * 房间的所有权、矿物与区域状态（`POST game/map-stats`，statName `minerals0`，
   * 需要全权限 token，每 Server 每小时 60 次）。
   * 调用方负责限流与缓存，见 World Map 的 ownership loader。
   */
  getMapStats(shard: string, rooms: readonly string[]): Promise<MapStats>;
  /** token 所属用户的 id 与房间 */
  getMe(): Promise<UserInfo>;
  /** 按用户 id 查玩家名（`user/find`，匿名即可）；查不到时拒绝。 */
  getUsername(id: string): Promise<string>;
  /**
   * 按用户 id 查玩家资料（`user/find`，匿名即可）；查不到时拒绝。
   * 同一 Source 内缓存：同一玩家只请求一次（失败的不缓存）；getUsername 共用这份缓存。
   */
  getPlayer(id: string): Promise<PlayerProfile>;
  /** base 必须按 chunk 大小对齐；历史不存在时得到 null。 */
  getHistoryChunk(shard: string, room: string, base: number): Promise<HistoryChunk | null>;

  /** 断开并停止一切流。 */
  close(): void;
}
