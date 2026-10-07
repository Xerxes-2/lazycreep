export const LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";

/** zh-CN 是完整词典；其他语言可缺项，缺失时回退到 zh-CN。 */
export type Dictionaries<K extends string> = {
  "zh-CN": Record<K, string>;
} & { [L in Exclude<Locale, "zh-CN">]: Partial<Record<K, string>> };

export type TranslateParams = Record<string, string | number>;
export type Translate<K extends string> = (key: K, params?: TranslateParams) => string;

export function createTranslator<K extends string>(
  dictionaries: Dictionaries<K>,
  locale: Locale,
): Translate<K> {
  const primary: Partial<Record<K, string>> = dictionaries[locale];
  const fallback = dictionaries[DEFAULT_LOCALE];
  return (key, params) => {
    const template = primary[key] ?? fallback[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      return value === undefined ? match : String(value);
    });
  };
}
