import { describe, expect, it } from "vitest";
import {
  addPanel,
  movePanel,
  parseDesktopLayout,
  parseMonitorLayout,
  removePanel,
  resizePanel,
  showTab,
  toggleTab,
  type DesktopLayout,
  type PanelCatalog,
} from "./layout.ts";

const catalog: PanelCatalog = {
  ids: ["map", "room", "pvp", "settings"],
  size: (id) => (id === "settings" ? { w: 12, h: 6 } : { w: 6, h: 8 }),
};

const two: DesktopLayout = {
  panels: [
    { id: "map", x: 0, y: 0, w: 6, h: 8 },
    { id: "room", x: 6, y: 0, w: 6, h: 8 },
  ],
};

function overlaps(layout: DesktopLayout) {
  const ps = layout.panels;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!;
      const b = ps[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  return false;
}

describe("桌面布局", () => {
  it("新增的面板放在最下面，默认尺寸来自面板目录；已打开的不重复", () => {
    const added = addPanel(two, "settings", catalog);
    expect(added.panels.at(-1)).toEqual({ id: "settings", x: 0, y: 8, w: 12, h: 6 });
    expect(addPanel(added, "map", catalog)).toBe(added);
  });

  it("关闭面板只移除它，下面的面板往上靠拢", () => {
    expect(removePanel(two, "map").panels.map((p) => p.id)).toEqual(["room"]);
    const stacked = addPanel(two, "settings", catalog);
    expect(removePanel(stacked, "map").panels.find((p) => p.id === "settings")).toMatchObject({ y: 8 });
    const column = movePanel(addPanel({ panels: [two.panels[0]!] }, "pvp", catalog), "pvp", 0, 8);
    expect(removePanel(column, "map").panels).toEqual([{ id: "pvp", x: 0, y: 0, w: 6, h: 8 }]);
  });

  it("拖到别的面板上时把它推到下面，不重叠", () => {
    const moved = movePanel(two, "room", 2, 0);
    expect(moved.panels.find((p) => p.id === "room")).toMatchObject({ x: 2, y: 0 });
    expect(moved.panels.find((p) => p.id === "map")).toMatchObject({ x: 0, y: 8 });
    expect(overlaps(moved)).toBe(false);
  });

  it("位置与尺寸限制在网格内", () => {
    expect(movePanel(two, "map", 20, -3).panels.find((p) => p.id === "map")).toMatchObject({ x: 6, y: 0 });
    const resized = resizePanel(two, "map", 30, 1);
    expect(resized.panels.find((p) => p.id === "map")).toMatchObject({ w: 12, h: 3 });
    expect(overlaps(resized)).toBe(false);
  });

  it("读回存储时丢掉未知面板与坏数据，修正越界值并消除重叠", () => {
    const parsed = parseDesktopLayout(
      JSON.stringify({
        panels: [
          { id: "map", x: 0, y: 0, w: 6, h: 8 },
          { id: "console", x: 0, y: 0, w: 6, h: 8 },
          { id: "room", x: 3, y: 2, w: 40, h: 8 },
          { id: "pvp", x: "a" },
          { id: "map", x: 6, y: 0, w: 6, h: 8 },
        ],
      }),
      catalog,
    );
    expect(parsed?.panels.map((p) => p.id)).toEqual(["map", "room"]);
    expect(parsed?.panels[1]?.w).toBe(12);
    expect(overlaps(parsed!)).toBe(false);
    expect(parseDesktopLayout("{not json", catalog)).toBeUndefined();
    expect(parseDesktopLayout(null, catalog)).toBeUndefined();
  });
});

describe("Monitor Mode 布局", () => {
  it("切到某个面板时它成为当前标签，不在标签栏里就加到末尾", () => {
    const layout = { tabs: ["map", "room"], active: "map" };
    expect(showTab(layout, "room")).toEqual({ tabs: ["map", "room"], active: "room" });
    expect(showTab(layout, "pvp")).toEqual({ tabs: ["map", "room", "pvp"], active: "pvp" });
  });

  it("从标签栏移除当前标签时切到相邻标签；至少保留一个", () => {
    const layout = { tabs: ["map", "room", "pvp"], active: "room" };
    expect(toggleTab(layout, "room")).toEqual({ tabs: ["map", "pvp"], active: "map" });
    expect(toggleTab({ tabs: ["map"], active: "map" }, "map")).toEqual({ tabs: ["map"], active: "map" });
    expect(toggleTab(layout, "settings")).toEqual({ tabs: ["map", "room", "pvp", "settings"], active: "room" });
  });

  it("读回存储时丢掉未知标签；当前标签无效时取第一个", () => {
    expect(parseMonitorLayout(JSON.stringify({ tabs: ["console", "pvp", "map", "pvp"], active: "console" }), catalog)).toEqual({
      tabs: ["pvp", "map"],
      active: "pvp",
    });
    expect(parseMonitorLayout(JSON.stringify({ tabs: [], active: "map" }), catalog)).toBeUndefined();
    expect(parseMonitorLayout("[]", catalog)).toBeUndefined();
  });
});
