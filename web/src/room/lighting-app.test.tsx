/**
 * #49：显示选项里的“光照”开关接到整页——默认开，关掉后 Room View 的发光图元消失，刷新后保持，随设置导出导入。
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
const glowCount = () => (roomScene()?.primitives ?? []).filter((p) => p.kind === "image" && p.url.endsWith("/glow.png")).length;
const objectCount = () => (roomScene()?.primitives ?? []).filter((p) => p.objectId !== undefined).length;
const lightingBox = () => container.querySelector<HTMLInputElement>(`[data-section="room.display"] input[name="display-lighting"]`)!;

describe("显示选项的光照开关接到整页（#49）", () => {
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
  });

  it("默认开、有发光图元；关掉后消失，刷新后保持关闭", async () => {
    mount();
    await settle(() => expect(glowCount()).toBeGreaterThan(0));
    expect(lightingBox().checked).toBe(true);

    lightingBox().click();
    await settle(() => expect(glowCount()).toBe(0));
    expect(objectCount()).toBeGreaterThan(0);

    mount();
    await settle(() => expect(objectCount()).toBeGreaterThan(0));
    expect(lightingBox().checked).toBe(false);
    expect(glowCount()).toBe(0);
  });

  it("导出包含光照开关，导入后按文件里的开关画", async () => {
    mount();
    await settle(() => expect(lightingBox()).not.toBeNull());
    lightingBox().click();
    const file = exportSettings(localStorage);
    expect(file.settings["msc.roomDisplay"]).toMatchObject({ lighting: false });

    localStorage.clear();
    mount();
    await settle(() => expect(glowCount()).toBeGreaterThan(0));
    importSettings(localStorage, file);
    mount();
    await settle(() => expect(objectCount()).toBeGreaterThan(0));
    expect(glowCount()).toBe(0);
    expect(lightingBox().checked).toBe(false);
  });
});
