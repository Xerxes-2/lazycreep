import { describe, expect, it } from "vitest";
import type { RoomMapUpdate } from "../source/source.ts";
import { createRoomMapFeed } from "./room-map-feed.ts";

function harness(maxRooms?: number) {
  const live = new Map<string, (update: RoomMapUpdate) => void>();
  const banks: Array<[string, ReadonlyArray<readonly [number, number]>]> = [];
  const feed = createRoomMapFeed({
    subscribe: (shard, room, listener) => {
      const key = `${shard}/${room}`;
      expect(live.has(key)).toBe(false);
      live.set(key, listener);
      return () => live.delete(key);
    },
    onPowerBanks: (room, positions) => banks.push([room, positions]),
    ...(maxRooms === undefined ? {} : { maxRooms }),
  });
  return { feed, live, banks };
}

const frame = (pb: Array<[number, number]>): RoomMapUpdate => ({ w: [], r: [], pb, m: [[1, 1]] });

describe("roomMap2 订阅（Power Bank）", () => {
  it("订阅所给的房间；换一组房间时只退订离开的、只订阅新来的", () => {
    const { feed, live } = harness();
    feed.show("s", ["W1N1", "W2N1"]);
    const first = live.get("s/W1N1");
    expect([...live.keys()].sort()).toEqual(["s/W1N1", "s/W2N1"]);
    feed.show("s", ["W1N1", "W3N1"]);
    expect([...live.keys()].sort()).toEqual(["s/W1N1", "s/W3N1"]);
    expect(live.get("s/W1N1")).toBe(first);
  });

  it("最多订阅 maxRooms 个，取列表前面的", () => {
    const { feed, live } = harness(2);
    feed.show("s", ["A", "B", "C"]);
    expect([...live.keys()].sort()).toEqual(["s/A", "s/B"]);
  });

  it("每帧的 pb 交给 onPowerBanks；没有 pb 键时当作没有 Power Bank", () => {
    const { feed, live, banks } = harness();
    feed.show("s", ["W1N1"]);
    live.get("s/W1N1")!(frame([[10, 20]]));
    live.get("s/W1N1")!({ w: [] });
    expect(banks).toEqual([
      ["W1N1", [[10, 20]]],
      ["W1N1", []],
    ]);
  });

  it("换 Shard 时全部退订旧 Shard；空列表与 dispose 退订一切", () => {
    const { feed, live } = harness();
    feed.show("s", ["W1N1"]);
    feed.show("t", ["W1N1"]);
    expect([...live.keys()]).toEqual(["t/W1N1"]);
    feed.show("t", []);
    expect(live.size).toBe(0);
    feed.show("t", ["W1N1"]);
    feed.dispose();
    expect(live.size).toBe(0);
  });

  it("退订后迟到的帧不再上报", () => {
    const { feed, live, banks } = harness();
    feed.show("s", ["W1N1"]);
    const listener = live.get("s/W1N1")!;
    feed.show("s", []);
    listener(frame([[1, 1]]));
    expect(banks).toEqual([]);
  });
});
