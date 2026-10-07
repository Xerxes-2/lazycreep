---
status: accepted
---
# 全权限 token，由 Gateway 的 POST 允许名单兜底

赛季服的 HTTP 拒绝任何限定范围 token，连其清单内的端点也返回 401；而客户端必需的 `auth/me`、`game/map-stats`、`POST user/console` 本来也无法授予限定范围 token（见 `docs/research/screeps-api-facts.md` 第 10 节）。因此客户端使用**全权限 token**。为抵消它能改代码、下市场单等能力，Gateway 对 `/api`、`/season/api`、`/ptr/api` **放行全部 GET，只放行允许名单内的 POST**，其余 POST 一律 403。允许名单初始为 `game/map-stats` 与 `user/console`，后续票需要新的写操作时，必须显式加入名单并说明理由。

## Considered Options

- **限定范围 token**：赛季服上没有身份识别、World Map 所有权与 console 命令，核心功能残缺。
- **拒绝名单**：官方新增写接口时会默默漏防；允许名单默认安全。

## Consequences

- 风险与在浏览器里登录官方网页相当：token 只存在用户自己设备的浏览器中，Gateway 不保存，前有 Cloudflare Access。
- WebSocket 由浏览器直连官方，不经 Gateway；官方 WebSocket 协议没有改代码类的写命令，所以不受此名单约束也无妨。
- 名单按路径匹配，而 Caddy 先解码、清理路径再匹配，上游却收到原始路径；所以代理路径上原始路径含编码斜杠（`%2F`）、编码点（`%2E`）或 `.` / `..` 段的请求一律 400，不论方法（Caddyfile 与开发代理一致）。
- 本地开发与录制使用同一 token，存放于被忽略的 `.env.local`。
