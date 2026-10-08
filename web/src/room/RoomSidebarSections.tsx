/**
 * Room View 下的两个 Sidebar Section（#26）：房间信息、显示选项。
 * 区块表（shell/sidebar-sections.tsx）把它们按顺序插进 Room View 模式。
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { OwnershipHub } from "../map/ownership-hub.ts";
import type { ShellLocation } from "../shell/shell-state.ts";
import { ROOM_DISPLAY_KEYS, type RoomDisplayOptions } from "./display-options.ts";
import { roomInfo, type Until } from "./room-info.ts";
import type { RoomState } from "./room-state.ts";

export interface RoomInfoSectionProps {
  readonly location: Accessor<ShellLocation>;
  /** Room View 此刻显示的房间状态 */
  readonly roomState: Accessor<RoomState | undefined>;
  readonly ownership: Accessor<OwnershipHub>;
  /** 区块此刻是否在屏幕上；只在显示时补查 */
  readonly shown: Accessor<boolean>;
  /** 能否查 map-stats（需要 token） */
  readonly canLookup: Accessor<boolean>;
}

export function RoomInfoSection(props: RoomInfoSectionProps) {
  const { t, locale } = useI18n();

  // 新手区与重生区只有 map-stats 有：区块显示时为当前房间认领一次补查（与地图共用额度），
  // 不必等 World Map 或 Minimap 碰巧取到；隐藏或换房间时释放
  // 只随房间变化（Replay 的 Tick 变化不重新认领）
  const shard = createMemo(() => props.location().shard ?? "");
  const room = createMemo(() => props.location().room);
  createEffect(() => {
    const current = room();
    if (current === undefined || !props.shown() || !props.canLookup()) return;
    onCleanup(props.ownership().wantRooms([{ shard: shard(), room: current }]));
  });

  // OwnershipHub 不是信号：取到新结果时重新读
  const [revision, setRevision] = createSignal(0);
  createEffect(() => {
    const hub = props.ownership();
    onCleanup(hub.subscribe(() => setRevision((n) => n + 1)));
  });

  const info = createMemo(() => {
    const { room, shard } = props.location();
    if (room === undefined) return undefined;
    revision();
    return roomInfo({
      room,
      state: props.roomState(),
      stats: props.ownership().stats(shard ?? ""),
      now: Date.now(),
    });
  });

  const unknown = () => t("roomSidebar.info.unknown");
  const until = (value: Until) =>
    value === undefined
      ? unknown()
      : value === false
        ? t("roomSidebar.info.no")
        : t("roomSidebar.info.until", { date: new Date(value).toLocaleString(locale()) });

  return (
    <Show when={info()} fallback={<p class="settings__muted">{t("roomSidebar.info.empty")}</p>}>
      {(current) => {
        const rows = (): Array<[string, MessageKey, string]> => {
          const i = current();
          const safe = i.safeMode;
          return [
            ["room", "roomSidebar.info.room", i.room],
            ["owner", "roomSidebar.info.owner", i.owner ?? unknown()],
            ...(i.reservedBy === undefined
              ? []
              : ([["reservedBy", "roomSidebar.info.reservedBy", i.reservedBy]] as Array<[string, MessageKey, string]>)),
            ["level", "roomSidebar.info.level", i.level === undefined ? unknown() : String(i.level)],
            ["novice", "roomSidebar.info.novice", until(i.novice)],
            ["respawnArea", "roomSidebar.info.respawnArea", until(i.respawnArea)],
            [
              "safeMode",
              "roomSidebar.info.safeMode",
              safe === undefined
                ? unknown()
                : safe === false
                  ? t("roomSidebar.info.no")
                  : safe === true
                    ? t("roomSidebar.info.yes")
                    : t("roomSidebar.info.safeModeTicks", { ticks: safe }),
            ],
            [
              "sign",
              "roomSidebar.info.sign",
              i.sign === undefined
                ? unknown()
                : i.sign.user === undefined
                  ? i.sign.text
                  : t("roomSidebar.info.signedBy", { text: i.sign.text, user: i.sign.user }),
            ],
          ];
        };
        return (
          <dl class="room-info">
            <For each={rows()}>
              {([key, label, value]) => (
                <>
                  <dt>{t(label)}</dt>
                  <dd data-info={key}>{value}</dd>
                </>
              )}
            </For>
          </dl>
        );
      }}
    </Show>
  );
}

const DISPLAY_LABELS: Readonly<Record<(typeof ROOM_DISPLAY_KEYS)[number], MessageKey>> = {
  say: "roomSidebar.display.say",
  visual: "roomSidebar.display.visual",
  bars: "roomSidebar.display.bars",
  names: "roomSidebar.display.names",
  lighting: "roomSidebar.display.lighting",
};

export function DisplayOptionsSection(props: { readonly options: RoomDisplayOptions }) {
  const { t } = useI18n();
  return (
    <div class="display-options">
      <For each={ROOM_DISPLAY_KEYS}>
        {(key) => (
          <label class="display-options__item">
            <input
              type="checkbox"
              name={`display-${key}`}
              checked={props.options.display()[key]}
              onChange={(e) => props.options.set(key, e.currentTarget.checked)}
            />
            {t(DISPLAY_LABELS[key])}
          </label>
        )}
      </For>
    </div>
  );
}
