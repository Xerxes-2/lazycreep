import { describe, expect, it } from "vitest";
import type { RoomState } from "../room/room-state.ts";
import { roomMetrics } from "./room-metrics.ts";

const state = (objects: RoomState["objects"], users: RoomState["users"] = {}): RoomState => ({ gameTime: 100, objects, users, visual: "" });

describe("roomMetrics", () => {
  it("storage 与 terminal 的能量：新格式 store 与旧格式 energy 都认", () => {
    const got = roomMetrics(
      state({
        s: { type: "storage", x: 1, y: 1, store: { energy: 400_000, H: 5 } },
        t: { type: "terminal", x: 2, y: 2, energy: 50_000 },
      }),
      { me: undefined, allies: undefined },
    );
    expect(got).toEqual({ storage: 400_000, terminal: 50_000 });
  });

  it("controller 进度按官方表算百分比，8 级不给", () => {
    expect(roomMetrics(state({ c: { type: "controller", x: 1, y: 1, level: 2, progress: 9000 } }), { me: undefined, allies: undefined }).controller).toBe(20);
    expect(roomMetrics(state({ c: { type: "controller", x: 1, y: 1, level: 8, progress: 0 } }), { me: undefined, allies: undefined }).controller).toBeUndefined();
  });

  it("我的与敌方 creep：盟友与 Source Keeper 不算敌方，Invader 算", () => {
    const got = roomMetrics(
      state(
        {
          a: { type: "creep", x: 1, y: 1, user: "me" },
          b: { type: "powerCreep", x: 1, y: 2, user: "me" },
          c: { type: "creep", x: 1, y: 3, user: "ally" },
          d: { type: "creep", x: 1, y: 4, user: "foe" },
          e: { type: "creep", x: 1, y: 5, user: "2" },
          f: { type: "creep", x: 1, y: 6, user: "3" },
        },
        { ally: { _id: "ally", username: "Friend" }, foe: { _id: "foe", username: "Enemy" } },
      ),
      { me: "me", allies: new Set(["friend"]) },
    );
    expect(got).toEqual({ mine: 2, hostile: 2 });
  });

  it("不知道我是谁时不算 creep", () => {
    expect(roomMetrics(state({ a: { type: "creep", x: 1, y: 1, user: "x" } }), { me: undefined, allies: undefined })).toEqual({});
  });
});
