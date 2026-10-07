/**
 * World Map 页面（基础版，#16）：当前 Shard 的整张地图，地形瓦片 + 所有权着色。
 * 数据流：Source（world-size、me、map-stats 经所有权加载器）→ MapState → buildMapScene → SceneView。
 * 交互直接用画布上的 DOM Pointer Events（适配层停了 Pixi 的 ticker，Pixi events 不可靠）：
 * 滚轮 / 双指捏合缩放、拖拽平移；放大到 ENTER_ZOOM 以上后点房间进入 Room View，远看时点击只放大。
 * 视口按 Server + Shard 记在组件里：地图隐藏再显示、切走 Shard 再切回来都保持原样。
 * 固定布局；面板系统见 #2。
 */
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { useI18n } from "../i18n";
import { useVisible } from "../power/use-visible.ts";
import type { VisibilitySignal } from "../power/visibility.ts";
import { createSceneView, type SceneView, type SceneViewOptions, type Viewport } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { errorMessage, type SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import type { ShardInfo, Source } from "../source/source.ts";
import { fitCamera, panBy, sceneRect, sceneZoom, screenToWorld, visibleRect, zoomAt } from "./map-camera.ts";
import { buildMapScene } from "./map-scene.ts";
import { applyMapStats, mapStateFrom, roomAtWorld, type MapState } from "./map-state.ts";
import { createOwnershipLoader } from "./ownership-loader.ts";

/** 每个房间至少这么多 CSS 像素时，点击房间进入 Room View */
export const ENTER_ZOOM = 32;
/** 指针移动超过这么多像素就算拖动，不算点击 */
const CLICK_SLOP = 5;
const DEFAULT_WIDTH = 600;

export interface MapTarget {
  readonly shard: string;
  readonly room: string;
}

export interface MapViewProps {
  readonly settings: Settings;
  readonly sourceFor: SourceFactory;
  /** 点击房间进入 Room View */
  readonly onOpenRoom: (target: MapTarget) => void;
  /** 默认是 Pixi 适配层；测试里换成记录 Scene 的假实现 */
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
  readonly visibility?: VisibilitySignal;
  /** 视口停止变化多久后才取所有权，默认 600 毫秒 */
  readonly settleMs?: number;
}

export function MapView(props: MapViewProps) {
  const { t } = useI18n();
  /** Server + Shard → 视口；组件存活期间保留（进入 Room View 时页面只隐藏地图、不卸载） */
  const savedCameras = new Map<string, Viewport>();
  const settings = props.settings;
  const visible = useVisible(props.visibility);

  const source = createMemo(() => {
    const created = props.sourceFor(settings.server(), settings.token() || undefined);
    onCleanup(() => created.close());
    return created;
  });

  const [shards, setShards] = createSignal<readonly ShardInfo[]>();
  const [loadError, setLoadError] = createSignal<string>();
  const [ownershipError, setOwnershipError] = createSignal<string>();

  createEffect(() => {
    const src = source();
    setShards(undefined);
    setLoadError(undefined);
    if (!src.server.sharded) return;
    let alive = true;
    src.getShards().then(
      (list) => alive && setShards(list),
      (error: unknown) => alive && setLoadError(errorMessage(t, error)),
    );
    onCleanup(() => (alive = false));
  });

  /** 选过且仍存在的 Shard，否则第一个；不分 Shard 的 Server 为空串；还不知道时 undefined */
  const shard = createMemo<string | undefined>(() => {
    if (!source().server.sharded) return "";
    const list = shards();
    if (!list) return undefined;
    const chosen = settings.shard();
    return chosen !== undefined && list.some((s) => s.name === chosen) ? chosen : list[0]?.name;
  });

  const [me, setMe] = createSignal<string>();
  createEffect(() => {
    const src = source();
    setMe(undefined);
    if (!settings.token()) return;
    let alive = true;
    src.getMe().then(
      (user) => alive && setMe(user.id),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  const [mapState, setMapState] = createSignal<MapState>();
  createEffect(() => {
    const src = source();
    const current = shard();
    setMapState(undefined);
    if (current === undefined) return;
    let alive = true;
    src.getWorldSize(current).then(
      (size) => {
        if (!alive) return;
        setMapState(
          mapStateFrom({
            shard: current,
            size,
            tiles: { room: (room) => src.tileUrl(current, room), block: (room) => src.blockTileUrl(current, room) },
            me: untrack(me),
          }),
        );
      },
      (error: unknown) => alive && setLoadError(errorMessage(t, error)),
    );
    onCleanup(() => (alive = false));
  });
  createEffect(
    on(me, (id) => setMapState((state) => (state && state.me !== id ? { ...state, ...(id ? { me: id } : {}) } : state))),
  );

  // 所有权：每个 Source（即每个 Server + token）一个加载器，限额按 Server 计
  const loader = createMemo(() => {
    const src: Source = source();
    setOwnershipError(undefined);
    const created = createOwnershipLoader({
      fetch: (s, rooms) => src.getMapStats(s, rooms),
      onStats: (stats) => setMapState((state) => state && applyMapStats(state, stats)),
      onError: (error) => setOwnershipError(errorMessage(t, error)),
    });
    onCleanup(() => created.dispose());
    return created;
  });

  // ---- 画布与视口 ----

  let host!: HTMLDivElement;
  const [view, setView] = createSignal<SceneView>();
  const [viewError, setViewError] = createSignal<string>();
  const [canvasSize, setCanvasSize] = createSignal({ width: DEFAULT_WIDTH, height: DEFAULT_WIDTH * 0.75 });
  const [camera, setCamera] = createSignal<Viewport>();

  const cameraKey = () => {
    const state = mapState();
    return state ? `${source().server.id}/${state.shard}` : undefined;
  };

  // 换了地图（Server / Shard / 尺寸）时恢复记住的视口，否则整张放进画布
  createEffect(
    on(mapState, (state, previous) => {
      if (!state) return setCamera(undefined);
      if (previous && previous.shard === state.shard && previous.size === state.size) return;
      const key = cameraKey()!;
      const { width, height } = untrack(canvasSize);
      setCamera(savedCameras.get(key) ?? fitCamera(state.size, width, height));
    }),
  );
  createEffect(() => {
    const cam = camera();
    const key = untrack(cameraKey);
    if (cam && key) savedCameras.set(key, cam);
    if (cam) view()?.setViewport(cam);
  });

  const minScale = () => {
    const state = mapState();
    if (!state) return 0.1;
    const { width, height } = canvasSize();
    return fitCamera(state.size, width, height).scale / 2;
  };

  // Scene 只随“对齐后的可见区域 + 缩放档”变化；视口细微变化只重画
  const sceneInput = createMemo(
    () => {
      const cam = camera();
      if (!cam) return undefined;
      const { width, height } = canvasSize();
      return { rect: sceneRect(visibleRect(cam, width, height)), zoom: sceneZoom(cam.scale) };
    },
    undefined,
    {
      equals: (a, b) =>
        a === b ||
        (!!a &&
          !!b &&
          a.zoom === b.zoom &&
          a.rect.x0 === b.rect.x0 &&
          a.rect.y0 === b.rect.y0 &&
          a.rect.x1 === b.rect.x1 &&
          a.rect.y1 === b.rect.y1),
    },
  );

  // 页面不可见时不构建新 Scene（#14）
  const scene = createMemo<Scene | undefined>((previous) => {
    if (!visible()) return previous;
    const state = mapState();
    const input = sceneInput();
    if (!state || !input) return undefined;
    return buildMapScene(state, { theme: DEFAULT_THEME, zoom: input.zoom, visible: input.rect });
  });

  createEffect(() => {
    const v = view();
    const s = scene();    if (v && s) v.show(s);
  });

  // 视口停下来一段时间后才取所有权：拖动、缩放过程中不发请求
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const cam = camera();
    const state = mapState();
    const current = loader();
    clearTimeout(settleTimer);
    if (!cam || !state || !settings.token() || !visible()) return;
    const { width, height } = canvasSize();
    settleTimer = setTimeout(() => {
      if (dragging()) return;
      current.request(state.shard, state.size, visibleRect(cam, width, height));
    }, props.settleMs ?? 600);
  });
  onCleanup(() => clearTimeout(settleTimer));

  // ---- 指针交互 ----

  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  const [dragging, setDragging] = createSignal(false);

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const update = (change: (cam: Viewport) => Viewport) => {
    const cam = camera();
    if (cam) setCamera(change(cam));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) moved = 0;
    else moved = Infinity; // 多指不算点击
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = local(event);
    if (pointers.size === 1) {
      moved += Math.hypot(point.x - previous.x, point.y - previous.y);
      pointers.set(event.pointerId, point);
      update((cam) => panBy(cam, point.x - previous.x, point.y - previous.y));
      return;
    }
    // 捏合：按两指距离缩放，以两指中点为中心，并跟随中点平移
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    pointers.set(event.pointerId, point);
    if (!other) return;
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    const after = Math.hypot(point.x - other.x, point.y - other.y);
    const midBefore = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
    const midAfter = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
    update((cam) => {
      const zoomed = before > 0 ? zoomAt(cam, midBefore.x, midBefore.y, after / before, minScale()) : cam;
      return panBy(zoomed, midAfter.x - midBefore.x, midAfter.y - midBefore.y);
    });
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size > 0) return;
    setDragging(false);
    if (event.type !== "pointerup" || moved > CLICK_SLOP) return;
    click(local(event));
  };

  const click = (point: { x: number; y: number }) => {
    const cam = camera();
    const state = mapState();
    if (!cam || !state) return;
    if (cam.scale < ENTER_ZOOM) {
      setCamera(zoomAt(cam, point.x, point.y, 2, minScale()));
      return;
    }
    const world = screenToWorld(cam, point.x, point.y);
    const room = roomAtWorld(state, world.x, world.y);
    if (room) props.onOpenRoom({ shard: state.shard, room });
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
    const point = local(event);
    update((cam) => zoomAt(cam, point.x, point.y, Math.exp(-pixels * 0.0015), minScale()));
  };

  onMount(() => {
    const size = () => {
      const width = host.clientWidth || DEFAULT_WIDTH;
      return { width, height: Math.round(width * 0.75) };
    };
    setCanvasSize(size());
    let alive = true;
    let created: SceneView | undefined;
    let observer: ResizeObserver | undefined;
    (props.createView ?? createSceneView)(size()).then(
      (made) => {
        if (!alive) return made.destroy();
        created = made;
        const canvas = made.canvas;
        canvas.style.touchAction = "none";
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        host.append(canvas);
        setView(made);
        const cam = untrack(camera);
        if (cam) made.setViewport(cam);
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(() => {
            // 隐藏（display: none）时宽度为 0：保持原尺寸，回来时视口不变
            if (host.clientWidth === 0) return;
            const next = size();
            setCanvasSize(next);
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
      created?.canvas.remove();
      created?.destroy();
    });
  });

  return (
    <section class="world-map" aria-labelledby="world-map-title">
      <h2 id="world-map-title">{t("worldMap.title")}</h2>
      <div class="world-map__bar">
        <Show when={source().server.sharded}>
          <label>
            {t("worldMap.shard")}
            <select name="world-map-shard" onChange={(e) => settings.setShard(e.currentTarget.value)}>
              <For each={shards() ?? []}>
                {(info) => (
                  <option value={info.name} selected={info.name === shard()}>
                    {info.name}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <span class="world-map__hint">{t("worldMap.hint")}</span>
      </div>
      <Show when={!mapState() && !loadError()}>
        <p class="settings__muted">{t("worldMap.loading")}</p>
      </Show>
      <Show when={!settings.token()}>
        <p class="settings__muted">{t("worldMap.noToken")}</p>
      </Show>
      <Show when={loadError() ?? viewError()}>
        {(message) => (
          <p class="settings__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={ownershipError()}>
        {(message) => (
          <p class="settings__error" role="alert">
            {t("worldMap.ownershipError", { message: message() })}
          </p>
        )}
      </Show>
      <div class="world-map__canvas" ref={host} />
    </section>
  );
}
