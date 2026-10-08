# 官方房间美术与玩家徽章：调研事实（2026-10-08）

方法：只读。浅克隆 `github.com/screeps/renderer`（commit `a2db4a7`，2026-08-21），下载 npm tarball，GET 官方客户端静态文件（`https://screeps.com/a/...`）与匿名 API。没有登录，没有发送 POST 或控制台命令。下文 `renderer/` 指该仓库，`official/` 指从 `https://screeps.com/a/` 下载的文件。

## A. 官方房间美术

### A1. 架构与驱动方式
- **公开 API**（`renderer/engine/main.d.ts` 19–55）：`new GameRenderer({size, worldConfigs, resourceMap, autoStart?, logger?, objectFilter?, onGameLoop?, countMetrics?})`，然后是 `init(containerEl): Promise`、`setTerrain(terrainObjects)`、`applyState(state, tickDuration)`、`resize({width,height})`，以及 `zoomLevel` setter、`pan(x,y)`、`zoomTo(v,x,y)`、`setDecorations(items)`、`erase()`、`release()`（销毁）、`start()`。实现见 `renderer/engine/src/lib/GameRenderer.js` 83–255。
- **输入格式**：`state = {objects:[ObjectState], users:{<id>:{username,badge,...}}, gameTime}`；ObjectState 至少要有 `type,_id,room,x,y`（`main.d.ts` 446–456）。官方客户端**每次都传完整对象数组**，不传 diff。它先把 `room:` 流的 diff 合并到 `Room.objects`，再调用 `d.applyState({objects:_.cloneDeep(Room.objects)(+flags), users:Room.users, gameTime}, tickDuration)`，并用 `_.throttle(...,100)` 节流（`official/build.min.js`，搜 `.applyState(`）。World 按 `_id` 做对比：不在数组里的对象会被移除（`World.js` 134–182）。所以我们已有的"合并后的对象表"可以直接喂给它。地形用 `setTerrain([{x,y,type:'wall'|'swamp'}...])`（`renderer/demo/src/config/terrain.json`）。
- `tickDuration` 的单位是秒。官方取 `max(game/tick, socketUpdateThrottle)/1000`（`build.min.js`）。它决定补间时长，例如 creep `MoveTo` 和资源 `ScaleTo`（README "Actions"）。
- **自带循环**：`init()` 内部创建 `new PIXI.Application({antialias:true,...})`（`GameRenderer.js` 103），Pixi v7 默认 autoStart，**每个 rAF 帧都会渲染整个 stage**。`start()` 把 `animate` 挂到 `app.ticker`，再加一个 `setTimeout` 每 500 ms 跑一次 `animateChecker`（`GameRenderer.js` 149–164），这个定时器在标签页隐藏时也会继续触发 `actionManager.update()`。动画并不只发生在 tick 之间：沼泽纹理平移（`terrain.js` 37–42，`Ticker.shared`）、say 和 text 的位置跟随（`say.js` 79、`text.js` 44/52）、各种 `Repeat` 动作（例如 extractor、powerBank、source 闪烁、season reactor 旋转）都是**常驻的空闲动画**。
- **对功耗策略的影响**：它和"只在 Scene 变化时渲染"的设计相反，是一个持续 60fps 的渲染器。要省电只能靠外部手段：隐藏时调用 `app.ticker.stop()`，同时清掉 `animateCheckerTimer`（引擎没有提供 `stop()`，只能 `release()`；GameRenderer 里也没有 pause API）。或者把 `swampTexture` 设为 `'static'/'disabled'`，`lighting` 设为 `'disabled'`，减少常驻动画。官方客户端也没有做任何 `visibilitychange` 处理（在 `build.min.js` 里搜 `visibilitychange|document.hidden` 无结果，observed）。rAF 会在标签页隐藏时被浏览器暂停，这是浏览器自身的行为。

### A2. Pixi 版本、能否共存、体积
- `@screeps/renderer@1.6.10` 的 dependencies 为 `@pixi/core ^7.4.2`、`@pixi/layers ^2.0.0`、`path-browserify`、`url`，devDependency 为 `pixi.js ^7.4.2`（`npm view`；`renderer/engine/package.json`）。
- **dist 把 Pixi 7.4.3 整个打包进去了**（UMD，`optimization.minimize:false`，`engine/webpack.config.js`；dist 中有 `VERSION = "7.4.3"`）。`engine/src/pixi-global.js` 会**写入 `window.PIXI`**、全局注册一个 svgBlob LoadParser，并把 `BaseTexture.defaultOptions` 改成 LINEAR + mipmap ON。`index.js` 还会写入 `window.GameRenderer`。
- **metadata 依赖全局 `PIXI`**：`metadata/src/index.js` 41–126 直接使用 `PIXI.Filter`、`PIXI.TilingSprite`、`PIXI.Assets`、`PIXI.BLEND_MODES`、`PIXI.Graphics`，所以必须先加载 renderer（v7）的全局对象。
- 两个 Pixi 共存的可行性：我们的 v8 是 ESM import，不读写 `window.PIXI`（在 pixi.js 8.22.0 `lib/*.mjs` 中搜 `window.PIXI` 无结果，observed），因此**两份 Pixi 可以并存**。代价是各自有一个 WebGL context 和一块 canvas，纹理不能共享，DOM 上要叠两层 canvas。
- 体积（observed，本地测量）：npm tarball 中 renderer 953 KB、metadata 386 KB（含 images）。`dist/renderer.js` 原始 2,162,818 B，gzip 后 441 KB；用 terser 压缩后 781 KB，**min+gzip ≈ 209 KB**。metadata 的 dist 为 81 KB，min+gzip ≈ 16.5 KB。作为对照，我们当前 `web/dist` 主包 `index-*.js` 为 502 KB，gzip 155 KB（含 Pixi v8）。也就是说，引入 renderer 会让 JS 传输量大约增加 1.3 倍。
- **移植到 v8**：工作量不小，但规模有限。引擎 `src` 约 40 个小文件，用到 v7 专有 API 的地方包括：`@pixi/layers`（v7 only，peerDeps `@pixi/core ^7`，`npm view @pixi/layers`，需要改用 v8 自带的 `RenderLayer`，它存在于 pixi.js 8.22 的 `lib/scene/layers/RenderLayer`）、`BaseTexture`、`utils.destroyTextureCache`、`Graphics.beginFill/lineStyle/arc`（v8 改成链式 `fill/stroke`）、`new Application({...})` 同步构造（v8 需要 `await app.init`）、`PIXI.Filter(undefined,undefined,{})`、`BLEND_MODES` 枚举（v8 改为字符串）、`Sprite.from(dataURL svg)`。metadata 中直接调用 PIXI 的只有 `index.js` 的图层 `afterCreate`，其余是声明式 JSON 加函数。这是推断：可行，但需要自己维护一个 fork（未验证）。

### A3. metadata 与 processors
- 管线（README "Pipeline"）：先跑 preprocessors `['setBadgeUrls','terrain']`（`metadata/src/index.js` 48–51），然后对每个对象找 `objects[type]`，依次执行 calculations、processors、actions。processor 支持 `props/once/when/until` 生命周期，表达式语法为 `$calc/$state/$if/...`。
- 图层（从下到上）：`terrain`、`wallGraffiti`、`objects`（默认）、`lighting`（MULTIPLY 滤镜加 0x808080 环境光，子元素用 SCREEN 混合）、`effects`（`metadata/src/index.js` 52–130）。
- 引擎 processors（`engine/src/lib/processors/`）：`object, container, draw, sprite, text, circle, resourceCircle, siteProgress, creepActions, creepBuildBody, creepDecoration, objectDecoration, moveTo, powerInfluence, road, runAction, say, disappear, terrain, userBadge, setBadgeUrls`。动作有 `AlphaBy/To, Blink, CallFunc, DelayTime, Ease, FadeIn/Out, FilterTo, MoveBy/To, PivotBy/To, Repeat, RotateBy/To, ScaleBy/To, Sequence, SkewBy/To, Spawn, TintBy/To`。
- 已有 metadata 的对象类型（33 种，`metadata/src/index.js` 131–165）：constructedWall, constructionSite, container, controller, creep, deposit, energy, extension, extractor, factory, flag, keeperLair, lab, link, mineral, nuke, nuker, observer, portal, powerBank, powerCreep, powerSpawn, road, source, spawn, storage, terminal, tombstone, tower, rampart, invaderCore, ruin，外加 `_all`（公共部分，例如 `playerColor`）。
- 各对象用到的 processor 统计（对 `metadata/src/objects/*.js` 做 grep）：controller 用了 14 个 sprite、6 个 circle、siteProgress、userBadge（按等级显示 `controller-level` 分段，calc `level1Visible…`）；creep 用 creepBuildBody（身体部件环：半径 50、线宽 18，最多 50 段，按部件 hits 着色，move 部件画在背面，见 `creepBuildBody.js` 7–44）、creepActions（attack/heal/harvest 等射线）、userBadge ×2（radius 26）、say、MoveTo/RotateTo 补间；tower 由 `tower-base` 和 `tower-rotatable` 组成，炮塔按动作 RotateTo；lab、link、terminal 用 creepActions 加 ScaleTo 表示能量和矿物量；extension 和 spawn 有能量填充缩放。
- **拼接类效果都不在 metadata 里，而是由引擎内的 preprocessor 或 processor 完成**：
  - 墙（自然墙加 constructedWall）、沼泽：`terrain.js` 用 `pathHelper.getRenderPath` 把格子合并成一条 SVG path，再用 `Sprite.from('data:image/svg+xml...')` 在运行时栅格化（`terrain.js` 18–35、93–180、256–265），并配合 `noise1/noise2/ground` PNG 做纹理和遮罩。
  - 非公开 rampart：按玩家合并成一条带描边的 path（己方填充 `#105010` 描边 `#44ff44`，敌方填充 `#501010` 描边 `#ff4444`，描边宽 25，alpha 0.4，`terrain.js` 184–235）。公开 rampart 则逐格使用 `rampart.svg` sprite（`rampart.metadata.js`）。
  - 道路：`road.js` 用 Graphics 画线，把相邻（含对角）道路连起来，颜色 `0xaaaaaa`。
- 引擎**不负责 room visuals**。官方客户端用一块独立的 Canvas2D 叠加层绘制（`build.min.js` 中的 `appRoomVisual` directive）。
- **只复用 SVG 加部分 metadata 放进我们自己的 Scene（作为 `image` primitive）**：可行，因为 sprite 都是 100×100 格坐标系下的静态图。会丢掉的部分：所有补间和空闲动画（Pixi actions）、lighting 图层（glow.png 叠加 MULTIPLY/SCREEN）、合并后的墙/沼泽/rampart 轮廓与噪声纹理（需要我们自己用 polygon 重写，算法见 `pathHelper.js`，ISC）、道路连接（逻辑简单，可以重写）、creep 身体环（`creepBuildBody.js` 只有 3.9 KB，可以改写成 Scene 的弧线 primitive）、按资源量缩放的 sprite（需要把 calculations 翻译成我们的代码）、tint 着色（`playerColor`：开启 `userOwnerColor` 时己方 `0x8fbb93`、敌方 `0xFF7777`，`_all.metadata.js` 24–51）。metadata 中的 calculations 有不少是 JS 函数，不是纯 JSON，只能作为参考移植，不能直接解释执行（推断）。

### A4. 赛季对象
- 仓库内的 metadata 和官方 `vendor/renderer/metadata/renderer-metadata.js`（81,038 B，MMO 与 season 两边逐字节相同）**都没有 `reactor` 或 thorium**（grep 无结果）。
- **赛季服通过 `GET /season/api/version` 下发覆盖**：`serverData.renderer = {resources:{T, extractor, reactor-core, reactor-edge}, metadata:{mineral, reactor}}`，另有 `serverData.customObjectTypes.reactor.sidepanel`（HTML 侧栏模板）。资源地址为 `https://s3.amazonaws.com/static.screeps.com/seasons/season11/renderer/{T.png, extractor.svg, reactor-core.png, reactor-edge.png}`，大小分别为 9,612 / 2,435 / 3,847 / 4,538 B，返回 200（observed）。MMO 的 `/api/version` 中该字段为空 `{resources:{},metadata:{}}`。官方客户端这样合并：`e.metadata=_.cloneDeep(RENDERER_METADATA); Object.assign(e.metadata.objects, override.metadata)`，resources 也做同样的合并（`build.min.js`，搜 `rendererOverride`）。回放场景另有 `seasons/replay/<code>` 返回的 `renderer` 字段。
- reactor 的 metadata 是纯 JSON：core sprite 150×150，外圈 `reactor-edge` 放在 `rotateContainer` 里，在 `store.T && user` 时执行 `Repeat(RotateBy(π,4s))`；再加 lighting 图层的 glow（tint 6792960 / 12386128）、`siteProgress` 环和 `userBadge`（radius 29）（observed，`season-version.json`）。mineral 的覆盖内容是给 `T` 加颜色等。
- S3 资源**不返回 CORS 头**，也没有 cache-control（observed）。要作为 WebGL 纹理使用就必须走 Gateway 代理，而现有 Gateway 不代理 `s3.amazonaws.com`。

### A5. 资源体积与格式
- `metadata/images`：126 个文件，567,367 B。其中 117 个 SVG 共 188,911 B（gzip 后 23 KB），9 个 PNG 共 378,456 B：`noise1` 512²、`ground` 512²、`noise2` 256²、`ground-mask` 512²、`glow` 256²、`creep-mask` 64²、`flare1–3` 128²（`file` 命令输出）。
- **没有纹理图集，也没有 HD 变体**。SVG 由 Pixi 在运行时加载并栅格化。其中 45 个 SVG 没有 width/height，只有 viewBox；28 个是 128²，25 个是 200²，9 个是 100²，其余是零散尺寸（observed）。`resourceMap`、`rescaleResources` 中的 `rescaleResources` 在引擎源码里**没有被使用**（grep 无结果）。官方的"HD"选项（`hd:"upscaling"|"native"`）只是按 `devicePixelRatio` 放大 canvas 尺寸和 zoom（`build.min.js`），不涉及另一套美术资源。
- 官方客户端从 `https://screeps.com/a/vendor/renderer/metadata/<name>.svg?bust=` 提供这 126 个文件，列表与仓库完全一致（`comm` 比对无差异），带 `cache-control: max-age=604800`（observed）。

### A6. 许可与来源
- `renderer/LICENSE.txt`：ISC，"Copyright (c) 2016, Artem Chivchalov <contact@screeps.com>"，允许"use, copy, modify, and/or distribute ... for any purpose"，条件是保留版权和许可声明。两个 npm 包的 `license` 都是 `ISC`（`npm view`）。仓库里**没有** NOTICE 文件，images 目录下也没有单独的许可文件，README 中也没有任何商标声明（observed）。
- 2018 年的博客（https://blog.screeps.com/2018/08/renderer/）写明它"contains the same renderer code and images we use in our official game client"，并鼓励用于"third-party GUI utilities ... a third-party game client"。没有提到任何对图片的额外限制。
- 结论：ISC 覆盖仓库内的图片，在私有自托管客户端中再分发需要附上 LICENSE 文本。**有三点例外或未验证**：(1) 赛季 S3 资源（reactor、T）不在该仓库内，没有任何许可声明，属于"未验证/默认保留权利"；(2) "Screeps" 名称和 logo 的商标问题不在 ISC 覆盖范围内（一般原则，未见官方声明）；(3) `metadata/dist/renderer-metadata.js.LICENSE.txt` 中列着 Pixi 5.3.12 的 MIT 声明，是过时的构建产物，无实际影响。

## B. 玩家徽章

### B7. 数据形状
- `room:` 流的 `users[<id>] = {_id, username, badge}`（`docs/research/screeps-api-facts.md` 22）。`user/find` 返回 `user.badge`，`map-stats` 的 `users` 中也有 badge（推断，与 owner0 处理同源）。
- `badge = {type, color1, color2, color3, param, flip}`，实例（observed，`fixtures/season/room.shardSeason.*.json`）：
  - `{type:5, color1:"#ba0e09", color2:"#ffbf00", color3:"#ffbf00", param:-68, flip:false}`
  - `{type:24, ..., param:0, flip:true}`
  - **自定义徽章**：`type` 是对象 `{path1, path2}`（SVG path 字符串），并且可以没有 `param`，例如 Invader（`_id "2"`）。
  - Source Keeper（`"3"`）**没有 badge**。
- 取值范围（`screeps/backend-local` 的 `lib/game/api/user.js` 146–175，`POST /badge` 校验）：`type` 为整数 1–24，或等于该用户 `customBadge` 的对象；`color1/2/3` 匹配 `/^#[a-f0-9]{6}/i`；`param` 取值 −100..100；`flip` 为布尔值。客户端和后端还兼容一种历史格式，即 color 是**数字索引**，指向一个 80 色调色板（4 档 × 20 色，由 HSL 生成，`backend-local/lib/game/api/badge.js` 470–486，与 `build.min.js` 的 BadgeGenerator 相同）。
- 徽章**按服务器分别存储**：Xerxes_2 在 MMO 上是 `#c8100b/#f8c420`，在 season 上是 `#ba0e09/#ffbf00`（`user/find` 与 badge-svg 的结果都一致，observed）。

### B8. 渲染方式与公开端点
- **客户端本地生成**：Angular 部分是 `BadgeGenerator`，加上 directive `app:badge-src` / `app:badge-xlink-href`（`build.min.js`）；Angular 2 部分是 `@screeps/map` 的 `generateUserBadge(opts,w,h)`（`app2/main.js` 158304–158366）。两者都是拼一段 SVG：`viewBox 0 0 100 100`，`clipPath` 为圆 `r=52`；先画 `rect` 填 color1，再画 path1 填 color2，path2 填 color3，按 `flip` 和该类型的 `rotate180/90/45` 旋转；最后转成 Blob URL（老版本还会经过 canvas 转 PNG）。
- **公开端点存在**：`GET /api/user/badge-svg?username=<name>[&border=1]`，season 上是 `/season/api/user/badge-svg`（observed）：
  - 返回 200，`content-type: image/svg+xml; charset=utf-8`，`cache-control: max-age=600`，带 ETag，**无 CORS 头**；OPTIONS 只返回 `allow: GET,HEAD`。体积约 788 B（常规类型），自定义徽章约 2.9 KB（Invader）。
  - 用户不存在时返回 404 text/plain；用户存在但没有 badge 时返回 200 和空 `<svg>`（46 B，Source Keeper）。PTR `/ptr/api` 当时返回 502。
  - `border=1` 会把裁剪圆改为 r=48，并加一圈 `r=47.5 stroke #000 width 5` 的描边。
  - 服务端实现是 `backend-local/lib/game/api/user.js` 465–494，带进程内 1 小时缓存，键为 `username.toLowerCase()+border`。
  - 一处异常：第一次请求 MMO 的无 border 版本时返回了 season 的颜色，之后多次请求都正确。原因未知，未验证。
  - 引擎的 `setBadgeUrls` preprocessor 就是用 `BADGE_URL.replace('%1', encodeURIComponent(username))` 生成 URL，官方设置为 `apiUrl+"user/badge-svg?username=%1"`（`setBadgeUrls.js`；`build.min.js`）。`userBadge` processor 会把它作为 sprite 纹理，宽度为 2×radius；没有 badgeUrl 时退回到一个纯色圆（默认 r37 `0x222222`，`userBadge.js` 9–49）。
  - 因为现有 Gateway 已经代理 `/api` 和 `/season/api`，**无需改动就能拿到同源的 badge-svg**。

### B9. 路径目录
- 数字类型共 **24 种**（`this.types=[1..24]`，`build.min.js`；后端校验 1–24）。目录**不是静态 path 字符串**：每种类型是 `{calc(param){ this.path1=...; this.path2=... }, flip?}`，path 由 `param` 参数化生成。可复用的最佳来源是 `screeps/backend-local/lib/game/api/badge.js`：ISC，16 KB，可读 ES6 源码，导出 `getBadgeSvg(badge, border)`，内含 `BadgePaths` 和 80 色调色板。也可以从 `build.min.js` 中的 `.value("BadgePaths",{...})` 提取（7.4 KB，minified）。
- 纯函数，没有 DOM 依赖，移植成 TS 纯函数（`badge → svg string`）的代价很小（推断）。

### B10. 官方客户端中徽章的显示位置（`official/tpl/*.html` 的 grep 结果）
- 顶栏头像：`top.html` 12–13，`app:badge-src='Me().badge'`，class `profile-icon`。
- 账户页与个人资料：`account.html` 14；`profile.html` 3（class `portrait`）。
- 消息：`messages/index.html` 7/13；`respondent.html` 11。
- 排行榜：`lobby-world.html` 54；`lobby-power.html` 55。
- 房间概览：`overview-room.html` 9。
- 世界地图（Angular 版）：悬浮信息中显示 owner、sign 的玩家，`world-map.html` 50/57/88/100；按统计图层绘制圆形，`world-map.html` 136/139，尺寸由 `getStatsCircleSize` 决定，owner0 时为 `2*sqrt(min(level,8)/8*4071/π)+8` px。
- 世界地图（新版 `@screeps/map`，Pixi）：每个被拥有的房间在中心放一个 `badge-svg?...&border=1` 纹理，尺寸为 `(0.05*level+0.2)*TILE_SIZE(128)`，即 RCL8 时约 77 px；level 0（预定）时 alpha 0.5（`app2/main.js` 156835–156856、221232、155849）。
- 房间内（PIXI 渲染器）：controller 中心 r≈37（74×74，旧 SVG 模板 `controller.html` 16–17，以及 metadata 的 userBadge）；spawn 和 powerSpawn 为 74×74；creep 为 r26（metadata）或 56×56（旧模板）；powerCreep 为 r26；season reactor 为 r29。
- 遮罩：badge 本身已在 SVG 内用圆形 clipPath 裁剪（r=52，略大于 viewBox，所以边缘贴到正方形边界；`border=1` 时为 r=48 加黑边）。房间里没有额外的 mask，通常还会在徽章外侧叠一圈 `siteProgress` 或玩家色环。

## C. 官方世界地图的“单位”图层（2026-10-08 补充，来源：`https://screeps.com/a/` 的 `main.js`，模块 `@screeps/map`）

- **订阅**：`UnitsSubscriber` 对当前视野内的每个房间（`getRoomsInBound(bound)`）订阅 `roomMap2:<shard>/<room>`，移出视野即退订（`main.js` 约 222667–222744）。
- **缩放门槛**：缩放参数 `scale < 50` 时 `unitsRestricted = true`，单位图层隐藏并停止订阅；`scale >= 50` 才显示（约 220891–220897；默认 `scale` 即 50）。
- **绘制**：`UnitsLayer.draw` 为每个房间生成一张 50×50 像素的纹理（一格一像素，`PIXI.Texture.fromBuffer`），以 `BLEND_MODES.ADD` 叠在地形瓦片上；每收到一帧该房间的 roomMap2 就重画（`@screeps/map/dist/layers/units.js`、`utils.js` 的 `roomObjects`）。
- **配色**：固定类别 `COLORS`——`2`/`3`（Invader / Source Keeper）`[255,150,0]`、`w` 墙 `[0,0,0]`、`r` 道路 `[60,60,60]`、`pb` `[255,255,255]`、`m` 矿 `[170,170,170]`、`p` portal `[0,200,255]`、`k` Keeper 巢 `[100,0,0]`、`c` 控制器 `[80,80,80]`、`s` Source `[255,242,70]`；玩家（24 位 id 的键）用 `user.playerColor || user.badge.color1`；其余未知键 `[235,85,71]`（约 156970–157010、221110–221127）。
- **对本项目的含义**：#17 / room-map-hub 已在每房间 ≥48px 时订阅视野内房间的 roomMap2，但只取 `pb`；画出全部点即可得到同样的效果，不需要新的数据通路。玩家颜色按用户决定沿用本项目的我方 / 盟友 / 陌生人规则，而非官方的徽章第一色。
