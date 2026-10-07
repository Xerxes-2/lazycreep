import { beforeEach, describe, expect, it } from "vitest";
import { exportSettings, importSettings } from "../customize/settings-transfer.ts";
import type { KeyValueStorage } from "../storage/local-store.ts";
import { ALERT_MEMORY_TTL_MS, emptyAlertMemory, loadAlertMemory, saveAlertMemory } from "./alert-memory.ts";

const HOUR = 3_600_000;

function filled(at: number) {
  const memory = emptyAlertMemory();
  memory.lastAlert.set("shardSeason/E13N21/pvp", at);
  memory.pvpAlerted.set("shardSeason/E13N21", { tick: 1025187, at });
  memory.nukesAlerted.set("nuke-1", at);
  memory.watched.set("shardSeason", { since: 1025177, at });
  return memory;
}

describe("告警记忆的持久化", () => {
  beforeEach(() => localStorage.clear());

  it("按 Server 分开保存，刷新后读回", () => {
    saveAlertMemory(localStorage, "season", filled(1000), 1000);
    const loaded = loadAlertMemory(localStorage, "season", 2000);
    expect(loaded).toEqual(filled(1000));
    expect(loadAlertMemory(localStorage, "mmo", 2000)).toEqual(emptyAlertMemory());
  });

  it("过期条目在读写时清理", () => {
    const memory = filled(0);
    memory.lastAlert.set("shardSeason/W17N21/nuke", ALERT_MEMORY_TTL_MS);
    saveAlertMemory(localStorage, "season", memory, ALERT_MEMORY_TTL_MS + HOUR);
    const loaded = loadAlertMemory(localStorage, "season", ALERT_MEMORY_TTL_MS + HOUR);
    expect([...loaded.lastAlert.keys()]).toEqual(["shardSeason/W17N21/nuke"]);
    expect(loaded.pvpAlerted.size + loaded.nukesAlerted.size + loaded.watched.size).toBe(0);
    expect(loadAlertMemory(localStorage, "season", 3 * ALERT_MEMORY_TTL_MS)).toEqual(emptyAlertMemory());
  });

  it("存储不可用或内容损坏时当作没有记忆", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => saveAlertMemory(throwing, "season", filled(0), 0)).not.toThrow();
    expect(loadAlertMemory(throwing, "season", 0)).toEqual(emptyAlertMemory());
    localStorage.setItem("msc.alertState.season", "{oops");
    expect(loadAlertMemory(localStorage, "season", 0)).toEqual(emptyAlertMemory());
  });

  it("是运行状态：不进设置导出，导入设置也不删它", () => {
    saveAlertMemory(localStorage, "season", filled(1000), 1000);
    const file = exportSettings(localStorage);
    expect(Object.keys(file.settings).some((k) => k.startsWith("msc.alertState"))).toBe(false);
    importSettings(localStorage, file);
    expect(loadAlertMemory(localStorage, "season", 2000)).toEqual(filled(1000));
  });
});
