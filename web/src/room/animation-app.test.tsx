/**
 * #55：显示选项里的“动画”开关接到整页——默认开；系统要求减少动态效果时默认关；手动设置优先、刷新后保持、随设置导出导入。
 * 动画开关对 Scene 的作用见 RoomView.animation.test.tsx。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { exportSettings, importSettings } from "../customize/settings-transfer.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Map<HTMLCanvasElement, Scene[]>;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  shown.set(canvas, []);
  let viewport = { x: 0, y: 0, scale: 1 };
  return {
    canvas,
    get viewport() {
      return viewport;
    },
    show: (scene) => void shown.get(canvas)!.push(scene),
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: (next) => {
      if (next) viewport = next;
    },
    destroy: () => {},
  };
}

function mount() {
  dispose?.();
  container.innerHTML = "";
  shown = new Map();
  dispose = render(
    () => <App sourceFor={() => new FixtureSource(bundle, { speed: Infinity })} narrow={() => false} createView={fakeView} />,
    container,
  );
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const roomScene = () => {
  const canvas = container.querySelector<HTMLCanvasElement>(".room-view canvas");
  return canvas ? shown.get(canvas)?.at(-1) : undefined;
};
const objectCount = () => (roomScene()?.primitives ?? []).filter((p) => p.objectId !== undefined).length;
const animationBox = () => container.querySelector<HTMLInputElement>(`[data-section="room.display"] input[name="display-animation"]`)!;

/** 让 matchMedia 报告“减少动态效果” */
function preferReducedMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("显示选项的动画开关接到整页（#55）", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/#!/season/room/shardSeason/W13S28");
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  it("默认开，文案为“动画”", async () => {
    mount();
    await settle(() => expect(objectCount()).toBeGreaterThan(0));
    expect(animationBox().checked).toBe(true);
    expect(animationBox().parentElement?.textContent).toBe("动画");
  });

  it("系统要求减少动态效果时默认关；手动打开后优先，刷新后保持", async () => {
    preferReducedMotion();
    mount();
    await settle(() => expect(objectCount()).toBeGreaterThan(0));
    expect(animationBox().checked).toBe(false);

    animationBox().click();
    mount();
    await settle(() => expect(objectCount()).toBeGreaterThan(0));
    expect(animationBox().checked).toBe(true);
  });

  it("手动设置随设置导出导入；没设置过时导出里没有它（导入后仍随系统偏好）", async () => {
    mount();
    await settle(() => expect(animationBox()).not.toBeNull());
    expect(exportSettings(localStorage).settings["msc.roomDisplay"]).toBeUndefined();
    animationBox().click();
    const file = exportSettings(localStorage);
    expect(file.settings["msc.roomDisplay"]).toEqual({ animation: false });

    localStorage.clear();
    importSettings(localStorage, file);
    mount();
    await settle(() => expect(objectCount()).toBeGreaterThan(0));
    expect(animationBox().checked).toBe(false);
  });
});
