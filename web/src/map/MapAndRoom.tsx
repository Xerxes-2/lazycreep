/**
 * World Map 与 Room View 的固定布局（面板系统见 #2）：在地图上点房间进入它的 Room View，
 * Room View 里“返回地图”回到地图。进入 Room View 时只隐藏地图、不卸载，所以返回时视口不变。
 */
import { createSignal } from "solid-js";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import { RoomView, type RoomViewProps } from "../room/RoomView.tsx";
import { MapView, type MapTarget } from "./MapView.tsx";

export interface MapAndRoomProps {
  readonly settings: Settings;
  readonly sourceFor: SourceFactory;
  /** 测试里换成假的 SceneView */
  readonly createView?: (options: SceneViewOptions) => Promise<SceneView>;
  /** 透传给 Room View 的其余选项（测试用） */
  readonly roomView?: Partial<RoomViewProps>;
}

export function MapAndRoom(props: MapAndRoomProps) {
  /** 从地图打开的房间；有值时地图隐藏 */
  const [opened, setOpened] = createSignal<MapTarget>();
  const scrollTo = (id: string) =>
    queueMicrotask(() => document.getElementById(id)?.scrollIntoView?.({ block: "start" }));

  return (
    <>
      <div class="world-map__host" hidden={opened() !== undefined}>
        <MapView
          settings={props.settings}
          sourceFor={props.sourceFor}
          {...(props.createView ? { createView: props.createView } : {})}
          onOpenRoom={(target) => {
            setOpened({ ...target });
            scrollTo("room-view-title");
          }}
        />
      </div>
      <RoomView
        settings={props.settings}
        sourceFor={props.sourceFor}
        {...(props.createView ? { createView: props.createView } : {})}
        {...props.roomView}
        open={opened()}
        onBack={
          opened()
            ? () => {
                setOpened(undefined);
                scrollTo("world-map-title");
              }
            : undefined
        }
      />
    </>
  );
}
