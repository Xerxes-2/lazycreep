import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { createSettings, type Settings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { SourceError, type ConsoleEvent, type ShardInfo, type Unsubscribe } from "../source/source.ts";
import { ConsolePanel } from "./ConsolePanel.tsx";

const mmo = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/mmo/*.json", { eager: true, import: "default" })),
);
const SHARDS: readonly ShardInfo[] = ["shard0", "shard1", "shard2", "shard3"].map((name) => ({
  name,
  rooms: 1,
  users: 1,
  tickMs: 3000,
}));

/** MMO 的四个 Shard；Console 事件由测试手动推送，发送走 FixtureSource（不触网），也可设成失败。 */
class TestSource extends FixtureSource {
  listeners = new Set<(event: ConsoleEvent) => void>();
  sendError: unknown;

  override subscribeConsole(listener: (event: ConsoleEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  override async getShards(): Promise<readonly ShardInfo[]> {
    return SHARDS;
  }

  override async sendConsole(shard: string, expression: string): Promise<void> {
    if (this.sendError) throw this.sendError;
    return super.sendConsole(shard, expression);
  }

  push(event: ConsoleEvent) {
    for (const l of this.listeners) l(event);
  }
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(options: { token?: string; shard?: string } = {}) {
  const source = new TestSource(mmo);
  const settings: Settings = createSettings(undefined);
  settings.setToken(options.token ?? "token");
  if (options.shard) settings.setShard(options.shard);
  dispose = render(
    () => (
      <I18nProvider>
        <ConsolePanel settings={settings} sourceFor={() => source} storage={localStorage} />
      </I18nProvider>
    ),
    container,
  );
  return { source, settings };
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const entries = () =>
  [...container.querySelectorAll<HTMLElement>("[data-console-entry]")].map((e) => `${e.dataset["kind"]}:${e.textContent}`);
const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;
const shardSelect = () => q<HTMLSelectElement>('select[name="console-shard"]');
const input = (name: string, value: string) => {
  const el = q<HTMLInputElement>(`input[name="${name}"]`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const send = (expression: string) => {
  input("console-expression", expression);
  q<HTMLFormElement>("form[data-console-send]").requestSubmit();
};
const out = (shard: string, ...log: string[]): ConsoleEvent => ({ kind: "output", shard, log, results: [] });

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
});

describe("Console 面板", () => {
  it("默认跟随当前 Shard：只显示该 Shard 的输出，切换 Shard 随之切换", async () => {
    const { source, settings } = mount({ shard: "shard3" });
    await settle(() => expect(source.listeners.size).toBe(1));
    source.push(out("shard0", "zero"));
    source.push(out("shard3", "three"));
    source.push({ kind: "error", shard: "shard3", error: "boom" });
    expect(entries()).toEqual(["log:three", "error:boom"]);
    settings.setShard("shard0");
    expect(entries()).toEqual(["log:zero"]);
  });

  it("固定到某个 Shard 后不再跟随；改回“跟随”恢复", async () => {
    const { source, settings } = mount({ shard: "shard3" });
    await settle(() => expect(shardSelect().querySelector('option[value="shard0"]')).not.toBeNull());
    source.push(out("shard0", "zero"));
    source.push(out("shard3", "three"));
    shardSelect().value = "shard0";
    shardSelect().dispatchEvent(new Event("change"));
    expect(entries()).toEqual(["log:zero"]);
    settings.setShard("shard2");
    expect(entries()).toEqual(["log:zero"]);
    shardSelect().value = "";
    shardSelect().dispatchEvent(new Event("change"));
    settings.setShard("shard3");
    expect(entries()).toEqual(["log:three"]);
  });

  it("关键字过滤与条数上限", async () => {
    const { source } = mount({ shard: "shard3" });
    await settle(() => expect(source.listeners.size).toBe(1));
    source.push(out("shard3", "Harvester spawned", "upgrader died", "harvest done"));
    input("console-filter", "HARVEST");
    expect(entries()).toEqual(["log:Harvester spawned", "log:harvest done"]);
    input("console-filter", "");
    input("console-limit", "2");
    source.push(out("shard3", "next"));
    expect(entries()).toEqual(["log:harvest done", "log:next"]);
  });

  it("上限存进浏览器，下次打开沿用", async () => {
    mount();
    input("console-limit", "50");
    dispose?.();
    mount();
    expect(q<HTMLInputElement>('input[name="console-limit"]').value).toBe("50");
  });

  it("发送命令：发往所显示的 Shard，成功后清空输入并提示结果在输出里", async () => {
    const { source } = mount({ shard: "shard3" });
    await settle(() => expect(source.listeners.size).toBe(1));
    send("Game.time");
    await settle(() => expect(q<HTMLElement>("[data-console-status]").dataset["state"]).toBe("sent"));
    expect(source.sentConsoleCommands).toEqual([{ shard: "shard3", expression: "Game.time" }]);
    expect(q<HTMLInputElement>('input[name="console-expression"]').value).toBe("");
    // 回显以服务器为准：面板不自己伪造结果
    expect(entries()).toEqual([]);
  });

  it("发送失败：显示原因并保留输入", async () => {
    const { source } = mount({ shard: "shard3" });
    source.sendError = new SourceError("rateLimited", "429", 429);
    await settle(() => expect(source.listeners.size).toBe(1));
    send("Game.time");
    await settle(() => expect(q<HTMLElement>("[data-console-status]").dataset["state"]).toBe("error"));
    expect(q<HTMLElement>("[data-console-status]").textContent).toContain("速率限制");
    expect(q<HTMLInputElement>('input[name="console-expression"]').value).toBe("Game.time");
  });

  it("空命令不发送", async () => {
    const { source } = mount({ shard: "shard3" });
    await settle(() => expect(source.listeners.size).toBe(1));
    send("   ");
    expect(source.sentConsoleCommands).toEqual([]);
  });

  it("没有 token：不订阅，发送按钮不可用", async () => {
    const { source } = mount({ token: "" });
    expect(source.listeners.size).toBe(0);
    expect(q<HTMLButtonElement>("form[data-console-send] button[type=submit]").disabled).toBe(true);
  });

  it("提示页面隐藏期间的日志不会保留", () => {
    mount();
    expect(container.textContent).toContain("隐藏期间");
  });
});
