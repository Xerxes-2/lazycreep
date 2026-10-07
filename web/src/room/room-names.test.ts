import { describe, expect, it } from "vitest";
import { adjacentRoom } from "./room-names.ts";

describe("相邻房间", () => {
  it("四个方向：北是 N 增大 / S 减小，东是 E 增大 / W 减小", () => {
    expect(adjacentRoom("W13S28", "north")).toBe("W13S27");
    expect(adjacentRoom("W13S28", "south")).toBe("W13S29");
    expect(adjacentRoom("W13S28", "east")).toBe("W12S28");
    expect(adjacentRoom("W13S28", "west")).toBe("W14S28");
    expect(adjacentRoom("E13N21", "north")).toBe("E13N22");
    expect(adjacentRoom("E13N21", "east")).toBe("E14N21");
  });

  it("跨越 0 线：S0 往北是 N0，W0 往东是 E0，反之亦然", () => {
    expect(adjacentRoom("W5S0", "north")).toBe("W5N0");
    expect(adjacentRoom("W5N0", "south")).toBe("W5S0");
    expect(adjacentRoom("W0N5", "east")).toBe("E0N5");
    expect(adjacentRoom("E0N5", "west")).toBe("W0N5");
  });

  it("不分大小写；不是房间名时为 undefined", () => {
    expect(adjacentRoom("w1n1", "north")).toBe("W1N2");
    expect(adjacentRoom("sim", "north")).toBeUndefined();
  });
});
