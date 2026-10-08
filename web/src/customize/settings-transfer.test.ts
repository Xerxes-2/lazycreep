import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createAllyList } from "../allies/ally-list.ts";
import { createAlertSettings } from "../alert/alert-settings.ts";
import { createLocale } from "../i18n/locale.ts";
import { createShellState } from "../shell/shell-state.ts";
import { createReplaySettings } from "../replay/replay-settings.ts";
import { cameraKey, saveCamera } from "../room/room-camera-store.ts";
import { createSettings } from "../settings/settings.ts";
import { createColorScheme } from "./color-scheme.ts";
import { createKeybindings } from "./keybindings.ts";
import { exportSettings, importSettings, RETIRED_SETTING_KEYS, STORED_KEYS } from "./settings-transfer.ts";
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
    createKeybindings(localStorage).set("sidebar.toggle", "Shift+H");
    createAllyList(localStorage).add("Friend");
    createAlertSettings(localStorage, fakeNotifications).update({ nuke: false, cooldownMinutes: 7 });
    createReplaySettings(localStorage).setCacheLimitMb(64);
    const shell = createShellState(localStorage, settings);
    shell.setSidebarOpen(false);
    shell.setSectionCollapsed("map.pvp", true);
    shell.setConsoleOpen(true);
    shell.setConsoleHeight(400);
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

  it("已删除的设置（#54 的画风）静默忽略：不写入、不列为无法识别；配色里已删除的颜色项也忽略", () => {
    const report = importSettings(localStorage, {
      format: "my-screeps-client/settings",
      version: 1,
      settings: {
        "msc.artStyle": "geometric",
        "msc.colors": { colors: { terrainWall: "#123456", hitsBar: "#00ff00", background: "#101010" }, strangers: [], playerColors: {} },
        "msc.roomDisplay": { say: true, visual: true, bars: false, names: false, lighting: true },
      },
    });
    expect(report.ignored).toEqual([]);
    expect(RETIRED_SETTING_KEYS).toContain("msc.artStyle");
    expect(localStorage.getItem("msc.artStyle")).toBeNull();
    const theme = createRoot(() => createColorScheme(localStorage)).theme();
    expect(theme.background).toBe(0x101010);
    expect(Object.keys(theme)).not.toContain("terrainWall");
    expect(Object.keys(theme)).not.toContain("hitsBar");
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

  /**
   * 已废弃、只用于启动时清除的旧键（不是本应用存储的键，不登记进 STORED_KEYS）。
   * ADR 0005：固定外壳取代 #2 的网格停靠，`msc.layout.*` 两个布局键启动时清除、不迁移。
   * #54（ADR 0007）：画风设置删除，见 RETIRED_SETTING_KEYS。
   */
  const RETIRED_KEYS: readonly string[] = ["msc.layout.desktop", "msc.layout.monitor", ...RETIRED_SETTING_KEYS];

  it("源码里出现的每个 msc.* 存储键都已汇总到 STORED_KEYS（只用于清除的旧键除外）", () => {
    // 各模块只在自己的文件里写键的字面量；漏汇总的键在这里变红
    const found = keyLiterals();
    expect(found.size).toBeGreaterThan(5);
    for (const key of found) {
      if (RETIRED_KEYS.includes(key)) continue;
      const covered = STORED_KEYS.some((s) => key === s.key || (s.prefix === true && key.startsWith(s.key)));
      expect(covered, key).toBe(true);
    }
  });

  it("豁免的旧键以普通字面量写在源码里（不拼接键名躲开扫描），且没有登记进 STORED_KEYS", () => {
    const found = keyLiterals();
    for (const key of RETIRED_KEYS) {
      expect(found.has(key), key).toBe(true);
      expect(STORED_KEYS.some((s) => s.key === key)).toBe(false);
    }
  });

  it("STORED_KEYS 里的每个声明都对应源码里的一个字面量（没有重复、没有凭空登记）", () => {
    const found = keyLiterals();
    const keys = STORED_KEYS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(found.has(key), key).toBe(true);
  });
});
