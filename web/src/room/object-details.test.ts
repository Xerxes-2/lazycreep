import { describe, expect, it } from "vitest";
import { describeObject, type ObjectDetails } from "./object-details.ts";

const users = { u1: { _id: "u1", username: "Xerxes_2" } };
const field = (d: ObjectDetails, key: string) => d.fields.find((f) => f.key === key)?.value;

describe("对象详情", () => {
  const creep = {
    _id: "c1",
    type: "creep",
    name: "upgrader-1",
    x: 24,
    y: 12,
    room: "W13S28",
    user: "u1",
    hits: 250,
    hitsMax: 400,
    body: [
      { type: "work", hits: 100, boost: "XGH2O" },
      { type: "work", hits: 0 },
      { type: "carry", hits: 50 },
      { type: "move", hits: 100 },
    ],
    store: { energy: 30, O: 0 },
    storeCapacity: 50,
    ageTime: 1100,
    fatigue: 2,
    spawning: false,
    actionLog: { attack: null, say: { message: "hi" } },
    memoryTag: 7,
  };

  it("creep：所有者、类型、名字、坐标、血量、body、资源、存活 Tick", () => {
    const d = describeObject(creep, users, 1000);
    expect(field(d, "type")).toBe("creep");
    expect(field(d, "owner")).toBe("Xerxes_2");
    expect(field(d, "name")).toBe("upgrader-1");
    expect(field(d, "position")).toBe("24, 12");
    expect(field(d, "hits")).toBe("250 / 400");
    expect(field(d, "ticksToLive")).toBe("100");
    expect(field(d, "body")).toBe("work ×2 (XGH2O ×1, 0 HP ×1), carry ×1, move ×1");
    expect(field(d, "store")).toBe("energy 30 / 50");
    expect(field(d, "fatigue")).toBe("2");
  });

  it("不认识的字段按原始键值列出，已展示的字段不重复", () => {
    const d = describeObject(creep, users, 1000);
    const raw = Object.fromEntries(d.raw);
    expect(raw["memoryTag"]).toBe("7");
    expect(raw["actionLog"]).toBe('{"attack":null,"say":{"message":"hi"}}');
    for (const known of ["_id", "type", "name", "x", "y", "user", "hits", "hitsMax", "body", "store", "storeCapacity", "ageTime"]) {
      expect(raw[known]).toBeUndefined();
    }
  });

  it("建筑：多种资源逐项列出，容量按资源相加；控制器的等级与进度", () => {
    const terminal = describeObject(
      { _id: "t", type: "terminal", x: 1, y: 2, user: "u9", store: { energy: 4000, T: 0, O: 6060 }, storeCapacity: 300000, hits: 3000, hitsMax: 3000 },
      users,
      undefined,
    );
    expect(field(terminal, "owner")).toBe("u9");
    expect(field(terminal, "store")).toBe("energy 4000, O 6060 / 300000");

    const spawn = describeObject(
      { _id: "s", type: "spawn", x: 1, y: 2, store: { energy: 300 }, storeCapacityResource: { energy: 300 }, spawning: { name: "w-2", needTime: 150, spawnTime: 1050 } },
      users,
      1000,
    );
    expect(field(spawn, "store")).toBe("energy 300 / 300");
    expect(field(spawn, "spawning")).toBe("w-2 (50)");

    const controller = describeObject(
      { _id: "k", type: "controller", x: 1, y: 2, level: 7, progress: 500, progressTotal: 1000, downgradeTime: 1500 },
      users,
      1000,
    );
    expect(field(controller, "level")).toBe("7");
    expect(field(controller, "progress")).toBe("500 / 1000");
    expect(field(controller, "downgrade")).toBe("500");
  });

  it("source 与 mineral 的储量；没有的字段不出现", () => {
    const source = describeObject({ _id: "s", type: "source", x: 1, y: 1, energy: 1296, energyCapacity: 3000 }, users, 1);
    expect(field(source, "energy")).toBe("1296 / 3000");
    expect(field(source, "owner")).toBeUndefined();
    expect(field(source, "hits")).toBeUndefined();
    const mineral = describeObject({ _id: "m", type: "mineral", x: 1, y: 1, mineralType: "O", mineralAmount: 63940 }, users, 1);
    expect(field(mineral, "mineral")).toBe("O 63940");
  });
});
