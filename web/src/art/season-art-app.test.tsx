/**
 * #47 接线：官方画风下，Room View 经 Source 的版本信息取赛季贴图、预检通过后用它画钍矿；
 * 预检失败时钍矿保持几何画法。用录制数据（E13N21 有钍矿）与假的 fetch / 解码。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const T_URL = "/season-static/season11/renderer/T.png";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Map<HTMLCanvasElement, Scene[]>;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  shown.set(canvas, []);
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => void shown.get(canvas)!.push(scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

const roomScene = () => {
  const canvas = container.querySelector<HTMLCanvasElement>(".room-view canvas");
  return canvas ? shown.get(canvas)?.at(-1) : undefined;
};
const thoriumImages = () => (roomScene()?.primitives ?? []).filter((p) => p.kind === "image" && p.url === T_URL);
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });

/** 赛季贴图请求的应答：ok 时给一个能“解码”的应答 */
function stubNetwork(ok: boolean) {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return new Response(ok ? "png" : null, { status: ok ? 200 : 404 });
    }),
  );
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: () => {} })));
  return requested;
}

function mount() {
  shown = new Map();
  dispose = render(
    () => <App sourceFor={() => new FixtureSource(bundle, { speed: Infinity })} narrow={() => false} createView={fakeView} />,
    container,
  );
}

describe("赛季贴图接到 Room View（#47）", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/#!/season/room/shardSeason/E13N21");
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  it("预检通过后钍矿换成下发的贴图", async () => {
    const requested = stubNetwork(true);
    mount();
    await settle(() => expect(thoriumImages()).toHaveLength(1));
    expect(requested).toContain(T_URL);
  });

  it("预检失败时钍矿保持几何画法", async () => {
    const requested = stubNetwork(false);
    mount();
    await settle(() => expect(requested).toContain(T_URL));
    await settle(() => expect(roomScene()?.primitives.length ?? 0).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(thoriumImages()).toHaveLength(0);
  });
});
