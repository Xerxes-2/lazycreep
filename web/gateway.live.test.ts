// @vitest-environment node
/**
 * 联调测试：起真实的 Gateway（gateway/Caddyfile + caddy），经它请求 screeps.com 与瓦片 CDN。
 * 默认跳过；`pnpm test:live`（SCREEPS_LIVE=1）开启，需要 PATH 里有 caddy（devShell 提供）或设 CADDY。
 * token 从环境变量或仓库根目录的 .env.local 读取（SCREEPS_TOKEN），没有时跳过需要身份的用例。
 * 只读：不发 Console 命令、不写 memory；唯一的 POST 不带 token，用来确认 Gateway 拒绝名单外写操作。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { postAllowlistPaths } from "./gateway-dev.ts";
import { LiveSource } from "./src/source/live-source.ts";
import { SERVER_PRESETS } from "./src/source/servers.ts";
import { SourceError } from "./src/source/source.ts";

const LIVE = process.env["SCREEPS_LIVE"] === "1";
const repoRoot = resolve(import.meta.dirname, "..");
const token = process.env["SCREEPS_TOKEN"] || loadEnv("test", repoRoot, "SCREEPS_")["SCREEPS_TOKEN"] || "";

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? done(address.port) : fail(new Error("no port"))));
    });
  });
}

describe.skipIf(!LIVE)("经 Gateway 联调", () => {
  let gateway: ChildProcess;
  let base: string;

  beforeAll(async () => {
    const port = await freePort();
    const webRoot = mkdtempSync(join(tmpdir(), "msc-live-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>live</title>");
    const state = mkdtempSync(join(tmpdir(), "msc-caddy-"));
    gateway = spawn(
      process.env["CADDY"] ?? "caddy",
      ["run", "--adapter", "caddyfile", "--config", join(repoRoot, "gateway/Caddyfile")],
      {
        // 不继承 SCREEPS_TOKEN：Gateway 不需要 token
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: state,
          XDG_DATA_HOME: state,
          XDG_CONFIG_HOME: state,
          MSC_ADDRESS: "127.0.0.1",
          MSC_PORT: String(port),
          MSC_WEB_ROOT: webRoot,
          MSC_POST_ALLOWLIST: postAllowlistPaths().join(" "),
        },
        stdio: "ignore",
      },
    );
    base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    for (;;) {
      if (gateway.exitCode !== null) throw new Error(`caddy 退出：${gateway.exitCode}`);
      try {
        await fetch(`${base}/`);
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("Gateway 没有就绪");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }, 20_000);

  afterAll(() => {
    gateway?.kill();
  });

  const season = (withToken: string | undefined) =>
    new LiveSource(SERVER_PRESETS.season, { baseUrl: base, ...(withToken ? { token: withToken } : {}) });

  it("版本接口：200、JSON、带 historyChunkSize", async () => {
    const res = await fetch(`${base}/season/api/version`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const version = await season(undefined).getVersion();
    expect(version.historyChunkSize).toBeGreaterThan(0);
  });

  it("MMO 的版本接口同样可达", async () => {
    const res = await fetch(`${base}/api/version`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  });

  it("地图瓦片：200、PNG", async () => {
    const res = await fetch(`${base}/map-tiles/shardSeason/E0N0.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("时间与 Shard 列表", async () => {
    const source = season(undefined);
    const shards = await source.getShards();
    expect(shards.map((s) => s.name)).toContain("shardSeason");
    expect(await source.getTime("shardSeason")).toBeGreaterThan(0);
  });

  it("历史 chunk：存在时首 Tick 为 base，不存在时为 null", async () => {
    const source = season(undefined);
    const { historyChunkSize } = await source.getVersion();
    const time = await source.getTime("shardSeason");
    const base = Math.floor((time - 3 * historyChunkSize) / historyChunkSize) * historyChunkSize;
    const chunk = await source.getHistoryChunk("shardSeason", "W13S28", base);
    if (chunk) expect(chunk.ticks[0]?.gameTime).toBe(base);
  });

  it("名单外的 POST 被 Gateway 拒绝（不带 token）", async () => {
    const res = await fetch(`${base}/season/api/user/code`, { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("gateway");
  });

  it("无效 token 得到 unauthorized", async () => {
    const error = await season("not-a-real-token").getMe().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).kind).toBe("unauthorized");
  });

  it.skipIf(token === "")("有效 token 能识别身份", async () => {
    const me = await season(token).getMe();
    expect(me.id).toMatch(/^[0-9a-f]{24}$/);
    expect(me.username.length).toBeGreaterThan(0);
  });
});
