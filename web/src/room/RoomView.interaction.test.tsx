/**
 * #12：Room View 的交互——点选与详情、缩放平移与视口持久化、相邻房间切换。
 * #60：同格多个对象时弹出选择列表。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import { LABEL_MIN_ZOOM } from "./room-detail-rules.ts";
import { RoomView, type RoomViewProps } from "./RoomView.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 录制数据里站在道路上（23,14）的 creep：点它的格子会弹出选择列表 */
const CREEP = "6ac66da2ff77778f44a644e4";
/** (15,8)：container、道路、rampart 与一个 creep 叠在一格 */
const STACK = { x: 15, y: 8, creep: "6ac676b4216890e711f593b5", container: "6a9d18caf728787708186631", road: "6a9d3c78b6204f2174d10827", rampart: "6a9d469a0b7353c8bbe31ae4" };

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
    settle: () => {},
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
        <RoomView
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
  // 官方 creep 的底盘是以格子中心为圆心的圆
  const base = lastScene().primitives.find((p) => p.key === `${id}/base`);
  if (!base || base.kind !== "circle") throw new Error(`找不到 ${id}`);
  const vp = lastViewport();
  return [base.x * vp.scale + vp.x, base.y * vp.scale + vp.y];
}

/** 格子 (x, y) 中心的屏幕坐标 */
function cellScreen(x: number, y: number): [number, number] {
  const vp = lastViewport();
  return [(x + 0.5) * vp.scale + vp.x, (y + 0.5) * vp.scale + vp.y];
}

const pickList = () => container.querySelector<HTMLElement>("[data-testid=pick-list]");
const listed = () => [...pickList()!.querySelectorAll<HTMLElement>("[role=option]")].map((row) => row.dataset.objectId);

/** 等选择列表弹出后点其中一行 */
async function pickFrom(id: string) {
  await settle(() => expect(pickList()).not.toBeNull());
  pickList()!.querySelector<HTMLElement>(`[data-object-id="${id}"]`)!.click();
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

    // creep 站在道路上：先弹列表，选 creep
    tap(...screenOf(CREEP), pointerType);
    await pickFrom(CREEP);
    await settle(() => expect(container.querySelector("[data-testid=room-details]")).not.toBeNull());
    expect(pickList()).toBeNull();
    expect(field("[data-field=type]").textContent).toBe("creep");
    expect(field("[data-field=owner]").textContent).toBe("Xerxes_2");
    expect(field("[data-body-summary]").textContent).toMatch(/^\d+[A-Z]+( \d+[A-Z]+)*$/);
    expect(field("[data-field=body]").querySelectorAll(".body-grid__cell").length).toBeGreaterThan(0);
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
    await pickFrom(CREEP);
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
    // 我方建筑的贴图按“我方”颜色染色（没有当前用户时都按陌生人着色，不会出现这个颜色）
    await settle(() => {
      const owned = lastScene().primitives.filter((p) => p.kind === "image" && p.tint === DEFAULT_THEME.owned);
      expect(owned.length).toBeGreaterThan(0);
    });
  });

  it("关闭按钮收起详情", async () => {
    mount();
    await openRoom("W13S28");
    tap(...screenOf(CREEP), "mouse");
    await pickFrom(CREEP);
    await settle(() => field("[data-action=close-details]").click());
    await settle(() => expect(container.querySelector("[data-testid=room-details]")).toBeNull());
  });

  it("滚轮放大越过阈值后出现玩家名，拖拽平移", async () => {
    const names = () => lastScene().primitives.some((p) => p.key.endsWith("/owner-name"));
    mount();
    await openRoom("W13S28");
    const fitted = lastViewport();
    expect(fitted.scale).toBeLessThan(LABEL_MIN_ZOOM);
    expect(names()).toBe(false);

    for (let i = 0; i < 5; i++) wheel(-100);
    await settle(() => expect(lastViewport().scale).toBeGreaterThan(fitted.scale * 1.5));
    await settle(() => expect(names()).toBe(true));

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

  describe("同格选择列表（#60）", () => {
    it.each(["mouse", "touch"])("%s：两个以上对象时弹列表，creep → 建筑 → 道路 / rampart；选一行即选中并关闭", async (pointerType) => {
      mount();
      await openRoom("W13S28");
      tap(...cellScreen(STACK.x, STACK.y), pointerType);
      await settle(() => expect(pickList()).not.toBeNull());
      expect(listed()).toEqual([STACK.creep, STACK.container, STACK.rampart, STACK.road]);
      // 选择前不改变选中
      expect(container.querySelector("[data-testid=room-details]")).toBeNull();
      const rows = pickList()!.querySelectorAll("[role=option]");
      expect(rows[0]!.textContent).toContain("anchor-1024412-Spawn2");
      expect(rows[0]!.textContent).toContain("Xerxes_2");
      expect(rows[1]!.textContent).toContain("container");

      pickList()!.querySelector<HTMLElement>(`[data-object-id="${STACK.container}"]`)!.click();
      await settle(() => expect(field("[data-field=type]").textContent).toBe("container"));
      expect(pickList()).toBeNull();
      expect(lastScene().primitives.some((p) => p.key === `${STACK.container}/selected`)).toBe(true);
    });

    it("只有一个对象时直接选中，不弹列表", async () => {
      mount();
      await openRoom("W13S28");
      // (18,4) 只有一个 source
      tap(...cellScreen(18, 4), "touch");
      await settle(() => expect(field("[data-field=type]").textContent).toBe("source"));
      expect(pickList()).toBeNull();
    });

    it("只认站在这一格上的对象：贴图比一格大的 tower 不会从相邻格被点中", async () => {
      mount();
      await openRoom("W13S28");
      // (15,13) 是 tower，底座贴图 2 格宽；右边 (16,13) 只有道路
      tap(...cellScreen(16, 13), "mouse");
      await settle(() => expect(field("[data-field=type]").textContent).toBe("road"));
      expect(pickList()).toBeNull();
      // (9,7) 是 tower，左边 (8,7) 什么都没有
      tap(...cellScreen(8, 7), "mouse");
      await settle(() => expect(container.querySelector("[data-testid=room-details]")).toBeNull());
      // 点 tower 本格照常：它和 rampart 叠在一格，弹列表
      tap(...cellScreen(15, 13), "mouse");
      await settle(() => expect(pickList()).not.toBeNull());
      expect(listed()).toHaveLength(2);
      expect(listed()).toContain("6a9d95c951150f63501b522f");
    });

    it("键盘：列表获得焦点，上下移动，回车确认", async () => {
      mount();
      await openRoom("W13S28");
      tap(...cellScreen(STACK.x, STACK.y), "mouse");
      await settle(() => expect(pickList()).not.toBeNull());
      const list = pickList()!;
      expect(document.activeElement).toBe(list);
      const key = (k: string) => list.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      expect(list.querySelector("[aria-selected=true]")!.getAttribute("data-object-id")).toBe(STACK.creep);
      key("ArrowDown");
      key("ArrowDown");
      key("ArrowUp");
      expect(list.querySelector("[aria-selected=true]")!.getAttribute("data-object-id")).toBe(STACK.container);
      key("ArrowUp");
      key("ArrowUp");
      expect(list.querySelector("[aria-selected=true]")!.getAttribute("data-object-id")).toBe(STACK.road);
      key("Enter");
      await settle(() => expect(field("[data-field=type]").textContent).toBe("road"));
      expect(pickList()).toBeNull();
    });

    it("Esc、点列表外、平移、缩放都关闭列表，且不改变选中", async () => {
      mount();
      await openRoom("W13S28");
      const open = async () => {
        tap(...cellScreen(STACK.x, STACK.y), "mouse");
        await settle(() => expect(pickList()).not.toBeNull());
      };

      await open();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await settle(() => expect(pickList()).toBeNull());

      await open();
      document.body.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, bubbles: true }));
      await settle(() => expect(pickList()).toBeNull());

      await open();
      wheel(-100);
      await settle(() => expect(pickList()).toBeNull());

      await open();
      for (const [type, x] of [["pointerdown", 100], ["pointermove", 150], ["pointerup", 150]] as const) {
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: 100, pointerType: "touch", button: 0, bubbles: true }));
      }
      await settle(() => expect(pickList()).toBeNull());

      expect(container.querySelector("[data-testid=room-details]")).toBeNull();
    });

    it("点空格子清除选中并不弹列表", async () => {
      mount();
      await openRoom("W13S28");
      tap(...cellScreen(18, 4), "mouse");
      await settle(() => expect(container.querySelector("[data-testid=room-details]")).not.toBeNull());
      tap(1, 1, "mouse");
      await settle(() => expect(container.querySelector("[data-testid=room-details]")).toBeNull());
      expect(pickList()).toBeNull();
    });
  });
});
