/**
 * roomMap2 订阅管理（World Map 的 Power Bank）：让订阅集合跟随“当前想看的房间”。
 * 调用方在放大到 ICON_MIN_ZOOM 以上时给出可见房间（按离中心先近后远），缩小或隐藏时给空列表。
 *
 * 上限：实测同一连接同时订阅 100 个 roomMap2 没有错误帧（docs/research/screeps-api-facts.md 第 2 节），
 * 默认 maxRooms = 100。页面隐藏时 LiveSource 会自己暂停 roomMap2（#14）。
 */
import type { RoomMapUpdate, Unsubscribe } from "../source/source.ts";

export interface RoomMapFeedOptions {
  /** 通常是 Source.subscribeRoomMap */
  readonly subscribe: (shard: string, room: string, listener: (update: RoomMapUpdate) => void) => Unsubscribe;
  /** 某房间当前的 Power Bank 位置（每帧都报，调用方自己去重） */
  readonly onPowerBanks: (room: string, positions: ReadonlyArray<readonly [number, number]>) => void;
  /** 同时订阅的房间上限，默认 100 */
  readonly maxRooms?: number;
}

export interface RoomMapFeed {
  /** 换成订阅 shard 上的这些房间（超出上限的丢弃后面的） */
  show(shard: string, rooms: readonly string[]): void;
  dispose(): void;
}

export const MAX_ROOM_MAPS = 100;

export function createRoomMapFeed(options: RoomMapFeedOptions): RoomMapFeed {
  const max = options.maxRooms ?? MAX_ROOM_MAPS;
  /** `shard/room` → 退订 */
  const active = new Map<string, Unsubscribe>();

  const show = (shard: string, rooms: readonly string[]) => {
    const wanted = new Map(rooms.slice(0, max).map((room) => [`${shard}/${room}`, room]));
    for (const [key, off] of active) {
      if (wanted.has(key)) continue;
      active.delete(key);
      off();
    }
    for (const [key, room] of wanted) {
      if (active.has(key)) continue;
      let open = true;
      const off = options.subscribe(shard, room, (update) => {
        if (open) options.onPowerBanks(room, update["pb"] ?? []);
      });
      active.set(key, () => {
        open = false;
        off();
      });
    }
  };

  return {
    show,
    dispose: () => show("", []),
  };
}
