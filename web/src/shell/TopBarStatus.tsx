/**
 * Top Bar 的全局状态（#25）：Server 与 Shard（可切换）、连接状态、Tick 与 Tick 速度、我的 CPU。
 *
 * - 数据都来自全页共享 Source 的一份租约；租约按 `settings.server()` / `token()` 建，二者按值判等，
 *   所以切 Shard 不重建租约。
 * - Tick 不依赖 Room View：可见期间每 `tickPollMs` 轮询一次 `game/time`（匿名接口，一次一个整数），
 *   Tick 速度由相邻采样的 Tick 差与到达时间差估计（#14 的 TickRate）。页面隐藏时不轮询。
 *   WebSocket 上没有不依赖房间的逐 Tick 时间：`time` 帧只在连接时发一次，CPU 帧不带 Tick 号且到达时间不规则（实测）。
 * - CPU 订阅 `user:<id>/cpu`，只在有 token 时订阅；页面隐藏时由 LiveSource 暂停该频道（#14）。
 *   该频道的负载只有 `{cpu, memory}`，没有 bucket（实测），所以显示 CPU 与 Memory。
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { createTickRate } from "../power/tick-rate.ts";
import { pageVisibility, pollWhileVisible, type VisibilitySignal } from "../power/visibility.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import type { ConnectionState, CpuUpdate, ShardInfo } from "../source/source.ts";

/** 默认轮询间隔：每分钟 10 次，约占官方全局额度（120 次 / 分钟）的 8% */
export const TICK_POLL_MS = 6000;

export interface TopBarStatusProps {
  readonly settings: Settings;
  /** 应是全页共享的 Source */
  readonly sourceFor: SourceFactory;
  readonly visibility?: VisibilitySignal;
  readonly tickPollMs?: number;
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

  const source = createMemo(() => {
    const created = props.sourceFor(settings.server(), settings.token() || undefined);
    onCleanup(() => created.close());
    return created;
  });

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

  /** 选过且仍存在的 Shard，否则第一个；不分 Shard 的 Server 为空串；还不知道时 undefined */
  const shard = createMemo<string | undefined>(() => {
    if (!source().server.sharded) return "";
    const list = shards();
    if (!list) return undefined;
    const chosen = settings.shard();
    return chosen !== undefined && list.some((s) => s.name === chosen) ? chosen : list[0]?.name;
  });

  const [tick, setTick] = createSignal<number>();
  const [msPerTick, setMsPerTick] = createSignal<number>();
  createEffect(() => {
    const src = source();
    const current = shard();
    setTick(undefined);
    setMsPerTick(undefined);
    if (current === undefined) return;
    const rate = createTickRate();
    let alive = true;
    const off = pollWhileVisible(
      page,
      async () => {
        const time = await src.getTime(current);
        if (!alive) return;
        rate.record(time);
        setTick(time);
        setMsPerTick(rate.msPerTick());
      },
      props.tickPollMs ?? TICK_POLL_MS,
    );
    onCleanup(() => {
      alive = false;
      off();
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
