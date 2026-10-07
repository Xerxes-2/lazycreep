import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { colorToHex, createColorScheme, hexToColor } from "./color-scheme.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const scheme = (storage: ReturnType<typeof memoryStorage>) => createRoot(() => createColorScheme(storage));

describe("配色（#5）", () => {
  it("默认是内置调色板", () => {
    expect(scheme(memoryStorage()).theme()).toEqual(DEFAULT_THEME);
  });

  it("改颜色与规则立即反映在 Theme 上，并在重新打开后保留", () => {
    const storage = memoryStorage();
    const colors = scheme(storage);
    colors.setColor("background", 0x102030);
    colors.setStranger(1, 0xabcdef);
    colors.setStrangerColoring("faction");
    colors.setPlayerColor(" Alice ", 0x123456);
    const expected = {
      ...DEFAULT_THEME,
      background: 0x102030,
      strangers: DEFAULT_THEME.strangers.map((c, i) => (i === 1 ? 0xabcdef : c)),
      strangerColoring: "faction",
      playerColors: { alice: 0x123456 },
    };
    expect(colors.theme()).toEqual(expected);
    expect(scheme(storage).theme()).toEqual(expected);

    colors.setPlayerColor("ALICE", undefined);
    expect(colors.theme().playerColors).toEqual({});
  });

  it("恢复默认", () => {
    const storage = memoryStorage();
    const colors = scheme(storage);
    colors.setColor("owned", 0x000001);
    colors.reset();
    expect(colors.theme()).toEqual(DEFAULT_THEME);
    expect(scheme(storage).theme()).toEqual(DEFAULT_THEME);
  });

  it("存储里的坏值与未知键被忽略", () => {
    const storage = memoryStorage({
      "msc.colors": JSON.stringify({
        colors: { background: "#010203", owned: "red", nope: "#ffffff" },
        strangers: ["#zzzzzz", "#00ff00"],
        strangerColoring: "rainbow",
        playerColors: { bob: "#0000ff", eve: 5 },
      }),
    });
    const theme = scheme(storage).theme();
    expect(theme.background).toBe(0x010203);
    expect(theme.owned).toBe(DEFAULT_THEME.owned);
    expect(theme.strangers[0]).toBe(DEFAULT_THEME.strangers[0]);
    expect(theme.strangers[1]).toBe(0x00ff00);
    expect(theme.strangerColoring).toBe("perPlayer");
    expect(theme.playerColors).toEqual({ bob: 0x0000ff });
  });

  it("颜色与 #rrggbb 互转", () => {
    expect(colorToHex(0x0a0b0c)).toBe("#0a0b0c");
    expect(hexToColor("#0A0B0C")).toBe(0x0a0b0c);
    expect(hexToColor("0a0b0c")).toBeUndefined();
  });
});
