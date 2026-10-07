/**
 * 两套布局的响应式状态与持久化（#2）：桌面布局与 Monitor Mode 布局各存一个 localStorage 键，
 * 互不影响。读写都包 try/catch：存储不可用时照常工作，只在本次会话内生效。
 */
import { createSignal, type Accessor } from "solid-js";
import { readText, writeJson, type KeyValueStorage } from "../storage/local-store.ts";
import {
  addPanel,
  defaultDesktopLayout,
  movePanel,
  parseDesktopLayout,
  parseMonitorLayout,
  removePanel,
  resizePanel,
  showTab,
  toggleTab,
  type DesktopLayout,
  type MonitorLayout,
  type PanelCatalog,
  type PanelId,
} from "./layout.ts";

export const DESKTOP_LAYOUT_KEY = "msc.layout.desktop";
export const MONITOR_LAYOUT_KEY = "msc.layout.monitor";

/** 默认打开的面板（桌面）与默认标签（Monitor Mode），按顺序 */
export interface LayoutDefaults {
  readonly desktop: readonly PanelId[];
  readonly monitor: readonly PanelId[];
}

export interface LayoutStore {
  readonly desktop: Accessor<DesktopLayout>;
  readonly monitor: Accessor<MonitorLayout>;
  openPanel(id: PanelId): void;
  closePanel(id: PanelId): void;
  move(id: PanelId, x: number, y: number): void;
  resize(id: PanelId, w: number, h: number): void;
  resetDesktop(): void;
  showTab(id: PanelId): void;
  toggleTab(id: PanelId): void;
}

export function createLayoutStore(
  storage: KeyValueStorage | undefined,
  catalog: PanelCatalog,
  defaults: LayoutDefaults,
): LayoutStore {
  const known = (ids: readonly PanelId[]) => ids.filter((id) => catalog.ids.includes(id));
  const initialDesktop = () => defaultDesktopLayout(known(defaults.desktop), catalog);
  const initialMonitor = (): MonitorLayout => {
    const tabs = known(defaults.monitor);
    const fallback = tabs.length > 0 ? tabs : catalog.ids.slice(0, 1);
    return { tabs: fallback, active: fallback[0]! };
  };

  const [desktop, setDesktop] = createSignal<DesktopLayout>(
    parseDesktopLayout(readText(storage, DESKTOP_LAYOUT_KEY), catalog) ?? initialDesktop(),
  );
  const [monitor, setMonitor] = createSignal<MonitorLayout>(
    parseMonitorLayout(readText(storage, MONITOR_LAYOUT_KEY), catalog) ?? initialMonitor(),
  );

  const changeDesktop = (change: (layout: DesktopLayout) => DesktopLayout) => {
    const before = desktop();
    const next = change(before);
    if (next === before) return;
    setDesktop(next);
    writeJson(storage, DESKTOP_LAYOUT_KEY, next);
  };
  const changeMonitor = (change: (layout: MonitorLayout) => MonitorLayout) => {
    const before = monitor();
    const next = change(before);
    if (next === before) return;
    setMonitor(next);
    writeJson(storage, MONITOR_LAYOUT_KEY, next);
  };

  return {
    desktop,
    monitor,
    openPanel: (id) => changeDesktop((l) => addPanel(l, id, catalog)),
    closePanel: (id) => changeDesktop((l) => removePanel(l, id)),
    move: (id, x, y) => changeDesktop((l) => movePanel(l, id, x, y)),
    resize: (id, w, h) => changeDesktop((l) => resizePanel(l, id, w, h)),
    resetDesktop: () => changeDesktop(() => initialDesktop()),
    showTab: (id) => changeMonitor((l) => showTab(l, id)),
    toggleTab: (id) => changeMonitor((l) => toggleTab(l, id)),
  };
}
