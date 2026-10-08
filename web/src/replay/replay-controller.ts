/**
 * Room View 里 Replay 的接线：按请求（房间 + Tick）建 Replay 引擎，跟随 Source 切换重建。
 *
 * 从别处打开某房间某 Tick 的 Replay 一律走 `shell.navigate({ shard, room, replay })`；地址
 * （`#!/<server>/history/…`，含旧的 `#/replay?…`）由 URL 路由（shell/url-router.ts，#32）解读，
 * 本模块不监听地址。
 */
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import type { Source } from "../source/source.ts";
import { cachedHistory, type HistoryCache } from "./history-cache.ts";
import { createReplay, type HistoryFetcher, type ReplayEngine, type ReplaySnapshot } from "./replay-engine.ts";

export interface ReplayTarget {
  readonly shard: string;
  readonly room: string;
  readonly tick: number;
}

export interface ReplayRequest extends ReplayTarget {
  /** tick 是 Live 当前 Tick：所在 chunk 还没生成时退到最近的已有历史 */
  readonly latest?: boolean;
}

export interface ReplayController {
  readonly request: Accessor<ReplayRequest | undefined>;
  readonly active: Accessor<boolean>;
  readonly snapshot: Accessor<ReplaySnapshot | undefined>;
  readonly engine: Accessor<ReplayEngine | undefined>;
  /** 进入 Replay 前（例如取服务器时间）出的错 */
  readonly entryError: Accessor<unknown>;
  open(request: ReplayRequest): void;
  /**
   * 从 Live 进入：有 Live 当前 Tick 就从那里开始，否则向服务器要当前时间（匿名接口，
   * token 缺失或失效时也可用）。
   */
  enterFromLive(shard: string, room: string, liveTick: number | undefined): void;
  close(): void;
}

export interface ReplayControllerOptions {
  readonly source: Accessor<Source | undefined>;
  /** 历史缓存；undefined 表示不缓存 */
  readonly cache: Promise<HistoryCache | undefined> | undefined;
  /** 页面可见性；不可见时暂停播放（省电，#14） */
  readonly visible?: Accessor<boolean>;
}

export function createReplayController(options: ReplayControllerOptions): ReplayController {
  const [request, setRequest] = createSignal<ReplayRequest>();
  const [snapshot, setSnapshot] = createSignal<ReplaySnapshot>();
  const [engine, setEngine] = createSignal<ReplayEngine>();
  const [entryError, setEntryError] = createSignal<unknown>();
  const cache = options.cache?.catch(() => undefined);

  createEffect(() => {
    const src = options.source();
    const req = request();
    setSnapshot(undefined);
    setEngine(undefined);
    if (!src || !req) return;
    const fetchChunk: HistoryFetcher = async (shard, room, base) =>
      cachedHistory(src, await cache)(shard, room, base);
    const made = untrack(() =>
      createReplay({
        shard: req.shard,
        room: req.room,
        start: req.tick,
        ...(req.latest ? { latest: true } : {}),
        chunkSize: src.getVersion().then((v) => v.historyChunkSize),
        fetchChunk,
      }),
    );
    setEngine(made);
    const off = made.subscribe(setSnapshot);
    onCleanup(() => {
      off();
      made.dispose();
    });
  });

  createEffect(() => {
    if (options.visible && !options.visible()) untrack(engine)?.pause();
  });

  const open = (next: ReplayRequest) => {
    setEntryError(undefined);
    setRequest(next);
  };

  return {
    request,
    active: () => request() !== undefined,
    snapshot,
    engine,
    entryError,
    open,
    enterFromLive(shard, room, liveTick) {
      if (liveTick !== undefined) return open({ shard, room, tick: liveTick, latest: true });
      const src = options.source();
      if (!src) return;
      setEntryError(undefined);
      src.getTime(shard).then(
        (tick) => open({ shard, room, tick, latest: true }),
        (error: unknown) => setEntryError(error),
      );
    },
    close() {
      setRequest(undefined);
      setEntryError(undefined);
    },
  };
}
