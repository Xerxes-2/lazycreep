/**
 * 启动画面（#33）的整页行为：index.html 的内联启动画面由应用接管，阶段随 Source 的真实事件推进，
 * 完成后移除；失败时停在该阶段并给出出口。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import indexHtml from "../../index.html?raw";
import { App } from "../App.tsx";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { ConnectionState, Source } from "../source/source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * 由测试控制事件的假 Source：录制数据作底，但
 * - 连接状态由 `emit` 决定（初始 connecting）；
 * - 一切 HTTP 响应等 `http` 放行；
 * - 地图与房间数据（roomMap2、房间帧、map-stats、地形、历史）再等 `map` 放行。
 */
function controlledSource() {
  const listeners = new Set<(state: ConnectionState) => void>();
  let state: ConnectionState = "connecting";
  const http = deferred();
  const map = deferred();
  const MAP_CALLS = new Set(["getMapStats", "getTerrain", "getHistoryChunk"]);
  const factory = () => {
    const base = new FixtureSource(bundle, { speed: Infinity });
    return new Proxy(base, {
      get(target, prop) {
        if (prop === "onConnection")
          return (listener: (s: ConnectionState) => void) => {
            listeners.add(listener);
            listener(state);
            return () => listeners.delete(listener);
          };
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        const method = (value as (...args: unknown[]) => unknown).bind(target);
        if (prop === "subscribeRoomMap" || prop === "subscribeRoom")
          return (shard: string, room: string, listener: (data: unknown) => void, ...rest: unknown[]) =>
            method(shard, room, (data: unknown) => void map.promise.then(() => listener(data)), ...rest);
        if (typeof prop === "string" && (prop.startsWith("get") || MAP_CALLS.has(prop)))
          return async (...args: unknown[]) => {
            await http.promise;
            if (MAP_CALLS.has(prop)) await map.promise;
            return method(...args);
          };
        return method;
      },
    }) as Source;
  };
  return {
    factory,
    emit(next: ConnectionState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    releaseHttp: http.resolve,
    releaseMap: map.resolve,
  };
}

/** 画布由测试放行创建：在那之前 Main View 画不出任何一帧 */
function gatedViews() {
  const gate = deferred();
  const create = async (options: SceneViewOptions): Promise<SceneView> => {
    await gate.promise;
    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    return {
      canvas,
      viewport: { x: 0, y: 0, scale: 1 },
      show: () => {},
      requestRender: () => {},
      resize: () => {},
      setViewport: () => {},
      destroy: () => {},
    };
  };
  return { create, release: gate.resolve };
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

/** 把 index.html 里的内联启动画面原样放进页面 */
function insertBootMarkup() {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  const boot = doc.getElementById("boot");
  if (!boot) throw new Error("index.html 没有 #boot");
  document.body.prepend(document.importNode(boot, true));
}

function mount(source: ReturnType<typeof controlledSource>, views = gatedViews()) {
  dispose = render(() => <App sourceFor={source.factory} createView={views.create} />, container);
  return views;
}

function withToken() {
  localStorage.setItem("msc.settings", JSON.stringify({ token: "test-token" }));
}

const boot = () => document.getElementById("boot");
const stage = () => boot()?.dataset["bootStage"];
const phase = () => boot()?.dataset["bootPhase"];
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

beforeEach(() => {
  localStorage.clear();
  location.hash = "";
  insertBootMarkup();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  boot()?.remove();
});

describe("启动画面", () => {
  it("阶段随 Source 的事件依次推进，完成后移除", async () => {
    withToken();
    const source = controlledSource();
    const views = mount(source);

    // 程序已加载：等 Server 回应
    await settle(() => expect(stage()).toBe("connect"));
    expect(boot()!.textContent).toContain("连接 Server");

    source.releaseHttp();
    await settle(() => expect(stage()).toBe("auth"));

    source.emit("authenticated");
    await settle(() => expect(stage()).toBe("map"));

    source.releaseMap();
    await settle(() => expect(stage()).toBe("frame"));
    expect(boot()).not.toBeNull();

    views.release();
    await settle(() => expect(phase()).toBe("done"));
    await settle(() => expect(boot()).toBeNull());
    // 外壳一直在下面
    expect(container.querySelector(".shell")).not.toBeNull();
  });

  it("token 无效时停在认证阶段，“打开设置”进入应用并打开 Server 设置", async () => {
    withToken();
    const source = controlledSource();
    mount(source);
    source.releaseHttp();
    source.emit("unauthorized");

    await settle(() => expect(phase()).toBe("failed"));
    expect(stage()).toBe("auth");
    const open = boot()!.querySelector<HTMLButtonElement>("[data-action=boot-open-settings]");
    expect(open?.textContent).toBe("打开设置");

    open!.click();
    await settle(() => expect(boot()).toBeNull());
    expect(container.querySelector(".menu")?.getAttribute("data-item")).toBe("server");
  });

  it("没有 token 时直接进入应用，并在 Menu 里引导填写", async () => {
    const source = controlledSource();
    mount(source);
    await settle(() => expect(boot()).toBeNull());
    expect(container.querySelector(".menu")?.getAttribute("data-item")).toBe("server");
  });

  it("网络错误时显示重试", async () => {
    withToken();
    const source = controlledSource();
    mount(source);
    source.emit("reconnecting");

    await settle(() => expect(phase()).toBe("failed"));
    expect(stage()).toBe("connect");
    expect(boot()!.querySelector("[data-action=boot-retry]")?.textContent).toBe("重试");
  });

  it("URL 指向 Replay 时认证失败不阻止进入", async () => {
    withToken();
    location.hash = "#/replay?shard=shardSeason&room=W13S28&tick=1000";
    const source = controlledSource();
    const views = mount(source);
    source.releaseHttp();
    source.emit("unauthorized");
    source.releaseMap();
    views.release();

    await settle(() => expect(boot()).toBeNull());
    expect(container.querySelector(".menu")).toBeNull();
  });
});
