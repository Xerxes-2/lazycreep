---
status: accepted
---
# 官方美术以贴图进入我们的 Scene，不嵌入官方渲染器

用户希望 Room View 使用官方美术。官方渲染器（screeps/renderer，ISC）可以直接嵌入，但它内置一份 PixiJS v7（与我们的 v8 并存需要第二个 WebGL 上下文与画布，JS 传输量增加约 209 KB gzip），并自建每帧渲染循环与常驻空闲动画、隐藏页面时也不停，与本项目“轻快、省电、无新 Tick 不重绘”的核心目标冲突（事实见 `docs/research/official-art-and-badges.md`）。我们选择只复用其 ISC 许可的 SVG / PNG 资源，作为 `image` 等图元进入现有的纯数据 Scene 与按需渲染的 Pixi v8 适配层；墙与道路的合并轮廓、creep 身体环、按资源量缩放等效果参照其 ISC 源码重写为 Scene 构建逻辑。不做补间与常驻动画。

## Considered Options

- **整体嵌入官方渲染器**：最像官方、实现最快，但违背省电与体积目标；要省电只能从外部强停其 ticker 与定时器，脆弱。
- **把官方渲染器移植到 Pixi v8**：可行，但需长期维护 fork（`@pixi/layers` 等 v7 专属依赖需替换）。

## Consequences

- 画面停在每个 Tick 的状态，没有 creep 移动补间与沼泽流动等动画。（已由 ADR 0008 取代：允许有界动画，仍无常驻循环）
- 简约几何画风保留为 Art Style 的另一选项，新对象类型需要两套画法。（已由 ADR 0007 取代）
- 再分发官方资源需附上其 LICENSE（ISC）。
