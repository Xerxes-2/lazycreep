// @vitest-environment node
/**
 * 开发服务器的 Gateway 代理：与 gateway/Caddyfile 同样的路径与 POST 允许名单。
 * 上游指向本地模拟服务器，不触网。
 */
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import routes from "../gateway/routes.json" with { type: "json" };
import { gatewayDevProxy } from "./gateway-dev.ts";

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

async function mockUpstream() {
  const seen: Seen[] = [];
  const server: Server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
      const png = req.url?.startsWith("/map/");
      res.writeHead(200, { "Content-Type": png ? "image/png" : "application/json" });
      res.end(png ? "png" : JSON.stringify({ ok: 1, echo: body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { seen, url: `http://127.0.0.1:${port}`, port, close: () => server.close() };
}

const TOKEN = "dev-token";
let api: Awaited<ReturnType<typeof mockUpstream>>;
let tiles: Awaited<ReturnType<typeof mockUpstream>>;
let vite: ViteDevServer;
let base: string;

beforeAll(async () => {
  api = await mockUpstream();
  tiles = await mockUpstream();
  const root = mkdtempSync(join(tmpdir(), "msc-dev-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>dev</title>");
  vite = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [gatewayDevProxy({ apiUpstream: api.url, tilesUpstream: tiles.url })],
  });
  await vite.listen();
  const { port } = vite.httpServer!.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await vite.close();
  api.close();
  tiles.close();
});

function send(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) {
  return fetch(base + path, { method, ...init });
}

describe("开发服务器的 Gateway 代理", () => {
  it("每个 API 前缀的 GET 都转发，带查询与 X-Token，Host 是上游", async () => {
    for (const prefix of routes.apiPrefixes) {
      const path = `${prefix}/game/time?shard=shardSeason`;
      const res = await send("GET", path, { headers: { "X-Token": TOKEN } });
      expect(res.status, path).toBe(200);
      const got = api.seen.find((r) => r.path === path);
      expect(got?.headers["x-token"]).toBe(TOKEN);
      expect(got?.headers.host).toBe(`127.0.0.1:${api.port}`);
    }
  });

  it("允许名单内的 POST 带 body 转发", async () => {
    for (const prefix of routes.apiPrefixes) {
      for (const endpoint of routes.postAllowlist) {
        const path = `${prefix}/${endpoint}`;
        const body = JSON.stringify({ probe: path });
        const res = await send("POST", path, { body, headers: { "Content-Type": "application/json" } });
        expect(res.status, path).toBe(200);
        expect(api.seen.find((r) => r.method === "POST" && r.path === path)?.body).toBe(body);
      }
    }
  });

  it("名单外的写操作返回 403，不到达上游", async () => {
    const before = api.seen.length + tiles.seen.length;
    const attempts: [string, string][] = [
      ["POST", "/api/user/code"],
      ["POST", "/season/api/user/code"],
      ["POST", "/ptr/api/user/code"],
      ["POST", "/season/api/user/console/"],
      ["POST", "/season/api/user/console/../code"],
      ["POST", "/season/api/user%2Fcode"],
      ["PUT", "/season/api/user/console"],
      ["DELETE", "/season/api/game/map-stats"],
      ["POST", "/room-history/shardSeason/W1N1/100.json"],
      ["POST", "/map-tiles/shardSeason/E0N0.png"],
    ];
    for (const [method, path] of attempts) {
      const res = await send(method, path, { body: "{}" });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(api.seen.length + tiles.seen.length).toBe(before);
  });

  it("room-history 转发到 API 上游", async () => {
    const path = "/room-history/shardSeason/W13S28/1024900.json";
    expect((await send("GET", path)).status).toBe(200);
    expect(api.seen.some((r) => r.path === path)).toBe(true);
  });

  it("地图瓦片转发到 CDN 的 /map/ 路径", async () => {
    const res = await send("GET", "/map-tiles/shardSeason/E0N0.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(tiles.seen.map((r) => r.path)).toContain("/map/shardSeason/E0N0.png");
  });

  it("不把 cookie 带给上游", async () => {
    await send("GET", "/api/game/world-size", { headers: { Cookie: "CF_Authorization=secret" } });
    expect(api.seen.find((r) => r.path === "/api/game/world-size")?.headers.cookie).toBeUndefined();
  });
});
