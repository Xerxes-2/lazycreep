/**
 * Ally List：手动维护的盟友玩家名（spec #1）。存在浏览器本地，所有 Server 共用一份。
 * 同一份名单驱动 World Map 与 Room View 的着色（relationOf 不分大小写比较用户名），
 * 后续 PvP 归类也用它。
 */
import { createSignal, type Accessor } from "solid-js";
import type { SettingsStorage } from "../settings/settings.ts";

const STORAGE_KEY = "msc.allies";

export interface AllyList {
  /** 按添加顺序 */
  readonly names: Accessor<readonly string[]>;
  /** 同一份名单的集合形式，交给着色规则 */
  readonly set: Accessor<ReadonlySet<string>>;
  /** 去掉首尾空白后添加；空名或已有（不分大小写）时不变，返回 false */
  add(name: string): boolean;
  remove(name: string): void;
}

function read(storage: SettingsStorage | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
  } catch {
    return [];
  }
}

export function createAllyList(storage: SettingsStorage | undefined): AllyList {
  const [names, setNames] = createSignal<readonly string[]>(read(storage));

  const save = (next: readonly string[]) => {
    setNames(next);
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用时本次会话内仍生效
    }
  };

  let cached: { readonly from: readonly string[]; readonly set: ReadonlySet<string> } | undefined;
  const set = () => {
    const current = names();
    if (cached?.from !== current) cached = { from: current, set: new Set(current) };
    return cached.set;
  };

  return {
    names,
    set,
    add(name) {
      const trimmed = name.trim();
      const lower = trimmed.toLowerCase();
      if (!trimmed || names().some((n) => n.toLowerCase() === lower)) return false;
      save([...names(), trimmed]);
      return true;
    },
    remove(name) {
      save(names().filter((n) => n !== name));
    },
  };
}
