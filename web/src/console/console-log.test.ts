import { describe, expect, it } from "vitest";
import type { ConsoleEvent } from "../source/source.ts";
import { appendConsole, emptyConsoleLog, filterConsole, type ConsoleLog } from "./console-log.ts";

const out = (shard: string | null, log: string[], results: string[] = []): ConsoleEvent => ({
  kind: "output",
  shard,
  log,
  results,
});
const err = (shard: string | null, error: string): ConsoleEvent => ({ kind: "error", shard, error });

function feed(events: ConsoleEvent[], limit = 100): ConsoleLog {
  return events.reduce((log, e) => appendConsole(log, e, limit), emptyConsoleLog());
}
const texts = (log: ConsoleLog, shard: string | null, keyword = "") =>
  filterConsole(log, { shard, keyword }).map((e) => `${e.kind}:${e.text}`);

describe("Console 日志", () => {
  it("一帧里的日志、结果、错误按到达顺序拆成条目，按 Shard 归类", () => {
    const log = feed([out("shard0", ["a", "b"], ["42"]), out("shard1", ["c"]), err("shard0", "boom")]);
    expect(texts(log, "shard0")).toEqual(["log:a", "log:b", "result:42", "error:boom"]);
    expect(texts(log, "shard1")).toEqual(["log:c"]);
    expect(texts(log, "shard2")).toEqual([]);
  });

  it("每个 Shard 只保留最近 limit 条，别的 Shard 不受影响", () => {
    const log = feed([out("shard1", ["keep"]), out("shard0", ["1", "2", "3"]), out("shard0", ["4", "5"])], 3);
    expect(texts(log, "shard0")).toEqual(["log:3", "log:4", "log:5"]);
    expect(texts(log, "shard1")).toEqual(["log:keep"]);
  });

  it("上限调小后，下一帧到达时裁掉多余的旧条目", () => {
    let log = feed([out("s", ["1", "2", "3", "4"])], 10);
    log = appendConsole(log, out("s", ["5"]), 2);
    expect(texts(log, "s")).toEqual(["log:4", "log:5"]);
  });

  it("关键字过滤不分大小写，空白关键字不过滤", () => {
    const log = feed([out("s", ["Harvester spawned", "upgrader died"], ["HARVEST ok"]), err("s", "x")]);
    expect(texts(log, "s", "harvest")).toEqual(["log:Harvester spawned", "result:HARVEST ok"]);
    expect(texts(log, "s", "  ")).toHaveLength(4);
  });

  it("不分 Shard 的 Server（shard 为 null）照样归为一类", () => {
    const log = feed([out(null, ["a"]), err(null, "b")]);
    expect(texts(log, null)).toEqual(["log:a", "error:b"]);
  });

  it("条目 id 不重复且按到达递增（列表渲染的 key）", () => {
    const log = feed([out("a", ["1", "2"]), out("b", ["3"]), out("a", ["4"])], 2);
    const a = filterConsole(log, { shard: "a", keyword: "" }).map((e) => e.id);
    const b = filterConsole(log, { shard: "b", keyword: "" }).map((e) => e.id);
    expect(new Set([...a, ...b]).size).toBe(3);
    expect(a[0]!).toBeLessThan(a[1]!);
  });

  it("没有新条目的帧不改变日志（沿用旧引用）", () => {
    const log = feed([out("s", ["a"])]);
    expect(appendConsole(log, out("s", []), 10)).toBe(log);
  });

  it("列出出现过输出的 Shard", () => {
    const log = feed([out("shard1", ["a"]), out("shard0", ["b"])]);
    expect(log.shards).toEqual(["shard1", "shard0"]);
  });
});
