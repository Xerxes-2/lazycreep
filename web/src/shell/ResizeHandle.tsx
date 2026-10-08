/**
 * 面板前沿的拖动手柄（#30）：Console Panel 的上边缘、Sidebar 的左边缘。
 * 用 Pointer Events 拖动，往外拖（上 / 左）面板变大；也可聚焦后用方向键调。尺寸经 resize 交给外壳状态持久化。
 */
import type { JSX } from "solid-js";

/** 方向键每按一次调整的尺寸（CSS 像素） */
const KEY_STEP = 20;

export interface ResizeHandleProps {
  readonly class: string;
  readonly action: string;
  readonly label: string;
  /** horizontal：上边缘，调高度；vertical：左边缘，调宽度 */
  readonly orientation: "horizontal" | "vertical";
  readonly range: { readonly min: number; readonly max: number };
  /** 存下的尺寸；undefined 时按 measure 的实际尺寸 */
  readonly value: () => number | undefined;
  /** 面板此刻实际显示的尺寸（样式可能把存下的尺寸压低） */
  readonly measure: () => number;
  resize(px: number): void;
  /** 双击手柄 */
  onReset?(): void;
}

export function ResizeHandle(props: ResizeHandleProps): JSX.Element {
  const vertical = () => props.orientation === "vertical";
  const coord = (event: PointerEvent) => (vertical() ? event.clientX : event.clientY);
  const current = () => {
    const shown = props.measure();
    return shown > 0 ? shown : (props.value() ?? props.range.min);
  };
  let drag: { readonly pointerId: number; readonly start: number; readonly startSize: number } | undefined;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, start: coord(event), startSize: current() };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // jsdom 等环境不支持捕获时，仍按普通 move 处理
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // 手柄在前沿：往上 / 往左拖，面板变大
    props.resize(drag.startSize + (drag.start - coord(event)));
  };
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = undefined;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // 同上
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const [grow, shrink] = vertical() ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const delta = event.key === grow ? KEY_STEP : event.key === shrink ? -KEY_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    props.resize((props.value() ?? current()) + delta);
  };

  return (
    <div
      class={props.class}
      data-action={props.action}
      role="separator"
      tabindex="0"
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-valuemin={props.range.min}
      aria-valuemax={props.range.max}
      aria-valuenow={props.value()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDblClick={() => props.onReset?.()}
    />
  );
}
