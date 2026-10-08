import { describe, expect, it } from "vitest";
import { bodyCells, bodySummary, describeObject, type ObjectDetails } from "./object-details.ts";

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
    expect(field(d, "body")).toBe("2W 1C 1M");
    expect(d.body?.map((c) => c.type)).toEqual(["work", "work", "carry", "move"]);
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

  describe("墓碑", () => {
    const tombstone = {
      _id: "t1",
      type: "tombstone",
      room: "W17S26",
      x: 22,
      y: 3,
      user: "u1",
      deathTime: 1041636,
      decayTime: 1041786,
      creepId: "6ac77807c7926d497cc17e29",
      creepName: "Shade1372",
      creepTicksToLive: 1394,
      creepBody: ["move", "carry", "move", "carry"],
      creepSaying: null,
      store: { energy: 427 },
    };
    const text = (d: ObjectDetails, key: string) => d.fields.find((f) => f.key === key)?.text;

    it("名字、死于几 Tick 前、推断死因、活了多久、生前 body、creep id；不再出现在其他字段里", () => {
      const d = describeObject(tombstone, users, 1041664);
      expect(field(d, "name")).toBe("Shade1372");
      expect(text(d, "died")).toEqual({ key: "diedAgo", params: { ago: 28, tick: 1041636 } });
      expect(text(d, "deathCause")).toEqual({ key: "early", params: { left: 1394 } });
      expect(field(d, "lived")).toBe("106 / 1500");
      expect(field(d, "body")).toBe("2M 2C");
      // 墓碑的 body 只有类型：血量未知，画成满格
      expect(d.body?.map((c) => [c.type, c.hits, c.fill])).toEqual([
        ["move", undefined, 1],
        ["carry", undefined, 1],
        ["move", undefined, 1],
        ["carry", undefined, 1],
      ]);
      expect(field(d, "creepId")).toBe("6ac77807c7926d497cc17e29");
      expect(field(d, "decay")).toBe("122");
      expect(field(d, "saying")).toBeUndefined();
      expect(d.raw).toEqual([]);
    });

    it("死时剩余寿命为 1 算寿终；带 CLAIM 的寿命按 600 算；最后说的话；Tick 未知时只给死亡 Tick", () => {
      const d = describeObject({ ...tombstone, creepTicksToLive: 1, creepBody: ["claim", "move"], creepSaying: "bye" }, users, undefined);
      expect(text(d, "deathCause")).toEqual({ key: "aged" });
      expect(field(d, "lived")).toBe("599 / 600");
      expect(field(d, "saying")).toBe("bye");
      expect(text(d, "died")).toEqual({ key: "diedAt", params: { tick: 1041636 } });
    });
  });

  describe("身体部件网格（#59）", () => {
    it("按 body 顺序给出每格的类型、颜色（与身体环同一张表）、填充比例与强化", () => {
      const cells = bodyCells([
        { type: "tough", hits: 100, boost: "XGHO2" },
        { type: "work", hits: 0 },
        { type: "move", hits: 37 },
        { type: "ranged_attack", hits: 100 },
        { type: "carry", hits: 100 },
        { type: "heal", hits: 100 },
        { type: "attack", hits: 100 },
        { type: "claim", hits: 100 },
      ]);
      expect(cells.map((c) => c.type)).toEqual(["tough", "work", "move", "ranged_attack", "carry", "heal", "attack", "claim"]);
      expect(cells.map((c) => c.color)).toEqual(["#ffffff", "#fde574", "#aab7c5", "#7fa7e5", "#777777", "#56cf5e", "#f72e41", "#b99cfb"]);
      expect(cells.map((c) => c.fill)).toEqual([1, 0, 0.37, 1, 1, 1, 1, 1]);
      expect(cells[0]!.boost).toBe("XGHO2");
      expect(cells[1]!.boost).toBeUndefined();
      expect(cells[2]!.hits).toBe(37);
    });

    it("官方 safeBody 的 { \"0\": … } 形式按数字键排序；最多 50 格；不认识的类型用中性色", () => {
      const keyed = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), { type: i === 10 ? "carry" : "move", hits: 100 }]));
      expect(bodyCells(keyed)[10]!.type).toBe("carry");
      expect(bodyCells(Array.from({ length: 60 }, () => ({ type: "move", hits: 100 })))).toHaveLength(50);
      expect(bodyCells([{ type: "wings", hits: 120 }])[0]).toMatchObject({ type: "wings", color: "#999999", fill: 1 });
      expect(bodyCells(undefined)).toEqual([]);
    });

    it("文字汇总用缩写，按首次出现的顺序计数（含 0 HP 的部件）", () => {
      const parts = (type: string, n: number) => Array.from({ length: n }, () => ({ type, hits: 100 }));
      expect(bodySummary(bodyCells([...parts("work", 5), ...parts("carry", 3), ...parts("move", 8)]))).toBe("5W 3C 8M");
      expect(
        bodySummary(bodyCells([...parts("tough", 2), ...parts("ranged_attack", 1), ...parts("heal", 4), ...parts("claim", 1), ...parts("attack", 1), ...parts("tough", 1)])),
      ).toBe("3T 1R 4H 1CL 1A");
    });
  });
});
