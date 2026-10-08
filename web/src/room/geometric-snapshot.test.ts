/**
 * #42：几何画风（Art Style = 几何）对录制房间的 Scene 输出锁定为快照。
 * 快照在引入官方画风之前生成；之后任何改动让几何画风的输出变了，这里就会变红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { reduceLiveTick, type RoomState } from "./room-state.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

async function finalState(room: string): Promise<RoomState> {
  const source = new FixtureSource(bundle, { speed: Infinity });
  let state: RoomState | undefined;
  source.subscribeRoom("shardSeason", room, (tick) => (state = reduceLiveTick(state, tick)));
  await vi.runAllTimersAsync();
  return state!;
}

describe("几何画风：录制房间的 Scene 输出不变", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["W13S28", "E13N21"])("%s", async (room) => {
    const state = await finalState(room);
    vi.useRealTimers();
    const terrain = await new FixtureSource(bundle).getTerrain("shardSeason", room);
    const anyCreep = Object.keys(state.objects).find((id) => state.objects[id]?.["type"] === "creep");
    const owner = Object.values(state.objects).find((o) => typeof o["user"] === "string")?.["user"] as string | undefined;
    const views: Record<string, RoomSceneView> = {
      default: { theme: DEFAULT_THEME },
      near: { theme: DEFAULT_THEME, zoom: 40, me: owner, selectedId: anyCreep, allies: new Set(["someone"]) },
      plain: { theme: DEFAULT_THEME, zoom: 40, me: owner, display: { say: false, visual: false, bars: false, names: false } },
    };
    const scenes = Object.fromEntries(
      Object.entries(views).map(([name, view]) => [name, buildRoomScene({ state, terrain }, { ...view, artStyle: "geometric" } as RoomSceneView)]),
    );
    // 一行一个图元，便于看出差异
    const text = Object.entries(scenes)
      .map(([name, { primitives, ...rest }]) => [`# ${name} ${JSON.stringify(rest)}`, ...primitives.map((p) => JSON.stringify(p))].join("\n"))
      .join("\n");
    await expect(text + "\n").toMatchFileSnapshot(`__snapshots__/geometric-${room}.txt`);
  });
});
