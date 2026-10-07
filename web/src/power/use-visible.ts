import { createSignal, onCleanup, type Accessor } from "solid-js";
import { pageVisibility, type VisibilitySignal } from "./visibility.ts";

/** 在 Solid 组件里读页面可见性；组件销毁时自动退订。 */
export function useVisible(signal: VisibilitySignal = pageVisibility()): Accessor<boolean> {
  const [visible, setVisible] = createSignal(signal.visible());
  onCleanup(signal.subscribe(setVisible));
  return visible;
}
