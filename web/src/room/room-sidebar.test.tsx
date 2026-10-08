/**
 * #26：Room View 下的 Sidebar 区块（房间信息、选中对象、显示选项）与 Room View 左侧按钮列。
 * 用 FixtureSource 驱动 MapAndRoom（Main View + Sidebar），断言 DOM 与交给画布的 Scene。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../App.tsx";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import type { SceneView, SceneViewOptions, Viewport } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { createShellState, type ShellState } from "../shell/shell-state.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { LAYER } from "./room-scene.ts";
import { createSignal } from "solid-js";
import { createOwnershipHub, type OwnershipHub } from "../map/ownership-hub.ts";
import type { ShellLocation } from "../shell/shell-state.ts";
import { RoomInfoSection } from "./RoomSidebarSections.tsx";

/** vitest 不处理 CSS，直接读源文件 */
const styles = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const CREEP = "6ac66da2ff77778f44a644e4";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shell: ShellState;

interface FakeCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly scenes: Scene[];
  viewport: Viewport | undefined;
}
let views: FakeCanvas[];

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const record: FakeCanvas = { canvas, scenes: [], viewport: undefined };
  views.push(record);
  return {
    canvas,
    get viewport() {
      return record.viewport ?? { x: 0, y: 0, scale: 1 };
    },
    show: (scene) => void record.scenes.push(scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: (next) => {
      if (next) record.viewport = next;
    },
    destroy: () => {},
  };
}

function mount() {
  dispose?.();
  container.innerHTML = "";
  const settings = createSettings(localStorage);
  // map-stats 需要 token（FixtureSource 不校验）
  settings.setToken("token");
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom artStyle="geometric"
          settings={settings}
          shell={(shell = createShellState(localStorage, settings))}
          sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
          createView={fakeView}
          roomView={{ historyCache: async () => undefined }}
        />
      </I18nProvider>
    ),
    container,
  );
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const roomCanvas = () => views.find((v) => q(".main-view [data-view=room]")!.contains(v.canvas))!;
const lastScene = () => roomCanvas().scenes.at(-1)!;
const shownSections = () =>
  [...container.querySelectorAll<HTMLElement>("[data-section]")].filter((el) => !el.hidden).map((el) => el.dataset["section"]);
const sectionBody = (id: string) => q(`[data-section="${id}"] .sidebar-section__body`)!;
const infoField = (key: string) => q(`[data-section="room.info"] [data-info="${key}"]`)?.textContent;
const tool = (action: string) => q<HTMLButtonElement>(`.room-view__tools [data-action="${action}"]`)!;

async function openW13S28() {
  shell.navigate({ shard: "shardSeason", room: "W13S28" });
  await settle(() => expect(q("[data-testid=room-view-tick]")!.textContent).toBe("1025238"));
}

function tapObject(id: string) {
  const body = lastScene().primitives.find((p) => p.key === `${id}/body`);
  if (!body || body.kind !== "circle") throw new Error(`找不到 ${id}`);
  const vp = roomCanvas().viewport!;
  const point = { clientX: body.x * vp.scale + vp.x, clientY: body.y * vp.scale + vp.y };
  for (const type of ["pointerdown", "pointerup"]) {
    roomCanvas().canvas.dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, button: 0, bubbles: true }));
  }
}

describe("Room View 的 Sidebar 区块与左侧按钮列（#26）", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/");
    views = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", "/");
  });

  it("区块顺序：房间信息、Minimap、选中对象、显示选项", () => {
    mount();
    shell.navigate({ view: "room" });
    expect(shownSections()).toEqual(["room.info", "room.minimap", "room.selected", "room.display"]);
  });

  it("房间信息：所有者、RCL、新手区、重生区、安全模式、控制器签名", async () => {
    mount();
    expect(infoField("room")).toBeUndefined();
    await openW13S28();
    await settle(() => expect(infoField("owner")).toBe("Xerxes_2"));
    expect(infoField("room")).toBe("W13S28");
    expect(infoField("level")).toBe("8");
    // 新手区与重生区只有 map-stats 有：等 World Map 取到所在扇区
    await settle(() => expect(infoField("novice")).toBe("否"));
    expect(infoField("respawnArea")).toBe("否");
    expect(infoField("safeMode")).toBe("否");
    expect(infoField("sign")).toContain("F# via Fable. No mutable state was harmed in the making of this room.");
    expect(infoField("sign")).toContain("Xerxes_2");
  });

  it("点选对象时选中对象区块自动展开；取消选中后显示提示", async () => {
    mount();
    await openW13S28();
    shell.setSectionCollapsed("room.selected", true);
    expect(sectionBody("room.selected").hidden).toBe(true);

    await settle(() => expect(lastScene().primitives.some((p) => p.key === `${CREEP}/body`)).toBe(true));
    tapObject(CREEP);
    await settle(() => expect(sectionBody("room.selected").hidden).toBe(false));
    expect(q("[data-section='room.selected'] [data-testid=room-details]")).not.toBeNull();
    expect(q("[data-section='room.selected'] .details-section__hint")).toBeNull();

    q<HTMLButtonElement>("[data-section='room.selected'] [data-action=close-details]")!.click();
    expect(q("[data-section='room.selected'] [data-testid=room-details]")).toBeNull();
    expect(q("[data-section='room.selected'] .details-section__hint")).not.toBeNull();
    expect(sectionBody("room.selected").hidden).toBe(false);
  });

  it("显示选项：关掉 RoomVisual 与玩家名后画布上的 Scene 随之变化，重新挂载后开关保持", async () => {
    mount();
    await openW13S28();
    const box = (name: string) => q<HTMLInputElement>(`[data-section="room.display"] input[name="display-${name}"]`)!;
    for (const name of ["say", "visual", "bars", "names"]) expect(box(name).checked).toBe(true);

    box("names").click();
    box("say").click();
    expect(box("names").checked).toBe(false);
    await settle(() => expect(lastScene().primitives.some((p) => p.key.endsWith("/owner-name"))).toBe(false));

    mount();
    await openW13S28();
    expect(box("names").checked).toBe(false);
    expect(box("say").checked).toBe(false);
    expect(box("visual").checked).toBe(true);
    expect(lastScene().primitives.some((p) => p.key.endsWith("/owner-name"))).toBe(false);
    box("visual").click();
    await settle(() => expect(lastScene().primitives.some((p) => p.layer === LAYER.visual)).toBe(false));
  });

  it("左侧按钮列：回到 World Map、进入 Replay 都走 shell.navigate；放大、缩小改变视口", async () => {
    mount();
    const navigate = vi.spyOn(shell, "navigate");
    await openW13S28();
    navigate.mockClear();
    await settle(() => expect(roomCanvas().viewport).toBeDefined());

    const before = roomCanvas().viewport!.scale;
    tool("zoom-in").click();
    const zoomedIn = roomCanvas().viewport!.scale;
    expect(zoomedIn).toBeGreaterThan(before);
    tool("zoom-out").click();
    expect(roomCanvas().viewport!.scale).toBeLessThan(zoomedIn);

    tool("replay-enter").click();
    expect(navigate).toHaveBeenCalledWith({
      shard: "shardSeason",
      room: "W13S28",
      replay: { tick: 1025238, latest: true },
    });
    await settle(() => expect(shell.location().replay).toEqual({ tick: 1025238, latest: true }));
    expect(q(".room-view__tools [data-action=replay-enter]")).toBeNull();

    tool("back-to-map").click();
    expect(navigate).toHaveBeenLastCalledWith({ view: "map" });
    expect(shell.mainView()).toBe("map");
  });

  it("整页里“进入 Replay”：地址换成 history 路由并带 latest，只多一条历史记录（#32）", async () => {
    dispose?.();
    container.innerHTML = "";
    history.replaceState(null, "", "/#!/season/room/shardSeason/W13S28");
    dispose = render(() => <App sourceFor={() => new FixtureSource(bundle, { speed: Infinity })} />, container);
    await settle(() => expect(q("[data-testid=room-view-tick]")!.textContent).toBe("1025238"));
    expect(location.hash).toBe("#!/season/room/shardSeason/W13S28");
    const entries = history.length;

    tool("replay-enter").click();
    await settle(() => expect(q(".room-view__replay .replay")).not.toBeNull());
    await Promise.resolve();
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1025238&latest=1");
    expect(history.length).toBe(entries + 1);
  });

  it("Replay 控制条浮在 Room View 底部，在 Main View 之内：Console Panel 展开时位于其上方", async () => {
    mount();
    await openW13S28();
    tool("replay-enter").click();
    await settle(() => expect(q(".room-view__replay .replay")).not.toBeNull());
    expect(q(".main-view .room-view__stage .room-view__replay")).not.toBeNull();

    const rule = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
      expect(match, selector).not.toBeNull();
      return match![1]!;
    };
    expect(rule(".room-view__replay")).toMatch(/position:\s*absolute/);
    expect(rule(".room-view__replay")).toMatch(/bottom:/);
    expect(rule(".room-view__stage")).toMatch(/position:\s*relative/);
    // Console Panel 与 Main View 在同一列里各占高度，不浮在 Main View 上
    expect(rule(".console-panel")).not.toMatch(/position:\s*(absolute|fixed)/);
  });
});

describe("房间信息区块自己补查当前房间的 map-stats（#26）", () => {
  const FUTURE = Date.UTC(2099, 0, 1);

  it("区块显示时（不靠 World Map 或 Minimap）向 OwnershipHub 认领当前房间，新手区 / 重生区照样显示；隐藏或换房间时释放", async () => {
    const fetched: string[][] = [];
    const hub = createOwnershipHub({
      fetch: async (shard, rooms) => {
        fetched.push([...rooms]);
        return {
          shard,
          gameTime: 1,
          users: {},
          rooms: Object.fromEntries(rooms.map((room) => [room, { status: "normal", novice: FUTURE, respawnArea: FUTURE }])),
        };
      },
    });
    /** 此刻有效的认领（`shard/room`） */
    const claims = new Set<string[]>();
    const ownership: OwnershipHub = {
      ...hub,
      wantRooms(rooms) {
        const claim = rooms.map((r) => `${r.shard}/${r.room}`);
        claims.add(claim);
        const off = hub.wantRooms(rooms);
        return () => {
          claims.delete(claim);
          off();
        };
      },
    };
    const [location, setLocation] = createSignal<ShellLocation>({ view: "room", shard: "shardSeason", room: "W13S28", replay: undefined });
    const [shown, setShown] = createSignal(true);
    const host = document.createElement("div");
    document.body.append(host);
    const stop = render(
      () => (
        <I18nProvider>
          <RoomInfoSection
            location={location}
            roomState={() => undefined}
            ownership={() => ownership}
            shown={shown}
            canLookup={() => true}
          />
        </I18nProvider>
      ),
      host,
    );
    const field = (key: string) => host.querySelector(`[data-info="${key}"]`)?.textContent;

    expect([...claims]).toEqual([["shardSeason/W13S28"]]);
    await settle(() => expect(field("novice")).toMatch(/^至 /));
    expect(field("respawnArea")).toMatch(/^至 /);
    expect(fetched.some((rooms) => rooms.includes("W13S28"))).toBe(true);

    setLocation({ view: "room", shard: "shardSeason", room: "W12S28", replay: undefined });
    expect([...claims]).toEqual([["shardSeason/W12S28"]]);
    setShown(false);
    expect([...claims]).toEqual([]);
    stop();
    host.remove();
    hub.dispose();
  });
});
