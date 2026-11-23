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

  it("wantRooms 与 requestRooms 的清单并存（Minimap 不会顶掉 Battle Overview 的补查）；释放后不再补查", async () => {
    const { hub, calls, settle } = harness();
    hub.requestRooms([{ shard: "a", room: "W1N1" }]);
    const release = hub.wantRooms([{ shard: "a", room: "E30S30" }]);
    calls[0]!.resolve({ shard: "a", gameTime: 1, rooms: {}, users: {} });
    await settle();
    expect(calls).toHaveLength(2);
    const asked = calls.flatMap((c) => c.rooms);
    expect(asked).toContain("W1N1");
    expect(asked).toContain("E30S30");

    release();
    hub.wantRooms([]);
    calls[1]!.resolve({ shard: "a", gameTime: 2, rooms: {}, users: {} });
    await settle();
    hub.requestRooms([]);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("释放的清单不再补查", async () => {
    const { hub, calls, settle } = harness();
    hub.request("a", SIZE, { x0: 70, y0: 70, x1: 71, y1: 71 });
    const release = hub.wantRooms([{ shard: "a", room: "W1N1" }]);
    release();
    calls[0]!.resolve({ shard: "a", gameTime: 1, rooms: {}, users: {} });
    await settle();
    expect(calls).toHaveLength(1);
  });
});

describe("OwnershipHub.observe", () => {
  const controller = (fields: Record<string, unknown>) => ({ c: { type: "controller", ...fields } });

  it("按看到的 controller 改写所有者与 RCL，保留 map-stats 的其余字段，并通知订阅者", async () => {
    const { hub, calls, settle } = harness();
    const seen: MapStats[] = [];
    hub.subscribe((stats) => seen.push(stats));
    hub.requestRooms([{ shard: "a", room: "W1N1" }]);
    calls[0]!.resolve({
      shard: "a",
      gameTime: 1,
      rooms: { W1N1: { status: "normal", owner: { user: "u", level: 3 }, mineral: { type: "H", density: 2 } } },
      users: {},
    });
    await settle();
    hub.observe("a", "W1N1", { objects: controller({ user: "u", level: 4 }), users: { u: { _id: "u", username: "bob" } } });
    expect(hub.stats("a")?.rooms["W1N1"]).toEqual({ status: "normal", owner: { user: "u", level: 4 }, mineral: { type: "H", density: 2 } });
    expect(hub.stats("a")?.users["u"]).toMatchObject({ username: "bob" });
    expect(seen.at(-1)?.rooms).toEqual({ W1N1: hub.stats("a")?.rooms["W1N1"] });
  });

  it("预定记为 level 0；controller 无主时去掉所有者", () => {
    const { hub } = harness();
    hub.observe("a", "W2N2", { objects: controller({ reservation: { user: "v", endTime: 10 } }), users: {} });
    expect(hub.stats("a")?.rooms["W2N2"]?.owner).toEqual({ user: "v", level: 0 });
    hub.observe("a", "W2N2", { objects: controller({ level: 0 }), users: {} });
    expect(hub.stats("a")?.rooms["W2N2"]).toEqual({ status: "normal" });
  });

  it("没有变化或没有 controller 时不通知", () => {
    const { hub } = harness();
    const seen: MapStats[] = [];
    hub.subscribe((stats) => seen.push(stats));
    hub.observe("a", "W3N3", { objects: controller({ user: "u", level: 2 }), users: {} });
    hub.observe("a", "W3N3", { objects: controller({ user: "u", level: 2 }), users: {} });
    hub.observe("a", "W5N5", { objects: { s: { type: "source" } }, users: {} });
    hub.observe("a", "W6N6", { objects: controller({}), users: {} });
    expect(seen).toHaveLength(1);
    expect(hub.stats("a")?.rooms["W5N5"]).toBeUndefined();
  });
});
