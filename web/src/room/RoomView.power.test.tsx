/**
 * Room View 的省电规则（#14）：无新 Tick 不重绘、页面不可见时暂停渲染。
 * Tick 速度与连接状态只在 Top Bar 显示（#25 #51），见 shell/top-bar-status.test.tsx。
 * 用真实的 Pixi 适配层配一个只计数的渲染器，观察 render() 的调用次数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility, type ManualVisibility } from "../power/visibility.ts";
import { createSceneView, type SceneRenderer, type SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import type { ConnectionState, RoomTick, Source } from "../source/source.ts";
import { RoomView } from "./RoomView.tsx";

/** 由测试逐帧推送房间流的 Source；只实现 Room View 用到的部分。 */
function manualRoomSource() {
  let push: ((tick: RoomTick) => void) | undefined;
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

const portal = (x: number) => ({ type: "portal", x, y: 10, room: "W13S28" });

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let renders: number;
let visibility: ManualVisibility;
let room: ReturnType<typeof manualRoomSource>;

function countingRenderer(options: SceneViewOptions): SceneRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    background: { color: 0 },
    render: () => void (renders += 1),
    resize: () => {},
    destroy: () => {},
  } as unknown as SceneRenderer;
}

let open: (request: { shard: string; room: string }) => void;

function mount() {
  dispose = render(() => {
    const [request, setRequest] = createSignal<{ shard: string; room: string }>();
    open = setRequest;
    return (
      <I18nProvider>
        <RoomView artStyle="geometric"
          settings={createSettings(localStorage)}
          sourceFor={() => room.source}
          visibility={visibility}
          createView={(options) =>
            createSceneView({ ...options, renderer: countingRenderer(options), schedule: (frame) => frame() })
          }
          open={request()}
        />
      </I18nProvider>
    );
  }, container);
}

function field<T extends HTMLElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  return el;
}

async function watch() {
  mount();
  await vi.waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());
  open({ shard: "shardSeason", room: "W13S28" });
  room.tick({ objects: { a: portal(10) } });
  await vi.waitFor(() => expect(renders).toBeGreaterThan(0));
}

const tickText = () => field(".room-view").dataset.tick;
const quiet = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Room View 省电", () => {
  beforeEach(() => {
    localStorage.clear();
    renders = 0;
    visibility = manualVisibility(true);
    room = manualRoomSource();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    vi.useRealTimers();
  });

  it("没有新 Tick 到达的时间段内渲染调用为零", async () => {
    await watch();
    room.tick({ gameTime: 101, objects: { a: { x: 11 } } });
    await quiet();
    const before = renders;
    await quiet();
    await quiet();
    expect(renders - before).toBe(0);

    // 内容没有变化的 Tick 也不重绘
    room.tick({ gameTime: 102, objects: {} });
    await quiet();
    expect(renders - before).toBe(0);
    expect(tickText()).toBe("102");

    room.tick({ gameTime: 103, objects: { a: { x: 12 } } });
    await vi.waitFor(() => expect(renders - before).toBe(1));
  });

  it("页面不可见时不渲染，回到前台画出最新的 Tick", async () => {
    await watch();
    const before = renders;
    visibility.set(false);
    room.tick({ gameTime: 101, objects: { a: { x: 11 } } });
    room.tick({ gameTime: 102, objects: { a: { x: 12 } } });
    await quiet();
    expect(renders - before).toBe(0);

    visibility.set(true);
    await vi.waitFor(() => expect(renders - before).toBe(1));
    await quiet();
    expect(renders - before).toBe(1);
  });
});
