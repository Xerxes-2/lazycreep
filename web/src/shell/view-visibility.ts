/**
 * 视图的可见性（#2 起，#24 沿用）：页面可见且该视图显示在屏幕上（例如是当前的 Main View 模式）。
 * 交给按 VisibilitySignal 暂停渲染的组件（Room View、World Map），隐藏的视图不再构建 Scene。
 */
import { createEffect, type Accessor } from "solid-js";
import { manualVisibility, type VisibilitySignal } from "../power/visibility.ts";

/** 需要在 Solid 的 owner 里调用（用 effect 跟踪 shown）。 */
export function shownVisibility(page: VisibilitySignal, shown: Accessor<boolean>): VisibilitySignal {
  const view = manualVisibility(shown());
  createEffect(() => view.set(shown()));
  const visible = () => page.visible() && view.visible();
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
      const offView = view.subscribe(update);
      return () => {
        offPage();
        offView();
      };
    },
  };
}
