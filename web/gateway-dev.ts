/**
 * 开发与预览服务器上的 Gateway：与 gateway/Caddyfile 相同的代理路径与 POST 允许名单（ADR 0003）、
 * 只读的赛季静态资源路径（#47），
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
  /** 赛季静态资源主机（#47），默认 routes.json 的 seasonStaticOrigin */
  readonly seasonStaticUpstream?: string;
}

/** 允许转发的 POST 完整路径：每个 API 前缀 × 允许名单。 */
export function postAllowlistPaths(): string[] {
  return routes.apiPrefixes.flatMap((prefix) => routes.postAllowlist.map((endpoint) => `${prefix}/${endpoint}`));
}

/** 不带给上游的请求头，与 Caddyfile 的 upstream_headers 一致。 */
const STRIPPED_HEADERS = ["cookie", "cdn-loop", "x-http-method-override", "x-http-method", "x-method-override"];

/** 赛季静态资源（#47）：只读，转发到静态资源主机的 /seasons/ 下 */
const SEASON_STATIC_PREFIX = "/season-static/";

const PROXIED_PREFIXES = [...routes.apiPrefixes.map((p) => `${p}/`), "/room-history/", "/map-tiles/", SEASON_STATIC_PREFIX];

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/**
 * 原始路径（不含查询串）里有编码斜杠（%2F）、编码点（%2E）或 `.` / `..` 段。
 * 这类路径在 Gateway 与上游眼里可能是两个不同的端点，代理路径上一律拒绝（400），与 Caddyfile 一致。
 */
export function isAmbiguousPath(rawUrl: string): boolean {
  const path = rawUrl.split("?", 1)[0]!;
  return /%2[ef]/i.test(path) || path.split("/").some((segment) => segment === "." || segment === "..");
}

function writeGuard(): Middleware {
  const allowed = new Set(postAllowlistPaths());
  return (req, res, next) => {
    const raw = req.url ?? "/";
    const path = new URL(raw, "http://gateway.invalid").pathname;
    if (!PROXIED_PREFIXES.some((prefix) => path.startsWith(prefix) || raw.startsWith(prefix))) return next();
    if (isAmbiguousPath(raw)) {
      res.statusCode = 400;
      res.end("gateway: ambiguous path");
      return;
    }
    const method = req.method ?? "GET";
    if (method === "GET" || method === "HEAD") return next();
    const readOnly = path.startsWith(SEASON_STATIC_PREFIX) || raw.startsWith(SEASON_STATIC_PREFIX);
    if (!readOnly && method === "POST" && allowed.has(path)) return next();
    res.statusCode = 403;
    res.end(readOnly ? "gateway: read only" : "gateway: write not allowed");
  };
}

function proxyTable(apiUpstream: string, tilesUpstream: string, seasonStaticUpstream: string): Record<string, ProxyOptions> {
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
    [SEASON_STATIC_PREFIX]: {
      target: seasonStaticUpstream,
      changeOrigin: true,
      configure: (proxy, options) => {
        configure(proxy, options);
        // 静态资源主机不需要身份，token 不带过去（与 Caddyfile 一致）
        proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("x-token"));
      },
      rewrite: (path) => path.replace(/^\/season-static\//, "/seasons/"),
    },
  };
}

export function gatewayDevProxy(options: GatewayDevOptions = {}): Plugin {
  const proxy = proxyTable(
    options.apiUpstream ?? routes.apiOrigin,
    options.tilesUpstream ?? routes.tilesOrigin,
    options.seasonStaticUpstream ?? routes.seasonStaticOrigin,
  );
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
