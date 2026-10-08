/**
 * Room View（Live 最小版）：选一个房间，逐 Tick 画出地形、建筑与 creep，并显示当前 Tick。
 * 数据流：Source 房间流 → reduceLiveTick → RoomState → buildRoomScene → SceneView。
 * 是 Main View 的一种模式（#24）；开发用开关可以在服务器与录制数据（FixtureSource）之间切换数据来源。
 * 录制数据只在开发构建里可用：生产构建既不打包 `fixtures/` 也不显示开关（#14）。
 */
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { useI18n } from "../i18n";
import { createTickRate } from "../power/tick-rate.ts";
import { useVisible } from "../power/use-visible.ts";
import type { VisibilitySignal } from "../power/visibility.ts";
import { createSceneView, type SceneView, type SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { DEFAULT_THEME, type Theme } from "../scene/theme.ts";
import { errorMessage, type SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { STATE_KEYS } from "../readings/RawReadings.tsx";
import type { ConnectionState, Source, StreamError, Terrain } from "../source/source.ts";
import { browserStorage, type KeyValueStorage } from "../storage/local-store.ts";
import { cameraKey } from "./room-camera-store.ts";
import { RoomDetailsPanel, createRoomControls } from "./room-controls.tsx";
import { ROOM_SIZE, buildRoomScene } from "./room-scene.ts";
import { reduceLiveTick, type RoomState } from "./room-state.ts";
import type { HistoryCache } from "../replay/history-cache.ts";
import { createReplayController } from "../replay/replay-controller.ts";
import { ReplayControls } from "../replay/ReplayControls.tsx";
import { sharedHistoryCache } from "../replay/replay-settings.ts";
import type { ShortcutCommands } from "../customize/keybindings.ts";
import { registerRoomShortcuts } from "../customize/room-shortcuts.ts";
import type { RoomDisplay } from "./display-options.ts";
import { RoomToolbar } from "./RoomToolbar.tsx";
import { replayAt, replayTick, type RoomRequest, type RoomTarget } from "../shell/shell-state.ts";

/** 数据来源：服务器（经共享 Source），或开发构建里的录制数据（FixtureSource） */
type DataSource = "server" | "recording";

type Target = RoomTarget;
/** 从外部打开的房间；给了 replay 就以该 Tick 进入 Replay */
type OpenRequest = RoomRequest;

/** 按需加载 `fixtures/season/` 的录制数据，按原始时序播放。 */
async function loadSeasonFixtures(): Promise<Source> {
  const modules = import.meta.glob<unknown>("../../../fixtures/season/*.json", { import: "default" });
  const files = await Promise.all(Object.values(modules).map((load) => load()));
  return new FixtureSource(fixtureBundle(files));
}

const DEFAULT_SIZE = 600;

export interface RoomViewProps {
  readonly settings: Settings;
  /** 真实服务器的 Source */
  readonly sourceFor: SourceFactory;
  /** 录制数据的 Source；开发构建默认加载 `fixtures/season/`，生产构建默认没有 */
  readonly fixtureSource?: () => Promise<Source>;
  /** 默认是 Pixi 适配层；测试里换成记录 Scene 的假实现 */
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
  /** 页面可见性（#14）：不可见时暂停渲染；默认跟随 document */
  readonly visibility?: VisibilitySignal;
  /** Replay 的历史缓存；默认是全页共用的 IndexedDB 缓存 */
  readonly historyCache?: () => Promise<HistoryCache | undefined>;
  /** Ally List（用户名），着色用；默认空 */
  readonly allies?: ReadonlySet<string>;
  /** 每个房间视口的存储；默认浏览器 localStorage */
  readonly cameraStorage?: KeyValueStorage;
  /** 从外部（World Map、URL 路由，#16 #32）打开的房间或 Replay：每次给新对象就切过去 */
  readonly open?: OpenRequest | undefined;
  /** 给了就显示“返回地图”按钮（#16） */
  readonly onBack?: (() => void) | undefined;
  /** 显示的房间或 Replay 变化时回报（外壳状态记录当前位置，#24）；在 Replay 中时带 replay（起始 Tick） */
  readonly onTarget?: ((at: OpenRequest | undefined) => void) | undefined;
  /** 选中对象的详情改画到这个元素里（Sidebar 的选中对象区块，#24）；不给时画在房间旁边 */
  readonly detailsMount?: HTMLElement | undefined;
  /** 选中对象变化时回报（id 为 undefined 表示取消选中；窄屏据此切到选中对象标签，#29） */
  readonly onSelect?: ((id: string | undefined) => void) | undefined;
  /** Scene 调色板与着色规则（#5）；变化时重建 Scene。默认 DEFAULT_THEME */
  readonly theme?: Theme | undefined;
  /** 快捷键（#5）：Room View 登记 Live / Replay 切换与播放控制 */
  readonly shortcuts?: ShortcutCommands | undefined;
  /** 显示选项（#26）；默认全开 */
  readonly display?: RoomDisplay | undefined;
  /** 画面上的房间状态变化时回报（#26：房间信息区块） */
  readonly onShownState?: ((state: RoomState | undefined) => void) | undefined;
  /** 给了就由它进入 Replay（外壳经 navigate 打开 `#/replay?…`，#26）；不给时 Room View 自己打开 */
  readonly onEnterReplay?: ((target: Target, tick: number) => void) | undefined;
}

export function RoomView(props: RoomViewProps) {
  const { t } = useI18n();
  const settings = props.settings;
  const visible = useVisible(props.visibility);
  // import.meta.env.DEV 在生产构建里是常量 false：loadSeasonFixtures 连同 fixtures 一起被摇掉
  const loadFixtures = props.fixtureSource ?? (import.meta.env.DEV ? loadSeasonFixtures : undefined);

  const [dataSource, setDataSource] = createSignal<DataSource>("server");
  const [source, setSource] = createSignal<Source>();
  const [sourceError, setSourceError] = createSignal<string>();

  createEffect(() => {
    setSourceError(undefined);
    if (dataSource() === "server" || !loadFixtures) {
      const created = props.sourceFor(settings.server(), settings.token() || undefined);
      setSource(created);
      onCleanup(() => created.close());
      return;
    }
    setSource(undefined);
    let alive = true;
    let created: Source | undefined;
    loadFixtures().then(
      (loaded) => {
        if (!alive) return loaded.close();
        created = loaded;
        setSource(loaded);
      },
      (error: unknown) => alive && setSourceError(errorMessage(t, error)),
    );
    onCleanup(() => {
      alive = false;
      created?.close();
    });
  });

  const [connection, setConnection] = createSignal<ConnectionState>("disconnected");
  createEffect(() => {
    const src = source();
    if (src) onCleanup(src.onConnection(setConnection));
    else setConnection("disconnected");
  });

  const [me, setMe] = createSignal<string>();
  createEffect(() => {
    const src = source();
    setMe(undefined);
    if (!src) return;
    let alive = true;
    // 取不到当前用户（未登录、测试替身）时所有玩家按陌生人着色
    Promise.resolve()
      .then(() => src.getMe())
      .then(
        (info) => alive && setMe(info.id),
        () => {},
      );
    onCleanup(() => (alive = false));
  });

  const sharded = () => source()?.server.sharded ?? (dataSource() === "recording" || settings.server().sharded);

  const [shardInput, setShardInput] = createSignal(settings.shard() ?? "shardSeason");
  const [roomInput, setRoomInput] = createSignal("");
  const [target, setTarget] = createSignal<Target>();
  const [roomState, setRoomState] = createSignal<RoomState>();
  const [terrain, setTerrain] = createSignal<Terrain>();
  const [streamError, setStreamError] = createSignal<StreamError>();
  const [terrainError, setTerrainError] = createSignal<string>();
  const [tickMs, setTickMs] = createSignal<number>();

  const replay = createReplayController({
    source,
    cache: (props.historyCache ?? sharedHistoryCache)(),
    visible,
  });

  createEffect(() => {
    const current = target();
    const request = replay.active() ? replay.request() : undefined;
    props.onTarget?.(current && (request ? replayAt(current, request.tick, request.latest) : current));
  });

  registerRoomShortcuts(props.shortcuts, { replay, target, liveTick: () => roomState()?.gameTime });

  // World Map 点房间、URL 路由进来（#16 #32）
  createEffect(
    on(
      () => props.open,
      (opened) => {
        if (!opened) return;
        batch(() => {
          setShardInput(opened.shard);
          setRoomInput(opened.room);
          setTarget({ shard: opened.shard, room: opened.room });
          if (opened.replay) {
            const { tick, latest } = opened.replay;
            replay.open({ shard: opened.shard, room: opened.room, ...replayTick(tick, latest) });
          } else replay.close();
        });
      },
    ),
  );
  // 切换 Shard 后 Room View 跟随：别的 Shard 上的房间不再显示（#16）
  createEffect(
    on(
      settings.shard,
      (chosen) => {
        if (chosen === undefined) return;
        setShardInput(chosen);
        const current = untrack(target);
        if (current && current.shard !== chosen) {
          replay.close();
          setTarget(undefined);
        }
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const src = source();
    const current = target();
    setRoomState(undefined);
    setTerrain(undefined);
    setStreamError(undefined);
    setTerrainError(undefined);
    setTickMs(undefined);
    if (!src || !current) return;
    let alive = true;
    const rate = createTickRate();
    // Replay 期间退订 Live 房间流
    const off = replay.active()
      ? () => {}
      : src.subscribeRoom(
          current.shard,
          current.room,
          (tick) => {
            if (tick.gameTime !== undefined) {
              rate.record(tick.gameTime);
              setTickMs(rate.msPerTick());
            }
            setRoomState((state) => reduceLiveTick(state, tick));
          },
          setStreamError,
        );
    src.getTerrain(current.shard, current.room).then(
      (loaded) => alive && setTerrain(loaded),
      (error: unknown) => alive && setTerrainError(errorMessage(t, error)),
    );
    onCleanup(() => {
      alive = false;
      off();
    });
  });

  const [canvasSize, setCanvasSize] = createSignal({ width: DEFAULT_SIZE, height: DEFAULT_SIZE });
  const [view, setView] = createSignal<SceneView>();
  const controls = createRoomControls({
    view,
    size: canvasSize,
    cameraKey: () => {
      const current = target();
      return current && cameraKey(source()?.server.id ?? settings.server().id, current.shard, current.room);
    },
    storage: props.cameraStorage ?? browserStorage(),
    scene: () => scene(),
    world: { width: ROOM_SIZE, height: ROOM_SIZE },
  });

  createEffect(on(controls.selectedId, (id) => props.onSelect?.(id), { defer: true }));

  /** 画面上的房间状态：Replay 期间是重放出来的状态，否则是 Live 状态 */
  const shownState = () => (replay.active() ? replay.snapshot()?.roomState : roomState());

  // 页面不可见时不构建新 Scene，沿用上一个（#14）
  const scene = createMemo<Scene | undefined>((previous) => {
    if (!visible()) return previous;
    if (!target()) return undefined;
    const theme = props.theme ?? DEFAULT_THEME;
    const state = shownState();
    if (!state) {
      return { width: ROOM_SIZE, height: ROOM_SIZE, background: theme.background, primitives: [] };
    }
    return buildRoomScene(
      { state, terrain: terrain() },
      {
        theme,
        zoom: controls.zoom(),
        selectedId: controls.selectedId(),
        me: me(),
        allies: props.allies,
        display: props.display,
      },
    );
  });

  createEffect(() => props.onShownState?.(shownState()));

  const [enterError, setEnterError] = createSignal<unknown>();
  createEffect(on(target, () => setEnterError(undefined)));
  /** 左侧按钮列的“进入 Replay”：从 Live 当前 Tick（未知时问服务器）开始 */
  const enterReplay = () => {
    const current = target();
    const handoff = props.onEnterReplay;
    if (!current) return;
    if (!handoff) return replay.enterFromLive(current.shard, current.room, roomState()?.gameTime);
    const live = roomState()?.gameTime;
    if (live !== undefined) return handoff(current, live);
    const src = source();
    if (!src) return;
    setEnterError(undefined);
    src.getTime(current.shard).then(
      (tick) => handoff(current, tick),
      (error: unknown) => setEnterError(error),
    );
  };

  let host!: HTMLDivElement;
  const [viewError, setViewError] = createSignal<string>();

  onMount(() => {
    const size = () => {
      const width = host.clientWidth || DEFAULT_SIZE;
      return { width, height: host.clientHeight || width };
    };
    let alive = true;
    let created: SceneView | undefined;
    let observer: ResizeObserver | undefined;
    (props.createView ?? createSceneView)(size()).then(
      (made) => {
        if (!alive) return made.destroy();
        created = made;
        host.append(made.canvas);
        setCanvasSize(size());
        setView(made);
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(() => {
            // 隐藏（display: none）时宽度为 0：保持原尺寸，回来时视口不变
            if (host.clientWidth === 0) return;
            const { width, height } = size();
            made.resize(width, height);
            setCanvasSize({ width, height });
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

  createEffect(() => {
    const v = view();
    const s = scene();
    if (v && s) v.show(s);
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const room = roomInput().trim().toUpperCase();
    if (!room) return;
    replay.close();
    setTarget({ shard: sharded() ? shardInput().trim() : "", room });
  };

  const details = () => (
    <RoomDetailsPanel
      object={(() => {
        const id = controls.selectedId();
        return id === undefined ? undefined : shownState()?.objects[id];
      })()}
      users={shownState()?.users ?? {}}
      gameTime={replay.active() ? replay.snapshot()?.target : roomState()?.gameTime}
      onClose={() => controls.select(undefined)}
    />
  );

  return (
    <section class="room-view" aria-labelledby="room-view-title">
      <h2 id="room-view-title">{t("roomView.title")}</h2>
      <form class="room-view__form" data-testid="room-view-form" onSubmit={submit}>
        <Show when={loadFixtures}>
          <label>
            {t("roomView.source")}
            <select
              name="room-view-source"
              value={dataSource()}
              onChange={(e) => setDataSource(e.currentTarget.value as DataSource)}
            >
              <option value="server">{t("roomView.source.server")}</option>
              <option value="recording">{t("roomView.source.recording")}</option>
            </select>
          </label>
        </Show>
        <Show when={sharded()}>
          <label>
            {t("readings.shard")}
            <input name="room-view-shard" value={shardInput()} onInput={(e) => setShardInput(e.currentTarget.value)} />
          </label>
        </Show>
        <label>
          {t("readings.room")}
          <input
            name="room-view-room"
            placeholder="W13S28"
            value={roomInput()}
            onInput={(e) => setRoomInput(e.currentTarget.value)}
          />
        </label>
        <button type="submit">{t("roomView.open")}</button>
      </form>
      <p class="room-view__status">
        <span data-testid="room-view-state">{t(STATE_KEYS[connection()])}</span>
        {" · "}
        {t("roomView.tick")}{" "}
        <span data-testid="room-view-tick">
          {(replay.active() ? replay.snapshot()?.target : roomState()?.gameTime) ?? "—"}
        </span>
        <Show when={replay.active()}> · {t("replay.mode")}</Show>
        {" · "}
        {t("power.tickRate")}{" "}
        <span data-testid="room-view-tick-rate">
          {tickMs() === undefined ? "—" : t("power.msPerTick", { ms: Math.round(tickMs()!) })}
        </span>
      </p>
      <Show when={replay.entryError() ?? enterError()}>
        {(error) => (
          <p class="settings__error" role="alert">
            {errorMessage(t, error())}
          </p>
        )}
      </Show>
      <Show when={sourceError() ?? terrainError() ?? viewError()}>
        {(message) => (
          <p class="settings__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={streamError()}>
        {(failed) => (
          <p class="settings__error" role="alert">
            {failed().kind === "replaced"
              ? t("readings.error.replaced")
              : t("readings.error.server", { message: failed().message })}
          </p>
        )}
      </Show>
      <div class="room-view__stage">
        <div class="room-view__frame">
          <div class="room-view__canvas" ref={host} />
          <RoomToolbar
            onBack={props.onBack}
            onEnterReplay={target() && !replay.active() ? enterReplay : undefined}
            onZoom={controls.zoomBy}
          />
        </div>
        <Show when={target() && replay.snapshot()}>
          {(snapshot) => (
            <div class="room-view__replay">
              <ReplayControls
                snapshot={snapshot()}
                engine={replay.engine()!}
                latest={replay.request()?.latest ?? false}
                onBackToLive={replay.close}
              />
            </div>
          )}
        </Show>
        <Show when={props.detailsMount} keyed fallback={details()}>
          {(mount) => <Portal mount={mount}>{details()}</Portal>}
        </Show>
      </div>
    </section>
  );
}
