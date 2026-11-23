/**
 * 房间流快于屏幕帧（私服几毫秒一个 Tick）：每个动画帧至多提交一次房间状态，Scene 不为画不出来的 Tick 重建。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { RoomTick } from "../source/source.ts";
import { RoomView, type RoomViewProps } from "./RoomView.tsx";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

describe("Room View：房间流快于屏幕帧", () => {
  beforeEach(() => {
    localStorage.clear();
    shown = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("同一帧里到的多个 Tick 只提交最新的；增量照样逐个合并", async () => {
    let emit: ((tick: RoomTick) => void) | undefined;
    let queued: (() => void) | undefined;
    const liveTicks: number[] = [];
    dispose = render(() => {
      const [open] = createSignal<RoomViewProps["open"]>({ shard: "shardSeason", room: "W13S28" });
      return (
        <I18nProvider>
          <RoomView
            settings={createSettings(localStorage)}
            sourceFor={() => {
              const source = new FixtureSource(bundle, { speed: Infinity });
              source.subscribeRoom = (_shard, _room, listener) => {
                emit = listener;
                return () => (emit = undefined);
              };
              return source;
            }}
            createView={fakeView}
            open={open()}
            onLiveTick={(_shard, gameTime) => liveTicks.push(gameTime)}
            frameSchedule={(run) => {
              queued = run;
              return () => (queued = undefined);
            }}
          />
        </I18nProvider>
      );
    }, container);
    await settle(() => expect(emit).toBeDefined());
    const tickOf = () => container.querySelector<HTMLElement>(".room-view")!.dataset.tick;

    // 首帧（全量）立即提交
    emit!({ gameTime: 100, objects: { a: { type: "source", x: 1, y: 1 }, b: { type: "source", x: 2, y: 2 } } });
    expect(tickOf()).toBe("100");
    // 同一帧里又来三个：先不提交
    emit!({ gameTime: 101, objects: { a: { x: 3 } } });
    emit!({ gameTime: 102, objects: { b: null } });
    emit!({ gameTime: 103, objects: { a: { y: 4 } } });
    expect(tickOf()).toBe("100");
    expect(liveTicks).toEqual([100]);

    queued!();
    expect(tickOf()).toBe("103");
    expect(liveTicks).toEqual([100, 103]);
    // 三个增量都合并进去了：a 移到 (3, 4)，b 没了；中间的 Tick 没有单独构建 Scene
    const ids = (scene: Scene) => new Set(scene.primitives.map((p) => p.key.split("/")[0]));
    await settle(() => expect(ids(shown.at(-1)!).has("b")).toBe(false));
    expect(ids(shown.at(-1)!).has("a")).toBe(true);
    const a = shown.at(-1)!.primitives.find((p) => p.key.split("/")[0] === "a" && "x" in p && "y" in p) as { x: number; y: number };
    expect([Math.round(a.x), Math.round(a.y)]).toEqual([3, 4]);
  });
});
