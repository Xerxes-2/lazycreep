import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../App";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

/** vitest 不处理 CSS（?raw 也是空串），直接读源文件 */
const styles = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(narrow = false) {
  dispose?.();
  container.innerHTML = "";
  dispose = render(
    () => <App sourceFor={() => new FixtureSource(bundle, { speed: Infinity })} narrow={() => narrow} />,
    container,
  );
}

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const press = (key: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const shownView = () =>
  [...container.querySelectorAll<HTMLElement>(".main-view [data-view]")].filter((el) => !el.hidden).map((el) => el.dataset["view"]);
/** 屏幕上（Sidebar 打开、属于当前模式）的区块 id */
const shownSections = () =>
  q(".sidebar")!.hidden
    ? []
    : [...container.querySelectorAll<HTMLElement>("[data-section]")].filter((el) => !el.hidden).map((el) => el.dataset["section"]);
const sectionBody = (id: string) => q(`[data-section="${id}"] .sidebar-section__body`)!;
const sectionToggle = (id: string) => q<HTMLButtonElement>(`[data-section="${id}"] [data-action=toggle-section]`)!;
const menuItems = () => [...container.querySelectorAll<HTMLButtonElement>("[data-menu-item]")].map((b) => b.dataset["menuItem"]);

describe("固定外壳（#24）", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", location.pathname);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("Main View 一次只显示一个视图：M 键与 Top Bar 按钮在 World Map 与 Room View 之间切换", () => {
    mount();
    expect(shownView()).toEqual(["map"]);
    press("m");
    expect(shownView()).toEqual(["room"]);
    press("M");
    expect(shownView()).toEqual(["map"]);
    q<HTMLButtonElement>('[data-action=main-view][data-mode="room"]')!.click();
    expect(shownView()).toEqual(["room"]);
    expect(q('[data-action=main-view][data-mode="room"]')!.getAttribute("aria-pressed")).toBe("true");
    q<HTMLButtonElement>("button[data-action=back-to-map]")!.click();
    expect(shownView()).toEqual(["map"]);
  });

  it("Sidebar 的区块随 Main View 模式变化", () => {
    mount();
    expect(shownSections()).toEqual(["map.search", "map.layers", "map.pointed", "map.pvp"]);
    expect(q("[data-section='map.pvp'] .pvp-overview")).not.toBeNull();
    press("m");
    expect(shownSections()).toEqual(["room.info", "room.minimap", "room.selected", "room.display"]);
  });

  it("区块单独折叠、Sidebar 整条收起，重新挂载后都恢复", () => {
    mount();
    expect(sectionBody("map.pvp").hidden).toBe(false);
    sectionToggle("map.pvp").click();
    expect(sectionBody("map.pvp").hidden).toBe(true);
    expect(sectionToggle("map.pvp").getAttribute("aria-expanded")).toBe("false");
    press("m");
    expect(sectionBody("room.selected").hidden).toBe(false);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(shownSections()).toEqual([]);

    mount();
    expect(shownView()).toEqual(["room"]);
    expect(shownSections()).toEqual([]);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(shownSections()).toEqual(["room.info", "room.minimap", "room.selected", "room.display"]);
    press("m");
    expect(sectionBody("map.pvp").hidden).toBe(true);
  });

  it("Menu：Top Bar 按钮打开，列出各设置项，一次显示一项；Esc 与点外部关闭", () => {
    mount();
    expect(q(".menu")).toBeNull();
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    const expected = ["server", "allies", "alerts", "history", "appearance", "shortcuts", "transfer", "readings"];
    expect(menuItems()).toEqual(expected);
    const headings: Record<string, string> = {
      server: "#settings-title",
      allies: "#allies-title",
      alerts: "#alert-settings-title",
      history: "[data-testid=history-cache-settings]",
      appearance: "#appearance-title",
      shortcuts: "#shortcuts-title",
      transfer: "#transfer-title",
      readings: "#readings-title",
    };
    for (const id of expected) {
      q<HTMLButtonElement>(`[data-menu-item="${id}"]`)!.click();
      const shown = [...container.querySelectorAll<HTMLElement>("[data-menu-content]")].map((el) => el.dataset["menuContent"]);
      expect(shown).toEqual([id]);
      expect(q(`[data-menu-content="${id}"] ${headings[id]}`), id).not.toBeNull();
      q<HTMLButtonElement>("[data-action=menu-back]")!.click();
    }

    q<HTMLButtonElement>('[data-menu-item="allies"]')!.click();
    press("Escape");
    expect(q(".menu")).toBeNull();

    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    q<HTMLElement>("[data-action=close-menu-backdrop]")!.click();
    expect(q(".menu")).toBeNull();
  });

  it("Console Panel 默认收起，Top Bar 按钮展开后承载 Console；开合在重新挂载后保持", () => {
    mount();
    expect(q("[data-console-panel]")!.hidden).toBe(true);
    expect(q("form[data-console-send]")).toBeNull();
    q<HTMLButtonElement>("[data-action=toggle-console]")!.click();
    expect(q("[data-console-panel]")!.hidden).toBe(false);
    expect(q("[data-console-panel] form[data-console-send]")).not.toBeNull();
    mount();
    expect(q("[data-console-panel]")!.hidden).toBe(false);
  });

  it("启动时清除 #2 网格停靠留下的布局存储", () => {
    localStorage.setItem("msc.layout.desktop", JSON.stringify({ panels: [] }));
    localStorage.setItem("msc.layout.monitor", JSON.stringify({ tabs: ["map"], active: "map" }));
    mount();
    expect(localStorage.getItem("msc.layout.desktop")).toBeNull();
    expect(localStorage.getItem("msc.layout.monitor")).toBeNull();
  });

  it("窄屏下不崩，Main View、Sidebar 与 Menu 照常可用", () => {
    mount(true);
    expect(q(".shell__body")!.dataset["layout"]).toBe("narrow");
    expect(shownView()).toEqual(["map"]);
    expect(shownSections()).toEqual([]);
    q<HTMLButtonElement>("[data-action=toggle-sidebar]")!.click();
    expect(shownSections()).toEqual(["map.search"]);
    press("m");
    expect(shownView()).toEqual(["room"]);
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    q<HTMLButtonElement>('[data-menu-item="server"]')!.click();
    expect(q("#settings-title")).not.toBeNull();
  });

  it("结构约束：外壳占满视口且自身不滚动，只有 Menu、Sidebar 区块与 Console Panel 内部滚动", () => {
    mount();
    expect(q("main.shell > .top-bar")).not.toBeNull();
    expect(q("main.shell > .shell__body > .shell__main > .main-view")).not.toBeNull();
    expect(q("main.shell > .shell__body > .shell__main > [data-console-panel]")).not.toBeNull();
    expect(q("main.shell > .shell__body > .sidebar")).not.toBeNull();

    const rule = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
      expect(match, selector).not.toBeNull();
      return match![1]!;
    };
    expect(rule("html,\nbody")).toMatch(/overflow:\s*hidden/);
    expect(rule(".shell")).toMatch(/height:\s*100dvh/);
    expect(rule(".shell")).toMatch(/overflow:\s*hidden/);
    expect(rule(".main-view")).toMatch(/overflow:\s*hidden/);
    for (const scrolls of [".menu__body", ".sidebar", ".console-panel"]) expect(rule(scrolls), scrolls).toMatch(/overflow(-y)?:\s*auto/);
  });
});
