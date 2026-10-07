/**
 * 快捷键（#5）：动作目录、默认键位、用户重绑（`msc.keys`，只存与默认不同的部分）与按键分发。
 *
 * - 动作的执行者通过 ShortcutCommands.register 登记：App 登记面板切换（PanelController），
 *   Room View 登记 Live / Replay 与播放控制。没有执行者的动作按下时什么也不做，也不阻止默认行为。
 * - 焦点在输入框、文本区、下拉框或可编辑元素里时不拦截；按钮等控件上的空格 / 回车交给控件本身。
 * - 每个动作至多一个键；同一个键绑给多个动作即冲突（conflicts），分发时取动作目录里靠前的那个。
 */
import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type { MessageKey } from "../i18n";
import type { SettingsStorage } from "../settings/settings.ts";

export const KEYBINDINGS_KEY = "msc.keys";

/** 动作目录（显示顺序）；面板动作的 panel 是 PanelController.focus 的 id */
export const SHORTCUT_ACTIONS = [
  { id: "panel.map", title: "shortcuts.action.panel.map", panel: "map" },
  { id: "panel.room", title: "shortcuts.action.panel.room", panel: "room" },
  { id: "panel.pvp", title: "shortcuts.action.panel.pvp", panel: "pvp" },
  { id: "panel.details", title: "shortcuts.action.panel.details", panel: "details" },
  { id: "panel.settings", title: "shortcuts.action.panel.settings", panel: "settings" },
  { id: "panel.console", title: "shortcuts.action.panel.console", panel: "console" },
  { id: "view.toggleMapRoom", title: "shortcuts.action.view.toggleMapRoom" },
  { id: "replay.toggle", title: "shortcuts.action.replay.toggle" },
  { id: "replay.playPause", title: "shortcuts.action.replay.playPause" },
  { id: "replay.stepBack", title: "shortcuts.action.replay.stepBack" },
  { id: "replay.stepForward", title: "shortcuts.action.replay.stepForward" },
] as const satisfies readonly { id: string; title: MessageKey; panel?: string }[];

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]["id"];

export const DEFAULT_KEYS: Readonly<Record<ShortcutAction, string>> = {
  "panel.map": "1",
  "panel.room": "2",
  "panel.pvp": "3",
  "panel.details": "4",
  "panel.settings": "5",
  "panel.console": "6",
  "view.toggleMapRoom": "M",
  "replay.toggle": "R",
  "replay.playPause": "Space",
  "replay.stepBack": ",",
  "replay.stepForward": ".",
};

const ACTION_IDS = new Set<string>(SHORTCUT_ACTIONS.map((a) => a.id));
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "CapsLock", "Fn", "OS", "Dead", "Unidentified", "Process"]);

type KeyInit = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/**
 * 归一化的按键名，如 `M`、`Shift+M`、`Ctrl+Alt+K`、`Space`、`ArrowLeft`、`?`。
 * 字母不分大小写；可打印的非字母字符已体现了 Shift，不再记 Shift。单按修饰键时为 undefined。
 */
export function keyFromEvent(event: KeyInit): string | undefined {
  if (!event.key || MODIFIER_KEYS.has(event.key)) return undefined;
  let key = event.key === " " ? "Space" : event.key;
  const printable = key.length === 1;
  const letter = printable && /[a-z]/i.test(key);
  if (letter) key = key.toUpperCase();
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && (!printable || letter)) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

type Bindings = Readonly<Record<ShortcutAction, string | undefined>>;

export interface Keybindings {
  /** 动作 → 键；undefined 表示未绑定 */
  readonly keys: Accessor<Bindings>;
  /** 绑给多个动作的键 → 这些动作（按目录顺序） */
  readonly conflicts: Accessor<ReadonlyMap<string, readonly ShortcutAction[]>>;
  /** 键 → 动作（冲突时取目录里靠前的） */
  actionFor(key: string): ShortcutAction | undefined;
  /** 把 key 绑给 action 时会与哪个别的动作冲突 */
  conflictWith(action: ShortcutAction, key: string): ShortcutAction | undefined;
  /** key 为 undefined 时解绑 */
  set(action: ShortcutAction, key: string | undefined): void;
  reset(action: ShortcutAction): void;
  resetAll(): void;
}

function readOverrides(storage: SettingsStorage | undefined): Partial<Record<ShortcutAction, string | null>> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEYBINDINGS_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Partial<Record<ShortcutAction, string | null>> = {};
    for (const [action, key] of Object.entries(parsed)) {
      if (!ACTION_IDS.has(action)) continue;
      if (key === null || (typeof key === "string" && key.trim() !== "")) result[action as ShortcutAction] = key;
    }
    return result;
  } catch {
    return {};
  }
}

export function createKeybindings(storage: SettingsStorage | undefined): Keybindings {
  /** 与默认不同的部分；null 表示解绑 */
  const [overrides, setOverrides] = createSignal(readOverrides(storage));

  const keys = createMemo<Bindings>(() => {
    const o = overrides();
    const result = {} as Record<ShortcutAction, string | undefined>;
    for (const { id } of SHORTCUT_ACTIONS) {
      const value = o[id];
      result[id] = value === null ? undefined : (value ?? DEFAULT_KEYS[id]);
    }
    return result;
  });

  const byKey = createMemo(() => {
    const map = new Map<string, ShortcutAction[]>();
    for (const { id } of SHORTCUT_ACTIONS) {
      const key = keys()[id];
      if (key !== undefined) map.set(key, [...(map.get(key) ?? []), id]);
    }
    return map;
  });
  const conflicts = createMemo(() => new Map([...byKey()].filter(([, actions]) => actions.length > 1)));

  const save = (next: Partial<Record<ShortcutAction, string | null>>) => {
    setOverrides(next);
    try {
      storage?.setItem(KEYBINDINGS_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用时本次会话内仍生效
    }
  };
  const without = (action: ShortcutAction) => {
    const { [action]: _dropped, ...rest } = overrides();
    return rest;
  };

  return {
    keys,
    conflicts,
    actionFor: (key) => byKey().get(key)?.[0],
    conflictWith: (action, key) => byKey().get(key)?.find((other) => other !== action),
    set(action, key) {
      if (key === DEFAULT_KEYS[action]) save(without(action));
      else save({ ...without(action), [action]: key ?? null });
    },
    reset: (action) => save(without(action)),
    resetAll: () => save({}),
  };
}

/** 返回 false 表示此刻不适用（例如不在 Replay 里按播放），交给更早登记的执行者或不处理 */
export type ShortcutHandler = () => boolean | void;

export interface ShortcutCommands {
  /** 登记动作的执行者；返回注销函数。同一动作后登记的优先 */
  register(handlers: Partial<Record<ShortcutAction, ShortcutHandler>>): () => void;
  /** 有执行者时执行并返回 true */
  run(action: ShortcutAction): boolean;
}

export function createShortcutCommands(): ShortcutCommands {
  const stack: Partial<Record<ShortcutAction, ShortcutHandler>>[] = [];
  return {
    register(handlers) {
      stack.push(handlers);
      return () => {
        const at = stack.indexOf(handlers);
        if (at >= 0) stack.splice(at, 1);
      };
    },
    run(action) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const handler = stack[i]![action];
        if (handler && handler() !== false) return true;
      }
      return false;
    },
  };
}

const REPEATABLE = new Set<ShortcutAction>(["replay.stepBack", "replay.stepForward"]);

const TEXT_INPUT_EXEMPT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** 键盘输入归它自己的元素：文字输入框、文本区、下拉框、可编辑元素，以及重绑界面（data-shortcut-capture） */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-shortcut-capture]")) return true;
  if (target instanceof HTMLInputElement) return !TEXT_INPUT_EXEMPT.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("[contenteditable=''],[contenteditable='true']") !== null);
}

/** 空格 / 回车在这些控件上有自己的含义（按下按钮、勾选） */
function activatesControl(target: EventTarget | null, key: string): boolean {
  if (key !== "Space" && key !== "Enter") return false;
  return target instanceof Element && target.closest("button, a[href], summary, input, [role=button], [role=tab]") !== null;
}

/** 在 target（通常是 document）上监听按键并分发；随 Solid owner 释放。 */
export function attachShortcuts(target: EventTarget, bindings: Keybindings, commands: ShortcutCommands): void {
  const onKey = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (event.defaultPrevented || event.isComposing) return;
    if (isTypingTarget(event.target)) return;
    const key = keyFromEvent(event);
    if (key === undefined || activatesControl(event.target, key)) return;
    const action = bindings.actionFor(key);
    if (!action) return;
    // 按住不放时只有单步连续触发
    if (event.repeat && !REPEATABLE.has(action)) return void event.preventDefault();
    if (commands.run(action)) event.preventDefault();
  };
  target.addEventListener("keydown", onKey);
  onCleanup(() => target.removeEventListener("keydown", onKey));
}
