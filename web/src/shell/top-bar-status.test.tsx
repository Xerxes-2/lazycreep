import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../App";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { TIME_REUSE_MS } from "../source/shared-time.ts";
import type { ConnectionState, CpuUpdate, StreamErrorListener, Unsubscribe } from "../source/source.ts";

/**
 * 录制数据改两处：Shard 列表多一个 shardB（测试切 Shard）；“我”换成录制里 E13N21 交火的一方，
 * 我的房间换成 E13N21，于是会出 Attack Alert 横幅（同 alert/attack-alert.test.tsx 的做法）。
 */
const files = Object.values(
  import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }),
).map((file) => {
  const f = file as { meta: { kind: string }; body: { shards?: readonly object[] } };
  if (f.meta.kind === "shards") {
    return { ...f, body: { shards: [...(f.body.shards ?? []), { name: "shardB", rooms: 1, users: 1, tick: 4000 }] } };
  }
  if (f.meta.kind === "me") {
    return {
      ...f,
      body: { user: { _id: "65b2ded6e582880012134da6", username: "volotsyouga" }, rooms: { shards: { shardSeason: ["E13N21"] } } },
    };
  }
  return file;
});
const bundle = fixtureBundle(files);

/** 可控的录制 Source：连接状态、CPU 帧、逐次递增的 Tick 都由测试驱动 */
class ProbeSource extends FixtureSource {
  connection: ConnectionState = "authenticated";
  private readonly connectionListeners2 = new Set<(state: ConnectionState) => void>();
  readonly cpuListeners = new Set<(update: CpuUpdate) => void>();
  cpuSubscriptions = 0;
  readonly timeRequests: string[] = [];
  private tick = 1025187;
  closed = false;

  override close(): void {
    this.closed = true;
    super.close();
  }

  override onConnection(listener: (state: ConnectionState) => void): Unsubscribe {
    this.connectionListeners2.add(listener);
    listener(this.connection);
    return () => void this.connectionListeners2.delete(listener);
  }

  setConnection(state: ConnectionState) {
    this.connection = state;
    for (const listener of [...this.connectionListeners2]) listener(state);
  }

  override subscribeCpu(listener: (update: CpuUpdate) => void, _onError?: StreamErrorListener): Unsubscribe {
    this.cpuSubscriptions++;
    this.cpuListeners.add(listener);
    return () => void this.cpuListeners.delete(listener);
  }

  emitCpu(update: CpuUpdate) {
    for (const listener of [...this.cpuListeners]) listener(update);
  }

  override async getTime(shard: string): Promise<number> {
    this.timeRequests.push(shard);
    return this.tick++;
  }
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let created: ProbeSource[];

function mount(options: { token?: string } = {}) {
  localStorage.setItem(
    "msc.settings",
    JSON.stringify({ serverId: "season", customServers: [], token: options.token ?? "", shards: {} }),
  );
  // 录制只有几十个 Tick：陌生人告警的门槛放低到 30 Tick
  localStorage.setItem("msc.alerts", JSON.stringify({ strangerTicks: 30 }));
  dispose = render(
    () => (
      <App
        sourceFor={() => {
          const source = new ProbeSource(bundle, { speed: Infinity });
          created.push(source);
          return source;
        }}
        narrow={() => false}
        tickPollMs={10}
      />
    ),
    container,
  );
}

const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const status = (part: string) => q(`.top-bar [data-status="${part}"]`);
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const shownView = () =>
  [...container.querySelectorAll<HTMLElement>(".main-view [data-view]")].filter((el) => !el.hidden).map((el) => el.dataset["view"]);

describe("Top Bar 状态（#25）", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", location.pathname);
    container = document.createElement("div");
    document.body.append(container);
    created = [];
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("World Map 模式下 Tick 与 Tick 速度照常更新（不靠 Room View 的房间流）", async () => {
    mount();
    expect(shownView()).toEqual(["map"]);
    await settle(() => expect(status("tick")!.textContent).toMatch(/1025187|10251[89]\d/));
    const first = Number(/\d{7}/.exec(status("tick")!.textContent!)![0]);
    await settle(() => expect(Number(/\d{7}/.exec(status("tick")!.textContent!)![0])).toBeGreaterThan(first));
    await settle(() => expect(status("tick")!.textContent).toMatch(/\d+ ms\/Tick/));
    expect(created[0]!.timeRequests.every((shard) => shard === "shardSeason")).toBe(true);
  });

  it("game/time 去重（#38）不吞掉 Top Bar 的采样：轮询间隔短于复用窗口时，每次轮询仍是一次新请求", async () => {
    mount();
    const source = () => created[0]!;
    await settle(() => expect(source().timeRequests.length).toBeGreaterThan(0));
    const start = source().timeRequests.length;
    const startedAt = performance.now();
    // 轮询 10 ms 一次；复用窗口 1 秒。若 Top Bar 拿复用结果，窗口内底层请求不会增加
    await settle(() => expect(source().timeRequests.length).toBeGreaterThanOrEqual(start + 5));
    expect(performance.now() - startedAt).toBeLessThan(TIME_REUSE_MS);
  });

  it("五种连接状态在 Top Bar 上各不相同", async () => {
    mount();
    await settle(() => expect(status("connection")).not.toBeNull());
    const seen = new Map<string, string>();
    for (const state of ["connecting", "authenticated", "disconnected", "reconnecting", "unauthorized"] as const) {
      created[0]!.setConnection(state);
      expect(status("connection")!.dataset["connection"]).toBe(state);
      seen.set(state, status("connection")!.textContent!);
    }
    expect(new Set(seen.values()).size).toBe(5);
  });

  it("有 token 时订阅并显示我的 CPU", async () => {
    mount({ token: "token" });
    await settle(() => expect(created[0]!.cpuSubscriptions).toBe(1));
    expect(status("cpu")).toBeNull();
    created[0]!.emitCpu({ cpu: 23, memory: 66571 });
    expect(status("cpu")!.textContent).toContain("23");
    expect(status("cpu")!.textContent).toContain("65 KB");
  });

  it("没有 token 时不订阅 CPU，也不显示", async () => {
    mount();
    await settle(() => expect(status("tick")!.textContent).toMatch(/\d{7}/));
    expect(created.every((source) => source.cpuSubscriptions === 0)).toBe(true);
    expect(status("cpu")).toBeNull();
  });

  it("从 Top Bar 切 Shard：设置生效、Tick 改查新 Shard，共享 Source 租约不重建", async () => {
    mount({ token: "token" });
    await settle(() => expect(q<HTMLSelectElement>("select[name=top-bar-shard]")?.value).toBe("shardSeason"));
    const cpuSubscriptions = created[0]!.cpuSubscriptions;
    const shardSelect = q<HTMLSelectElement>("select[name=top-bar-shard]")!;
    shardSelect.value = "shardB";
    shardSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("msc.settings")!).shards).toEqual({ season: "shardB" });
    await settle(() => expect(created[0]!.timeRequests).toContain("shardB"));
    expect(created).toHaveLength(1);
    expect(created[0]!.cpuSubscriptions).toBe(cpuSubscriptions);
  });

  it("从 Top Bar 切 Server：换一个共享 Source，旧的关闭", async () => {
    mount();
    await settle(() => expect(status("connection")!.dataset["connection"]).toBe("authenticated"));
    const serverSelect = q<HTMLSelectElement>("select[name=top-bar-server]")!;
    expect(serverSelect.value).toBe("season");
    serverSelect.value = "mmo";
    serverSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("msc.settings")!).serverId).toBe("mmo");
    expect(created).toHaveLength(2);
    expect(created[0]!.closed).toBe(true);
    expect(created[1]!.closed).toBe(false);
  });

  it("Attack Alert 横幅从 Top Bar 下方滑出、不属于 Main View；点击仍进入该房间", async () => {
    mount({ token: "token" });
    await settle(() => expect(q('.attack-alert__item[data-reason="stranger"]')).not.toBeNull());
    const banner = q(".attack-alert")!;
    // 紧贴 Top Bar 之下的外壳主体，而不在 Main View 里
    expect(banner.closest("main.shell > .shell__body")).not.toBeNull();
    expect(banner.closest(".main-view")).toBeNull();
    expect(rule(".shell__body")).toMatch(/position:\s*relative/);
    expect(rule(".attack-alert")).toMatch(/position:\s*absolute/);
    expect(rule(".attack-alert")).toMatch(/top:\s*0/);
    expect(rule(".attack-alert")).toMatch(/animation:/);

    q('.attack-alert__item[data-reason="stranger"]')!.querySelector<HTMLButtonElement>("[data-action=open-alert-room]")!.click();
    expect(shownView()).toEqual(["room"]);
    expect(q<HTMLInputElement>("[name=room-view-room]")!.value).toBe("E13N21");
  });
});

/** vitest 不处理 CSS，直接读源文件里某个选择器的第一条规则 */
const styles = readFileSync(join(import.meta.dirname, "../styles.css"), "utf8");
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
  expect(match, selector).not.toBeNull();
  return match![1]!;
}
