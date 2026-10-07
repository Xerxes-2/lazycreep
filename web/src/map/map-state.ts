/**
 * MapState：World Map 的纯数据状态——一个 Shard 的世界尺寸、瓦片地址与已知的房间统计（所有权等）。
 * 纯函数更新；buildMapScene 只读它。
 *
 * 坐标：
 * - 有符号房间坐标：E0 / S0 为 0，W0 / N0 为 -1（W13 = -14）
 * - 世界坐标（Scene 单位，1 = 一个房间）：有符号坐标 + 世界尺寸的一半，所以世界左上角是 [0, 0)
 *
 * 扩展点（#3 PvP 热点等）：在这里加字段，然后在 map-scene 的 MAP_LAYERS 里加一层。
 * 房间级信息（RCL、矿物、新手区……）随 RoomStats 扩展（来自 map-stats）；Power Bank 来自 roomMap2。
 */
import type { MapStats, RoomStats, RoomUser, WorldSize } from "../source/source.ts";

/** 瓦片地址；通常来自 Source.tileUrl / blockTileUrl。 */
export interface MapTiles {
  /** 单房间瓦片 */
  room(room: string): string;
  /** zoom2 块瓦片（4×4 个房间），参数是块西北角的房间 */
  block(cornerRoom: string): string;
}

export interface MapState {
  readonly shard: string;
  /** 以房间计 */
  readonly size: WorldSize;
  readonly tiles: MapTiles;
  /** 当前用户 id；着色时区分己方 */
  readonly me?: string;
  /** 已知的房间统计，按房间名；没查过或不存在的房间不在里面 */
  readonly rooms: Readonly<Record<string, RoomStats>>;
  readonly users: Readonly<Record<string, RoomUser>>;
  /** Ally List：玩家用户名，不分大小写 */
  readonly allies?: ReadonlySet<string>;
  /** 已订阅 roomMap2 的房间里的 Power Bank 位置（房间内格坐标）；没订阅过的房间不在里面 */
  readonly powerBanks: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
}

export interface RoomCoord {
  readonly x: number;
  readonly y: number;
}

const ROOM_NAME = /^([WE])(\d+)([NS])(\d+)$/;

export function parseRoomName(name: string): RoomCoord | undefined {
  const match = ROOM_NAME.exec(name);
  if (!match) return undefined;
  const h = Number(match[2]);
  const v = Number(match[4]);
  return { x: match[1] === "W" ? -h - 1 : h, y: match[3] === "N" ? -v - 1 : v };
}

export function roomName(coord: RoomCoord): string {
  const h = coord.x < 0 ? `W${-coord.x - 1}` : `E${coord.x}`;
  const v = coord.y < 0 ? `N${-coord.y - 1}` : `S${coord.y}`;
  return h + v;
}

/** 有符号坐标的偏移：世界坐标 = 有符号坐标 + offset */
export function worldOffset(size: WorldSize): RoomCoord {
  return { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) };
}

/** 世界坐标处的房间；世界之外为 undefined。 */
export function roomAtWorld(state: Pick<MapState, "size">, wx: number, wy: number): string | undefined {
  const cx = Math.floor(wx);
  const cy = Math.floor(wy);
  if (cx < 0 || cy < 0 || cx >= state.size.width || cy >= state.size.height) return undefined;
  const offset = worldOffset(state.size);
  return roomName({ x: cx - offset.x, y: cy - offset.y });
}

export function mapStateFrom(init: {
  readonly shard: string;
  readonly size: WorldSize;
  readonly tiles: MapTiles;
  readonly me?: string | undefined;
}): MapState {
  return {
    shard: init.shard,
    size: init.size,
    tiles: init.tiles,
    ...(init.me === undefined ? {} : { me: init.me }),
    rooms: {},
    users: {},
    powerBanks: {},
  };
}

/** 换 Ally List；名单内容没变时原样返回旧状态。 */
export function withAllies(state: MapState, allies: ReadonlySet<string>): MapState {
  const old = state.allies;
  if (old && old.size === allies.size && [...allies].every((name) => old.has(name))) return state;
  return { ...state, allies };
}

/** 记下一个房间当前的 Power Bank（roomMap2 的 `pb`）；与已知的相同时原样返回旧状态。 */
export function applyPowerBanks(
  state: MapState,
  room: string,
  positions: ReadonlyArray<readonly [number, number]>,
): MapState {
  const old = state.powerBanks[room];
  if (old && old.length === positions.length && old.every(([x, y], i) => positions[i]![0] === x && positions[i]![1] === y)) {
    return state;
  }
  return { ...state, powerBanks: { ...state.powerBanks, [room]: positions } };
}

/** 合并一次 map-stats：结果里的房间覆盖旧值，其余保留。别的 Shard 的结果原样返回旧状态。 */
export function applyMapStats(state: MapState, stats: MapStats): MapState {
  if (stats.shard !== state.shard) return state;
  return {
    ...state,
    rooms: { ...state.rooms, ...stats.rooms },
    users: { ...state.users, ...stats.users },
  };
}
