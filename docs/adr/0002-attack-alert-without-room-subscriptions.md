---
status: accepted
---
# Attack Alert 不依赖逐房间 `room:` 订阅

官方 WebSocket 同时订阅多个 `room:` 频道的上限没有任何原始资料记载，官方客户端也只订阅一个。为避免把 Attack Alert 建立在未知限制上，敌情检测的数据来源定为：定期匿名轮询 `/api/experimental/pvp` 与 `/api/experimental/nukes` 并与"我的房间"求交集，加上轻量的 `roomMap2:` 频道（只含每个玩家的坐标点）判断陌生人是否进入我的房间。完整的 `room:` 订阅只给当前正在查看的那一个房间。

## Consequences

- 检测到的是"房间级别发生了战斗 / 有陌生人 / 有核弹"，不是逐对象的伤害事件；更细的判定留给用户打开该房间后的 Room View。
- 若日后实验证明多房间订阅无上限，可以在不改变告警语义的前提下换数据源。
