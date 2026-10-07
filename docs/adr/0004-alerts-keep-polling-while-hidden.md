---
status: accepted
---
# Attack Alert 需要时，页面隐藏也继续轮询 PvP 与核弹

#3 的验收要求 PvP 与核弹列表的轮询在页面不可见时暂停（#14 的省电规则）。但 Attack Alert（#4）正是在用户切走标签页、最小化窗口时最有用：系统通知要靠这份数据触发。因此在**有 token 且 PvP 或核弹告警条件至少开了一个**时，PvP feed 在页面隐藏后照常每 10 秒轮询（`alert/keep-awake.ts` 的 `visibleOrKept`，接在 `map/MapAndRoom.tsx`）；两个条件都关掉、或没有 token 时，回到“不可见即暂停”。陌生人检测用的 `roomMap2:` 订阅同理声明 `keepWhileHidden`。

## Consequences

- 隐藏期间的开销是每 10 秒一对匿名 GET（`experimental/pvp`、`experimental/nukes`），不渲染任何东西；这是 #3「不可见时暂停」的有意例外，不是回归。
- 想要完全省电的用户关掉 PvP 与核弹告警即可恢复暂停。
