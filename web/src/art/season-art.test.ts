/**
 * #47：赛季贴图的预检。Scene 构建只会拿到预检通过的贴图；没有配置时什么都不给。
 */
import { describe, expect, it, vi } from "vitest";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import { createSeasonArtLoader } from "./season-art.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 预检由测试放行或拒绝 */
function preflights() {
  const pending = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
  const preflight = vi.fn(
    (url: string) => new Promise<void>((resolve, reject) => pending.set(url, { resolve, reject })),
  );
  const settle = (name: string, ok: boolean) => {
    const entry = pending.get(`/season-static/season11/renderer/${name}.png`)!;
    if (ok) entry.resolve();
    else entry.reject(new Error("404"));
  };
  return { preflight, settle };
}

describe("赛季贴图的预检", () => {
  it("预检前没有贴图；通过一张给一张，失败的始终不给", async () => {
    const { preflight, settle } = preflights();
    const art = createSeasonArtLoader(preflight).forSource(new FixtureSource(bundle, { speed: Infinity }));
    expect(art()).toBeUndefined();
    await flush();
    // 下发资源里的每一张都预检，不只是本地画法认识的
    expect(preflight.mock.calls.map(([url]) => url).sort()).toEqual([
      "/season-static/season11/renderer/T.png",
      "/season-static/season11/renderer/extractor.svg",
      "/season-static/season11/renderer/reactor-core.png",
      "/season-static/season11/renderer/reactor-edge.png",
    ]);

    settle("T", true);
    await flush();
    expect(art()?.sprite("mineral", "T")).toEqual({ url: "/season-static/season11/renderer/T.png", width: 128, height: 128 });
    expect(art()?.sprite("reactor", "reactor-core")).toBeUndefined();

    settle("reactor-core", true);
    settle("reactor-edge", false);
    await flush();
    expect(art()?.sprite("reactor", "reactor-core")).toEqual(expect.objectContaining({ width: 150, height: 150 }));
    expect(art()?.sprite("reactor", "reactor-edge")).toBeUndefined();
  });

  it("同一 Source 只取一次版本信息、每张贴图只预检一次", async () => {
    const { preflight } = preflights();
    const source = new FixtureSource(bundle, { speed: Infinity });
    const getVersion = vi.spyOn(source, "getVersion");
    const loader = createSeasonArtLoader(preflight);
    const a = loader.forSource(source);
    const b = loader.forSource(source);
    await flush();
    expect(a).toBe(b);
    expect(getVersion).toHaveBeenCalledTimes(1);
    expect(preflight).toHaveBeenCalledTimes(4);
  });

  it("版本信息里没有渲染器配置（MMO）或取版本失败时，没有贴图也不预检", async () => {
    const { preflight } = preflights();
    const mmo = new FixtureSource({ ...bundle, server: SERVER_PRESETS.mmo }, { speed: Infinity });
    mmo.getVersion = () => Promise.resolve({ package: 1, protocol: 14, historyChunkSize: 100 });
    const down = new FixtureSource(bundle, { speed: Infinity });
    down.getVersion = () => Promise.reject(new Error("down"));
    const loader = createSeasonArtLoader(preflight);
    const arts = [loader.forSource(mmo), loader.forSource(down)];
    await flush();
    expect(arts.map((art) => art())).toEqual([undefined, undefined]);
    expect(preflight).not.toHaveBeenCalled();
  });
});
