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
