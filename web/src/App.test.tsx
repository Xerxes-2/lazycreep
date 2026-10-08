import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "./App";
import { FixtureSource, fixtureBundle } from "./source/fixture-source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount() {
  dispose?.();
  container.innerHTML = "";
  dispose = render(() => <App sourceFor={() => new FixtureSource(bundle)} />, container);
}

function heading() {
  return container.querySelector("h1")?.textContent;
}

/** 从 Top Bar 打开 Menu 并显示某一项 */
function openMenuItem(id: string) {
  container.querySelector<HTMLButtonElement>("[data-action=open-menu]")!.click();
  container.querySelector<HTMLButtonElement>(`[data-menu-item="${id}"]`)!.click();
}

function languageButton() {
  const button = container.querySelector<HTMLButtonElement>("button[data-action=toggle-locale]");
  if (!button) throw new Error("language toggle not rendered");
  return button;
}

describe("App", () => {
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

  it("shows the application title in zh-CN by default", () => {
    mount();
    expect(heading()).toBe("Screeps 客户端");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("switches between zh-CN and en with the language button", () => {
    mount();
    languageButton().click();
    expect(heading()).toBe("Screeps Client");
    expect(document.documentElement.lang).toBe("en");
    languageButton().click();
    expect(heading()).toBe("Screeps 客户端");
  });

  it("keeps the chosen language after a reload", () => {
    mount();
    languageButton().click();
    mount();
    expect(heading()).toBe("Screeps Client");
  });

  it("shows the raw readings page with the connection state", () => {
    mount();
    openMenuItem("readings");
    expect(container.querySelector("#readings-title")?.textContent).toBe("原始读数");
    expect(container.querySelector("[data-testid=readings-state]")?.textContent).toBe("已认证");
  });

  it("shows the room view", () => {
    mount();
    expect(container.querySelector("#room-view-title")?.textContent).toBe("房间视图");
    expect(container.querySelector("[data-testid=room-view-tick]")?.textContent).toBe("—");
  });

  it("shows the settings page, translated with the interface language", () => {
    mount();
    openMenuItem("server");
    expect(container.querySelector("#settings-title")?.textContent).toBe("设置");
    languageButton().click();
    expect(container.querySelector("#settings-title")?.textContent).toBe("Settings");
  });

  it("shows the Ally List in the settings, kept across reloads", () => {
    mount();
    openMenuItem("allies");
    expect(container.querySelector("#allies-title")?.textContent).toBe("Ally List");
    const input = container.querySelector<HTMLInputElement>("input[name=ally-name]")!;
    input.value = "Alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    mount();
    openMenuItem("allies");
    expect(container.querySelector('[data-ally="Alice"]')).not.toBeNull();
  });

  it("全页共用一个 Source：Main View、Sidebar 与告警只建一个；换 token 时关掉旧的、建一个新的", async () => {
    localStorage.setItem("msc.alerts", JSON.stringify({ pvp: true, nuke: true, stranger: true }));
    const made: { token: string | undefined; source: FixtureSource }[] = [];
    dispose = render(
      () => (
        <App
          sourceFor={(_server, token) => {
            const source = new FixtureSource(bundle, { speed: Infinity });
            made.push({ token, source });
            return source;
          }}
        />
      ),
      container,
    );
    expect(container.querySelector(".world-map")).not.toBeNull();
    expect(container.querySelector(".room-view")).not.toBeNull();
    openMenuItem("server");
    expect(made).toHaveLength(1);

    const close = vi.spyOn(made[0]!.source, "close");
    const token = container.querySelector<HTMLInputElement>("input[name=token]")!;
    token.value = "new-token";
    token.dispatchEvent(new Event("change", { bubbles: true }));
    expect(made.map((m) => m.token)).toEqual([undefined, "new-token"]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
