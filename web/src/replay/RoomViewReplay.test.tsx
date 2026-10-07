import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import type { Scene } from "../scene/scene.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { ConnectionState, Source, Unsubscribe } from "../source/source.ts";
import { RoomView } from "../room/RoomView.tsx";
import { manualVisibility, type VisibilitySignal } from "../power/visibility.ts";
import { openReplay, parseReplayHref, replayHref } from "./replay-controller.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let shown: Scene[];
let roomSubscriptions: number;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: (scene) => void shown.push(scene),
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

/** 回放录制数据的 Source，记录房间订阅次数。 */
function recordedSource(): Source {
  const source = new FixtureSource(bundle, { speed: Infinity });
  const subscribe = source.subscribeRoom.bind(source);
  source.subscribeRoom = (...args) => {
    roomSubscriptions += 1;
    return subscribe(...args);
  };
  return source;
}

/** token 失效的 Source：WebSocket 认证失败、房间流没有任何帧，但匿名的 HTTP 接口照常。 */
function unauthorizedSource(): Source {
  const source = new FixtureSource(bundle, { speed: Infinity });
  source.onConnection = (listener: (state: ConnectionState) => void): Unsubscribe => {
    listener("unauthorized");
    return () => {};
  };
  source.subscribeRoom = () => () => {};
  return source;
}

function mount(sourceFor: () => Source = recordedSource, visibility: VisibilitySignal = manualVisibility()) {
  dispose = render(
    () => (
      <I18nProvider>
        <RoomView
          settings={createSettings(localStorage)}
          sourceFor={sourceFor}
          createView={fakeView}
          historyCache={async () => undefined}
          visibility={visibility}
        />
      </I18nProvider>
    ),
    container,
  );
}

function field<T extends HTMLElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  return el;
}

function input(name: string, value: string) {
  const el = field<HTMLInputElement>(`[name=${name}]`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(selector: string) {
  field<HTMLFormElement>(selector).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function watch(shard: string, room: string) {
  input("room-view-shard", shard);
  input("room-view-room", room);
  submit("form[data-testid=room-view-form]");
}

const click = (action: string) => field<HTMLButtonElement>(`[data-action=${action}]`).click();
const tick = () => field("[data-testid=room-view-tick]").textContent;
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const lastScene = () => shown.at(-1)!;
/** 录制的历史 chunk 里一个对象（W13S28 的 source） */
const HISTORY_OBJECT = "6a8caaaddd4872bccd319361";

function pointer(type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  field("[data-testid=replay-timeline]").dispatchEvent(event);
}

describe("Room View 的 Replay", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/");
    shown = [];
    roomSubscriptions = 0;
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    history.replaceState(null, "", "/");
  });

  it("地址里的“房间 + Tick”直接打开 Replay，画出该 Tick 的历史状态，不订阅 Live", async () => {
    expect(parseReplayHref(replayHref({ shard: "shardSeason", room: "W13S28", tick: 1024937 }))).toEqual({
      shard: "shardSeason",
      room: "W13S28",
      tick: 1024937,
    });
    location.hash = replayHref({ shard: "shardSeason", room: "W13S28", tick: 1024937 });
    mount();
    await settle(() => expect(lastScene()?.primitives.some((p) => p.objectId === HISTORY_OBJECT)).toBe(true));
    expect(tick()).toBe("1024937");
    expect(field<HTMLInputElement>("[name=room-view-room]").value).toBe("W13S28");
    expect(roomSubscriptions).toBe(0);
  });

  it("页面打开后 openReplay 也能切过去", async () => {
    mount();
    openReplay({ shard: "shardSeason", room: "W13S28", tick: 1024950 });
    await settle(() => expect(tick()).toBe("1024950"));
    await settle(() => expect(container.querySelector("[data-testid=replay-controls]")).not.toBeNull());
  });

  it("控制：单步、跳转、调速、时间轴拖动", async () => {
    location.hash = replayHref({ shard: "shardSeason", room: "W13S28", tick: 1024937 });
    mount();
    await settle(() => expect(container.querySelector("[data-testid=replay-controls]")).not.toBeNull());

    click("replay-step-forward");
    expect(tick()).toBe("1024938");
    click("replay-step-back");
    click("replay-step-back");
    expect(tick()).toBe("1024936");

    input("replay-tick", "1024990");
    submit("form[data-testid=replay-jump]");
    expect(tick()).toBe("1024990");

    click("replay-speed-16");
    expect(field("[data-action=replay-speed-16]").getAttribute("aria-pressed")).toBe("true");
    expect(field("[data-action=replay-speed-1]").getAttribute("aria-pressed")).toBe("false");

    // 时间轴：宽 1000px，按位置换算 Tick；拖动时 Tick 跟手
    const timeline = field("[data-testid=replay-timeline]");
    timeline.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 20 }) as DOMRect;
    const lo = Number(timeline.getAttribute("aria-valuemin"));
    const hi = Number(timeline.getAttribute("aria-valuemax"));
    expect(lo).toBeLessThanOrEqual(1024900);
    expect(hi).toBeGreaterThanOrEqual(1024999);
    pointer("pointerdown", 0);
    expect(tick()).toBe(String(lo));
    pointer("pointermove", 1000);
    expect(tick()).toBe(String(hi));
    pointer("pointerup", 1000);
    pointer("pointermove", 0);
    expect(tick()).toBe(String(hi));
    expect(timeline.getAttribute("aria-valuenow")).toBe(String(hi));
  });

  it("页面不可见时暂停播放", async () => {
    const visibility = manualVisibility();
    location.hash = replayHref({ shard: "shardSeason", room: "W13S28", tick: 1024937 });
    mount(recordedSource, visibility);
    await settle(() => expect(container.querySelector("[data-testid=replay-controls]")).not.toBeNull());
    click("replay-toggle");
    expect(field("[data-action=replay-toggle]").getAttribute("aria-label")).toBe("暂停");
    visibility.set(false);
    expect(field("[data-action=replay-toggle]").getAttribute("aria-label")).toBe("播放");
  });

  it("历史不存在时明确提示，而不是一直加载", async () => {
    location.hash = replayHref({ shard: "shardSeason", room: "W13S28", tick: 500 });
    mount();
    await settle(() => expect(container.querySelector("[data-testid=replay-missing]")).not.toBeNull());
    expect(field("[data-testid=replay-missing]").textContent).toContain("历史不存在");
  });

  it("从 Live 进入 Replay、再一键回到 Live", async () => {
    mount();
    watch("shardSeason", "W13S28");
    await settle(() => expect(tick()).toBe("1025238"));
    expect(roomSubscriptions).toBe(1);

    click("replay-enter");
    await settle(() => expect(container.querySelector("[data-testid=replay-controls]")).not.toBeNull());
    // 录制里只有 1024900 的 chunk：从 1025238 往前退两个 chunk 仍没有，提示历史不存在
    await settle(() => expect(container.querySelector("[data-testid=replay-missing]")).not.toBeNull());
    input("replay-tick", "1024920");
    submit("form[data-testid=replay-jump]");
    await settle(() => expect(lastScene()?.primitives.some((p) => p.objectId === HISTORY_OBJECT)).toBe(true));
    expect(tick()).toBe("1024920");

    click("replay-back-to-live");
    await settle(() => expect(tick()).toBe("1025238"));
    expect(roomSubscriptions).toBe(2);
    expect(container.querySelector("[data-testid=replay-controls]")).toBeNull();
    expect(location.hash).toBe("");
  });

  it("token 失效时 Replay 照常可用（Live Tick 未知时向服务器要当前时间）", async () => {
    mount(unauthorizedSource);
    expect(field("[data-testid=room-view-state]").textContent).toBe("认证失败");
    watch("shardSeason", "W13S28");
    click("replay-enter");
    // 录制的服务器时间之前就有历史；跳到有历史的 Tick 能画出来
    await settle(() => expect(container.querySelector("[data-testid=replay-controls]")).not.toBeNull());
    input("replay-tick", "1024960");
    submit("form[data-testid=replay-jump]");
    await settle(() => expect(lastScene()?.primitives.some((p) => p.objectId === HISTORY_OBJECT)).toBe(true));
    expect(tick()).toBe("1024960");
  });
});
