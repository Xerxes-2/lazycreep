import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { App } from "../App";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import { manualVisibility } from "../power/visibility.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { SERVER_PRESETS } from "../source/servers.ts";
import type { ServerConfig } from "../source/source.ts";

type AnyFile = { meta: { kind: string; server: ServerConfig }; body?: unknown };
/** 录制的 me 不带徽章（录制时只留了 _id 与 username）：补上录制里 Xerxes_2 在赛季服的徽章（W13S28 房间流 users） */
const SEASON_BADGE = { type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false };
const withMyBadge = (f: AnyFile, badge: object): AnyFile => {
  if (f.meta.kind !== "me") return f;
  const body = f.body as { user: object; rooms: object };
  return { ...f, body: { ...body, user: { ...body.user, badge } } };
};
const seasonFiles = (
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })) as AnyFile[]
).map((f) => withMyBadge(f, SEASON_BADGE));
const season = fixtureBundle(seasonFiles);

/** 录制里 Xerxes_2 的 id；赛季服徽章 #ba0e09，MMO 上是 #c8100b（调研 B7） */
const XERXES = "6253e4a3a3d173248b5a2691";
const MMO_BADGE = { type: 5, color1: "#c8100b", color2: "#f8c420", color3: "#f8c420", param: -68, flip: false };
const mmoServer: ServerConfig = SERVER_PRESETS.mmo;
/** 同一组录制挪到 MMO：用户信息里带 MMO 上的徽章 */
const mmo = fixtureBundle(
  seasonFiles
    .filter((f) => f.meta.kind === "me" || f.meta.kind === "shards" || f.meta.kind === "time")
    .map((f) => withMyBadge({ ...f, meta: { ...f.meta, server: mmoServer } }, MMO_BADGE)),
);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
/** <img> 的 SVG data URL 解码回 SVG 文本 */
const svgOf = (img: HTMLImageElement | null) => decodeURIComponent(img?.getAttribute("src")?.split(",")[1] ?? "");

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", location.pathname);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  vi.restoreAllMocks();
});

function mountApp(options: { token?: string; meId?: string } = {}) {
  localStorage.setItem(
    "msc.settings",
    JSON.stringify({ serverId: "season", customServers: [], token: options.token ?? "", shards: {} }),
  );
  if (options.meId) {
    const id = options.meId;
    vi.spyOn(FixtureSource.prototype, "getMe").mockResolvedValue({ id, username: "Source Keeper", rooms: {} });
  }
  dispose = render(
    () => (
      <App
        sourceFor={(server) => new FixtureSource(server.id === "mmo" ? mmo : season, { speed: Infinity })}
        narrow={() => false}
        tickPollMs={60_000}
      />
    ),
    container,
  );
}

const topBarBadge = () => q<HTMLImageElement>('.top-bar [data-status="badge"] img');

describe("Top Bar 显示自己的徽章（#43）", () => {
  it("有 token 时显示当前 Server 上自己的徽章", async () => {
    mountApp({ token: "token" });
    await settle(() => expect(topBarBadge()?.dataset["badge"]).toBe("set"));
    expect(q('.top-bar [data-status="badge"]')!.dataset["user"]).toBe(XERXES);
    expect(svgOf(topBarBadge())).toContain('fill="#ba0e09"');
    expect(topBarBadge()!.title).toContain("Xerxes_2");
  });

  it("没有 token 时不显示", async () => {
    mountApp();
    await settle(() => expect(q('.top-bar [data-status="tick"]')).not.toBeNull());
    expect(topBarBadge()).toBeNull();
  });

  it("没有徽章的账号显示中性占位", async () => {
    mountApp({ token: "token", meId: "3" });
    await settle(() => expect(q('.top-bar [data-status="badge"]')!.dataset["user"]).toBe("3"));
    expect(topBarBadge()!.dataset["badge"]).toBe("none");
  });

  it("同一玩家在不同 Server 的徽章互不混用：切 Server 后换成该 Server 上的徽章", async () => {
    mountApp({ token: "token" });
    await settle(() => expect(svgOf(topBarBadge())).toContain('fill="#ba0e09"'));
    const select = q<HTMLSelectElement>("select[name=top-bar-server]")!;
    select.value = "mmo";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(() => expect(svgOf(topBarBadge())).toContain('fill="#c8100b"'));
    expect(svgOf(topBarBadge())).not.toContain("#ba0e09");
    select.value = "season";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(() => expect(svgOf(topBarBadge())).toContain('fill="#ba0e09"'));
  });
});

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: () => {},
    requestRender: () => {},
    settle: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

describe("PvP 卡片参战者名字旁显示徽章（#43）", () => {
  const DUMP_TABLE = "685da7c42df7a30011653e6a";
  const VOLOTSYOUGA = "65b2ded6e582880012134da6";

  it("每个参战者名字前有徽章；没有徽章的玩家显示中性占位", async () => {
    // dump_table 的资料去掉徽章，当作没有徽章的玩家
    const inner = FixtureSource.prototype.getPlayer;
    vi.spyOn(FixtureSource.prototype, "getPlayer").mockImplementation(async function (this: FixtureSource, id) {
      const profile = await inner.call(this, id);
      if (id !== DUMP_TABLE) return profile;
      const { badge: _dropped, ...rest } = profile;
      return rest;
    });
    const settings = createSettings(localStorage);
    settings.setToken("token");
    dispose = render(
      () => (
        <I18nProvider>
          <MapAndRoom
            settings={settings}
            sourceFor={() => new FixtureSource(season, { speed: Infinity })}
            createView={fakeView}
            roomView={{ historyCache: async () => undefined }}
            visibility={manualVisibility(true)}
            narrow={() => false}
          />
        </I18nProvider>
      ),
      container,
    );
    const player = (id: string) =>
      q(`li.pvp-card [data-combatants="E13N21"] [data-player="${id}"]`);
    await settle(() => expect(player(VOLOTSYOUGA)?.textContent).toContain("volotsyouga"));
    await settle(() => expect(player(VOLOTSYOUGA)!.querySelector<HTMLImageElement>("img.badge-icon")!.dataset["badge"]).toBe("set"));
    expect(svgOf(player(VOLOTSYOUGA)!.querySelector("img"))).toContain('fill="#080811"');
    await settle(() => expect(player(DUMP_TABLE)?.textContent).toContain("dump_table"));
    expect(player(DUMP_TABLE)!.querySelector<HTMLImageElement>("img.badge-icon")!.dataset["badge"]).toBe("none");
    // 徽章在名字之前
    expect(player(VOLOTSYOUGA)!.firstElementChild?.matches("img.badge-icon")).toBe(true);
  });
});
