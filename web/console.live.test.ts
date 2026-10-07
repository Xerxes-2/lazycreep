// @vitest-environment node
/**
 * Console 频道联调（#6）：只读订阅 `user:<id>/console`，确认认证、订阅无错误，收到的事件形状正确。
 * 默认跳过；`pnpm test:live`（SCREEPS_LIVE=1）开启，需要 SCREEPS_TOKEN（环境变量或仓库根目录 .env.local）。
 * 绝不发送 Console 命令（会在游戏里执行代码）；只断言形状与条数，不打印、不记录日志内容。
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { appendConsole, emptyConsoleLog } from "./src/console/console-log.ts";
import { LiveSource } from "./src/source/live-source.ts";
import { SERVER_PRESETS } from "./src/source/servers.ts";
import type { ConnectionState, ConsoleEvent, ServerConfig, StreamError } from "./src/source/source.ts";

const LIVE = process.env["SCREEPS_LIVE"] === "1";
const repoRoot = resolve(import.meta.dirname, "..");
const token = process.env["SCREEPS_TOKEN"] || loadEnv("test", repoRoot, "SCREEPS_")["SCREEPS_TOKEN"] || "";

function consoleStream(server: ServerConfig) {
  return async () => {
    const source = new LiveSource(server, { token, baseUrl: "https://screeps.com" });
    try {
      const states: ConnectionState[] = [];
      const events: ConsoleEvent[] = [];
      const errors: StreamError[] = [];
      source.onConnection((state) => states.push(state));
      source.subscribeConsole((event) => events.push(event), (error) => errors.push(error));

      // 用户脚本不一定每 Tick 都输出：等到第一条事件或 20 秒
      const deadline = Date.now() + 20_000;
      while (events.length === 0 && Date.now() < deadline) {
        if (states.includes("unauthorized")) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(states).toContain("authenticated");
      expect(errors).toEqual([]);
      for (const event of events) {
        expect(typeof event.shard).toBe("string");
        if (event.kind === "output") {
          expect(event.log.every((line) => typeof line === "string")).toBe(true);
          expect(event.results.every((line) => typeof line === "string")).toBe(true);
        } else expect(typeof event.error).toBe("string");
      }
      // 真实事件能被面板的日志模型按 Shard 归类
      const log = events.reduce((l, e) => appendConsole(l, e, 500), emptyConsoleLog());
      expect(log.shards.every((s) => typeof s === "string")).toBe(true);
    } finally {
      source.close();
    }
  };
}

describe.skipIf(!LIVE || token === "")("Console 频道联调（只读，不发命令）", () => {
  it("赛季服：订阅 Console 频道，事件带 Shard", consoleStream(SERVER_PRESETS.season), 30_000);
  it("MMO：订阅 Console 频道，事件带 Shard", consoleStream(SERVER_PRESETS.mmo), 30_000);
});
