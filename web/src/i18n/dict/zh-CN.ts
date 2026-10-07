/** 完整词典：所有界面文案的键以此为准。 */
export const zhCN = {
  "app.title": "Screeps 客户端",
  "app.tagline": "轻快、省电的自用 Screeps 客户端",
  "locale.toggle": "English",
  "locale.toggleLabel": "切换界面语言",
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof zhCN;
