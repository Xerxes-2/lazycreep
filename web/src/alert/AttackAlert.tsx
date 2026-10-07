/**
 * Attack Alert 的投递：已授权时发系统通知，否则在页内横幅里列出；点击进入该房间的 Room View。
 * 横幅固定在视口顶部，放在哪个组件里都一样显示。
 */
import { createSignal, For, Show, type Accessor } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { Translate } from "../i18n/translator.ts";
import type { PvpFeed } from "../pvp/pvp-feed.ts";
import type { Source } from "../source/source.ts";
import type { Alert } from "./alert-detector.ts";
import type { AlertSettings } from "./alert-settings.ts";
import { createAttackAlert } from "./attack-alert.ts";

export interface AlertTarget {
  readonly shard: string;
  readonly room: string;
}

export interface AttackAlertProps {
  readonly source: Accessor<Source>;
  readonly feed: Pick<PvpFeed, "data" | "groups">;
  readonly enabled: Accessor<boolean>;
  readonly allies: Accessor<ReadonlySet<string>>;
  readonly settings: AlertSettings;
  /** 进入该房间的 Room View（MapAndRoom 的外部打开入口） */
  readonly onOpen: (target: AlertTarget) => void;
  readonly now?: () => number;
}

/** 告警的标题与正文 */
export function alertText(t: Translate<MessageKey>, alert: Alert): { title: string; body: string } {
  const where = alert.shard ? `${alert.shard} ${alert.room}` : alert.room;
  switch (alert.reason) {
    case "pvp":
      return { title: t("alert.pvp.title", { room: where }), body: t("alert.pvp.body", { tick: alert.lastPvpTime }) };
    case "nuke":
      return {
        title: t("alert.nuke.title", { room: where }),
        body: t("alert.nuke.body", { count: alert.count, from: alert.launchRoom, tick: alert.landTime }),
      };
    case "stranger":
      return {
        title: t("alert.stranger.title", { room: where }),
        body: t("alert.stranger.body", {
          names: alert.users.map((u) => u.username ?? u.id).join(", "),
          ticks: alert.ticks,
        }),
      };
  }
}

interface Banner {
  readonly id: number;
  readonly alert: Alert;
}

/** 横幅最多保留几条（最新的在前） */
const MAX_BANNERS = 5;

export function AttackAlert(props: AttackAlertProps) {
  const { t } = useI18n();
  const [banners, setBanners] = createSignal<readonly Banner[]>([]);
  let nextId = 0;

  const dismiss = (id: number) => setBanners((list) => list.filter((b) => b.id !== id));
  const open = (alert: Alert) => props.onOpen({ shard: alert.shard, room: alert.room });

  createAttackAlert({
    source: props.source,
    feed: props.feed,
    enabled: props.enabled,
    allies: props.allies,
    config: props.settings.config,
    ...(props.now ? { now: props.now } : {}),
    onAlert(alert) {
      const { title, body } = alertText(t, alert);
      if (props.settings.permission() === "granted") {
        props.settings.notifications.show(title, {
          body,
          tag: `${alert.shard}/${alert.room}/${alert.reason}`,
          onClick: () => open(alert),
        });
        return;
      }
      // 同房间同原因的新告警替换旧横幅
      setBanners((list) =>
        [
          { id: nextId++, alert },
          ...list.filter(
            (b) => !(b.alert.shard === alert.shard && b.alert.room === alert.room && b.alert.reason === alert.reason),
          ),
        ].slice(0, MAX_BANNERS),
      );
    },
  });

  return (
    <Show when={banners().length > 0}>
      <div class="attack-alert" role="alert" aria-live="assertive">
        <For each={banners()}>
          {(banner) => {
            const text = alertText(t, banner.alert);
            return (
              <div
                class="attack-alert__item"
                data-reason={banner.alert.reason}
                data-room={banner.alert.room}
              >
                <button
                  type="button"
                  class="attack-alert__open"
                  data-action="open-alert-room"
                  onClick={() => {
                    dismiss(banner.id);
                    open(banner.alert);
                  }}
                >
                  <strong>{text.title}</strong>
                  <span>{text.body}</span>
                </button>
                <button
                  type="button"
                  class="attack-alert__dismiss"
                  data-action="dismiss-alert"
                  aria-label={t("alert.dismiss")}
                  onClick={() => dismiss(banner.id)}
                >
                  ×
                </button>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
