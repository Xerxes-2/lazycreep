/**
 * 面板布局的纯数据与变换（#2）。两套布局互不相干：
 * - 桌面：12 列网格上的停靠布局，每个打开的面板占一块矩形（网格单位），可拖动、缩放；
 *   面板之间不重叠：移动或缩放压到别的面板时把它们往下推，然后所有面板往上靠拢（不留空洞）。
 * - Monitor Mode（窄屏）：底部标签栏里的面板列表与当前标签，一次只显示一个面板。
 * 读回存储（parse*）时丢掉未知面板与坏数据，所以面板目录变了（例如生产构建没有开发用面板）也能恢复。
 */

export type PanelId = string;

/** 网格列数 */
export const GRID_COLS = 12;
export const MIN_W = 2;
export const MIN_H = 3;
export const MAX_H = 60;

export interface PanelSize {
  readonly w: number;
  readonly h: number;
}

export interface DesktopPanel extends PanelSize {
  readonly id: PanelId;
  readonly x: number;
  readonly y: number;
}

export interface DesktopLayout {
  /** 打开的面板，按打开顺序 */
  readonly panels: readonly DesktopPanel[];
}

export interface MonitorLayout {
  /** 标签栏里的面板，按显示顺序；至少一个 */
  readonly tabs: readonly PanelId[];
  readonly active: PanelId;
}

/** 已知面板及其默认尺寸 */
export interface PanelCatalog {
  readonly ids: readonly PanelId[];
  readonly size: (id: PanelId) => PanelSize;
}

const clampInt = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

function clampPanel(panel: DesktopPanel): DesktopPanel {
  const w = clampInt(panel.w, MIN_W, GRID_COLS);
  const h = clampInt(panel.h, MIN_H, MAX_H);
  return { id: panel.id, x: clampInt(panel.x, 0, GRID_COLS - w), y: Math.max(0, Math.round(panel.y)), w, h };
}

const overlap = (a: DesktopPanel, b: DesktopPanel) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 以 `first` 为准（不动），其余面板按 y 依次放下，压到已放好的面板就推到它下面。保持原顺序。 */
function settle(panels: readonly DesktopPanel[], first?: PanelId): DesktopPanel[] {
  const fixed = panels.filter((p) => p.id === first);
  const rest = panels.filter((p) => p.id !== first).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = new Map<PanelId, DesktopPanel>(fixed.map((p) => [p.id, p]));
  for (const panel of rest) {
    let current = panel;
    for (;;) {
      const hit = [...placed.values()].filter((other) => overlap(current, other));
      if (hit.length === 0) break;
      current = { ...current, y: Math.max(...hit.map((o) => o.y + o.h)) };
    }
    placed.set(current.id, current);
  }
  return panels.map((p) => placed.get(p.id)!);
}

/** 停靠：每个面板尽量往上靠（按 y 依次放，不越过已放好的面板）。保持原顺序。 */
function compact(panels: readonly DesktopPanel[]): DesktopPanel[] {
  const placed: DesktopPanel[] = [];
  const result = new Map<PanelId, DesktopPanel>();
  for (const panel of [...panels].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let current = { ...panel, y: 0 };
    for (;;) {
      const hit = placed.filter((other) => overlap(current, other));
      if (hit.length === 0) break;
      current = { ...current, y: Math.max(...hit.map((o) => o.y + o.h)) };
    }
    placed.push(current);
    result.set(current.id, current);
  }
  return panels.map((p) => result.get(p.id)!);
}

function bottom(layout: DesktopLayout): number {
  return Math.max(0, ...layout.panels.map((p) => p.y + p.h));
}

export function addPanel(layout: DesktopLayout, id: PanelId, catalog: PanelCatalog): DesktopLayout {
  if (layout.panels.some((p) => p.id === id)) return layout;
  const size = catalog.size(id);
  return { panels: [...layout.panels, clampPanel({ id, x: 0, y: bottom(layout), ...size })] };
}

export function removePanel(layout: DesktopLayout, id: PanelId): DesktopLayout {
  return { panels: compact(layout.panels.filter((p) => p.id !== id)) };
}

function update(layout: DesktopLayout, id: PanelId, change: (p: DesktopPanel) => DesktopPanel): DesktopLayout {
  const old = layout.panels.find((p) => p.id === id);
  if (!old) return layout;
  const next = clampPanel(change(old));
  if (next.x === old.x && next.y === old.y && next.w === old.w && next.h === old.h) return layout;
  return { panels: compact(settle(layout.panels.map((p) => (p.id === id ? next : p)), id)) };
}

export function movePanel(layout: DesktopLayout, id: PanelId, x: number, y: number): DesktopLayout {
  return update(layout, id, (p) => ({ ...p, x, y }));
}

export function resizePanel(layout: DesktopLayout, id: PanelId, w: number, h: number): DesktopLayout {
  return update(layout, id, (p) => ({ ...p, w, h }));
}

/** 按面板目录给的顺序与默认尺寸，从上到下、从左到右排开 */
export function defaultDesktopLayout(ids: readonly PanelId[], catalog: PanelCatalog): DesktopLayout {
  const panels: DesktopPanel[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const id of ids) {
    const { w, h } = catalog.size(id);
    if (x + w > GRID_COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    panels.push(clampPanel({ id, x, y, w, h }));
    x += w;
    rowH = Math.max(rowH, h);
  }
  return { panels };
}

function parseJson(raw: string | null | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseDesktopLayout(raw: string | null | undefined, catalog: PanelCatalog): DesktopLayout | undefined {
  const data = parseJson(raw);
  if (!isRecord(data) || !Array.isArray(data["panels"])) return undefined;
  const panels: DesktopPanel[] = [];
  for (const item of data["panels"]) {
    if (!isRecord(item)) continue;
    const { id, x, y, w, h } = item;
    if (typeof id !== "string" || !catalog.ids.includes(id) || panels.some((p) => p.id === id)) continue;
    if (!isNumber(x) || !isNumber(y) || !isNumber(w) || !isNumber(h)) continue;
    panels.push(clampPanel({ id, x, y, w, h }));
  }
  return { panels: compact(settle(panels)) };
}

export function parseMonitorLayout(raw: string | null | undefined, catalog: PanelCatalog): MonitorLayout | undefined {
  const data = parseJson(raw);
  if (!isRecord(data) || !Array.isArray(data["tabs"])) return undefined;
  const tabs = [
    ...new Set(data["tabs"].filter((id): id is string => typeof id === "string" && catalog.ids.includes(id))),
  ];
  const first = tabs[0];
  if (first === undefined) return undefined;
  const active = data["active"];
  return { tabs, active: typeof active === "string" && tabs.includes(active) ? active : first };
}

/** 切到某个面板：不在标签栏里就加到末尾 */
export function showTab(layout: MonitorLayout, id: PanelId): MonitorLayout {
  if (layout.active === id && layout.tabs.includes(id)) return layout;
  return { tabs: layout.tabs.includes(id) ? layout.tabs : [...layout.tabs, id], active: id };
}

/** 在标签栏里加入或移除一个面板（不切换当前标签）；至少保留一个 */
export function toggleTab(layout: MonitorLayout, id: PanelId): MonitorLayout {
  const index = layout.tabs.indexOf(id);
  if (index < 0) return { ...layout, tabs: [...layout.tabs, id] };
  if (layout.tabs.length === 1) return layout;
  const tabs = layout.tabs.filter((t) => t !== id);
  const active = layout.active === id ? tabs[Math.max(0, index - 1)]! : layout.active;
  return { tabs, active };
}
