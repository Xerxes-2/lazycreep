import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
});

const q = <T extends Element>(selector: string) => container.querySelector<T>(selector);

describe("Console 在 Console Panel 里（#24）", () => {
  it("默认收起，点 Top Bar 的 Console 按钮展开，输入框与发送按钮都在", () => {
    dispose = render(() => <App sourceFor={() => new FixtureSource(bundle)} narrow={() => false} />, container);
    expect(q<HTMLElement>("[data-console-panel]")!.hidden).toBe(true);
    expect(q("form[data-console-send]")).toBeNull();
    q<HTMLButtonElement>("[data-action=toggle-console]")!.click();
    const panel = q<HTMLElement>("[data-console-panel]")!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('input[name="console-expression"]')).not.toBeNull();
    expect(panel.querySelector("form[data-console-send] button[type=submit]")).not.toBeNull();
  });

  it("收起后再展开，Console 不重新挂载（已收到的输出保留）", () => {
    dispose = render(() => <App sourceFor={() => new FixtureSource(bundle)} narrow={() => false} />, container);
    const toggle = q<HTMLButtonElement>("[data-action=toggle-console]")!;
    toggle.click();
    const form = q("form[data-console-send]");
    toggle.click();
    expect(q<HTMLElement>("[data-console-panel]")!.hidden).toBe(true);
    toggle.click();
    expect(q("form[data-console-send]")).toBe(form);
  });
});
