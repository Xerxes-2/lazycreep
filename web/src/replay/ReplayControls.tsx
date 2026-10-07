/**
 * Replay 的控制条：播放 / 暂停、单步、速度、Tick 跳转、时间轴、回到 Live。
 * 时间轴用 DOM Pointer Events（Pixi 的 ticker 被停掉了，见 #11），鼠标、触摸、笔一致；
 * 拖动时目标 Tick 立即跟手，历史加载在引擎里异步进行，不阻塞界面。
 */
import { createMemo, createSignal, For, Show } from "solid-js";
import { useI18n } from "../i18n";
import { errorMessage } from "../settings/SettingsPage.tsx";
import { DEFAULT_CHUNK_SIZE, REPLAY_SPEEDS, chunkBase, type ReplayEngine, type ReplaySnapshot } from "./replay-engine.ts";

/** 时间轴覆盖的 chunk 数 */
const WINDOW_CHUNKS = 10;

export interface ReplayControlsProps {
  readonly snapshot: ReplaySnapshot;
  readonly engine: ReplayEngine;
  /** 起始 Tick 是 Live 当前 Tick 时，时间轴主要向前（过去）展开 */
  readonly latest: boolean;
  readonly onBackToLive: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ReplayControls(props: ReplayControlsProps) {
  const { t } = useI18n();
  const size = () => props.snapshot.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const [dragging, setDragging] = createSignal(false);

  const inside = (r: { lo: number; hi: number }, tick: number) => tick >= r.lo && tick <= r.hi;

  /** 时间轴窗口：围绕起点所在 chunk；目标走出窗口（且没在拖）时重新以目标为中心。 */
  let anchor: number | undefined;
  const range = createMemo(() => {
    const target = props.snapshot.target;
    const chunk = size();
    const before = props.latest ? WINDOW_CHUNKS - 1 : WINDOW_CHUNKS / 2;
    const bounds = (base: number) => {
      const lo = Math.max(0, base - before * chunk);
      return { lo, hi: lo + WINDOW_CHUNKS * chunk - 1 };
    };
    if (anchor === undefined || (!dragging() && !inside(bounds(anchor), target))) anchor = chunkBase(target, chunk);
    return bounds(anchor);
  });
  const fraction = () => {
    const { lo, hi } = range();
    return clamp((props.snapshot.target - lo) / (hi - lo), 0, 1);
  };

  let track!: HTMLDivElement;
  const tickAt = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    const { lo, hi } = range();
    const f = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    return Math.round(lo + f * (hi - lo));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      // jsdom 等环境不支持捕获时，仍按普通 move 处理。
    }
    setDragging(true);
    props.engine.pause();
    props.engine.seek(tickAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragging()) props.engine.seek(tickAt(event.clientX));
  };
  const endDrag = (event: PointerEvent) => {
    if (!dragging()) return;
    setDragging(false);
    try {
      track.releasePointerCapture(event.pointerId);
    } catch {
      // 同上
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const { lo, hi } = range();
    const moves: Record<string, () => number> = {
      ArrowLeft: () => props.snapshot.target - 1,
      ArrowDown: () => props.snapshot.target - 1,
      ArrowRight: () => props.snapshot.target + 1,
      ArrowUp: () => props.snapshot.target + 1,
      PageDown: () => props.snapshot.target - size(),
      PageUp: () => props.snapshot.target + size(),
      Home: () => lo,
      End: () => hi,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    props.engine.seek(move());
  };

  const [jumpInput, setJumpInput] = createSignal("");
  const jump = (event: SubmitEvent) => {
    event.preventDefault();
    const tick = Number(jumpInput().trim());
    if (!Number.isInteger(tick) || tick < 0) return;
    props.engine.seek(tick);
    setJumpInput("");
  };

  return (
    <div class="replay" data-testid="replay-controls">
      <div class="replay__bar">
        <button type="button" data-action="replay-back-to-live" onClick={() => props.onBackToLive()}>
          {t("replay.backToLive")}
        </button>
        <button
          type="button"
          data-action="replay-step-back"
          aria-label={t("replay.stepBack")}
          onClick={() => props.engine.step(-1)}
        >
          ⏮
        </button>
        <button
          type="button"
          data-action="replay-toggle"
          aria-label={props.snapshot.playing ? t("replay.pause") : t("replay.play")}
          onClick={() => (props.snapshot.playing ? props.engine.pause() : props.engine.play())}
        >
          {props.snapshot.playing ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          data-action="replay-step-forward"
          aria-label={t("replay.stepForward")}
          onClick={() => props.engine.step(1)}
        >
          ⏭
        </button>
        <span class="replay__speeds" role="group" aria-label={t("replay.speed")}>
          <For each={REPLAY_SPEEDS}>
            {(speed) => (
              <button
                type="button"
                data-action={`replay-speed-${speed}`}
                aria-pressed={props.snapshot.speed === speed}
                onClick={() => props.engine.setSpeed(speed)}
              >
                {speed}x
              </button>
            )}
          </For>
        </span>
        <form class="replay__jump" data-testid="replay-jump" onSubmit={jump}>
          <input
            name="replay-tick"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            aria-label={t("replay.jumpLabel")}
            placeholder={String(props.snapshot.target)}
            value={jumpInput()}
            onInput={(e) => setJumpInput(e.currentTarget.value)}
          />
          <button type="submit">{t("replay.jump")}</button>
        </form>
      </div>
      <div
        ref={track}
        class="replay__timeline"
        data-testid="replay-timeline"
        role="slider"
        tabindex="0"
        aria-label={t("replay.timeline")}
        aria-valuemin={range().lo}
        aria-valuemax={range().hi}
        aria-valuenow={props.snapshot.target}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div class="replay__fill" style={{ width: `${fraction() * 100}%` }} />
        <div class="replay__thumb" style={{ left: `${fraction() * 100}%` }} />
      </div>
      <div class="replay__range">
        <span>{range().lo}</span>
        <span>{range().hi}</span>
      </div>
      <Show when={props.snapshot.status === "loading"}>
        <p class="replay__status" role="status">
          {t("replay.loading")}
        </p>
      </Show>
      <Show when={props.snapshot.status === "missing"}>
        <p class="settings__error" role="alert" data-testid="replay-missing">
          {t("replay.missing")}
        </p>
      </Show>
      <Show when={props.snapshot.status === "error"}>
        <p class="settings__error" role="alert">
          {t("replay.error", { message: props.snapshot.error ?? "" })}
        </p>
      </Show>
    </div>
  );
}

/** Live 状态下进入 Replay 的按钮与进入失败的提示。 */
export function ReplayEntry(props: { onEnter: () => void; error: unknown }) {
  const { t } = useI18n();
  return (
    <>
      <button type="button" data-action="replay-enter" onClick={() => props.onEnter()}>
        {t("replay.enter")}
      </button>
      <Show when={props.error}>
        {(error) => (
          <span class="settings__error" role="alert">
            {errorMessage(t, error())}
          </span>
        )}
      </Show>
    </>
  );
}
