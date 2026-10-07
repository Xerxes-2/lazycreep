import { IDBFactory } from "fake-indexeddb";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { openHistoryCache, type HistoryCache } from "./history-cache.ts";
import { HistoryCacheSettings } from "./HistoryCacheSettings.tsx";
import { createReplaySettings } from "./replay-settings.ts";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let cache: HistoryCache | undefined;

function mount(open: () => Promise<HistoryCache | undefined>) {
  dispose = render(
    () => (
      <I18nProvider>
        <HistoryCacheSettings settings={createReplaySettings(localStorage)} cache={open} />
      </I18nProvider>
    ),
    container,
  );
}

const usageText = () => container.querySelector("[data-testid=history-cache-usage]")?.textContent;
const limitInput = () => container.querySelector<HTMLInputElement>("[name=history-cache-limit]")!;

function chunk(room: string) {
  return {
    shard: "s",
    room,
    base: 0,
    ticks: [{ gameTime: 0, objects: { a: { type: "x", x: 0, y: 0, pad: "x".repeat(600_000) } } }],
  };
}

describe("历史缓存设置", () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    container.remove();
    cache?.close();
    cache = undefined;
  });

  it("默认上限 200 MB；调整后存到本地并立即按新上限淘汰", async () => {
    let clock = 0;
    const opened = await openHistoryCache({
      indexedDB: new IDBFactory(),
      limitBytes: 200 * 1024 * 1024,
      now: () => ++clock,
    });
    if (!opened) throw new Error("缓存没打开");
    cache = opened;
    await opened.put("s/A/0", chunk("A"));
    await opened.put("s/B/0", chunk("B"));
    mount(async () => opened);
    expect(limitInput().value).toBe("200");
    await vi.waitFor(() => expect(usageText()).toContain("1.1"));

    limitInput().value = "1";
    limitInput().dispatchEvent(new Event("change", { bubbles: true }));

    // 只看占用，不 get（get 会刷新访问时间）
    await vi.waitFor(async () => expect(await opened.usage()).toBeLessThan(1024 * 1024));
    expect(await opened.get("s/A/0")).toBeUndefined();
    expect(await opened.get("s/B/0")).toBeDefined();
    expect(createReplaySettings(localStorage).cacheLimitMb()).toBe(1);
    await vi.waitFor(() => expect(usageText()).toContain("0.6"));
  });

  it("IndexedDB 不可用时说明历史不缓存", async () => {
    mount(async () => undefined);
    await vi.waitFor(() => expect(container.textContent).toContain("无法使用本地缓存"));
  });
});
