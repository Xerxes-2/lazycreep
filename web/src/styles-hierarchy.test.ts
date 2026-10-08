/**
 * 信息层级（#39）：字号、字重、文字颜色、间距、分隔线、圆角集中定义为 CSS 变量，深浅主题各一套颜色。
 * vitest 不处理 CSS，直接检查源文件。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

/** 源文件里某个选择器的第一条规则体（允许缩进，如媒体查询内的规则） */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
  expect(match, selector).not.toBeNull();
  return match![1]!;
}

const declared = (body: string) => new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

/** 与主题无关的阶梯 */
const SCALE = [
  "--fs-title",
  "--fs-group",
  "--fs-body",
  "--fs-small",
  "--font-numeric",
  "--weight-regular",
  "--weight-strong",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--radius-s",
  "--radius-m",
  "--radius-l",
];
/** 每个主题都要给出取值的颜色 */
const COLORS = ["--color-primary", "--color-secondary", "--color-faint", "--color-accent", "--color-danger", "--divider", "--surface-card"];

describe("设计变量（#39）", () => {
  it("在 :root 定义字号阶梯、字重、文字颜色层级、间距阶梯、分隔线与圆角", () => {
    const root = declared(rule(":root"));
    for (const name of [...SCALE, ...COLORS]) expect(root.has(name), name).toBe(true);
  });

  it("深色主题（系统偏好兜底与手动选择）各有一套颜色取值", () => {
    for (const selector of [':root:not([data-theme="light"])', ':root[data-theme="dark"]']) {
      const dark = declared(rule(selector));
      for (const name of COLORS) expect(dark.has(name), `${selector} ${name}`).toBe(true);
    }
  });
});
