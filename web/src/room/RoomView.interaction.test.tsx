/**
 * #12：Room View 的交互——点选与详情、缩放平移与视口持久化、相邻房间切换。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import { BAR_MIN_ZOOM } from "./room-detail-rules.ts";
import { RoomView, type RoomViewProps } from "./RoomView.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const CREEP = "6ac66da2ff77778f44a644e4";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];
let viewports: Viewport[];
let canvas: HTMLCanvasElement;
let subscriptions: Array<{ room: string; closed: boolean }>;
let storage: Map<string, string>;

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
      if (next) viewport = next;
      viewports.push(viewport);
    },
    destroy: () => {},
  };
}

/** 记录房间订阅与退订的 FixtureSource */
function trackingSource(): Source {
  const source = new FixtureSource(bundle, { speed: Infinity });
  const subscribe = source.subscribeRoom.bind(source);
  source.subscribeRoom = (shard, room, listener, onError) => {
    const record = { room, closed: false };
    subscriptions.push(record);
    const off = subscribe(shard, room, listener, onError);
    return () => {
      record.closed = true;
      off();
    };
  };
  return source;
}

let setOpen: (request: RoomViewProps["open"]) => void;

function mount(detailsMount?: HTMLElement, initial?: RoomViewProps["open"]) {
  dispose = render(() => {
    const [open, set] = createSignal<RoomViewProps["open"]>(initial);
    setOpen = set;
    return (
      <I18nProvider>
        <RoomView artStyle="geometric"
          settings={createSettings(localStorage)}
          sourceFor={trackingSource}
          createView={fakeView}
          historyCache={async () => undefined}
          allies={new Set()}
          cameraStorage={{ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) }}
          detailsMount={detailsMount}
          open={open()}
        />
      </I18nProvider>
    );
  }, container);
}

function field<T extends HTMLElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  return el;
}

/** 从外部打开房间（外壳里由 World Map、Minimap、PvP 卡片与 URL 经 shell.navigate 交给 Room View） */
function watch(room: string) {
  setOpen({ shard: "shardSeason", room });
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const tick = () => field(".room-view").dataset.tick;
const lastScene = () => shown.at(-1)!;
const lastViewport = () => viewports.at(-1)!;

function tap(sx: number, sy: number, pointerType: string) {
  for (const type of ["pointerdown", "pointerup"]) {
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: sx, clientY: sy, pointerType, button: 0, bubbles: true }));
  }
}

/** 对象所在格子中心的屏幕坐标 */
function screenOf(id: string): [number, number] {
  const body = lastScene().primitives.find((p) => p.key === `${id}/body`);
  if (!body || body.kind !== "circle") throw new Error(`找不到 ${id}`);
  const vp = lastViewport();
  return [body.x * vp.scale + vp.x, body.y * vp.scale + vp.y];
}

function wheel(deltaY: number, x = 300, y = 300) {
  canvas.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: x, clientY: y, cancelable: true }));
}

async function openRoom(room: string) {
  watch(room);
  await settle(() => expect(tick()).toBe("1025238"));
}

describe("Room View 交互", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/");
    shown = [];
    viewports = [];
    subscriptions = [];
    storage = new Map();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", "/");
  });

  it.each(["mouse", "touch"])("%s：点选 creep 显示详情并高亮，点空白收起", async (pointerType) => {
    mount();
    await openRoom("W13S28");
    expect(container.querySelector("[data-testid=room-details]")).toBeNull();

    tap(...screenOf(CREEP), pointerType);
    await settle(() => expect(container.querySelector("[data-testid=room-details]")).not.toBeNull());
    expect(field("[data-field=type]").textContent).toBe("creep");
    expect(field("[data-field=owner]").textContent).toBe("Xerxes_2");
    expect(field("[data-field=body]").textContent).toContain("work ×");
    expect(field("[data-field=ticksToLive]").textContent).toMatch(/^\d+$/);
    expect(field("[data-raw=actionLog]")).toBeDefined();
    expect(lastScene().primitives.some((p) => p.key === `${CREEP}/selected`)).toBe(true);

    // 房间左上角 (0,0) 是墙，没有对象
    tap(1, 1, pointerType);
    await settle(() => expect(container.querySelector("[data-testid=room-details]")).toBeNull());
    expect(lastScene().primitives.some((p) => p.key.endsWith("/selected"))).toBe(false);
  });

  it("给了 detailsMount（对象详情面板，#2）时详情画在那里，不在房间旁边", async () => {
    const mountEl = document.createElement("div");
    container.append(mountEl);
    mount(mountEl);
    await openRoom("W13S28");
    tap(...screenOf(CREEP), "mouse");
    await settle(() => expect(mountEl.querySelector("[data-testid=room-details]")).not.toBeNull());
    expect(container.querySelector(".room-view [data-testid=room-details]")).toBeNull();
    expect(mountEl.querySelector("[data-field=type]")!.textContent).toBe("creep");
  });

  it("Replay 期间点选作用于重放出来的对象", async () => {
    const SOURCE = "6a8caaaddd4872bccd319361";
    mount(undefined, { shard: "shardSeason", room: "W13S28", replay: { tick: 1024937 } });
    await settle(() => expect(lastScene()?.primitives.some((p) => p.objectId === SOURCE)).toBe(true));
    expect(subscriptions).toEqual([]);
    const vp = lastViewport();
    tap(18.5 * vp.scale + vp.x, 4.5 * vp.scale + vp.y, "touch");
    await settle(() => expect(field("[data-field=type]").textContent).toBe("source"));
    expect(field("[data-field=energy]").textContent).toMatch(/^\d+ \/ 3000$/);
  });

  it("我方对象按“我方”颜色画（当前用户来自 Source.getMe）", async () => {
    mount();
    await openRoom("W13S28");
    await settle(() => {
      const body = lastScene().primitives.find((p) => p.key === `${CREEP}/body`);
      expect(body?.kind === "circle" && body.fill).toBe(0x5d9cec);
    });
  });

  it("关闭按钮收起详情", async () => {
    mount();
    await openRoom("W13S28");
    tap(...screenOf(CREEP), "mouse");
    await settle(() => field("[data-action=close-details]").click());
    await settle(() => expect(container.querySelector("[data-testid=room-details]")).toBeNull());
  });

  it("滚轮放大越过阈值后出现血条，拖拽平移", async () => {
    mount();
    await openRoom("W13S28");
    const fitted = lastViewport();
    expect(fitted.scale).toBeLessThan(BAR_MIN_ZOOM);
    expect(lastScene().primitives.some((p) => p.kind === "bar")).toBe(false);

    for (let i = 0; i < 5; i++) wheel(-100);
    await settle(() => expect(lastViewport().scale).toBeGreaterThan(fitted.scale * 1.5));
    await settle(() => expect(lastScene().primitives.some((p) => p.kind === "bar")).toBe(true));

    const before = lastViewport();
    for (const [type, x] of [["pointerdown", 100], ["pointermove", 150], ["pointerup", 150]] as const) {
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: 100, pointerType: "mouse", button: 0, bubbles: true }));
    }
    expect(lastViewport().x).toBeCloseTo(before.x + 50);
    expect(lastViewport().scale).toBe(before.scale);
  });

  it("每个房间记住自己的视口，回到该房间时恢复", async () => {
    mount();
    await openRoom("W13S28");
    for (let i = 0; i < 4; i++) wheel(-100, 120, 200);
    const zoomed = lastViewport();
    expect([...storage.keys()].some((k) => k.includes("shardSeason/W13S28"))).toBe(true);

    watch("E13N21");
    await settle(() => expect(lastViewport().scale).toBeLessThan(zoomed.scale));
    watch("W13S28");
    await settle(() => expect(lastViewport()).toEqual(zoomed));
  });
});
