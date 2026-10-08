// @vitest-environment node
/**
 * Room View 联调：用真实房间流驱动 RoomState 归并与 buildRoomScene（赛季服，自己的房间）。
 * 默认跳过；`pnpm test:live`（SCREEPS_LIVE=1）开启，需要 SCREEPS_TOKEN（环境变量或仓库根目录 .env.local）。
 * 只读：只订阅一个房间的 room: 频道并拉地形 / 历史，不发任何 Console 命令。
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { buildRoomScene } from "./src/room/room-scene.ts";
import { reduceLiveTick, roomStateAt, type RoomState } from "./src/room/room-state.ts";
import { DEFAULT_THEME } from "./src/scene/theme.ts";
import type { Scene } from "./src/scene/scene.ts";
import { LiveSource } from "./src/source/live-source.ts";
import { SERVER_PRESETS } from "./src/source/servers.ts";

const LIVE = process.env["SCREEPS_LIVE"] === "1";
const repoRoot = resolve(import.meta.dirname, "..");
const token = process.env["SCREEPS_TOKEN"] || loadEnv("test", repoRoot, "SCREEPS_")["SCREEPS_TOKEN"] || "";
const season = SERVER_PRESETS.season;

describe.skipIf(!LIVE)("Room View 联调（赛季服）", () => {
  it(
    "真实房间逐 Tick 归并出 RoomState，每个 Tick 产出新的 Scene",
    async () => {
      const source = new LiveSource(season, { token, baseUrl: "https://screeps.com" });
      try {
        const me = await source.getMe();
        const [shard, rooms] = Object.entries(me.rooms).find(([, r]) => r.length > 0)!;
        const room = rooms[0]!;
        const terrain = await source.getTerrain(shard, room);

        let state: RoomState | undefined;
        const scenes: Scene[] = [];
        const times: number[] = [];
        source.subscribeRoom(shard, room, (tick) => {
          state = reduceLiveTick(state, tick);
          scenes.push(buildRoomScene({ state, terrain }, { theme: DEFAULT_THEME }));
          if (state.gameTime !== undefined) times.push(state.gameTime);
        });

        const deadline = Date.now() + 50_000;
        while (times.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));

        expect(times.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
        const final = state!;
        const last = scenes.at(-1)!;
        for (const id of Object.keys(final.objects)) {
          expect(last.primitives.some((p) => p.objectId === id)).toBe(true);
        }
        expect(last.primitives.some((p) => p.objectId === undefined)).toBe(true);
        const keys = last.primitives.map((p) => p.key);
        expect(new Set(keys).size).toBe(keys.length);

        // 同一个归并器重放历史 chunk（Replay 的接缝）
        const version = await source.getVersion();
        const base = Math.floor((times[0]! - 1000) / version.historyChunkSize) * version.historyChunkSize;
        const chunk = await source.getHistoryChunk(shard, room, base);
        expect(chunk).not.toBeNull();
        const target = chunk!.ticks.at(-1)!.gameTime;
        const replayed = roomStateAt(chunk!.ticks, target);
        expect(replayed.gameTime).toBe(target);
        expect(Object.keys(replayed.objects).length).toBeGreaterThan(0);
        const replayScene = buildRoomScene({ state: replayed, terrain }, { theme: DEFAULT_THEME });
        expect(replayScene.primitives.length).toBeGreaterThan(0);
      } finally {
        source.close();
      }
    },
    90_000,
  );
});
