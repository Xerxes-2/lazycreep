/**
 * PvP Overview 每个房间的参战者（#34），每人一行（#39）：名字、GCL、物体数（roomMap2 位置点，含建筑），盟友有标记。
 * 数据来自 combatant-feed.ts；sectionCombatants 把它接到 Sidebar Section 的上下文上。
 */
import { For, Match, Switch } from "solid-js";
import { useI18n } from "../i18n";
import { BadgeIcon } from "../badge/BadgeIcon.tsx";
import type { Accessor } from "solid-js";
import { createCombatantFeed, type CombatantFeed, type RoomCombatants } from "./combatant-feed.ts";
import type { PvpFeed } from "./pvp-feed.ts";
import type { Source } from "../source/source.ts";
import type { RoomMapHub } from "../source/room-map-hub.ts";
import type { Settings } from "../settings/settings.ts";

/** 在 PvP 区块里建参战者 feed：区块不在屏幕上时退订，无 token 时不订阅 */
export function sectionCombatants(
  ctx: {
    readonly source: Accessor<Source>;
    readonly roomMaps: Accessor<RoomMapHub>;
    readonly pvp: PvpFeed;
    readonly settings: Settings;
    readonly allies: Accessor<ReadonlySet<string> | undefined>;
  },
  shown: Accessor<boolean>,
): CombatantFeed {
  return createCombatantFeed({
    source: ctx.source,
    roomMaps: ctx.roomMaps,
    groups: ctx.pvp.groups,
    active: shown,
    canSubscribe: () => !!ctx.settings.token(),
    allies: () => ctx.allies() ?? new Set(),
  });
}

/** 参战者列表的条目（#39：每人一行，放在卡片的 <ul data-combatants> 里） */
export function PvpCombatants(props: { readonly state: RoomCombatants }) {
  const { t } = useI18n();
  return (
    <Switch>
      <Match when={props.state.kind === "needsToken"}>
        <li class="settings__muted">{t("pvpCombatants.needsToken")}</li>
      </Match>
      <Match when={props.state.kind === "unwatched"}>
        <li class="settings__muted">{t("pvpCombatants.unwatched")}</li>
      </Match>
      <Match when={props.state.kind === "waiting"}>
        <li class="settings__muted">{t("pvpCombatants.waiting")}</li>
      </Match>
      <Match when={props.state.kind === "ready" && props.state.players}>
        {(players) => (
          <For each={players()} fallback={<li class="settings__muted">{t("pvpCombatants.none")}</li>}>
            {(player) => (
              <li
                class="pvp-overview__player"
                data-player={player.id}
                data-objects={player.objects}
                data-ally={player.ally ? "" : undefined}
              >
                <BadgeIcon badge={player.badge} />
                {player.username ?? player.id}
                {player.gcl === undefined ? "" : ` · ${t("pvpCombatants.gcl", { level: player.gcl })}`}
                {` · ${t("pvpCombatants.objects", { count: player.objects })}`}
                {player.ally ? ` · ${t("pvpCombatants.ally")}` : ""}
              </li>
            )}
          </For>
        )}
      </Match>
    </Switch>
  );
}
