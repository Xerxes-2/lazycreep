/**
 * #54（ADR 0007）：Room View 只有官方画风——设置里没有画风选项；本地残留的旧画风值启动时清除；
 * 导入含画风字段的旧设置文件时静默忽略它。
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

describe("只有官方画风（#54）", () => {
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

  it("Room View 用官方贴图；外观设置里没有画风选项", async () => {
    mount();
    await settle(() => expect(officialImages()).toBeGreaterThan(0));
    openAppearance();
    expect(container.querySelector("[data-testid=appearance-settings]")).not.toBeNull();
    expect(container.querySelector("input[name=art-style]")).toBeNull();
    expect(container.querySelector("[data-testid=art-style-settings]")).toBeNull();
  });

  it("本地残留的旧画风值（几何）启动时清除，Room View 仍是官方画风，导出里没有它", async () => {
    localStorage.setItem("msc.artStyle", JSON.stringify("geometric"));
    mount();
    expect(localStorage.getItem("msc.artStyle")).toBeNull();
    await settle(() => expect(officialImages()).toBeGreaterThan(0));
    expect(Object.keys(exportSettings(localStorage).settings)).not.toContain("msc.artStyle");
  });

  it("导入含画风字段的旧设置文件：不报错、不算无法识别的项、不写入，其余设置照常导入", async () => {
    mount();
    const report = importSettings(localStorage, {
      format: "my-screeps-client/settings",
      version: 1,
      settings: { "msc.artStyle": "geometric", "msc.allies": ["Friend"] },
    });
    expect(report.ignored).toEqual([]);
    expect(report.applied).toEqual(["msc.allies"]);
    expect(localStorage.getItem("msc.artStyle")).toBeNull();
    mount();
    await settle(() => expect(officialImages()).toBeGreaterThan(0));
  });
});
