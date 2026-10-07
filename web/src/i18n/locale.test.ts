import { beforeEach, describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createLocale } from "./locale";

function inRoot<T>(fn: () => T): T {
  return createRoot((dispose) => {
    const result = fn();
    dispose();
    return result;
  });
}

describe("createLocale", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to zh-CN when nothing is stored", () => {
    const locale = inRoot(() => createLocale(localStorage).locale());
    expect(locale).toBe("zh-CN");
  });

  it("keeps the chosen locale across a reload", () => {
    inRoot(() => createLocale(localStorage).setLocale("en"));
    const reloaded = inRoot(() => createLocale(localStorage).locale());
    expect(reloaded).toBe("en");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem("msc.locale", "fr");
    const locale = inRoot(() => createLocale(localStorage).locale());
    expect(locale).toBe("zh-CN");
  });

  it("still works when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const locale = inRoot(() => {
      const store = createLocale(broken);
      store.setLocale("en");
      return store.locale();
    });
    expect(locale).toBe("en");
  });
});
