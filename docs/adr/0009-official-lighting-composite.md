---
status: accepted
---
# 照官方合成光照：光照图以正片叠底盖住地形与对象

ADR 0006 引入官方美术时，光照用了近似：环境光（0x808080）与墙阴影只预先乘进地形与道路，对象保持原色，大 glow 以加色混合叠在对象之上，小 glow 与 creep 遮罩不画（`official-lighting.ts` 的 GLOW_GAIN 取舍）。用户对照官方客户端发现 creep 与建筑整体“泛白”：官方的光照图（0x808080 底色 + 各 glow 以 SCREEN 合成）以 MULTIPLY 盖住 terrain 与 objects 图层，没被照到的对象亮度减半，自带遮罩或小 glow 的对象保持原色，glow 最多把亮度提回原色、不会更亮；我们的近似让所有对象保持原色、靠近 glow 时更亮。我们改为照官方合成：Scene 里有一个光照组，适配层把它画成一个以 MULTIPLY 混合的容器（Pixi v8 原生支持 multiply / screen），放在对象之上、effects（rampart、工地、闪光）之下。

## Considered Options

- **整体把对象调暗一个固定比例**：改动小，但靠近光源与自带光晕的对象都不对。
- **维持近似**：与官方观感差距明显，是用户提出的问题本身。

## Consequences

- 部分取代 ADR 0006 的近似：光照打开时，地形 SVG 不再预乘环境光与墙阴影，道路颜色不再预乘；关闭光照时维持现有的地形预乘。
- 小 glow 与对象遮罩（creep-mask 等）恢复，按官方 alpha 原样使用，GLOW_GAIN 作废；遮罩随移动补间与动作动画移动。
- 光照只在本来就要画的帧里多一次离屏合成，不增加帧数（ADR 0008）。
