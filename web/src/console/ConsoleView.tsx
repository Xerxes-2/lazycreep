/**
 * Console 的内容（#6，装在 Console Panel 里，见 shell/ConsolePanel.tsx）：当前用户的脚本输出按 Shard 归类持续滚动，可发送命令。
 * - 默认跟随当前 Shard（设置里选的），也可固定到某个 Shard（按 Server 记住）；
 * - 每个 Shard 保留最近若干条（可调，存浏览器），支持关键字过滤；
 * - 命令经 Source 发送；面板只提示“已发送 / 失败”，执行结果以 Console 频道回来的为准。
 * 页面隐藏期间 LiveSource 退订用户频道（#14），这段时间的日志不会保留。
 */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useI18n } from "../i18n";
import { errorMessage, type SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { browserStorage, type KeyValueStorage } from "../storage/local-store.ts";
import { appendConsole, emptyConsoleLog, filterConsole, type ConsoleLog } from "./console-log.ts";
import { createConsoleSettings, MAX_CONSOLE_LIMIT } from "./console-settings.ts";

export interface ConsoleViewProps {
  readonly settings: Settings;
  /** 应是全页共享的 Source（见 source/shared-source.ts） */
  readonly sourceFor: SourceFactory;
  /** 面板偏好的存储；默认浏览器 localStorage */
  readonly storage?: KeyValueStorage;
}

type SendStatus =
  | { readonly state: "idle" }
  | { readonly state: "sending" }
  | { readonly state: "sent" }
  | { readonly state: "error"; readonly message: string };

/** 离底部不到这么多像素时视为“在底部”，新输出到达时自动滚到底 */
const STICK_PX = 24;

export function ConsoleView(props: ConsoleViewProps) {
  const { t } = useI18n();
  const prefs = createConsoleSettings(props.storage ?? browserStorage());
  const settings = props.settings;

  // settings 的 server / token 按值判等：切 Shard 不会重建连接、清空日志
  const token = () => settings.token() || undefined;
  const source = createMemo(() => {
    const created = props.sourceFor(settings.server(), token());
    onCleanup(() => created.close());
    return created;
  });
  const sharded = () => source().server.sharded;

  const [shardList, setShardList] = createSignal<readonly string[]>([]);
  createEffect(() => {
    const src = source();
    setShardList([]);
    if (!src.server.sharded) return;
    let alive = true;
    src.getShards().then(
      (list) => alive && setShardList(list.map((s) => s.name)),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  const [log, setLog] = createSignal<ConsoleLog>(emptyConsoleLog());
  const [streamError, setStreamError] = createSignal<string>();
  createEffect(() => {
    const src = source();
    setLog(emptyConsoleLog());
    setStreamError(undefined);
    if (!token()) return;
    const off = src.subscribeConsole(
      (event) => setLog((current) => appendConsole(current, event, prefs.limit())),
      (error) => setStreamError(error.message),
    );
    onCleanup(off);
  });

  /** 设置里的当前 Shard：选过且仍存在的，否则第一个 */
  const currentShard = () => {
    const list = shardList();
    const chosen = settings.shard();
    if (list.length === 0) return chosen;
    return chosen !== undefined && list.includes(chosen) ? chosen : list[0];
  };
  const pinned = () => (sharded() ? prefs.pinned(settings.server().id) : undefined);
  /** 正在显示（也是命令发往）的 Shard；不分 Shard 的 Server 为 null */
  const shown = (): string | null | undefined => (sharded() ? (pinned() ?? currentShard()) : null);
  const options = createMemo(() => {
    const names = new Set(shardList());
    for (const s of log().shards) if (s !== null) names.add(s);
    const p = pinned();
    if (p !== undefined) names.add(p);
    return [...names];
  });

  const [keyword, setKeyword] = createSignal("");
  const visible = createMemo(() => {
    const shard = shown();
    return shard === undefined ? [] : filterConsole(log(), { shard, keyword: keyword() });
  });

  let output: HTMLDivElement | undefined;
  let stick = true;
  createEffect(
    on(visible, () => {
      if (output && stick) output.scrollTop = output.scrollHeight;
    }),
  );

  const [expression, setExpression] = createSignal("");
  const [status, setStatus] = createSignal<SendStatus>({ state: "idle" });
  const canSend = () => !!token() && shown() !== undefined && status().state !== "sending";
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const text = expression().trim();
    const shard = shown();
    if (!text || shard === undefined || !canSend()) return;
    setStatus({ state: "sending" });
    try {
      await source().sendConsole(shard ?? "", text);
      setStatus({ state: "sent" });
      setExpression("");
    } catch (error) {
      setStatus({ state: "error", message: errorMessage(t, error) });
    }
  };

  return (
    <section class="console-view" data-shard={shown() ?? ""}>
      <h2>{t("console.title")}</h2>
      <div class="console-view__bar">
        <Show when={sharded()}>
          <label>
            {t("console.shard")}
            <select
              name="console-shard"
              onChange={(e) => {
                const value = e.currentTarget.value;
                prefs.setPinned(settings.server().id, value === "" ? undefined : value);
              }}
            >
              <option value="" selected={pinned() === undefined}>
                {t("console.follow", { shard: currentShard() ?? "…" })}
              </option>
              <For each={options()}>
                {(name) => (
                  <option value={name} selected={pinned() === name}>
                    {name}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <label>
          {t("console.filter")}
          <input
            type="search"
            name="console-filter"
            value={keyword()}
            placeholder={t("console.filterPlaceholder")}
            onInput={(e) => setKeyword(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("console.limit")}
          <input
            type="number"
            name="console-limit"
            min="1"
            max={MAX_CONSOLE_LIMIT}
            value={prefs.limit()}
            onChange={(e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value) && value > 0) prefs.setLimit(value);
              e.currentTarget.value = String(prefs.limit());
            }}
          />
        </label>
        <button type="button" data-action="console-clear" onClick={() => setLog(emptyConsoleLog())}>
          {t("console.clear")}
        </button>
      </div>
      <p class="console-view__hint settings__muted">{t("console.hiddenHint")}</p>
      <Show when={!token()}>
        <p class="settings__muted">{t("console.noToken")}</p>
      </Show>
      <Show when={streamError()}>{(message) => <p role="alert">{t("console.streamError", { message: message() })}</p>}</Show>
      <div
        class="console-view__output"
        ref={output}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
      >
        <For each={visible()} fallback={<p class="settings__muted">{t("console.empty")}</p>}>
          {(entry) => (
            <div class="console-view__entry" data-console-entry data-kind={entry.kind}>
              {entry.text}
            </div>
          )}
        </For>
      </div>
      <form class="console-view__send" data-console-send onSubmit={submit}>
        <input
          type="text"
          name="console-expression"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="send"
          aria-label={t("console.expression")}
          placeholder={t("console.expression")}
          value={expression()}
          onInput={(e) => setExpression(e.currentTarget.value)}
        />
        <button type="submit" disabled={!canSend()}>
          {t("console.send")}
        </button>
      </form>
      <p class="console-view__status" data-console-status data-state={status().state} aria-live="polite">
        {(() => {
          const s = status();
          if (s.state === "sending") return t("console.sending");
          if (s.state === "sent") return t("console.sent");
          if (s.state === "error") return t("console.sendFailed", { message: s.message });
          return "";
        })()}
      </p>
    </section>
  );
}
