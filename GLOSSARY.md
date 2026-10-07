# my-screeps-client

自用的 Screeps 第三方客户端：轻快、省电、可自定义，覆盖桌面与移动端。本词表只定义本项目特有的概念。

## Language

### 服务器与数据来源

**Server（服务器）**:
一个独立的 Screeps 游戏实例，有自己的 API 根路径。本项目支持三种：Season（赛季服）、MMO（官方主服）、Private（私服）。
_Avoid_: 环境、后端

**Shard**:
Server 内部的一个独立世界，MMO 有多个（shard0–3），Season 与 Private 通常只有一个。
_Avoid_: 分区、分片

**Tick**:
游戏世界的最小时间单位；所有即时数据与历史数据都按 Tick 编号。

**Gateway（网关）**:
部署在用户自己服务器上的无状态同源代理，托管前端并转发 HTTP 请求到 Server；不持有 token，不经手 WebSocket。
_Avoid_: 后端、服务端、代理服务器

### 视图

**World Map（世界地图）**:
一个 Shard 内所有房间的俯瞰视图，以房间为格子，显示地形缩略图、所有权、RCL、矿物、Power Bank、新手区 / 禁区以及 PvP 热点。
_Avoid_: 大地图、全图

**Room View（房间视图）**:
单个房间内部的逐 Tick 渲染视图，可以是即时的，也可以是回放的。
_Avoid_: 房间画面、房间渲染

**Live（即时）**:
Room View 的一种模式：跟随服务器当前 Tick 实时更新。
_Avoid_: 实时、在线

**Replay（历史回放）**:
Room View 的另一种模式：读取某个房间的历史 Tick 序列，可拖动、步进、调速播放。第一版只做单房间 Replay。
_Avoid_: 录像、回放视频

**Console（控制台）**:
查看自己脚本的日志输出并向其发送命令的面板。

**PvP Overview（PvP 一览）**:
列出最近若干 Tick 内发生过战斗的房间及涉及玩家，可点击跳转到对应 Room View。
_Avoid_: 战斗列表、战争地图

**Attack Alert（遇袭通知）**:
自己拥有的房间出现敌对行为时推送给用户的通知。
_Avoid_: 警报、提醒

**Ally List（盟友名单）**:
用户手动维护的玩家名单，用于着色与 PvP Overview 的归类。第一版不自动导入。
_Avoid_: 联盟、好友

### 使用方式

**Monitor Mode（监控模式）**:
手机与平板上的定位：只保证 World Map、Room View、Replay、Console、PvP Overview 可用且触摸友好，不承诺其他功能。
_Avoid_: 移动版、精简版
