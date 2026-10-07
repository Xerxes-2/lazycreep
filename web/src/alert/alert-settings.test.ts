import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_CONFIG } from "./alert-detector.ts";
import { createAlertSettings, type NotificationApi } from "./alert-settings.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

function fakeNotifications(permission: NotificationPermission | "unsupported", answer: NotificationPermission = "granted") {
  const asked: number[] = [];
  const api: NotificationApi = {
    permission: () => permission,
    requestPermission: async () => {
      asked.push(1);
      permission = answer;
      return answer;
    },
    show: () => {},
  };
  return { api, asked };
}

describe("Attack Alert 设置", () => {
  it("默认三类条件都开、冷却 15 分钟、停留 60 Tick", () => {
    createRoot((dispose) => {
      const settings = createAlertSettings(memoryStorage(), fakeNotifications("default").api);
      expect(settings.config()).toEqual(DEFAULT_ALERT_CONFIG);
      dispose();
    });
  });

  it("开关与冷却写进本地存储，下次读回；无效数值忽略", () => {
    const storage = memoryStorage();
    createRoot((dispose) => {
      const settings = createAlertSettings(storage, fakeNotifications("default").api);
      settings.update({ pvp: false, cooldownMinutes: 5 });
      settings.update({ cooldownMinutes: -1, strangerTicks: Number.NaN });
      expect(settings.config()).toMatchObject({ pvp: false, cooldownMinutes: 5, strangerTicks: 60 });
      dispose();
    });
    createRoot((dispose) => {
      expect(createAlertSettings(storage, fakeNotifications("default").api).config()).toMatchObject({
        pvp: false,
        nuke: true,
        cooldownMinutes: 5,
      });
      dispose();
    });
  });

  it("存储里是坏数据时回到默认值", () => {
    createRoot((dispose) => {
      const settings = createAlertSettings(memoryStorage({ "msc.alerts": "{oops" }), fakeNotifications("default").api);
      expect(settings.config()).toEqual(DEFAULT_ALERT_CONFIG);
      dispose();
    });
  });

  it("创建时不申请通知权限；点“启用通知”才申请，结果反映到 permission", async () => {
    const { api, asked } = fakeNotifications("default", "granted");
    await createRoot(async (dispose) => {
      const settings = createAlertSettings(memoryStorage(), api);
      expect(asked).toEqual([]);
      expect(settings.permission()).toBe("default");
      await settings.requestPermission();
      expect(asked).toEqual([1]);
      expect(settings.permission()).toBe("granted");
      dispose();
    });
  });
});
