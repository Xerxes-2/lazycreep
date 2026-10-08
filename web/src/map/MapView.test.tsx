import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { ImagePrimitive, Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { decodePixelImage } from "../scene/pixel-image.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { RoomMapUpdate } from "../source/source.ts";
import { ICON_MIN_ZOOM } from "./map-info-layers.ts";
import { MapView, type MapViewProps } from "./MapView.tsx";
import { createWorldMapLink, type WorldMapLink } from "./world-map-link.ts";

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
/** 当前订阅着的 roomMap2：房间 → 监听者 */
let roomMaps: Map<string, (update: RoomMapUpdate) => void>;
/** 搜索框在 Sidebar（#28）；这里直接经连接让地图居中 */
let link: WorldMapLink;

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

function mount(props: Partial<MapViewProps> = {}, shard?: string) {
  const settings = createSettings(localStorage);
  settings.setToken("token");
  if (shard !== undefined) settings.setShard(shard);
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
            source.subscribeRoomMap = (_shard, room, listener) => {
              roomMaps.set(room, listener);
              return () => roomMaps.delete(room);
            };
            return source;
          }}
          createView={fakeView}
          onOpenRoom={(target) => opened.push(target)}
          settleMs={10}
          link={link}
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

/** 房间搜索：让地图居中到房间 */
function search(text: string) {
  return link.centerOn(text);
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
    roomMaps = new Map();
    link = createWorldMapLink();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("世界尺寸来自 Server，整张地图放进画布，远看时用 zoom1 扇区瓦片", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    expect(lastScene()).toMatchObject({ width: 102, height: 102 });
    const tiles = lastScene().primitives.filter((p): p is ImagePrimitive => p.kind === "image");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((p) => p.url.startsWith("/season-static/season11/map/shardSeason/zoom1/"))).toBe(true);
    expect(lastViewport()!.scale).toBeCloseTo(Math.min(canvas.width, canvas.height) / 102);
  });

  it("设置里选过的 Shard 已不存在时，Shard 列表回来后换成第一个，不留错误", async () => {
    let sizeFailed = false;
    const settings = mount(
      {
        sourceFor: () => {
          const source = new FixtureSource(bundle, { speed: Infinity });
          const getWorldSize = source.getWorldSize.bind(source);
          source.getWorldSize = (shard) =>
            getWorldSize(shard).catch((error: unknown) => {
              sizeFailed = true;
              throw error;
            });
          // Shard 列表在旧 Shard 的世界尺寸失败之后才回来
          const getShards = source.getShards.bind(source);
          source.getShards = () => vi.waitFor(() => expect(sizeFailed).toBe(true)).then(getShards);
          return source;
        },
      },
      "shardGone",
    );
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    expect(sizeFailed).toBe(true);
    expect(lastScene()).toMatchObject({ width: 102, height: 102 });
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(settings.shard()).toBe("shardGone");
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
    expect(lastScene().primitives.some((p) => p.kind === "image" && p.url === "/season-static/season11/map/shardSeason/W13S28.png")).toBe(true);
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

  it("画布上方不再有 Shard 下拉框（Shard 由 Top Bar 切换）；操作提示放进画布的 title（#39）", async () => {
    mount();
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    const map = container.querySelector(".world-map")!;
    expect(map.querySelector("select")).toBeNull();
    expect(map.querySelector(".world-map__bar")).toBeNull();
    expect(map.querySelector<HTMLElement>(".world-map__canvas")!.title).toContain("缩放");
  });

  describe("房间名搜索（输入框与提示在 Sidebar，见 world-map-sections.test.tsx）", () => {
    it("回车后地图居中到该房间（不分大小写），并放大到能看清房间", async () => {
      mount();
      await settle(() => expect(shown.length).toBeGreaterThan(0));
      search(" w13s28 ");
      const center = screenOf(W13S28.x, W13S28.y);
      expect(center.clientX).toBeCloseTo(canvas.width / 2);
      expect(center.clientY).toBeCloseTo(canvas.height / 2);
      expect(lastViewport()!.scale).toBeGreaterThanOrEqual(ICON_MIN_ZOOM);
    });

    it("已经放得更大时保持缩放，只居中", async () => {
      mount();
      await settle(() => expect(shown.length).toBeGreaterThan(0));
      for (let i = 0; i < 20; i++) wheel(screenOf(10, 10), -200);
      const scale = lastViewport()!.scale;
      expect(scale).toBeGreaterThan(ICON_MIN_ZOOM * 2);
      search("W13S28");
      expect(lastViewport()!.scale).toBe(scale);
      expect(screenOf(W13S28.x, W13S28.y).clientX).toBeCloseTo(canvas.width / 2);
    });

    it("不是房间名或在世界之外时报告找不到，视口不动；地图还没就绪时不作答", async () => {
      expect(search("W13S28")).toBeUndefined();
      mount();
      await settle(() => expect(shown.length).toBeGreaterThan(0));
      const before = lastViewport();
      expect(search("hello")).toBe(false);
      expect(search("W99S99")).toBe(false);
      expect(lastViewport()).toEqual(before);
      expect(search("W13S28")).toBe(true);
    });
  });

  describe("信息层的数据", () => {
    it("Ally List 里的玩家（不分大小写）按盟友着色", async () => {
      mount({ allies: new Set(["odiodin"]) });
      await settle(() =>
        expect(lastScene().primitives.find((p) => p.key === "own:W12S23")).toMatchObject({ fill: DEFAULT_THEME.ally }),
      );
    });

    it("放大到图标级别才订阅可见房间的 roomMap2，Power Bank 画上地图；缩小后全部退订", async () => {
      mount();
      await settle(() => expect(shown.length).toBeGreaterThan(0));
      expect(roomMaps.size).toBe(0);
      search("W13S28");
      await settle(() => expect(roomMaps.has("W13S28")).toBe(true));
      expect(roomMaps.size).toBeLessThanOrEqual(100);
      roomMaps.get("W13S28")!({ pb: [[25, 25]], s: [[10, 10]] });
      await settle(() =>
        expect(lastScene().primitives.find((p) => p.key === "pb:W13S28:0")).toMatchObject({ kind: "circle" }),
      );
      expect(lastScene().primitives.find((p) => p.key === "units:W13S28")).toMatchObject({ kind: "image", blend: "add" });
      for (let i = 0; i < 10; i++) wheel(screenOf(W13S28.x, W13S28.y), 200);
      await settle(() => expect(roomMaps.size).toBe(0));
      expect(lastScene().primitives.some((p) => p.key.startsWith("units:"))).toBe(false);
    });

    it("同一动画帧里多个房间的 roomMap2 只让 Scene 重建一次，同一房间取最新一帧", async () => {
      mount();
      await settle(() => expect(shown.length).toBeGreaterThan(0));
      search("W13S28");
      await settle(() => expect(roomMaps.has("W13S28")).toBe(true));
      const other = [...roomMaps.keys()].find((room) => room !== "W13S28")!;
      roomMaps.get("W13S28")!({ s: [[1, 1]] });
      roomMaps.get(other)!({ s: [[1, 1]] });
      roomMaps.get("W13S28")!({ s: [[2, 2]] });
      await settle(() => expect(lastScene().primitives.filter((p) => p.key.startsWith("units:"))).toHaveLength(2));
      const before = shown.length;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(shown.length).toBe(before);
      const scenesWithUnits = shown.filter((s) => s.primitives.some((p) => p.key.startsWith("units:")));
      expect(scenesWithUnits).toHaveLength(1);
      const image = scenesWithUnits[0]!.primitives.find((p): p is ImagePrimitive => p.key === "units:W13S28")!;
      const pixels = decodePixelImage(image.url)!;
      expect(pixels.rgba[(2 * 50 + 2) * 4 + 3]).toBe(255);
      expect(pixels.rgba[(1 * 50 + 1) * 4 + 3]).toBe(0);
    });

    it("地图不活跃时（Room View 打开）不订阅 roomMap2", async () => {
      const [active, setActive] = createSignal(true);
      mount({
        get active() {
          return active();
        },
      });
      await settle(() => expect(shown.length).toBeGreaterThan(0));
      search("W13S28");
      await settle(() => expect(roomMaps.size).toBeGreaterThan(0));
      setActive(false);
      await settle(() => expect(roomMaps.size).toBe(0));
      setActive(true);
      await settle(() => expect(roomMaps.size).toBeGreaterThan(0));
    });
  });
});
