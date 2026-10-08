/**
 * #59：对象详情里的身体部件网格（DOM）。格子的顺序、颜色、填充、强化；悬停与触屏按下显示单格说明；
 * 每 Tick 重算详情时网格不重建。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "../i18n";
import { RoomDetailsPanel } from "./room-controls.tsx";
import type { RoomObject } from "./room-state.ts";

const styles = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");

const creep = (hits: number[]): RoomObject => ({
  _id: "c1",
  type: "creep",
  x: 1,
  y: 1,
  body: [
    { type: "tough", hits: hits[0], boost: "XGHO2" },
    { type: "work", hits: hits[1] },
    { type: "move", hits: hits[2] },
    ...Array.from({ length: 12 }, () => ({ type: "move", hits: 100 })),
  ],
});

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
});

function mount(initial: RoomObject) {
  const [object, setObject] = createSignal<RoomObject | undefined>(initial);
  dispose = render(
    () => (
      <I18nProvider>
        <RoomDetailsPanel object={object()} users={{}} gameTime={1} onClose={() => {}} />
      </I18nProvider>
    ),
    container,
  );
  return setObject;
}

const cells = () => [...container.querySelectorAll<HTMLElement>(".body-grid__cell")];
const info = () => container.querySelector("[data-part-info]")?.textContent;

describe("身体部件网格（#59）", () => {
  it("按 body 顺序一格一个部件，颜色、填充比例、强化标记；下方是缩写汇总", () => {
    mount(creep([100, 0, 37]));
    const grid = cells();
    expect(grid).toHaveLength(15);
    expect(grid.map((c) => c.dataset["part"]).slice(0, 4)).toEqual(["tough", "work", "move", "move"]);
    expect(grid[0]!.style.getPropertyValue("--part-color")).toBe("#ffffff");
    expect(grid[1]!.style.getPropertyValue("--part-color")).toBe("#fde574");
    expect(grid.map((c) => c.style.getPropertyValue("--part-fill")).slice(0, 3)).toEqual(["100%", "0%", "37%"]);
    expect(grid[0]!.hasAttribute("data-boost")).toBe(true);
    expect(grid[1]!.hasAttribute("data-boost")).toBe(false);
    expect(container.querySelector("[data-body-summary]")!.textContent).toBe("1T 1W 13M");
  });

  it("鼠标悬停显示类型、血量、强化矿物，移开收起；触屏按下（长按）显示且不弹系统菜单", () => {
    mount(creep([100, 0, 37]));
    expect(info()).toBeUndefined();
    cells()[0]!.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    expect(info()).toBe("坚韧（TOUGH） · 血量 100/100 · 强化 XGHO2");
    cells()[0]!.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(info()).toBeUndefined();

    cells()[2]!.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    expect(info()).toBe("移动（MOVE） · 血量 37/100");
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    cells()[2]!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    // 手指抬起离开后仍保留
    cells()[2]!.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    expect(info()).toBe("移动（MOVE） · 血量 37/100");
  });

  it("新 Tick 重算详情时网格原地更新，说明跟着新血量走", () => {
    const setObject = mount(creep([100, 0, 37]));
    const first = cells()[2]!;
    first.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    setObject(creep([100, 0, 12]));
    expect(cells()[2]).toBe(first);
    expect(first.style.getPropertyValue("--part-fill")).toBe("12%");
    expect(info()).toBe("移动（MOVE） · 血量 12/100");
    // 换成别的对象时收起
    setObject({ ...creep([100, 0, 12]), _id: "c2" });
    expect(info()).toBeUndefined();
  });

  it("没有 body 的对象不显示网格", () => {
    mount({ _id: "s", type: "source", x: 1, y: 1, energy: 10, energyCapacity: 3000 });
    expect(container.querySelector("[data-testid=body-grid]")).toBeNull();
  });

  it("样式：每行 10 个圆形小格，剩余血量从下往上填充，强化是粗框", () => {
    expect(styles).toMatch(/\.body-grid \{[^}]*grid-template-columns:\s*repeat\(10,/);
    expect(styles).toMatch(/\.body-grid__cell \{[^}]*border-radius:\s*50%/);
    expect(styles).toMatch(/\.body-grid__cell \{[^}]*linear-gradient\(to top, var\(--part-color\) var\(--part-fill\)/);
    expect(styles).toMatch(/\.body-grid__cell\[data-boost\] \{[^}]*outline:\s*2px solid/);
  });
});
