import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, untrack, type Accessor, type JSX } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { Translate } from "../i18n/translator.ts";
import { SourceError, type ServerConfig, type Source } from "../source/source.ts";
import type { Settings } from "./settings.ts";
import { useSharedSource } from "../source/use-shared-source.ts";

/** 按 Server 与 token 建 Source；应用里是 LiveSource，测试里是 FixtureSource。 */
export type SourceFactory = (server: ServerConfig, token: string | undefined) => Source;

type Async<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "error"; readonly error: unknown };

/** 依赖变化时重新请求；旧请求的结果被丢弃。`start` 返回 undefined 表示不请求。 */
function createAsync<T>(start: () => (() => Promise<T>) | undefined): Accessor<Async<T>> {
  const [result, setResult] = createSignal<Async<T>>({ state: "idle" });
  createEffect(() => {
    const run = start();
    if (!run) {
      setResult({ state: "idle" });
      return;
    }
    let current = true;
    onCleanup(() => (current = false));
    setResult({ state: "loading" });
    untrack(run).then(
      (value) => current && setResult({ state: "ready", value }),
      (error: unknown) => current && setResult({ state: "error", error }),
    );
  });
  return result;
}

export function errorMessage(t: Translate<MessageKey>, error: unknown): string {
  if (error instanceof SourceError) {
    switch (error.kind) {
      case "unauthorized":
        return t("error.unauthorized");
      case "forbidden":
        return t("error.forbidden");
      case "rateLimited":
        return t("error.rateLimited");
      case "http":
        return t("error.http", { status: error.status ?? "?" });
      case "server":
        return t("error.server", { message: error.message });
      case "network":
        return t("error.network");
    }
  }
  return t("error.unknown", { message: error instanceof Error ? error.message : String(error) });
}

function AsyncView<T>(props: { value: Async<T>; idle?: JSX.Element; children: (value: T) => JSX.Element }) {
  const { t } = useI18n();
  return (
    <Switch>
      <Match when={props.value.state === "idle"}>{props.idle}</Match>
      <Match when={props.value.state === "loading"}>
        <span class="settings__muted">{t("settings.loading")}</span>
      </Match>
      <Match when={props.value.state === "error" && props.value}>
        {(failed) => (
          <span class="settings__error" role="alert">
            {errorMessage(t, (failed() as { error: unknown }).error)}
          </span>
        )}
      </Match>
      <Match when={props.value.state === "ready" && props.value}>
        {(ready) => props.children((ready() as { value: T }).value)}
      </Match>
    </Switch>
  );
}

function CustomServerForm(props: { settings: Settings }) {
  const { t } = useI18n();
  const [name, setName] = createSignal("");
  const [apiRoot, setApiRoot] = createSignal("");
  const [socketUrl, setSocketUrl] = createSignal("");
  const [sharded, setSharded] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const added = props.settings.addCustomServer({
      name: name(),
      apiRoot: apiRoot(),
      socketUrl: socketUrl(),
      sharded: sharded(),
    });
    setInvalid(!added);
    if (added) {
      setName("");
      setApiRoot("");
      setSocketUrl("");
      setSharded(false);
    }
  };

  return (
    <details class="settings__custom">
      <summary>{t("settings.custom.title")}</summary>
      <form data-testid="custom-server" onSubmit={submit}>
        <label>
          {t("settings.custom.name")}
          <input name="custom-name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>
          {t("settings.custom.apiRoot")}
          <input
            name="custom-api-root"
            placeholder={t("settings.custom.apiRootHint")}
            value={apiRoot()}
            onInput={(e) => setApiRoot(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("settings.custom.socketUrl")}
          <input
            name="custom-socket-url"
            placeholder="wss://"
            value={socketUrl()}
            onInput={(e) => setSocketUrl(e.currentTarget.value)}
          />
        </label>
        <label class="settings__inline">
          <input
            type="checkbox"
            name="custom-sharded"
            checked={sharded()}
            onChange={(e) => setSharded(e.currentTarget.checked)}
          />
          {t("settings.custom.sharded")}
        </label>
        <Show when={invalid()}>
          <p class="settings__error" role="alert">
            {t("settings.custom.invalid")}
          </p>
        </Show>
        <button type="submit">{t("settings.custom.add")}</button>
      </form>
    </details>
  );
}

/** 设置页：选 Server 与 Shard、填 token，并显示所选 Server 的时间、Shard 列表与 token 身份。 */
export function SettingsPage(props: { settings: Settings; sourceFor: SourceFactory }) {
  const { t } = useI18n();
  const settings = props.settings;

  const source = useSharedSource(props.sourceFor, settings);

  const shards = createAsync(() => {
    const src = source();
    return src.server.sharded ? () => src.getShards() : undefined;
  });

  /** 选过且仍存在的 Shard，否则第一个；不分 Shard 的 Server 为空串。 */
  const shard = createMemo<string | undefined>(() => {
    if (!settings.server().sharded) return "";
    const list = shards();
    if (list.state !== "ready") return undefined;
    const names = list.value.map((s) => s.name);
    const chosen = settings.shard();
    return chosen !== undefined && names.includes(chosen) ? chosen : names[0];
  });

  const time = createAsync(() => {
    const src = source();
    const current = shard();
    return current === undefined ? undefined : () => src.getTime(current);
  });

  const identity = createAsync(() => {
    const src = source();
    return settings.token() ? () => src.getMe() : undefined;
  });

  return (
    <section class="settings" aria-labelledby="settings-title">
      <h2 id="settings-title">{t("settings.title")}</h2>

      <fieldset class="settings__group">
        <legend>{t("settings.connection")}</legend>

        <label>
          {t("settings.server")}
          <select name="server" onChange={(e) => settings.selectServer(e.currentTarget.value)}>
            <For each={settings.servers()}>
              {(server) => (
                <option value={server.id} selected={server.id === settings.server().id}>
                  {server.name}
                </option>
              )}
            </For>
          </select>
        </label>
        <Show when={settings.isCustom(settings.server().id)}>
          <button type="button" onClick={() => settings.removeCustomServer(settings.server().id)}>
            {t("settings.server.remove")}
          </button>
        </Show>
        <CustomServerForm settings={settings} />

        <label>
          {t("settings.token")}
          <input
            type="password"
            name="token"
            autocomplete="off"
            spellcheck={false}
            placeholder={t("settings.token.placeholder")}
            value={settings.token()}
            onChange={(e) => settings.setToken(e.currentTarget.value)}
          />
        </label>
        <div class="settings__help" data-testid="token-help">
          <p>{t("settings.token.whyFull")}</p>
          <p>{t("settings.token.safety")}</p>
        </div>

        <Show when={settings.server().sharded}>
          <label>
            {t("settings.shard")}
            <select name="shard" onChange={(e) => settings.setShard(e.currentTarget.value)}>
              <Show when={shards().state === "ready"}>
                <For each={(shards() as { value: readonly { name: string }[] }).value}>
                  {(info) => (
                    <option value={info.name} selected={info.name === shard()}>
                      {info.name}
                    </option>
                  )}
                </For>
              </Show>
            </select>
          </label>
        </Show>
      </fieldset>

      <fieldset class="settings__group">
        <legend>{t("settings.status")}</legend>
        <dl class="settings__status">
          <dt>{t("settings.identity")}</dt>
          <dd data-testid="identity">
            <AsyncView value={identity()} idle={<span>{t("settings.identity.noToken")}</span>}>
              {(me) => <span>{t("settings.identity.ok", { username: me.username })}</span>}
            </AsyncView>
          </dd>
          <dt>{t("settings.time")}</dt>
          <dd data-testid="server-time">
            <AsyncView value={time()} idle={<AsyncView value={shards()}>{() => null}</AsyncView>}>
              {(tick) => <span>{t("settings.time.value", { time: tick })}</span>}
            </AsyncView>
          </dd>
        </dl>
        <Show when={settings.server().sharded}>
          <h3>{t("settings.shards")}</h3>
          <div data-testid="shard-list">
            <AsyncView value={shards()}>
              {(list) => (
                <table class="settings__shards">
                  <thead>
                    <tr>
                      <th>{t("settings.shards.name")}</th>
                      <th>{t("settings.shards.rooms")}</th>
                      <th>{t("settings.shards.users")}</th>
                      <th>{t("settings.shards.tick")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={list}>
                      {(info) => (
                        <tr>
                          <td>{info.name}</td>
                          <td>{info.rooms}</td>
                          <td>{info.users}</td>
                          <td>{t("settings.shards.tickMs", { ms: Math.round(info.tickMs) })}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              )}
            </AsyncView>
          </div>
        </Show>
      </fieldset>
    </section>
  );
}
