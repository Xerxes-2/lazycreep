import { describe, expect, it } from "vitest";
import { pickEntries, placePickList } from "./pick-list.ts";

describe("同格选择列表的条目（#60）", () => {
  const objects = {
    ram: { _id: "ram", type: "rampart", x: 5, y: 5, user: "u1" },
    road: { _id: "road", type: "road", x: 5, y: 5 },
    tower: { _id: "tower", type: "tower", x: 5, y: 5, user: "u1" },
    c1: { _id: "c1", type: "creep", x: 5, y: 5, user: "u2", name: "Harvester1" },
    pc: { _id: "pc", type: "powerCreep", x: 5, y: 5, user: "u1", name: "Op" },
    res: { _id: "res", type: "energy", x: 5, y: 5 },
  };
  const users = { u1: { _id: "u1", username: "Alice" }, u2: { _id: "u2", username: "Bob" } };
  const color = (user: unknown) => (user === "u1" ? 0x111111 : user === "u2" ? 0x222222 : 0x999999);

  it("creep / power creep 在前，道路与 rampart 在后，其余在中间；同组内保持点选顺序（自上而下）", () => {
    const ids = ["ram", "c1", "road", "tower", "res", "pc"];
    expect(pickEntries(ids, objects, users, color).map((e) => e.id)).toEqual(["c1", "pc", "tower", "res", "ram", "road"]);
  });

  it("每行带类型、creep 的名字、主人名字与颜色；没有主人的对象没有颜色标记", () => {
    const [creep, , tower, res] = pickEntries(["c1", "pc", "tower", "res"], objects, users, color);
    expect(creep).toEqual({ id: "c1", type: "creep", name: "Harvester1", owner: "Bob", color: 0x222222 });
    expect(tower).toEqual({ id: "tower", type: "tower", name: undefined, owner: "Alice", color: 0x111111 });
    expect(res).toEqual({ id: "res", type: "energy", name: undefined, owner: undefined, color: undefined });
  });

  it("状态里已经没有的对象不进列表", () => {
    expect(pickEntries(["gone", "c1"], objects, users, color).map((e) => e.id)).toEqual(["c1"]);
  });
});

describe("列表的位置（#60）", () => {
  const frame = { width: 400, height: 300 };

  it("放在点击处右下方", () => {
    expect(placePickList({ x: 100, y: 80 }, { width: 120, height: 90 }, frame)).toEqual({ left: 108, top: 88 });
  });

  it("右边或下边放不下时翻到点击处的另一侧", () => {
    expect(placePickList({ x: 350, y: 280 }, { width: 120, height: 90 }, frame)).toEqual({ left: 222, top: 182 });
  });

  it("两侧都放不下时夹在 Room View 之内；比 Room View 还大时贴左上", () => {
    expect(placePickList({ x: 60, y: 60 }, { width: 380, height: 100 }, frame)).toEqual({ left: 20, top: 68 });
    expect(placePickList({ x: 60, y: 60 }, { width: 500, height: 400 }, frame)).toEqual({ left: 0, top: 0 });
  });
});
