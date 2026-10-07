import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { App } from "./App";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount() {
  dispose?.();
  container.innerHTML = "";
  dispose = render(() => <App />, container);
}

function heading() {
  return container.querySelector("h1")?.textContent;
}

function languageButton() {
  const button = container.querySelector<HTMLButtonElement>("button[data-action=toggle-locale]");
  if (!button) throw new Error("language toggle not rendered");
  return button;
}

describe("App", () => {
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

  it("shows the application title in zh-CN by default", () => {
    mount();
    expect(heading()).toBe("Screeps 客户端");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("switches between zh-CN and en with the language button", () => {
    mount();
    languageButton().click();
    expect(heading()).toBe("Screeps Client");
    expect(document.documentElement.lang).toBe("en");
    languageButton().click();
    expect(heading()).toBe("Screeps 客户端");
  });

  it("keeps the chosen language after a reload", () => {
    mount();
    languageButton().click();
    mount();
    expect(heading()).toBe("Screeps Client");
  });
});
