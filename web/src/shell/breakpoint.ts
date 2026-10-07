/**
 * 桌面结构与窄屏结构的断点（#2 起，#24 沿用）：手机、竖屏平板用窄屏结构（Monitor Mode 的承诺范围）。
 */
import { createSignal, onCleanup, type Accessor } from "solid-js";

/** 窄屏：宽度不超过 760px，或竖屏且宽度不超过 1100px（竖屏平板） */
export const NARROW_QUERY = "(max-width: 760px), (orientation: portrait) and (max-width: 1100px)";

/** 跟随媒体查询的信号；需要在 Solid 的 owner 里调用。没有 matchMedia（测试环境）时恒为 false。 */
export function mediaQuery(query: string): Accessor<boolean> {
  let list: MediaQueryList | undefined;
  try {
    list = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(query) : undefined;
  } catch {
    list = undefined;
  }
  const [matches, setMatches] = createSignal(list?.matches ?? false);
  if (list) {
    const media = list;
    const update = () => setMatches(media.matches);
    media.addEventListener("change", update);
    onCleanup(() => media.removeEventListener("change", update));
  }
  return matches;
}
