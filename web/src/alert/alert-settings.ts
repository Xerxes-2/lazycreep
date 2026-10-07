/**
 * Attack Alert 的本地设置（三类条件开关、冷却、停留阈值）与系统通知权限。
 * 单独存一个键 `msc.alerts`；权限只在用户点“启用通知”时申请，从不在页面加载时弹出。
 */
import { createSignal, type Accessor } from "solid-js";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from "./alert-detector.ts";

const STORAGE_KEY = "msc.alerts";
export const ALERT_SETTINGS_STORAGE: StoredKey = { key: STORAGE_KEY, kind: "json-object", role: "settings" };

export type NotificationPermissionState = NotificationPermission | "unsupported";

/** 系统通知能力的最小接口；测试里换成假的。 */
export interface NotificationApi {
  permission(): NotificationPermissionState;
  requestPermission(): Promise<NotificationPermissionState>;
  /** 弹一条系统通知；同 tag 的新通知替换旧的 */
  show(title: string, options: { readonly body: string; readonly tag: string; readonly onClick: () => void }): void;
}

export function browserNotifications(): NotificationApi {
  const supported = () => typeof Notification !== "undefined";
  return {
    permission: () => (supported() ? Notification.permission : "unsupported"),
    requestPermission: async () => (supported() ? Notification.requestPermission() : "unsupported"),
    show(title, { body, tag, onClick }) {
      if (!supported() || Notification.permission !== "granted") return;
      const notification = new Notification(title, { body, tag });
      notification.onclick = () => {
        globalThis.focus?.();
        onClick();
        notification.close();
      };
    },
  };
}

export interface AlertSettings {
  readonly config: Accessor<AlertConfig>;
  /** 合并修改；非正数或非数字的冷却 / 阈值忽略 */
  update(patch: Partial<AlertConfig>): void;
  readonly permission: Accessor<NotificationPermissionState>;
  requestPermission(): Promise<void>;
  readonly notifications: NotificationApi;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitize(base: AlertConfig, patch: Partial<Record<keyof AlertConfig, unknown>>): AlertConfig {
  const flag = (key: "pvp" | "nuke" | "stranger") => (typeof patch[key] === "boolean" ? (patch[key] as boolean) : base[key]);
  return {
    pvp: flag("pvp"),
    nuke: flag("nuke"),
    stranger: flag("stranger"),
    cooldownMinutes: positive(patch.cooldownMinutes) ? patch.cooldownMinutes : base.cooldownMinutes,
    strangerTicks: positive(patch.strangerTicks) ? Math.round(patch.strangerTicks) : base.strangerTicks,
  };
}

export function createAlertSettings(
  storage: KeyValueStorage | undefined,
  notifications: NotificationApi = browserNotifications(),
): AlertSettings {
  const [config, setConfig] = createSignal(
    readJson(storage, STORAGE_KEY, (v) => (isRecord(v) ? sanitize(DEFAULT_ALERT_CONFIG, v) : undefined), DEFAULT_ALERT_CONFIG),
  );
  const [permission, setPermission] = createSignal(notifications.permission());
  return {
    config,
    update(patch) {
      const next = sanitize(config(), patch);
      setConfig(next);
      writeJson(storage, STORAGE_KEY, next);
    },
    permission,
    async requestPermission() {
      setPermission(await notifications.requestPermission());
    },
    notifications,
  };
}
