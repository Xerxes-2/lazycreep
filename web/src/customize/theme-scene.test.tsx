import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { createColorScheme } from "./color-scheme.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
/** 画布 → 收到过的 Scene */
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

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const lastScene = (selector: string) => {
  const canvas = container.querySelector<HTMLCanvasElement>(`${selector} canvas`);
  return canvas ? shown.get(canvas)?.at(-1) : undefined;
};
const fills = (scene: Scene | undefined) =>
  new Set((scene?.primitives ?? []).map((p: Primitive) => ("fill" in p ? p.fill : undefined)));

describe("配色改动后 Room View 与 World Map 用新 Theme 重建 Scene（#5）", () => {
  beforeEach(() => {
    localStorage.clear();
    shown = new Map();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("改背景与地形颜色", async () => {
    const settings = createSettings(localStorage);
    settings.setToken("token");
    let colors!: ReturnType<typeof createColorScheme>;
    dispose = render(() => {
      colors = createColorScheme(localStorage);
      return (
        <I18nProvider>
          <MapAndRoom
            settings={settings}
            sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
            createView={fakeView}
            roomView={{ historyCache: async () => undefined }}
            theme={colors.theme()}
            narrow={() => false}
          />
        </I18nProvider>
      );
    }, container);

    const room = container.querySelector<HTMLInputElement>("[name=room-view-room]")!;
    room.value = "W13S28";
    room.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLFormElement>("[data-testid=room-view-form]")!.requestSubmit();

    await settle(() => {
      expect(lastScene(".world-map")?.background).toBe(DEFAULT_THEME.background);
      expect(fills(lastScene(".room-view")).has(DEFAULT_THEME.terrainWall)).toBe(true);
    });

    colors.setColor("background", 0x123456);
    colors.setColor("terrainWall", 0x654321);

    await settle(() => {
      expect(lastScene(".world-map")?.background).toBe(0x123456);
      expect(lastScene(".room-view")?.background).toBe(0x123456);
      const roomFills = fills(lastScene(".room-view"));
      expect(roomFills.has(0x654321)).toBe(true);
      expect(roomFills.has(DEFAULT_THEME.terrainWall)).toBe(false);
    });
  });
});
