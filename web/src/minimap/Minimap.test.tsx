/**
 * Minimap 区块（#27）的外部行为：整个 Main View + Sidebar 由录制数据驱动，画布换成记录视口的假实现。
 * 只经 DOM、外壳位置（shell.location）与 Source 上的 roomMap2 订阅集合观察。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { createShellState, type ShellState } from "../shell/shell-state.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);
const SHARD = "shardSeason";
/** 假画布：每个房间格 60 CSS 像素 */
const CELL = 60;

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shell: ShellState;
/** 此刻在 Source 上订阅着的 roomMap2（`shard/room`，同一房间可多次） */
let roomMaps: string[];
/** 每个画布最近一次显示的 Scene */
let scenes: Map<HTMLCanvasElement, Scene>;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: CELL },
    show: (scene) => void scenes.set(canvas, scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

function recordedSource(): Source {
  const source = new FixtureSource(bundle, { speed: Infinity });
  const subscribe = source.subscribeRoomMap.bind(source);
  source.subscribeRoomMap = (shard, room, ...rest) => {
    const key = `${shard}/${room}`;
    roomMaps.push(key);
    const off = subscribe(shard, room, ...rest);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      roomMaps.splice(roomMaps.indexOf(key), 1);
      off();
    };
  };
  return source;
}

function mount() {
  const settings = createSettings(localStorage);
  settings.setToken("token");
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom artStyle="geometric"
          settings={settings}
          shell={(shell = createShellState(localStorage, settings))}
          sourceFor={recordedSource}
          createView={fakeView}
          roomView={{ historyCache: async () => undefined }}
          narrow={() => false}
        />
      </I18nProvider>
    ),
    container,
  );
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const minimapCanvas = () => container.querySelector<HTMLCanvasElement>("[data-section='room.minimap'] canvas");
const roomInput = () => container.querySelector<HTMLInputElement>("[name=room-view-room]")!;

/** 点 Minimap 的格子（col、row 为 0–2） */
function tapCell(col: number, row: number) {
  const point = { clientX: (col + 0.5) * CELL, clientY: (row + 0.5) * CELL };
  for (const type of ["pointerdown", "pointerup"]) {
    minimapCanvas()!.dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, bubbles: true, button: 0 }));
  }
}

const around = (rooms: string[]) => rooms.map((room) => `${SHARD}/${room}`).sort();
const NEAR_W13S28 = around(["W14S27", "W13S27", "W12S27", "W14S28", "W13S28", "W12S28", "W14S29", "W13S29", "W12S29"]);
const NEAR_W12S28 = around(["W13S27", "W12S27", "W11S27", "W13S28", "W12S28", "W11S28", "W13S29", "W12S29", "W11S29"]);
/** Minimap 自己的订阅：除去 World Map 等别处的 */
const minimapSubscriptions = (expected: string[]) => [...new Set(roomMaps)].filter((k) => expected.includes(k)).sort();

describe("Minimap（#27）", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", location.pathname);
    roomMaps = [];
    scenes = new Map();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", location.pathname);
  });

  it("Room View 的 Sidebar 里，排在选中对象之前；画出以当前房间为中心的 3×3 格", async () => {
    mount();
    shell.navigate({ shard: SHARD, room: "W13S28" });
    const sections = [...container.querySelectorAll<HTMLElement>("[data-section]")].filter((el) => !el.hidden);
    expect(sections.map((el) => el.dataset["section"])).toEqual(["room.info", "room.minimap", "room.selected", "room.display"]);
    await settle(() => expect(scenes.get(minimapCanvas()!)).toBeDefined());
    const tiles = scenes
      .get(minimapCanvas()!)!
      .primitives.flatMap((p) => (p.kind === "image" ? [`${p.x},${p.y}:${p.url.split("/").at(-1)}`] : []));
    expect(tiles).toContain("1,1:W13S28.png");
    expect(tiles).toContain("2,1:W12S28.png");
    expect(tiles).toHaveLength(9);
  });

  it("点相邻格切换到该房间；roomMap2 订阅随之增删，不残留旧房间", async () => {
    mount();
    shell.navigate({ shard: SHARD, room: "W13S28" });
    await settle(() => expect(minimapSubscriptions(NEAR_W13S28)).toEqual(NEAR_W13S28));

    tapCell(2, 1);
    expect(shell.location()).toMatchObject({ view: "room", shard: SHARD, room: "W12S28", replay: undefined });
    await settle(() => expect(roomInput().value).toBe("W12S28"));
    await settle(() => expect(minimapSubscriptions(NEAR_W12S28)).toEqual(NEAR_W12S28));
    // 只在旧 3×3 里的房间已退订，每个房间只有一条
    for (const gone of around(["W14S27", "W14S28", "W14S29"])) expect(roomMaps).not.toContain(gone);
    expect(roomMaps.filter((k) => NEAR_W12S28.includes(k))).toHaveLength(9);

    // 点中心格不动
    tapCell(1, 1);
    expect(shell.location().room).toBe("W12S28");
  });

  it("区块折叠或回到 World Map 时退掉自己的 roomMap2 订阅", async () => {
    mount();
    shell.navigate({ shard: SHARD, room: "W13S28" });
    await settle(() => expect(minimapSubscriptions(NEAR_W13S28)).toEqual(NEAR_W13S28));
    container.querySelector<HTMLButtonElement>("[data-section='room.minimap'] [data-action=toggle-section]")!.click();
    expect(minimapSubscriptions(NEAR_W13S28)).toEqual([]);
    shell.toggleSection("room.minimap");
    await settle(() => expect(minimapSubscriptions(NEAR_W13S28)).toEqual(NEAR_W13S28));
    shell.navigate({ view: "map" });
    expect(roomMaps.filter((k) => NEAR_W13S28.includes(k) && k !== `${SHARD}/W13S28`)).toEqual([]);
  });

  it("Replay 中只画地形与所有权：不订阅 roomMap2、没有位置点，区块上标注；回到 Live 恢复", async () => {
    mount();
    shell.navigate({ shard: SHARD, room: "W13S28" });
    await settle(() => expect(minimapSubscriptions(NEAR_W13S28)).toEqual(NEAR_W13S28));
    expect(container.querySelector("[data-testid=minimap-replay-note]")).toBeNull();

    shell.navigate({ shard: SHARD, room: "W13S28", replay: { tick: 1024950 } });
    expect(minimapSubscriptions(NEAR_W13S28)).toEqual([]);
    expect(container.querySelector("[data-testid=minimap-replay-note]")).not.toBeNull();
    await settle(() => {
      const scene = scenes.get(minimapCanvas()!)!;
      expect(scene.primitives.filter((p) => p.kind === "image")).toHaveLength(9);
      expect(scene.primitives.filter((p) => p.kind === "circle")).toEqual([]);
    });

    shell.navigate({ shard: SHARD, room: "W13S28" });
    await settle(() => expect(minimapSubscriptions(NEAR_W13S28)).toEqual(NEAR_W13S28));
    expect(container.querySelector("[data-testid=minimap-replay-note]")).toBeNull();
  });

  it("Replay 中点相邻格：以同一 Tick 打开该房间的 Replay", async () => {
    mount();
    shell.navigate({ shard: SHARD, room: "W13S28", replay: { tick: 1024950 } });
    await settle(() => expect(shell.location()).toMatchObject({ room: "W13S28", replay: { tick: 1024950 } }));
    await settle(() => expect(minimapCanvas()).not.toBeNull());

    tapCell(1, 0);
    await settle(() => expect(shell.location()).toMatchObject({ view: "room", room: "W13S27", replay: { tick: 1024950 } }));
    // Room View 跟着进入该房间的 Replay（地址由 URL 路由写回，#32，见 shell/url-routing.test.tsx）
    await settle(() => expect(document.querySelector<HTMLInputElement>("[name=room-view-room]")?.value).toBe("W13S27"));
    await settle(() => expect(document.querySelector(".room-view [data-testid=replay-controls]")).not.toBeNull());
  });
});
