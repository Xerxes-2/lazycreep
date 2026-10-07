import { describe, expect, it } from "vitest";
import glossary from "../../../../GLOSSARY.md?raw";
import { zhCN } from "./zh-CN.ts";

/** GLOSSARY.md 里每个术语的 `_Avoid_:` 词 */
const avoided = [...glossary.matchAll(/^_Avoid_:\s*(.+)$/gm)].flatMap((m) => m[1]!.split(/[、,，]/).map((w) => w.trim()));

describe("中文文案遵守词表（GLOSSARY.md）", () => {
  it("不用任何 _Avoid_ 词", () => {
    expect(avoided).toContain("实时");
    for (const [key, text] of Object.entries(zhCN)) {
      for (const word of avoided) expect(text.includes(word), `${key}: ${text} 含“${word}”`).toBe(false);
    }
  });

  it("“回放”只用来指 Replay（历史回放），不指录制数据等别的东西", () => {
    for (const [key, text] of Object.entries(zhCN)) {
      if (text.includes("回放")) expect(key.startsWith("replay."), `${key}: ${text}`).toBe(true);
    }
  });

  it("Live 在中文里叫“即时”", () => {
    expect(zhCN["replay.backToLive"]).toContain("即时");
  });
});
