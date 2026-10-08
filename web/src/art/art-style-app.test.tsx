/**
 * #42：Art Style 接到整页——Menu“外观”里切换，Room View 的 Scene 随之换画法；刷新后保持；随设置导出导入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { exportSettings, importSettings } from "../customize/settings-transfer.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { OFFICIAL_ART_DIR } from "./official-art.ts";

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
const officialImages = () =>
  (roomScene()?.primitives ?? []).filter((p) => p.kind === "image" && p.url.includes(`/${OFFICIAL_ART_DIR}/`)).length;
function openAppearance() {
  container.querySelector<HTMLButtonElement>("[data-action=open-menu]")!.click();
  container.querySelector<HTMLButtonElement>(`[data-menu-item="appearance"]`)!.click();
}
const styleRadio = (style: string) => container.querySelector<HTMLInputElement>(`input[name=art-style][value=${style}]`)!;

describe("Art Style 接到整页（#42）", () => {
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

  it("默认官方画风；在外观里切到几何后 Room View 换画法，刷新后保持", async () => {
    mount();
    await settle(() => expect(officialImages()).toBeGreaterThan(0));

    openAppearance();
    expect(styleRadio("official").checked).toBe(true);
    styleRadio("geometric").click();
    await settle(() => {
      expect(roomScene()?.primitives.length).toBeGreaterThan(0);
      expect(officialImages()).toBe(0);
    });

    mount();
    await settle(() => expect(roomScene()?.primitives.length).toBeGreaterThan(0));
    expect(officialImages()).toBe(0);
    openAppearance();
    expect(styleRadio("geometric").checked).toBe(true);
    styleRadio("official").click();
    await settle(() => expect(officialImages()).toBeGreaterThan(0));
  });

  it("导出包含 Art Style，导入后按文件里的 Art Style 画", async () => {
    mount();
    openAppearance();
    styleRadio("geometric").click();
    const file = exportSettings(localStorage);
    expect(file.settings["msc.artStyle"]).toBe("geometric");

    localStorage.clear();
    mount();
    await settle(() => expect(officialImages()).toBeGreaterThan(0));
    importSettings(localStorage, file);
    mount();
    await settle(() => expect(roomScene()?.primitives.length).toBeGreaterThan(0));
    expect(officialImages()).toBe(0);
  });
});
