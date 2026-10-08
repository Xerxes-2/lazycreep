/**
 * 一键复制的小图标按钮：放在要复制的文字后面。只有图标、没有文字（不改变所在元素的 textContent）；
 * 点后短暂显示 ✓（失败显示 ✗），说明在 aria-label / title 里。
 *
 * 剪贴板 API 只在安全上下文里有（https、localhost）；没有时退回 execCommand("copy")。
 */
import { createSignal, onCleanup, Show } from "solid-js";
import { useI18n } from "../i18n";

/** ✓ / ✗ 显示多久 */
export const COPY_FEEDBACK_MS = 1500;

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy failed");
  } finally {
    area.remove();
  }
}

export function CopyButton(props: { readonly text: string; readonly name?: string }) {
  const { t } = useI18n();
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const label = () =>
    state() === "copied" ? t("copy.done") : state() === "failed" ? t("copy.failed") : t("copy.label", { text: props.text });
  const copy = (event: MouseEvent) => {
    event.stopPropagation();
    writeClipboard(props.text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
    clearTimeout(timer);
    timer = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  };
  return (
    <button
      type="button"
      class="copy-button"
      data-action="copy"
      data-copy={props.name}
      data-state={state()}
      aria-label={label()}
      title={label()}
      onClick={copy}
    >
      <Show
        when={state() === "idle"}
        fallback={
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <Show when={state() === "copied"} fallback={<path d="M4 4l8 8M12 4l-8 8" />}>
              <path d="M3 8.5l3.5 3.5L13 4.5" />
            </Show>
          </svg>
        }
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" />
        </svg>
      </Show>
    </button>
  );
}
