import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import type { DataSource } from "./data-source.ts";
import { RoomView, type RoomViewProps } from "./RoomView.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];
let liveSources: Source[];
let fixtureSources: Source[];
let setOpen: (request: RoomViewProps["open"]) => void;
let setDataSource: (source: DataSource) => void;

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
  dispose = render(() => {
    const [open, set] = createSignal<RoomViewProps["open"]>();
    const [dataSource, setSource] = createSignal<DataSource>("server");
    setOpen = set;
    setDataSource = setSource;
    return (
      <I18nProvider>
        <RoomView
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
          open={open()}
          dataSource={dataSource}
        />
      </I18nProvider>
    );
  }, container);
}

function field<T extends HTMLElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  return el;
}

/** 从外部打开房间（外壳里由 World Map、Minimap、PvP 卡片与 URL 经 shell.navigate 交给 Room View） */
function watch(shard: string, room: string) {
  setOpen({ shard, room });
}

/** 画面上的 Tick（Room View 根元素的 data-tick；没有时为 undefined） */
const tick = () => field(".room-view").dataset.tick;
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

  it("选房间前没有 Tick，画布已就位", async () => {
    mount();
    expect(tick()).toBeUndefined();
    await settle(() => expect(container.querySelector("canvas")).not.toBeNull());
    expect(shown).toHaveLength(0);
  });

  it("画布上方没有房间表单与重复的状态文字，画布容器占满 Room View（#51）", async () => {
    mount();
    watch("shardSeason", "W13S28");
    await settle(() => expect(tick()).toBe("1025238"));
    const view = field(".room-view");
    // 房间与 Shard 输入框、“打开”按钮、数据来源开关都不在 Room View 里
    expect(view.querySelector("form, input, select")).toBeNull();
    expect([...view.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("打开");
    // 连接状态与 Tick 速度只在 Top Bar
    expect(view.querySelector(".room-view__status")).toBeNull();
    expect(view.textContent).not.toMatch(/已认证|Tick 速度/);
    // 根元素下只有读屏标题与画布舞台（无错误时）
    expect([...view.children].map((el) => el.tagName === "H2" ? "h2" : el.className)).toEqual(["h2", "room-view__stage"]);
    expect(view.querySelector(".room-view__stage > .room-view__frame > .room-view__canvas canvas")).not.toBeNull();
    // 左侧按钮列（#26）仍浮在画布框里；Replay 控制条（#15 #26）仍在舞台里、画布框之后
    expect(view.querySelector(".room-view__stage > .room-view__frame > .room-view__tools")).not.toBeNull();
    setOpen({ shard: "shardSeason", room: "W13S28", replay: { tick: 1024937 } });
    await settle(() => expect(view.querySelector(".room-view__stage > .room-view__frame + .room-view__replay")).not.toBeNull());
    expect(view.dataset.mode).toBe("replay");
  });

  it("选房间后画面逐 Tick 更新，界面显示当前 Tick", async () => {
    mount();
    watch("shardSeason", "W13S28");
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
    setDataSource("recording");
    watch("shardSeason", "E13N21");
    await settle(() => expect(tick()).toBeDefined());
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
