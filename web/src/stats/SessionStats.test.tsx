/**
 * #65 Session Stats 区块：分组的紧凑表格、点行放进焦点区、时间窗口、没数据的行。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { SessionRecorder } from "./session-recorder.ts";
import { CPU_KEY, MEMORY_KEY, roomKey } from "./session-recorder.ts";
import { createSessionStore } from "./session-store.ts";
import { createSessionStatsUi, SessionStats } from "./SessionStats.tsx";

let dispose: (() => void) | undefined;
let container: HTMLDivElement;
afterEach(() => {
  dispose?.();
  container?.remove();
});

function mount(options: { current?: { shard: string; room: string } } = {}) {
  let t = 1_000_000;
  const store = createSessionStore({ now: () => t });
  const [version, setVersion] = createSignal(0);
  const [shown, setShown] = createSignal(true);
  let rooms: { shard: string; room: string; lastAt: number }[] = [];
  const recorder: SessionRecorder = {
    store: () => store,
    version,
    rooms: () => (version(), rooms),
    observeRoom: () => undefined,
  };
  const ui = createSessionStatsUi();
  container = document.createElement("div");
  document.body.append(container);
  dispose = render(
    () => (
      <I18nProvider>
        <SessionStats recorder={recorder} ui={ui} current={() => options.current} shown={shown} />
      </I18nProvider>
    ),
    container,
  );
  return {
    ui,
    setShown,
    feed(fill: (at: number) => void, rs: typeof rooms = rooms) {
      fill(t);
      t += 2000;
      rooms = rs;
      setVersion((v) => v + 1);
    },
    store,
  };
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const rowValue = (key: string) => q(`[data-metric="${key}"] .session-stats__value`)?.textContent;

describe("Session Stats（#65）", () => {
  it("账号与服务器两组常驻；记过的房间各成一组，当前房间排最前", () => {
    const m = mount({ current: { shard: "s", room: "W2N2" } });
    m.feed(
      (at) => {
        m.store.record(CPU_KEY, 12.34, at);
        m.store.record(MEMORY_KEY, 2 * 1024 * 1024, at);
        m.store.record(roomKey("s", "W1N1", "storage"), 412_345, at);
        m.store.record(roomKey("s", "W2N2", "hostile"), 3, at);
      },
      [
        { shard: "s", room: "W1N1", lastAt: 2 },
        { shard: "s", room: "W2N2", lastAt: 1 },
      ],
    );
    const groups = [...container.querySelectorAll(".session-stats__group")].map((el) => el.textContent);
    expect(groups[0]).toBe("账号");
    expect(groups[1]).toBe("服务器");
    expect(groups[2]).toContain("W2N2");
    expect(groups[2]).toContain("当前房间");
    expect(groups[3]).toBe("W1N1");
    expect(rowValue(CPU_KEY)).toBe("12.3ms");
    expect(rowValue(MEMORY_KEY)).toBe("2.00MB");
    expect(rowValue(roomKey("s", "W1N1", "storage"))).toBe("412.3k");
    // 房间只列出记过的指标
    expect(q(`[data-metric="${roomKey("s", "W1N1", "terminal")}"]`)).toBeNull();
  });

  it("没数据的行显示“—”并标出来", () => {
    const m = mount();
    m.feed(() => undefined);
    const tick = q('[data-metric="tick"]')!;
    expect(tick.hasAttribute("data-empty")).toBe(true);
    expect(rowValue("tick")).toBe("—");
  });

  it("默认焦点是 CPU；点行加入焦点，最多 3 个，再点移出", () => {
    const m = mount();
    m.feed((at) => {
      for (const key of [CPU_KEY, MEMORY_KEY, "tick", "x"]) m.store.record(key, 1, at);
    });
    const focused = () => [...container.querySelectorAll<HTMLElement>("[data-focus]")].map((el) => el.dataset["focus"]);
    expect(focused()).toEqual([CPU_KEY]);
    q<HTMLButtonElement>(`[data-metric="${MEMORY_KEY}"]`)!.click();
    q<HTMLButtonElement>('[data-metric="tick"]')!.click();
    expect(focused()).toEqual([CPU_KEY, MEMORY_KEY, "tick"]);
    expect(q(`[data-metric="${MEMORY_KEY}"]`)!.getAttribute("aria-pressed")).toBe("true");
    q<HTMLButtonElement>(`[data-metric="${MEMORY_KEY}"]`)!.click();
    expect(focused()).toEqual([CPU_KEY, "tick"]);
    m.ui.toggle("a");
    m.ui.toggle("b");
    expect(m.ui.picked()).toEqual(["tick", "a", "b"]);
  });

  it("切时间窗口", () => {
    const m = mount();
    m.feed(() => undefined);
    q<HTMLButtonElement>('[data-window="5m"]')!.click();
    expect(m.ui.win()).toBe("5m");
    expect(q('[data-window="5m"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(q(".session-stats__axis")!.textContent).toContain("−5 分");
  });

  it("不在屏幕上时不随新数据重算", () => {
    const m = mount();
    m.feed((at) => m.store.record(CPU_KEY, 1, at));
    m.setShown(false);
    m.feed((at) => m.store.record(CPU_KEY, 9, at));
    expect(rowValue(CPU_KEY)).toBe("1.0ms");
    m.setShown(true);
    expect(rowValue(CPU_KEY)).toBe("9.0ms");
  });
});
