import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { ServerConfig, Source } from "../source/source.ts";
import { SettingsPage } from "./SettingsPage.tsx";
import { createSettings } from "./settings.ts";

const files = Object.values(
  import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }),
);
const meta = (kind: string) => ({
  format: 1,
  kind,
  recordedAt: "2026-10-08T00:00:00.000Z",
  server: fixtureBundle(files).server,
  origin: "test",
});
const without = (kind: string) => files.filter((f) => (f as { meta: { kind: string } }).meta.kind !== kind);

const seasonBundle = fixtureBundle(files);
/** token 无效：auth/me 录到 401 */
const unauthorizedBundle = fixtureBundle([...without("me"), { meta: meta("me"), status: 401, body: null }]);
/** 两个 Shard，便于测试 Shard 选择 */
const twoShardBundle = fixtureBundle([
  ...without("shards"),
  {
    meta: meta("shards"),
    status: 200,
    body: {
      shards: [
        { name: "shardSeason", rooms: 1, users: 1, tick: 3000 },
        { name: "shardOther", rooms: 2, users: 2, tick: 4000 },
      ],
    },
  },
]);

const TOKEN = "full-access-token";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let created: { server: ServerConfig; token: string | undefined }[];
let bundle = seasonBundle;

function sourceFor(server: ServerConfig, token: string | undefined): Source {
  created.push({ server, token });
  return new FixtureSource(bundle);
}

function mount() {
  dispose?.();
  container.innerHTML = "";
  dispose = render(
    () => (
      <I18nProvider>
        <SettingsPage settings={createSettings(localStorage)} sourceFor={sourceFor} />
      </I18nProvider>
    ),
    container,
  );
}

const text = () => container.textContent ?? "";
const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 1000, interval: 5 });

function field<T extends HTMLElement>(selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`找不到 ${selector}`);
  return el;
}

function choose(selector: string, value: string) {
  const select = field<HTMLSelectElement>(selector);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function type(selector: string, value: string, event: "input" | "change" = "change") {
  const input = field<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
}

describe("设置页", () => {
  beforeEach(() => {
    localStorage.clear();
    created = [];
    bundle = seasonBundle;
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it("默认是 Season，显示服务器时间与 Shard 列表", async () => {
    mount();
    expect(field<HTMLSelectElement>("select[name=server]").value).toBe("season");
    await settle(() => {
      expect(text()).toContain("1025187");
      expect(field("[data-testid=shard-list]").textContent).toContain("shardSeason");
    });
  });

  it("预置 Season、MMO、PTR 三个 Server", () => {
    mount();
    const options = [...field<HTMLSelectElement>("select[name=server]").options].map((o) => o.value);
    expect(options).toEqual(["season", "mmo", "ptr"]);
  });

  it("没有 token 时提示填写，不去查身份", async () => {
    mount();
    await settle(() => expect(field("[data-testid=identity]").textContent).toContain("尚未填写 token"));
    expect(created.every((c) => c.token === undefined)).toBe(true);
  });

  it("填入 token 后显示所属用户，刷新后 token 仍在", async () => {
    mount();
    type("input[name=token]", TOKEN);
    await settle(() => expect(field("[data-testid=identity]").textContent).toContain("Xerxes_2"));
    expect(created.at(-1)?.token).toBe(TOKEN);

    mount();
    expect(field<HTMLInputElement>("input[name=token]").value).toBe(TOKEN);
  });

  it("token 无效时显示明确错误", async () => {
    bundle = unauthorizedBundle;
    mount();
    type("input[name=token]", "bogus");
    await settle(() => expect(field("[data-testid=identity]").textContent).toContain("token 无效或已失效"));
  });

  it("说明为什么需要全权限 token", () => {
    mount();
    expect(field("[data-testid=token-help]").textContent).toContain("全权限");
  });

  it("切换 Server 后用新 Server 取数据，刷新后保留", async () => {
    mount();
    choose("select[name=server]", "mmo");
    await settle(() => expect(created.at(-1)?.server.id).toBe("mmo"));
    mount();
    expect(field<HTMLSelectElement>("select[name=server]").value).toBe("mmo");
    expect(created.at(-1)?.server.apiRoot).toBe("/api");
  });

  it("添加自定义 Server：被选中、刷新后仍在", async () => {
    mount();
    type("input[name=custom-name]", "My Private", "input");
    type("input[name=custom-api-root]", "/private/api", "input");
    type("input[name=custom-socket-url]", "wss://private.example/socket/websocket", "input");
    field<HTMLInputElement>("input[name=custom-sharded]").click();
    field<HTMLFormElement>("form[data-testid=custom-server]").requestSubmit();

    await settle(() =>
      expect(created.at(-1)?.server).toMatchObject({
        name: "My Private",
        apiRoot: "/private/api",
        socketUrl: "wss://private.example/socket/websocket",
        sharded: true,
      }),
    );
    mount();
    const select = field<HTMLSelectElement>("select[name=server]");
    expect(select.selectedOptions[0]?.textContent).toContain("My Private");
  });

  it("自定义 Server 缺字段时不添加并提示", () => {
    mount();
    type("input[name=custom-name]", "Half", "input");
    field<HTMLFormElement>("form[data-testid=custom-server]").requestSubmit();
    expect(field<HTMLSelectElement>("select[name=server]").options).toHaveLength(3);
    expect(text()).toContain("都必须填写");
  });

  it("不分 Shard 的 Server 不显示 Shard 选择", async () => {
    mount();
    type("input[name=custom-name]", "Shardless", "input");
    type("input[name=custom-api-root]", "/api", "input");
    type("input[name=custom-socket-url]", "wss://x.example/socket/websocket", "input");
    field<HTMLFormElement>("form[data-testid=custom-server]").requestSubmit();
    await settle(() => expect(created.at(-1)?.server.sharded).toBe(false));
    expect(container.querySelector("select[name=shard]")).toBeNull();
  });

  it("选择 Shard，刷新后保留", async () => {
    bundle = twoShardBundle;
    mount();
    await settle(() => expect(field<HTMLSelectElement>("select[name=shard]").options).toHaveLength(2));
    expect(field<HTMLSelectElement>("select[name=shard]").value).toBe("shardSeason");
    choose("select[name=shard]", "shardOther");
    mount();
    await settle(() => expect(field<HTMLSelectElement>("select[name=shard]").value).toBe("shardOther"));
  });
});
