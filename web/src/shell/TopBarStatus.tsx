/**
 * Top Bar 的全局状态（#25）：Server 与 Shard（可切换）、连接状态、Tick 与 Tick 速度、我的 CPU。
 *
 * - 数据都来自全页共享 Source 的一份租约；租约按 `settings.server()` / `token()` 建，二者按值判等，
 *   所以切 Shard 不重建租约。
 * - Tick 与 Tick 速度不必很准（tick-clock.ts）：Room View 在流时取房间流的 gameTime；否则 Tick 速度用
 *   Shard 列表里服务器给的平均 Tick 时长，Tick 号按它从最近一次 `game/time` 往前推，每 `tickPollMs` 校准一次。
 *   页面隐藏时不校准也不推算。WebSocket 上没有不依赖房间的逐 Tick 时间：`time` 帧只在连接时发一次，
 *   CPU 帧不带 Tick 号且到达时间不规则（实测）。
 * - CPU 订阅 `user:<id>/cpu`，只在有 token 时订阅；页面隐藏时由 LiveSource 暂停该频道（#14）。
 *   该频道的负载只有 `{cpu, memory}`，没有 bucket（实测），所以显示 CPU 与 Memory。
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { TopBarBadge } from "../badge/TopBarBadge.tsx";
import { createTickClock } from "../power/tick-clock.ts";
import { pageVisibility, pollWhileVisible, whileVisible, type VisibilitySignal } from "../power/visibility.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import type { ConnectionState, CpuUpdate, ShardInfo } from "../source/source.ts";
import { useSharedSource } from "../source/use-shared-source.ts";

/** 默认校准间隔：每分钟至多 1 次 `game/time`；Room View 在流时不发 */
export const TICK_POLL_MS = 60_000;
/** Tick 时长还不知道时推算 Tick 号的更新间隔 */
const ADVANCE_FALLBACK_MS = 3000;

/** Room View 房间流的一帧的 Tick */
export interface LiveTick {
  readonly shard: string;
  readonly gameTime: number;
  /** 到达时刻（performance.now()） */
  readonly at: number;
}

export interface TopBarStatusProps {
  readonly settings: Settings;
  /** 应是全页共享的 Source */
  readonly sourceFor: SourceFactory;
  readonly visibility?: VisibilitySignal;
  /** 校准（`game/time`）间隔；默认 TICK_POLL_MS */
  readonly tickPollMs?: number;
  /** Room View 房间流的最新 Tick（只在 Live 时有）：在流期间以它为准、不发 `game/time` */
  readonly liveTick?: Accessor<LiveTick | undefined>;
  /** 实测的 Tick 速度（毫秒 / Tick；测出来之前与换 Shard 后为 undefined）：外壳转给 Room View 算动画时长（#55） */
  readonly onMsPerTick?: (ms: number | undefined) => void;
}

const CONNECTION_LABEL: Record<ConnectionState, MessageKey> = {
  connecting: "connection.connecting",
  authenticated: "connection.authenticated",
  disconnected: "connection.disconnected",
  reconnecting: "connection.reconnecting",
  unauthorized: "connection.unauthorized",
};

export function TopBarStatus(props: TopBarStatusProps) {
  const { t } = useI18n();
  const settings = props.settings;
  const page = props.visibility ?? pageVisibility();

  const source = useSharedSource(props.sourceFor, settings);

  const [connection, setConnection] = createSignal<ConnectionState>();
  createEffect(() => {
    const off = source().onConnection(setConnection);
    onCleanup(off);
  });

  const [shards, setShards] = createSignal<readonly ShardInfo[]>();
  createEffect(() => {
    const src = source();
    setShards(undefined);
    if (!src.server.sharded) return;
    let alive = true;
    src.getShards().then(
      (list) => alive && setShards(list),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  /** 选过且仍存在的 Shard，否则第一个；不分 Shard 的 Server 为空串；还不知道时 undefined（列表回来前先用选过的，#35） */
  const shard = createMemo<string | undefined>(() => {
    if (!source().server.sharded) return "";
    const list = shards();
    const chosen = settings.shard();
    if (!list) return chosen;
    return chosen !== undefined && list.some((s) => s.name === chosen) ? chosen : list[0]?.name;
  });

  const [tick, setTick] = createSignal<number>();
  const [msPerTick, setMsPerTick] = createSignal<number>();
  createEffect(() => props.onMsPerTick?.(msPerTick()));
  createEffect(() => {
    const src = source();
    const current = shard();
    setTick(undefined);
    setMsPerTick(undefined);
    if (current === undefined) return;
    const clock = createTickClock();
    let alive = true;
    const show = () => {
      setTick(clock.tick());
      setMsPerTick(clock.msPerTick());
    };

    // 服务器给的平均 Tick 时长（Shard 列表里本来就有）
    createEffect(() => {
      clock.setServerMs(shards()?.find((s) => s.name === current)?.tickMs);
      show();
    });
    // Room View 的房间流：每 Tick 一帧
    createEffect(() => {
      const live = props.liveTick?.();
      if (!live || live.shard !== current) return;
      clock.live(live.gameTime, live.at);
      show();
    });
    // 校准：Room View 在流时不发
    const offCalibrate = pollWhileVisible(
      page,
      async () => {
        if (clock.streaming()) return;
        // 只并入在途请求、不拿已到达的复用结果：校准要真实的到达时刻（#38）
        const time = await src.getTime(current, { maxAgeMs: 0 });
        if (!alive) return;
        clock.calibrate(time);
        show();
      },
      props.tickPollMs ?? TICK_POLL_MS,
    );
    // 推算的 Tick 号：可见期间每到下一个 Tick 更新一次文字（只改 DOM 文本，不渲染画布）
    const offAdvance = whileVisible(page, () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = () => {
        show();
        timer = setTimeout(next, Math.max(500, clock.msPerTick() ?? ADVANCE_FALLBACK_MS));
      };
      next();
      return () => clearTimeout(timer);
    });
    onCleanup(() => {
      alive = false;
      offCalibrate();
      offAdvance();
    });
  });

  const [cpu, setCpu] = createSignal<CpuUpdate>();
  createEffect(() => {
    const src = source();
    setCpu(undefined);
    if (!settings.token()) return;
    onCleanup(src.subscribeCpu(setCpu));
  });

  return (
    <>
      <TopBarBadge source={source} token={() => settings.token() || undefined} />
      <select
        name="top-bar-server"
        data-status="server"
        aria-label={t("settings.server")}
        onChange={(e) => settings.selectServer(e.currentTarget.value)}
      >
        <For each={settings.servers()}>
          {(server) => (
            <option value={server.id} selected={server.id === settings.server().id}>
              {server.name}
            </option>
          )}
        </For>
      </select>
      <Show when={shards()}>
        {(list) => (
          <select
            name="top-bar-shard"
            data-status="shard"
            aria-label={t("topBar.shard")}
            onChange={(e) => settings.setShard(e.currentTarget.value)}
          >
            <For each={list()}>
              {(info) => (
                <option value={info.name} selected={info.name === shard()}>
                  {info.name}
                </option>
              )}
            </For>
          </select>
        )}
      </Show>
      <Show when={connection()}>
        {(state) => (
          <span class="top-bar__connection" data-status="connection" data-connection={state()}>
            {t(CONNECTION_LABEL[state()])}
          </span>
        )}
      </Show>
      <span class="top-bar__tick" data-status="tick" title={t("power.tickRate")}>
        {tick() === undefined ? t("topBar.tick", { tick: "—" }) : t("topBar.tick", { tick: tick()! })}
        <Show when={msPerTick()}>{(ms) => <> · {t("power.msPerTick", { ms: Math.round(ms()) })}</>}</Show>
      </span>
      <Show when={settings.token() ? cpu() : undefined}>
        {(update) => (
          <span class="top-bar__cpu" data-status="cpu">
            {t("topBar.cpu", { cpu: update().cpu, memory: Math.round(update().memory / 1024) })}
          </span>
        )}
      </Show>
    </>
  );
}
