import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import { RoomView } from "./RoomView.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];
let liveSources: Source[];
let fixtureSources: Source[];

/** 记录收到的 Scene，不真的画。 */
async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

function mount() {
  dispose = render(
    () => (
      <I18nProvider>
        <RoomView artStyle="geometric"
          settings={createSettings(localStorage)}
          sourceFor={() => {
            const source = new FixtureSource(bundle, { speed: Infinity });
            liveSources.push(source);
            return source;
          }}
          fixtureSource={async () => {
            const source = new FixtureSource(bundle, { speed: Infinity });
            fixtureSources.push(source);
            return source;
          }}
          createView={fakeView}
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

function input(name: string, value: string) {
  const el = field<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`);
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function watch(shard: string, room: string) {
  input("room-view-shard", shard);
  input("room-view-room", room);
  field<HTMLFormElement>("form[data-testid=room-view-form]").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

const tick = () => field("[data-testid=room-view-tick]").textContent;
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

describe("Room View 页面", () => {
  beforeEach(() => {
    localStorage.clear();
    shown = [];
    liveSources = [];
    fixtureSources = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("选房间前不显示 Tick，画布已就位", async () => {
    mount();
    expect(tick()).toBe("—");
    expect(field("[data-testid=room-view-state]").textContent).toBe("已认证");
    await settle(() => expect(container.querySelector("canvas")).not.toBeNull());
    expect(shown).toHaveLength(0);
  });

  it("选房间后画面逐 Tick 更新，界面显示当前 Tick", async () => {
    mount();
    watch("shardSeason", "w13s28");
    await settle(() => expect(tick()).toBe("1025238"));

    // 首帧没有 gameTime，之后每帧一个新 Scene
    expect(shown.length).toBeGreaterThanOrEqual(50);
    const first = shown[0]!;
    const last = shown.at(-1)!;
    expect(last).not.toEqual(first);
    // 地形到了以后画面里有地形图元
    expect(last.primitives.some((p) => p.objectId === undefined)).toBe(true);
    // 房间里的 creep 都画了
    expect(last.primitives.some((p) => p.objectId === "6ac66da2ff77778f44a644e4")).toBe(true);
    expect(liveSources).toHaveLength(1);
  });

  it("数据来源切到录制数据后由 FixtureSource 驱动", async () => {
    mount();
    input("room-view-source", "recording");
    watch("shardSeason", "E13N21");
    await settle(() => expect(tick()).not.toBe("—"));
    expect(fixtureSources.length).toBeGreaterThan(0);
    expect(shown.at(-1)!.primitives.length).toBeGreaterThan(0);
  });

  it("换房间时从头开始，不混入旧房间的对象", async () => {
    mount();
    watch("shardSeason", "W13S28");
    await settle(() => expect(tick()).toBe("1025238"));
    shown = [];
    watch("shardSeason", "E13N21");
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    expect(shown.some((s) => s.primitives.some((p) => p.objectId === "6ac66da2ff77778f44a644e4"))).toBe(false);
  });
});
