import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { DEFAULT_KEYS, KEYBINDINGS_KEY } from "../customize/keybindings.ts";
import { exportSettings, importSettings } from "../customize/settings-transfer.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

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

function unmount() {
  dispose?.();
  dispose = undefined;
}

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
/** 返回事件是否被快捷键拦截（defaultPrevented） */
const press = (key: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
const mainView = () => [...container.querySelectorAll<HTMLElement>(".main-view [data-view]")].find((el) => !el.hidden)?.dataset["view"];
const sidebarShown = () => !q(".sidebar")!.hidden;
const consoleShown = () => !q("[data-console-panel]")!.hidden;
const menuShown = () => q(".menu") !== null;
const sectionCollapsed = (id: string) => q(`[data-section="${id}"] .sidebar-section__body`)!.hidden;
const consoleHeight = () => q("[data-console-panel]")!.style.height;
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

function pointer(target: Element, type: string, clientY: number) {
  // jsdom 没有 PointerEvent 时用 MouseEvent 补上 pointerId
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

function dragConsoleEdge(fromY: number, toY: number) {
  const handle = q("[data-console-panel] [data-action=resize-console]")!;
  pointer(handle, "pointerdown", fromY);
  pointer(handle, "pointermove", (fromY + toY) / 2);
  pointer(handle, "pointermove", toY);
  pointer(handle, "pointerup", toY);
}

describe("快捷键目录（#30）", () => {
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
    history.replaceState(null, "", location.pathname);
  });

  it("M 切换 Main View，H 开合 Sidebar，反引号开合 Console Panel", () => {
    mount();
    expect(mainView()).toBe("map");
    expect(press(DEFAULT_KEYS["view.toggleMapRoom"])).toBe(true);
    expect(mainView()).toBe("room");

    expect(sidebarShown()).toBe(true);
    expect(press("h")).toBe(true);
    expect(sidebarShown()).toBe(false);
    press("H");
    expect(sidebarShown()).toBe(true);

    expect(consoleShown()).toBe(false);
    expect(press("`")).toBe(true);
    expect(consoleShown()).toBe(true);
    press("`");
    expect(consoleShown()).toBe(false);
  });

  it("Esc 关闭 Menu；没有可关闭的东西时不拦截", () => {
    mount();
    expect(press("Escape")).toBe(false);
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    expect(menuShown()).toBe(true);
    expect(press("Escape")).toBe(true);
    expect(menuShown()).toBe(false);
    // 桌面结构下 Esc 不收起 Sidebar
    expect(press("Escape")).toBe(false);
    expect(sidebarShown()).toBe(true);
  });

  it("窄屏下 Esc 在没有 Menu 时收起底部的 Sidebar 面板", () => {
    mount(true);
    expect(sidebarShown()).toBe(false);
    press("h");
    expect(sidebarShown()).toBe(true);
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    press("Escape");
    expect(menuShown()).toBe(false);
    expect(sidebarShown()).toBe(true);
    expect(press("Escape")).toBe(true);
    expect(sidebarShown()).toBe(false);
  });

  it("窄屏下反引号打开 / 关闭 Menu 的 Console 项（窄屏没有 Console Panel），H 开合底部面板", () => {
    mount(true);
    expect(q("[data-console-panel]")).toBeNull();
    expect(press("`")).toBe(true);
    expect(q("[data-menu-content=console] form[data-console-send]")).not.toBeNull();
    press("`");
    expect(menuShown()).toBe(false);
    // Menu 开着别的项时，反引号换到 Console 项
    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    press("`");
    expect(q("[data-menu-content=console]")).not.toBeNull();
    press("Escape");
    expect(menuShown()).toBe(false);

    expect(sidebarShown()).toBe(false);
    press("h");
    expect(sidebarShown()).toBe(true);
    press("h");
    expect(sidebarShown()).toBe(false);
  });

  it("R 进出 Replay；空格播放暂停，逗号句号单步", async () => {
    location.hash = "#!/season/history/shardSeason/W13S28?t=1024937";
    mount();
    expect(mainView()).toBe("room");
    await settle(() => expect(q("[data-testid=replay-controls]")).not.toBeNull());
    const tick = () => q<HTMLElement>(".room-view")!.dataset.tick;
    await settle(() => expect(tick()).toBe("1024937"));
    const playLabel = () => q("[data-action=replay-toggle]")!.getAttribute("aria-label");

    press(".");
    expect(tick()).toBe("1024938");
    press(",");
    press(",");
    expect(tick()).toBe("1024936");

    expect(playLabel()).toBe("播放");
    press(" ");
    expect(playLabel()).toBe("暂停");
    press(" ");
    expect(playLabel()).toBe("播放");

    const mode = () => q<HTMLElement>(".room-view")!.dataset.mode;
    expect(mode()).toBe("replay");
    press("r");
    await settle(() => expect(mode()).toBe("live"));
    press("r");
    await settle(() => expect(mode()).toBe("replay"));
  });

  it("数字键不再有面板动作", () => {
    mount();
    for (const digit of "123456") expect(press(digit)).toBe(false);
    expect(mainView()).toBe("map");
    expect(menuShown()).toBe(false);
    expect(consoleShown()).toBe(false);
  });

  it("#5 版存下的键位（含数字键面板动作）在加载后整体回到新默认", () => {
    localStorage.setItem(KEYBINDINGS_KEY, JSON.stringify({ "panel.room": "Q", "view.toggleMapRoom": "X" }));
    mount();
    press("q");
    press("x");
    expect(mainView()).toBe("map");
    press("m");
    expect(mainView()).toBe("room");

    q<HTMLButtonElement>("[data-action=open-menu]")!.click();
    q<HTMLButtonElement>('[data-menu-item="shortcuts"]')!.click();
    const shown = [...container.querySelectorAll<HTMLElement>("[data-shortcut]")].map((row) => [
      row.dataset["shortcut"],
      row.querySelector("kbd")!.textContent,
    ]);
    expect(shown).toEqual([
      ["view.toggleMapRoom", "M"],
      ["replay.toggle", "R"],
      ["sidebar.toggle", "H"],
      ["console.toggle", "`"],
      ["shell.close", "Escape"],
      ["replay.playPause", "空格"],
      ["replay.stepBack", ","],
      ["replay.stepForward", "."],
    ]);
  });
});

describe("Console Panel 高度拖动（#30）", () => {
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

  it("拖动上边缘调高度，限制在范围内，重新挂载后恢复", () => {
    mount();
    press("`");
    expect(consoleHeight()).toBe("260px");
    dragConsoleEdge(500, 400);
    expect(consoleHeight()).toBe("360px");
    mount();
    expect(consoleHeight()).toBe("360px");

    dragConsoleEdge(500, 2000);
    expect(consoleHeight()).toBe("120px");
    // 松开后再移动不再改变
    pointer(q("[data-action=resize-console]")!, "pointermove", 0);
    expect(consoleHeight()).toBe("120px");
  });

  it("手柄聚焦后用上下方向键调高度", () => {
    mount();
    press("`");
    const handle = q("[data-action=resize-console]")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(consoleHeight()).toBe("280px");
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
  });
});

describe("设置导出涵盖外壳状态（#30）", () => {
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

  it("导出 → 清空 → 导入后，Sidebar 收起（宽屏与窄屏各一份）、区块折叠、Console Panel 开合与高度全部还原；导出中无 token", () => {
    localStorage.setItem("msc.settings", JSON.stringify({ serverId: "season", customServers: [], token: "secret-token", shards: {} }));
    mount();
    q<HTMLButtonElement>("[data-section='map.pvp'] [data-action=toggle-section]")!.click();
    press("`");
    dragConsoleEdge(500, 300);
    press("h");
    expect(sectionCollapsed("map.pvp")).toBe(true);
    expect(sidebarShown()).toBe(false);
    expect(consoleShown()).toBe(true);
    expect(consoleHeight()).toBe("460px");
    // 窄屏底部面板的开合单独一份，同样导出
    mount(true);
    press("h");
    expect(sidebarShown()).toBe(true);

    unmount();
    const file = JSON.stringify(exportSettings(localStorage));
    expect(file).not.toContain("secret-token");
    expect(file).toContain("msc.shell");

    localStorage.clear();
    mount();
    expect(sidebarShown()).toBe(true);
    expect(consoleShown()).toBe(false);
    unmount();

    importSettings(localStorage, JSON.parse(file));
    mount();
    expect(sidebarShown()).toBe(false);
    expect(consoleShown()).toBe(true);
    expect(consoleHeight()).toBe("460px");
    press("h");
    expect(sectionCollapsed("map.pvp")).toBe(true);
    mount(true);
    expect(sidebarShown()).toBe(true);
  });
});
