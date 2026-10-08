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
/** Main View 此刻显示的视图 */
const mainView = () =>
  [...container.querySelectorAll<HTMLElement>(".main-view [data-view]")].find((el) => !el.hidden)?.dataset["view"];
const menuOpen = () => container.querySelector(".menu") !== null;
const consoleOpen = () => !container.querySelector<HTMLElement>("[data-console-panel]")!.hidden;
function openMenuItem(id: string) {
  container.querySelector<HTMLButtonElement>("[data-action=open-menu]")!.click();
  container.querySelector<HTMLButtonElement>(`[data-menu-item="${id}"]`)!.click();
}
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

async function chooseFile(input: HTMLInputElement, text: string) {
  const file = new File([text], "settings.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("快捷键接到页面（#5）", () => {
  beforeEach(() => {
    localStorage.clear();
    // 地址是 Main View 位置的来源（#32）：上一个测试留下的地址不能带进来
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("M 在 World Map 与 Room View 之间切换 Main View（字母不分大小写）；反引号开合 Console Panel", () => {
    mount();
    expect(mainView()).toBe("map");
    press(DEFAULT_KEYS["view.toggleMapRoom"].toLowerCase());
    expect(mainView()).toBe("room");
    press(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(mainView()).toBe("map");
    press(DEFAULT_KEYS["console.toggle"]);
    expect(consoleOpen()).toBe(true);
    expect(menuOpen()).toBe(false);
  });

  it("输入框获得焦点时不拦截", () => {
    mount();
    openMenuItem("allies");
    const input = container.querySelector<HTMLInputElement>("input[name=ally-name]")!;
    press(DEFAULT_KEYS["view.toggleMapRoom"], input);
    expect(mainView()).toBe("map");
  });

  it("窄屏下同样切换 Main View，不出错", () => {
    mount(true);
    expect(mainView()).toBe("map");
    press(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(mainView()).toBe("room");
    press(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(mainView()).toBe("map");
    // Replay 键在没打开房间时什么也不做
    expect(press(DEFAULT_KEYS["replay.toggle"])).toBe(true);
    expect(press(" ")).toBe(true);
  });

  it("Live / Replay 切换", async () => {
    // 按地址打开房间（#32）
    history.replaceState(null, "", "/#!/season/room/shardSeason/W13S28");
    mount();
    const roomView = () => container.querySelector<HTMLElement>(".room-view")!.dataset;
    await settle(() => expect(roomView().tick).toBeDefined());
    expect(roomView().mode).toBe("live");
    press(DEFAULT_KEYS["replay.toggle"]);
    await settle(() => expect(roomView().mode).toBe("replay"));
    press(DEFAULT_KEYS["replay.toggle"]);
    await settle(() => expect(roomView().mode).toBe("live"));
  });

  it("重绑界面：冲突时提示，确认后改用并解除原绑定，立即生效", async () => {
    mount();
    openMenuItem("shortcuts");
    const row = (id: string) => container.querySelector<HTMLElement>(`[data-shortcut="${id}"]`)!;
    row("console.toggle").querySelector<HTMLButtonElement>("[data-action=shortcut-rebind]")!.click();
    const capture = row("console.toggle").querySelector<HTMLButtonElement>("[data-shortcut-capture]")!;
    press(DEFAULT_KEYS["view.toggleMapRoom"], capture);
    // 录入时不触发原动作
    expect(mainView()).toBe("map");
    const conflict = container.querySelector("[data-testid=shortcut-conflict]");
    expect(conflict?.textContent).toContain("在地图与房间视图之间切换");
    container.querySelector<HTMLButtonElement>("[data-action=shortcut-replace]")!.click();
    expect(row("console.toggle").querySelector("kbd")!.textContent).toBe(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(row("view.toggleMapRoom").querySelector("kbd")!.textContent).toBe("未绑定");

    container.querySelector<HTMLButtonElement>("[data-action=close-menu]")!.click();
    press(DEFAULT_KEYS["view.toggleMapRoom"]);
    expect(mainView()).toBe("map");
    expect(consoleOpen()).toBe(true);
  });
});

describe("设置导入后无需刷新即生效（#5）", () => {
  beforeEach(() => {
    localStorage.clear();
    // 地址是 Main View 位置的来源（#32）：上一个测试留下的地址不能带进来
    history.replaceState(null, "", "/");
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
    openMenuItem("transfer");
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
      ["msc.keys", JSON.stringify({ ...DEFAULT_KEYS, "view.toggleMapRoom": "Q" })],
      ["msc.settings", JSON.stringify({ serverId: "season", customServers: [], token: "remote-token", shards: {} })],
    ]);
    const file = JSON.stringify(exportSettings(source));
    expect(file).not.toContain("remote-token");

    await chooseFile(container.querySelector<HTMLInputElement>("input[name=import-settings]")!, file);
    await settle(() => expect(container.querySelector("h1")?.textContent).toBe("Screeps Client"));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    // 重建后 Menu 仍停在导入那一项，显示结果
    expect(container.querySelector("[data-testid=import-result]")).not.toBeNull();
    container.querySelector<HTMLButtonElement>("[data-action=menu-back]")!.click();
    container.querySelector<HTMLButtonElement>('[data-menu-item="allies"]')!.click();
    expect(container.querySelector('[data-ally="Remote"]')).not.toBeNull();
    press("q");
    expect(mainView()).toBe("room");
  });

  it("不是设置文件时提示错误，设置不变", async () => {
    localStorage.setItem("msc.allies", '["Keep"]');
    mount();
    openMenuItem("transfer");
    await chooseFile(container.querySelector<HTMLInputElement>("input[name=import-settings]")!, '{"x":1}');
    await settle(() => expect(container.querySelector("[data-testid=settings-transfer] [role=alert]")).not.toBeNull());
    container.querySelector<HTMLButtonElement>("[data-action=menu-back]")!.click();
    container.querySelector<HTMLButtonElement>('[data-menu-item="allies"]')!.click();
    expect(container.querySelector('[data-ally="Keep"]')).not.toBeNull();
  });
});
