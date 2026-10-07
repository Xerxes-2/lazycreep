import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { DEFAULT_KEYS } from "./keybindings.ts";
import { exportSettings } from "./settings-transfer.ts";

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

const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
const panel = (id: string) => container.querySelector<HTMLElement>(`[data-panel="${id}"]`)!;
const focused = () => container.querySelector<HTMLElement>("[data-panel][data-focused]")?.dataset["panel"];
const visiblePanels = () =>
  [...container.querySelectorAll<HTMLElement>("[data-panel]")].filter((el) => !el.hidden).map((el) => el.dataset["panel"]);
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

async function chooseFile(input: HTMLInputElement, text: string) {
  const file = new File([text], "settings.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("快捷键接到页面（#5）", () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("默认键位切换 / 聚焦面板，地图与 Room View 来回切", () => {
    mount();
    press(DEFAULT_KEYS["panel.room"]);
    expect(focused()).toBe("room");
    press(DEFAULT_KEYS["panel.settings"]);
    expect(focused()).toBe("settings");
    press(DEFAULT_KEYS["panel.console"]);
    expect(focused()).toBe("console");
    expect(panel("console").hidden).toBe(false);
    press(DEFAULT_KEYS["view.toggleMapRoom"].toLowerCase());
    expect(focused()).toBe("room");
    press(DEFAULT_KEYS["view.toggleMapRoom"].toLowerCase());
    expect(focused()).toBe("map");
  });

  it("输入框获得焦点时不拦截", () => {
    mount();
    const input = container.querySelector<HTMLInputElement>("input[name=ally-name]")!;
    press(DEFAULT_KEYS["panel.room"], input);
    expect(focused()).toBeUndefined();
  });

  it("Monitor Mode 下同样切换标签，不出错", () => {
    mount(true);
    expect(visiblePanels()).toEqual(["map"]);
    press(DEFAULT_KEYS["panel.settings"]);
    expect(visiblePanels()).toEqual(["settings"]);
    press(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(visiblePanels()).toEqual(["room"]);
    press(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(visiblePanels()).toEqual(["map"]);
    // Replay 键在没打开房间时什么也不做
    expect(press(DEFAULT_KEYS["replay.toggle"])).toBe(true);
    expect(press(" ")).toBe(true);
  });

  it("Live / Replay 切换", async () => {
    mount();
    const room = container.querySelector<HTMLInputElement>("[name=room-view-room]")!;
    room.value = "W13S28";
    room.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLFormElement>("[data-testid=room-view-form]")!.requestSubmit();
    const status = () => container.querySelector(".room-view__status")!.textContent ?? "";
    await settle(() => expect(container.querySelector("[data-testid=room-view-tick]")!.textContent).not.toBe("—"));
    expect(status()).not.toContain("回放中");
    press(DEFAULT_KEYS["replay.toggle"]);
    await settle(() => expect(status()).toContain("回放中"));
    press(DEFAULT_KEYS["replay.toggle"]);
    await settle(() => expect(status()).not.toContain("回放中"));
  });

  it("重绑界面：冲突时提示，确认后改用并解除原绑定，立即生效", async () => {
    mount();
    const row = (id: string) => container.querySelector<HTMLElement>(`[data-shortcut="${id}"]`)!;
    row("panel.map").querySelector<HTMLButtonElement>("[data-action=shortcut-rebind]")!.click();
    const capture = row("panel.map").querySelector<HTMLButtonElement>("[data-shortcut-capture]")!;
    press(DEFAULT_KEYS["panel.room"], capture);
    // 录入时不触发原动作
    expect(focused()).toBeUndefined();
    const conflict = container.querySelector("[data-testid=shortcut-conflict]");
    expect(conflict?.textContent).toContain("切到房间视图");
    container.querySelector<HTMLButtonElement>("[data-action=shortcut-replace]")!.click();
    expect(row("panel.map").querySelector("kbd")!.textContent).toBe(DEFAULT_KEYS["panel.room"]);
    expect(row("panel.room").querySelector("kbd")!.textContent).toBe("未绑定");

    press(DEFAULT_KEYS["panel.room"]);
    expect(focused()).toBe("map");
  });
});

describe("设置导入后无需刷新即生效（#5）", () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("从文件导入：语言、明暗主题、Ally List、快捷键立即换成文件里的", async () => {
    mount();
    // 另一个浏览器里的设置
    const source = {
      getItem: (k: string) => others.get(k) ?? null,
      setItem: (k: string, v: string) => void others.set(k, v),
      removeItem: (k: string) => void others.delete(k),
      key: (i: number) => [...others.keys()][i] ?? null,
      get length() {
        return others.size;
      },
    };
    const others = new Map<string, string>([
      ["msc.locale", "en"],
      ["msc.uiTheme", '"dark"'],
      ["msc.allies", '["Remote"]'],
      ["msc.keys", JSON.stringify({ "panel.room": "Q" })],
      ["msc.settings", JSON.stringify({ serverId: "season", customServers: [], token: "remote-token", shards: {} })],
    ]);
    const file = JSON.stringify(exportSettings(source));
    expect(file).not.toContain("remote-token");

    await chooseFile(container.querySelector<HTMLInputElement>("input[name=import-settings]")!, file);
    await settle(() => expect(container.querySelector("h1")?.textContent).toBe("Screeps Client"));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(container.querySelector('[data-ally="Remote"]')).not.toBeNull();
    expect(container.querySelector("[data-testid=import-result]")).not.toBeNull();
    press("q");
    expect(focused()).toBe("room");
  });

  it("不是设置文件时提示错误，设置不变", async () => {
    localStorage.setItem("msc.allies", '["Keep"]');
    mount();
    await chooseFile(container.querySelector<HTMLInputElement>("input[name=import-settings]")!, '{"x":1}');
    await settle(() => expect(container.querySelector("[data-testid=settings-transfer] [role=alert]")).not.toBeNull());
    expect(container.querySelector('[data-ally="Keep"]')).not.toBeNull();
  });
});
