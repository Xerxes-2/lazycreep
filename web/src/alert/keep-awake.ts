/**
 * “页面可见，或者有理由保持清醒”的可见性信号：给 PvP feed 的轮询用。
 * Attack Alert 需要 PvP / 核弹条件时，页面隐藏也继续轮询（系统通知在那时最有用）；
 * 两个条件都关掉后恢复 #14 的规则：隐藏即暂停。
 */
import { createEffect, type Accessor } from "solid-js";
import { manualVisibility, type VisibilitySignal } from "../power/visibility.ts";

/** 需要在 Solid 的 owner 里调用（用 effect 跟踪 keep）。 */
export function visibleOrKept(base: VisibilitySignal, keep: Accessor<boolean>): VisibilitySignal {
  const kept = manualVisibility(keep());
  createEffect(() => kept.set(keep()));
  const visible = () => base.visible() || kept.visible();
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
      const offBase = base.subscribe(update);
      const offKept = kept.subscribe(update);
      return () => {
        offBase();
        offKept();
      };
    },
  };
}
