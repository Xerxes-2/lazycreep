import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { AllyListSettings } from "./AllyListSettings.tsx";
import { createAllyList, type AllyList } from "./ally-list.ts";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(list: AllyList = createAllyList(localStorage)) {
  dispose?.();
  container.innerHTML = "";
  dispose = render(
    () => (
      <I18nProvider>
        <AllyListSettings allies={list} />
      </I18nProvider>
    ),
    container,
  );
  return list;
}

const shownNames = () => [...container.querySelectorAll("[data-ally]")].map((el) => el.getAttribute("data-ally"));

function add(name: string) {
  const input = container.querySelector<HTMLInputElement>("input[name=ally-name]")!;
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("Ally List 设置", () => {
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

  it("添加玩家名：去掉首尾空白，不分大小写去重，空名忽略", () => {
    const list = mount();
    add("  Alice ");
    add("bob");
    add("ALICE");
    add("   ");
    expect(shownNames()).toEqual(["Alice", "bob"]);
    expect(list.set().has("Alice")).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input[name=ally-name]")!.value).toBe("");
  });

  it("删除玩家名", () => {
    mount();
    add("Alice");
    add("Bob");
    container.querySelector<HTMLButtonElement>('[data-ally="Alice"] button')!.click();
    expect(shownNames()).toEqual(["Bob"]);
  });

  it("名单存在浏览器本地，重新打开后还在", () => {
    mount();
    add("Alice");
    add("Bob");
    container.querySelector<HTMLButtonElement>('[data-ally="Bob"] button')!.click();
    const reopened = mount(createAllyList(localStorage));
    expect(shownNames()).toEqual(["Alice"]);
    expect([...reopened.set()]).toEqual(["Alice"]);
  });

  it("存储不可用或内容损坏时从空名单开始，仍可在本次会话里使用", () => {
    localStorage.setItem("msc.allies", "{not json");
    expect(createAllyList(localStorage).names()).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const list = createAllyList(broken);
    list.add("Alice");
    expect(list.names()).toEqual(["Alice"]);
    expect(createAllyList(undefined).names()).toEqual([]);
  });
});
