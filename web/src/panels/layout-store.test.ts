import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createLayoutStore, DESKTOP_LAYOUT_KEY, MONITOR_LAYOUT_KEY, type LayoutDefaults } from "./layout-store.ts";
import type { PanelCatalog } from "./layout.ts";
import type { SettingsStorage } from "../settings/settings.ts";

const catalog: PanelCatalog = {
  ids: ["map", "room", "pvp", "settings"],
  size: () => ({ w: 6, h: 8 }),
};
const defaults: LayoutDefaults = { desktop: ["map", "room"], monitor: ["map", "room", "pvp"] };

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const open = (storage: SettingsStorage | undefined) => createRoot(() => createLayoutStore(storage, catalog, defaults));

describe("布局持久化与恢复", () => {
  it("没有存储时用默认布局", () => {
    const store = open(memoryStorage());
    expect(store.desktop().panels.map((p) => p.id)).toEqual(["map", "room"]);
    expect(store.monitor()).toEqual({ tabs: ["map", "room", "pvp"], active: "map" });
  });

  it("桌面布局的增删、拖动、缩放在重新打开后保留", () => {
    const storage = memoryStorage();
    const store = open(storage);
    store.openPanel("settings");
    store.closePanel("map");
    store.move("room", 3, 0);
    store.resize("room", 9, 10);
    const saved = store.desktop();

    const reopened = open(storage);
    expect(reopened.desktop()).toEqual(saved);
    expect(reopened.desktop().panels.map((p) => p.id)).toEqual(["room", "settings"]);
    expect(reopened.desktop().panels[0]).toMatchObject({ x: 3, y: 0, w: 9, h: 10 });
  });

  it("Monitor Mode 的标签与当前标签在重新打开后保留", () => {
    const storage = memoryStorage();
    const store = open(storage);
    store.showTab("settings");
    store.toggleTab("room");
    const reopened = open(storage);
    expect(reopened.monitor()).toEqual({ tabs: ["map", "pvp", "settings"], active: "settings" });
  });

  it("两套布局分开存，改一套不影响另一套", () => {
    const storage = memoryStorage();
    const store = open(storage);
    store.showTab("pvp");
    expect(storage.data.has(DESKTOP_LAYOUT_KEY)).toBe(false);
    store.closePanel("room");
    const monitorSaved = storage.data.get(MONITOR_LAYOUT_KEY);
    store.move("map", 4, 2);
    expect(storage.data.get(MONITOR_LAYOUT_KEY)).toBe(monitorSaved);

    const reopened = open(storage);
    expect(reopened.monitor().active).toBe("pvp");
    expect(reopened.desktop().panels.map((p) => p.id)).toEqual(["map"]);
  });

  it("存储里的坏数据退回默认布局", () => {
    const storage = memoryStorage();
    storage.data.set(DESKTOP_LAYOUT_KEY, "{oops");
    storage.data.set(MONITOR_LAYOUT_KEY, JSON.stringify({ tabs: ["nope"] }));
    const store = open(storage);
    expect(store.desktop().panels.map((p) => p.id)).toEqual(["map", "room"]);
    expect(store.monitor().active).toBe("map");
  });

  it("存储读写抛异常时照常工作（只在本次会话内生效）", () => {
    const throwing: SettingsStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const store = open(throwing);
    store.openPanel("pvp");
    expect(store.desktop().panels.map((p) => p.id)).toEqual(["map", "room", "pvp"]);
    expect(open(undefined).monitor().active).toBe("map");
  });

  it("恢复默认布局", () => {
    const storage = memoryStorage();
    const store = open(storage);
    store.closePanel("map");
    store.resetDesktop();
    expect(open(storage).desktop().panels.map((p) => p.id)).toEqual(["map", "room"]);
  });
});
