/**
 * #54（ADR 0007）：录制房间在官方画风下的 Scene 锁定为快照（取代 #42 的几何画风快照，房间与视角相同）。
 * 任何改动让 Room View 的静止画面变了，这里就会变红；有意的改动用 `vitest -u` 更新快照并在提交里说明。
 * 不给赛季贴图（seasonArt）：赛季对象画兜底画法，快照不依赖赛季服的预检。
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { reduceLiveTick, type RoomState } from "./room-state.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

/** 超过这个长度的 data URL（合成地形、内联 SVG）在快照里换成摘要：内容一变摘要就变，快照仍然锁得住，但不会塞进几十 KB 的单行 */
const INLINE_URL_MAX = 120;

function snapshotValue(_key: string, value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith("data:") || value.length <= INLINE_URL_MAX) return value;
  const head = value.slice(0, value.search(/[;,]/));
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${head};… ${value.length} chars sha256:${digest}`;
}

async function finalState(room: string): Promise<RoomState> {
  const source = new FixtureSource(bundle, { speed: Infinity });
  let state: RoomState | undefined;
  source.subscribeRoom("shardSeason", room, (tick) => (state = reduceLiveTick(state, tick)));
  await vi.runAllTimersAsync();
  return state!;
}

describe("官方画风：录制房间的 Scene 输出不变", () => {
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
      plain: { theme: DEFAULT_THEME, zoom: 40, me: owner, display: { say: false, visual: false, names: false, lighting: false, animation: false } },
    };
    const scenes = Object.fromEntries(Object.entries(views).map(([name, view]) => [name, buildRoomScene({ state, terrain }, view)]));
    // 一行一个图元，便于看出差异
    const text = Object.entries(scenes)
      .map(([name, { primitives, ...rest }]) => [`# ${name} ${JSON.stringify(rest)}`, ...primitives.map((p) => JSON.stringify(p, snapshotValue))].join("\n"))
      .join("\n");
    await expect(text + "\n").toMatchFileSnapshot(`__snapshots__/official-${room}.txt`);
  });
});
