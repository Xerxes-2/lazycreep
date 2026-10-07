import { describe, expect, it } from "vitest";
import { cameraKey, loadCamera, saveCamera } from "./room-camera-store.ts";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("每个房间的视口持久化", () => {
  it("按 Server + Shard + 房间分开保存，读回原值", () => {
    const storage = memory();
    const a = cameraKey("season", "shardSeason", "W13S28");
    saveCamera(storage, a, { cx: 10, cy: 20, span: 8 });
    expect(loadCamera(storage, a)).toEqual({ cx: 10, cy: 20, span: 8 });
    expect(loadCamera(storage, cameraKey("season", "shardSeason", "W12S28"))).toBeUndefined();
    expect(loadCamera(storage, cameraKey("mmo", "shardSeason", "W13S28"))).toBeUndefined();
    expect(loadCamera(storage, cameraKey("season", "shard0", "W13S28"))).toBeUndefined();
  });

  it("存储不可用、抛错或内容损坏时当作没有记录，不抛错", () => {
    const key = cameraKey("s", "", "W1N1");
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(() => saveCamera(throwing, key, { cx: 1, cy: 1, span: 5 })).not.toThrow();
    expect(loadCamera(throwing, key)).toBeUndefined();
    expect(loadCamera(undefined, key)).toBeUndefined();
    const broken = memory();
    broken.setItem(key, "{not json");
    expect(loadCamera(broken, key)).toBeUndefined();
    broken.setItem(key, JSON.stringify({ cx: "a", cy: 1, span: 5 }));
    expect(loadCamera(broken, key)).toBeUndefined();
  });
});
