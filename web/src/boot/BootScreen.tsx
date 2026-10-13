/**
 * 启动画面（#33）：接管 index.html 里内联的 `#boot`，按 BootProgress 显示阶段与进度，
 * 完成后淡出并移除，露出下面早已挂好的外壳。页面上没有 `#boot`（测试、导入设置后重建）时什么也不做。
 *
 * 失败出口：token 被拒 →“打开设置”（进入应用并打开 Server 设置）；连不上 →“重试”（重新加载）与“仍要进入”；
 * 连不上而 API 被重定向（访问网关登录过期，见 access-gate.ts）→“重新登录”与“仍要进入”。
 * 没有 token 时不等任何阶段，直接进入并在 Menu 里打开 Server 设置引导填写（URL 指向 Replay 时不打扰）。
 */
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useI18n, type MessageKey } from "../i18n";
import { probeAccessGate, reauthUrl } from "./access-gate.ts";
import { BOOT_STAGES, type BootProgress, type BootStage } from "./boot-progress.ts";

/** 与 index.html 里 `#boot` 的淡出过渡一致 */
const FADE_MS = 300;

const STAGE_TEXT: Record<BootStage, MessageKey> = {
  program: "boot.stage.program",
  connect: "boot.stage.connect",
  auth: "boot.stage.auth",
  map: "boot.stage.map",
  frame: "boot.stage.frame",
};

export interface BootScreenProps {
  readonly progress: BootProgress;
  /** 启动时是否已填 token */
  readonly hasToken: boolean;
  /** URL 指向 Replay 等匿名可用的入口 */
  readonly anonymousRoute: () => boolean;
  /** 打开 Menu 里的 Server 设置 */
  readonly openSettings: () => void;
  /** 默认重新加载页面 */
  readonly retry?: () => void;
  /** 连不上时探测是否被访问网关拦下；默认 probeAccessGate */
  readonly probeGate?: () => Promise<boolean>;
  /** 默认导航到 reauthUrl，绕过 service worker 让访问网关接手 */
  readonly relogin?: () => void;
  /** 默认取 document 里的 `#boot` */
  readonly host?: HTMLElement | null;
}

export function BootScreen(props: BootScreenProps) {
  const host = props.host === undefined ? document.getElementById("boot") : props.host;
  if (!host) return null;
  const { t } = useI18n();
  const progress = props.progress;

  onMount(() => {
    if (props.hasToken) return;
    progress.finish();
    if (!props.anonymousRoute()) props.openSettings();
  });

  const status = progress.status;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const s = status();
    host.dataset["bootPhase"] = s.phase;
    if (s.phase !== "done") {
      host.dataset["bootStage"] = s.stage;
      return;
    }
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => host.remove(), FADE_MS);
  });
  onCleanup(() => clearTimeout(fadeTimer));

  // 内联的静态内容换成下面这份（同样的结构与类名，样式在 index.html 里）
  host.replaceChildren();

  const running = () => {
    const s = status();
    return s.phase === "done" ? undefined : s;
  };
  const failure = () => {
    const s = status();
    return s.phase === "failed" ? s.reason : undefined;
  };
  const enter = () => progress.finish();

  // 每次进入“连不上”都探一次：重试之间网关状态可能变了
  const [gated, setGated] = createSignal(false);
  createEffect(() => {
    if (failure() !== "network") return setGated(false);
    let live = true;
    onCleanup(() => (live = false));
    void (props.probeGate ?? probeAccessGate)().then((g) => live && setGated(g));
  });
  const errorText = (reason: "network" | "unauthorized"): MessageKey =>
    reason === "unauthorized" ? "boot.failed.unauthorized" : gated() ? "boot.failed.gate" : "boot.failed.network";

  return (
    <Portal mount={host}>
      <div class="boot__card">
        <p class="boot__name">{t("app.title")}</p>
        <div
          class="boot__bar"
          role="progressbar"
          aria-label={t("boot.progress")}
          aria-valuemin="0"
          aria-valuemax={BOOT_STAGES.length}
          aria-valuenow={running()?.done ?? BOOT_STAGES.length}
        >
          <div
            class="boot__fill"
            style={{ width: `${Math.round(((running()?.done ?? BOOT_STAGES.length) / BOOT_STAGES.length) * 100)}%` }}
          />
        </div>
        <p class="boot__text" data-boot-text>
          {t(STAGE_TEXT[running()?.stage ?? "frame"])}
        </p>
        <Show when={failure()}>
          {(reason) => (
            <>
              <p class="boot__error" role="alert">
                {t(errorText(reason()))}
              </p>
              <div class="boot__actions">
                <Show
                  when={reason() === "unauthorized"}
                  fallback={
                    <>
                      <Show
                        when={gated()}
                        fallback={
                          <button type="button" data-action="boot-retry" onClick={() => (props.retry ?? (() => location.reload()))()}>
                            {t("boot.retry")}
                          </button>
                        }
                      >
                        <button
                          type="button"
                          data-action="boot-relogin"
                          onClick={() => (props.relogin ?? (() => location.assign(reauthUrl(location))))()}
                        >
                          {t("boot.relogin")}
                        </button>
                      </Show>
                      <button type="button" data-action="boot-enter" onClick={enter}>
                        {t("boot.enter")}
                      </button>
                    </>
                  }
                >
                  <button
                    type="button"
                    data-action="boot-open-settings"
                    onClick={() => {
                      enter();
                      props.openSettings();
                    }}
                  >
                    {t("boot.openSettings")}
                  </button>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </Portal>
  );
}
