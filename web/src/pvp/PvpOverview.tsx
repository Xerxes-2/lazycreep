/**
 * PvP Overview（#3）：按 Shard 分组列出时间窗内有战斗的房间（所有者、最后战斗 Tick）与飞行中的核弹。
 * “进入房间”图标按钮进入 Room View；“回看”打开该房间的 Replay，从最后战斗 Tick 往前一小段开始。
 *
 * PvP 接口只给房间与 lastPvpTime；参战玩家（#34）由 combatants 给出（roomMap2，见 combatant-feed.ts）。
 * 放在 World Map 的 Sidebar 里（#24），每个房间一张适配 260px 的卡片（#39）：
 * 首行房间名、所有者与相对 Tick（完整 Tick 在提示里），其下参战者每人一行，右侧两个图标按钮。
 */
import { For, Show } from "solid-js";
import { useI18n } from "../i18n";
import { errorMessage } from "../settings/SettingsPage.tsx";
import { looksLikePve, type CombatantFeed } from "./combatant-feed.ts";
import { PveOpponents, PvpCombatants } from "./PvpCombatants.tsx";
import type { PvpFeed } from "./pvp-feed.ts";
import { PVP_WINDOWS, battleReplayTick, type PvpShardGroup, type RoomOwner } from "./pvp-overview.ts";

export interface PvpOverviewProps {
  /** pvp：玩家之间的战斗（另列飞行中的核弹）；pve：看起来是打 NPC 的房间（looksLikePve）。没有参战者数据的房间算 pvp */
  readonly mode: "pvp" | "pve";
  readonly feed: PvpFeed;
  /** 进入某房间的 Room View */
  readonly onOpenRoom: (target: { readonly shard: string; readonly room: string }) => void;
  /** 打开 Replay（外壳里是 shell.navigate） */
  readonly onReplay: (target: { readonly shard: string; readonly room: string; readonly tick: number }) => void;
  /** 参战玩家（#34）；不给时不显示参战者一行 */
  readonly combatants?: CombatantFeed;
}

/** 进入房间：箭头进门（内联 SVG，不引入图标库） */
function EnterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9.5 2.5h3v11h-3" />
      <path d="M2.5 8h7M7 5.5 9.5 8 7 10.5" />
    </svg>
  );
}

/** 回看：逆时针箭头 */
function ReplayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M3 2v3h3" />
      <path d="M7 6v4l3-2z" fill="currentColor" stroke-width="1" />
    </svg>
  );
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

  const pve = props.mode === "pve";
  const isPve = (shard: string, room: string) => props.combatants !== undefined && looksLikePve(props.combatants.of(shard, room));
  /** 本列表的房间：PvE 列表只要看起来是打 NPC 的，PvP 列表要其余的 */
  const listed = (group: PvpShardGroup) => group.rooms.filter((entry) => isPve(group.shard, entry.room) === pve);
  const titleId = `${props.mode}-overview-title`;

  const replay = (shard: string, room: string, lastPvpTime: number) => {
    const target = { shard, room, tick: battleReplayTick(lastPvpTime) };
    props.onReplay(target);
  };

  return (
    <section class="pvp-overview" data-mode={props.mode} aria-labelledby={titleId}>
      <h2 id={titleId}>{t(pve ? "pve.title" : "pvp.title")}</h2>
      <div class="pvp-overview__bar segmented" role="group" aria-label={t("pvp.window")}>
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
                  <h3 class="pvp-overview__shard-title">
                    <span class="pvp-overview__shard-name">{group.shard || t("pvp.defaultShard")}</span>
                    <Show when={group.time !== undefined}>
                      <span class="pvp-overview__shard-time settings__muted">{t("pvp.shardTime", { tick: group.time! })}</span>
                    </Show>
                  </h3>
                  <Show when={listed(group).length > 0} fallback={<p class="settings__muted">{t(pve ? "pve.empty" : "pvp.empty")}</p>}>
                    <ul class="pvp-overview__rooms">
                      <For each={listed(group)}>
                        {(entry) => {
                          const target = { shard: group.shard, room: entry.room };
                          const openLabel = () => t("pvp.openRoom", { room: entry.room });
                          const replayLabel = () => t("pvp.replayRoom", { room: entry.room });
                          return (
                            <li class="pvp-card" data-room={entry.room}>
                              <div class="pvp-card__head">
                                <span class="pvp-card__room">{entry.room}</span>
                                <span class="pvp-card__owner" data-owner={entry.owner.kind} title={ownerText(entry.owner)}>
                                  {ownerText(entry.owner)}
                                </span>
                              </div>
                              <span class="pvp-card__ago" title={t("pvp.lastTick", { tick: entry.lastPvpTime })}>
                                {t("pvp.ago", { ticks: entry.ago })}
                              </span>
                              <Show when={props.combatants}>
                                {(feed) => (
                                  <ul class="pvp-card__combatants" data-combatants={entry.room}>
                                    <Show when={pve}>
                                      <PveOpponents state={feed().of(group.shard, entry.room)} />
                                    </Show>
                                    <PvpCombatants state={feed().of(group.shard, entry.room)} />
                                  </ul>
                                )}
                              </Show>
                              <div class="pvp-card__actions">
                                <button
                                  type="button"
                                  class="icon-button"
                                  data-action="open-room"
                                  aria-label={openLabel()}
                                  title={openLabel()}
                                  onClick={() => props.onOpenRoom(target)}
                                >
                                  <EnterIcon />
                                </button>
                                <button
                                  type="button"
                                  class="icon-button"
                                  data-action="replay-battle"
                                  aria-label={replayLabel()}
                                  title={replayLabel()}
                                  onClick={() => replay(group.shard, entry.room, entry.lastPvpTime)}
                                >
                                  <ReplayIcon />
                                </button>
                              </div>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                  <Show when={!pve && group.nukes.length > 0}>
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
