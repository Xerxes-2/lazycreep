/**
 * Room View（Live 最小版）：选一个房间，逐 Tick 画出地形、建筑与 creep，并显示当前 Tick。
 * 数据流：Source 房间流 → reduceLiveTick → RoomState → buildRoomScene → SceneView。
 * 固定布局；开发用开关可以在真实服务器与录制回放（FixtureSource）之间切换。
 * 录制回放只在开发构建里可用：生产构建既不打包 `fixtures/` 也不显示开关（#14）。
 */
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../i18n";
import { createTickRate } from "../power/tick-rate.ts";
import { useVisible } from "../power/use-visible.ts";
import type { VisibilitySignal } from "../power/visibility.ts";
import { createSceneView, type SceneView, type SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { errorMessage, type SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { STATE_KEYS } from "../readings/RawReadings.tsx";
import type { ConnectionState, Source, StreamError, Terrain } from "../source/source.ts";
import { ROOM_SIZE, buildRoomScene } from "./room-scene.ts";
import { reduceLiveTick, type RoomState } from "./room-state.ts";

type Mode = "live" | "fixture";

interface Target {
  readonly shard: string;
  readonly room: string;
}

/** 按需加载 `fixtures/season/` 的录制数据，按原始时序回放。 */
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
  /** 录制回放的 Source；开发构建默认加载 `fixtures/season/`，生产构建默认没有 */
  readonly fixtureSource?: () => Promise<Source>;
  /** 默认是 Pixi 适配层；测试里换成记录 Scene 的假实现 */
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
  /** 页面可见性（#14）：不可见时暂停渲染；默认跟随 document */
  readonly visibility?: VisibilitySignal;
}

export function RoomView(props: RoomViewProps) {
  const { t } = useI18n();
  const settings = props.settings;
  const visible = useVisible(props.visibility);
  // import.meta.env.DEV 在生产构建里是常量 false：loadSeasonFixtures 连同 fixtures 一起被摇掉
  const loadFixtures = props.fixtureSource ?? (import.meta.env.DEV ? loadSeasonFixtures : undefined);

  const [mode, setMode] = createSignal<Mode>("live");
  const [source, setSource] = createSignal<Source>();
  const [sourceError, setSourceError] = createSignal<string>();

  createEffect(() => {
    setSourceError(undefined);
    if (mode() === "live" || !loadFixtures) {
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

  const sharded = () => source()?.server.sharded ?? (mode() === "fixture" || settings.server().sharded);

  const [shardInput, setShardInput] = createSignal(settings.shard() ?? "shardSeason");
  const [roomInput, setRoomInput] = createSignal("");
  const [target, setTarget] = createSignal<Target>();
  const [roomState, setRoomState] = createSignal<RoomState>();
  const [terrain, setTerrain] = createSignal<Terrain>();
  const [streamError, setStreamError] = createSignal<StreamError>();
  const [terrainError, setTerrainError] = createSignal<string>();
  const [tickMs, setTickMs] = createSignal<number>();

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
    const off = src.subscribeRoom(
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

  // 页面不可见时不构建新 Scene，沿用上一个（#14）
  const scene = createMemo<Scene | undefined>((previous) => {
    if (!visible()) return previous;
    if (!target()) return undefined;
    const state = roomState();
    if (!state) {
      return { width: ROOM_SIZE, height: ROOM_SIZE, background: DEFAULT_THEME.background, primitives: [] };
    }
    return buildRoomScene({ state, terrain: terrain() }, { theme: DEFAULT_THEME });
  });

  let host!: HTMLDivElement;
  const [view, setView] = createSignal<SceneView>();
  const [viewError, setViewError] = createSignal<string>();

  onMount(() => {
    const size = () => {
      const width = host.clientWidth || DEFAULT_SIZE;
      return { width, height: width };
    };
    let alive = true;
    let created: SceneView | undefined;
    let observer: ResizeObserver | undefined;
    (props.createView ?? createSceneView)(size()).then(
      (made) => {
        if (!alive) return made.destroy();
        created = made;
        host.append(made.canvas);
        setView(made);
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(() => {
            const { width, height } = size();
            made.resize(width, height);
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
    setTarget({ shard: sharded() ? shardInput().trim() : "", room });
  };

  return (
    <section class="room-view" aria-labelledby="room-view-title">
      <h2 id="room-view-title">{t("roomView.title")}</h2>
      <form class="room-view__form" data-testid="room-view-form" onSubmit={submit}>
        <Show when={loadFixtures}>
          <label>
            {t("roomView.mode")}
            <select name="room-view-mode" value={mode()} onChange={(e) => setMode(e.currentTarget.value as Mode)}>
              <option value="live">{t("roomView.mode.live")}</option>
              <option value="fixture">{t("roomView.mode.fixture")}</option>
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
        {t("roomView.tick")} <span data-testid="room-view-tick">{roomState()?.gameTime ?? "—"}</span>
        {" · "}
        {t("power.tickRate")}{" "}
        <span data-testid="room-view-tick-rate">
          {tickMs() === undefined ? "—" : t("power.msPerTick", { ms: Math.round(tickMs()!) })}
        </span>
      </p>
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
      <div class="room-view__canvas" ref={host} />
    </section>
  );
}
