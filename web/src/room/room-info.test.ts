/**
 * #26：房间信息区块的数据——房间状态（控制器）与 map-stats 的合并。
 */
import { describe, expect, it } from "vitest";
import type { MapStats } from "../source/source.ts";
import { roomInfo } from "./room-info.ts";
import { roomStateFrom } from "./room-state.ts";

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86_400_000;

const stats: MapStats = {
  shard: "shard0",
  gameTime: 100,
  rooms: {
    W1N1: { status: "normal", owner: { user: "u1", level: 5 }, novice: NOW + DAY, respawnArea: NOW - DAY, safeMode: true },
    W2N1: { status: "normal", owner: { user: "u2", level: 0 } },
  },
  users: { u1: { _id: "u1", username: "Alice" }, u2: { _id: "u2", username: "Bob" } },
};

describe("roomInfo", () => {
  it("只有 map-stats 时：所有者、RCL、新手区截止时间、已过期的重生区、安全模式", () => {
    expect(roomInfo({ room: "W1N1", state: undefined, stats, now: NOW })).toEqual({
      room: "W1N1",
      owner: "Alice",
      reservedBy: undefined,
      level: 5,
      novice: NOW + DAY,
      respawnArea: false,
      safeMode: true,
      sign: undefined,
    });
  });

  it("map-stats 的 level 0 是预定", () => {
    expect(roomInfo({ room: "W2N1", state: undefined, stats, now: NOW })).toMatchObject({ owner: undefined, reservedBy: "Bob", level: undefined });
  });

  it("两者都没有时各项未知", () => {
    expect(roomInfo({ room: "W9N9", state: undefined, stats: undefined, now: NOW })).toMatchObject({
      owner: undefined,
      novice: undefined,
      respawnArea: undefined,
      safeMode: undefined,
    });
  });

  it("控制器优先：安全模式给出剩余 Tick，签名带签名者", () => {
    const state = {
      ...roomStateFrom({
        objects: {
          c: { _id: "c", type: "controller", x: 1, y: 1, level: 7, user: "u1", safeMode: 1300, sign: { user: "u2", text: "hi" } },
        },
        users: { u1: { _id: "u1", username: "Alice" } },
      }),
      gameTime: 1000,
    };
    expect(roomInfo({ room: "W1N1", state, stats, now: NOW })).toMatchObject({
      owner: "Alice",
      level: 7,
      safeMode: 300,
      novice: NOW + DAY,
      sign: { text: "hi", user: "Bob" },
    });
  });
});
