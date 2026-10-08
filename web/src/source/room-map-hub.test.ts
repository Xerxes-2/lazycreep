/**
 * roomMap2 订阅中心的外部行为：只经 Source 上的订阅集合、租约的 granted 与 onFrame 观察。
 * 调度器换成手动的“动画帧”，以便验证同一帧内的合并。
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import type { RoomMapOptions, RoomMapUpdate, Unsubscribe } from "./source.ts";
import { createRoomMapHub, ROOM_MAP_BUDGET, ROOM_MAP_PRIORITY, type RoomMapLeaseOptions } from "./room-map-hub.ts";

interface Sub {
  readonly key: string;
  readonly keep: boolean;
  readonly listener: (update: RoomMapUpdate) => void;
}

function harness(budget?: number) {
  const subs = new Set<Sub>();
  const source = {
    subscribeRoomMap(
      shard: string,
      room: string,
      listener: (update: RoomMapUpdate) => void,
      _onError?: unknown,
      options?: RoomMapOptions,
    ): Unsubscribe {
      const sub = { key: `${shard}/${room}`, keep: options?.keepWhileHidden === true, listener };
      subs.add(sub);
      return () => void subs.delete(sub);
    },
  };
  const frames: Array<() => void> = [];
  const hub = createRoomMapHub({
    source,
    ...(budget === undefined ? {} : { budget }),
    schedule: (flush) => {
      frames.push(flush);
      return () => {
        const at = frames.indexOf(flush);
        if (at >= 0) frames.splice(at, 1);
      };
    },
  });
  /** 跑完排队的动画帧 */
  const animationFrame = () => {
    for (const flush of frames.splice(0)) flush();
  };
  /** 此刻 Source 上订阅着的频道（去重、排序） */
  const channels = () => [...new Set([...subs].map((s) => s.key))].sort();
  /** 向某频道推一帧（所有监听者都收到，像 LiveSource 那样） */
  const push = (key: string, update: RoomMapUpdate) => {
    for (const sub of [...subs]) if (sub.key === key) sub.listener(update);
  };
  const got: Array<[string, string, RoomMapUpdate]> = [];
  const lease = (priority: number, extra: Partial<RoomMapLeaseOptions> = {}) =>
    hub.lease({ priority, onFrame: (shard, room, frame) => got.push([`${priority}`, `${shard}/${room}`, frame]), ...extra });
  return { hub, subs, channels, push, animationFrame, got, lease };
}

const rooms = (...names: string[]) => names.map((room) => ({ shard: "s", room }));
const keys = (...names: string[]) => names.map((room) => `s/${room}`);

describe("roomMap2 订阅中心", () => {
  it("默认总预算是实测过的 100；优先级 Attack Alert > Minimap > PvP 参战者 > World Map", () => {
    expect(ROOM_MAP_BUDGET).toBe(100);
    const order = [ROOM_MAP_PRIORITY.alert, ROOM_MAP_PRIORITY.minimap, ROOM_MAP_PRIORITY.pvp, ROOM_MAP_PRIORITY.worldMap];
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it("同一频道按频道去重：多个消费方想要同一房间只订阅一次，各自都收到帧", () => {
    const h = harness();
    const a = h.lease(ROOM_MAP_PRIORITY.minimap);
    const b = h.lease(ROOM_MAP_PRIORITY.worldMap);
    a.want(rooms("A", "B"));
    b.want(rooms("B", "C"));
    expect(h.channels()).toEqual(keys("A", "B", "C"));
    expect(h.subs.size).toBe(3);
    h.push("s/B", { x: [[1, 1]] });
    h.animationFrame();
    expect(h.got.map(([who, key]) => `${who}:${key}`).sort()).toEqual(
      [`${ROOM_MAP_PRIORITY.minimap}:s/B`, `${ROOM_MAP_PRIORITY.worldMap}:s/B`].sort(),
    );
  });

  it("总数不超过预算；超出时按优先级截断，共享的频道不重复计数，被截断的房间不在 granted 里", () => {
    createRoot((dispose) => {
      const h = harness(4);
      const map = h.lease(ROOM_MAP_PRIORITY.worldMap);
      const pvp = h.lease(ROOM_MAP_PRIORITY.pvp);
      const minimap = h.lease(ROOM_MAP_PRIORITY.minimap);
      const alert = h.lease(ROOM_MAP_PRIORITY.alert, { keepWhileHidden: true });
      map.want(rooms("A", "M1", "M2"));
      pvp.want(rooms("P1", "P2"));
      minimap.want(rooms("C", "D"));
      alert.want(rooms("A", "B"));
      expect(h.channels()).toEqual(keys("A", "B", "C", "D"));
      expect([...alert.granted()].sort()).toEqual(keys("A", "B"));
      expect([...minimap.granted()].sort()).toEqual(keys("C", "D"));
      expect([...pvp.granted()]).toEqual([]);
      // World Map 想要的 A 已由告警订阅着，照样给它
      expect([...map.granted()]).toEqual(keys("A"));

      // 高优先级让出预算后，低优先级的按自己的先后补上
      minimap.dispose();
      expect([...pvp.granted()].sort()).toEqual(keys("P1", "P2"));
      expect(h.channels()).toEqual(keys("A", "B", "P1", "P2"));
      dispose();
    });
  });

  it("消费方换房间只增删差集；退订与 dispose 不残留订阅，迟到的帧不再分发", () => {
    const h = harness();
    const a = h.lease(ROOM_MAP_PRIORITY.minimap);
    a.want(rooms("A", "B"));
    const first = [...h.subs].find((s) => s.key === "s/A");
    a.want(rooms("A", "C"));
    expect(h.channels()).toEqual(keys("A", "C"));
    expect([...h.subs].find((s) => s.key === "s/A")).toBe(first);

    h.push("s/A", { x: [[1, 1]] });
    a.want([]);
    expect(h.subs.size).toBe(0);
    first!.listener({ x: [[2, 2]] });
    h.animationFrame();
    expect(h.got).toEqual([]);

    a.want(rooms("A"));
    a.dispose();
    expect(h.subs.size).toBe(0);
    const b = h.lease(ROOM_MAP_PRIORITY.pvp);
    b.want(rooms("B"));
    h.hub.dispose();
    expect(h.subs.size).toBe(0);
  });

  it("keepWhileHidden 的消费方（告警）让频道在页面隐藏时也保留；它离开后只剩可暂停的订阅", () => {
    const h = harness();
    const alert = h.lease(ROOM_MAP_PRIORITY.alert, { keepWhileHidden: true });
    const map = h.lease(ROOM_MAP_PRIORITY.worldMap);
    alert.want(rooms("A"));
    map.want(rooms("A", "B"));
    const kept = () => [...h.subs].filter((s) => s.keep).map((s) => s.key);
    const pausable = () =>
      [...h.subs]
        .filter((s) => !s.keep)
        .map((s) => s.key)
        .sort();
    expect(kept()).toEqual(keys("A"));
    expect(pausable()).toEqual(keys("A", "B"));
    alert.dispose();
    expect(kept()).toEqual([]);
    expect(pausable()).toEqual(keys("A", "B"));
  });

  it("everyFrame 的消费方（告警逐帧计数）不合并、每帧立即收到；同一帧经两条订阅到达也只收一次", () => {
    const h = harness();
    const alert = h.lease(ROOM_MAP_PRIORITY.alert, { keepWhileHidden: true, everyFrame: true });
    const map = h.lease(ROOM_MAP_PRIORITY.worldMap);
    alert.want(rooms("A"));
    map.want(rooms("A"));
    const one: RoomMapUpdate = { x: [[1, 1]] };
    h.push("s/A", one);
    h.push("s/A", { x: [[2, 2]] });
    expect(h.got.map(([who, , frame]) => [who, frame])).toEqual([
      [`${ROOM_MAP_PRIORITY.alert}`, one],
      [`${ROOM_MAP_PRIORITY.alert}`, { x: [[2, 2]] }],
    ]);
    h.animationFrame();
    expect(h.got.filter(([who]) => who === `${ROOM_MAP_PRIORITY.worldMap}`)).toHaveLength(1);
  });

  it("按动画帧合并：同一帧内同一房间多次更新只通知一次（最新的一帧）", () => {
    const h = harness();
    const a = h.lease(ROOM_MAP_PRIORITY.minimap);
    a.want(rooms("A", "B"));
    h.push("s/A", { x: [[1, 1]] });
    h.push("s/A", { x: [[2, 2]] });
    h.push("s/B", { y: [[3, 3]] });
    expect(h.got).toEqual([]);
    h.animationFrame();
    expect(h.got).toEqual([
      [`${ROOM_MAP_PRIORITY.minimap}`, "s/A", { x: [[2, 2]] }],
      [`${ROOM_MAP_PRIORITY.minimap}`, "s/B", { y: [[3, 3]] }],
    ]);
    h.push("s/A", { x: [[4, 4]] });
    h.animationFrame();
    expect(h.got).toHaveLength(3);
  });
});
