import { createSignal, type Accessor } from "solid-js";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./translator";

const STORAGE_KEY = "msc.locale";

export type LocaleStorage = Pick<Storage, "getItem" | "setItem">;

export interface LocaleStore {
  locale: Accessor<Locale>;
  setLocale: (locale: Locale) => void;
}

function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

function readStored(storage: LocaleStorage | undefined): Locale {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** 界面语言：选择会写入浏览器本地存储，刷新后保留；存储不可用时仅在内存中生效。 */
export function createLocale(storage: LocaleStorage | undefined): LocaleStore {
  const [locale, setSignal] = createSignal<Locale>(readStored(storage));
  const setLocale = (next: Locale) => {
    setSignal(next);
    try {
      storage?.setItem(STORAGE_KEY, next);
    } catch {
      // 隐私模式等场景下存储不可用，语言切换仍在本次会话内生效。
    }
  };
  return { locale, setLocale };
}
