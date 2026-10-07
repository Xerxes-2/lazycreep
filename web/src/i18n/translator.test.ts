import { describe, expect, it } from "vitest";
import { createTranslator } from "./translator";

const dictionaries = {
  "zh-CN": {
    "app.title": "Screeps 客户端",
    "greeting": "你好，{name}",
    "only.zh": "仅中文",
  },
  en: {
    "app.title": "Screeps Client",
    "greeting": "Hello, {name}",
  },
};

describe("createTranslator", () => {
  it("returns the zh-CN text for zh-CN", () => {
    const t = createTranslator(dictionaries, "zh-CN");
    expect(t("app.title")).toBe("Screeps 客户端");
  });

  it("returns the en text for en", () => {
    const t = createTranslator(dictionaries, "en");
    expect(t("app.title")).toBe("Screeps Client");
  });

  it("falls back to zh-CN when en lacks a key", () => {
    const t = createTranslator(dictionaries, "en");
    expect(t("only.zh")).toBe("仅中文");
  });

  it("interpolates named parameters", () => {
    const t = createTranslator(dictionaries, "en");
    expect(t("greeting", { name: "Xerxes" })).toBe("Hello, Xerxes");
  });
});
