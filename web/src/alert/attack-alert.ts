/**
 * Attack Alert 的数据流（#4，ADR 0002）：把各数据来源接到判定器上。
 *
 * - 我的房间：`getMe()`（所有 Shard，定期刷新）并上 PvP 分组里所有权数据显示归我的房间
 * - PvP 与核弹：订阅 #3 的 PvP feed，不另起轮询
 * - 陌生人：为每个我的房间订阅 roomMap2（实测同一连接 100 个无错，不必轮换），
 *   订阅声明 keepWhileHidden：页面不可见时也保留（系统通知在那时最有用），只是不渲染
 * - 玩家名：roomMap2 只给用户 id，按需 `getUsername` 查一次后缓存，用来对照 Ally List
 * - 冷却与已告警记录（AlertMemory）按 Server 存在本地，刷新后沿用（alert-memory.ts）
 */
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import type { PvpFeed } from "../pvp/pvp-feed.ts";
import type { Source, Unsubscribe, UserInfo } from "../source/source.ts";
import type { KeyValueStorage } from "../storage/local-store.ts";
import { loadAlertMemory, saveAlertMemory } from "./alert-memory.ts";
import { NOT_PLAYERS, createAlertDetector, myRoomsFrom, type Alert, type AlertConfig, type AlertContext } from "./alert-detector.ts";

/** 用户信息（我的房间）的刷新间隔：新占或丢失的房间 10 分钟内跟上 */
export const ME_REFRESH_MS = 10 * 60_000;

export interface AttackAlertOptions {
  readonly source: Accessor<Source>;
  readonly feed: Pick<PvpFeed, "data" | "groups">;
  /** 有 token 时才能知道“我”是谁；为 false 时整个告警停用 */
  readonly enabled: Accessor<boolean>;
  readonly allies: Accessor<ReadonlySet<string>>;
  readonly config: Accessor<AlertConfig>;
  readonly onAlert: (alert: Alert) => void;
  /** 告警记忆的存储；undefined 时只在内存里（刷新即忘） */
  readonly storage: KeyValueStorage | undefined;
  readonly now?: () => number;
  readonly meRefreshMs?: number;
}

export interface AttackAlert {
  readonly me: Accessor<UserInfo | undefined>;
  /** Shard → 我的房间 */
  readonly rooms: Accessor<ReadonlyMap<string, ReadonlySet<string>>>;
}

export function createAttackAlert(options: AttackAlertOptions): AttackAlert {
  const now = options.now ?? Date.now;
  const [me, setMe] = createSignal<UserInfo>();
  const [usernames, setUsernames] = createSignal<Readonly<Record<string, string>>>({});

  // 用户信息：换 Source 或 token 时重取，之后定期刷新；不随页面隐藏暂停
  createEffect(() => {
    const src = options.source();
    setMe(undefined);
    setUsernames({});
    if (!options.enabled()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      src.getMe().then(
        (info) => alive && setMe(info),
        () => {},
      );
      timer = setTimeout(load, options.meRefreshMs ?? ME_REFRESH_MS);
    };
    load();
    onCleanup(() => {
      alive = false;
      clearTimeout(timer);
    });
  });

  const rooms = createMemo<ReadonlyMap<string, ReadonlySet<string>>>(
    () => {
      const info = me();
      return info ? myRoomsFrom(info, options.feed.groups() ?? []) : new Map();
    },
    new Map(),
    { equals: (a, b) => roomsKey(a) === roomsKey(b) },
  );

  // 每个 Server 一份记忆；判定器随 Source 换（Server 或 token 变化）而重建，记忆从本地读回
  const detector = createMemo(() => {
    const serverId = options.source().server.id;
    const memory = loadAlertMemory(options.storage, serverId, now());
    const inner = createAlertDetector(memory);
    const save = () => saveAlertMemory(options.storage, serverId, memory, now());
    return {
      feed: (...args: Parameters<typeof inner.feed>) => {
        const alerts = inner.feed(...args);
        save();
        return alerts;
      },
      roomMap: (...args: Parameters<typeof inner.roomMap>) => {
        const alerts = inner.roomMap(...args);
        if (alerts.length > 0) save();
        return alerts;
      },
    };
  });

  const context = (): AlertContext => ({
    me: me()?.id ?? "",
    rooms: rooms(),
    allies: options.allies(),
    usernames: usernames(),
  });

  const lookups = new Set<string>();
  const lookUp = (src: Source, id: string) => {
    if (lookups.has(id) || NOT_PLAYERS.has(id) || id === me()?.id || usernames()[id] !== undefined) return;
    lookups.add(id);
    src.getUsername(id).then(
      (name) => {
        if (options.source() === src) setUsernames((names) => ({ ...names, [id]: name }));
      },
      () => lookups.delete(id),
    );
  };

  // PvP 与核弹：每轮 feed 数据到来时判定一次
  createEffect(() => {
    const data = options.feed.data();
    const info = me();
    if (!data || !info) return;
    untrack(() => {
      for (const alert of detector().feed(data, context(), options.config(), now())) options.onAlert(alert);
    });
  });

  // 陌生人：为每个我的房间订阅 roomMap2（陌生人条件关闭时不订阅）；只在房间集合或开关变化时重订阅
  const strangerOn = createMemo(() => options.config().stranger);
  const known = createMemo(() => me() !== undefined);
  createEffect(() => {
    const src = options.source();
    const current = rooms();
    if (!strangerOn() || !known()) return;
    const offs: Unsubscribe[] = [];
    for (const [shard, list] of current) {
      for (const room of list) {
        offs.push(
          src.subscribeRoomMap(
            shard,
            room,
            (frame) => {
              for (const id of Object.keys(frame)) lookUp(src, id);
              untrack(() => {
                for (const alert of detector().roomMap(shard, room, frame, context(), options.config(), now())) {
                  options.onAlert(alert);
                }
              });
            },
            undefined,
            { keepWhileHidden: true },
          ),
        );
      }
    }
    onCleanup(() => {
      for (const off of offs) off();
    });
  });

  return { me, rooms };
}

function roomsKey(rooms: ReadonlyMap<string, ReadonlySet<string>>): string {
  return [...rooms]
    .map(([shard, list]) => `${shard}:${[...list].sort().join(",")}`)
    .sort()
    .join(";");
}
