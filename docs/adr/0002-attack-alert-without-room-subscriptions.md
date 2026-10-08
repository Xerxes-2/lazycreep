---
status: accepted
---
# Attack Alert 不依赖逐房间 `room:` 订阅

官方 WebSocket 同时订阅多个 `room:` 频道的上限没有任何原始资料记载，官方客户端也只订阅一个。为避免把 Attack Alert 建立在未知限制上，敌情检测的数据来源定为：定期匿名轮询 `/api/experimental/pvp` 与 `/api/experimental/nukes` 并与"我的房间"求交集，加上轻量的 `roomMap2:` 频道（只含每个玩家的坐标点）判断陌生人是否进入我的房间。完整的 `room:` 订阅只给当前正在查看的那一个房间。

## Consequences

- 检测到的是"房间级别发生了战斗 / 有陌生人 / 有核弹"，不是逐对象的伤害事件；更细的判定留给用户打开该房间后的 Room View。
- 2026-10-08 实测证实了上限的存在：一条连接订阅 6 个 `room:` 时，首帧之后大多数 Tick 收到 `subscribe limit reached` 错误；订阅 2 个 `room:` 加 2 个 `roomMap2:` 时 50 Tick 无错（见 `docs/research/screeps-api-facts.md` 第 2 节）。本决策因此不再只是规避未知，而是必需。
- 2026-10-08：这唯一的 `room:` 订阅也只在 Room View 真正在屏幕上时才占着。页面隐藏或切到 World Map 就退订，回来再重新订阅，第一帧到之前先画旧状态。这样做是因为每个标签页、每台设备如果一直占着一个 `room:` 订阅，再加上官方客户端，很快就会收到 `subscribe limit reached`。
