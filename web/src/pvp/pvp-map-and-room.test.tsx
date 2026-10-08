import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import { manualVisibility } from "../power/visibility.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
/** 地图画布最近一次显示的 Scene */
let mapScene: Scene | undefined;
let firstCanvas: HTMLCanvasElement | undefined;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  firstCanvas ??= canvas;
  const isMap = canvas === firstCanvas;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => {
      if (isMap) mapScene = scene;
    },
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

/** narrow：窄屏结构；token 为空串时不设 token */
function mount(narrow = false, token = "token") {
  const settings = createSettings(localStorage);
  if (token) settings.setToken(token);
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom
          settings={settings}
          sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
          createView={fakeView}
          roomView={{ historyCache: async () => undefined }}
          visibility={manualVisibility(true)}
          narrow={() => narrow}
        />
      </I18nProvider>
    ),
    container,
  );
  return settings;
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const hotspots = () => (mapScene?.primitives ?? []).filter((p) => p.key.startsWith("pvp:")).map((p) => p.key);
const slot = (view: string) => container.querySelector<HTMLElement>(`.main-view [data-view="${view}"]`)!;
const row = (room: string) => container.querySelector<HTMLElement>(`.pvp-overview [data-room="${room}"]`);
const combatants = (room: string) => container.querySelector<HTMLElement>(`.pvp-overview [data-combatants="${room}"]`);

describe("PvP Overview 接入 World Map 与 Room View", () => {
  beforeEach(() => {
    localStorage.clear();
    mapScene = undefined;
    firstCanvas = undefined;
    history.replaceState(null, "", location.pathname);
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", location.pathname);
  });

  it("地图上的热点随时间窗变化", async () => {
    mount();
    await settle(() => expect(hotspots()).toHaveLength(16));
    expect(hotspots()).toContain("pvp:W17N21");
    container.querySelector<HTMLButtonElement>('.pvp-overview button[data-window="20"]')!.click();
    await settle(() => expect(hotspots()).toHaveLength(6));
    expect(hotspots()).not.toContain("pvp:W17N17");
  });

  it("所有者经共享的所有权缓存补查；查不到的显示“未知”", async () => {
    mount();
    await settle(() => expect(row("W17S22")?.querySelector("[data-owner]")!.textContent).toBe("Odiodin（RCL 6）"));
    expect(row("W20S28")!.querySelector("[data-owner]")!.textContent).toBe("无主");
    expect(row("E13N21")!.querySelector("[data-owner]")!.textContent).toBe("未知");
  });

  it("PvP Overview 在 World Map 的 Sidebar 里；点列表里的房间把 Main View 切到该房间", async () => {
    mount();
    expect(container.querySelector('[data-section="map.pvp"] .pvp-overview')).not.toBeNull();
    await settle(() => expect(row("W17N21")).not.toBeNull());
    row("W17N21")!.querySelector<HTMLButtonElement>("[data-action=open-room]")!.click();
    expect(slot("map").hidden).toBe(true);
    expect(slot("room").hidden).toBe(false);
    expect(container.querySelector<HTMLElement>(".room-view")!.dataset.room).toBe("W17N21");
    expect(container.querySelector("button[data-action=back-to-map]")).not.toBeNull();
  });

  it("“回看”把 Main View 切到 Room View 并进入 Replay", async () => {
    mount();
    await settle(() => expect(row("W17N21")).not.toBeNull());
    row("W17N21")!.querySelector<HTMLButtonElement>("[data-action=replay-battle]")!.click();
    expect(slot("room").hidden).toBe(false);
    await settle(() => expect(container.querySelector<HTMLElement>(".room-view")?.dataset.room).toBe("W17N21"));
    await settle(() => expect(container.querySelector(".room-view .replay")).not.toBeNull());
  });

  it("“回看这场战斗”打开该房间的 Replay，定位到最后战斗前 50 Tick；chunk 未生成时可退到已有历史", async () => {
    mount(true);
    await settle(() => expect(row("W17N21")).not.toBeNull());
    row("W17N21")!.querySelector<HTMLButtonElement>("[data-action=replay-battle]")!.click();
    await settle(() => expect(container.querySelector(".room-view .replay")).not.toBeNull());
    await settle(() => expect(container.querySelector<HTMLElement>(".room-view")!.dataset.room).toBe("W17N21"));
    expect(slot("map").hidden).toBe(true);
  });

  describe("参战者（#34）", () => {
    /** 当前订阅着的 roomMap2 房间（所有 FixtureSource 实例合计） */
    let open: Map<string, number>;
    beforeEach(() => {
      open = new Map();
      const inner = FixtureSource.prototype.subscribeRoomMap;
      vi.spyOn(FixtureSource.prototype, "subscribeRoomMap").mockImplementation(function (this: FixtureSource, ...args) {
        const room = args[1];
        open.set(room, (open.get(room) ?? 0) + 1);
        const off = inner.apply(this, args);
        let done = false;
        return () => {
          if (done) return;
          done = true;
          off();
          const left = open.get(room)! - 1;
          if (left === 0) open.delete(room);
          else open.set(room, left);
        };
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("每个 PvP 房间列出参战玩家：名字、GCL 与物体数（roomMap2 位置点，含建筑）", async () => {
      mount();
      await settle(() => {
        const text = combatants("E13N21")?.textContent ?? "";
        expect(text).toContain("volotsyouga");
        expect(text).toContain("GCL 8");
        expect(text).toContain("dump_table");
        expect(text).toContain("GCL 6");
      });
      const player = combatants("E13N21")!.querySelector<HTMLElement>('[data-player="685da7c42df7a30011653e6a"]')!;
      expect(player.dataset["objects"]).toBe("1");
      expect(player.textContent).toMatch(/1 (objects|个物体)/);
    });

    it("参战者订阅跟着 World Map：折叠 PvP 区块仍保留（地图图例要分类），进 Room View 时退订，回地图重新订阅", async () => {
      mount();
      await settle(() => expect(open.has("E13N21")).toBe(true));
      container.querySelector<HTMLButtonElement>('[data-section="map.pvp"] [data-action=toggle-section]')!.click();
      expect(open.has("E13N21")).toBe(true);
      container.querySelector<HTMLButtonElement>(".pvp-overview [data-room] [data-action=open-room]")!.click();
      await settle(() => expect(slot("room").hidden).toBe(false));
      expect(open.has("E13N21")).toBe(false);
      container.querySelector<HTMLButtonElement>("button[data-action=back-to-map]")!.click();
      await settle(() => expect(open.has("E13N21")).toBe(true));
    });

    it("无 token 时参战者显示“需要 token”，不订阅 roomMap2，其余信息照常", async () => {
      mount(false, "");
      await settle(() => expect(row("W17N21")).not.toBeNull());
      expect(combatants("E13N21")!.textContent).toContain("需要 token");
      expect(open.size).toBe(0);
    });
  });
});
