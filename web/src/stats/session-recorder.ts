/**
 * Session Stats 的记录器（#65）：全页一份，不论区块是否显示都在记。数据来自本来就有的订阅，不多发请求：
 *
 * - CPU 与 Memory：`user:<id>/cpu`（与 Top Bar 同一个频道；页面隐藏时 LiveSource 暂停它）。
 * - Tick 速度：Room View 的 Live 帧之间的到达间隔 ÷ Tick 号之差。只在 Room View 在流时测得。
 * - 房间指标：同一批 Live 帧（room-metrics.ts）；快照（Room Snapshot）不带 gameTime，跳过。
 *   同一房间同一 Tick 只记一次。
 * - 空档：页面隐藏（hidden）优先于断线重连（offline）。
 *
 * 换 Server 或 token（Source 换了）时重新开始：不同 Server 的数据混在一起没有意义。
 * 界面读 `version()` 决定何时重算；它至多每 notifyMs 变一次，私服每秒几十个 Tick 时也不逐 Tick 重画。
 */
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import type { VisibilitySignal } from "../power/visibility.ts";
import type { RoomState } from "../room/room-state.ts";
import type { RoomSnapshot, Source } from "../source/source.ts";
import { roomMetrics, type RoomMetric } from "./room-metrics.ts";
import { createSessionStore, type GapKind, type SessionStore } from "./session-store.ts";

export const CPU_KEY = "cpu";
export const MEMORY_KEY = "memory";
export const TICK_KEY = "tick";
export const roomKey = (shard: string, room: string, metric: RoomMetric) => `room:${shard}/${room}:${metric}`;

/** 两个 Live 帧相隔超过这么久就不算 Tick 速度（中间多半隐藏过或换过房间） */
const TICK_GAP_MS = 30_000;

export interface ObservedRoom {
  readonly shard: string;
  readonly room: string;
  /** 最后一次记到的时刻 */
  readonly lastAt: number;
}

export interface SessionRecorder {
  readonly store: Accessor<SessionStore>;
  /** 数据有变化时递增；至多每 notifyMs 一次 */
  readonly version: Accessor<number>;
  /** 记过数据的房间，最近记到的在前；随 version() 更新 */
  readonly rooms: Accessor<readonly ObservedRoom[]>;
  /** Room View 看到的房间（接在 RoomView 的 onObserved 上） */
  observeRoom(shard: string, room: string, seen: RoomSnapshot | RoomState): void;
}

export interface SessionRecorderOptions {
  readonly source: Accessor<Source>;
  readonly token: Accessor<string | undefined>;
  readonly visibility: VisibilitySignal;
  readonly allies: Accessor<ReadonlySet<string> | undefined>;
  readonly now?: () => number;
  /** 通知界面的最短间隔，默认 1000 毫秒 */
  readonly notifyMs?: number;
}

/** 需在 Solid 的 owner 里调用 */
export function createSessionRecorder(options: SessionRecorderOptions): SessionRecorder {
  const now = options.now ?? (() => Date.now());
  const notifyMs = options.notifyMs ?? 1000;
  const [version, setVersion] = createSignal(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      setVersion((v) => v + 1);
    }, notifyMs);
  };
  onCleanup(() => clearTimeout(timer));

  let rooms: readonly ObservedRoom[] = [];
  let lastTick: { shard: string; gameTime: number; at: number } | undefined;
  const seenTick = new Map<string, number>();

  const store = createMemo(() => {
    options.source();
    const fresh = createSessionStore({ now });
    untrack(() => {
      rooms = [];
      lastTick = undefined;
      seenTick.clear();
      changed();
    });
    return fresh;
  });

  const [me, setMe] = createSignal<string>();
  createEffect(() => {
    const src = options.source();
    setMe(undefined);
    if (!options.token()) return;
    let alive = true;
    src.getMe().then(
      (user) => alive && setMe(user.id),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  createEffect(() => {
    const src = options.source();
    const s = store();
    if (!options.token()) return;
    onCleanup(
      src.subscribeCpu((update) => {
        const at = now();
        s.record(CPU_KEY, update.cpu, at);
        s.record(MEMORY_KEY, update.memory, at);
        changed();
      }),
    );
  });

  // 空档：隐藏优先于断线
  createEffect(() => {
    const src = options.source();
    const s = store();
    let hidden = !options.visibility.visible();
    let offline = false;
    const apply = () => {
      const kind: GapKind | undefined = hidden ? "hidden" : offline ? "offline" : undefined;
      s.setGap(kind, now());
      if (hidden) lastTick = undefined;
      changed();
    };
    apply();
    onCleanup(
      options.visibility.subscribe((visible) => {
        hidden = !visible;
        apply();
      }),
    );
    onCleanup(
      src.onConnection((state) => {
        const next = state === "reconnecting";
        if (next === offline) return;
        offline = next;
        apply();
      }),
    );
  });

  return {
    store,
    version,
    rooms: () => {
      version();
      return rooms;
    },
    observeRoom(shard, room, seen) {
      const gameTime = "gameTime" in seen ? seen.gameTime : undefined;
      if (gameTime === undefined) return;
      const id = `${shard}/${room}`;
      if (seenTick.get(id) === gameTime) return;
      seenTick.set(id, gameTime);
      const at = now();
      const s = untrack(store);

      if (lastTick && lastTick.shard === shard && gameTime > lastTick.gameTime && at - lastTick.at <= TICK_GAP_MS) {
        s.record(TICK_KEY, (at - lastTick.at) / (gameTime - lastTick.gameTime), at);
      }
      if (!lastTick || lastTick.shard !== shard || gameTime > lastTick.gameTime) lastTick = { shard, gameTime, at };

      const metrics = roomMetrics(seen as RoomState, { me: untrack(me), allies: untrack(options.allies) });
      for (const [metric, value] of Object.entries(metrics) as [RoomMetric, number][]) s.record(roomKey(shard, room, metric), value, at);
      rooms = [{ shard, room, lastAt: at }, ...rooms.filter((r) => r.shard !== shard || r.room !== room)];
      changed();
    },
  };
}
