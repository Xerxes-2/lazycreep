// @vitest-environment node
/**
 * WebSocket 联调：LiveSource 直连官方 WebSocket（不经 Gateway，ADR 0001），赛季服与 MMO 各一。
 * 默认跳过；`pnpm test:live`（SCREEPS_LIVE=1）开启，需要 SCREEPS_TOKEN（环境变量或仓库根目录 .env.local）。
 * HTTP 部分（取房间）在 Node 里直接请求 screeps.com 的同名路径，因为 Gateway 只是原样转发。
 * 只读：只订阅一个房间的 room: 频道，不发任何 Console 命令。
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { LiveSource } from "./src/source/live-source.ts";
import { SERVER_PRESETS } from "./src/source/servers.ts";
import type { ConnectionState, RoomTick, ServerConfig, StreamError } from "./src/source/source.ts";

const LIVE = process.env["SCREEPS_LIVE"] === "1";
const repoRoot = resolve(import.meta.dirname, "..");
const token = process.env["SCREEPS_TOKEN"] || loadEnv("test", repoRoot, "SCREEPS_")["SCREEPS_TOKEN"] || "";

/** 自己的房间（有就用，持续有变化），否则最近有战斗的房间。 */
async function pickRoom(source: LiveSource): Promise<{ shard: string; room: string }> {
  const me = await source.getMe();
  for (const [shard, rooms] of Object.entries(me.rooms)) {
    const room = rooms[0];
    if (room) return { shard, room };
  }
  for (const shard of await source.getPvp(100)) {
    const room = shard.rooms[0];
    if (room) return { shard: shard.shard, room: room.room };
  }
  throw new Error("找不到可订阅的房间");
}

function roomStream(server: ServerConfig) {
  return async () => {
    const source = new LiveSource(server, { token, baseUrl: "https://screeps.com" });
    try {
      const { shard, room } = await pickRoom(source);
      const states: ConnectionState[] = [];
      const ticks: RoomTick[] = [];
      const errors: StreamError[] = [];
      source.onConnection((state) => states.push(state));
      source.subscribeRoom(shard, room, (tick) => ticks.push(tick), (error) => errors.push(error));

      const deadline = Date.now() + 50_000;
      while (!(ticks.length >= 2 && ticks.some((t) => t.gameTime !== undefined)) && Date.now() < deadline) {
        if (states.includes("unauthorized")) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(states.slice(0, 3)).toEqual(["disconnected", "connecting", "authenticated"]);
      expect(errors).toEqual([]);
      // 首帧全量：对象带类型与坐标，没有 gameTime
      const [first, ...rest] = ticks;
      expect(first?.gameTime).toBeUndefined();
      const firstObjects = Object.values(first?.objects ?? {});
      expect(firstObjects.length).toBeGreaterThan(0);
      expect(firstObjects.every((o) => o !== null && typeof o["type"] === "string")).toBe(true);
      // 之后至少一帧增量，带 gameTime
      expect(rest.length).toBeGreaterThan(0);
      expect(typeof rest[0]?.gameTime).toBe("number");
    } finally {
      source.close();
    }
  };
}

describe.skipIf(!LIVE || token === "")("WebSocket 联调（只读）", () => {
  it("赛季服：认证、订阅一个房间，收到首帧与增量", roomStream(SERVER_PRESETS.season), 60_000);
  it("MMO：认证、订阅一个房间，收到首帧与增量", roomStream(SERVER_PRESETS.mmo), 60_000);

  it("无效 token：状态为 unauthorized", async () => {
    const source = new LiveSource(SERVER_PRESETS.season, { token: "not-a-real-token" });
    try {
      const states: ConnectionState[] = [];
      source.onConnection((state) => states.push(state));
      source.subscribeRoom("shardSeason", "E0N0", () => {});
      const deadline = Date.now() + 20_000;
      while (!states.includes("unauthorized") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(states).toContain("unauthorized");
      expect(states).not.toContain("authenticated");
    } finally {
      source.close();
    }
  }, 30_000);
});
