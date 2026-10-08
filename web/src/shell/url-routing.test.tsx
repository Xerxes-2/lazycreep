import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { ConnectionState, ServerConfig, Source, Unsubscribe } from "../source/source.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
/** 每次房间订阅：Server id 与房间 */
let subscriptions: string[];
/** 每次建 Source 时的 Server id */
let servers: string[];

function recorded(server: ServerConfig): Source {
  servers.push(server.id);
  const source = new FixtureSource(bundle, { speed: Infinity });
  const subscribe = source.subscribeRoom.bind(source);
  source.subscribeRoom = (shard, room, ...rest) => {
    subscriptions.push(`${server.id}/${shard}/${room}`);
    return subscribe(shard, room, ...rest);
  };
  return source;
}

/** token 失效：认证失败、房间流没有帧，匿名 HTTP 照常 */
function unauthorized(server: ServerConfig): Source {
  const source = recorded(server);
  source.onConnection = (listener: (state: ConnectionState) => void): Unsubscribe => {
    listener("unauthorized");
    return () => {};
  };
  source.subscribeRoom = () => () => {};
  return source;
}

/** 假画布：Minimap 每个房间格 60 CSS 像素 */
const CELL = 60;
async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: CELL },
    show: () => {},
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

/** 刷新：卸载后按当前地址与存储重新挂载整个应用 */
function mount(sourceFor: (server: ServerConfig) => Source = recorded, createView?: typeof fakeView) {
  dispose?.();
  container.innerHTML = "";
  dispose = render(
    () => <App sourceFor={sourceFor} narrow={() => false} {...(createView ? { createView } : {})} />,
    container,
  );
}

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
/** 等写回地址的微任务跑完 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const shownView = () =>
  [...container.querySelectorAll<HTMLElement>(".main-view [data-view]")].filter((el) => !el.hidden).map((el) => el.dataset["view"]);
const roomInput = () => q<HTMLInputElement>("[name=room-view-room]")!.value;
const tick = () => q("[data-testid=room-view-tick]")!.textContent;
const storedSettings = () => JSON.parse(localStorage.getItem("msc.settings") ?? "{}") as { serverId?: string; shards?: Record<string, string> };

function input(name: string, value: string) {
  const el = q<HTMLInputElement>(`[name=${name}]`)!;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 拖动 Replay 时间轴：从 10% 处按下、拖到 x（千分比） */
function dragTimeline(x: number) {
  const timeline = q("[data-testid=replay-timeline]")!;
  timeline.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 20 }) as DOMRect;
  for (const [type, at] of [["pointerdown", 100], ["pointermove", (100 + x) / 2], ["pointermove", x], ["pointerup", x]] as const) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    timeline.dispatchEvent(event);
  }
}

/** 点 Minimap 的格子（col、row 为 0–2） */
function tapMinimap(col: number, row: number) {
  const canvas = q<HTMLCanvasElement>("[data-section='room.minimap'] canvas")!;
  const point = { clientX: (col + 0.5) * CELL, clientY: (row + 0.5) * CELL };
  for (const type of ["pointerdown", "pointerup"]) {
    canvas.dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, bubbles: true, button: 0 }));
  }
}

function watch(room: string) {
  input("room-view-shard", "shardSeason");
  input("room-view-room", room);
  q("form[data-testid=room-view-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

/** 浏览器前进后退：history.back/forward 在 jsdom 里异步触发 popstate */
function traverse(step: () => void) {
  return new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => setTimeout(resolve, 0), { once: true });
    step();
  });
}

/** 像用户在地址栏里改地址：增加一条历史记录并触发 hashchange */
async function typeAddress(hash: string) {
  const changed = new Promise((resolve) => window.addEventListener("hashchange", resolve, { once: true }));
  location.hash = hash;
  await changed;
  await flush();
}

describe("URL 导航（#32）", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("msc.settings", JSON.stringify({ serverId: "season", shards: { season: "shardSeason" } }));
    history.replaceState(null, "", "/");
    subscriptions = [];
    servers = [];
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
  });

  it("在应用内切换 World Map / Room View / Replay，地址随之变化，每次导航一条历史记录", async () => {
    mount();
    await flush();
    expect(location.hash).toBe("#!/season/map/shardSeason");
    const start = history.length;

    q<HTMLButtonElement>('[data-action=main-view][data-mode="room"]')!.click();
    watch("W13S28");
    await settle(() => expect(tick()).toBe("1025238"));
    expect(location.hash).toBe("#!/season/room/shardSeason/W13S28");

    q<HTMLButtonElement>("[data-action=replay-enter]")!.click();
    await settle(() => expect(q("[data-testid=replay-controls]")).not.toBeNull());
    await flush();
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1025238&latest=1");

    q<HTMLButtonElement>("[data-action=replay-back-to-live]")!.click();
    await flush();
    expect(location.hash).toBe("#!/season/room/shardSeason/W13S28");

    q<HTMLButtonElement>("[data-action=back-to-map]")!.click();
    await flush();
    expect(location.hash).toBe("#!/season/map/shardSeason");
    expect(history.length - start).toBe(4);
  });

  it("“回看”打开的 Replay 写进地址（起始 Tick 与 latest）", async () => {
    mount();
    await settle(() => expect(q('.pvp-overview tr[data-room="W17N21"]')).not.toBeNull());
    q('.pvp-overview tr[data-room="W17N21"]')!.querySelector<HTMLButtonElement>("[data-action=replay-battle]")!.click();
    await flush();
    expect(location.hash).toBe("#!/season/history/shardSeason/W17N21?t=1025136&latest=1");
    expect(shownView()).toEqual(["room"]);
  });

  it("按地址打开（含刷新）：Room View 的房间", async () => {
    history.replaceState(null, "", "/#!/season/room/shardSeason/w13s28");
    mount();
    expect(shownView()).toEqual(["room"]);
    expect(roomInput()).toBe("W13S28");
    await settle(() => expect(tick()).toBe("1025238"));
    await flush();
    // 规范写法替换了原地址，不新增历史记录
    expect(location.hash).toBe("#!/season/room/shardSeason/W13S28");

    mount();
    expect(shownView()).toEqual(["room"]);
    expect(roomInput()).toBe("W13S28");
  });

  it("按地址打开别的 Server 与 Shard", async () => {
    history.replaceState(null, "", "/#!/mmo/room/shard3/W1N1");
    mount();
    expect(storedSettings().serverId).toBe("mmo");
    expect(storedSettings().shards?.["mmo"]).toBe("shard3");
    expect(shownView()).toEqual(["room"]);
    expect(roomInput()).toBe("W1N1");
    await settle(() => expect(subscriptions).toContain("mmo/shard3/W1N1"));
    // 只给 mmo 建了 Source（不先连 season 再切）
    expect(new Set(servers)).toEqual(new Set(["mmo"]));

    await typeAddress("#!/season/map/shardSeason");
    expect(storedSettings().serverId).toBe("season");
    expect(shownView()).toEqual(["map"]);
  });

  it("按地址打开 Replay；token 失效也照常打开", async () => {
    history.replaceState(null, "", "/#!/season/history/shardSeason/W13S28?t=1024937");
    mount(unauthorized);
    expect(shownView()).toEqual(["room"]);
    await settle(() => expect(q("[data-testid=replay-controls]")).not.toBeNull());
    await settle(() => expect(tick()).toBe("1024937"));
    expect(subscriptions).toEqual([]);
  });

  it("运行中改地址即导航；一次导航只产生一次位置变化，不来回触发", async () => {
    mount();
    await flush();
    const start = history.length;
    await typeAddress("#!/season/room/shardSeason/W13S28");
    expect(shownView()).toEqual(["room"]);
    await settle(() => expect(tick()).toBe("1025238"));
    await flush();
    // 地址栏那一条记录之外，路由没有再写入；房间只订阅一次
    expect(history.length - start).toBe(1);
    expect(location.hash).toBe("#!/season/room/shardSeason/W13S28");
    expect(subscriptions).toEqual(["season/shardSeason/W13S28"]);

    await typeAddress("#!/season/history/shardSeason/W13S28?t=1024937");
    await settle(() => expect(tick()).toBe("1024937"));
    await flush();
    expect(history.length - start).toBe(2);
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1024937");
  });

  it("前进 / 后退在视图之间切换；拖动 Replay 时间轴不产生历史记录", async () => {
    mount();
    await flush();
    q<HTMLButtonElement>('[data-action=main-view][data-mode="room"]')!.click();
    watch("W13S28");
    await settle(() => expect(tick()).toBe("1025238"));
    await flush();
    q<HTMLButtonElement>("[data-action=back-to-map]")!.click();
    await flush();
    expect(shownView()).toEqual(["map"]);

    await traverse(() => history.back());
    expect(shownView()).toEqual(["room"]);
    expect(location.hash).toBe("#!/season/room/shardSeason/W13S28");
    await traverse(() => history.forward());
    expect(shownView()).toEqual(["map"]);
    await traverse(() => history.back());
    expect(shownView()).toEqual(["room"]);

    await typeAddress("#!/season/history/shardSeason/W13S28?t=1024937");
    await settle(() => expect(q("[data-testid=replay-controls]")).not.toBeNull());
    await settle(() => expect(tick()).toBe("1024937"));
    const before = history.length;
    for (let i = 0; i < 20; i += 1) q<HTMLButtonElement>("[data-action=replay-step-forward]")!.click();
    const timeline = q("[data-testid=replay-timeline]")!;
    timeline.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 20 }) as DOMRect;
    for (const [type, x] of [["pointerdown", 100], ["pointermove", 500], ["pointermove", 900], ["pointerup", 900]] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      timeline.dispatchEvent(event);
    }
    await flush();
    expect(tick()).not.toBe("1024937");
    expect(history.length).toBe(before);
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1024937");

    // 从 Replay 后退回 Live 的房间
    await traverse(() => history.back());
    await settle(() => expect(q("[data-testid=replay-controls]")).toBeNull());
    expect(shownView()).toEqual(["room"]);
    await settle(() => expect(tick()).toBe("1025238"));
  });

  it("Replay 的当前 Tick 进地址：拖动停下约 500ms 后 replace 写回、不产生历史记录；刷新回到该 Tick；Minimap 切房沿用它", async () => {
    history.replaceState(null, "", "/#!/season/history/shardSeason/W13S28?t=1024937");
    mount(recorded, fakeView);
    await settle(() => expect(q("[data-testid=replay-controls]")).not.toBeNull());
    await settle(() => expect(tick()).toBe("1024937"));
    await flush();
    const before = history.length;
    // 前面的用例后退过，history.length 可能因截断前进记录而不变：直接数新增记录的调用
    const push = vi.spyOn(history, "pushState");

    dragTimeline(700);
    const dragged = tick()!;
    expect(dragged).not.toBe("1024937");
    // 还在变化的短时间内不写地址
    await flush();
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1024937");
    await settle(() => expect(location.hash).toBe(`#!/season/history/shardSeason/W13S28?t=${dragged}`));
    expect(history.length).toBe(before);
    expect(push).not.toHaveBeenCalled();

    // 刷新：回到拖动后的 Tick
    mount(recorded, fakeView);
    await settle(() => expect(q("[data-testid=replay-controls]")).not.toBeNull());
    await settle(() => expect(tick()).toBe(dragged));

    // Minimap 点上方相邻格：新房间的 Replay 用同一个（拖动后的）Tick
    await settle(() => expect(q("[data-section='room.minimap'] canvas")).not.toBeNull());
    tapMinimap(1, 0);
    await settle(() => expect(roomInput()).toBe("W13S27"));
    await settle(() => expect(tick()).toBe(dragged));
    await flush();
    expect(location.hash).toBe(`#!/season/history/shardSeason/W13S27?t=${dragged}`);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it("旧的 #/replay?… 链接被转换为新格式并打开 Replay", async () => {
    history.replaceState(null, "", "/#/replay?shard=shardSeason&room=W13S28&tick=1024937");
    mount();
    expect(shownView()).toEqual(["room"]);
    await settle(() => expect(tick()).toBe("1024937"));
    await flush();
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1024937");

    await typeAddress("#/replay?shard=shardSeason&room=W13S28&tick=1024950&latest=1");
    await settle(() => expect(tick()).toBe("1024950"));
    expect(location.hash).toBe("#!/season/history/shardSeason/W13S28?t=1024950&latest=1");
  });

  it.each([
    ["未知 Server", "#!/nowhere/room/shardSeason/W13S28"],
    ["非法房间名", "#!/season/room/shardSeason/kitchen"],
    ["无法识别的路径", "#!/season/overview"],
  ])("无效地址（%s）回到当前 Server 的 World Map 并提示", async (_case, hash) => {
    history.replaceState(null, "", "/#!/season/room/shardSeason/W13S28");
    mount();
    expect(shownView()).toEqual(["room"]);

    await typeAddress(hash);
    expect(shownView()).toEqual(["map"]);
    expect(storedSettings().serverId).toBe("season");
    expect(q("[data-testid=route-notice]")!.textContent).toContain(hash);
    expect(location.hash).toBe("#!/season/map/shardSeason");

    q<HTMLButtonElement>("[data-action=dismiss-route-notice]")!.click();
    expect(q("[data-testid=route-notice]")).toBeNull();
  });
});
