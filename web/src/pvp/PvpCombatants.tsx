/**
 * PvP Overview 每个房间的参战者一行（#34）：名字、GCL、物体数（roomMap2 位置点，含建筑），盟友有标记。
 * 数据来自 combatant-feed.ts；sectionCombatants 把它接到 Sidebar Section 的上下文上。
 */
import { For, Match, Switch } from "solid-js";
import { useI18n } from "../i18n";
import type { Accessor } from "solid-js";
import { createCombatantFeed, type CombatantFeed, type RoomCombatants } from "./combatant-feed.ts";
import type { PvpFeed } from "./pvp-feed.ts";
import type { Source } from "../source/source.ts";
import type { Settings } from "../settings/settings.ts";

/** 在 PvP 区块里建参战者 feed：区块不在屏幕上时退订，无 token 时不订阅 */
export function sectionCombatants(
  ctx: {
    readonly source: Accessor<Source>;
    readonly pvp: PvpFeed;
    readonly settings: Settings;
    readonly allies: Accessor<ReadonlySet<string> | undefined>;
  },
  shown: Accessor<boolean>,
): CombatantFeed {
  return createCombatantFeed({
    source: ctx.source,
    groups: ctx.pvp.groups,
    active: shown,
    canSubscribe: () => !!ctx.settings.token(),
    allies: () => ctx.allies() ?? new Set(),
  });
}

export function PvpCombatants(props: { readonly state: RoomCombatants }) {
  const { t } = useI18n();
  return (
    <Switch>
      <Match when={props.state.kind === "needsToken"}>
        <span class="settings__muted">{t("pvpCombatants.needsToken")}</span>
      </Match>
      <Match when={props.state.kind === "unwatched"}>
        <span class="settings__muted">{t("pvpCombatants.unwatched")}</span>
      </Match>
      <Match when={props.state.kind === "waiting"}>
        <span class="settings__muted">{t("pvpCombatants.waiting")}</span>
      </Match>
      <Match when={props.state.kind === "ready" && props.state.players}>
        {(players) => (
          <For each={players()} fallback={<span class="settings__muted">{t("pvpCombatants.none")}</span>}>
            {(player) => (
              <span
                class="pvp-overview__player"
                data-player={player.id}
                data-objects={player.objects}
                data-ally={player.ally ? "" : undefined}
              >
                {player.username ?? player.id}
                {player.gcl === undefined ? "" : ` · ${t("pvpCombatants.gcl", { level: player.gcl })}`}
                {` · ${t("pvpCombatants.objects", { count: player.objects })}`}
                {player.ally ? ` · ${t("pvpCombatants.ally")}` : ""}
              </span>
            )}
          </For>
        )}
      </Match>
    </Switch>
  );
}
