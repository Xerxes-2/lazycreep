/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.config.ts";
import { gatewayDevProxy } from "./gateway-dev.ts";

export default defineConfig({
  plugins: [solid(), VitePWA(pwaOptions), gatewayDevProxy()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "*.test.ts"],
  },
});
