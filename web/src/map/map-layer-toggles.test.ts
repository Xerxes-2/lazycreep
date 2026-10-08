import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import type { Primitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { Nuke } from "../source/source.ts";
import { aggregatePvp } from "../pvp/pvp-overview.ts";
import { buildMapScene } from "./map-scene.ts";
import { applyMapStats, applyPowerBanks, mapStateFrom } from "./map-state.ts";
import { applyRoomUnits } from "./map-units.ts";
import { badgeLayer } from "./map-badge-layer.ts";
import { createMapLayerPrefs, mapLayers, MAP_LAYER_TOGGLES, type MapLayerToggle } from "./map-layer-toggles.ts";

/** 102×102 的世界：W13S28 在世界坐标 (37, 79)，E0S0 在 (51, 51) */
const NOW = 1_000_000;
let state = mapStateFrom({
  shard: "s",
  size: { width: 102, height: 102 },
  tiles: { room: (r) => `/tile/${r}`, block: (r) => `/block/${r}`, sector: (r) => `/sector/${r}` },
  me: "me",
});
state = applyMapStats(state, {
  shard: "s",
  gameTime: 1,
  rooms: {
    W13S28: { status: "normal", owner: { user: "me", level: 8 }, mineral: { type: "H", density: 2 } },
    E0S0: { status: "normal", novice: NOW + 1000 },
  },
  users: { me: { _id: "me", username: "Me" } },
});
state = applyPowerBanks(state, "W13S28", [[10, 10]]);
state = applyRoomUnits(state, "W13S28", { r: [[10, 11]], me: [[12, 12]] });

const nuke: Nuke = { id: "n1", shard: "s", room: "E0S0", x: 25, y: 10, landTime: 60_000, launchRoom: "W13S28" };
const group = aggregatePvp(
  { pvp: [{ shard: "s", time: 1000, rooms: [{ room: "W13S28", lastPvpTime: 990 }] }], nukes: [nuke] },
  100,
).find((g) => g.shard === "s");

/** 每个开关对应的图元 key 前缀 */
const PREFIX: Record<MapLayerToggle, readonly string[]> = {
  ownership: ["own:", "mine:"],
  rcl: ["rcl:"],
  minerals: ["mineral:"],
  powerBanks: ["pb:"],
  zones: ["zone:"],
  pvp: ["pvp:"],
  nukes: ["nuke:", "nuke-path:"],
  units: ["units:"],
  badges: ["badge:"],
};

function keys(primitives: readonly Primitive[], toggle: MapLayerToggle) {
  return primitives.filter((p) => PREFIX[toggle].some((prefix) => p.key.startsWith(prefix))).map((p) => p.key);
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

function scene(on: Parameters<typeof mapLayers>[0]) {
  return buildMapScene(
    state,
    { theme: DEFAULT_THEME, zoom: 64, visible: { x0: 30, y0: 45, x1: 60, y1: 85 }, now: NOW },
    mapLayers(on, group, badgeLayer((id) => `/badge/${id}`)),
  ).primitives;
}

describe("World Map 图层开关", () => {
  it("默认全部打开：每个开关都有对应的图元", () =>
    createRoot((dispose) => {
      const prefs = createMapLayerPrefs(memoryStorage());
      const primitives = scene(prefs.enabled());
      for (const toggle of MAP_LAYER_TOGGLES) expect(keys(primitives, toggle), toggle).not.toEqual([]);
      dispose();
    }));

  it.each(MAP_LAYER_TOGGLES)("关闭 %s 后它的图元不出现，其他图层与地形瓦片不受影响", (toggle) =>
    createRoot((dispose) => {
      const prefs = createMapLayerPrefs(memoryStorage());
      const before = scene(prefs.enabled());
      prefs.set(toggle, false);
      const after = scene(prefs.enabled());
      expect(keys(after, toggle)).toEqual([]);
      for (const other of MAP_LAYER_TOGGLES.filter((t) => t !== toggle)) {
        expect(keys(after, other), other).toEqual(keys(before, other));
      }
      expect(after.filter((p) => p.kind === "image").length).toBeGreaterThan(0);
      dispose();
    }));

  it("开关存进存储，重新创建后恢复；损坏的记录回到默认", () =>
    createRoot((dispose) => {
      const storage = memoryStorage();
      const first = createMapLayerPrefs(storage);
      first.toggle("rcl");
      first.set("nukes", false);
      const again = createMapLayerPrefs(storage);
      expect(again.enabled()).toMatchObject({ rcl: false, nukes: false, ownership: true, pvp: true });
      expect(keys(scene(again.enabled()), "rcl")).toEqual([]);

      storage.setItem("msc.mapLayers", JSON.stringify({ rcl: "nope", zones: false, bogus: false }));
      expect(createMapLayerPrefs(storage).enabled()).toMatchObject({ rcl: true, zones: false });
      storage.setItem("msc.mapLayers", "{");
      expect(Object.values(createMapLayerPrefs(storage).enabled()).every(Boolean)).toBe(true);
      dispose();
    }));
});
