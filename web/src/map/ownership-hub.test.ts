import { describe, expect, it } from "vitest";
import type { MapStats } from "../source/source.ts";
import { createOwnershipHub } from "./ownership-hub.ts";

const SIZE = { width: 102, height: 102 };

function harness() {
  const calls: { shard: string; rooms: readonly string[]; resolve: (stats: MapStats) => void; reject: (e: unknown) => void }[] = [];
  const hub = createOwnershipHub({
    fetch: (shard, rooms) => new Promise<MapStats>((resolve, reject) => calls.push({ shard, rooms, resolve, reject })),
  });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { hub, calls, settle };
}

describe("OwnershipHub", () => {
  it("把各次 map-stats 按 Shard 累积起来，并通知订阅者", async () => {
    const { hub, calls, settle } = harness();
    const seen: MapStats[] = [];
    hub.subscribe((stats) => seen.push(stats));
    hub.requestRooms([{ shard: "a", room: "W1N1" }]);
    calls[0]!.resolve({
      shard: "a",
      gameTime: 1,
      rooms: { W1N1: { status: "normal", owner: { user: "u", level: 3 } } },
      users: { u: { _id: "u", username: "bob" } },
    });
    await settle();
    hub.request("a", SIZE, { x0: 70, y0: 70, x1: 71, y1: 71 });
    calls[1]!.resolve({ shard: "a", gameTime: 2, rooms: { E19S19: { status: "normal" } }, users: {} });
    await settle();
    expect(seen).toHaveLength(2);
    expect(hub.stats("a")).toMatchObject({
      shard: "a",
      rooms: { W1N1: { owner: { user: "u", level: 3 } }, E19S19: { status: "normal" } },
      users: { u: { username: "bob" } },
    });
    expect(hub.stats("b")).toBeUndefined();
  });

  it("失败通知订阅者的 onError；退订后不再收到", async () => {
    const { hub, calls, settle } = harness();
    const errors: unknown[] = [];
    const off = hub.subscribe(
      () => {},
      (error) => errors.push(error),
    );
    hub.requestRooms([{ shard: "a", room: "W1N1" }]);
    calls[0]!.reject(new Error("down"));
    await settle();
    expect(errors).toHaveLength(1);
    off();
    hub.requestRooms([{ shard: "a", room: "W1N1" }]);
    calls[1]!.reject(new Error("down"));
    await settle();
    expect(errors).toHaveLength(1);
  });
});
