import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { manualVisibility } from "../power/visibility.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Source } from "../source/source.ts";
import type { CombatantFeed } from "./combatant-feed.ts";
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

function mount(
  source: Source,
  options: { visibility?: ReturnType<typeof manualVisibility>; pollMs?: number; combatants?: CombatantFeed; mode?: "pvp" | "pve" } = {},
) {
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
        <PvpOverview
          mode={options.mode ?? "pvp"}
          feed={feed}
          onOpenRoom={(t) => opened.push(t)}
          onReplay={(t) => replays.push(t)}
          {...(options.combatants ? { combatants: options.combatants } : {})}
        />
      </I18nProvider>
    );
  }, container);
  return { opened, replays };
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const shards = () => [...container.querySelectorAll<HTMLElement>("[data-shard]")].map((s) => s.dataset["shard"]);
const rooms = (shard: string) =>
  [...container.querySelectorAll<HTMLElement>(`[data-shard="${shard}"] [data-room]`)].map((r) => r.dataset["room"]);
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
    const owner = container.querySelector('[data-shard="shard3"] [data-room="W17S41"] [data-owner]')!;
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
    const row = container.querySelector<HTMLElement>('[data-room="W17N21"]')!;
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

  describe("PvP 与 PvE 分开列", () => {
    const alice = { id: "a", username: "Alice", gcl: 12, objects: 30, ally: false };
    const bob = { id: "b", username: "Bob", gcl: 7, objects: 4, ally: false };
    /** W17N21 记为 PvE（打过 Invader）；E13N21 两个玩家（旁边也有 Keeper）；其余一个玩家、没有 NPC */
    const combatants: CombatantFeed = {
      of: (_shard, room) => {
        if (room === "W17N21") return { kind: "ready", players: [alice], npcs: [] };
        if (room === "E13N21") return { kind: "ready", players: [alice, bob], npcs: ["keeper"] };
        return { kind: "ready", players: [alice], npcs: [] };
      },
      // W17N21 记为 PvE：Invader 已被打死，记号还在
      pve: (_shard, room) => (room === "W17N21" ? ["invader"] : undefined),
    };

    it("PvP 列表：去掉记为 PvE 的房间，其余照列", async () => {
      mount(new FixtureSource(season), { combatants });
      await settle(() => expect(rooms("shardSeason").length).toBeGreaterThan(0));
      expect(rooms("shardSeason")).not.toContain("W17N21");
      expect(rooms("shardSeason")).toContain("E13N21");
      expect(container.querySelector("h2")!.textContent).toBe("PvP 一览");
    });

    it("PvE 列表：只列记为 PvE 的房间，写明见过的对手（已被打死的也算）；不列核弹", async () => {
      mount(new FixtureSource(season), { combatants, mode: "pve" });
      await settle(() => expect(rooms("shardSeason")).toEqual(["W17N21"]));
      expect(container.querySelector("h2")!.textContent).toBe("PvE 一览");
      const card = container.querySelector<HTMLElement>('[data-room="W17N21"]')!;
      expect(card.querySelector("[data-npc=invader]")!.textContent).toBe("对手：Invader");
      expect(card.querySelector("[data-player=a]")).not.toBeNull();
      expect(container.querySelector(".pvp-overview__nukes")).toBeNull();
    });

    it("没有参战者数据时全部算 PvP，PvE 列表为空", async () => {
      mount(new FixtureSource(season), { mode: "pve" });
      await settle(() => expect(container.querySelector('[data-shard="shardSeason"]')).not.toBeNull());
      expect(rooms("shardSeason")).toEqual([]);
      expect(container.querySelector('[data-shard="shardSeason"]')!.textContent).toContain("这个时间窗内没有打 NPC 的房间。");
    });
  });

  describe("卡片布局（#39，适配 260px 的 Sidebar）", () => {
    const players: CombatantFeed = {
      of: (_shard, room) =>
        room === "W17N21"
          ? {
              kind: "ready",
              players: [
                { id: "a", username: "Alice", gcl: 12, objects: 30, ally: true },
                { id: "b", username: "Bob", gcl: 7, objects: 4, ally: false },
              ],
              npcs: [],
            }
          : { kind: "needsToken" },
      pve: () => undefined,
    };

    it("不用表格；每个房间一张卡片：房间名、所有者、相对 Tick（完整 Tick 在提示里）、参战者每人一行、两个有名字的图标按钮", async () => {
      mount(new FixtureSource(season), { combatants: players });
      await settle(() => expect(rooms("shardSeason").length).toBeGreaterThan(0));
      expect(container.querySelector("table")).toBeNull();

      const card = container.querySelector<HTMLElement>('[data-shard="shardSeason"] [data-room="W17N21"]')!;
      expect(card.matches("li.pvp-card")).toBe(true);
      expect(card.querySelector(".pvp-card__room")!.textContent).toBe("W17N21");
      expect(card.querySelector("[data-owner]")).not.toBeNull();
      const ago = card.querySelector<HTMLElement>(".pvp-card__ago")!;
      expect(ago.textContent).toMatch(/^\d+ Tick 前$/);
      expect(ago.title).toContain("1025186");

      const lines = [...card.querySelectorAll<HTMLElement>("[data-combatants] [data-player]")];
      expect(lines.map((l) => l.textContent)).toEqual(["Alice · GCL 12 · 30 个物体 · 盟友", "Bob · GCL 7 · 4 个物体"]);
      expect(lines.every((l) => l.tagName === "LI")).toBe(true);
      expect(lines[0]!.hasAttribute("data-ally")).toBe(true);

      const open = card.querySelector<HTMLButtonElement>("button[data-action=open-room]")!;
      const replay = card.querySelector<HTMLButtonElement>("button[data-action=replay-battle]")!;
      for (const button of [open, replay]) {
        expect(button.querySelector("svg")).not.toBeNull();
        expect(button.textContent!.trim()).toBe("");
        expect(button.title).toBe(button.getAttribute("aria-label"));
      }
      expect(open.getAttribute("aria-label")).toBe("进入房间 W17N21");
      expect(replay.getAttribute("aria-label")).toBe("回看 W17N21 的战斗");
    });

    it("Shard 分组标题与“当前 Tick”分开：Tick 是次要文字", async () => {
      mount(new FixtureSource(season));
      await settle(() => expect(shards()).toEqual(["shardSeason"]));
      const title = container.querySelector<HTMLElement>('[data-shard="shardSeason"] h3')!;
      expect(title.querySelector(".pvp-overview__shard-name")!.textContent).toBe("shardSeason");
      expect(title.querySelector(".pvp-overview__shard-time.settings__muted")!.textContent).toMatch(/^当前 Tick \d+$/);
    });

    it("时间窗是单行分段控件：组里只有三个按钮", async () => {
      mount(new FixtureSource(season));
      const bar = container.querySelector<HTMLElement>(".pvp-overview__bar")!;
      expect(bar.classList.contains("segmented")).toBe(true);
      expect([...bar.children].map((c) => c.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
      expect(bar.getAttribute("aria-label")).toBe("时间窗");
    });
  });
});
