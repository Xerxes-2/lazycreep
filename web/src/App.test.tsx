import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "./App";
import { FixtureSource, fixtureBundle } from "./source/fixture-source.ts";
import type { Source } from "./source/source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(sourceFor: () => Source = () => new FixtureSource(bundle)) {
  dispose?.();
  container.innerHTML = "";
  dispose = render(() => <App sourceFor={sourceFor} />, container);
}

/** 服务器的房间流没有任何帧（只有录制数据能画出房间） */
function silentServer(): Source {
  const source = new FixtureSource(bundle, { speed: Infinity });
  source.subscribeRoom = () => () => {};
  return source;
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
    vi.unstubAllEnvs();
    history.replaceState(null, "", "/");
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
    expect(container.querySelector<HTMLElement>(".room-view")!.dataset.tick).toBeUndefined();
  });

  it("开发构建：数据来源开关在 Menu 的原始读数项里，切到录制数据后 Room View 由录制数据驱动（#51）", async () => {
    vi.stubEnv("DEV", true);
    mount(silentServer);
    expect(container.querySelector(".room-view select, .main-view select")).toBeNull();
    openMenuItem("readings");
    const select = container.querySelector<HTMLSelectElement>("[data-menu-content=readings] select[name=room-view-source]")!;
    expect(select.value).toBe("server");
    select.value = "recording";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    location.hash = "#!/season/room/shardSeason/W13S28";
    await vi.waitFor(() => expect(container.querySelector<HTMLElement>(".room-view")!.dataset.tick).toBeDefined(), {
      timeout: 5000,
    });
  });

  it("生产构建：没有数据来源开关，也没有原始读数项（#14 #51）", () => {
    vi.stubEnv("DEV", false);
    mount();
    container.querySelector<HTMLButtonElement>("[data-action=open-menu]")!.click();
    expect(container.querySelector("[data-menu-item=readings]")).toBeNull();
    expect(container.querySelector("select[name=room-view-source]")).toBeNull();
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
