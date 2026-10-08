/**
 * World Map 徽章图层的数据（#43）：给 badgeLayer 的 MapBadgeUrl。
 *
 * - 徽章先取 map-stats 的 users（MapState.users，带 badge）；map-stats 没给徽章的玩家用 Source.getPlayer
 *   （user/find，Source 内按玩家缓存）补查，每个 Source 每个玩家只查一次，查不到按“没有徽章”。
 * - 查到的徽章交给全页的位图缓存（badge/badge-image.ts，按 Server + 用户 + 徽章内容缓存）。
 * - 徽章随 Source 走，Source 按 Server 建，所以同一玩家在不同 Server 的徽章不会混用；换 Source 时清空补查结果。
 * - 只为可见的已占领 / 预定房间查：图层只对可见房间调用。
 * 需在 Solid 的 owner 里调用。
 */
import { createEffect, createSignal, on, type Accessor } from "solid-js";
import { parseBadge, type Badge } from "../badge/badge.ts";
import { badgeRasters, type BadgeRasters } from "../badge/badge-image.ts";
import type { Source } from "../source/source.ts";
import type { MapBadgeUrl } from "./map-badge-layer.ts";

export function createMapBadges(options: { readonly source: Accessor<Source>; readonly rasters?: BadgeRasters }): MapBadgeUrl {
  const rasters = options.rasters ?? badgeRasters();
  /** 补查到的徽章：Badge，或 null（没有徽章 / 查不到） */
  const [found, setFound] = createSignal<ReadonlyMap<string, Badge | null>>(new Map());
  let requested = new Set<string>();
  createEffect(
    on(
      options.source,
      () => {
        requested = new Set();
        setFound(new Map());
      },
      { defer: true },
    ),
  );

  const lookUp = (src: Source, userId: string) => {
    if (requested.has(userId)) return;
    requested.add(userId);
    const settle = (badge: Badge | null) => {
      if (options.source() === src) setFound((all) => new Map(all).set(userId, badge));
    };
    src.getPlayer(userId).then(
      (profile) => settle(profile.badge ?? null),
      () => settle(null),
    );
  };

  return (userId, user) => {
    const src = options.source();
    let badge: Badge | null | undefined;
    if (user?.["badge"] !== undefined) {
      badge = parseBadge(user["badge"]) ?? null;
    } else {
      badge = found().get(userId);
      if (badge === undefined) {
        lookUp(src, userId);
        return undefined;
      }
    }
    return rasters.url(src.server.id, userId, badge);
  };
}
