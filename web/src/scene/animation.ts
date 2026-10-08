/**
 * 图元动画描述（scene.ts 的 PrimitiveAnimation）的求值：某一时刻各属性的值、总时长、两份描述是否相同。
 * 纯函数，适配层逐帧调用；Scene 构建侧的测试也可以用它算出“某时刻的样子”。
 */
import type { AnimatedProperty, Easing, Primitive, PrimitiveAnimation, Tween } from "./scene.ts";

const EASINGS: Readonly<Record<Easing, (t: number) => number>> = {
  linear: (t) => t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
};

/** 属性的终态：图元自身的值，变换类属性为“没有叠加” */
export function finalValue(p: Primitive, property: AnimatedProperty): number {
  switch (property) {
    case "alpha":
      return p.alpha ?? 1;
    case "trimStart":
      return p.kind === "line" ? (p.trimStart ?? 0) : 0;
    case "trimEnd":
      return p.kind === "line" ? (p.trimEnd ?? 1) : 1;
    case "scale":
      return 1;
    default:
      return 0;
  }
}

export function tweenDuration(tween: Tween): number {
  let total = Math.max(0, tween.delay ?? 0);
  for (const step of tween.steps) total += Math.max(0, step.duration);
  return total;
}

/** 整个动画的时长（毫秒）：最晚结束的那个属性 */
export function animationDuration(animation: PrimitiveAnimation): number {
  let total = 0;
  for (const tween of animation.tweens) total = Math.max(total, tweenDuration(tween));
  return total;
}

/** 开始后 elapsed 毫秒时属性的值；final 是终态（省略 to 的那段的终点，也是播完后的值） */
export function tweenValue(tween: Tween, final: number, elapsed: number): number {
  let t = elapsed - Math.max(0, tween.delay ?? 0);
  let value = tween.from;
  if (t < 0) return value;
  for (const step of tween.steps) {
    const to = step.to ?? final;
    const duration = Math.max(0, step.duration);
    if (t < duration) return value + (to - value) * EASINGS[step.easing ?? "linear"](t / duration);
    t -= duration;
    value = to;
  }
  return tween.steps.length === 0 ? final : value;
}

/** 两份动画描述内容相同（同一个动画，不必重播） */
export function sameAnimation(a: PrimitiveAnimation | undefined, b: PrimitiveAnimation | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
