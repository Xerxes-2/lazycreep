/**
 * Room View 预加载四个邻居房间的地形：当前房间的地形到了之后才在后台逐个请求（不与当前房间抢请求），
 * 经 Source 的地形缓存（terrain-cache.ts）每个房间每赛季只请求一次；页面隐藏时不预加载，失败静默。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility, type ManualVisibility } from "../power/visibility.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import type { ConnectionState, Source, Terrain } from "../source/source.ts";
import { RoomView } from "./RoomView.tsx";

/** 记下每次 getTerrain；当前房间（W13S28）的地形等测试放行 */
function recordingSource() {
  const requested: string[] = [];
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  const source = {
    server: SERVER_PRESETS.season,
    onConnection(listener: (state: ConnectionState) => void) {
      listener("authenticated");
      return () => {};
    },
    subscribeRoom: () => () => {},
    getWorldSize: async () => ({ width: 102, height: 102 }),
    getTerrain: async (shard: string, room: string): Promise<Terrain> => {
      requested.push(room);
      if (room === "W13S28") await held;
      else if (room === "W14S28") throw new Error("down");
      return { shard, room, encoded: "0".repeat(2500) };
    },
    getVersion: async () => ({ package: 1, protocol: 14, historyChunkSize: 100, mapTileRoot: null }),
    close() {},
  } as unknown as Source;
  return { source, requested, release: () => release!() };
}

async function view(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: () => {},
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let visibility: ManualVisibility;
let net: ReturnType<typeof recordingSource>;

function mount() {
  dispose = render(() => {
    const [request] = createSignal({ shard: "shardSeason", room: "W13S28" });
    return (
      <I18nProvider>
        <RoomView
          settings={createSettings(localStorage)}
          sourceFor={() => net.source}
          visibility={visibility}
          createView={view}
          historyCache={async () => undefined}
          open={request()}
        />
      </I18nProvider>
    );
  }, container);
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

describe("Room View 预加载邻居房间的地形", () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    net = recordingSource();
  });
  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it("当前房间的地形到了之后，逐个请求上、左、右、下四个邻居；某个失败不影响其余", async () => {
    visibility = manualVisibility(true);
    mount();
    await settle(() => expect(net.requested).toEqual(["W13S28"]));
    // 当前房间还没到：不抢请求
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(net.requested).toEqual(["W13S28"]);
    net.release();
    await settle(() => expect(net.requested).toEqual(["W13S28", "W13S27", "W14S28", "W12S28", "W13S29"]));
  });

  it("页面隐藏时不预加载", async () => {
    visibility = manualVisibility(true);
    mount();
    await settle(() => expect(net.requested).toEqual(["W13S28"]));
    visibility.set(false);
    net.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(net.requested).toEqual(["W13S28"]);
  });
});
