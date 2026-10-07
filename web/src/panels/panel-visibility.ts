/**
 * 面板内容的可见性（#2）：页面可见且面板显示在屏幕上（Monitor Mode 下是当前标签）。
 * 交给按 VisibilitySignal 暂停渲染的组件（Room View、World Map），隐藏的标签不再构建 Scene。
 */
import { createEffect, type Accessor } from "solid-js";
import { manualVisibility, type VisibilitySignal } from "../power/visibility.ts";

/** 需要在 Solid 的 owner 里调用（用 effect 跟踪 shown）。 */
export function panelVisibility(page: VisibilitySignal, shown: Accessor<boolean>): VisibilitySignal {
  const panel = manualVisibility(shown());
  createEffect(() => panel.set(shown()));
  const visible = () => page.visible() && panel.visible();
  return {
    visible,
    subscribe(listener) {
      let last = visible();
      const update = () => {
        const next = visible();
        if (next === last) return;
        last = next;
        listener(next);
      };
      const offPage = page.subscribe(update);
      const offPanel = panel.subscribe(update);
      return () => {
        offPage();
        offPanel();
      };
    },
  };
}
