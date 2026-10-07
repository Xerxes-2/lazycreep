import { createSignal, type Accessor } from "solid-js";
import { readText, writeText, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./translator";

const STORAGE_KEY = "msc.locale";
export const LOCALE_STORAGE: StoredKey = { key: STORAGE_KEY, kind: "raw", role: "settings" };

export interface LocaleStore {
  locale: Accessor<Locale>;
  setLocale: (locale: Locale) => void;
}

function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

function readStored(storage: KeyValueStorage | undefined): Locale {
  const stored = readText(storage, STORAGE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

/** 界面语言：选择会写入浏览器本地存储，刷新后保留；存储不可用时仅在内存中生效。 */
export function createLocale(storage: KeyValueStorage | undefined): LocaleStore {
  const [locale, setSignal] = createSignal<Locale>(readStored(storage));
  const setLocale = (next: Locale) => {
    setSignal(next);
    writeText(storage, STORAGE_KEY, next);
  };
  return { locale, setLocale };
}
