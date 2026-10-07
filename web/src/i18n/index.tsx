import { createContext, createEffect, createMemo, useContext, type Accessor, type ParentProps } from "solid-js";
import { en } from "./dict/en";
import { zhCN, type MessageKey } from "./dict/zh-CN";
import { createLocale, type LocaleStorage } from "./locale";
import { createTranslator, type Dictionaries, type Locale, type Translate } from "./translator";

export type { Locale, MessageKey };
export { LOCALES } from "./translator";

const dictionaries: Dictionaries<MessageKey> = { "zh-CN": zhCN, en };

interface I18n {
  locale: Accessor<Locale>;
  setLocale: (locale: Locale) => void;
  t: Translate<MessageKey>;
}

const I18nContext = createContext<I18n>();

function browserStorage(): LocaleStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** 提供界面语言与翻译函数；同步 `<html lang>`。 */
export function I18nProvider(props: ParentProps<{ storage?: LocaleStorage }>) {
  const { locale, setLocale } = createLocale(props.storage ?? browserStorage());
  const translator = createMemo(() => createTranslator(dictionaries, locale()));
  const t: Translate<MessageKey> = (key, params) => translator()(key, params);

  createEffect(() => {
    document.documentElement.lang = locale();
  });

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error("useI18n must be used inside <I18nProvider>");
  return i18n;
}
