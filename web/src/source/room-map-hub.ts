/**
 * roomMap2 订阅中心：全页所有 roomMap2 消费方（Attack Alert、Minimap、PvP 参战者、World Map）都经它订阅。
 *
 * - 消费方拿一个租约，登记“想要的房间（按重要性先后）+ 优先级”；中心按频道（`shard/room`）去重，
 *   同一频道在 Source 上只订阅一次（keepWhileHidden 的消费方另加一条不随页面隐藏暂停的订阅）。
 * - **总预算**：同时订阅的频道不超过 budget（默认 ROOM_MAP_BUDGET = 100，实测过的上限，
 *   见 docs/research/screeps-api-facts.md 第 2 节）。超出时按优先级截断：高优先级的先占，
 *   同优先级按登记先后，每个消费方内部按它给的先后；别人已占的频道不重复计数。
 *   被截断的房间不在租约的 granted() 里，消费方据此显示（例如 PvP 的“超出订阅上限”）。
 * - **按动画帧合并分发**：同一帧内同一频道的多次更新只把最新一帧分发一次，分发给此刻 granted 了
 *   该频道的每个消费方（只为画面服务的 Minimap、地图、PvP）。页面隐藏时 requestAnimationFrame 不跑，
 *   另有一个短定时器兜底。声明 everyFrame 的消费方（Attack Alert：按帧数计在场 Tick，而隐藏页面的定时器
 *   可被浏览器节流到每分钟一次）不合并，每帧立即收到。
 * - 中心挂在一个 Source（共享 Source 的租约）上；Source 换了就换一个中心（roomMapHubFor）。
 */
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type { RoomMapUpdate, Source, Unsubscribe } from "./source.ts";

/** 同时订阅的 roomMap2 频道上限（实测同一连接 100 个无错帧） */
export const ROOM_MAP_BUDGET = 100;

/** 预算不够时谁先：数值大的优先 */
export const ROOM_MAP_PRIORITY = { alert: 3, minimap: 2, pvp: 1, worldMap: 0 } as const;

/** 页面隐藏时 requestAnimationFrame 不跑：至多等这么久就分发 */
const FLUSH_FALLBACK_MS = 100;

export interface RoomRef {
  readonly shard: string;
  readonly room: string;
}

export const roomMapKey = (shard: string, room: string): string => `${shard}/${room}`;

export interface RoomMapLeaseOptions {
  /** ROOM_MAP_PRIORITY 之一；预算不够时高的先占 */
  readonly priority: number;
  /** 页面不可见时也保留（Attack Alert） */
  readonly keepWhileHidden?: boolean;
  /** true 时不按动画帧合并，每帧立即分发（需要逐帧计数的告警） */
  readonly everyFrame?: boolean;
  /** 每个动画帧里，本消费方 granted 的每个频道至多收到一次（最新一帧）；everyFrame 时每帧一次 */
  readonly onFrame: (shard: string, room: string, frame: RoomMapUpdate) => void;
}

export interface RoomMapLease {
  /** 换成想要的房间，按重要性先后（预算不够时截掉后面的）；空列表即全部退订 */
  want(rooms: readonly RoomRef[]): void;
  /** 此刻实际订阅着、会分发给本消费方的频道（`shard/room`）；Solid 信号 */
  readonly granted: Accessor<ReadonlySet<string>>;
  dispose(): void;
}

export interface RoomMapHub {
  lease(options: RoomMapLeaseOptions): RoomMapLease;
  dispose(): void;
}

/** 安排一次分发，返回取消函数；默认是下一个动画帧（带隐藏时的兜底定时器） */
export type FlushScheduler = (flush: () => void) => () => void;

export interface RoomMapHubOptions {
  readonly source: Pick<Source, "subscribeRoomMap">;
  readonly budget?: number;
  readonly schedule?: FlushScheduler;
}

export const animationFrameScheduler: FlushScheduler = (flush) => {
  let done = false;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => run()) : undefined;
  const timer = setTimeout(() => run(), FLUSH_FALLBACK_MS);
  const cancel = () => {
    done = true;
    if (raf !== undefined) cancelAnimationFrame(raf);
    clearTimeout(timer);
  };
  function run() {
    if (done) return;
    cancel();
    flush();
  }
  return cancel;
};

interface Consumer {
  readonly options: RoomMapLeaseOptions;
  readonly order: number;
  wanted: readonly RoomRef[];
  granted: ReadonlySet<string>;
  readonly setGranted: (next: ReadonlySet<string>) => void;
}

interface Channel {
  readonly shard: string;
  readonly room: string;
  pausable: Unsubscribe | undefined;
  kept: Unsubscribe | undefined;
}

const sameRooms = (a: readonly RoomRef[], b: readonly RoomRef[]) =>
  a.length === b.length && a.every((r, i) => r.shard === b[i]!.shard && r.room === b[i]!.room);

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((k) => b.has(k));

export function createRoomMapHub(options: RoomMapHubOptions): RoomMapHub {
  const budget = options.budget ?? ROOM_MAP_BUDGET;
  const schedule = options.schedule ?? animationFrameScheduler;
  const consumers = new Set<Consumer>();
  const channels = new Map<string, Channel>();
  const pending = new Map<string, RoomMapUpdate>();
  let cancelFlush: (() => void) | undefined;
  let nextOrder = 0;
  let disposed = false;

  const flush = () => {
    cancelFlush = undefined;
    const batch = [...pending];
    pending.clear();
    for (const [key, frame] of batch) {
      const channel = channels.get(key);
      if (!channel) continue;
      for (const consumer of [...consumers]) {
        if (!consumer.options.everyFrame && consumer.granted.has(key)) consumer.options.onFrame(channel.shard, channel.room, frame);
      }
    }
  };

  /** 同一帧可能经可暂停与 keepWhileHidden 两条订阅各到一次：逐帧的消费方只收一次 */
  let lastFrame: RoomMapUpdate | undefined;
  const receive = (key: string, channel: Channel) => (frame: RoomMapUpdate) => {
    if (channels.get(key) !== channel) return;
    let coalesced = false;
    const fresh = frame !== lastFrame;
    lastFrame = frame;
    for (const consumer of [...consumers]) {
      if (!consumer.granted.has(key)) continue;
      if (!consumer.options.everyFrame) coalesced = true;
      else if (fresh) consumer.options.onFrame(channel.shard, channel.room, frame);
    }
    if (!coalesced) return;
    pending.set(key, frame);
    cancelFlush ??= schedule(flush);
  };

  /** 按优先级分配预算，再让 Source 上的订阅与分配一致 */
  const reconcile = () => {
    const ranked = [...consumers].sort((a, b) => b.options.priority - a.options.priority || a.order - b.order);
    const allotted = new Map<string, RoomRef>();
    const grants = new Map<Consumer, Set<string>>();
    for (const consumer of ranked) {
      const mine = new Set<string>();
      for (const ref of consumer.wanted) {
        const key = roomMapKey(ref.shard, ref.room);
        if (!allotted.has(key)) {
          if (allotted.size >= budget) continue;
          allotted.set(key, ref);
        }
        mine.add(key);
      }
      grants.set(consumer, mine);
    }

    const needs = (key: string, keep: boolean) =>
      ranked.some((c) => (c.options.keepWhileHidden === true) === keep && grants.get(c)!.has(key));

    for (const [key, channel] of channels) {
      if (allotted.has(key)) continue;
      channels.delete(key);
      pending.delete(key);
      channel.pausable?.();
      channel.kept?.();
    }
    for (const [key, ref] of allotted) {
      let channel = channels.get(key);
      if (!channel) {
        channel = { shard: ref.shard, room: ref.room, pausable: undefined, kept: undefined };
        channels.set(key, channel);
      }
      const listener = receive(key, channel);
      if (needs(key, false)) channel.pausable ??= options.source.subscribeRoomMap(ref.shard, ref.room, listener);
      else if (channel.pausable) {
        channel.pausable();
        channel.pausable = undefined;
      }
      if (needs(key, true)) {
        channel.kept ??= options.source.subscribeRoomMap(ref.shard, ref.room, listener, undefined, { keepWhileHidden: true });
      } else if (channel.kept) {
        channel.kept();
        channel.kept = undefined;
      }
    }

    for (const [consumer, mine] of grants) {
      if (sameSet(consumer.granted, mine)) continue;
      consumer.granted = mine;
      consumer.setGranted(mine);
    }
  };

  return {
    lease(leaseOptions) {
      const [granted, setGranted] = createSignal<ReadonlySet<string>>(new Set());
      const consumer: Consumer = {
        options: leaseOptions,
        order: nextOrder++,
        wanted: [],
        granted: new Set(),
        setGranted: (next) => setGranted(next),
      };
      consumers.add(consumer);
      let closed = false;
      return {
        granted,
        want(rooms) {
          if (closed || disposed || sameRooms(consumer.wanted, rooms)) return;
          consumer.wanted = [...rooms];
          reconcile();
        },
        dispose() {
          if (closed) return;
          closed = true;
          consumers.delete(consumer);
          if (!disposed) reconcile();
          consumer.granted = new Set();
          setGranted(consumer.granted);
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      consumers.clear();
      reconcile();
      cancelFlush?.();
      cancelFlush = undefined;
      pending.clear();
    },
  };
}

/** 每个 Source 一个中心，Source 换了就换（旧中心退掉全部订阅）。需在 Solid 的 owner 里调用。 */
export function roomMapHubFor(
  source: Accessor<Pick<Source, "subscribeRoomMap">>,
  options: Omit<RoomMapHubOptions, "source"> = {},
): Accessor<RoomMapHub> {
  return createMemo(() => {
    const hub = createRoomMapHub({ ...options, source: source() });
    onCleanup(() => hub.dispose());
    return hub;
  });
}

/**
 * 在 Solid 里用一个租约：hub 换了就换租约；rooms 变化时重登记。返回此刻 granted 的频道。
 * onFrame 收到的是本消费方 granted 的频道。
 */
export function useRoomMapLease(
  hub: Accessor<RoomMapHub>,
  options: RoomMapLeaseOptions,
  rooms: Accessor<readonly RoomRef[]>,
): Accessor<ReadonlySet<string>> {
  const lease = createMemo(() => {
    const made = hub().lease(options);
    onCleanup(() => made.dispose());
    return made;
  });
  createEffect(() => lease().want(rooms()));
  return () => lease().granted();
}
