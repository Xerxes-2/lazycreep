import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEffect, createRoot } from "solid-js";
import { SERVER_TILE_ROOT } from "../source/map-tiles.ts";
import { CONNECTION_STORAGE, createSettings } from "./settings.ts";

let dispose: (() => void) | undefined;

/** 建一份设置，并记录 effect 对 server() / token() 的重跑次数 */
function watched() {
  return createRoot((d) => {
    dispose = d;
    const settings = createSettings(localStorage);
    const runs = { server: 0, token: 0 };
    createEffect(() => {
      settings.server();
      runs.server++;
    });
    createEffect(() => {
      settings.token();
      runs.token++;
    });
    return { settings, runs };
  });
}

describe("连接设置的响应式粒度", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => dispose?.());

  it("切换 Shard 不触发依赖 Server 或 token 的计算", () => {
    const { settings, runs } = watched();
    settings.setShard("shard2");
    settings.setShard("shard3");
    expect(settings.shard()).toBe("shard3");
    expect(runs).toEqual({ server: 1, token: 1 });
  });

  it("Server 或 token 真正变化时才重跑", () => {
    const { settings, runs } = watched();
    settings.setToken("a");
    settings.setToken(" a ");
    expect(runs.token).toBe(2);
    settings.selectServer("season");
    expect(runs.server).toBe(1);
    settings.addCustomServer({ name: "Home", apiRoot: "/home", socketUrl: "wss://home", sharded: false });
    expect(runs.server).toBe(2);
  });
});

describe("自定义 Server 的瓦片", () => {
  beforeEach(() => localStorage.clear());

  it("新加的与旧版本存下的自定义 Server 都从 Gateway 的 /server-tiles 取瓦片，官方 Server 不变", () => {
    const old = { id: "custom-old", name: "Old", apiRoot: "/api", socketUrl: "ws://x", sharded: false };
    const stored = { serverId: old.id, customServers: [{ ...old, tileRoot: "/map-tiles", historyRoot: "/room-history" }] };
    localStorage.setItem(CONNECTION_STORAGE.key, JSON.stringify(stored));
    const settings = createSettings(localStorage);
    expect(settings.server().tileRoot).toBe(SERVER_TILE_ROOT);
    expect(settings.addCustomServer({ ...old, name: "New" })?.tileRoot).toBe(SERVER_TILE_ROOT);
    const official = settings.servers().filter((s) => !settings.isCustom(s.id));
    expect(official.map((s) => s.tileRoot)).toEqual(["/map-tiles", "/map-tiles", "/map-tiles"]);
  });
});
