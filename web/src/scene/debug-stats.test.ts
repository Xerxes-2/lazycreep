import { describe, expect, it } from "vitest";
import { setDebugOverlay, trackView, viewStats } from "./debug-stats.ts";

describe("调试统计", () => {
  const storage = { getItem: () => null, setItem: () => {} };

  it("关着时不记录；开着时按最近 1 秒算帧率与平均 render 耗时，注销后消失", () => {
    setDebugOverlay(false, storage);
    const canvas = { width: 800, height: 600 };
    const view = trackView("room", canvas);
    view.frame(100, 5);
    expect(viewStats(100).find((s) => s.label === "room")).toMatchObject({ fps: 0, renderMs: undefined, width: 800, height: 600 });

    setDebugOverlay(true, storage);
    for (let i = 1; i <= 60; i++) view.frame(1000 + i * (1000 / 60), i % 2 ? 1 : 3);
    expect(viewStats(2000).find((s) => s.label === "room")).toEqual({ label: "room", fps: 60, renderMs: 2, width: 800, height: 600 });
    // 静止 1 秒后归零
    expect(viewStats(3100).find((s) => s.label === "room")).toMatchObject({ fps: 0, renderMs: undefined });

    view.dispose();
    expect(viewStats(3100).some((s) => s.label === "room")).toBe(false);
    setDebugOverlay(false, storage);
  });
});
