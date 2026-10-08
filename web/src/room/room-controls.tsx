/**
 * Room View 的交互（#12）：画布手势（缩放、平移、点选）、每个房间的视口持久化、
 * 详情卡。RoomView 只负责把这些接到数据流上。
 */
import { createEffect, createSignal, For, Index, on, onCleanup, Show, type Accessor } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { attachGestures } from "../scene/pointer-gestures.ts";
import type { SceneView } from "../scene/pixi-scene-view.ts";
import type { Scene } from "../scene/scene.ts";
import {
  clampCamera,
  fromViewport,
  nextPick,
  panBy,
  pickObjects,
  screenToWorld,
  toViewport,
  zoomAround,
  type Camera,
} from "../scene/scene-camera.ts";
import type { RoomUser } from "../source/source.ts";
import type { KeyValueStorage } from "../storage/local-store.ts";
import { loadCamera, saveCamera } from "./room-camera-store.ts";
import { BodyGrid } from "./BodyGrid.tsx";
import { describeObject } from "./object-details.ts";
import type { RoomObject } from "./room-state.ts";

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export interface RoomControlsOptions {
  readonly view: Accessor<SceneView | undefined>;
  readonly size: Accessor<CanvasSize>;
  /** 当前房间的视口存储键；换房间时恢复该房间的视口并清掉选中 */
  readonly cameraKey: Accessor<string | undefined>;
  readonly storage: KeyValueStorage | undefined;
  /** 点选时查询的 Scene（不追踪） */
  readonly scene: Accessor<Scene | undefined>;
  /** 世界尺寸（格） */
  readonly world: CanvasSize;
}

export interface RoomControls {
  /** 画布上 1 格对应的像素数 */
  readonly zoom: Accessor<number>;
  readonly selectedId: Accessor<string | undefined>;
  select(id: string | undefined): void;
  /** 以画布中心为基点缩放（左侧按钮列，#26）；factor > 1 放大 */
  zoomBy(factor: number): void;
}

export function createRoomControls(options: RoomControlsOptions): RoomControls {
  const { world } = options;
  const fitted: Camera = { cx: world.width / 2, cy: world.height / 2, span: Math.max(world.width, world.height) };
  const [camera, setCamera] = createSignal<Camera>(fitted);
  const [selectedId, setSelectedId] = createSignal<string>();

  createEffect(
    on(options.cameraKey, (key) => {
      setSelectedId(undefined);
      setCamera((key && loadCamera(options.storage, key)) || fitted);
    }),
  );

  const viewport = () => {
    const { width, height } = options.size();
    return toViewport(clampCamera(camera(), world), width, height);
  };
  const zoom = () => viewport().scale;

  createEffect(() => {
    const v = options.view();
    if (v) v.setViewport(viewport());
  });

  const update = (next: ReturnType<typeof viewport>) => {
    const { width, height } = options.size();
    setCamera(clampCamera(fromViewport(next, width, height), world));
  };
  const save = () => {
    const key = options.cameraKey();
    if (key) saveCamera(options.storage, key, camera());
  };

  createEffect(() => {
    const v = options.view();
    if (!v) return;
    const detach = attachGestures(v.canvas, {
      pan: (dx, dy) => update(panBy(viewport(), dx, dy)),
      zoom: (x, y, factor) => update(zoomAround(viewport(), x, y, factor)),
      end: save,
      tap: (x, y) => {
        const scene = options.scene();
        if (!scene) return;
        const point = screenToWorld(viewport(), x, y);
        // 按格子选：点在格子里任意位置都算点中格子上的对象
        const ids = pickObjects(scene, Math.floor(point.x) + 0.5, Math.floor(point.y) + 0.5);
        setSelectedId((current) => nextPick(ids, current));
      },
    });
    onCleanup(detach);
  });

  return {
    zoom,
    selectedId,
    select: setSelectedId,
    zoomBy(factor) {
      const { width, height } = options.size();
      update(zoomAround(viewport(), width / 2, height / 2, factor));
      save();
    },
  };
}

export interface RoomDetailsPanelProps {
  readonly object: RoomObject | undefined;
  readonly users: Readonly<Record<string, RoomUser>>;
  readonly gameTime: number | undefined;
  readonly onClose: () => void;
}

/** 选中对象的详情：宽屏为侧栏、窄屏为底部卡片（CSS 断点）。 */
export function RoomDetailsPanel(props: RoomDetailsPanelProps) {
  const { t } = useI18n();
  const details = () => (props.object ? describeObject(props.object, props.users, props.gameTime) : undefined);
  return (
    <Show when={details()}>
      {(d) => (
        <aside class="room-details" data-testid="room-details" aria-label={t("roomDetails.title")}>
          <header class="room-details__header">
            <h3>{t("roomDetails.title")}</h3>
            <button type="button" data-action="close-details" onClick={() => props.onClose()}>
              {t("roomDetails.close")}
            </button>
          </header>
          <dl class="room-details__fields">
            {/* 按位置复用 DOM：每 Tick 重算详情时部件网格不重建，悬停 / 长按的说明不被打断 */}
            <Index each={d().fields}>
              {(field) => (
                <>
                  <dt data-label={field().key}>{t(`roomDetails.field.${field().key}` as MessageKey)}</dt>
                  <dd data-field={field().key}>
                    <Show when={field().key === "body" && d().body} fallback={field().value}>
                      {(cells) => <BodyGrid objectId={d().id} cells={cells()} summary={field().value} />}
                    </Show>
                  </dd>
                </>
              )}
            </Index>
          </dl>
          <Show when={d().raw.length > 0}>
            <details class="room-details__raw">
              <summary>{t("roomDetails.raw")}</summary>
              <dl>
                <For each={d().raw}>
                  {([key, value]) => (
                    <>
                      <dt>{key}</dt>
                      <dd data-raw={key}>{value}</dd>
                    </>
                  )}
                </For>
              </dl>
            </details>
          </Show>
        </aside>
      )}
    </Show>
  );
}
