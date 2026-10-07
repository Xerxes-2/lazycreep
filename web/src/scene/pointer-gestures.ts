/**
 * 画布上的手势：直接用 DOM Pointer Events 与 wheel，不依赖 Pixi 的事件系统
 * （适配层停掉了 Pixi 的全局 ticker，Pixi events 不可靠）。鼠标、触摸、笔同一套逻辑。
 *
 * - 单指 / 鼠标：移动不超过 TAP_SLOP 像素即抬起 → tap；否则 → pan
 * - 双指：两指中点的位移 → pan，两指距离的变化 → 以中点为中心 zoom；之后不再触发 tap
 * - 滚轮：以指针为中心 zoom
 * 坐标都是相对元素左上角的 CSS 像素。
 */

export interface GestureHandlers {
  pan(dx: number, dy: number): void;
  zoom(x: number, y: number, factor: number): void;
  tap(x: number, y: number): void;
  /** 一次平移 / 缩放结束（适合在这里持久化视口） */
  end(): void;
}

const TAP_SLOP = 6;
/** 每像素滚动量对应的缩放指数 */
const WHEEL_RATE = 0.0015;

interface Point {
  x: number;
  y: number;
}

export function attachGestures(el: HTMLElement, handlers: GestureHandlers): () => void {
  const pointers = new Map<number, Point>();
  let start: Point | undefined;
  let moved = false;
  let multi = false;

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pair = (): [Point, Point] | undefined => {
    const [a, b] = [...pointers.values()];
    return a && b ? [a, b] : undefined;
  };

  const onDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = local(event);
    pointers.set(event.pointerId, point);
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // 某些环境（测试、已释放的指针）不支持捕获，忽略
    }
    if (pointers.size === 1) {
      start = point;
      moved = false;
      multi = false;
    } else multi = true;
  };

  const onMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = local(event);
    const before = pair();
    pointers.set(event.pointerId, point);

    if (pointers.size === 1) {
      if (!moved && start && Math.hypot(point.x - start.x, point.y - start.y) <= TAP_SLOP) return;
      const from = moved ? previous : (start ?? previous);
      moved = true;
      handlers.pan(point.x - from.x, point.y - from.y);
      return;
    }
    const after = pair();
    if (!before || !after) return;
    moved = true;
    const mid = (p: [Point, Point]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
    const dist = (p: [Point, Point]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const m0 = mid(before);
    const m1 = mid(after);
    if (m1.x !== m0.x || m1.y !== m0.y) handlers.pan(m1.x - m0.x, m1.y - m0.y);
    const d0 = dist(before);
    const d1 = dist(after);
    if (d0 > 0 && d1 > 0 && d0 !== d1) handlers.zoom(m1.x, m1.y, d1 / d0);
  };

  const onUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size > 0) return;
    if (!moved && !multi && event.type === "pointerup") {
      const point = local(event);
      handlers.tap(point.x, point.y);
    } else if (moved) handlers.end();
    start = undefined;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    if (pixels === 0) return;
    const point = local(event);
    handlers.zoom(point.x, point.y, Math.exp(-pixels * WHEEL_RATE));
    handlers.end();
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("wheel", onWheel);
  };
}
