/**
 * Replay 引擎：单房间的历史回放。
 *
 * - 维护目标 Tick、播放状态与速度
 * - chunk 对齐：`floor(tick / historyChunkSize) * historyChunkSize`，chunk 大小来自版本接口
 * - 从 chunk 首 Tick（全量）重放 diff 到目标 Tick（复用 RoomState 归并器）；同一 chunk 内向后走时只补差量
 * - 预取相邻 chunk；拖动时目标立即更新，只有最后一个目标的加载结果生效
 *
 * 与 UI 框架无关：状态以快照给出，`subscribe` 在每次变化时推送。
 */
import { applyRoomTick, roomStateFrom, type RoomState } from "../room/room-state.ts";
import type { HistoryChunk, Unsubscribe } from "../source/source.ts";

/** 取一个历史 chunk；历史不存在时得到 null。通常就是 Source.getHistoryChunk（可叠一层缓存）。 */
export type HistoryFetcher = (shard: string, room: string, base: number) => Promise<HistoryChunk | null>;

export type ReplaySpeed = 1 | 4 | 16;
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 4, 16];

/**
 * - loading：正在取目标 Tick 所在的 chunk（或 chunk 大小）
 * - ready：`room` 就是目标 Tick 的状态
 * - missing：目标 Tick 没有历史（太久远、尚未生成或房间没数据）
 * - error：取历史失败，`error` 是原因；再次 seek 会重试
 */
export type ReplayStatus = "loading" | "ready" | "missing" | "error";

export interface ReplaySnapshot {
  readonly shard: string;
  readonly room: string;
  readonly target: number;
  readonly status: ReplayStatus;
  readonly error?: string;
  /** 最近一次成功重放的房间状态；加载中或 missing 时保留上一个，避免画面闪空。 */
  readonly roomState: RoomState | undefined;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  /** 尚未取到版本信息时为 undefined */
  readonly chunkSize: number | undefined;
}

export interface ReplayOptions {
  readonly shard: string;
  readonly room: string;
  /** 起始目标 Tick */
  readonly start: number;
  readonly fetchChunk: HistoryFetcher;
  /** historyChunkSize，通常是 `source.getVersion().then(v => v.historyChunkSize)` */
  readonly chunkSize: number | Promise<number>;
  /**
   * `start` 是 Live 的当前 Tick：它所在的 chunk 多半还没生成，此时退到更早一个 chunk 的末尾
   * （最多退两个），而不是直接提示历史不存在。
   */
  readonly latest?: boolean;
}

export interface ReplayEngine {
  snapshot(): ReplaySnapshot;
  /** 立即收到当前快照，之后每次变化收到一次。 */
  subscribe(listener: (snapshot: ReplaySnapshot) => void): Unsubscribe;
  seek(tick: number): void;
  step(delta: number): void;
  play(): void;
  pause(): void;
  setSpeed(speed: ReplaySpeed): void;
  dispose(): void;
}

export const DEFAULT_CHUNK_SIZE = 100;
/** 1x 每秒一 Tick */
const MS_PER_TICK = 1000;
/** 内存里留几个 chunk（当前与相邻的，外加一点余量） */
const MEMORY_CHUNKS = 6;
/** latest 模式下最多往前退几个 chunk */
const LATEST_FALLBACKS = 2;

export function chunkBase(tick: number, size: number): number {
  return Math.floor(tick / size) * size;
}

/** 当前 chunk 上已重放到的位置，同一 chunk 内向后走时从这里接着归并。 */
interface Cursor {
  readonly base: number;
  readonly chunk: HistoryChunk;
  /** 已应用到的 Tick 下标 */
  readonly index: number;
  readonly state: RoomState;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReplay(options: ReplayOptions): ReplayEngine {
  const { shard, room, fetchChunk } = options;
  let snap: ReplaySnapshot = {
    shard,
    room,
    target: Math.max(0, Math.round(options.start)),
    status: "loading",
    roomState: undefined,
    playing: false,
    speed: 1,
    chunkSize: typeof options.chunkSize === "number" ? options.chunkSize : undefined,
  };
  const listeners = new Set<(snapshot: ReplaySnapshot) => void>();
  const memory = new Map<number, Promise<HistoryChunk | null>>();
  let cursor: Cursor | undefined;
  let prefetchedAround: number | undefined;
  let fallbacksLeft = options.latest ? LATEST_FALLBACKS : 0;
  /** 每次 load 递增；结果回来时编号不对就丢弃（只认最后一个目标）。 */
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const update = (change: Partial<ReplaySnapshot>) => {
    if (disposed) return;
    const next: ReplaySnapshot = { ...snap, ...change };
    if (change.status !== undefined && change.status !== "error") delete (next as { error?: string }).error;
    snap = next;
    for (const listener of [...listeners]) listener(snap);
  };

  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const startTimer = () => {
    stopTimer();
    timer = setInterval(() => {
      if (snap.status === "ready") step(1);
    }, MS_PER_TICK / snap.speed);
  };

  /** 取 chunk：进行中或已取到的复用；null 与失败不留，下次重新请求。 */
  const remember = (base: number): Promise<HistoryChunk | null> => {
    const known = memory.get(base);
    if (known) {
      memory.delete(base);
      memory.set(base, known);
      return known;
    }
    const pending = fetchChunk(shard, room, base).then(
      (chunk) => {
        if (!chunk && memory.get(base) === pending) memory.delete(base);
        return chunk;
      },
      (error: unknown) => {
        if (memory.get(base) === pending) memory.delete(base);
        throw error;
      },
    );
    memory.set(base, pending);
    while (memory.size > MEMORY_CHUNKS) memory.delete(memory.keys().next().value!);
    return pending;
  };

  const prefetch = (base: number, size: number) => {
    if (prefetchedAround === base) return;
    prefetchedAround = base;
    for (const neighbour of [base - size, base + size]) {
      if (neighbour >= 0) remember(neighbour).catch(() => {});
    }
  };

  /** 在 chunk 上重放到 target；同一 chunk 内向后走时从游标接着归并。 */
  const replay = (base: number, chunk: HistoryChunk, target: number): RoomState | undefined => {
    const ticks = chunk.ticks;
    const first = ticks[0];
    if (!first || target < first.gameTime) return undefined;
    let index: number;
    let state: RoomState;
    if (cursor && cursor.chunk === chunk && cursor.state.gameTime !== undefined && cursor.state.gameTime <= target) {
      ({ index, state } = cursor);
    } else {
      state = roomStateFrom(first);
      index = 0;
    }
    for (let i = index + 1; i < ticks.length && ticks[i]!.gameTime <= target; i++) {
      state = applyRoomTick(state, ticks[i]!);
      index = i;
    }
    cursor = { base, chunk, index, state };
    return state;
  };

  const show = (base: number, size: number, chunk: HistoryChunk, target: number) => {
    const state = replay(base, chunk, target);
    if (!state) {
      update({ status: "missing" });
      return;
    }
    fallbacksLeft = 0;
    update({ status: "ready", roomState: state });
    prefetch(base, size);
  };

  const fail = (status: "missing" | "error", error?: string) => {
    if (snap.playing) {
      stopTimer();
      update({ playing: false });
    }
    update(error === undefined ? { status } : { status, error });
  };

  const load = (size: number) => {
    const generationNow = ++generation;
    const target = snap.target;
    const base = chunkBase(target, size);
    if (cursor?.base === base) {
      show(base, size, cursor.chunk, target);
      return;
    }
    if (snap.status !== "loading") update({ status: "loading" });
    remember(base).then(
      (chunk) => {
        if (disposed || generationNow !== generation) return;
        if (chunk) return show(base, size, chunk, target);
        if (fallbacksLeft > 0 && base > 0) {
          fallbacksLeft -= 1;
          update({ target: base - 1 });
          return load(size);
        }
        fail("missing");
      },
      (error: unknown) => {
        if (disposed || generationNow !== generation) return;
        fail("error", message(error));
      },
    );
  };

  const seek = (tick: number) => {
    if (disposed || !Number.isFinite(tick)) return;
    update({ target: Math.max(0, Math.round(tick)) });
    if (snap.chunkSize === undefined) {
      if (snap.status !== "loading") update({ status: "loading" });
      return;
    }
    load(snap.chunkSize);
  };

  const step = (delta: number) => seek(snap.target + delta);

  Promise.resolve(options.chunkSize).then(
    (size) => {
      if (disposed) return;
      update({ chunkSize: size > 0 ? size : DEFAULT_CHUNK_SIZE });
      load(snap.chunkSize!);
    },
    () => {
      if (disposed) return;
      update({ chunkSize: DEFAULT_CHUNK_SIZE });
      load(DEFAULT_CHUNK_SIZE);
    },
  );

  return {
    snapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      listener(snap);
      return () => listeners.delete(listener);
    },
    seek,
    step,
    play() {
      if (disposed || snap.playing) return;
      update({ playing: true });
      startTimer();
    },
    pause() {
      stopTimer();
      if (snap.playing) update({ playing: false });
    },
    setSpeed(speed) {
      if (speed === snap.speed) return;
      update({ speed });
      if (snap.playing) startTimer();
    },
    dispose() {
      disposed = true;
      generation += 1;
      stopTimer();
      listeners.clear();
      memory.clear();
    },
  };
}
