/**
 * 开发与预览服务器上的 Gateway：与 gateway/Caddyfile 相同的代理路径与 POST 允许名单（ADR 0003），
 * 这样 `pnpm dev` 不必跑 Caddy。路径与名单都来自 gateway/routes.json。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ProxyOptions } from "vite";
import routes from "../gateway/routes.json" with { type: "json" };

export interface GatewayDevOptions {
  /** API 与 room-history 上游，默认 routes.json 的 apiOrigin */
  readonly apiUpstream?: string;
  /** 地图瓦片 CDN，默认 routes.json 的 tilesOrigin */
  readonly tilesUpstream?: string;
}

/** 允许转发的 POST 完整路径：每个 API 前缀 × 允许名单。 */
export function postAllowlistPaths(): string[] {
  return routes.apiPrefixes.flatMap((prefix) => routes.postAllowlist.map((endpoint) => `${prefix}/${endpoint}`));
}

/** 不带给上游的请求头，与 Caddyfile 的 upstream_headers 一致。 */
const STRIPPED_HEADERS = ["cookie", "cdn-loop", "x-http-method-override", "x-http-method", "x-method-override"];

const PROXIED_PREFIXES = [...routes.apiPrefixes.map((p) => `${p}/`), "/room-history/", "/map-tiles/"];

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

function writeGuard(): Middleware {
  const allowed = new Set(postAllowlistPaths());
  return (req, res, next) => {
    // URL 解析会去掉 `..`，与上游看到的路径一致；百分号编码保持原样，不会误放行
    const path = new URL(req.url ?? "/", "http://gateway.invalid").pathname;
    if (!PROXIED_PREFIXES.some((prefix) => path.startsWith(prefix))) return next();
    const method = req.method ?? "GET";
    if (method === "GET" || method === "HEAD" || (method === "POST" && allowed.has(path))) return next();
    res.statusCode = 403;
    res.end("gateway: write not allowed");
  };
}

function proxyTable(apiUpstream: string, tilesUpstream: string): Record<string, ProxyOptions> {
  const configure: ProxyOptions["configure"] = (proxy) => {
    proxy.on("proxyReq", (proxyReq) => {
      for (const name of STRIPPED_HEADERS) proxyReq.removeHeader(name);
      for (const name of proxyReq.getHeaderNames()) if (name.startsWith("cf-")) proxyReq.removeHeader(name);
    });
  };
  const api: ProxyOptions = { target: apiUpstream, changeOrigin: true, configure };
  return {
    ...Object.fromEntries(routes.apiPrefixes.map((prefix) => [`${prefix}/`, api])),
    "/room-history/": api,
    "/map-tiles/": {
      target: tilesUpstream,
      changeOrigin: true,
      configure,
      rewrite: (path) => path.replace(/^\/map-tiles\//, "/map/"),
    },
  };
}

export function gatewayDevProxy(options: GatewayDevOptions = {}): Plugin {
  const proxy = proxyTable(options.apiUpstream ?? routes.apiOrigin, options.tilesUpstream ?? routes.tilesOrigin);
  const guard = writeGuard();
  return {
    name: "msc-gateway-dev",
    config: () => ({ server: { proxy }, preview: { proxy } }),
    // 在这里直接挂的中间件排在 Vite 内置中间件（含 proxy）之前
    configureServer(server) {
      server.middlewares.use(guard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard);
    },
  };
}
