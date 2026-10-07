/**
 * 配色（#5）：用户对 Scene 调色板与着色规则的修改。存在 `msc.colors`，只存与默认值不同的部分
 * （颜色写成 `#rrggbb`，导出的 JSON 可读），读出时与 DEFAULT_THEME 合并，坏值与未知键忽略。
 * `theme()` 是响应式的：Room View 与 World Map 的 Scene 构建读它，改动后立即用新 Theme 重建。
 */
import { createMemo, createSignal, type Accessor } from "solid-js";
import type { Color } from "../scene/scene.ts";
import { DEFAULT_THEME, type StrangerColoring, type Theme } from "../scene/theme.ts";
import { isRecord, readJson, writeText, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const COLOR_SCHEME_KEY = "msc.colors";
export const COLOR_SCHEME_STORAGE: StoredKey = { key: COLOR_SCHEME_KEY, kind: "json-object", role: "settings" };

/** 可单独编辑的颜色（strangers 是一组，单独编辑） */
export const PALETTE_KEYS = [
  "background",
  "terrainWall",
  "terrainSwamp",
  "owned",
  "ally",
  "neutral",
  "structure",
  "structureOutline",
  "road",
  "wall",
  "energy",
  "power",
  "mineral",
  "controller",
  "decay",
  "hitsBar",
  "barBackground",
  "label",
  "labelOutline",
  "selection",
  "placeholder",
] as const satisfies readonly (keyof Theme)[];

export type PaletteKey = (typeof PALETTE_KEYS)[number];

interface Overrides {
  readonly colors: Partial<Record<PaletteKey, Color>>;
  /** 下标 → 颜色 */
  readonly strangers: Readonly<Record<number, Color>>;
  readonly strangerColoring?: StrangerColoring;
  readonly playerColors: Readonly<Record<string, Color>>;
}

const EMPTY: Overrides = { colors: {}, strangers: {}, playerColors: {} };

export function colorToHex(color: Color): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function hexToColor(text: unknown): Color | undefined {
  return typeof text === "string" && /^#[0-9a-f]{6}$/i.test(text) ? Number.parseInt(text.slice(1), 16) : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function decode(value: unknown): Overrides {
  const parsed = record(value);
  const colors: Partial<Record<PaletteKey, Color>> = {};
  const storedColors = record(parsed["colors"]);
  for (const key of PALETTE_KEYS) {
    const color = hexToColor(storedColors[key]);
    if (color !== undefined) colors[key] = color;
  }
  const strangers: Record<number, Color> = {};
  if (Array.isArray(parsed["strangers"])) {
    parsed["strangers"].slice(0, DEFAULT_THEME.strangers.length).forEach((hex, i) => {
      const color = hexToColor(hex);
      if (color !== undefined) strangers[i] = color;
    });
  }
  const playerColors: Record<string, Color> = {};
  for (const [name, hex] of Object.entries(record(parsed["playerColors"]))) {
    const color = hexToColor(hex);
    const key = name.trim().toLowerCase();
    if (color !== undefined && key) playerColors[key] = color;
  }
  const coloring = parsed["strangerColoring"];
  return {
    colors,
    strangers,
    playerColors,
    ...(coloring === "faction" || coloring === "perPlayer" ? { strangerColoring: coloring } : {}),
  };
}

function serialize(o: Overrides): string {
  const hexes = (r: Readonly<Record<string, Color>>) =>
    Object.fromEntries(Object.entries(r).map(([k, c]) => [k, colorToHex(c)]));
  return JSON.stringify({
    colors: hexes(o.colors),
    strangers: DEFAULT_THEME.strangers.map((_, i) => (o.strangers[i] === undefined ? null : colorToHex(o.strangers[i]))),
    ...(o.strangerColoring ? { strangerColoring: o.strangerColoring } : {}),
    playerColors: hexes(o.playerColors),
  });
}

function themeFrom(o: Overrides): Theme {
  return {
    ...DEFAULT_THEME,
    ...o.colors,
    strangers: DEFAULT_THEME.strangers.map((c, i) => o.strangers[i] ?? c),
    strangerColoring: o.strangerColoring ?? DEFAULT_THEME.strangerColoring,
    playerColors: { ...o.playerColors },
  };
}

export interface ColorScheme {
  readonly theme: Accessor<Theme>;
  setColor(key: PaletteKey, color: Color): void;
  setStranger(index: number, color: Color): void;
  setStrangerColoring(mode: StrangerColoring): void;
  /** 用户名不分大小写；color 为 undefined 时取消 */
  setPlayerColor(name: string, color: Color | undefined): void;
  reset(): void;
}

export function createColorScheme(storage: KeyValueStorage | undefined): ColorScheme {
  const [overrides, setOverrides] = createSignal<Overrides>(readJson(storage, COLOR_SCHEME_KEY, decode, EMPTY));
  const theme = createMemo(() => themeFrom(overrides()));

  const update = (next: Overrides) => {
    setOverrides(next);
    writeText(storage, COLOR_SCHEME_KEY, serialize(next));
  };

  return {
    theme,
    setColor: (key, color) => update({ ...overrides(), colors: { ...overrides().colors, [key]: color } }),
    setStranger: (index, color) => {
      if (index < 0 || index >= DEFAULT_THEME.strangers.length) return;
      update({ ...overrides(), strangers: { ...overrides().strangers, [index]: color } });
    },
    setStrangerColoring: (mode) => update({ ...overrides(), strangerColoring: mode }),
    setPlayerColor: (name, color) => {
      const key = name.trim().toLowerCase();
      if (!key) return;
      const { [key]: _removed, ...rest } = overrides().playerColors;
      update({ ...overrides(), playerColors: color === undefined ? rest : { ...rest, [key]: color } });
    },
    reset: () => update(EMPTY),
  };
}
