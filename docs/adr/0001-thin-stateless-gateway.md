---
status: accepted
---
# 薄的无状态 Gateway，浏览器直连 WebSocket

screeps.com 的 HTTP API 与 room-history 文件不返回 CORS 头，浏览器页面无法跨域请求；WebSocket 握手则接受任意 Origin（见 `docs/research/screeps-api-facts.md` 第 8 节）。因此纯浏览器单体不成立。我们选择一个**无状态的 Gateway**：托管前端静态文件，并把 `/api`、`/season/api`、`/room-history` 同源反向代理到 screeps.com，并把官方 CDN 上的地图瓦片图同样代理为同源（WebGL 纹理需要 CORS），不存任何状态、不持有 token；token 只保存在浏览器中，随请求头经 Gateway 转发。WebSocket 由浏览器直连官方服务器，不经 Gateway。

## Considered Options

- **厚 Gateway**：服务端持有 token、统一维护一条上游 WebSocket 并向各设备分发。能做应用关闭时的 Attack Alert 推送与多设备设置同步，但引入有状态服务与自建认证。第一版不需要这两项，故不选；检测敌情的逻辑写成独立模块，日后可迁入服务端。
- **原生壳（Tauri / Capacitor）绕过 CORS**：无法以 PWA 形式覆盖 iPadOS，且四个平台各需打包，成本过高。

## Consequences

- 第一版 Gateway 可以零代码：一份反向代理配置即可。
- 访问控制必须放在 Gateway 之前（见部署决策），否则任何人都能借它当代理。
