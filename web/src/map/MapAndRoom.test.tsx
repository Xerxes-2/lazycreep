import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { createShellState, type ShellState } from "../shell/shell-state.ts";
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
    settle: () => {},
    resize: () => {},
    setViewport: (next) => {
      if (next) viewports.set(canvas, next);
    },
    destroy: () => {},
  };
}

let shell: ShellState;

/** narrow：窄屏结构 */
function mount(narrow = false) {
  const settings = createSettings(localStorage);
  settings.setToken("token");
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom
          settings={settings}
          shell={(shell = createShellState(localStorage, settings))}
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
const slot = (view: string) => container.querySelector<HTMLElement>(`.main-view [data-view="${view}"]`)!;
const backButton = () => container.querySelector<HTMLButtonElement>("button[data-action=back-to-map]");
/** Room View 根元素：data-shard / data-room / data-tick 反映画面上的房间与 Tick */
const roomView = () => container.querySelector<HTMLElement>(".room-view")!.dataset;

function at(world: { x: number; y: number }) {
  const v = viewports.get(mapCanvas())!;
  return { clientX: world.x * v.scale + v.x, clientY: world.y * v.scale + v.y };
}

function tap(point: { clientX: number; clientY: number }) {
  for (const type of ["pointerdown", "pointerup"]) {
    mapCanvas().dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, bubbles: true, button: 0 }));
  }
}

/** 视口中心对应的世界坐标（画布尺寸来自假视图） */
function centerOf(v: { x: number; y: number; scale: number }) {
  const c = mapCanvas();
  return { x: (c.width / 2 - v.x) / v.scale, y: (c.height / 2 - v.y) / v.scale };
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

  it("地图上点房间：Main View 切到该房间的 Room View，地图不显示；返回地图时保持缩放并以该房间为中心", async () => {
    mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    const zoomed = { ...viewports.get(mapCanvas())! };
    tap(at(W13S28));

    expect(slot("map").hidden).toBe(true);
    expect(slot("room").hidden).toBe(false);
    expect(roomView().room).toBe("W13S28");
    expect(shell.location()).toMatchObject({ view: "room", room: "W13S28" });
    await settle(() => expect(roomView().tick).toBeDefined());

    backButton()!.click();
    expect(slot("map").hidden).toBe(false);
    expect(slot("room").hidden).toBe(true);
    await settle(() => {
      const v = viewports.get(mapCanvas())!;
      expect(v.scale).toBeCloseTo(zoomed.scale);
      expect(centerOf(v)).toEqual(expect.objectContaining({ x: expect.closeTo(W13S28.x, 3), y: expect.closeTo(W13S28.y, 3) }));
    });
  });

  it("在 Room View 里换了房间再返回地图：以最后看的房间为中心，缩放不变", async () => {
    mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    const zoomed = { ...viewports.get(mapCanvas())! };
    tap(at(W13S28));
    // 在 Room View 里经 navigate 换到西边相邻的 W14S28（Minimap、PvP、URL 都走这个入口）
    shell.navigate({ room: "W14S28" });
    expect(shell.location()).toMatchObject({ view: "room", room: "W14S28" });

    shell.navigate({ view: "map" });
    expect(slot("map").hidden).toBe(false);
    await settle(() => {
      const v = viewports.get(mapCanvas())!;
      expect(v.scale).toBeCloseTo(zoomed.scale);
      expect(centerOf(v)).toEqual(expect.objectContaining({ x: expect.closeTo(W13S28.x - 1, 3), y: expect.closeTo(W13S28.y, 3) }));
    });
  });

  it("切回 Room View 时房间与视口保持，不重建视图", async () => {
    mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    tap(at(W13S28));
    const roomCanvas = container.querySelector<HTMLCanvasElement>(".room-view canvas")!;
    await settle(() => expect(viewports.get(roomCanvas)).toBeDefined());
    const fitted = { ...viewports.get(roomCanvas)! };
    for (let i = 0; i < 3; i++) {
      roomCanvas.dispatchEvent(new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -200, bubbles: true, cancelable: true }));
    }
    const roomViewport = { ...viewports.get(roomCanvas)! };
    expect(roomViewport).not.toEqual(fitted);
    const views = canvases.length;

    shell.toggleMainView();
    expect(slot("room").hidden).toBe(true);
    shell.toggleMainView();
    expect(slot("room").hidden).toBe(false);
    expect(roomView().room).toBe("W13S28");
    expect(container.querySelector(".room-view canvas")).toBe(roomCanvas);
    expect(viewports.get(roomCanvas)).toEqual(roomViewport);
    expect(canvases).toHaveLength(views);
  });

  it("跨 Shard 打开房间：Shard 一并切换，返回地图后仍在那个 Shard 上", async () => {
    const settings = mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    shell.navigate({ shard: "shard2", room: "W1N1" });
    expect(settings.shard()).toBe("shard2");
    expect(slot("room").hidden).toBe(false);
    expect(roomView().shard).toBe("shard2");
    expect(roomView().room).toBe("W1N1");
    expect(shell.location()).toMatchObject({ view: "room", shard: "shard2", room: "W1N1" });
    backButton()!.click();
    expect(shell.location()).toMatchObject({ view: "map", shard: "shard2", room: "W1N1" });
  });

  it("断点变化时 Main View 不重建：地图视口与房间保持", async () => {
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
    expect(container.querySelector<HTMLElement>(".shell__body")!.dataset["layout"]).toBe("narrow");
    expect(slot("room").hidden).toBe(false);
    expect(mapCanvas()).toBe(canvas);
    expect(viewports.get(canvas)).toEqual(zoomed);
    expect(roomView().room).toBe("W13S28");
    expect(canvases).toHaveLength(views);
  });

  it("切换 Shard 后 Room View 不再显示旧 Shard 的房间", async () => {
    const settings = mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    tap(at(W13S28));
    await settle(() => expect(roomView().tick).toBeDefined());

    settings.setShard("shard2");
    expect(roomView().room).toBeUndefined();
    await settle(() => expect(roomView().tick).toBeUndefined());
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
    await settle(() => expect(roomView().tick).toBeDefined());
    await settle(() => expect(mapStats).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const leasesBefore = leases;
    const statsBefore = mapStats.mock.calls.filter((c) => c[0] === "shardSeason").length;

    // 重选同一个 Shard（例如从告警进入本 Shard 的房间）：房间留着，流不重订
    settings.setShard("shardSeason");
    expect(roomView().tick).toBeDefined();

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
