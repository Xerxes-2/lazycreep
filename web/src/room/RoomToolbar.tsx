/**
 * Room View 左侧的按钮列（#26，照官方客户端）：回到 World Map、进入 Replay、放大、缩小。
 * 浮在画布左上；跳转由调用方经 shell.navigate 完成。
 */
import { Show } from "solid-js";
import { useI18n } from "../i18n";

/** 每按一次放大 / 缩小的倍数 */
export const ZOOM_STEP = 1.25;

export interface RoomToolbarProps {
  /** 不给时不显示“回到 World Map” */
  readonly onBack: (() => void) | undefined;
  /** 不给时不显示“进入 Replay”（没有房间或已在 Replay 中） */
  readonly onEnterReplay: (() => void) | undefined;
  readonly onZoom: (factor: number) => void;
}

export function RoomToolbar(props: RoomToolbarProps) {
  const { t } = useI18n();
  return (
    <div class="room-view__tools" role="toolbar" aria-label={t("roomSidebar.tools")} aria-orientation="vertical">
      <Show when={props.onBack}>
        {(back) => (
          <button type="button" data-action="back-to-map" title={t("worldMap.back")} onClick={() => back()()}>
            {t("worldMap.back")}
          </button>
        )}
      </Show>
      <Show when={props.onEnterReplay}>
        {(enter) => (
          <button type="button" data-action="replay-enter" title={t("replay.enter")} onClick={() => enter()()}>
            {t("replay.enter")}
          </button>
        )}
      </Show>
      <button
        type="button"
        data-action="zoom-in"
        aria-label={t("roomSidebar.zoomIn")}
        title={t("roomSidebar.zoomIn")}
        onClick={() => props.onZoom(ZOOM_STEP)}
      >
        +
      </button>
      <button
        type="button"
        data-action="zoom-out"
        aria-label={t("roomSidebar.zoomOut")}
        title={t("roomSidebar.zoomOut")}
        onClick={() => props.onZoom(1 / ZOOM_STEP)}
      >
        −
      </button>
    </div>
  );
}
