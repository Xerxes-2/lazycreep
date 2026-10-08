/**
 * World Map 的图层开关（#28）：决定 buildMapScene 用哪些层。地形瓦片总是画；其余每层归一个开关。
 * 开关存在本地（`msc.mapLayers`，所有 Server 共用），由 Sidebar 的“图层”区块修改。
 */
import { createSignal, type Accessor } from "solid-js";
import type { PvpShardGroup } from "../pvp/pvp-overview.ts";
import { nukeLayer, pvpHotspotLayer } from "../pvp/pvp-map-layer.ts";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import { paintAlliedHighlight, paintMinerals, paintPowerBanks, paintRcl, paintZones } from "./map-info-layers.ts";
import { paintOwnership, paintTiles, type MapLayerPainter } from "./map-scene.ts";
import { paintUnits } from "./map-units.ts";

const STORAGE_KEY = "msc.mapLayers";
export const MAP_LAYERS_STORAGE: StoredKey = { key: STORAGE_KEY, kind: "json-object", role: "settings" };

/** 开关，按 Sidebar 里的显示顺序 */
export const MAP_LAYER_TOGGLES = ["ownership", "rcl", "minerals", "powerBanks", "zones", "pvp", "nukes", "units"] as const;
export type MapLayerToggle = (typeof MAP_LAYER_TOGGLES)[number];
export type MapLayerSet = Readonly<Record<MapLayerToggle, boolean>>;

const ALL_ON: MapLayerSet = Object.fromEntries(MAP_LAYER_TOGGLES.map((t) => [t, true])) as Record<MapLayerToggle, boolean>;

/**
 * 按开关组成图层：地形瓦片、所有权（含我方 / 盟友高亮）、单位（#44）、区域、RCL、矿物、Power Bank，
 * 再叠这个 Shard 的 PvP 热点与核弹（group 为 undefined 时没有）。
 */
export function mapLayers(on: MapLayerSet, group?: PvpShardGroup): MapLayerPainter[] {
  const layers: MapLayerPainter[] = [paintTiles];
  if (on.ownership) layers.push(paintOwnership);
  if (on.units) layers.push(paintUnits);
  if (on.zones) layers.push(paintZones);
  if (on.rcl) layers.push(paintRcl);
  if (on.minerals) layers.push(paintMinerals);
  if (on.powerBanks) layers.push(paintPowerBanks);
  if (on.ownership) layers.push(paintAlliedHighlight);
  if (group && on.pvp) layers.push(pvpHotspotLayer(group));
  if (group && on.nukes) layers.push(nukeLayer(group));
  return layers;
}

export interface MapLayerPrefs {
  readonly enabled: Accessor<MapLayerSet>;
  set(toggle: MapLayerToggle, on: boolean): void;
  toggle(toggle: MapLayerToggle): void;
}

/** 逐字段校验：只认识的开关、布尔值；其余回到默认（打开） */
function decode(value: unknown): MapLayerSet | undefined {
  if (!isRecord(value)) return undefined;
  const out = { ...ALL_ON };
  for (const toggle of MAP_LAYER_TOGGLES) {
    const v = value[toggle];
    if (typeof v === "boolean") out[toggle] = v;
  }
  return out;
}

export function createMapLayerPrefs(storage: KeyValueStorage | undefined): MapLayerPrefs {
  const [enabled, setEnabled] = createSignal<MapLayerSet>(readJson(storage, STORAGE_KEY, decode, ALL_ON));
  const set = (toggle: MapLayerToggle, on: boolean) => {
    if (enabled()[toggle] === on) return;
    const next = { ...enabled(), [toggle]: on };
    setEnabled(next);
    writeJson(storage, STORAGE_KEY, next);
  };
  return { enabled, set, toggle: (toggle) => set(toggle, !enabled()[toggle]) };
}
