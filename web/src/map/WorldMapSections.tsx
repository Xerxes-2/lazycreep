/**
 * World Map 模式下的 Sidebar Section（#28）：房间搜索、图层开关、指向房间信息。
 * 与地图之间只经 WorldMapLink（居中、指向房间）与 MapLayerPrefs（图层开关）。
 */
import { createSignal, For, Show } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { MAP_LAYER_TOGGLES, type MapLayerPrefs, type MapLayerToggle } from "./map-layer-toggles.ts";
import type { WorldMapLink } from "./world-map-link.ts";

/** 回车把地图居中到房间（相机由地图负责）；不是房间名时提示 */
export function RoomSearchSection(props: { link: WorldMapLink }) {
  const { t } = useI18n();
  const [text, setText] = createSignal("");
  const [miss, setMiss] = createSignal<string>();
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const query = text().trim();
    const result = props.link.centerOn(query);
    if (result === undefined) return;
    setMiss(result ? undefined : query);
  };
  return (
    <div class="map-search">
      <form role="search" onSubmit={onSubmit}>
        <input
          name="world-map-search"
          aria-label={t("mapInfo.search")}
          placeholder={t("mapInfo.search.placeholder")}
          autocomplete="off"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </form>
      <Show when={miss()}>
        {(room) => (
          <p class="settings__error" role="alert">
            {t("mapInfo.search.notFound", { room: room() })}
          </p>
        )}
      </Show>
    </div>
  );
}

const LAYER_LABEL: Record<MapLayerToggle, MessageKey> = {
  ownership: "worldMapSidebar.layers.ownership",
  rcl: "worldMapSidebar.layers.rcl",
  minerals: "worldMapSidebar.layers.minerals",
  powerBanks: "worldMapSidebar.layers.powerBanks",
  zones: "worldMapSidebar.layers.zones",
  pvp: "worldMapSidebar.layers.pvp",
  nukes: "worldMapSidebar.layers.nukes",
  units: "worldMapSidebar.layers.units",
  badges: "badge.mapLayer",
};

export function MapLayersSection(props: { prefs: MapLayerPrefs }) {
  const { t } = useI18n();
  return (
    <ul class="map-layers">
      <For each={MAP_LAYER_TOGGLES}>
        {(toggle) => (
          <li>
            <label>
              <input
                type="checkbox"
                name={`map-layer-${toggle}`}
                checked={props.prefs.enabled()[toggle]}
                onChange={(e) => props.prefs.set(toggle, e.currentTarget.checked)}
              />
              {t(LAYER_LABEL[toggle])}
            </label>
          </li>
        )}
      </For>
    </ul>
  );
}

export function PointedRoomSection(props: { link: WorldMapLink }) {
  const { t } = useI18n();
  return (
    <Show
      when={props.link.pointed()}
      fallback={<p class="settings__muted">{t("worldMapSidebar.pointed.empty")}</p>}
    >
      {(pointed) => (
        <dl class="map-pointed">
          <dt class="map-pointed__room">{pointed().room}</dt>
          <Show when={pointed().shard}>
            <dd class="settings__muted">{pointed().shard}</dd>
          </Show>
          <Show
            when={pointed().owner}
            fallback={<dd class="settings__muted">{t("worldMapSidebar.pointed.noOwner")}</dd>}
          >
            {(owner) => (
              <>
                <dt>{t("worldMapSidebar.pointed.owner")}</dt>
                <dd>{owner().username}</dd>
                <dt>{t("worldMapSidebar.pointed.rcl")}</dt>
                <dd>{owner().rcl ?? t("worldMapSidebar.pointed.reserved")}</dd>
              </>
            )}
          </Show>
        </dl>
      )}
    </Show>
  );
}
