/**
 * 房间信息区块（#26）的数据：合并当前房间状态（控制器）与 OwnershipHub 已取到的 map-stats（纯函数，不发请求；
 * 区块显示时自己经 OwnershipHub.wantRooms 补查当前房间）。
 * 控制器给出的字段（所有者、RCL、安全模式、签名）优先；新手区与重生区只有 map-stats 有。
 */
import type { MapStats, RoomUser } from "../source/source.ts";
import type { RoomObject, RoomState } from "./room-state.ts";

/** 有截止时间的状态：undefined = 未知；false = 否；数字 = 截止时间（Unix 毫秒） */
export type Until = number | false | undefined;

export interface RoomInfo {
  readonly room: string;
  /** 所有者的玩家名（未知玩家时为用户 id）；无人拥有或未知时 undefined */
  readonly owner: string | undefined;
  /** 预定者 */
  readonly reservedBy: string | undefined;
  readonly level: number | undefined;
  readonly novice: Until;
  readonly respawnArea: Until;
  /** undefined = 未知；false = 否；数字 = 剩余 Tick（map-stats 只说“是”时为 true） */
  readonly safeMode: number | boolean | undefined;
  readonly sign: { readonly text: string; readonly user: string | undefined } | undefined;
}

export interface RoomInfoInput {
  readonly room: string;
  /** Room View 此刻显示的房间状态（须是同一个房间） */
  readonly state: RoomState | undefined;
  /** 该 Shard 已取到的 map-stats */
  readonly stats: MapStats | undefined;
  /** 当前时间（Unix 毫秒） */
  readonly now: number;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

export function roomInfo({ room, state, stats, now }: RoomInfoInput): RoomInfo {
  const users: Record<string, RoomUser> = { ...stats?.users, ...state?.users };
  const nameOf = (id: unknown) => (typeof id === "string" ? (users[id]?.username ?? id) : undefined);
  const controller: RoomObject | undefined = state
    ? Object.values(state.objects).find((obj) => obj["type"] === "controller")
    : undefined;
  const mapped = stats?.rooms[room];

  const level = typeof controller?.["level"] === "number" ? controller["level"] : undefined;
  const controllerOwner = text(controller?.["user"]);
  const reservation = record(controller?.["reservation"]);
  const statsOwner = mapped?.owner;

  const until = (at: number | undefined): Until => (mapped === undefined ? undefined : at !== undefined && at > now ? at : false);

  let safeMode: RoomInfo["safeMode"] = mapped === undefined ? undefined : (mapped.safeMode ?? false);
  if (controller && state?.gameTime !== undefined) {
    const end = controller["safeMode"];
    safeMode = typeof end === "number" && end > state.gameTime ? end - state.gameTime : false;
  }

  const sign = record(controller?.["sign"]) ?? mapped?.sign;
  const signText = text(sign?.["text"]);

  return {
    room,
    owner: controller
      ? nameOf(controllerOwner)
      : statsOwner && statsOwner.level > 0
        ? nameOf(statsOwner.user)
        : undefined,
    reservedBy: controller ? nameOf(reservation?.["user"]) : statsOwner && statsOwner.level === 0 ? nameOf(statsOwner.user) : undefined,
    level: controller ? (controllerOwner && level ? level : undefined) : statsOwner && statsOwner.level > 0 ? statsOwner.level : undefined,
    novice: until(mapped?.novice),
    respawnArea: until(mapped?.respawnArea),
    safeMode,
    sign: signText === undefined ? undefined : { text: signText, user: nameOf(sign?.["user"]) },
  };
}
