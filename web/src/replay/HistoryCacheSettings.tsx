/**
 * 设置页里的“历史缓存”一组：调整上限（MB），显示当前占用。改上限立即按新上限淘汰。
 */
import { createResource, createSignal, Show } from "solid-js";
import { useI18n } from "../i18n";
import type { HistoryCache } from "./history-cache.ts";
import {
  browserReplayStorage,
  createReplaySettings,
  mbToBytes,
  sharedHistoryCache,
  type ReplaySettings,
} from "./replay-settings.ts";

export interface HistoryCacheSettingsProps {
  readonly settings?: ReplaySettings;
  readonly cache?: () => Promise<HistoryCache | undefined>;
}

export function HistoryCacheSettings(props: HistoryCacheSettingsProps) {
  const { t } = useI18n();
  const settings = props.settings ?? createReplaySettings(browserReplayStorage());
  const cache = props.cache ?? sharedHistoryCache;
  const [revision, setRevision] = createSignal(0);
  const [usage] = createResource(revision, async () => {
    const opened = await cache();
    if (!opened) return undefined;
    return opened.usage().catch(() => undefined);
  });

  const change = (value: string) => {
    const mb = Number(value);
    if (!Number.isFinite(mb) || mb <= 0) return;
    settings.setCacheLimitMb(mb);
    void cache()
      .then((opened) => opened?.setLimit(mbToBytes(mb)))
      .catch(() => {})
      .finally(() => setRevision((n) => n + 1));
  };

  return (
    <fieldset class="settings__group" data-testid="history-cache-settings">
      <legend>{t("replay.cache.title")}</legend>
      <label>
        {t("replay.cache.limit")}
        <input
          name="history-cache-limit"
          type="number"
          inputmode="numeric"
          min="1"
          value={settings.cacheLimitMb()}
          onChange={(e) => change(e.currentTarget.value)}
        />
      </label>
      <Show
        when={usage.state === "ready" && usage() !== undefined}
        fallback={
          <Show when={usage.state === "ready"}>
            <p>{t("replay.cache.unavailable")}</p>
          </Show>
        }
      >
        <p data-testid="history-cache-usage">
          {t("replay.cache.usage", { mb: ((usage() ?? 0) / 1024 / 1024).toFixed(1) })}
        </p>
      </Show>
    </fieldset>
  );
}
