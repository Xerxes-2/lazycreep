/**
 * PvP Overview（#3）：按 Shard 分组列出时间窗内有战斗的房间（所有者、最后战斗 Tick）与飞行中的核弹。
 * 点房间进入 Room View；“回看”打开该房间的 Replay，从最后战斗 Tick 往前一小段开始。
 *
 * 列表只显示房间所有者：PvP 接口只给房间与 lastPvpTime，“涉及玩家”要读房间数据才知道，
 * 点进 Room View / Replay 后在房间里看。固定布局；面板系统见 #2。
 */
import { For, Show } from "solid-js";
import { useI18n } from "../i18n";
import { openReplay } from "../replay/replay-controller.ts";
import { errorMessage } from "../settings/SettingsPage.tsx";
import type { PvpFeed } from "./pvp-feed.ts";
import { PVP_WINDOWS, battleReplayTick, type RoomOwner } from "./pvp-overview.ts";

export interface PvpOverviewProps {
  readonly feed: PvpFeed;
  /** 进入某房间的 Room View */
  readonly onOpenRoom: (target: { readonly shard: string; readonly room: string }) => void;
  /** 打开 Replay；默认走 #15 的 hash 路由 openReplay */
  readonly onReplay?: (target: { readonly shard: string; readonly room: string; readonly tick: number }) => void;
}

export function PvpOverview(props: PvpOverviewProps) {
  const { t } = useI18n();
  const feed = props.feed;

  const ownerText = (owner: RoomOwner) => {
    switch (owner.kind) {
      case "unknown":
        return t("pvp.owner.unknown");
      case "none":
        return t("pvp.owner.none");
      case "reserved":
        return t("pvp.owner.reserved", { name: owner.username ?? owner.userId });
      case "owned":
        return t("pvp.owner.owned", { name: owner.username ?? owner.userId, level: owner.level });
    }
  };

  const replay = (shard: string, room: string, lastPvpTime: number) => {
    const target = { shard, room, tick: battleReplayTick(lastPvpTime) };
    if (props.onReplay) props.onReplay(target);
    else openReplay({ ...target, latest: true });
  };

  return (
    <section class="pvp-overview" aria-labelledby="pvp-overview-title">
      <h2 id="pvp-overview-title">{t("pvp.title")}</h2>
      <div class="pvp-overview__bar" role="group" aria-label={t("pvp.window")}>
        <span>{t("pvp.window")}</span>
        <For each={PVP_WINDOWS}>
          {(window) => (
            <button
              type="button"
              data-window={window}
              aria-pressed={feed.window() === window}
              onClick={() => feed.setWindow(window)}
            >
              {t("pvp.windowTicks", { ticks: window })}
            </button>
          )}
        </For>
      </div>
      <Show when={feed.error()}>
        {(error) => (
          <p class="settings__error" role="alert">
            {errorMessage(t, error())}
          </p>
        )}
      </Show>
      <Show when={feed.groups()} fallback={<Show when={!feed.error()}><p class="settings__muted">{t("pvp.loading")}</p></Show>}>
        {(groups) => (
          <Show when={groups().length > 0} fallback={<p class="settings__muted">{t("pvp.noShards")}</p>}>
            <For each={groups()}>
              {(group) => (
                <section class="pvp-overview__shard" data-shard={group.shard}>
                  <h3>
                    {group.shard || t("pvp.defaultShard")}
                    <Show when={group.time !== undefined}>
                      <span class="settings__muted"> · {t("pvp.shardTime", { tick: group.time! })}</span>
                    </Show>
                  </h3>
                  <Show when={group.rooms.length > 0} fallback={<p class="settings__muted">{t("pvp.empty")}</p>}>
                    <table class="pvp-overview__rooms">
                      <thead>
                        <tr>
                          <th scope="col">{t("pvp.col.room")}</th>
                          <th scope="col">{t("pvp.col.owner")}</th>
                          <th scope="col">{t("pvp.col.last")}</th>
                          <th scope="col" aria-label={t("pvp.col.actions")} />
                        </tr>
                      </thead>
                      <tbody>
                        <For each={group.rooms}>
                          {(entry) => (
                            <tr data-room={entry.room}>
                              <td>
                                <button
                                  type="button"
                                  data-action="open-room"
                                  onClick={() => props.onOpenRoom({ shard: group.shard, room: entry.room })}
                                >
                                  {entry.room}
                                </button>
                              </td>
                              <td data-owner={entry.owner.kind}>{ownerText(entry.owner)}</td>
                              <td>
                                {entry.lastPvpTime}{" "}
                                <span class="settings__muted">{t("pvp.ago", { ticks: entry.ago })}</span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  data-action="replay-battle"
                                  onClick={() => replay(group.shard, entry.room, entry.lastPvpTime)}
                                >
                                  {t("pvp.replay")}
                                </button>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                  <Show when={group.nukes.length > 0}>
                    <h4>{t("pvp.nukes")}</h4>
                    <ul class="pvp-overview__nukes">
                      <For each={group.nukes}>
                        {(nuke) => (
                          <li data-nuke={nuke.id}>
                            <button
                              type="button"
                              data-action="open-room"
                              onClick={() => props.onOpenRoom({ shard: group.shard, room: nuke.room })}
                            >
                              {nuke.room}
                            </button>{" "}
                            {t("pvp.nuke", {
                              x: nuke.x,
                              y: nuke.y,
                              from: nuke.launchRoom,
                              tick: nuke.landTime,
                            })}
                            <Show when={nuke.landsIn !== undefined}>
                              {" "}
                              <span class="settings__muted">{t("pvp.landsIn", { ticks: nuke.landsIn! })}</span>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
              )}
            </For>
          </Show>
        )}
      </Show>
    </section>
  );
}
