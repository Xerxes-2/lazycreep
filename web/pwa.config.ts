import type { VitePWAOptions } from "vite-plugin-pwa";

/**
 * Gateway 反代的路径（ADR 0001）。导航回退不得用缓存的应用外壳回答它们，
 * 否则直接打开这些 URL 会得到 index.html 而不是上游响应。
 */
const GATEWAY_PATHS = /^\/(?:api|season\/api|ptr\/api|room-history|map-tiles|season-static)(?:\/|$)/;

/**
 * service worker 只预缓存构建产出的静态资源，不做运行时缓存：
 * API 响应、历史 chunk、地图瓦片与赛季贴图（#47）一律走网络。
 */
export const pwaOptions = {
  registerType: "autoUpdate",
  injectRegister: "auto",
  manifest: {
    name: "Screeps 客户端",
    short_name: "Screeps",
    description: "轻快、省电的自用 Screeps 客户端",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1b1f24",
    theme_color: "#1b1f24",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  },
  workbox: {
    // 官方美术（#42）：SVG 由上一条覆盖，随附的 ISC LICENSE 与来源说明也一并预缓存
    globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,webmanifest}", "official-art/*.txt"],
    // 官方 PNG 纹理（#46，约 316 KB）只在官方画风画地形时按需请求、走 HTTP 缓存，不预缓存
    globIgnores: ["official-art/textures/**"],
    navigateFallback: "index.html",
    navigateFallbackDenylist: [GATEWAY_PATHS],
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
  },
} satisfies Partial<VitePWAOptions>;
