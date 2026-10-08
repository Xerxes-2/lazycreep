/**
 * #55：Room View 的动画接线（只测接线，画法见 action-animation.test.ts，逐帧驱动见 pixi-scene-view.test.ts）：
 * - Tick 间隔：Live 读外壳共享的实测 Tick 速度（测出前 1000 ms），Replay 按回放速度，下限 100 ms
 * - 动画开关关闭时 Scene 没有动画
 * - 页面隐藏时不构建 Scene、不请求帧；回来时不补播错过的动画
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility, type ManualVisibility } from "../power/visibility.ts";
import { animationDuration } from "../scene/animation.ts";
import { createSceneView, type SceneRenderer, type SceneView, type SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import type { ConnectionState, HistoryChunk, RoomTick, Source } from "../source/source.ts";
import { DEFAULT_ROOM_DISPLAY, type RoomDisplay } from "./display-options.ts";
import { RoomView } from "./RoomView.tsx";

const tower = { _id: "t1", type: "tower", x: 10, y: 10, user: "u1", store: { energy: 500 }, storeCapacityResource: { energy: 1000 } };
const creep = { _id: "c1", type: "creep", x: 13, y: 14, user: "u2", body: [] };
const firing = { actionLog: { attack: { x: 13, y: 14 } } };

/** 由测试推送房间流的 Source；历史只有 1000（塔空闲）与 1001（塔开火）两个 Tick */
function manualRoomSource() {
  let push: ((tick: RoomTick) => void) | undefined;
  const chunk: HistoryChunk = {
    shard: "shardSeason",
    room: "W13S28",
    base: 1000,
    ticks: [
      { gameTime: 1000, objects: { t1: tower, c1: creep } },
      { gameTime: 1001, objects: { t1: firing } },
      { gameTime: 1002, objects: { t1: { actionLog: null } } },
      { gameTime: 1003, objects: { t1: firing } },
    ],
  };
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
    getHistoryChunk: async () => chunk,
    close() {},
  } as unknown as Source;
  return {
    source,
    tick(tick: RoomTick) {
      if (!push) throw new Error("还没有订阅房间");
      push(tick);
    },
  };
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let room: ReturnType<typeof manualRoomSource>;
let visibility: ManualVisibility;
let shown: Scene[];
let settles: number;

async function recordingView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    settle: () => void (settles += 1),
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

interface MountOptions {
  readonly msPerTick?: Accessor<number | undefined>;
  readonly display?: RoomDisplay;
  readonly replay?: number;
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
}

let open: (request: { shard: string; room: string; replay?: { tick: number } }) => void;

function mount(options: MountOptions = {}) {
  dispose = render(() => {
    const [request, setRequest] = createSignal<{ shard: string; room: string; replay?: { tick: number } }>();
    open = setRequest;
    return (
      <I18nProvider>
        <RoomView
          settings={createSettings(localStorage)}
          sourceFor={() => room.source}
          visibility={visibility}
          createView={options.createView ?? recordingView}
          historyCache={async () => undefined}
          msPerTick={options.msPerTick}
          display={options.display}
          open={request()}
        />
      </I18nProvider>
    );
  }, container);
  open({ shard: "shardSeason", room: "W13S28", ...(options.replay === undefined ? {} : { replay: { tick: options.replay } }) });
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const beam = () => shown.at(-1)?.primitives.find((p) => p.key === "action/t1/attack-beam");
const beamMs = () => animationDuration(beam()!.animation!);
const animatedCount = () => (shown.at(-1)?.primitives ?? []).filter((p) => p.animation).length;
const field = (selector: string) => container.querySelector<HTMLElement>(selector)!;

/** Live：订阅后推一个空闲 Tick 与一个开火 Tick */
async function fire(gameTime: number) {
  room.tick({ gameTime, objects: { t1: firing } });
  await settle(() => expect(field(".room-view").dataset.tick).toBe(String(gameTime)));
}
async function startLive() {
  await settle(() => expect(() => room.tick({ gameTime: 100, objects: { t1: tower, c1: creep } })).not.toThrow());
  await settle(() => expect(field(".room-view").dataset.tick).toBe("100"));
}

describe("Room View 的动画接线（#55）", () => {
  beforeEach(() => {
    localStorage.clear();
    shown = [];
    settles = 0;
    visibility = manualVisibility(true);
    room = manualRoomSource();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("Live：Tick 速度测出前按 1000 ms；之后读外壳共享的实测值；再短也按 100 ms", async () => {
    const [measured, setMeasured] = createSignal<number>();
    mount({ msPerTick: measured });
    await startLive();
    await fire(101);
    expect(beamMs()).toBe(0.6 * 1000);

    setMeasured(3700);
    await fire(102);
    expect(beamMs()).toBeCloseTo(0.6 * 3700);

    setMeasured(20);
    await fire(103);
    expect(beamMs()).toBeCloseTo(0.6 * 100);
  });

  it("同一 Tick 内实测值更新不改这个 Tick 的动画（不重播）", async () => {
    const [measured, setMeasured] = createSignal<number>(2000);
    mount({ msPerTick: measured });
    await startLive();
    await fire(101);
    const before = beam();
    setMeasured(3000);
    expect(beam()).toBe(before);
  });

  it("Replay：Tick 间隔由回放速度算出（1x 1000 ms，4x 250 ms，16x 按下限 100 ms）", async () => {
    mount({ replay: 1000, msPerTick: () => 5000 });
    await settle(() => expect(field(".room-view").dataset.tick).toBe("1000"));
    await settle(() => expect(shown.at(-1)?.primitives.some((p) => p.objectId === "t1")).toBe(true));
    field("[data-action=replay-step-forward]").click();
    await settle(() => expect(field(".room-view").dataset.tick).toBe("1001"));
    await settle(() => expect(beam()).toBeDefined());
    expect(beamMs()).toBe(600);

    field("[data-action=replay-speed-4]").click();
    field("[data-action=replay-step-forward]").click();
    field("[data-action=replay-step-forward]").click();
    await settle(() => expect(field(".room-view").dataset.tick).toBe("1003"));
    expect(beamMs()).toBe(150);

    field("[data-action=replay-speed-16]").click();
    field("[data-action=replay-step-back]").click();
    field("[data-action=replay-step-forward]").click();
    await settle(() => expect(field(".room-view").dataset.tick).toBe("1003"));
    expect(beamMs()).toBe(60);
  });

  it("动画开关关闭时 Scene 没有动画、没有光束", async () => {
    mount({ display: { ...DEFAULT_ROOM_DISPLAY, animation: false } });
    await startLive();
    await fire(101);
    expect(beam()).toBeUndefined();
    expect(animatedCount()).toBe(0);
  });

  it("页面隐藏时不构建 Scene、让适配层停下；回来时画面上的 Tick 不补播", async () => {
    mount();
    await startLive();
    await fire(101);
    expect(animatedCount()).toBeGreaterThan(0);
    const built = shown.length;

    visibility.set(false);
    expect(settles).toBe(1);
    room.tick({ gameTime: 102, objects: { t1: { actionLog: { attack: { x: 12, y: 14 } } } } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(shown.length).toBe(built);

    visibility.set(true);
    await settle(() => expect(shown.length).toBe(built + 1));
    expect(animatedCount()).toBe(0);
    // 下一个 Tick 照常播放
    await fire(103);
    expect(animatedCount()).toBeGreaterThan(0);
  });

  it("真实适配层：动画播放期间逐帧渲染；页面隐藏后不再请求帧", async () => {
    let renders = 0;
    let time = 0;
    const queue: (() => void)[] = [];
    const flush = () => {
      for (const frame of queue.splice(0)) frame();
    };
    const renderer = (options: SceneViewOptions): SceneRenderer => {
      const canvas = document.createElement("canvas");
      canvas.width = options.width;
      canvas.height = options.height;
      return { canvas, background: { color: 0 }, render: () => void (renders += 1), resize: () => {}, destroy: () => {} } as unknown as SceneRenderer;
    };
    mount({
      createView: (options) =>
        createSceneView({ ...options, renderer: renderer(options), schedule: (frame) => void queue.push(frame), now: () => time }),
    });
    await startLive();
    flush();
    await fire(101);
    flush();
    const started = renders;
    time = 100;
    flush();
    expect(renders).toBe(started + 1);
    expect(queue.length).toBe(1);

    visibility.set(false);
    time = 200;
    flush();
    expect(renders).toBe(started + 1);
    expect(queue.length).toBe(0);
  });
});
