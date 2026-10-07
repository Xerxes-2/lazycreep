import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEffect, createRoot } from "solid-js";
import { createSettings } from "./settings.ts";

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
