import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { MapAndRoom } from "./MapAndRoom.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
/** 每个画布最近一次设置的视口 */
let viewports: Map<HTMLCanvasElement, Viewport>;
let canvases: HTMLCanvasElement[];

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  canvases.push(canvas);
  return {
    canvas,
    get viewport() {
      return viewports.get(canvas) ?? { x: 0, y: 0, scale: 1 };
    },
    show: () => {},
    requestRender: () => {},
    resize: () => {},
    setViewport: (next) => {
      if (next) viewports.set(canvas, next);
    },
    destroy: () => {},
  };
}

/** narrow：Monitor Mode（一次只显示一个面板） */
function mount(narrow = false) {
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
          narrow={() => narrow}
        />
      </I18nProvider>
    ),
    container,
  );
  return settings;
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const mapCanvas = () => container.querySelector<HTMLCanvasElement>(".world-map canvas")!;
const panel = (id: string) => container.querySelector<HTMLElement>(`[data-panel="${id}"]`)!;
const backButton = () => container.querySelector<HTMLButtonElement>("button[data-action=back-to-map]");
const roomInput = () => container.querySelector<HTMLInputElement>("[name=room-view-room]")!;

function at(world: { x: number; y: number }) {
  const v = viewports.get(mapCanvas())!;
  return { clientX: world.x * v.scale + v.x, clientY: world.y * v.scale + v.y };
}

function tap(point: { clientX: number; clientY: number }) {
  for (const type of ["pointerdown", "pointerup"]) {
    mapCanvas().dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, bubbles: true, button: 0 }));
  }
}

/** W13S28 房间中心的世界坐标 */
const W13S28 = { x: 37.5, y: 79.5 };

describe("World Map 与 Room View", () => {
  beforeEach(() => {
    localStorage.clear();
    viewports = new Map();
    canvases = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("Monitor Mode：地图上点房间切到 Room View 标签；返回地图时视口不变", async () => {
    mount(true);
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    expect(backButton()).toBeNull();

    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    const zoomed = { ...viewports.get(mapCanvas())! };
    tap(at(W13S28));

    expect(panel("map").hidden).toBe(true);
    expect(panel("room").hidden).toBe(false);
    expect(container.querySelector('[data-tab="room"]')!.getAttribute("aria-selected")).toBe("true");
    expect(roomInput().value).toBe("W13S28");
    await settle(() => expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).not.toBe("—"));

    backButton()!.click();
    expect(panel("map").hidden).toBe(false);
    expect(panel("room").hidden).toBe(true);
    expect(viewports.get(mapCanvas())).toEqual(zoomed);
  });

  it("桌面布局：地图上点房间聚焦 Room View 面板，地图仍显示；返回地图聚焦地图，视口不变", async () => {
    mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    const zoomed = { ...viewports.get(mapCanvas())! };
    tap(at(W13S28));

    expect(panel("room").hasAttribute("data-focused")).toBe(true);
    expect(panel("map").hidden).toBe(false);
    expect(roomInput().value).toBe("W13S28");
    backButton()!.click();
    expect(panel("map").hasAttribute("data-focused")).toBe(true);
    expect(viewports.get(mapCanvas())).toEqual(zoomed);
  });

  it("切换布局（断点变化）时面板不重建：地图视口与房间保持", async () => {
    const [narrow, setNarrow] = createSignal(false);
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
            narrow={narrow}
          />
        </I18nProvider>
      ),
      container,
    );
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    tap(at(W13S28));
    const canvas = mapCanvas();
    const zoomed = { ...viewports.get(canvas)! };
    const views = canvases.length;

    setNarrow(true);
    expect(container.querySelector('[data-tab="room"]')!.getAttribute("aria-selected")).toBe("false");
    expect(panel("map").hidden).toBe(false);
    expect(mapCanvas()).toBe(canvas);
    expect(viewports.get(canvas)).toEqual(zoomed);
    expect(roomInput().value).toBe("W13S28");
    expect(canvases).toHaveLength(views);
  });

  it("切换 Shard 后 Room View 不再显示旧 Shard 的房间，Shard 输入跟随", async () => {
    const settings = mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    tap(at(W13S28));
    await settle(() => expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).not.toBe("—"));

    settings.setShard("shard2");
    expect(container.querySelector<HTMLInputElement>("[name=room-view-shard]")!.value).toBe("shard2");
    await settle(() => expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).toBe("—"));
  });

  it("切换 Shard 不换共享 Source 的租约、不重建所有权缓存；房间仍在新 Shard 上时 Room View 不中断", async () => {
    const settings = createSettings(localStorage);
    settings.setToken("token");
    settings.setShard("shardSeason");
    let leases = 0;
    let closed = 0;
    const mapStats = vi.spyOn(FixtureSource.prototype, "getMapStats");
    dispose = render(
      () => (
        <I18nProvider>
          <MapAndRoom
            settings={settings}
            sourceFor={() => {
              leases++;
              const created = new FixtureSource(bundle, { speed: Infinity });
              const close = created.close.bind(created);
              created.close = () => {
                closed++;
                close();
              };
              return created;
            }}
            createView={fakeView}
            roomView={{ historyCache: async () => undefined }}
          />
        </I18nProvider>
      ),
      container,
    );
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    tap(at(W13S28));
    await settle(() => expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).not.toBe("—"));
    await settle(() => expect(mapStats).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const leasesBefore = leases;
    const statsBefore = mapStats.mock.calls.filter((c) => c[0] === "shardSeason").length;

    // 重选同一个 Shard（例如从告警进入本 Shard 的房间）：房间留着，流不重订
    settings.setShard("shardSeason");
    expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).not.toBe("—");

    // 切走再切回：所有权缓存还在，不为同一区域重新请求 map-stats
    settings.setShard("shard2");
    settings.setShard("shardSeason");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leases).toBe(leasesBefore);
    expect(closed).toBe(0);
    expect(mapStats.mock.calls.filter((c) => c[0] === "shardSeason").length).toBe(statsBefore);
    mapStats.mockRestore();
  });
});
