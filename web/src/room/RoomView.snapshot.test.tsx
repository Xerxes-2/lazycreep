/**
 * #63：换房间时先画房间快照（Room Snapshot），实时第一帧到了整体替换；邻居预加载同时取快照。
 * - 快照先到就先画：Tick 未知（data-tick 不设）、没有动画
 * - 实时第一帧整体替换快照（快照里有、第一帧里没有的对象消失），以快照为上一个状态做移动补间
 * - 第一帧先到时丢弃迟到的快照；快照失败静默；Replay 不取快照
 * - 邻居预加载取快照，切过去时命中缓存（10 秒内），过期后重新请求；页面隐藏时不预加载
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility, type ManualVisibility } from "../power/visibility.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { createSettings } from "../settings/settings.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import { SNAPSHOT_FRESH_MS, SNAPSHOT_REFRESH_MS } from "../source/snapshot-cache.ts";
import type { ConnectionState, HistoryChunk, RoomSnapshot, RoomTick, Source } from "../source/source.ts";
import { withStaticCache } from "../source/static-cache.ts";
import { RoomView } from "./RoomView.tsx";

const SHARD = "shardSeason";
const creep = { _id: "c1", type: "creep", x: 13, y: 14, user: "u2", body: [{ type: "move", hits: 100 }] };
const gone = { _id: "c2", type: "creep", x: 20, y: 20, user: "u2", body: [{ type: "move", hits: 100 }] };
const neighborCreep = { _id: "c9", type: "creep", x: 5, y: 5, user: "u2", body: [{ type: "move", hits: 100 }] };

const SNAPSHOTS: Record<string, RoomSnapshot> = {
  W13S28: { objects: { c1: creep, c2: gone }, users: {} },
  W13S27: { objects: { c9: neighborCreep }, users: {} },
};

/** 由测试推送房间流、控制快照何时到达的 Source */
function fakeSource() {
  let push: ((tick: RoomTick) => void) | undefined;
  const snapshotCalls: string[] = [];
  const pending: { room: string; settle: (fail?: boolean) => void }[] = [];
  const state = { hold: false, fail: false };
  const chunk: HistoryChunk = {
    shard: SHARD,
    room: "W13S28",
    base: 1000,
    ticks: [{ gameTime: 1000, objects: { c1: creep } }],
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
    getRoomSnapshot: (_shard: string, room: string) => {
      snapshotCalls.push(room);
      return new Promise<RoomSnapshot>((resolve, reject) => {
        const settle = (fail = state.fail) => (fail ? reject(new Error("down")) : resolve(SNAPSHOTS[room] ?? { objects: {}, users: {} }));
        if (state.hold) pending.push({ room, settle });
        else settle();
      });
    },
    getWorldSize: async () => ({ width: 102, height: 102 }),
    getTerrain: async (shard: string, room: string) => ({ shard, room, encoded: "0".repeat(2500) }),
    getVersion: async () => ({ package: 1, protocol: 14, historyChunkSize: 1000, mapTileRoot: null }),
    getHistoryChunk: async () => chunk,
    close() {},
  } as unknown as Source;
  return {
    source,
    snapshotCalls,
    state,
    /** 放行某个房间在途的快照请求 */
    release(room: string, fail?: boolean) {
      const index = pending.findIndex((p) => p.room === room);
      if (index < 0) throw new Error(`${room} 没有在途的快照请求`);
      pending.splice(index, 1)[0]!.settle(fail);
    },
    tick(tick: RoomTick) {
      if (!push) throw new Error("还没有订阅房间");
      push(tick);
    },
    subscribed: () => push !== undefined,
  };
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let net: ReturnType<typeof fakeSource>;
let shown: Scene[];
let visibility: ManualVisibility;
let open: (request: { shard: string; room: string; replay?: { tick: number } }) => void;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 10 },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

function mount(options: { replay?: number; source?: Source } = {}) {
  dispose = render(() => {
    const [request, setRequest] = createSignal<{ shard: string; room: string; replay?: { tick: number } }>();
    open = setRequest;
    return (
      <I18nProvider>
        <RoomView
          settings={createSettings(localStorage)}
          sourceFor={() => options.source ?? net.source}
          visibility={visibility}
          createView={fakeView}
          historyCache={async () => undefined}
          msPerTick={() => 2000}
          open={request()}
        />
      </I18nProvider>
    );
  }, container);
  open({ shard: SHARD, room: "W13S28", ...(options.replay === undefined ? {} : { replay: { tick: options.replay } }) });
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const field = (selector: string) => container.querySelector<HTMLElement>(selector)!;
const lastScene = () => shown.at(-1)!;
const objectIds = () => new Set(lastScene().primitives.flatMap((p) => (p.objectId ? [p.objectId] : [])));
const animated = () => lastScene().primitives.filter((p) => p.animation);
const tweenFrom = (key: string, property: string) =>
  lastScene().primitives.find((p) => p.key === key)?.animation?.tweens.find((t) => t.property === property)?.from;

describe("Room View 的房间快照（#63）", () => {
  beforeEach(() => {
    localStorage.clear();
    shown = [];
    visibility = manualVisibility(true);
    net = fakeSource();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("快照先到就先画：Tick 未知、没有动画；第一帧整体替换，以快照为上一个状态做移动补间", async () => {
    net.state.hold = true;
    mount();
    await settle(() => expect(net.snapshotCalls).toContain("W13S28"));
    net.release("W13S28");
    await settle(() => expect(objectIds()).toEqual(new Set(["c1", "c2"])));
    expect(field(".room-view").dataset.tick).toBeUndefined();
    expect(animated()).toEqual([]);

    // 第一帧（全量、不带 gameTime）：c2 已不在，c1 向右走了一格
    net.tick({ objects: { c1: { ...creep, x: 14 } } });
    await settle(() => expect(objectIds()).toEqual(new Set(["c1"])));
    expect(tweenFrom("c1/base", "offsetX")).toBe(-1);
    expect(field(".room-view").dataset.tick).toBeUndefined();

    // 之后照常按增量合并
    net.tick({ gameTime: 101, objects: { c1: { y: 15 } } });
    await settle(() => expect(field(".room-view").dataset.tick).toBe("101"));
    expect(objectIds()).toEqual(new Set(["c1"]));
    expect(tweenFrom("c1/base", "offsetY")).toBe(-1);
  });

  it("第一帧先到时丢弃迟到的快照", async () => {
    net.state.hold = true;
    mount();
    await settle(() => expect(net.subscribed() && net.snapshotCalls.includes("W13S28")).toBe(true));
    net.tick({ objects: { c1: creep } });
    await settle(() => expect(objectIds()).toEqual(new Set(["c1"])));
    net.release("W13S28");
    await pause();
    expect(objectIds()).toEqual(new Set(["c1"]));
  });

  it("快照失败静默：不报错，实时订阅照常", async () => {
    net.state.fail = true;
    mount();
    await settle(() => expect(net.snapshotCalls).toContain("W13S28"));
    await pause();
    expect(container.querySelector("[role=alert]")).toBeNull();
    net.tick({ gameTime: 100, objects: { c1: creep } });
    await settle(() => expect(field(".room-view").dataset.tick).toBe("100"));
    expect(objectIds()).toEqual(new Set(["c1"]));
  });

  it("Replay 不取快照（当前房间与邻居都不取）", async () => {
    mount({ replay: 1000 });
    await settle(() => expect(field(".room-view").dataset.tick).toBe("1000"));
    await pause(50);
    expect(net.snapshotCalls).toEqual([]);
  });

  it("邻居预加载取快照；有效期内切过去命中缓存、立即画出，过期后重新请求", async () => {
    const time = { now: 1_000_000 };
    const cached = withStaticCache(net.source, { storage: undefined, now: () => time.now });
    mount({ source: cached });
    await settle(() => expect(net.snapshotCalls).toEqual(["W13S28", "W13S27", "W14S28", "W12S28", "W13S29"]));

    time.now += SNAPSHOT_FRESH_MS - 1;
    open({ shard: SHARD, room: "W13S27" });
    await settle(() => expect(objectIds()).toEqual(new Set(["c9"])));
    expect(net.snapshotCalls.filter((room) => room === "W13S27")).toHaveLength(1);

    // W13S28 的快照已过期（也已从缓存里清掉）：回去时重新请求
    time.now += 2;
    open({ shard: SHARD, room: "W13S28" });
    await settle(() => expect(net.snapshotCalls.filter((room) => room === "W13S28")).toHaveLength(2));
  });

  it("停留期间每 30 秒在后台刷新邻居快照；页面隐藏时不刷新；换房间后旧房间的刷新停掉", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const time = { now: 1_000_000 };
      const cached = withStaticCache(net.source, { storage: undefined, now: () => time.now });
      mount({ source: cached });
      const neighbors = ["W13S27", "W14S28", "W12S28", "W13S29"];
      await settle(() => expect(net.snapshotCalls).toEqual(["W13S28", ...neighbors]));

      // 邻居快照在打开房间后才取到，第一次刷新时还不满一个间隔，也要刷新
      time.now += SNAPSHOT_REFRESH_MS * 0.6;
      vi.advanceTimersByTime(SNAPSHOT_REFRESH_MS);
      await settle(() => expect(net.snapshotCalls).toEqual(["W13S28", ...neighbors, ...neighbors]));

      visibility.set(false);
      time.now += SNAPSHOT_REFRESH_MS;
      vi.advanceTimersByTime(SNAPSHOT_REFRESH_MS);
      await pause(50);
      expect(net.snapshotCalls).toHaveLength(9);

      visibility.set(true);
      open({ shard: SHARD, room: "W13S27" });
      await settle(() => expect(net.snapshotCalls.length).toBeGreaterThan(9));
      const before = net.snapshotCalls.length;
      await pause(50);
      time.now += SNAPSHOT_REFRESH_MS;
      vi.advanceTimersByTime(SNAPSHOT_REFRESH_MS);
      await pause(50);
      // 只刷新 W13S27 的邻居（W13S26、W14S27、W12S27、W13S28），不再刷新 W13S28 的邻居
      const refreshed = net.snapshotCalls.slice(before);
      expect(refreshed).not.toContain("W14S28");
      expect(refreshed).toEqual(expect.arrayContaining(["W13S26", "W14S27", "W12S27", "W13S28"]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("页面隐藏时不预加载邻居的快照", async () => {
    visibility = manualVisibility(false);
    mount();
    await settle(() => expect(net.snapshotCalls).toEqual(["W13S28"]));
    await pause(50);
    expect(net.snapshotCalls).toEqual(["W13S28"]);
  });
});
