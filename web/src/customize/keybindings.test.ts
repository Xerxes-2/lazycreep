import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import {
  attachShortcuts,
  createKeybindings,
  createShortcutCommands,
  DEFAULT_KEYS,
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

describe("快捷键绑定（#5）", () => {
  it("默认键位覆盖主要导航动作且互不冲突", () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id);
    for (const id of [
      "panel.map",
      "panel.room",
      "panel.pvp",
      "panel.settings",
      "view.toggleMapRoom",
      "replay.toggle",
      "replay.playPause",
      "replay.stepBack",
      "replay.stepForward",
    ]) {
      expect(ids).toContain(id);
      expect(DEFAULT_KEYS[id as keyof typeof DEFAULT_KEYS]).toBeTruthy();
    }
    const bindings = createRoot(() => createKeybindings(memoryStorage()));
    expect(bindings.conflicts().size).toBe(0);
  });

  it("重绑、冲突检测、解绑与恢复默认，并持久化", () => {
    const storage = memoryStorage();
    const bindings = createRoot(() => createKeybindings(storage));
    expect(bindings.conflictWith("panel.map", DEFAULT_KEYS["panel.room"])).toBe("panel.room");
    expect(bindings.conflictWith("panel.map", DEFAULT_KEYS["panel.map"])).toBeUndefined();

    bindings.set("panel.map", DEFAULT_KEYS["panel.room"]);
    expect(bindings.conflicts().get(DEFAULT_KEYS["panel.room"])).toEqual(["panel.map", "panel.room"]);

    bindings.set("panel.room", undefined);
    expect(bindings.keys()["panel.room"]).toBeUndefined();
    expect(bindings.conflicts().size).toBe(0);

    const again = createRoot(() => createKeybindings(storage));
    expect(again.keys()["panel.map"]).toBe(DEFAULT_KEYS["panel.room"]);
    expect(again.keys()["panel.room"]).toBeUndefined();
    expect(again.actionFor(DEFAULT_KEYS["panel.room"])).toBe("panel.map");

    again.resetAll();
    expect(again.keys()).toEqual(DEFAULT_KEYS);
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
    commands.register({ "panel.map": () => void ran.push("map"), "replay.playPause": () => void ran.push("play") });
    return { ran, bindings, commands };
  }

  it("按下绑定的键执行动作并阻止默认行为", () => {
    const { ran } = setup();
    const event = press(document.body, { key: DEFAULT_KEYS["panel.map"] });
    expect(ran).toEqual(["map"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("输入框、文本区、下拉框与可编辑元素获得焦点时不拦截", () => {
    const { ran } = setup();
    for (const html of ['<input type="text">', "<textarea></textarea>", "<select></select>", '<div contenteditable="true"></div>']) {
      document.body.innerHTML = html;
      const event = press(document.body.firstElementChild!, { key: DEFAULT_KEYS["panel.map"] });
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
    expect(press(document.body, { key: DEFAULT_KEYS["panel.room"] }).defaultPrevented).toBe(false);
    const handler = vi.fn();
    const off = commands.register({ "panel.room": handler });
    press(document.body, { key: DEFAULT_KEYS["panel.room"] });
    off();
    press(document.body, { key: DEFAULT_KEYS["panel.room"] });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ran).toEqual([]);
  });

  it("带 Ctrl / Meta 的未绑定组合不拦截（不抢浏览器快捷键）", () => {
    const { ran } = setup();
    expect(press(document.body, { key: "1", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(ran).toEqual([]);
  });
});
