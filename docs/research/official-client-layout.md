# Official Screeps client layout (observed 2026-10-08)

Source: public static files of the official client at `https://screeps.com/a/` (GET only, not logged in). `/season/` loads the same `build.min.js` / `app2/main.js`, and `components/top/top.html` is byte-identical, so the layout is the same. Paths below are relative to `https://screeps.com/a/`.

## Shell
- Full-viewport SPA; the page never scrolls. `.page-content` is `position:absolute; top:42px; bottom:0; overflow:auto` (inner pages such as Market scroll inside it) (`app.css`).
- Top bar (`components/top/top.html`), left to right: hamburger (unread-message badge); avatar + username + thin CPU / Mem bars, opening a dropdown (CPU/Mem values, Respawn, View profile, Manage account, Sign out); Credits (links to market history), CPU unlock, Pixel, Access key balances.
- No permanent left navigation: an `md-sidenav` drawer, closed by default, lists Overview, World, Market, Inventory, Messages (count), Seasons Overview, Simulation, Documentation, Tutorial, Blog, Chat, News.
- No global right panel or bottom panel; those exist only on the room page.

## Room page (`components/game/room/room.html`, `components/game/game.html`)
- **Right aside**: 210 px wide, `#2d2d2d`, absolutely positioned on the right; a "Hide side panel" button at the bottom collapses the whole aside (`right:-210px`, 0.3 s transition).
- The aside is a stack of `aside-block`s, each with a clickable title that collapses/expands it: `room <name>` (owner, novice/respawn area, safe mode, controller sign); Decorations; **World Map** (the 3×3 minimap); Invasion; Cursor (coordinates); a highlighted block titled with the selected object's type when something is selected; Construct (in build mode).
- Gear button at the aside's top right opens **Display options** (`dlg-display-options.html`): show own/enemy names, flags, "Show creeps speech", visuals, HD, lighting, swamp texture, metrics.
- Top-centre round FAB toolbar: View/Pan, Create Flag, Construct.
- Left vertical buttons: World (back to map), Room overview, Replay room history, zoom +/−.
- **Bottom editor panel**: tabs Script / Console / Memory (Alt+1/2/3); height draggable (default 250); hide/show (Alt+Enter); can pop out to a separate window. Only on room and sim pages (`editor-panel.html`).
- Ctrl+F11 hides all UI (observed in bundle).

## World map vs room
- Separate routes: `/map/:shard`, `/room/:shard/:room`, plus `/history/:shard/:room`, `/overview/:shard/:room`.
- Back to a room via the aside minimap or the left "World" button. No dedicated keyboard shortcut to toggle map/room was found (unverified; only keyCode handlers grepped).
- **3×3 minimap exists**: the aside's "World Map" block. Nine cells from `getNeighborRoom(-1..1, -1..1)`; each cell is the terrain tile `Room.mapUrl + <room>.png` with a 50×50 canvas of room objects drawn over it; each cell is an `<a>` to that room (keeps `?t=` in replay). The block is collapsible (`room.html` lines 231–261).
- World map page: shard switcher, "Display:" layer dropdown, units toggle (zoom 3 only), room search, random room, zoom (`world-map.html`).

## Creep say bubble (`vendor/renderer/renderer.js` `processors/say.js`, `renderer-metadata.js`)
- Rounded rectangle (radius 30), black stroke 8, with a pointer towards the creep; Roboto 60, colour `#111`; width = text width + 60, height 100 (≈ one tile at 100 px/tile); placed 1.7 tiles above the creep.
- Private: grey `#cccccc` background; public: pink `#dd8888`.
- Shown when `showCreepSpeech && say && (isPublic || isOwner)`.
- Duration: the PIXI renderer toggles per tick from `actionLog.say`, so about one tick (inferred); the old SVG template used a fixed 2 s `$timeout` (`components/game/room/creep/creep.html`).

## Reachability
- One click: top-bar Credits / balances; room page World, Room overview, History, Display options, aside collapse; map page shard switcher.
- Hamburger drawer: Overview, Market, Messages, Seasons, Sim, Tutorial, Docs. Avatar dropdown: Account, Profile, Respawn, Sign out. Leaderboard route `/rank/world` has no drawer entry (entry point unverified).

## Narrow screens
- `<meta name="viewport" content="width=1280">`: no mobile adaptation; the page is scaled from 1280 px. `app.css` media queries are essentially Bootstrap's (unverified in detail). hammer.js is loaded (usage unverified).

## How the official client shows units without `room:` subscriptions (observed 2026-10-08)
- World map (`main.js`, module `src2/app/world-map.module`, class `UnitsSubscriber`): computes the rooms inside the visible bounds (`getRoomsInBound(bound)`) and subscribes `roomMap2:<shard>/<room>` for each; rooms leaving the viewport are unsubscribed. The units toggle only appears at the closest zoom, which bounds the number of subscriptions.
- Room-page 3×3 minimap (`build.min.js`): each cell subscribes `roomMap2:` (`"roomMap2:"+(official?shard+"/":"")+room`) and paints the position lists into a 50×50 canvas over the terrain tile.
- So the "about 2" limit applies only to the heavy `room:` channel (full object state + per-tick diffs); `roomMap2:` carries only per-user position lists and is what the official client uses for all multi-room unit display (cf. #17's test of 100 concurrent `roomMap2:` subscriptions).
