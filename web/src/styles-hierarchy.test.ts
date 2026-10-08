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

/** 规则体里的字号、颜色、字重都来自变量，不是散落的字面量 */
function usesTokens(body: string) {
  for (const prop of ["font-size", "color", "font-weight"]) {
    for (const m of body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`, "g"))) {
      expect(m[1]!.trim(), `${prop}: ${m[1]}`).toMatch(/^var\(--/);
    }
  }
}

describe("Sidebar 的通用层级套用变量（#39）", () => {
  it("区块标题：标题字号、粗体、主要文字色，与正文之间有分隔线", () => {
    const title = rule(".sidebar-section__title button");
    expect(title).toMatch(/font-size:\s*var\(--fs-title\)/);
    expect(title).toMatch(/font-weight:\s*var\(--weight-strong\)/);
    expect(title).toMatch(/color:\s*var\(--color-primary\)/);
    expect(title).toMatch(/border-bottom:[^;]*var\(--divider\)/);
    usesTokens(title);
  });

  it("正文与分组标题：正文字号；分组标题粗体、比区块标题小", () => {
    const body = rule(".sidebar-section__body");
    expect(body).toMatch(/font-size:\s*var\(--fs-body\)/);
    expect(body).toMatch(/color:\s*var\(--color-primary\)/);
    const group = rule(".sidebar-section__body h3");
    expect(group).toMatch(/font-size:\s*var\(--fs-group\)/);
    expect(group).toMatch(/font-weight:\s*var\(--weight-strong\)/);
    usesTokens(body);
    usesTokens(group);
  });

  it("次要文字与错误：次要色小字号；错误用危险色", () => {
    const muted = rule(".settings__muted");
    expect(muted).toMatch(/color:\s*var\(--color-secondary\)/);
    expect(muted).toMatch(/font-size:\s*var\(--fs-small\)/);
    expect(rule(".settings__error")).toMatch(/color:\s*var\(--color-danger\)/);
  });
});

describe("PvP 卡片适配 260px 的 Sidebar（#39）", () => {
  /** 选择器含 pvp 的全部规则体 */
  const pvpRules = [...styles.matchAll(/(?:^|\n)([^{}\n]*pvp[^{}\n]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));

  it("没有横向滚动、没有超出 Sidebar 的固定宽度，不再有表格规则", () => {
    expect(pvpRules.length).toBeGreaterThan(0);
    for (const { selector, body } of pvpRules) {
      expect(body, selector).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
      for (const m of body.matchAll(/(?:^|[;\s])(?:min-)?width:\s*(\d+)px/g)) expect(Number(m[1]), selector).toBeLessThanOrEqual(240);
      expect(selector).not.toMatch(/\b(table|th|td|tr)\b/);
    }
  });

  it("卡片是两列网格，文字列可收缩；所有者省略号截断，参战者长名字可断行", () => {
    const card = rule(".pvp-card");
    expect(card).toMatch(/display:\s*grid/);
    expect(card).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(card).toMatch(/border(-top|-bottom)?:[^;]*var\(--divider\)/);
    const owner = rule(".pvp-card__owner");
    expect(owner).toMatch(/text-overflow:\s*ellipsis/);
    expect(owner).toMatch(/overflow:\s*hidden/);
    expect(owner).toMatch(/white-space:\s*nowrap/);
    expect(rule(".pvp-card__combatants")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".pvp-card__ago")).toMatch(/white-space:\s*nowrap/);
  });

  it("时间窗是单行分段控件：不换行，按钮平分宽度且可收缩", () => {
    const bar = rule(".segmented");
    expect(bar).toMatch(/display:\s*flex/);
    expect(bar).toMatch(/flex-wrap:\s*nowrap/);
    const button = rule(".segmented button");
    expect(button).toMatch(/flex:\s*1/);
    expect(button).toMatch(/min-width:\s*0/);
  });
});
