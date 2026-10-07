import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility } from "../power/visibility.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import { createPvpFeed } from "./pvp-feed.ts";
import { PvpOverview } from "./PvpOverview.tsx";

const mmo = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/mmo/*.json", { eager: true, import: "default" })),
);
const season = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(source: Source, options: { visibility?: ReturnType<typeof manualVisibility>; pollMs?: number } = {}) {
  const opened: { shard: string; room: string }[] = [];
  const replays: { shard: string; room: string; tick: number }[] = [];
  dispose = render(() => {
    const feed = createPvpFeed({
      source: () => source,
      ...(options.visibility ? { visibility: options.visibility } : {}),
      ...(options.pollMs ? { pollMs: options.pollMs } : {}),
    });
    return (
      <I18nProvider>
        <PvpOverview feed={feed} onOpenRoom={(t) => opened.push(t)} onReplay={(t) => replays.push(t)} />
      </I18nProvider>
    );
  }, container);
  return { opened, replays };
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const shards = () => [...container.querySelectorAll<HTMLElement>("[data-shard]")].map((s) => s.dataset["shard"]);
const rooms = (shard: string) =>
  [...container.querySelectorAll<HTMLElement>(`[data-shard="${shard}"] tr[data-room]`)].map((r) => r.dataset["room"]);
const windowButton = (ticks: number) => container.querySelector<HTMLButtonElement>(`button[data-window="${ticks}"]`)!;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  vi.useRealTimers();
});

describe("PvP Overview", () => {
  it("MMO：每个 Shard 一组，组内最近的在前；所有者未知时显示“未知”", async () => {
    mount(new FixtureSource(mmo));
    await settle(() => expect(shards()).toEqual(["shard0", "shard1", "shard2", "shard3", "shardX"]));
    // 默认时间窗 100
    expect(rooms("shard3")).toEqual(["W17S41", "W21S12", "E52N33", "W1S38"]);
    const owner = container.querySelector('[data-shard="shard3"] tr[data-room="W17S41"] [data-owner]')!;
    expect(owner.textContent).toBe("未知");
  });

  it("切换时间窗立即重新过滤，不必等下次轮询", async () => {
    mount(new FixtureSource(mmo));
    await settle(() => expect(rooms("shard3")).toHaveLength(4));
    windowButton(20).click();
    expect(rooms("shard3")).toEqual(["W17S41", "W21S12"]);
    expect(windowButton(20).getAttribute("aria-pressed")).toBe("true");
    windowButton(500).click();
    expect(rooms("shard3")).toHaveLength(6);
  });

  it("飞行中的核弹：目标房间、落点、发射房间、落地 Tick 与剩余 Tick", async () => {
    mount(new FixtureSource(mmo));
    await settle(() => expect(container.querySelectorAll('[data-shard="shard3"] [data-nuke]')).toHaveLength(3));
    const first = container.querySelector('[data-shard="shard3"] [data-nuke]')!.textContent!;
    expect(first).toContain("W47N19");
    expect(first).toContain("(13, 2)");
    expect(first).toContain("W42N18");
    expect(first).toContain("83498856");
    expect(first).toContain(`${83498856 - 83494341}`);
    expect(container.querySelectorAll('[data-shard="shard1"] [data-nuke]')).toHaveLength(0);
  });

  it("赛季服：只有 shardSeason 一组", async () => {
    mount(new FixtureSource(season));
    await settle(() => expect(shards()).toEqual(["shardSeason"]));
    expect(rooms("shardSeason")[0]).toBe("E13N21");
  });

  it("点房间进入 Room View；“回看”从最后战斗 Tick 往前 50 Tick 打开 Replay", async () => {
    const { opened, replays } = mount(new FixtureSource(season));
    await settle(() => expect(rooms("shardSeason").length).toBeGreaterThan(0));
    const row = container.querySelector<HTMLElement>('tr[data-room="W17N21"]')!;
    row.querySelector<HTMLButtonElement>("[data-action=open-room]")!.click();
    expect(opened).toEqual([{ shard: "shardSeason", room: "W17N21" }]);
    row.querySelector<HTMLButtonElement>("[data-action=replay-battle]")!.click();
    expect(replays).toEqual([{ shard: "shardSeason", room: "W17N21", tick: 1025186 - 50 }]);
  });

  it("页面不可见时暂停轮询，回到前台立即补一次", async () => {
    vi.useFakeTimers();
    const source = new FixtureSource(season);
    const getPvp = vi.spyOn(source, "getPvp");
    const visibility = manualVisibility(true);
    mount(source, { visibility, pollMs: 10_000 });
    expect(getPvp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getPvp).toHaveBeenCalledTimes(2);
    visibility.set(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPvp).toHaveBeenCalledTimes(2);
    visibility.set(true);
    expect(getPvp).toHaveBeenCalledTimes(3);
  });

  it("轮询失败显示错误，下次成功后消失", async () => {
    const source = new FixtureSource(season);
    vi.spyOn(source, "getPvp").mockRejectedValueOnce(new Error("boom"));
    mount(source, { pollMs: 20 });
    await settle(() => expect(container.querySelector("[role=alert]")).not.toBeNull());
    await settle(() => expect(container.querySelector("[role=alert]")).toBeNull());
    expect(rooms("shardSeason").length).toBeGreaterThan(0);
  });
});
