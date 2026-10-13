/**
 * Replay 的控制条，照官方回放：−100 / −1 / 播放暂停 / +1 / +100、速度 −/+（5–20 Tick/秒）、Tick 跳转、
 * 时间轴、回到 Live。
 *
 * 时间轴同官方：覆盖 Server 当前 Tick 往前 HISTORY_SPAN 到当前 Tick − HISTORY_LAG 之前的整 chunk，
 * 拖动按 chunk 对齐。拖动时只移动滑块、显示目标 Tick，松手才跳过去（跨度很大，逐帧跳会拉一串 chunk）。
 * 用 DOM Pointer Events（Pixi 的 ticker 被停掉了，见 #11），鼠标、触摸、笔一致。
 */
import { createMemo, createSignal, Show } from "solid-js";
import { useI18n } from "../i18n";
import { errorMessage } from "../settings/SettingsPage.tsx";
import { DEFAULT_CHUNK_SIZE, REPLAY_SPEEDS, chunkBase, shiftSpeed, type ReplayEngine, type ReplaySnapshot } from "./replay-engine.ts";

/** 时间轴往前覆盖多少 Tick（官方客户端同为 150000） */
export const HISTORY_SPAN = 150_000;
/** 最近这么多 Tick 的 chunk 多半还没生成，时间轴不含（官方同为 50） */
export const HISTORY_LAG = 50;
/** 大步跳转的 Tick 数 */
const BIG_STEP = 100;

export interface ReplayControlsProps {
  readonly snapshot: ReplaySnapshot;
  readonly engine: ReplayEngine;
  readonly onBackToLive: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ReplayControls(props: ReplayControlsProps) {
  const { t } = useI18n();
  const size = () => props.snapshot.chunkSize ?? DEFAULT_CHUNK_SIZE;
  /** 拖动中滑块所指的 Tick；不在拖时为 undefined */
  const [preview, setPreview] = createSignal<number>();

  /** 时间轴范围；目标在范围外（更早的分享链接、刚进入时的 Live Tick）时把范围撑到包含它 */
  const range = createMemo(() => {
    const chunk = size();
    const target = props.snapshot.target;
    const now = props.snapshot.serverTime ?? target;
    const lo = Math.min(chunkBase(Math.max(0, now - HISTORY_SPAN), chunk), chunkBase(target, chunk));
    const hi = Math.max(lo + chunk - 1, chunkBase(now - HISTORY_LAG, chunk) - 1, target);
    return { lo, hi };
  });
  const shown = () => preview() ?? props.snapshot.target;
  const fraction = () => {
    const { lo, hi } = range();
    return clamp((shown() - lo) / (hi - lo), 0, 1);
  };

  let track!: HTMLDivElement;
  /** 指针位置对应的 Tick，对齐到 chunk 首 Tick */
  const tickAt = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    const { lo, hi } = range();
    const f = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    const chunk = size();
    return Math.min(hi, lo + Math.round((f * (hi - lo)) / chunk) * chunk);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      // jsdom 等环境不支持捕获时，仍按普通 move 处理。
    }
    props.engine.pause();
    setPreview(tickAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent) => {
    if (preview() !== undefined) setPreview(tickAt(event.clientX));
  };
  const endDrag = (event: PointerEvent) => {
    const tick = preview();
    if (tick === undefined) return;
    setPreview(undefined);
    try {
      track.releasePointerCapture(event.pointerId);
    } catch {
      // 同上
    }
    if (event.type === "pointerup") props.engine.seek(tick);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const { lo, hi } = range();
    const moves: Record<string, () => number> = {
      ArrowLeft: () => props.snapshot.target - 1,
      ArrowDown: () => props.snapshot.target - 1,
      ArrowRight: () => props.snapshot.target + 1,
      ArrowUp: () => props.snapshot.target + 1,
      PageDown: () => props.snapshot.target - BIG_STEP,
      PageUp: () => props.snapshot.target + BIG_STEP,
      Home: () => lo,
      End: () => hi,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    props.engine.seek(move());
  };

  const speed = () => props.snapshot.speed;

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
          data-action="replay-back-100"
          aria-label={t("replay.back100")}
          title={t("replay.back100")}
          onClick={() => props.engine.step(-BIG_STEP)}
        >
          «
        </button>
        <button
          type="button"
          data-action="replay-step-back"
          aria-label={t("replay.stepBack")}
          title={t("replay.stepBack")}
          onClick={() => props.engine.step(-1)}
        >
          ‹
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
          title={t("replay.stepForward")}
          onClick={() => props.engine.step(1)}
        >
          ›
        </button>
        <button
          type="button"
          data-action="replay-forward-100"
          aria-label={t("replay.forward100")}
          title={t("replay.forward100")}
          onClick={() => props.engine.step(BIG_STEP)}
        >
          »
        </button>
        <span class="replay__speed" role="group" aria-label={t("replay.speed")}>
          <button
            type="button"
            data-action="replay-slower"
            aria-label={t("replay.slower")}
            disabled={speed() === REPLAY_SPEEDS[0]}
            onClick={() => props.engine.setSpeed(shiftSpeed(speed(), -1))}
          >
            −
          </button>
          <span data-testid="replay-speed">{t("replay.speedValue", { speed: speed() })}</span>
          <button
            type="button"
            data-action="replay-faster"
            aria-label={t("replay.faster")}
            disabled={speed() === REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1]}
            onClick={() => props.engine.setSpeed(shiftSpeed(speed(), 1))}
          >
            +
          </button>
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
        aria-valuenow={shown()}
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
        <Show when={preview()}>{(tick) => <span data-testid="replay-preview">{t("replay.previewTick", { tick: tick() })}</span>}</Show>
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
