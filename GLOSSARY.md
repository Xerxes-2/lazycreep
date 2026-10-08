# lazycreep

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

**Main View（主视图）**:
占满边栏以外全部区域的唯一视图区，任一时刻只显示 World Map 或 Room View 其中之一。
_Avoid_: 主面板、地图区

**Top Bar（顶栏）**:
屏幕顶端的细条，左端是打开 Menu 的按钮。
_Avoid_: 标题栏

**Sidebar（侧栏）**:
Main View 右侧的竖条，由若干 Sidebar Section 叠成，内容随 Main View 显示的是 World Map 还是 Room View 而不同，整条可收起。
_Avoid_: 边栏、活动栏

**Sidebar Section（侧栏区块）**:
Sidebar 中一个带标题、可单独折叠的区块，例如房间信息、Minimap、选中对象、PvP Overview。
_Avoid_: 侧栏卡片

**Menu（菜单）**:
从 Top Bar 左端打开、从左侧滑出的层，收纳不常用功能（各类设置）；同一时刻只显示一项，内容在其内部滚动。
_Avoid_: 二级菜单、汉堡菜单

**Console Panel（控制台面板）**:
Main View 底部可收起、可调高度的区域，承载 Console。
_Avoid_: 底栏

**Minimap（小地图）**:
Room View 下的一个 Sidebar Section，显示以当前房间为中心的 3×3 房间缩略图，可点击切换到相邻房间。
_Avoid_: 迷你地图、导航图

**Room View（房间视图）**:
单个房间内部的逐 Tick 渲染视图，可以是即时的，也可以是回放的。
_Avoid_: 房间画面、房间渲染

**Live（即时）**:
Room View 的一种模式：跟随服务器当前 Tick 实时更新。
_Avoid_: 实时、在线

**Replay（历史回放）**:
Room View 的另一种模式：读取某个房间的历史 Tick 序列，可拖动、步进、调速播放。第一版只做单房间 Replay。
_Avoid_: 录像、回放视频

**Action Animation（动作动画）**:
对象在某个 Tick 内执行的动作（攻击、治疗、采集、建造等）以及受到的攻击与治疗，在 Room View 中以有限时长的视觉效果呈现，播完回到静止画面。
_Avoid_: 特效、战斗动画

**Movement Tween（移动补间）**:
Room View 中 creep 在两个 Tick 之间从旧位置平滑移到新位置的过渡。
_Avoid_: 移动动画、插帧

**Decoration（装饰）**:
挂在房间上的外观设置，改变 Room View 中地形（墙、地面、沼泽、道路）的颜色与图案，或替换某类对象的贴图；赛季服对全世界的房间统一下发一套，主服由玩家给自己的房间挂。
_Avoid_: 皮肤

**Room Snapshot（房间快照）**:
某一刻房间里的全部对象，不带 Tick；Live 换房间时在订阅的第一帧到达前先画它，第一帧到达后整体替换。只在内存里短暂保留，不持久化。
_Avoid_: 房间缓存

**Badge（徽章）**:
玩家在某个 Server 上设置的圆形标识，由类型、三种颜色、形变参数与翻转决定；同一玩家在不同 Server 上可以不同。
_Avoid_: 徽标、队徽

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
窄屏（手机、竖屏平板）上承诺可用的功能范围：World Map、Room View、Replay、PvP Overview 可用且触摸友好；不是一套单独的布局。
_Avoid_: 移动版、精简版
