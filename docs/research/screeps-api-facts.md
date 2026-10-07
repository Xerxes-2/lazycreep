# Screeps public API facts for a third-party client

Researched 2026-10-08 by a background agent. Sources: official docs, screepers/node-screeps-api (TS source, pushed 2026-10-05), screeps/renderer, live anonymous probes of screeps.com. "Observed" = live probe, not documentation.

## 1. Authentication & rate limits
- Token in `X-Token` header; "A token with full access will have the same access scope as your usual authentication credentials." Tokens can be scoped to specific endpoints, websocket events, memory segments. https://docs.screeps.com/auth-tokens.html
- Email/password auth disabled on official servers since 2018-02-01; password auth only on private servers. https://github.com/screepers/node-screeps-api/blob/master/guides/servers.md
- Documented limits: global **120/min**. Per endpoint: GET room-terrain 360/h; POST map-stats 60/h; GET user/code 60/h; POST user/code 240/day; POST set-active-branch 240/day; GET user/memory 1440/day; POST user/memory 240/day; GET memory-segment 360/h; POST memory-segment 60/h; POST user/console 360/h; market endpoints 60/h; GET money-history 60/h. 429 responses carry `x-ratelimit-*` headers only for endpoint limits; per-token manual reset page `/a/#!/account/auth-tokens/noratelimit`. https://github.com/screepers/node-screeps-api/blob/master/guides/rate-limits.md
- Dev forum: a proposed WS session timeout (1h, then 15s sessions/60s reconnect) was discussed but not confirmed as shipped. https://screeps.com/forum/post/9175
- **No documented WebSocket rate limit.** A 2016 forum thread mentions a per-user cap on active subscriptions ("too many tabs open" after ~2000 subs), unspecified. https://screeps.com/forum/topic/348/web-socket-subscriptions-don-t-close-properly
- Observed anonymous (no token) MMO endpoints returning data: `GET /api/version`, `/api/game/time`, `/api/game/shards/info`, `/api/game/world-size`, `/api/game/room-terrain`, `/api/game/room-objects`, `/api/experimental/pvp`, `/api/experimental/nukes`, `/api/user/find?username=`, `/api/leaderboard/list`. Observed `unauthorized` without token: `/api/user/memory`, `/api/game/map-stats` (POST), `/api/game/room-status`, `/api/game/market/*`, `/api/user/overview`, `/api/auth/me`, `/api/user/messages/index`.
- `/api/version` serverData includes `historyChunkSize: 100`, `protocol: 14`.
- WebSocket auth: client sends `auth <token>`; server replies `auth ok <token>`. Observed: an anonymous connection receives only `time`, `protocol`, `package` frames; `subscribe room:shard3/E0N0` without auth delivered nothing in 30 s (anonymous room streaming appears unsupported). https://github.com/screepers/node-screeps-api/blob/master/src/ScreepsSocketClient.ts

## 2. WebSocket protocol
- URL: `wss://screeps.com/socket/websocket` (raw WS; official client uses SockJS at `/socket/`). Text frames. Commands: `auth <token>`, `subscribe <channel>`, `unsubscribe <channel>`, `gzip on|off`. Server frames: `time <ms>`, `protocol 14`, `package N`, `auth ok <token>`; event frames are JSON arrays `["<channel>", <payload>]`; with gzip on, frames are `gz:<base64 zlib>`.
- Channels: `room:<shard>/<room>`, `roomMap2:<shard>/<room>`, `mapVisual:<userId>/<shard>`, `user:<id>/console`, `/cpu`, `/money`, `/resources`, `/code`, `/set-active-branch`, `/newMessage`, `/message:<otherUserId>`, `/memory/<shard>/<path>`, `/steam-purchase`. Shardless private servers omit `<shard>/`. https://github.com/screepers/node-screeps-api/blob/master/src/socket/user.ts
- Room payload: `{gameTime, info:{mode}, objects:{id: obj|null}, users:{...}, visual}`; first event full, subsequent events only modified properties; `null` = object gone. `roomMap2` payload `{w,r,pb,p,s,c,m,k,<userId>:[[x,y],...]}`. https://github.com/screepers/node-screeps-api/blob/master/src/socket/base.ts
- Simultaneous room-subscription cap: **not found in any primary source**; official client subscribes one `room:` plus `roomMap2:` tiles. The "~2 rooms" claim is unverified.

## 3. Season server
- Base `https://screeps.com/season/api/...`; shard name `shardSeason` (observed). `/season/api/game/time` requires `?shard=shardSeason`. PTR at `/ptr/`.
- WebSocket presumably `wss://screeps.com/season/socket/websocket` (inferred, not probed).
- Same token for season and MMO: very likely (python-screeps uses `prefix="/season"` with the same token), unverified.

## 4. Room history
- URL `https://screeps.com/room-history/<shard>/<room>/<base>.json`, base = `floor(tick/100)*100`. Served gzip, `cache-control: max-age=315360000`. **No token needed** (observed anonymous 200). Non-aligned base -> 404.
- JSON `{timestamp, room, base, ticks:{"<tick>": {...}}}`; first tick full objects by id, subsequent ticks per-object diffs.
- Retention (observed): shard3 ~200k ticks (≈ 8–9 days); season between 300k and 400k ticks.
- Season history: `https://screeps.com/room-history/shardSeason/<room>/<base>.json` (observed 200); `/season/room-history/...` -> 404. Official client route `#!/history/:shard/:room?t=`; season also has `seasons/replay/<code>` shares.
- Private servers: `GET /room-history?room=&time=`.

## 5. PvP / map feeds
- `GET /api/experimental/pvp?interval=N` -> `{ok:1, pvp:{<shard>:{time, rooms:[{_id, lastPvpTime}]}}}`, sorted desc. Anonymous OK; season via `/season/api/experimental/pvp` -> `shardSeason`. https://github.com/screepers/node-screeps-api/blob/master/src/http/experimental.ts
- `GET /api/experimental/nukes` -> `{nukes:{<shard>:[{_id,type,room,x,y,landTime,launchRoomName}]}}`; also on season.
- `POST /api/game/map-stats {rooms, statName, shard}` (token, 60/h). statName: `owner0`, `claim0`, `<stat>8|180|1440` for creepsLost, creepsProduced, energyConstruction, energyControl, energyCreeps, energyHarvested, powerProcessed. Response per room: `own:{user,level}`, `sign`, `hardSign`, `status`, `<statName>:{user,value}`, plus `users`.
- No dedicated "battles now" endpoint. Community precedent: daboross/screeps-warreport, ScreepsSC battle radar.

## 6. Renderer & ecosystem
- screeps/renderer: ISC license, packages `@screeps/renderer` + `@screeps/renderer-metadata` v1.6.10, PixiJS ^7.4.2; `metadata/images/` holds 126 SVG sprites in the same ISC repo ("the same renderer code and images we use in our official game client"); no separate asset license. Last push 2026-08-21. https://github.com/screeps/renderer
- Tools: screepers/screeps-steamless-client (TS web proxy for the Steam client); screepers/screeps-launcher; screepers/node-screeps-api; python-screeps; shanemadden/screeps-rest-api (Rust); screepers/screeps-world-openapi; HoPGoldy/screeps-world-printer (TS, MIT, map images); keeshii/screeps-client (PIXI, mobile/Cordova, F-Droid); ricochet1k/screeps-client (2019); pieterbrandsen/screeps-client (SolidJS+PixiJS+Tauri, ISC, active); daboross/screeps-rs; Screeps3D (Unity); laverdet/xxscreeps (TS server reimplementation with history mod); wtfrank/screeps-browser-extension-replays; screepers/Screeps-SC. https://docs.screeps.com/third-party.html

## 7. Official client feature inventory
World map (`/map/:shard`), room view, history replay, overview + per-room/power overview, market, messages, rank/leaderboard, profile, shards list, sim (tutorial/survival/custom), seasons (score/rating/chronicle/archive), CPU/stats, inventory (decorations), account settings, register/recover/sso, respawn/first-spawn placement, editor/branches (Ace), console, memory (jsoneditor), flags, display options, report-problem.

## 8. CORS (observed 2026-10-08, curl with `Origin: https://example.com`)
- HTTP API (`/api/*`, `/season/api/*`) and `room-history/*` return **no `Access-Control-Allow-*` headers** on GET or OPTIONS preflight. A browser page on a foreign origin therefore cannot fetch them directly; a same-origin proxy (or a non-browser shell such as Tauri/Capacitor) is required.
- WebSocket handshake at `wss://screeps.com/socket/websocket` and `wss://screeps.com/season/socket/websocket` returns **101 Switching Protocols** with a foreign `Origin`, so browsers can connect to the WebSocket directly without a proxy.

## 9. World map terrain tiles (observed 2026-10-08)
- `/api/game/room-terrain` is limited to 360/h, far too few for a whole shard. The official client uses pre-rendered PNG tiles on the Screeps CDN instead:
  - Per room: `https://d3os7yery2usni.cloudfront.net/map/<shard>/<room>.png` (200 for `shard3/E0N0`, `shardSeason/E0N0`; ~0.5–1 KB each).
  - Zoomed blocks: `https://d3os7yery2usni.cloudfront.net/map/<shard>/zoom2/<room>.png`, keyed by the block's corner room (`shardSeason/zoom2/E0S0` -> 200, ~10 KB; `E0N0`/`W0N0` -> 403, i.e. not a block corner).
  - `https://screeps.com/assets/map/...` redirects to the store; not a valid path.
- **No CORS headers** on the CDN. `<img>` usage works cross-origin, but WebGL textures need CORS, so the Gateway must proxy the CDN path as well.
