// @vitest-environment node
/**
 * 开发服务器的 Gateway 代理：与 gateway/Caddyfile 同样的路径与 POST 允许名单。
 * 上游指向本地模拟服务器，不触网。
 */
import { createServer as createHttpServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
      const png = req.url?.startsWith("/map/") || req.url?.startsWith("/seasons/");
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
let seasonStatic: Awaited<ReturnType<typeof mockUpstream>>;
let vite: ViteDevServer;
let base: string;

beforeAll(async () => {
  api = await mockUpstream();
  tiles = await mockUpstream();
  seasonStatic = await mockUpstream();
  const root = mkdtempSync(join(tmpdir(), "msc-dev-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>dev</title>");
  vite = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [gatewayDevProxy({ apiUpstream: api.url, tilesUpstream: tiles.url, seasonStaticUpstream: seasonStatic.url })],
  });
  await vite.listen();
  const { port } = vite.httpServer!.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await vite.close();
  api.close();
  tiles.close();
  seasonStatic.close();
});

/** 三个模拟上游一共收到的请求数 */
const upstreamCount = () => api.seen.length + tiles.seen.length + seasonStatic.seen.length;

function send(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) {
  return fetch(base + path, { method, ...init });
}

/** 原样发出路径（fetch 会先规范化 URL，去掉 `..`），返回状态码 */
function sendRaw(method: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + "/", { method, path, headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
}

/** 与 gateway/test_gateway.py 的 BAD_PATHS 相同 */
const BAD_PATHS = [
  "/api/user/code/..%2F..%2Fuser/console",
  "/season/api/user%2Fcode",
  "/season/api/user%2fconsole",
  "/season/api/user/%2E%2E/code",
  "/ptr/api/%2e/user/console",
  "/season/api/game/map-stats/../../user/code",
  "/season/api/user/console/../code",
  "/season/api/./user/console",
  "/api/user/console/..",
  "/x/../api/user/console",
  "/room-history/shardSeason/..%2F..%2Fapi/1.json",
  "/room-history/shardSeason/W1N1/../../../api/user/code",
  "/map-tiles/../api/user/console",
  "/map-tiles/shardSeason%2F..%2FE0N0.png",
  "/season-static/season11/../../api/user/console",
  "/season-static/season11%2F..%2Frenderer/T.png",
  "/season-static/./season11/renderer/T.png",
];

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
    const before = upstreamCount();
    const attempts: [string, string][] = [
      ["POST", "/api/user/code"],
      ["POST", "/season/api/user/code"],
      ["POST", "/ptr/api/user/code"],
      ["POST", "/season/api/user/console/"],
      ["PUT", "/season/api/user/console"],
      ["DELETE", "/season/api/game/map-stats"],
      ["POST", "/room-history/shardSeason/W1N1/100.json"],
      ["POST", "/map-tiles/shardSeason/E0N0.png"],
    ];
    for (const [method, path] of attempts) {
      const res = await send(method, path, { body: "{}" });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(upstreamCount()).toBe(before);
  });

  it("原始路径含编码斜杠、编码点或 . / .. 段时返回 400，不到达上游（任何方法）", async () => {
    const before = upstreamCount();
    for (const path of BAD_PATHS) {
      for (const method of ["GET", "POST"]) {
        expect(await sendRaw(method, path), `${method} ${path}`).toBe(400);
      }
    }
    expect(upstreamCount()).toBe(before);
  });

  it("查询串里的编码斜杠不算", async () => {
    const path = "/api/user/find?username=a%2Fb/../c";
    expect(await sendRaw("GET", path)).toBe(200);
    expect(api.seen.some((r) => r.path === path)).toBe(true);
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

  it("赛季静态资源：GET / HEAD 转发到静态资源主机的 /seasons/ 路径，不带 token 与 cookie", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await send(method, "/season-static/season11/renderer/T.png", {
        headers: { "X-Token": TOKEN, Cookie: "CF_Authorization=secret" },
      });
      expect(res.status, method).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const got = seasonStatic.seen.find((r) => r.method === method && r.path === "/seasons/season11/renderer/T.png");
      expect(got, method).toBeDefined();
      expect(got?.headers.host).toBe(`127.0.0.1:${seasonStatic.port}`);
      expect(got?.headers["x-token"]).toBeUndefined();
      expect(got?.headers.cookie).toBeUndefined();
    }
    expect(api.seen.some((r) => r.path.startsWith("/seasons/"))).toBe(false);
  });

  it("赛季静态资源只读：GET / HEAD 以外的方法返回 403，不到达上游", async () => {
    const before = upstreamCount();
    // OPTIONS 由 Vite 自己的 CORS 中间件先回答，不经代理，这里不列
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await send(method, "/season-static/season11/renderer/T.png", { body: "{}" });
      expect(res.status, method).toBe(403);
    }
    for (const endpoint of routes.postAllowlist) {
      expect((await send("POST", `/season-static/${endpoint}`, { body: "{}" })).status, endpoint).toBe(403);
    }
    expect(upstreamCount()).toBe(before);
  });

  it("上游地址只在 routes.json 里写一份：Caddyfile 不写死默认值", () => {
    const caddyfile = readFileSync(new URL("../gateway/Caddyfile", import.meta.url), "utf8");
    for (const origin of [routes.apiOrigin, routes.tilesOrigin, routes.seasonStaticOrigin]) {
      expect(caddyfile).not.toContain(origin);
    }
    expect(caddyfile).toContain("{$MSC_API_UPSTREAM}");
    expect(caddyfile).toContain("{$MSC_TILES_UPSTREAM}");
    expect(caddyfile).toContain("{$MSC_SEASON_STATIC_UPSTREAM}");
  });

  it("不把 cookie 带给上游", async () => {
    await send("GET", "/api/game/world-size", { headers: { Cookie: "CF_Authorization=secret" } });
    expect(api.seen.find((r) => r.path === "/api/game/world-size")?.headers.cookie).toBeUndefined();
  });
});
