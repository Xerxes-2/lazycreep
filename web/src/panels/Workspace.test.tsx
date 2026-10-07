import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { createLayoutStore, DESKTOP_LAYOUT_KEY } from "./layout-store.ts";
import { createPanelController, Workspace, type PanelDef } from "./Workspace.tsx";

const panels: PanelDef[] = [
  { id: "map", title: "worldMap.title", size: { w: 6, h: 8 }, render: () => <p data-content="map">map</p> },
  { id: "room", title: "roomView.title", size: { w: 6, h: 8 }, render: () => <p data-content="room">room</p> },
  { id: "pvp", title: "pvp.title", size: { w: 12, h: 6 }, render: () => <p data-content="pvp">pvp</p> },
];
const catalog = { ids: panels.map((p) => p.id), size: (id: string) => panels.find((p) => p.id === id)!.size };

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
const [narrow, setNarrow] = createSignal(false);

function mount() {
  dispose?.();
  container.innerHTML = "";
  dispose = render(() => {
    const store = createLayoutStore(localStorage, catalog, { desktop: ["map", "room"], monitor: ["map", "room"] });
    return (
      <I18nProvider>
        <Workspace panels={panels} controller={createPanelController(store, narrow)} />
      </I18nProvider>
    );
  }, container);
  // 网格宽 1192px：每列 (1192 + 8) / 12 = 100px，每行 40 + 8 = 48px
  Object.defineProperty(container.querySelector(".workspace__panels")!, "clientWidth", { value: 1192 });
}

const panel = (id: string) => container.querySelector<HTMLElement>(`[data-panel="${id}"]`);
const area = (id: string) => [panel(id)!.style.gridColumn, panel(id)!.style.gridRow];
const visible = () =>
  [...container.querySelectorAll<HTMLElement>("[data-panel]")].filter((el) => !el.hidden).map((el) => el.dataset["panel"]);

function drag(el: Element, dx: number, dy: number) {
  const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 7, button: 0, bubbles: true });
  el.dispatchEvent(new PointerEvent("pointerdown", at(500, 500)));
  el.dispatchEvent(new PointerEvent("pointermove", at(500 + dx / 2, 500 + dy / 2)));
  el.dispatchEvent(new PointerEvent("pointermove", at(500 + dx, 500 + dy)));
  el.dispatchEvent(new PointerEvent("pointerup", at(500 + dx, 500 + dy)));
}

describe("面板系统", () => {
  beforeEach(() => {
    localStorage.clear();
    setNarrow(false);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("桌面：拖动标题栏移动、拖右下角缩放（吸附网格），刷新后保留", () => {
    mount();
    expect(area("room")).toEqual(["7 / span 6", "1 / span 8"]);
    drag(panel("room")!.querySelector(".panel__header")!, -400, 96);
    // 压到地图上：地图被推到下面，然后都往上靠拢
    expect(area("room")).toEqual(["3 / span 6", "1 / span 8"]);
    expect(area("map")).toEqual(["1 / span 6", "9 / span 8"]);
    drag(panel("room")!.querySelector(".panel__resize")!, 200, -144);
    expect(area("room")).toEqual(["3 / span 8", "1 / span 5"]);
    expect(area("map")).toEqual(["1 / span 6", "6 / span 8"]);

    mount();
    expect(area("room")).toEqual(["3 / span 8", "1 / span 5"]);
    expect(area("map")).toEqual(["1 / span 6", "6 / span 8"]);
  });

  it("桌面：关闭与加回面板，刷新后保留", () => {
    mount();
    panel("map")!.querySelector<HTMLButtonElement>("[data-action=close-panel]")!.click();
    expect(panel("map")).toBeNull();
    container.querySelector<HTMLButtonElement>('[data-action=open-panel][data-panel-id="pvp"]')!.click();
    expect(visible()).toEqual(["room", "pvp"]);
    expect(panel("pvp")!.querySelector("[data-content=pvp]")).not.toBeNull();
    mount();
    expect(visible()).toEqual(["room", "pvp"]);
    container.querySelector<HTMLButtonElement>("[data-action=reset-layout]")!.click();
    expect(visible()).toEqual(["map", "room"]);
  });

  it("Monitor Mode：底部标签切换，只显示一个面板；“⋯”里增减标签；刷新后保留", () => {
    setNarrow(true);
    mount();
    expect(visible()).toEqual(["map"]);
    expect(container.querySelector(".panel__resize")).toBeNull();
    container.querySelector<HTMLButtonElement>('[data-tab="room"]')!.click();
    expect(visible()).toEqual(["room"]);

    container.querySelector<HTMLButtonElement>("[data-action=manage-tabs]")!.click();
    container.querySelector<HTMLInputElement>('[data-tab-toggle="pvp"]')!.click();
    expect([...container.querySelectorAll<HTMLElement>("[data-tab]")].map((b) => b.dataset["tab"])).toEqual([
      "map",
      "room",
      "pvp",
    ]);
    container.querySelector<HTMLButtonElement>('[data-tab="pvp"]')!.click();
    expect(visible()).toEqual(["pvp"]);

    mount();
    expect(visible()).toEqual(["pvp"]);
  });

  it("两套布局互不影响；切换断点时两边都打开的面板保留同一份内容", () => {
    mount();
    panel("room")!.querySelector<HTMLButtonElement>("[data-action=close-panel]")!.click();
    const mapContent = panel("map")!.querySelector("[data-content=map]");
    const desktopSaved = localStorage.getItem(DESKTOP_LAYOUT_KEY);

    setNarrow(true);
    expect([...container.querySelectorAll<HTMLElement>("[data-tab]")].map((b) => b.dataset["tab"])).toEqual(["map", "room"]);
    expect(panel("map")!.querySelector("[data-content=map]")).toBe(mapContent);
    container.querySelector<HTMLButtonElement>('[data-tab="room"]')!.click();
    expect(localStorage.getItem(DESKTOP_LAYOUT_KEY)).toBe(desktopSaved);

    setNarrow(false);
    expect(visible()).toEqual(["map"]);
    expect(panel("map")!.querySelector("[data-content=map]")).toBe(mapContent);
  });
});
