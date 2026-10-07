import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { createShellState } from "../shell/shell-state.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import { MapAndRoom } from "./MapAndRoom.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let viewports: Map<HTMLCanvasElement, Viewport>;
let scenes: Map<HTMLCanvasElement, Scene>;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    get viewport() {
      return viewports.get(canvas) ?? { x: 0, y: 0, scale: 1 };
    },
    show: (scene) => void scenes.set(canvas, scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: (next) => {
      if (next) viewports.set(canvas, next);
    },
    destroy: () => {},
  };
}

function mount() {
  dispose?.();
  container.innerHTML = "";
  const settings = createSettings(localStorage);
  settings.setToken("token");
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom
          settings={settings}
          shell={createShellState(localStorage, settings)}
          sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
          createView={fakeView}
          roomView={{ historyCache: async () => undefined }}
          narrow={() => false}
        />
      </I18nProvider>
    ),
    container,
  );
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const mapCanvas = () => container.querySelector<HTMLCanvasElement>(".world-map canvas")!;
const mapViewport = () => viewports.get(mapCanvas())!;
const mapScene = () => scenes.get(mapCanvas());
const section = (id: string) => container.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
const mapSections = () =>
  [...container.querySelectorAll<HTMLElement>("[data-section]")].filter((el) => !el.hidden).map((el) => el.dataset["section"]);
const layerBox = (toggle: string) => section("map.layers").querySelector<HTMLInputElement>(`input[name="map-layer-${toggle}"]`)!;

/** 在 Sidebar 的搜索框里输入并回车 */
function search(text: string) {
  const input = section("map.search").querySelector<HTMLInputElement>("input[name=world-map-search]")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function screenOf(world: { x: number; y: number }) {
  const v = mapViewport();
  return { clientX: world.x * v.scale + v.x, clientY: world.y * v.scale + v.y };
}

function pointer(type: string, at: { clientX: number; clientY: number }, pointerType: string) {
  mapCanvas().dispatchEvent(
    new PointerEvent(type, { ...at, pointerId: 1, pointerType, bubbles: true, cancelable: true, button: 0 }),
  );
}

const W13S28 = { x: 37.5, y: 79.5 };
const W12S23 = { x: 38.5, y: 74.5 };
const ownKeys = () => (mapScene()?.primitives ?? []).filter((p) => p.key.startsWith("own:")).map((p) => p.key);

describe("World Map 的 Sidebar 区块（#28）", () => {
  beforeEach(() => {
    localStorage.clear();
    viewports = new Map();
    scenes = new Map();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("区块顺序：房间搜索、图层、PvP Overview、指向房间信息；地图画布上不再有搜索表单", async () => {
    mount();
    expect(mapSections()).toEqual(["map.search", "map.layers", "map.pvp", "map.pointed"]);
    expect(section("map.pvp").querySelector(".pvp-overview")).not.toBeNull();
    expect(container.querySelector(".world-map form, .world-map input[name=world-map-search]")).toBeNull();
  });

  describe("房间搜索", () => {
    it("回车后地图居中到该房间（不分大小写），并放大到能看清房间", async () => {
      mount();
      await settle(() => expect(mapViewport()).toBeDefined());
      search(" w13s28 ");
      const center = screenOf(W13S28);
      expect(center.clientX).toBeCloseTo(mapCanvas().width / 2);
      expect(center.clientY).toBeCloseTo(mapCanvas().height / 2);
      expect(mapViewport().scale).toBeGreaterThanOrEqual(ICON_MIN_ZOOM);
      expect(container.querySelector("[role=alert]")).toBeNull();
    });

    it("不是房间名或在世界之外时提示，视口不动；之后搜到了提示消失", async () => {
      mount();
      await settle(() => expect(mapViewport()).toBeDefined());
      const before = { ...mapViewport() };
      search("hello");
      expect(section("map.search").querySelector("[role=alert]")!.textContent).toContain("hello");
      search("W99S99");
      expect(section("map.search").querySelector("[role=alert]")!.textContent).toContain("W99S99");
      expect(mapViewport()).toEqual(before);
      search("W13S28");
      expect(section("map.search").querySelector("[role=alert]")).toBeNull();
    });
  });

  describe("图层开关", () => {
    it("关掉所有权后地图不再画所有权；重新挂载后开关与地图都保持；再打开就恢复", async () => {
      mount();
      await settle(() => expect(ownKeys()).toContain("own:W13S28"));
      expect(layerBox("ownership").checked).toBe(true);
      layerBox("ownership").click();
      expect(layerBox("ownership").checked).toBe(false);
      await settle(() => expect(ownKeys()).toEqual([]));

      mount();
      expect(layerBox("ownership").checked).toBe(false);
      expect(layerBox("rcl").checked).toBe(true);
      await settle(() => expect(mapScene()?.primitives.some((p) => p.key.startsWith("rcl:") || p.kind === "image")).toBe(true));
      expect(ownKeys()).toEqual([]);

      layerBox("ownership").click();
      await settle(() => expect(ownKeys()).toContain("own:W13S28"));
    });
  });

  describe("指向房间信息", () => {
    it("鼠标悬停的房间显示所有者与 RCL，随指针更新；触摸点按也会更新", async () => {
      mount();
      await settle(() => expect(ownKeys()).toContain("own:W12S23"));
      const info = () => section("map.pointed").textContent ?? "";

      pointer("pointermove", screenOf(W13S28), "mouse");
      await settle(() => expect(info()).toContain("W13S28"));
      expect(info()).toContain("Xerxes_2");
      expect(info()).toContain("8");

      pointer("pointermove", screenOf(W12S23), "mouse");
      await settle(() => expect(info()).toContain("Odiodin"));
      expect(info()).toContain("7");

      pointer("pointerdown", screenOf(W13S28), "touch");
      pointer("pointerup", screenOf(W13S28), "touch");
      await settle(() => expect(info()).toContain("Xerxes_2"));
    });
  });
});
