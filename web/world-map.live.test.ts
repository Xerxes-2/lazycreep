// @vitest-environment node
/**
 * World Map 联调：真实的世界尺寸与 map-stats 驱动 MapState 与 buildMapScene（赛季服）。
 * 默认跳过；`pnpm test:live`（SCREEPS_LIVE=1）开启，需要 SCREEPS_TOKEN（环境变量或仓库根目录 .env.local）。
 * 只读；map-stats 每 Server 每小时限 60 次，这里只用 1 次。
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { buildMapScene } from "./src/map/map-scene.ts";
import { applyMapStats, mapStateFrom, parseRoomName, worldOffset } from "./src/map/map-state.ts";
import { DEFAULT_THEME } from "./src/scene/theme.ts";
import { LiveSource } from "./src/source/live-source.ts";
import { SERVER_PRESETS } from "./src/source/servers.ts";

const LIVE = process.env["SCREEPS_LIVE"] === "1";
const repoRoot = resolve(import.meta.dirname, "..");
const token = process.env["SCREEPS_TOKEN"] || loadEnv("test", repoRoot, "SCREEPS_")["SCREEPS_TOKEN"] || "";
const season = SERVER_PRESETS.season;

describe.skipIf(!LIVE)("World Map 联调（赛季服）", () => {
  it("世界尺寸与自己房间的所有权，着色进 Scene", { timeout: 30_000 }, async () => {
    const source = new LiveSource(season, { token, baseUrl: "https://screeps.com" });
    try {
      const me = await source.getMe();
      const [shard, rooms] = Object.entries(me.rooms).find(([, r]) => r.length > 0)!;
      const room = rooms[0]!;

      const size = await source.getWorldSize(shard);
      expect(size.width).toBeGreaterThan(10);
      expect(size.height).toBeGreaterThan(10);

      const stats = await source.getMapStats(shard, [room]);
      expect(stats.rooms[room]!.owner!.user).toBe(me.id);
      expect(stats.users[me.id]!.username).toBe(me.username);

      const state = applyMapStats(
        mapStateFrom({
          shard,
          size,
          me: me.id,
          tiles: { room: (r) => source.tileUrl(shard, r), block: (r) => source.blockTileUrl(shard, r) },
        }),
        stats,
      );
      const at = parseRoomName(room)!;
      const offset = worldOffset(size);
      const x = at.x + offset.x;
      const y = at.y + offset.y;
      const scene = buildMapScene(state, {
        theme: DEFAULT_THEME,
        zoom: 100,
        visible: { x0: x, y0: y, x1: x + 1, y1: y + 1 },
      });
      expect(scene.primitives.find((p) => p.key === `own:${room}`)).toMatchObject({ fill: DEFAULT_THEME.owned });
      expect(scene.primitives.find((p) => p.kind === "image")).toMatchObject({ url: `/map-tiles/${shard}/${room}.png` });
    } finally {
      source.close();
    }
  });
});
