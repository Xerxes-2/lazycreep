/**
 * #29：窄屏结构——Sidebar 变为底部半屏面板、区块变为标签；Console 进 Menu；断点切换不重建 Main View。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../App";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import type { Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { createShellState, type ShellState } from "./shell-state.ts";
import { SIDEBAR_SECTIONS, type SidebarSectionDef } from "./sidebar-sections.tsx";

const styles = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 测试专用的假区块：验证标签只由区块表驱动 */
const FAKE: SidebarSectionDef = {
  id: "test.fake",
  title: "shell.sidebar",
  render: (_ctx, section) => <p data-testid="fake-section" data-shown={String(section.shown())} />,
};
const roomSections = SIDEBAR_SECTIONS.room as SidebarSectionDef[];

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mountApp(narrow: Accessor<boolean>) {
  dispose?.();
  container.innerHTML = "";
  dispose = render(() => <App sourceFor={() => new FixtureSource(bundle, { speed: Infinity })} narrow={narrow} />, container);
}

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const all = <T extends Element = HTMLElement>(selector: string) => [...container.querySelectorAll<T>(selector)];
const press = (key: string) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const tabs = () => all<HTMLButtonElement>(".sidebar [role=tab]").map((b) => b.dataset["tab"]);
const selectedTab = () => all<HTMLButtonElement>(".sidebar [role=tab]").find((b) => b.getAttribute("aria-selected") === "true")?.dataset["tab"];
/** 屏幕上（面板打开、区块未隐藏、区块内容未隐藏）的区块 id */
const shownSections = () =>
  q(".sidebar")!.hidden
    ? []
    : all("[data-section]")
        .filter((el) => !el.hidden && !el.querySelector<HTMLElement>(".sidebar-section__body")!.hidden)
        .map((el) => el.dataset["section"]);
const menuItems = () => all<HTMLButtonElement>("[data-menu-item]").map((b) => b.dataset["menuItem"]);

function swipe(el: Element, fromY: number, toY: number) {
  el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: fromY, bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: toY, bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 100, clientY: toY, bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", location.pathname);
  container = document.createElement("div");
  document.body.append(container);
  roomSections.push(FAKE);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  roomSections.splice(roomSections.indexOf(FAKE), 1);
});

describe("窄屏结构（#29）", () => {
  it("Sidebar 渲染为底部面板，区块表里的每个区块是一个标签，一次显示一个", () => {
    mountApp(() => true);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    const sheet = q(".sidebar")!;
    expect(sheet.dataset["sheet"]).toBe("bottom");
    expect(tabs()).toEqual(SIDEBAR_SECTIONS.map.map((s) => s.id));
    expect(shownSections()).toEqual([SIDEBAR_SECTIONS.map[0]!.id]);

    press("m");
    expect(tabs()).toEqual(SIDEBAR_SECTIONS.room.map((s) => s.id));
    expect(tabs().at(-1)).toBe("test.fake");
    expect(selectedTab()).toBe(SIDEBAR_SECTIONS.room[0]!.id);
    expect(shownSections()).toEqual([SIDEBAR_SECTIONS.room[0]!.id]);
    expect(q("[data-testid=fake-section]")!.dataset["shown"]).toBe("false");

    q<HTMLButtonElement>('.sidebar [role=tab][data-tab="test.fake"]')!.click();
    expect(selectedTab()).toBe("test.fake");
    expect(shownSections()).toEqual(["test.fake"]);
    expect(q("[data-testid=fake-section]")!.dataset["shown"]).toBe("true");
  });

  it("窄屏下折叠状态不藏标签内容；区块标题按钮让位给标签", () => {
    localStorage.setItem("msc.shell", JSON.stringify({ collapsed: { "map.search": true } }));
    mountApp(() => true);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(shownSections()).toEqual(["map.search"]);
    expect(q('[data-section="map.search"] .sidebar-section__title')!.hidden).toBe(true);
  });

  it("点关闭或下滑收起底部面板；Top Bar 的 Sidebar 按钮重新打开", () => {
    mountApp(() => true);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    q<HTMLButtonElement>("[data-action=close-sheet]")!.click();
    expect(q(".sidebar")!.hidden).toBe(true);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(q(".sidebar")!.hidden).toBe(false);

    const handle = q("[data-sheet-handle]")!;
    swipe(handle, 100, 120);
    expect(q(".sidebar")!.hidden).toBe(false);
    swipe(handle, 100, 200);
    expect(q(".sidebar")!.hidden).toBe(true);
  });

  it("窄屏首次进入时底部面板默认收起，宽屏 Sidebar 默认打开", () => {
    mountApp(() => true);
    expect(q(".sidebar")!.hidden).toBe(true);
    mountApp(() => false);
    expect(q(".sidebar")!.hidden).toBe(false);
  });

  it("窄屏与宽屏各自记住开合：竖屏收起面板不连带收起横屏 Sidebar，反之亦然", () => {
    const [narrow, setNarrow] = createSignal(false);
    mountApp(narrow);
    expect(q(".sidebar")!.hidden).toBe(false);

    setNarrow(true);
    expect(q(".sidebar")!.hidden).toBe(true);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(q(".sidebar")!.hidden).toBe(false);
    q<HTMLButtonElement>("[data-action=close-sheet]")!.click();
    expect(q(".sidebar")!.hidden).toBe(true);

    setNarrow(false);
    expect(q(".sidebar")!.hidden).toBe(false);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(q(".sidebar")!.hidden).toBe(true);

    setNarrow(true);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(q(".sidebar")!.hidden).toBe(false);
    setNarrow(false);
    expect(q(".sidebar")!.hidden).toBe(true);

    // 重新挂载后两种状态都保持
    mountApp(narrow);
    expect(q(".sidebar")!.hidden).toBe(true);
    setNarrow(true);
    expect(q(".sidebar")!.hidden).toBe(false);
  });

  it("旧版只存了一个开合值：迁移为宽屏状态，窄屏仍默认收起", () => {
    localStorage.setItem("msc.shell", JSON.stringify({ sidebarOpen: false }));
    const [narrow, setNarrow] = createSignal(false);
    mountApp(narrow);
    expect(q(".sidebar")!.hidden).toBe(true);
    setNarrow(true);
    expect(q(".sidebar")!.hidden).toBe(true);

    localStorage.setItem("msc.shell", JSON.stringify({ sidebarOpen: true }));
    mountApp(narrow);
    expect(q(".sidebar")!.hidden).toBe(true);
    setNarrow(false);
    expect(q(".sidebar")!.hidden).toBe(false);
  });

  it("Console Panel 不显示，Top Bar 没有 Console 按钮；Menu 里多出 Console 项并能打开 Console", () => {
    mountApp(() => true);
    expect(q("[data-console-panel]")).toBeNull();
    expect(q("[data-action=toggle-console]")).toBeNull();
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    expect(menuItems()[0]).toBe("console");
    q<HTMLButtonElement>('[data-menu-item="console"]')!.click();
    expect(q('[data-menu-content="console"] form[data-console-send]')).not.toBeNull();
  });

  it("宽屏 Menu 没有 Console 项，Console Panel 照常", () => {
    mountApp(() => false);
    expect(q("[data-console-panel]")).not.toBeNull();
    expect(q("[data-action=toggle-console]")).not.toBeNull();
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    expect(menuItems()).not.toContain("console");
    expect(q(".sidebar [role=tab]")).toBeNull();
  });

  it("断点来回切换：Main View 的两个视图实例与房间不变，面板结构随之切换", () => {
    const [narrow, setNarrow] = createSignal(false);
    // 按地址打开房间（#32）
    history.replaceState(null, "", "/#!/season/room/shardSeason/W13S28");
    mountApp(narrow);
    const shownRoom = () => q<HTMLElement>(".room-view")!.dataset.room;
    expect(shownRoom()).toBe("W13S28");
    const roomView = q(".room-view");
    const mapView = q(".world-map");
    expect(roomView).not.toBeNull();
    expect(mapView).not.toBeNull();

    setNarrow(true);
    expect(q("main.shell")!.dataset["layout"]).toBe("narrow");
    expect(tabs()).toEqual(SIDEBAR_SECTIONS.room.map((s) => s.id));
    expect(q(".room-view")).toBe(roomView);
    expect(q(".world-map")).toBe(mapView);
    expect(shownRoom()).toBe("W13S28");

    setNarrow(false);
    expect(q(".sidebar [role=tab]")).toBeNull();
    expect(q(".room-view")).toBe(roomView);
    expect(q(".world-map")).toBe(mapView);
    expect(shownRoom()).toBe("W13S28");
  });

  it("触摸目标：窄屏下外壳内的按钮（含标签与关闭）至少 44px", () => {
    mountApp(() => true);
    expect(q("main.shell")!.dataset["layout"]).toBe("narrow");
    expect(all(".sidebar [role=tab]").every((el) => el.tagName === "BUTTON")).toBe(true);
    expect(q("[data-action=close-sheet]")!.tagName).toBe("BUTTON");
    const match = /(?:^|\n)\.shell\[data-layout="narrow"\] button\s*\{([^}]*)\}/.exec(styles);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/min-height:\s*44px/);
    expect(match![1]).toMatch(/min-width:\s*44px/);
  });
});

describe("窄屏：点选对象切到选中对象标签（#29）", () => {
  const CREEP = "6ac66da2ff77778f44a644e4";
  let scenes: Map<HTMLCanvasElement, Scene>;
  let viewports: Map<HTMLCanvasElement, Viewport>;
  let roomCanvas: HTMLCanvasElement | undefined;

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
      settle: () => {},
      resize: () => {},
      setViewport: (next) => {
        if (next) viewports.set(canvas, next);
      },
      destroy: () => {},
    };
  }

  const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

  function creepPoint(): { clientX: number; clientY: number } | undefined {
    roomCanvas = q<HTMLCanvasElement>(".room-view canvas") ?? undefined;
    if (!roomCanvas) return undefined;
    const body = scenes.get(roomCanvas)?.primitives.find((p) => p.key === `${CREEP}/base`);
    const vp = viewports.get(roomCanvas);
    if (!body || body.kind !== "circle" || !vp) return undefined;
    return { clientX: body.x * vp.scale + vp.x, clientY: body.y * vp.scale + vp.y };
  }

  it("面板在别的标签或已收起时，点选对象打开面板并切到选中对象标签，详情画在其中；宽屏 Sidebar 的开合不受影响", async () => {
    scenes = new Map();
    viewports = new Map();
    let shell!: ShellState;
    const settings = createSettings(localStorage);
    const [narrow, setNarrow] = createSignal(false);
    dispose = render(
      () => (
        <I18nProvider>
          <MapAndRoom
            settings={settings}
            shell={(shell = createShellState(localStorage, settings, narrow))}
            sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
            createView={fakeView}
            roomView={{ historyCache: async () => undefined }}
            narrow={narrow}
          />
        </I18nProvider>
      ),
      container,
    );
    shell.setSidebarOpen(false);
    setNarrow(true);
    shell.navigate({ shard: "shardSeason", room: "W13S28" });
    q<HTMLButtonElement>('.sidebar [role=tab][data-tab="test.fake"]')!.click();

    let point: ReturnType<typeof creepPoint>;
    await settle(() => expect((point = creepPoint())).toBeDefined());
    for (const type of ["pointerdown", "pointerup"]) {
      roomCanvas!.dispatchEvent(new PointerEvent(type, { ...point!, pointerId: 1, pointerType: "touch", button: 0, bubbles: true }));
    }
    await settle(() => expect(q('[data-section="room.selected"] [data-testid=room-details]')).not.toBeNull());
    expect(q(".sidebar")!.hidden).toBe(false);
    expect(selectedTab()).toBe("room.selected");
    expect(q(".room-view [data-testid=room-details]")).toBeNull();

    setNarrow(false);
    expect(q(".sidebar")!.hidden).toBe(true);
  });
});
