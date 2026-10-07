import type { MessageKey } from "./zh-CN";

/** 英文词典可缺项，缺失时回退到 zh-CN。 */
export const en: Partial<Record<MessageKey, string>> = {
  "app.title": "Screeps Client",
  "app.tagline": "A light, power-saving personal Screeps client",
  "locale.toggle": "中文",
  "locale.toggleLabel": "Switch language",
};
