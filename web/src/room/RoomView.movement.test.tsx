/**
 * #57：Room View 的移动补间接线（画法见 movement-tween.test.ts）：
 * - 点选按 creep 的逻辑格子（新格），不随补间中的位置变化
 * - creep 朝向的记忆沿 Tick 传下去（身体从上一个朝向转过去）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility } from "../power/visibility.ts";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import type { ConnectionState, RoomTick, Source } from "../source/source.ts";
import { RoomView } from "./RoomView.tsx";

const creep = { _id: "c1", type: "creep", x: 13, y: 14, user: "u2", body: [{ type: "move", hits: 100 }] };

let push: ((tick: RoomTick) => void) | undefined;
const source = {
  server: SERVER_PRESETS.season,
  onConnection(listener: (state: ConnectionState) => void) {
    listener("authenticated");
    return () => {};
  },
  subscribeRoom(_shard: string, _room: string, listener: (tick: RoomTick) => void) {
    push = listener;
    return () => (push = undefined);
  },
  getTerrain: async (shard: string, room: string) => ({ shard, room, encoded: "0".repeat(2500) }),
  getVersion: async () => ({ package: 1, protocol: 14, historyChunkSize: 1000, mapTileRoot: null }),
  close() {},
} as unknown as Source;

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];
let canvas: HTMLCanvasElement;
let viewport: Viewport;
let selected: (string | undefined)[];

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    get viewport() {
      return viewport;
    },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: (next) => {
      if (next) viewport = next;
    },
    destroy: () => {},
  };
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const field = (selector: string) => container.querySelector<HTMLElement>(selector)!;
const lastScene = () => shown.at(-1)!;
const byKey = (key: string) => lastScene().primitives.find((p) => p.key === key);
const tweenFrom = (key: string, property: string) => byKey(key)?.animation?.tweens.find((t) => t.property === property)?.from;

async function tickTo(gameTime: number, objects: RoomTick["objects"]) {
  push!({ gameTime, objects });
  await settle(() => expect(field(".room-view").dataset.tick).toBe(String(gameTime)));
}

/** 点世界坐标 (x, y) */
function tapWorld(x: number, y: number) {
  const sx = x * viewport.scale + viewport.x;
  const sy = y * viewport.scale + viewport.y;
  for (const type of ["pointerdown", "pointerup"]) {
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: sx, clientY: sy, pointerType: "mouse", button: 0, bubbles: true }));
  }
}

describe("Room View 的移动补间（#57）", () => {
  beforeEach(async () => {
    localStorage.clear();
    shown = [];
    selected = [];
    viewport = { x: 0, y: 0, scale: 10 };
    container = document.createElement("div");
    document.body.append(container);
    dispose = render(
      () => (
        <I18nProvider>
          <RoomView
            settings={createSettings(localStorage)}
            sourceFor={() => source}
            visibility={manualVisibility(true)}
            createView={fakeView}
            historyCache={async () => undefined}
            msPerTick={() => 2000}
            onSelect={(id) => void selected.push(id)}
            open={{ shard: "shardSeason", room: "W13S28" }}
          />
        </I18nProvider>
      ),
      container,
    );
    await settle(() => expect(push).toBeDefined());
    await tickTo(100, { c1: creep });
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    push = undefined;
    container.remove();
  });

  it("补间中的 creep 按逻辑格子（新格）点选；点旧格选不中", async () => {
    await tickTo(101, { c1: { x: 14 } });
    expect(tweenFrom("c1/base", "offsetX")).toBe(-1);

    tapWorld(13.5, 14.5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(selected.filter(Boolean)).toEqual([]);

    tapWorld(14.5, 14.5);
    await settle(() => expect(selected.at(-1)).toBe("c1"));
    // 选中框也带同样的位移
    await settle(() => expect(tweenFrom("c1/selected", "offsetX")).toBe(-1));
  });

  it("朝向沿 Tick 记住：向右走后再向下走，身体从朝右转到朝下", async () => {
    await tickTo(101, { c1: { x: 14 } });
    expect(tweenFrom("c1/base", "turn")).toBeCloseTo(-Math.PI / 2);
    await tickTo(102, { c1: { y: 15 } });
    expect(tweenFrom("c1/base", "turn")).toBeCloseTo(-Math.PI / 2);
    expect(tweenFrom("c1/base", "offsetY")).toBe(-1);
    // 停下：保持朝下，不再转、不再移动
    await tickTo(103, { c1: { ticksToLive: 5 } });
    expect(byKey("c1/base")?.animation).toBeUndefined();
    const ring = byKey("c1/ring-move-r");
    // move 部件画在背面（朝向的反方向）：朝下时在中心正上方
    expect(ring?.kind === "polygon" && ring.points[1]).toBeLessThan(15.5);
  });
});
