/**
 * Minimap 区块（#27）：Room View 下的 Sidebar Section，以当前房间为中心的 3×3 房间格。
 *
 * 数据：瓦片沿用 World Map 的单房间瓦片；所有权取全页的 OwnershipHub（缺的房间用 wantRooms 补查，
 * 与地图共用额度）；玩家位置点为 9 个房间各一个 roomMap2，经共享 Source 的租约订阅，
 * 换房间时只增删差出来的那几个。区块不在屏幕上（不在 Room View、Sidebar 收起、区块折叠）
 * 或页面不可见时退掉全部订阅、不构建 Scene。
 *
 * 点相邻格经 shell.navigate 切房间；Replay 中以同一 Tick 打开该房间的 Replay。世界外的格子不可点。
 */
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { useI18n } from "../i18n";
import { useVisible } from "../power/use-visible.ts";
import { ownerColorRule } from "../room/room-detail-rules.ts";
import { createSceneView, type SceneView } from "../scene/pixi-scene-view.ts";
import { attachGestures } from "../scene/pointer-gestures.ts";
import type { Scene } from "../scene/scene.ts";
import { screenToWorld } from "../scene/scene-camera.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { SectionContext } from "../shell/sidebar-sections.tsx";
import type { MapStats, RoomMapUpdate, Source, Unsubscribe, WorldSize } from "../source/source.ts";
import { buildMinimapScene, minimapCells, minimapRoomAt } from "./minimap-scene.ts";

const DEFAULT_SIZE = 200;

interface Where {
  readonly shard: string;
  readonly room: string;
}

export function Minimap(props: { readonly ctx: SectionContext; readonly shown: Accessor<boolean> }) {
  const { t } = useI18n();
  const ctx = props.ctx;
  const page = useVisible(ctx.visibility);
  const active = () => props.shown() && page();

  const where = createMemo<Where | undefined>(
    () => {
      const at = ctx.shell.location();
      return at.room ? { shard: at.shard ?? "", room: at.room.trim().toUpperCase() } : undefined;
    },
    undefined,
    { equals: (a, b) => a?.shard === b?.shard && a?.room === b?.room },
  );
  const shard = createMemo(() => where()?.shard);

  // 世界尺寸：按 Source + Shard 取一次
  const [size, setSize] = createSignal<WorldSize>();
  createEffect(() => {
    const src = ctx.source();
    const current = shard();
    setSize(undefined);
    if (current === undefined) return;
    let alive = true;
    src.getWorldSize(current).then(
      (got) => alive && setSize(got),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  const [me, setMe] = createSignal<string>();
  createEffect(() => {
    const src = ctx.source();
    setMe(undefined);
    if (!ctx.settings.token()) return;
    let alive = true;
    src.getMe().then(
      (user) => alive && setMe(user.id),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  // 所有权：读 hub 已知的，随 hub 的新结果更新
  const [stats, setStats] = createSignal<MapStats>();
  createEffect(() => {
    const hub = ctx.ownership();
    const current = shard();
    if (current === undefined) return setStats(undefined);
    setStats(hub.stats(current));
    onCleanup(hub.subscribe((got) => got.shard === current && setStats(hub.stats(current))));
  });

  const cells = createMemo(
    () => {
      const at = where();
      const world = size();
      return at && world ? minimapCells(at.room, world).map((c) => c.room) : [];
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((room, i) => room === b[i]) },
  );

  createEffect(() => {
    const current = shard();
    const rooms = cells();
    if (!active() || !ctx.settings.token() || current === undefined || rooms.length === 0) return;
    onCleanup(ctx.ownership().wantRooms(rooms.map((room) => ({ shard: current, room }))));
  });

  // roomMap2：每格一个订阅，按差集增删
  const [positions, setPositions] = createSignal<Readonly<Record<string, RoomMapUpdate>>>({});
  const subscriptions = new Map<string, { readonly source: Source; readonly room: string; readonly off: Unsubscribe }>();
  const drop = (key: string) => {
    const sub = subscriptions.get(key);
    if (!sub) return;
    subscriptions.delete(key);
    sub.off();
    setPositions(({ [sub.room]: _gone, ...rest }) => rest);
  };
  createEffect(() => {
    const src = ctx.source();
    const current = shard();
    const wanted = new Map<string, string>(
      active() && current !== undefined ? cells().map((room) => [`${current}/${room}`, room]) : [],
    );
    for (const [key, sub] of subscriptions) if (!wanted.has(key) || sub.source !== src) drop(key);
    for (const [key, room] of wanted) {
      if (subscriptions.has(key)) continue;
      let open = true;
      const off = src.subscribeRoomMap(current!, room, (update) => {
        if (open) setPositions((all) => ({ ...all, [room]: update }));
      });
      subscriptions.set(key, {
        source: src,
        room,
        off: () => {
          open = false;
          off();
        },
      });
    }
  });
  onCleanup(() => {
    for (const key of [...subscriptions.keys()]) drop(key);
  });

  // 不在屏幕上时不构建新 Scene（#14）
  const scene = createMemo<Scene | undefined>((previous) => {
    if (!active()) return previous;
    const at = where();
    const world = size();
    const src = ctx.source();
    if (!at || !world) return undefined;
    const theme = ctx.theme() ?? DEFAULT_THEME;
    const known = stats();
    const color = ownerColorRule(theme, known?.users ?? {}, { me: me(), allies: ctx.allies() });
    return buildMinimapScene({
      center: at.room,
      size: world,
      tileUrl: (room) => src.tileUrl(at.shard, room),
      rooms: known?.rooms ?? {},
      positions: positions(),
      ownerColor: color,
      theme,
    });
  });

  // ---- 画布 ----

  let host!: HTMLDivElement;
  const [view, setView] = createSignal<SceneView>();
  const [viewError, setViewError] = createSignal<string>();

  createEffect(() => {
    const v = view();
    const s = scene();
    if (v && s) v.show(s);
  });

  const tap = (x: number, y: number) => {
    const v = view();
    const at = where();
    const world = size();
    if (!v || !at || !world) return;
    const point = screenToWorld(v.viewport, x, y);
    const room = minimapRoomAt(at.room, world, point.x, point.y);
    if (!room || room === at.room) return;
    const replay = ctx.shell.location().replay;
    ctx.shell.navigate({ room, ...(replay ? { replay: { tick: replay.tick } } : {}) });
  };

  onMount(() => {
    const measure = () => {
      const side = host.clientWidth || DEFAULT_SIZE;
      return { width: side, height: side };
    };
    let alive = true;
    let created: SceneView | undefined;
    let observer: ResizeObserver | undefined;
    let detach: (() => void) | undefined;
    (ctx.createView ?? createSceneView)(measure()).then(
      (made) => {
        if (!alive) return made.destroy();
        created = made;
        made.canvas.style.touchAction = "none";
        detach = attachGestures(made.canvas, { pan: () => {}, zoom: () => {}, tap, end: () => {} });
        host.append(made.canvas);
        setView(made);
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(() => {
            // 隐藏（display: none）时宽度为 0：保持原尺寸
            if (host.clientWidth === 0) return;
            const next = measure();
            made.resize(next.width, next.height);
          });
          observer.observe(host);
        }
      },
      (error: unknown) => alive && setViewError(error instanceof Error ? error.message : String(error)),
    );
    onCleanup(() => {
      alive = false;
      observer?.disconnect();
      detach?.();
      created?.canvas.remove();
      created?.destroy();
    });
  });

  return (
    <div class="minimap">
      <Show when={!where()}>
        <p class="settings__muted">{t("minimap.noRoom")}</p>
      </Show>
      <Show when={viewError()}>
        {(message) => (
          <p class="settings__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <div
        class="minimap__canvas"
        ref={host}
        hidden={!where()}
        role="img"
        aria-label={where() ? t("minimap.label", { room: where()!.room }) : undefined}
      />
    </div>
  );
}
