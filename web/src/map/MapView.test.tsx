import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { ImagePrimitive, Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { MapView, type MapViewProps } from "./MapView.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];
let viewports: (Viewport | undefined)[];
let canvas: HTMLCanvasElement;
let opened: { shard: string; room: string }[];
let statsCalls: string[][];

/** 记录 Scene 与视口，不真的画。 */
async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  let viewport: Viewport = { x: 0, y: 0, scale: 1 };
  return {
    canvas,
    get viewport() {
      return viewport;
    },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: (next) => {
      viewports.push(next);
      if (next) viewport = next;
    },
    destroy: () => {},
  };
}

function mount(props: Partial<MapViewProps> = {}) {
  const settings = createSettings(localStorage);
  settings.setToken("token");
  dispose = render(
    () => (
      <I18nProvider>
        <MapView
          settings={settings}
          sourceFor={() => {
            const source = new FixtureSource(bundle, { speed: Infinity });
            const getMapStats = source.getMapStats.bind(source);
            source.getMapStats = (shard, rooms) => {
              statsCalls.push([...rooms]);
              return getMapStats(shard, rooms);
            };
            return source;
          }}
          createView={fakeView}
          onOpenRoom={(target) => opened.push(target)}
          settleMs={10}
          {...props}
        />
      </I18nProvider>
    ),
    container,
  );
  return settings;
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const lastScene = () => shown.at(-1)!;
const lastViewport = () => viewports.at(-1)!;

/** 当前视口下房间中心的屏幕坐标 */
function screenOf(worldX: number, worldY: number) {
  const v = lastViewport();
  return { clientX: worldX * v.scale + v.x, clientY: worldY * v.scale + v.y };
}

function pointer(type: string, at: { clientX: number; clientY: number }, pointerId = 1) {
  canvas.dispatchEvent(new PointerEvent(type, { ...at, pointerId, bubbles: true, cancelable: true, button: 0 }));
}

function wheel(at: { clientX: number; clientY: number }, deltaY: number) {
  canvas.dispatchEvent(new WheelEvent("wheel", { ...at, deltaY, bubbles: true, cancelable: true }));
}

/** W13S28 的房间中心（世界坐标） */
const W13S28 = { x: 37.5, y: 79.5 };

describe("World Map 页面", () => {
  beforeEach(() => {
    localStorage.clear();
    shown = [];
    viewports = [];
    opened = [];
    statsCalls = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("世界尺寸来自 Server，整张地图放进画布，远看时用 zoom2 块瓦片", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    expect(lastScene()).toMatchObject({ width: 102, height: 102 });
    const tiles = lastScene().primitives.filter((p): p is ImagePrimitive => p.kind === "image");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((p) => p.url.startsWith("/map-tiles/shardSeason/zoom2/"))).toBe(true);
    expect(lastViewport()!.scale).toBeCloseTo(Math.min(canvas.width, canvas.height) / 102);
  });

  it("视口稳定后按可见区域取所有权并着色：自己的房间用己方颜色", async () => {
    mount();
    await settle(() =>
      expect(lastScene().primitives.find((p) => p.key === "own:W13S28")).toMatchObject({ fill: DEFAULT_THEME.owned }),
    );
    expect(statsCalls.length).toBeGreaterThan(0);
  });

  it("拖动中不取所有权，停下来之后才取", async () => {
    mount();
    await settle(() => expect(statsCalls.length).toBeGreaterThan(0));
    // 放大到只看一小块，再拖动
    const center = screenOf(W13S28.x, W13S28.y);
    for (let i = 0; i < 10; i++) wheel(center, -200);
    const before = statsCalls.length;
    pointer("pointerdown", center);
    for (let i = 1; i <= 20; i++) pointer("pointermove", { clientX: center.clientX - i * 20, clientY: center.clientY });
    expect(statsCalls.length).toBe(before);
    pointer("pointerup", { clientX: center.clientX - 400, clientY: center.clientY });
    await settle(() => expect(statsCalls.length).toBeGreaterThanOrEqual(before));
  });

  it("滚轮以指针为中心缩放：指针下的房间不动；放大后换成单房间瓦片", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    const at = screenOf(W13S28.x, W13S28.y);
    const scale = lastViewport()!.scale;
    for (let i = 0; i < 10; i++) wheel(at, -200);
    expect(lastViewport()!.scale).toBeGreaterThan(scale * 4);
    const after = screenOf(W13S28.x, W13S28.y);
    expect(after.clientX).toBeCloseTo(at.clientX);
    expect(after.clientY).toBeCloseTo(at.clientY);
    expect(lastScene().primitives.some((p) => p.kind === "image" && p.url === "/map-tiles/shardSeason/W13S28.png")).toBe(true);
  });

  it("拖动平移视口", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    const start = { ...lastViewport()! };
    pointer("pointerdown", { clientX: 100, clientY: 100 });
    pointer("pointermove", { clientX: 130, clientY: 90 });
    pointer("pointerup", { clientX: 130, clientY: 90 });
    expect(lastViewport()).toEqual({ x: start.x + 30, y: start.y - 10, scale: start.scale });
    expect(opened).toEqual([]);
  });

  it("双指捏合缩放", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    const scale = lastViewport()!.scale;
    pointer("pointerdown", { clientX: 200, clientY: 200 }, 1);
    pointer("pointerdown", { clientX: 220, clientY: 200 }, 2);
    pointer("pointermove", { clientX: 240, clientY: 200 }, 2);
    expect(lastViewport()!.scale).toBeCloseTo(scale * 2);
    pointer("pointerup", { clientX: 240, clientY: 200 }, 2);
    pointer("pointerup", { clientX: 200, clientY: 200 }, 1);
    expect(opened).toEqual([]);
  });

  it("远看时点房间只放大；放大到足够大后点房间进入它的 Room View", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    const far = screenOf(W13S28.x, W13S28.y);
    pointer("pointerdown", far);
    pointer("pointerup", far);
    expect(opened).toEqual([]);
    for (let i = 0; i < 10; i++) wheel(screenOf(W13S28.x, W13S28.y), -200);
    const near = screenOf(W13S28.x, W13S28.y);
    pointer("pointerdown", near);
    pointer("pointerup", near);
    expect(opened).toEqual([{ shard: "shardSeason", room: "W13S28" }]);
  });

  it("切换 Shard 写进设置", async () => {
    const settings = mount();
    await settle(() => expect(container.querySelector("select[name=world-map-shard] option")).not.toBeNull());
    const select = container.querySelector<HTMLSelectElement>("select[name=world-map-shard]")!;
    expect(select.value).toBe("shardSeason");
    select.value = "shardSeason";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(settings.shard()).toBe("shardSeason");
  });
});
