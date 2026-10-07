import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { MapAndRoom } from "../map/MapAndRoom.tsx";
import { manualVisibility, type VisibilitySignal } from "../power/visibility.ts";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import { createSettings } from "../settings/settings.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import { createAlertSettings, type NotificationApi } from "./alert-settings.ts";

// 录制里 E13N21 正在交火（volotsyouga 与 dump_table），W17N21 有战斗也有核弹。
// 把“我”换成 volotsyouga、我的房间换成这两间，就得到三类触发都会发生的场景。
const VOLOTSYOUGA = "65b2ded6e582880012134da6";
const files = Object.values(
  import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }),
).map((file) => {
  const f = file as { meta: { kind: string }; body: unknown };
  if (f.meta.kind !== "me") return file;
  return {
    ...f,
    body: { user: { _id: VOLOTSYOUGA, username: "volotsyouga" }, rooms: { shards: { shardSeason: ["E13N21", "W17N21"] } } },
  };
});
const bundle = fixtureBundle(files);

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

async function fakeView(options: SceneViewOptions): Promise<SceneView> {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  return {
    canvas,
    viewport: { x: 0, y: 0, scale: 1 },
    show: () => {},
    requestRender: () => {},
    resize: () => {},
    setViewport: () => {},
    destroy: () => {},
  };
}

interface Shown {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly onClick: () => void;
}

function fakeNotifications(permission: NotificationPermission) {
  const shown: Shown[] = [];
  const api: NotificationApi = {
    permission: () => permission,
    requestPermission: async () => permission,
    show: (title, options) => void shown.push({ title, ...options }),
  };
  return { api, shown };
}

function mount(options: { permission?: NotificationPermission; visibility?: VisibilitySignal; sources?: FixtureSource[] } = {}) {
  const settings = createSettings(localStorage);
  settings.setToken("token");
  const notifications = fakeNotifications(options.permission ?? "default");
  const alerts = createAlertSettings(localStorage, notifications.api);
  alerts.update({ strangerTicks: 30 });
  dispose = render(
    () => (
      <I18nProvider>
        <MapAndRoom
          settings={settings}
          sourceFor={() => {
            const created = new FixtureSource(bundle, { speed: Infinity });
            options.sources?.push(created);
            return created;
          }}
          createView={fakeView}
          roomView={{ historyCache: async () => undefined }}
          visibility={options.visibility ?? manualVisibility(true)}
          alerts={alerts}
        />
      </I18nProvider>
    ),
    container,
  );
  return { alerts, shown: notifications.shown };
}

const settle = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000, interval: 5 });
const banners = () =>
  [...container.querySelectorAll<HTMLElement>(".attack-alert__item")].map((el) => `${el.dataset["reason"]}:${el.dataset["room"]}`);

describe("Attack Alert 接入", () => {
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
  });

  it("未授权时三类告警都以页内横幅出现，陌生人带玩家名", async () => {
    mount();
    await settle(() =>
      expect(banners().sort()).toEqual(["nuke:W17N21", "pvp:E13N21", "pvp:W17N21", "stranger:E13N21"].sort()),
    );
    const stranger = container.querySelector<HTMLElement>('.attack-alert__item[data-reason="stranger"]')!;
    expect(stranger.textContent).toContain("dump_table");
    expect(stranger.textContent).not.toContain("volotsyouga");
  });

  it("点横幅进入该房间的 Room View，横幅消失", async () => {
    mount();
    await settle(() => expect(banners()).toContain("stranger:E13N21"));
    container
      .querySelector<HTMLElement>('.attack-alert__item[data-reason="stranger"]')!
      .querySelector<HTMLButtonElement>("[data-action=open-alert-room]")!
      .click();
    expect(container.querySelector<HTMLElement>(".world-map__host")!.hidden).toBe(true);
    expect(container.querySelector<HTMLInputElement>("[name=room-view-room]")!.value).toBe("E13N21");
    expect(banners()).not.toContain("stranger:E13N21");
  });

  it("已授权时发系统通知（同房间同原因同一 tag），不出横幅；点通知进入该房间", async () => {
    const { shown } = mount({ permission: "granted" });
    await settle(() => expect(shown.map((n) => n.tag)).toContain("shardSeason/W17N21/nuke"));
    expect(banners()).toEqual([]);
    const nuke = shown.find((n) => n.tag === "shardSeason/W17N21/nuke")!;
    expect(nuke.title).toContain("W17N21");
    expect(nuke.body).toContain("W12N25");
    nuke.onClick();
    expect(container.querySelector<HTMLInputElement>("[name=room-view-room]")!.value).toBe("W17N21");
  });

  it("盟友不触发陌生人告警", async () => {
    // 陌生人告警只依赖 Ally List；名单里有 dump_table（大小写不同）
    const settings = createSettings(localStorage);
    settings.setToken("token");
    const alerts = createAlertSettings(localStorage, fakeNotifications("default").api);
    alerts.update({ strangerTicks: 30, pvp: false, nuke: false });
    dispose = render(
      () => (
        <I18nProvider>
          <MapAndRoom
            settings={settings}
            sourceFor={() => new FixtureSource(bundle, { speed: Infinity })}
            createView={fakeView}
            roomView={{ historyCache: async () => undefined }}
            visibility={manualVisibility(true)}
            allies={new Set(["Dump_Table"])}
            alerts={alerts}
          />
        </I18nProvider>
      ),
      container,
    );
    // 录制的 roomMap2 回放完（51 帧）也没有告警
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(banners()).toEqual([]);
  });

  it("页面不可见时 PvP 与核弹照常轮询并告警（系统通知那时最有用）", async () => {
    const { shown } = mount({ permission: "granted", visibility: manualVisibility(false) });
    await settle(() => expect(shown.map((n) => n.tag)).toEqual(expect.arrayContaining(["shardSeason/E13N21/pvp"])));
  });

  it("PvP 与核弹条件都关掉时，页面不可见就不轮询（回到 #14 的规则）", async () => {
    localStorage.setItem("msc.alerts", JSON.stringify({ pvp: false, nuke: false, stranger: false }));
    const sources: FixtureSource[] = [];
    const getPvp = vi.spyOn(FixtureSource.prototype, "getPvp");
    mount({ visibility: manualVisibility(false), sources });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getPvp).not.toHaveBeenCalled();
    getPvp.mockRestore();
  });

  it("陌生人条件关闭时不订阅我的房间的 roomMap2", async () => {
    localStorage.setItem("msc.alerts", JSON.stringify({ stranger: false }));
    const subscribe = vi.spyOn(FixtureSource.prototype, "subscribeRoomMap");
    mount();
    await settle(() => expect(banners()).toContain("pvp:E13N21"));
    expect(subscribe).not.toHaveBeenCalled();
    subscribe.mockRestore();
  });

  it("为每个我的房间订阅 roomMap2，并声明页面隐藏时保留", async () => {
    const subscribe = vi.spyOn(FixtureSource.prototype, "subscribeRoomMap");
    mount();
    await settle(() => expect(subscribe).toHaveBeenCalledTimes(2));
    expect(subscribe.mock.calls.map((c) => [c[0], c[1], c[4]])).toEqual([
      ["shardSeason", "E13N21", { keepWhileHidden: true }],
      ["shardSeason", "W17N21", { keepWhileHidden: true }],
    ]);
    subscribe.mockRestore();
  });
});
