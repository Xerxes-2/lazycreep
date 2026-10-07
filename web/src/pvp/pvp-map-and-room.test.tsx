import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import { manualVisibility } from "../power/visibility.ts";
import { parseReplayHref } from "../replay/replay-controller.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
/** 地图画布最近一次显示的 Scene */
let mapScene: Scene | undefined;
let firstCanvas: HTMLCanvasElement | undefined;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  firstCanvas ??= canvas;
  const isMap = canvas === firstCanvas;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => {
      if (isMap) mapScene = scene;
    },
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

function mount() {
  const settings = createSettings(localStorage);
  settings.setToken("token");
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom
          settings={settings}
          sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
          createView={fakeView}
          roomView={{ historyCache: async () => undefined }}
          visibility={manualVisibility(true)}
        />
      </I18nProvider>
    ),
    container,
  );
  return settings;
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const hotspots = () => (mapScene?.primitives ?? []).filter((p) => p.key.startsWith("pvp:")).map((p) => p.key);
const row = (room: string) => container.querySelector<HTMLElement>(`.pvp-overview tr[data-room="${room}"]`);

describe("PvP Overview 接入 World Map 与 Room View", () => {
  beforeEach(() => {
    localStorage.clear();
    mapScene = undefined;
    firstCanvas = undefined;
    history.replaceState(null, "", location.pathname);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", location.pathname);
  });

  it("地图上的热点随时间窗变化", async () => {
    mount();
    await settle(() => expect(hotspots()).toHaveLength(16));
    expect(hotspots()).toContain("pvp:W17N21");
    container.querySelector<HTMLButtonElement>('.pvp-overview button[data-window="20"]')!.click();
    await settle(() => expect(hotspots()).toHaveLength(6));
    expect(hotspots()).not.toContain("pvp:W17N17");
  });

  it("所有者经共享的所有权缓存补查；查不到的显示“未知”", async () => {
    mount();
    await settle(() => expect(row("W17S22")?.querySelector("[data-owner]")!.textContent).toBe("Odiodin（RCL 6）"));
    expect(row("W20S28")!.querySelector("[data-owner]")!.textContent).toBe("无主");
    expect(row("E13N21")!.querySelector("[data-owner]")!.textContent).toBe("未知");
  });

  it("点列表里的房间进入 Room View，地图隐藏", async () => {
    mount();
    await settle(() => expect(row("W17N21")).not.toBeNull());
    row("W17N21")!.querySelector<HTMLButtonElement>("[data-action=open-room]")!.click();
    expect(container.querySelector<HTMLElement>(".world-map__host")!.hidden).toBe(true);
    expect(container.querySelector<HTMLInputElement>("[name=room-view-room]")!.value).toBe("W17N21");
    expect(container.querySelector("button[data-action=back-to-map]")).not.toBeNull();
  });

  it("“回看这场战斗”打开该房间的 Replay，定位到最后战斗前 50 Tick；chunk 未生成时可退到已有历史", async () => {
    mount();
    await settle(() => expect(row("W17N21")).not.toBeNull());
    row("W17N21")!.querySelector<HTMLButtonElement>("[data-action=replay-battle]")!.click();
    expect(parseReplayHref(location.hash)).toEqual({ shard: "shardSeason", room: "W17N21", tick: 1025136, latest: true });
    await settle(() => expect(container.querySelector<HTMLInputElement>("[name=room-view-room]")!.value).toBe("W17N21"));
    expect(container.querySelector<HTMLElement>(".world-map__host")!.hidden).toBe(true);
  });
});
