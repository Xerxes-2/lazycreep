import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import { RawReadings } from "./RawReadings.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let sources: Source[];

function mount() {
  dispose = render(
    () => (
      <I18nProvider>
        <RawReadings
          settings={createSettings(localStorage)}
          sourceFor={() => {
            const source = new FixtureSource(bundle, { speed: Infinity });
            sources.push(source);
            return source;
          }}
        />
      </I18nProvider>
    ),
    container,
  );
}

function field<T extends HTMLElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  return el;
}

function watch(shard: string, room: string) {
  const shardInput = field<HTMLInputElement>("input[name=readings-shard]");
  shardInput.value = shard;
  shardInput.dispatchEvent(new Event("input", { bubbles: true }));
  const roomInput = field<HTMLInputElement>("input[name=readings-room]");
  roomInput.value = room;
  roomInput.dispatchEvent(new Event("input", { bubbles: true }));
  field<HTMLFormElement>("form[data-testid=readings-form]").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

const reading = (name: string) => field(`[data-testid=readings-${name}]`).textContent;
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 2000, interval: 5 });

describe("原始读数页", () => {
  beforeEach(() => {
    localStorage.clear();
    sources = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("选定房间前显示连接状态，没有读数", () => {
    mount();
    expect(reading("state")).toBe("已认证");
    expect(reading("frames")).toBe("0");
    expect(reading("game-time")).toBe("—");
  });

  it("选定房间后显示最新 gameTime 与本次会话收到的帧数", async () => {
    mount();
    watch("shardSeason", "w13s28");
    await settle(() => {
      expect(reading("frames")).toBe("51");
      expect(reading("game-time")).toBe("1025238");
    });
    expect(reading("room")).toBe("shardSeason/W13S28");
  });

  it("换房间时帧数从零重新计", async () => {
    mount();
    watch("shardSeason", "W13S28");
    await settle(() => expect(reading("frames")).toBe("51"));
    watch("shardSeason", "E13N21");
    await settle(() => expect(reading("room")).toBe("shardSeason/E13N21"));
    await settle(() => expect(reading("frames")).toBe("51"));
  });

  it("关闭页面时关闭 Source，状态随之断开", async () => {
    mount();
    dispose?.();
    dispose = undefined;
    const states: string[] = [];
    sources[0]?.onConnection((s) => states.push(s));
    expect(states).toEqual(["disconnected"]);
  });

  it("界面文案随语言切换", () => {
    localStorage.setItem("msc.locale", "en");
    mount();
    expect(container.querySelector("h2")?.textContent).toBe("Raw readings");
    expect(reading("state")).toBe("Authenticated");
  });
});
