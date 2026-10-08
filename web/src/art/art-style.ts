/**
 * Art Style（#42，GLOSSARY）：Room View 用官方贴图还是简约几何图形画房间对象。默认官方。
 * 存 `msc.artStyle`（可导出）；设置在 Menu 的“外观”里。
 */
import { createSignal, type Accessor } from "solid-js";
import { readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export const ART_STYLES = ["official", "geometric"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

export const DEFAULT_ART_STYLE: ArtStyle = "official";

export const ART_STYLE_STORAGE: StoredKey = { key: "msc.artStyle", kind: "json-string", role: "settings" };

export function isArtStyle(value: unknown): value is ArtStyle {
  return (ART_STYLES as readonly unknown[]).includes(value);
}

export interface ArtStyleStore {
  readonly style: Accessor<ArtStyle>;
  setStyle(style: ArtStyle): void;
}

export function createArtStyle(storage: KeyValueStorage | undefined): ArtStyleStore {
  const stored = readJson<ArtStyle>(storage, ART_STYLE_STORAGE.key, (v) => (isArtStyle(v) ? v : undefined), DEFAULT_ART_STYLE);
  const [style, setSignal] = createSignal<ArtStyle>(stored);
  return {
    style,
    setStyle(next) {
      setSignal(next);
      writeJson(storage, ART_STYLE_STORAGE.key, next);
    },
  };
}
