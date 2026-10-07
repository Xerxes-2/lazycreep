import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { manualVisibility } from "../power/visibility.ts";
import { visibleOrKept } from "./keep-awake.ts";

describe("visibleOrKept", () => {
  it("需要保持时页面隐藏也算可见；不再需要时跟随页面", () => {
    const page = manualVisibility(true);
    const [keep, setKeep] = createSignal(true);
    const { signal, dispose } = createRoot((dispose) => ({ signal: visibleOrKept(page, keep), dispose }));
    const seen: boolean[] = [];
    signal.subscribe((v) => seen.push(v));
    page.set(false);
    expect(signal.visible()).toBe(true);
    setKeep(false);
    expect(signal.visible()).toBe(false);
    page.set(true);
    expect(seen).toEqual([false, true]);
    dispose();
  });
});
