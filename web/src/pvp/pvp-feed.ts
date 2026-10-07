/**
 * PvP Overview 的数据流（#3）：可见期间每 10 秒轮询 PvP 与核弹列表（匿名接口，不占鉴权额度），
 * 合并所有权缓存，按所选时间窗聚合；所有权未知的房间交给共享的所有权加载器补查（共用每小时额度）。
 * 页面不可见时不轮询（#14 的 pollWhileVisible）。
 */
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type { OwnershipHub } from "../map/ownership-hub.ts";
import { pageVisibility, pollWhileVisible, type VisibilitySignal } from "../power/visibility.ts";
import type { Source } from "../source/source.ts";
import {
  DEFAULT_PVP_WINDOW,
  PVP_FETCH_INTERVAL,
  aggregatePvp,
  type PvpFeedData,
  type PvpShardGroup,
  type PvpWindow,
} from "./pvp-overview.ts";

export const PVP_POLL_MS = 10_000;

export interface PvpFeedOptions {
  readonly source: Accessor<Source>;
  /** 共享的所有权缓存；不给或为 undefined 时所有者一律未知 */
  readonly ownership?: Accessor<OwnershipHub | undefined>;
  /** 是否允许补查所有权（map-stats 需要 token） */
  readonly canLookup?: Accessor<boolean>;
  readonly visibility?: VisibilitySignal;
  readonly pollMs?: number;
}

export interface PvpFeed {
  /** 最近一次成功取到的数据；换 Source 后清空 */
  readonly data: Accessor<PvpFeedData | undefined>;
  /** 最近一次轮询的错误；成功后清空 */
  readonly error: Accessor<unknown>;
  readonly window: Accessor<PvpWindow>;
  readonly setWindow: (window: PvpWindow) => void;
  /** 按所选时间窗聚合、合并了所有者的分组 */
  readonly groups: Accessor<readonly PvpShardGroup[] | undefined>;
}

export function createPvpFeed(options: PvpFeedOptions): PvpFeed {
  const [data, setData] = createSignal<PvpFeedData>();
  const [error, setError] = createSignal<unknown>();
  const [window, setWindow] = createSignal<PvpWindow>(DEFAULT_PVP_WINDOW);
  /** 所有权缓存每次更新加一，让聚合重算 */
  const [ownershipVersion, setOwnershipVersion] = createSignal(0);

  createEffect(() => {
    const src = options.source();
    setData(undefined);
    setError(undefined);
    let alive = true;
    const off = pollWhileVisible(
      options.visibility ?? pageVisibility(),
      async () => {
        try {
          const [pvp, nukes] = await Promise.all([src.getPvp(PVP_FETCH_INTERVAL), src.getNukes()]);
          if (!alive) return;
          setData({ pvp, nukes });
          setError(undefined);
        } catch (failure) {
          if (alive) setError(failure);
        }
      },
      options.pollMs ?? PVP_POLL_MS,
    );
    onCleanup(() => {
      alive = false;
      off();
    });
  });

  createEffect(() => {
    const hub = options.ownership?.();
    if (!hub) return;
    onCleanup(hub.subscribe(() => setOwnershipVersion((v) => v + 1)));
  });

  const groups = createMemo(() => {
    const current = data();
    if (!current) return undefined;
    ownershipVersion();
    const hub = options.ownership?.();
    return aggregatePvp(current, window(), hub ? (shard) => hub.stats(shard) : undefined);
  });

  // 所有者未知的房间交给加载器补查；清单没变就不重复提交
  let lastAsked: { hub: OwnershipHub; key: string } | undefined;
  createEffect(() => {
    const hub = options.ownership?.();
    const list = groups();
    if (!hub || !list || !(options.canLookup?.() ?? true)) return;
    const unknown = list.flatMap((g) =>
      g.rooms.filter((r) => r.owner.kind === "unknown").map((r) => ({ shard: g.shard, room: r.room })),
    );
    const key = unknown.map((r) => `${r.shard}/${r.room}`).join(",");
    if (lastAsked?.hub === hub && lastAsked.key === key) return;
    lastAsked = { hub, key };
    hub.requestRooms(unknown);
  });

  return { data, error, window, setWindow, groups };
}
