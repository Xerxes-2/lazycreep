import { describe, expect, it } from "vitest";
import { readJson, readText, writeJson, type KeyValueStorage } from "./local-store.ts";

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

const asNumber = (v: unknown) => (typeof v === "number" ? v : undefined);

describe("本地存储的安全读写", () => {
  it("写入的 JSON 能按校验读回", () => {
    const storage = memory();
    writeJson(storage, "k", 42);
    expect(readJson(storage, "k", asNumber, 0)).toBe(42);
  });

  it("没有记录、内容损坏或校验不过时返回默认值", () => {
    const storage = memory();
    expect(readJson(storage, "k", asNumber, 7)).toBe(7);
    storage.data.set("k", "{oops");
    expect(readJson(storage, "k", asNumber, 7)).toBe(7);
    storage.data.set("k", '"text"');
    expect(readJson(storage, "k", asNumber, 7)).toBe(7);
  });

  it("存储抛错或不存在时读回默认值、写入静默失败", () => {
    expect(readJson(throwing, "k", asNumber, 7)).toBe(7);
    expect(readText(throwing, "k")).toBeNull();
    expect(() => writeJson(throwing, "k", 1)).not.toThrow();
    expect(readJson(undefined, "k", asNumber, 7)).toBe(7);
  });
});
