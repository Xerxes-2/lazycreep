import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createAllyList } from "../allies/ally-list.ts";
import { createAlertSettings } from "../alert/alert-settings.ts";
import { createLocale } from "../i18n/locale.ts";
import { createLayoutStore } from "../panels/layout-store.ts";
import { createReplaySettings } from "../replay/replay-settings.ts";
import { cameraKey, saveCamera } from "../room/room-camera-store.ts";
import { createSettings } from "../settings/settings.ts";
import { createColorScheme } from "./color-scheme.ts";
import { createKeybindings } from "./keybindings.ts";
import { exportSettings, importSettings, STORED_KEYS } from "./settings-transfer.ts";
import { createUiTheme } from "./ui-theme.ts";

const fakeNotifications = {
  permission: () => "default" as const,
  requestPermission: async () => "default" as const,
  show: () => {},
};

function snapshot(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    result[key] = localStorage.getItem(key)!;
  }
  return result;
}

/** 用各功能自己的接口改一遍设置 */
function customizeEverything() {
  createRoot(() => {
    const settings = createSettings(localStorage);
    settings.addCustomServer({ name: "Home", apiRoot: "/home-api", socketUrl: "wss://home/socket", sharded: false });
    settings.selectServer("season");
    settings.setShard("shardSeason");
    settings.setToken("secret-token");
    createLocale(localStorage).setLocale("en");
    createUiTheme({ storage: localStorage, darkQuery: undefined, root: document.createElement("html") }).setPreference("dark");
    const colors = createColorScheme(localStorage);
    colors.setColor("background", 0x101010);
    colors.setPlayerColor("Bob", 0x00ff00);
    createKeybindings(localStorage).set("panel.map", "Shift+M");
    createAllyList(localStorage).add("Friend");
    createAlertSettings(localStorage, fakeNotifications).update({ nuke: false, cooldownMinutes: 7 });
    createReplaySettings(localStorage).setCacheLimitMb(64);
    const layout = createLayoutStore(
      localStorage,
      { ids: ["map", "room"], size: () => ({ w: 6, h: 8 }) },
      { desktop: ["map", "room"], monitor: ["map", "room"] },
    );
    layout.closePanel("room");
    layout.showTab("room");
    saveCamera(localStorage, cameraKey("season", "shardSeason", "W13S28"), { cx: 10, cy: 20, span: 15 });
  });
}

describe("设置导出 / 导入（#5）", () => {
  beforeEach(() => localStorage.clear());

  it("导出的 JSON 不含 token", () => {
    customizeEverything();
    const text = JSON.stringify(exportSettings(localStorage));
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain('"token"');
  });

  it("导出 → 清空 → 导入还原全部设置（token 除外，需重新输入）", () => {
    customizeEverything();
    const before = snapshot();
    const file = JSON.stringify(exportSettings(localStorage));

    localStorage.clear();
    const report = importSettings(localStorage, JSON.parse(file));
    expect(report.ignored).toEqual([]);

    const after = snapshot();
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      if (key === "msc.settings") continue;
      expect(after[key], key).toBe(before[key]);
    }
    const settings = createRoot(() => createSettings(localStorage));
    expect(settings.token()).toBe("");
    expect(settings.server().id).toBe("season");
    expect(settings.shard()).toBe("shardSeason");
    expect(settings.servers().some((s) => s.name === "Home")).toBe(true);
  });

  it("导入保留本机已有的 token，替换掉文件里没有的旧设置", () => {
    customizeEverything();
    const file = exportSettings(localStorage);
    localStorage.clear();
    createRoot(() => createSettings(localStorage).setToken("mine"));
    localStorage.setItem("msc.roomCamera.x/y/W1N1", JSON.stringify({ cx: 1, cy: 1, span: 1 }));
    importSettings(localStorage, file);
    expect(createRoot(() => createSettings(localStorage)).token()).toBe("mine");
    expect(localStorage.getItem("msc.roomCamera.x/y/W1N1")).toBeNull();
  });

  it("忽略未知键与类型不对的值；文件里的 token 不导入", () => {
    const report = importSettings(localStorage, {
      format: "my-screeps-client/settings",
      version: 1,
      settings: {
        "msc.allies": ["A"],
        "msc.settings": { serverId: "season", token: "evil", customServers: [], shards: {} },
        "msc.unknown": { a: 1 },
        "other.app": "x",
        "msc.alerts": "not an object",
      },
    });
    expect([...report.ignored].sort()).toEqual(["msc.alerts", "msc.unknown", "other.app"]);
    expect(localStorage.getItem("msc.allies")).toBe('["A"]');
    expect(localStorage.getItem("msc.unknown")).toBeNull();
    expect(createRoot(() => createSettings(localStorage)).token()).toBe("");
  });

  it("不是设置文件时拒绝且不改动现有设置", () => {
    localStorage.setItem("msc.allies", '["Keep"]');
    expect(() => importSettings(localStorage, { hello: 1 })).toThrow();
    expect(() => importSettings(localStorage, { format: "my-screeps-client/settings", version: 99, settings: {} })).toThrow();
    expect(localStorage.getItem("msc.allies")).toBe('["Keep"]');
  });

  /** 源码（不含测试）里所有以引号或反引号开头的 `msc.*` 字面量 */
  function keyLiterals(): Set<string> {
    const sources = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const found = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/["'`](msc\.[A-Za-z0-9.]+)/g)) found.add(match[1]!);
    }
    return found;
  }

  it("源码里出现的每个 msc.* 存储键都已汇总到 STORED_KEYS", () => {
    // 各模块只在自己的文件里写键的字面量；漏汇总的键在这里变红
    const found = keyLiterals();
    expect(found.size).toBeGreaterThan(5);
    for (const key of found) {
      const covered = STORED_KEYS.some((s) => key === s.key || (s.prefix === true && key.startsWith(s.key)));
      expect(covered, key).toBe(true);
    }
  });

  it("STORED_KEYS 里的每个声明都对应源码里的一个字面量（没有重复、没有凭空登记）", () => {
    const found = keyLiterals();
    const keys = STORED_KEYS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(found.has(key), key).toBe(true);
  });
});
