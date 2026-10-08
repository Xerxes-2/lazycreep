import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import {
  attachShortcuts,
  createKeybindings,
  createShortcutCommands,
  DEFAULT_KEYS,
  KEYBINDINGS_KEY,
  keyFromEvent,
  SHORTCUT_ACTIONS,
} from "./keybindings.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("按键归一化", () => {
  it("字母不分大小写，Shift 只对字母与非字符键记下", () => {
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: "m" }))).toBe("M");
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: "M", shiftKey: true }))).toBe("Shift+M");
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: "?", shiftKey: true }))).toBe("?");
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: " " }))).toBe("Space");
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true }))).toBe("Shift+ArrowLeft");
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+K");
    expect(keyFromEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }))).toBeUndefined();
  });
});

describe("快捷键绑定（#5，#30 改目录）", () => {
  it("默认目录是外壳与 Replay 动作，键位贴近官方且互不冲突；没有数字键", () => {
    expect(DEFAULT_KEYS).toEqual({
      "view.toggleMapRoom": "M",
      "replay.toggle": "R",
      "sidebar.toggle": "H",
      "console.toggle": "`",
      "shell.close": "Escape",
      "replay.playPause": "Space",
      "replay.stepBack": ",",
      "replay.stepForward": ".",
    });
    expect(SHORTCUT_ACTIONS.map((a) => a.id).sort()).toEqual(Object.keys(DEFAULT_KEYS).sort());
    const bindings = createRoot(() => createKeybindings(memoryStorage()));
    expect(bindings.conflicts().size).toBe(0);
    for (const digit of "0123456789") expect(bindings.actionFor(digit)).toBeUndefined();
  });

  it("重绑、冲突检测、解绑与恢复默认，并持久化", () => {
    const storage = memoryStorage();
    const bindings = createRoot(() => createKeybindings(storage));
    expect(bindings.conflictWith("sidebar.toggle", DEFAULT_KEYS["replay.toggle"])).toBe("replay.toggle");
    expect(bindings.conflictWith("sidebar.toggle", DEFAULT_KEYS["sidebar.toggle"])).toBeUndefined();

    bindings.set("sidebar.toggle", DEFAULT_KEYS["replay.toggle"]);
    expect(bindings.conflicts().get(DEFAULT_KEYS["replay.toggle"])).toEqual(["replay.toggle", "sidebar.toggle"]);

    bindings.set("replay.toggle", undefined);
    expect(bindings.keys()["replay.toggle"]).toBeUndefined();
    expect(bindings.conflicts().size).toBe(0);

    const again = createRoot(() => createKeybindings(storage));
    expect(again.keys()["sidebar.toggle"]).toBe(DEFAULT_KEYS["replay.toggle"]);
    expect(again.keys()["replay.toggle"]).toBeUndefined();
    expect(again.actionFor(DEFAULT_KEYS["replay.toggle"])).toBe("sidebar.toggle");

    again.resetAll();
    expect(again.keys()).toEqual(DEFAULT_KEYS);
  });

  describe("已保存的旧键位：发现未知动作或缺少当前目录里的动作，整体回到默认", () => {
    const load = (saved: unknown) => {
      const storage = memoryStorage();
      storage.setItem(KEYBINDINGS_KEY, JSON.stringify(saved));
      return createRoot(() => createKeybindings(storage)).keys();
    };

    it("#5 版只存与默认不同的部分，含已删除的数字键动作：全部回到默认", () => {
      expect(load({ "console.toggle": "Q", "view.toggleMapRoom": "X" })).toEqual(DEFAULT_KEYS);
    });

    it("只有已知动作但缺少新动作（旧目录里没有 H、反引号、Esc）：全部回到默认", () => {
      expect(load({ "view.toggleMapRoom": "X", "replay.toggle": null })).toEqual(DEFAULT_KEYS);
    });

    it("完整的当前目录照常读回，包括解绑", () => {
      const saved = { ...DEFAULT_KEYS, "view.toggleMapRoom": "X", "console.toggle": null };
      expect(load(saved)).toEqual({ ...DEFAULT_KEYS, "view.toggleMapRoom": "X", "console.toggle": undefined });
    });

    it("当前目录之外多出一个动作也回到默认", () => {
      expect(load({ ...DEFAULT_KEYS, "view.toggleMapRoom": "X", "panel.map": "1" })).toEqual(DEFAULT_KEYS);
    });
  });
});

describe("按键分发", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = "";
  });

  function setup() {
    const ran: string[] = [];
    const [bindings, commands, dispose] = createRoot((d) => {
      const b = createKeybindings(memoryStorage());
      const c = createShortcutCommands();
      attachShortcuts(document, b, c);
      return [b, c, d] as const;
    });
    cleanup = dispose;
    commands.register({ "sidebar.toggle": () => void ran.push("sidebar"), "replay.playPause": () => void ran.push("play") });
    return { ran, bindings, commands };
  }

  it("按下绑定的键执行动作并阻止默认行为", () => {
    const { ran } = setup();
    const event = press(document.body, { key: DEFAULT_KEYS["sidebar.toggle"] });
    expect(ran).toEqual(["sidebar"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("输入框、文本区、下拉框与可编辑元素获得焦点时不拦截", () => {
    const { ran } = setup();
    for (const html of ['<input type="text">', "<textarea></textarea>", "<select></select>", '<div contenteditable="true"></div>']) {
      document.body.innerHTML = html;
      const event = press(document.body.firstElementChild!, { key: DEFAULT_KEYS["sidebar.toggle"] });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(ran).toEqual([]);
  });

  it("按钮上的空格交给按钮本身", () => {
    const { ran } = setup();
    document.body.innerHTML = "<button>x</button>";
    press(document.body.firstElementChild!, { key: " " });
    expect(ran).toEqual([]);
    press(document.body, { key: " " });
    expect(ran).toEqual(["play"]);
  });

  it("没有处理者的动作不阻止默认行为；处理者注销后不再执行", () => {
    const { ran, commands } = setup();
    expect(press(document.body, { key: DEFAULT_KEYS["console.toggle"] }).defaultPrevented).toBe(false);
    const handler = vi.fn();
    const off = commands.register({ "console.toggle": handler });
    press(document.body, { key: DEFAULT_KEYS["console.toggle"] });
    off();
    press(document.body, { key: DEFAULT_KEYS["console.toggle"] });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ran).toEqual([]);
  });

  it("带 Ctrl / Meta 的未绑定组合不拦截（不抢浏览器快捷键）", () => {
    const { ran } = setup();
    expect(press(document.body, { key: "1", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(ran).toEqual([]);
  });
});
