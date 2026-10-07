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

describe("Console 面板在面板系统里", () => {
  it("桌面：默认不打开，可从工具栏加入", () => {
    dispose = render(() => <App sourceFor={() => new FixtureSource(bundle)} narrow={() => false} />, container);
    expect(q("[data-panel=console]")).toBeNull();
    q<HTMLButtonElement>('button[data-action="open-panel"][data-panel-id="console"]')!.click();
    expect(q("[data-panel=console] form[data-console-send]")).not.toBeNull();
  });

  it("Monitor Mode：默认不在标签栏，手动加入后输入框与发送按钮都在", () => {
    dispose = render(() => <App sourceFor={() => new FixtureSource(bundle)} narrow={() => true} />, container);
    expect(q('[data-tab="console"]')).toBeNull();
    q<HTMLButtonElement>('[data-action="manage-tabs"]')!.click();
    q<HTMLInputElement>('[data-tab-toggle="console"]')!.click();
    q<HTMLButtonElement>('[data-tab="console"]')!.click();
    const panel = q<HTMLElement>("[data-panel=console]")!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('input[name="console-expression"]')).not.toBeNull();
    expect(panel.querySelector("form[data-console-send] button[type=submit]")).not.toBeNull();
  });
});
