import { describe, expect, it } from "vitest";
import { ownerColorRule } from "../room/room-detail-rules.ts";
import { DEFAULT_THEME, type Theme } from "../scene/theme.ts";

const users = {
  me1: { _id: "me1", username: "Me" },
  a: { _id: "a", username: "Alice" },
  b: { _id: "b", username: "Bob" },
  c: { _id: "c", username: "Carol" },
  d: { _id: "d", username: "Dave" },
};

describe("可编辑的着色规则（#5）", () => {
  it("按阵营着色时所有陌生玩家同一种颜色", () => {
    const theme: Theme = { ...DEFAULT_THEME, strangerColoring: "faction" };
    const color = ownerColorRule(theme, users, { me: "me1" });
    expect(new Set(["a", "b", "c", "d"].map(color))).toEqual(new Set([theme.strangers[0]]));
  });

  it("按玩家着色时不同陌生玩家通常颜色不同", () => {
    const color = ownerColorRule(DEFAULT_THEME, users, { me: "me1" });
    expect(new Set(["a", "b", "c", "d"].map(color)).size).toBeGreaterThan(1);
  });

  it("按玩家指定的颜色优先于盟友与陌生人着色，不分大小写，不作用于自己", () => {
    const theme: Theme = { ...DEFAULT_THEME, playerColors: { alice: 0x123456, bob: 0x654321, me: 0x111111 } };
    const color = ownerColorRule(theme, users, { me: "me1", allies: new Set(["Bob"]) });
    expect(color("a")).toBe(0x123456);
    expect(color("b")).toBe(0x654321);
    expect(color("me1")).toBe(theme.owned);
    expect(color(undefined)).toBe(theme.neutral);
  });
});
