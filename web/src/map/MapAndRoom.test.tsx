import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        />
      </I18nProvider>
    ),
    container,
  );
  return settings;
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const mapCanvas = () => container.querySelector<HTMLCanvasElement>(".world-map canvas")!;
const mapHost = () => container.querySelector<HTMLElement>(".world-map__host")!;
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

  it("地图上点房间进入它的 Room View；返回地图时视口不变", async () => {
    mount();
    await settle(() => expect(viewports.get(mapCanvas())).toBeDefined());
    expect(backButton()).toBeNull();

    for (let i = 0; i < 10; i++) {
      mapCanvas().dispatchEvent(new WheelEvent("wheel", { ...at(W13S28), deltaY: -200, bubbles: true, cancelable: true }));
    }
    const zoomed = { ...viewports.get(mapCanvas())! };
    tap(at(W13S28));

    expect(mapHost().hidden).toBe(true);
    expect(roomInput().value).toBe("W13S28");
    await settle(() => expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).not.toBe("—"));

    backButton()!.click();
    expect(mapHost().hidden).toBe(false);
    expect(backButton()).toBeNull();
    expect(viewports.get(mapCanvas())).toEqual(zoomed);
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
});
