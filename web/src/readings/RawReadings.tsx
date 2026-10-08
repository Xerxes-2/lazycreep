/**
 * 开发用的原始读数：订阅一个房间，显示最新 gameTime、本次会话收到的帧数与连接状态。
 * 用来端到端确认 LiveSource 的 WebSocket 层，不做任何渲染。
 * 给了 dataSource 时顶上还有 Room View 的数据来源开关（服务器 / 录制数据，#51）。
 */
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { Settings } from "../settings/settings.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { ConnectionState, StreamError } from "../source/source.ts";
import { useSharedSource } from "../source/use-shared-source.ts";
import type { DataSourceChoice } from "../room/data-source.ts";
import { DataSourceSwitch } from "../room/DataSourceSwitch.tsx";

export const STATE_KEYS: Record<ConnectionState, MessageKey> = {
  connecting: "connection.connecting",
  authenticated: "connection.authenticated",
  disconnected: "connection.disconnected",
  reconnecting: "connection.reconnecting",
  unauthorized: "connection.unauthorized",
};

interface Target {
  readonly shard: string;
  readonly room: string;
}

export function RawReadings(props: { settings: Settings; sourceFor: SourceFactory; dataSource?: DataSourceChoice | undefined }) {
  const { t } = useI18n();
  const settings = props.settings;

  const source = useSharedSource(props.sourceFor, settings);

  const [state, setState] = createSignal<ConnectionState>("disconnected");
  createEffect(() => onCleanup(source().onConnection(setState)));

  const [shardInput, setShardInput] = createSignal(settings.shard() ?? "");
  const [roomInput, setRoomInput] = createSignal("");
  const [target, setTarget] = createSignal<Target>();
  const [frames, setFrames] = createSignal(0);
  const [gameTime, setGameTime] = createSignal<number>();
  const [error, setError] = createSignal<StreamError>();

  createEffect(() => {
    const src = source();
    const current = target();
    setFrames(0);
    setGameTime(undefined);
    setError(undefined);
    if (!current) return;
    const off = src.subscribeRoom(
      current.shard,
      current.room,
      (tick) => {
        setFrames((n) => n + 1);
        if (tick.gameTime !== undefined) setGameTime(tick.gameTime);
      },
      setError,
    );
    onCleanup(off);
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const room = roomInput().trim().toUpperCase();
    if (!room) return;
    const shard = settings.server().sharded ? shardInput().trim() : "";
    setTarget({ shard, room });
  };

  return (
    <section class="readings" aria-labelledby="readings-title">
      <h2 id="readings-title">{t("readings.title")}</h2>
      <Show when={props.dataSource}>
        {(choice) => (
          <div class="readings__form">
            <DataSourceSwitch choice={choice()} />
          </div>
        )}
      </Show>
      <form class="readings__form" data-testid="readings-form" onSubmit={submit}>
        <Show when={settings.server().sharded}>
          <label>
            {t("readings.shard")}
            <input
              name="readings-shard"
              value={shardInput()}
              onInput={(e) => setShardInput(e.currentTarget.value)}
            />
          </label>
        </Show>
        <label>
          {t("readings.room")}
          <input
            name="readings-room"
            placeholder="W13S28"
            value={roomInput()}
            onInput={(e) => setRoomInput(e.currentTarget.value)}
          />
        </label>
        <button type="submit">{t("readings.watch")}</button>
      </form>
      <dl class="readings__values">
        <dt>{t("readings.state")}</dt>
        <dd data-testid="readings-state">{t(STATE_KEYS[state()])}</dd>
        <dt>{t("readings.room")}</dt>
        <dd data-testid="readings-room">
          {(() => {
            const current = target();
            if (!current) return "—";
            return current.shard ? `${current.shard}/${current.room}` : current.room;
          })()}
        </dd>
        <dt>{t("readings.gameTime")}</dt>
        <dd data-testid="readings-game-time">{gameTime() ?? "—"}</dd>
        <dt>{t("readings.frames")}</dt>
        <dd data-testid="readings-frames">{frames()}</dd>
      </dl>
      <Show when={error()}>
        {(failed) => (
          <p class="settings__error" role="alert" data-testid="readings-error">
            {failed().kind === "replaced"
              ? t("readings.error.replaced")
              : t("readings.error.server", { message: failed().message })}
          </p>
        )}
      </Show>
    </section>
  );
}
