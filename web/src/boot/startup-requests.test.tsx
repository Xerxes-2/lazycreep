/**
 * 启动时的请求时序（#35）：整页（App）由假 Source 驱动，HTTP 响应由测试放行，观察请求的先后与 World Map 的首个 Scene。
 * - 设置里已有 Shard 时，世界尺寸与 Shard 列表并行发出，不等 Shard 列表返回；
 * - Top Bar、World Map、Console 等各处要 Shard 列表，只发一次；
 * - 有缓存时 World Map 的首个 Scene 不等任何网络请求，已含瓦片。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App.tsx";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import { staticCached } from "../source/static-cache.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 录制数据作底；每个 get* 记下调用，响应等 release 放行（不放行就一直没有回应） */
function heldSource() {
  const calls: string[] = [];
  const pending = new Set<string>();
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  const factory = () =>
    new Proxy(new FixtureSource(bundle, { speed: Infinity }), {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        const method = (value as (...args: unknown[]) => unknown).bind(target);
        if (typeof prop !== "string" || !prop.startsWith("get")) return method;
        return async (...args: unknown[]) => {
          calls.push(prop);
          pending.add(prop);
          await released;
          pending.delete(prop);
          return method(...args);
        };
      },
    }) as Source;
  return { factory, calls, pending, release: () => release() };
}

let shown: Scene[];
async function recordingView(options: SceneViewOptions): Promise<SceneView> {
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

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(source: ReturnType<typeof heldSource>) {
  dispose = render(() => <App sourceFor={source.factory} createView={recordingView} tickPollMs={60_000} />, container);
}

/** 设置里已有 token 与当前 Shard（上次用过） */
function returningUser() {
  localStorage.setItem("msc.settings", JSON.stringify({ token: "test-token", shards: { season: "shardSeason" } }));
}

/** 上次启动留下的 Shard 列表与世界尺寸缓存 */
async function cachedFromLastVisit() {
  const source = staticCached(() => new FixtureSource(bundle, { speed: Infinity }), { storage: localStorage })(
    bundle.server,
    undefined,
  );
  await source.getShards();
  await source.getWorldSize("shardSeason");
  source.close();
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const tiles = (scene: Scene) => scene.primitives.filter((p) => p.kind === "image");

beforeEach(() => {
  localStorage.clear();
  location.hash = "";
  shown = [];
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  document.getElementById("boot")?.remove();
});

describe("启动请求时序", () => {
  it("设置里已有 Shard：世界尺寸请求不等 Shard 列表返回", async () => {
    returningUser();
    const source = heldSource();
    mount(source);
    await settle(() => expect(source.calls).toContain("getWorldSize"));
    // 世界尺寸发出时 Shard 列表还没有回应
    expect(source.pending.has("getShards")).toBe(true);
    source.release();
  });

  it("各处都要 Shard 列表时只请求一次", async () => {
    returningUser();
    const source = heldSource();
    mount(source);
    await settle(() => expect(source.calls).toContain("getWorldSize"));
    source.release();
    await settle(() => expect(shown.some((scene) => tiles(scene).length > 0)).toBe(true));
    expect(source.calls.filter((c) => c === "getShards")).toHaveLength(1);
  });

  it("game/time（#38）：启动后到首次轮询前只请求一次（Top Bar 与自动打开的设置页同时要）", async () => {
    // 有启动画面时，没有 token 的启动会自动打开设置页（Menu 的 Server 项）
    const bootHost = document.createElement("div");
    bootHost.id = "boot";
    document.body.append(bootHost);
    const source = heldSource();
    mount(source);
    await settle(() => expect(source.calls).toContain("getShards"));
    source.release();
    await settle(() => {
      expect(container.querySelector("[data-testid=server-time]")?.textContent).toMatch(/\d{7}/);
      expect(container.querySelector('.top-bar [data-status="tick"]')?.textContent).toMatch(/\d{7}/);
    });
    expect(source.calls.filter((c) => c === "getTime")).toHaveLength(1);
  });

  it("有缓存时 World Map 的首个 Scene 不等任何网络请求，已含瓦片", async () => {
    returningUser();
    await cachedFromLastVisit();
    const source = heldSource();
    mount(source);
    // 任何请求都没有回应
    await settle(() => expect(shown.length).toBeGreaterThan(0));
    expect(tiles(shown[0]!).length).toBeGreaterThan(0);
    expect(tiles(shown[0]!).every((p) => p.kind === "image" && p.url.includes("/zoom1/"))).toBe(true);
    // 缓存新鲜：Shard 列表与世界尺寸都不发请求
    expect(source.calls).not.toContain("getShards");
    expect(source.calls).not.toContain("getWorldSize");
    source.release();
  });
});
