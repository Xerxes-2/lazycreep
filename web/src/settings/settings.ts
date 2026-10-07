/**
 * 连接设置：所选 Server、自定义 Server、token、每个 Server 当前的 Shard。
 * 全部存在浏览器本地（spec #1「界面与布局」）；存储不可用时只在内存里生效。
 */
import { batch, createSignal, type Accessor } from "solid-js";
import { SERVER_PRESETS } from "../source/servers.ts";
import type { ServerConfig } from "../source/source.ts";
import { isRecord, readJson, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

const STORAGE_KEY = "msc.settings";

/** Server 列表、所选 Server、token、各 Server 的 Shard；导出时去掉 token（见 settings-transfer.ts） */
export const CONNECTION_STORAGE: StoredKey = { key: STORAGE_KEY, kind: "json-object", role: "settings" };

interface Stored {
  readonly serverId: string;
  readonly customServers: readonly ServerConfig[];
  readonly token: string;
  /** Server id → 选中的 Shard */
  readonly shards: Readonly<Record<string, string>>;
}

export interface CustomServerInput {
  readonly name: string;
  readonly apiRoot: string;
  readonly socketUrl: string;
  readonly sharded: boolean;
}

export interface Settings {
  readonly servers: Accessor<readonly ServerConfig[]>;
  /**
   * 所选 Server。按 id 判等：只在换了 Server 时通知依赖方，切 Shard、改 token 都不触发，
   * 所以按它建 Source 的地方（租约、所有权缓存、告警判定器、房间流）不会因切 Shard 重建。
   */
  readonly server: Accessor<ServerConfig>;
  selectServer(id: string): void;
  /** 添加并选中；缺字段时返回 undefined */
  addCustomServer(input: CustomServerInput): ServerConfig | undefined;
  removeCustomServer(id: string): void;
  isCustom(id: string): boolean;
  /** 按字符串判等：只在 token 真正变化时通知依赖方 */
  readonly token: Accessor<string>;
  setToken(token: string): void;
  /** 当前 Server 上选中的 Shard；没选过时为 undefined */
  readonly shard: Accessor<string | undefined>;
  setShard(shard: string): void;
}

const PRESETS: readonly ServerConfig[] = Object.values(SERVER_PRESETS);
const DEFAULTS: Stored = { serverId: SERVER_PRESETS.season.id, customServers: [], token: "", shards: {} };

function isServerConfig(value: unknown): value is ServerConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    ["id", "name", "apiRoot", "socketUrl", "tileRoot", "historyRoot"].every((k) => typeof v[k] === "string") &&
    typeof v["sharded"] === "boolean"
  );
}

function decode(value: unknown): Stored | undefined {
  if (!isRecord(value)) return undefined;
  const shards = isRecord(value["shards"])
    ? Object.fromEntries(Object.entries(value["shards"]).filter(([, v]) => typeof v === "string"))
    : {};
  const customServers = value["customServers"];
  return {
    serverId: typeof value["serverId"] === "string" ? value["serverId"] : DEFAULTS.serverId,
    customServers: Array.isArray(customServers) ? customServers.filter(isServerConfig) : [],
    token: typeof value["token"] === "string" ? value["token"] : "",
    shards: shards as Record<string, string>,
  };
}

function serverOf(stored: Stored): ServerConfig {
  return [...PRESETS, ...stored.customServers].find((s) => s.id === stored.serverId) ?? SERVER_PRESETS.season;
}

export function createSettings(storage: KeyValueStorage | undefined): Settings {
  const initial = readJson(storage, STORAGE_KEY, decode, DEFAULTS);
  const [stored, setStored] = createSignal<Stored>(initial);
  // 按值判等的派生信号：用 signal 而不是 memo，createSettings 不必在 Solid owner 里调用
  const [server, setServer] = createSignal(serverOf(initial), { equals: (a, b) => a.id === b.id });
  const [token, setTokenValue] = createSignal(initial.token);

  const update = (change: Partial<Stored>) => {
    const next = { ...stored(), ...change };
    batch(() => {
      setStored(next);
      setServer(serverOf(next));
      setTokenValue(next.token);
    });
    writeJson(storage, STORAGE_KEY, next);
  };

  const servers = () => [...PRESETS, ...stored().customServers];

  return {
    servers,
    server,
    selectServer: (id) => {
      if (servers().some((s) => s.id === id)) update({ serverId: id });
    },
    addCustomServer: (input) => {
      const name = input.name.trim();
      const apiRoot = input.apiRoot.trim().replace(/\/+$/, "");
      const socketUrl = input.socketUrl.trim();
      if (!name || !apiRoot || !socketUrl) return undefined;
      const config: ServerConfig = {
        id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        apiRoot,
        socketUrl,
        sharded: input.sharded,
        tileRoot: "/map-tiles",
        historyRoot: "/room-history",
      };
      update({ customServers: [...stored().customServers, config], serverId: config.id });
      return config;
    },
    removeCustomServer: (id) => {
      const customServers = stored().customServers.filter((s) => s.id !== id);
      const serverId = stored().serverId === id ? DEFAULTS.serverId : stored().serverId;
      update({ customServers, serverId });
    },
    isCustom: (id) => stored().customServers.some((s) => s.id === id),
    token,
    setToken: (token) => update({ token: token.trim() }),
    shard: () => stored().shards[server().id],
    setShard: (shard) => update({ shards: { ...stored().shards, [server().id]: shard } }),
  };
}
