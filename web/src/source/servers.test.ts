import { describe, expect, it } from "vitest";
import { isOfficialServer, SERVER_PRESETS } from "./servers.ts";
import { ROOM_MAP_BUDGET, roomMapBudget } from "./room-map-hub.ts";
import { ownershipLimits } from "../map/ownership-budget.ts";
const memoryStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

const custom = { id: "custom-abc-1234" };

describe("官服 / 私服", () => {
  it("预置 Server 是官服，自定义 Server 是私服", () => {
    for (const preset of Object.values(SERVER_PRESETS)) expect(isOfficialServer(preset)).toBe(true);
    expect(isOfficialServer(custom)).toBe(false);
  });

  it("roomMap2 订阅上限只对官服", () => {
    expect(roomMapBudget(SERVER_PRESETS.mmo)).toBe(ROOM_MAP_BUDGET);
    expect(roomMapBudget(custom)).toBe(Infinity);
    expect(roomMapBudget(undefined)).toBe(ROOM_MAP_BUDGET);
  });

  it("map-stats 额度只对官服", () => {
    expect(ownershipLimits(custom).maxPerHour).toBe(Infinity);
    expect(ownershipLimits(SERVER_PRESETS.season)).toEqual({});
    expect(ownershipLimits(SERVER_PRESETS.season, memoryStorage()).budget).toBeDefined();
  });
});
