---
status: accepted
---
# 照官方客户端的固定外壳取代可拖拽网格停靠

#2 实现了 12 列可拖拽、可缩放的网格停靠布局，桌面与 Monitor Mode 各存一套。验收时发现：World Map 与 Room View 并排后两者都太小看不清，页面需要滚动，常用与不常用功能平铺在一起（#19、#20、#21）。我们改为照官方客户端的**固定外壳**（见 `docs/research/official-client-layout.md`）：页面不滚动；Top Bar 左端打开 Menu 收纳各类设置；Main View 独占，在 World Map 与 Room View 之间按键切换；右侧 Sidebar 由可折叠的 Sidebar Section 叠成、整条可收起；底部是可收起的 Console Panel。可定制范围缩小为各区块的折叠状态、Sidebar 与 Console Panel 的开合和高度。

与官方的一处有意偏离：Sidebar **挤压** Main View 而不是浮在其上，避免遮住房间右侧。窄屏上官方不做适配，我们让 Sidebar 变为底部半屏面板、区块变为标签。

## Considered Options

- **保留网格停靠、只改默认布局**：并排的根本问题仍在，用户仍需自己拖出可用布局。
- **图标窄条 + 单个抽屉（类似 VS Code）**：访谈第一轮曾选定，看到官方布局后改为官方式，因为用户的诉求是“像官方客户端”，且官方允许多个区块同时展开。

## Consequences

- #2 的网格、拖拽、缩放与 `msc.layout.desktop` / `msc.layout.monitor` 两套布局存储将被删除，启动时直接清除旧键，不迁移。
- #5 的数字键面板快捷键作废，用户已保存的自定义键位回到新默认。
- #12 的房间边缘箭头由 Minimap 取代。
