import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { AlertSettingsPanel } from "./AlertSettingsPanel.tsx";
import { createAlertSettings, type NotificationApi } from "./alert-settings.ts";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;

function mount(permission: NotificationPermission) {
  let current: NotificationPermission = permission;
  const requested = vi.fn(async (): Promise<NotificationPermission> => (current = "granted"));
  const api: NotificationApi = { permission: () => current, requestPermission: requested, show: () => {} };
  const settings = createAlertSettings(localStorage, api);
  dispose = render(
    () => (
      <I18nProvider>
        <AlertSettingsPanel settings={settings} />
      </I18nProvider>
    ),
    container,
  );
  return { settings, requested };
}

const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;

describe("设置里的遇袭通知", () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it("加载时不弹授权；点“启用系统通知”才申请，授权后按钮换成已启用", async () => {
    const { requested } = mount("default");
    expect(requested).not.toHaveBeenCalled();
    q<HTMLButtonElement>("[data-action=enable-notifications]").click();
    expect(requested).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(container.querySelector("[data-action=enable-notifications]")).toBeNull());
    expect(q("[data-testid=alert-permission]").textContent).toBe("系统通知已启用");
  });

  it("被拒绝时说明只能用页内横幅", () => {
    mount("denied");
    expect(container.querySelector("[data-action=enable-notifications]")).toBeNull();
    expect(q("[data-testid=alert-permission]").textContent).toContain("页内横幅");
  });

  it("三类条件开关与冷却、停留阈值写进设置", () => {
    const { settings } = mount("default");
    const nuke = q<HTMLInputElement>("[name=alert-nuke]");
    expect(nuke.checked).toBe(true);
    nuke.click();
    const cooldown = q<HTMLInputElement>("[name=alert-cooldown]");
    cooldown.value = "30";
    cooldown.dispatchEvent(new Event("change"));
    const ticks = q<HTMLInputElement>("[name=alert-stranger-ticks]");
    ticks.value = "100";
    ticks.dispatchEvent(new Event("change"));
    expect(settings.config()).toMatchObject({ pvp: true, nuke: false, stranger: true, cooldownMinutes: 30, strangerTicks: 100 });
    expect(JSON.parse(localStorage.getItem("msc.alerts")!)).toMatchObject({ nuke: false, cooldownMinutes: 30 });
  });
});
