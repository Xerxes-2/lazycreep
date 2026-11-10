/**
 * 调试信息叠加层：右下角，列出渲染接口、帧率上限、DPR，以及每个 Scene 视图的实际帧率、每帧 render 耗时与画布像素。
 * 不拦截指针；每半秒刷新一次。开关在 设置 → 外观。
 */
import { createSignal, For, onCleanup, Show } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import { debugOverlayEnabled, viewStats, type ViewStats } from "./debug-stats.ts";
import { frameRate } from "./frame-rate.ts";
import { activeRenderBackend } from "./render-backend.ts";

const REFRESH_MS = 500;

export function DebugOverlay() {
  return (
    <Show when={debugOverlayEnabled()}>
      <DebugPanel />
    </Show>
  );
}

function DebugPanel() {
  const { t } = useI18n();
  const [stats, setStats] = createSignal<ViewStats[]>(viewStats(performance.now()));
  const timer = setInterval(() => setStats(viewStats(performance.now())), REFRESH_MS);
  onCleanup(() => clearInterval(timer));
  const backend = () => {
    const active = activeRenderBackend();
    return active ? t(`customize.renderBackend.name.${active}` as MessageKey) : "—";
  };
  return (
    <div class="debug-overlay" data-testid="debug-overlay" aria-hidden="true">
      <div>
        {t("debug.summary", { backend: backend(), cap: t(`debug.cap.${frameRate()}` as MessageKey), dpr: String(globalThis.devicePixelRatio ?? 1) })}
      </div>
      <For each={stats()}>
        {(view) => (
          <div data-debug-view={view.label}>
            {t("debug.view", {
              label: view.label,
              fps: view.fps.toFixed(0),
              ms: view.renderMs === undefined ? "—" : view.renderMs.toFixed(1),
              size: `${view.width}×${view.height}`,
            })}
          </div>
        )}
      </For>
    </div>
  );
}
