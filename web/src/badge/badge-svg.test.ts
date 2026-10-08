import { describe, expect, it } from "vitest";
import official from "./official-badges.fixture.json";
import { badgeSvg, BADGE_PLACEHOLDER_SVG } from "./badge-svg.ts";
import { parseBadge, type Badge } from "./badge.ts";

/**
 * 对照输出由官方原版 JS 生成器实际运行得到（scripts/record-badge-fixtures.mjs，
 * screeps/backend-local 的 lib/game/api/badge.js），见 fixture 的 source 字段。
 */
interface Case {
  readonly badge: Badge;
  readonly border?: boolean;
  readonly svg: string;
}
const cases = official.cases as unknown as readonly Case[];

const describeCase = (c: Case) =>
  `${typeof c.badge.type === "number" ? `type ${c.badge.type}` : "自定义路径"}` +
  ` param ${String(c.badge.param)} flip ${String(c.badge.flip)}` +
  ` 颜色 ${[c.badge.color1, c.badge.color2, c.badge.color3].join("/")}${c.border ? " 带黑边" : ""}`;

describe("徽章生成器与官方生成器逐字一致", () => {
  it("对照集覆盖 24 种类型、param 边界、flip、数字调色板与自定义路径", () => {
    const types = new Set(cases.map((c) => c.badge.type).filter((t) => typeof t === "number"));
    expect(types.size).toBe(24);
    for (const param of [-100, 0, 100]) expect(cases.some((c) => c.badge.param === param)).toBe(true);
    expect(cases.some((c) => c.badge.flip)).toBe(true);
    expect(cases.some((c) => typeof c.badge.color1 === "number")).toBe(true);
    expect(cases.some((c) => typeof c.badge.type === "object")).toBe(true);
  });

  it.each(cases.map((c) => [describeCase(c), c] as const))("%s", (_name, c) => {
    expect(badgeSvg(c.badge, c.border === true)).toBe(c.svg);
  });
});

describe("徽章数据的读取", () => {
  it("接受数字类型与自定义路径对象；缺 param 时按 0", () => {
    expect(parseBadge({ type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false })).toEqual({
      type: 5,
      color1: "#ba0e09",
      color2: "#ffbf00",
      color3: "#ffbf00",
      param: -68,
      flip: false,
    });
    expect(parseBadge({ type: { path1: "M 0 0", path2: "" }, color1: 3, color2: "#000000", color3: 79 })).toEqual({
      type: { path1: "M 0 0", path2: "" },
      color1: 3,
      color2: "#000000",
      color3: 79,
      param: 0,
      flip: false,
    });
  });

  it("没有徽章或徽章不合法时为 undefined", () => {
    for (const raw of [
      undefined,
      null,
      "badge",
      {},
      { type: 25, color1: "#000000", color2: "#000000", color3: "#000000", param: 0, flip: false },
      { type: 3, color1: "red", color2: "#000000", color3: "#000000", param: 0, flip: false },
      { type: 3, color1: 80, color2: "#000000", color3: "#000000", param: 0, flip: false },
      { type: 3, color1: '#000000"/><script>', color2: "#000000", color3: "#000000", param: 0, flip: false },
      { type: { path1: 'M 0 0"/><script>' }, color1: "#000000", color2: "#000000", color3: "#000000" },
    ]) {
      expect(parseBadge(raw), JSON.stringify(raw)).toBeUndefined();
    }
  });

  it("中性占位是一个带圆形裁剪范围的 SVG", () => {
    expect(BADGE_PLACEHOLDER_SVG).toMatch(/^<svg [^>]*viewBox="0 0 100 100"/);
    expect(BADGE_PLACEHOLDER_SVG).toContain("<circle");
  });
});
