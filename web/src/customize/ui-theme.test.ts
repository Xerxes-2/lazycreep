import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createUiTheme, type DarkQuery } from "./ui-theme.ts";

function fakeQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_: "change", l: () => void) => void listeners.add(l),
    removeEventListener: (_: "change", l: () => void) => void listeners.delete(l),
    flip(next: boolean) {
      query.matches = next;
      for (const l of listeners) l();
    },
    listeners,
  };
  return query satisfies DarkQuery & object;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("页面明暗主题（#5）", () => {
  it("默认跟随系统，并响应系统变化", () => {
    const root = document.createElement("html");
    const query = fakeQuery(true);
    const [ui, dispose] = createRoot((d) => [createUiTheme({ storage: memoryStorage(), darkQuery: query, root }), d] as const);
    expect(ui.preference()).toBe("system");
    expect(ui.resolved()).toBe("dark");
    expect(root.dataset["theme"]).toBe("dark");
    query.flip(false);
    expect(ui.resolved()).toBe("light");
    expect(root.dataset["theme"]).toBe("light");
    dispose();
    expect(query.listeners.size).toBe(0);
  });

  it("手动选择即时生效、持久化，且不再跟随系统", () => {
    const root = document.createElement("html");
    const query = fakeQuery(true);
    const storage = memoryStorage();
    const ui = createRoot(() => createUiTheme({ storage, darkQuery: query, root }));
    ui.setPreference("light");
    expect(root.dataset["theme"]).toBe("light");
    query.flip(true);
    expect(root.dataset["theme"]).toBe("light");
    const again = createRoot(() => createUiTheme({ storage, darkQuery: query, root }));
    expect(again.preference()).toBe("light");
    expect(again.resolved()).toBe("light");
  });

  it("没有 matchMedia 时跟随系统按浅色处理", () => {
    const root = document.createElement("html");
    createRoot(() => {
      const ui = createUiTheme({ storage: undefined, darkQuery: undefined, root });
      expect(ui.resolved()).toBe("light");
    });
  });
});
