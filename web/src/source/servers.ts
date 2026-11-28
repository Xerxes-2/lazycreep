import type { ServerConfig } from "./source.ts";

/** 预置的官方 Server。HTTP 路径走同源 Gateway，WebSocket 直连官方。 */
export const SERVER_PRESETS = {
  season: {
    id: "season",
    name: "Season",
    apiRoot: "/season/api",
    socketUrl: "wss://screeps.com/season/socket/websocket",
    sharded: true,
    tileRoot: "/map-tiles",
    historyRoot: "/room-history",
  },
  mmo: {
    id: "mmo",
    name: "MMO",
    apiRoot: "/api",
    socketUrl: "wss://screeps.com/socket/websocket",
    sharded: true,
    tileRoot: "/map-tiles",
    historyRoot: "/room-history",
  },
  ptr: {
    id: "ptr",
    name: "PTR",
    apiRoot: "/ptr/api",
    socketUrl: "wss://screeps.com/ptr/socket/websocket",
    sharded: true,
    tileRoot: "/map-tiles",
    historyRoot: "/room-history",
  },
} as const satisfies Record<string, ServerConfig>;

export type ServerPresetId = keyof typeof SERVER_PRESETS;

/**
 * 官服与私服的唯一判据：预置的 Server（Season、MMO、PTR）是官服，用户自己加的自定义 Server 一律当私服。
 * 官服的限额（map-stats 每小时 60 次、roomMap2 同时订阅的上限等，见 docs/research/screeps-api-facts.md）
 * 只对官服生效；需要按官服 / 私服分别处理的地方都从这里取，不各自判断。
 */
export const isOfficialServer = (server: Pick<ServerConfig, "id">): boolean => Object.hasOwn(SERVER_PRESETS, server.id);
