/**
 * 外壳状态（#24，ADR 0005）：整页唯一的一份，Top Bar、Main View、Sidebar、Menu、Console Panel 都读写它。
 *
 * - Main View 模式（World Map / Room View）：运行状态，存 `msc.mainView`，不进设置导出。
 * - Sidebar 是否收起、各 Sidebar Section 的折叠（按区块 id）、Console Panel 开合与高度：用户设置，
 *   存 `msc.shell`，进设置导出。
 * - Menu 当前打开项、Room View 的房间：不持久化。
 *
 * **位置（Main View 模式 + Shard + 房间 + Replay Tick）只经一个入口读写**：读 `location()`，
 * 写 `navigate(to)`。地图点房间、PvP、告警、Minimap、快捷键、Top Bar 按钮都调用 navigate，
 * 不各自 set；URL 路由（url-router.ts，#32）把地址接成 navigate 的来源、把 location 写回地址。
 * Shard 仍存在连接设置里（settings.shard），navigate 代为切换；Replay 随 roomRequest 交给 Room View。
 * Room View 自己换房间（输入框、进出 Replay）时用 reportRoom 回报，location 随之更新。
 *
 * 新功能需要新的外壳状态时，在这里加字段（持久化的放进 ShellPrefs 并在 decodePrefs 里校验）。
 */
import { batch, createSignal, type Accessor } from "solid-js";
import type { Settings } from "../settings/settings.ts";
import { isRecord, readJson, removeKey, writeJson, type KeyValueStorage, type StoredKey } from "../storage/local-store.ts";

export type MainViewMode = "map" | "room";

export interface RoomTarget {
  readonly shard: string;
  readonly room: string;
}

/** Replay 的起始 Tick；latest 表示它是进入时的 Live Tick（所在 chunk 可能还没生成） */
export interface ReplayAt {
  readonly tick: number;
  readonly latest?: boolean;
}

/** navigate 交给 Room View 的请求：打开房间，给了 replay 就以该 Tick 进入 Replay */
export interface RoomRequest extends RoomTarget {
  readonly replay?: ReplayAt;
}

/** 此刻的位置：Main View 显示什么、在哪个 Shard、哪个房间、是否在 Replay 及其 Tick */
export interface ShellLocation {
  readonly view: MainViewMode;
  /** 不分 Shard 的 Server 或尚未选择时为 undefined */
  readonly shard: string | undefined;
  /** Room View 所看的房间（Main View 在地图上时也保留） */
  readonly room: string | undefined;
  /** 在 Replay 中时，Replay 的起始 Tick */
  readonly replay: ReplayAt | undefined;
}

/**
 * 导航目标；省略的部分保持不变。
 * - 给 room：打开该房间（view 默认 room）；给 shard 且与当前不同就切 Shard（地图随之切换）。
 * - 给 replay：以该 Tick 打开 room 的 Replay（需要 room）。
 * - 只给 view：切换 Main View。
 */
export interface NavigateTo {
  readonly view?: MainViewMode;
  readonly shard?: string;
  readonly room?: string;
  readonly replay?: ReplayAt;
}

/** 外壳状态用到的连接设置（Shard 存在那里） */
export type ShardSettings = Pick<Settings, "server" | "shard" | "setShard">;

export const SHELL_STORAGE: StoredKey = { key: "msc.shell", kind: "json-object", role: "settings" };
export const MAIN_VIEW_STORAGE: StoredKey = { key: "msc.mainView", kind: "json-string", role: "runtime" };

/** Console Panel 高度（CSS 像素）的范围与默认值 */
export const CONSOLE_HEIGHT = { min: 120, max: 800, initial: 260 } as const;

interface ShellPrefs {
  readonly sidebarOpen: boolean;
  /** 折叠了的区块 id → true（没出现即展开） */
  readonly collapsed: Readonly<Record<string, true>>;
  readonly consoleOpen: boolean;
  readonly consoleHeight: number;
}

const DEFAULT_PREFS: ShellPrefs = { sidebarOpen: true, collapsed: {}, consoleOpen: false, consoleHeight: CONSOLE_HEIGHT.initial };

const clampHeight = (px: number) => Math.round(Math.min(CONSOLE_HEIGHT.max, Math.max(CONSOLE_HEIGHT.min, px)));

function decodePrefs(value: unknown): ShellPrefs | undefined {
  if (!isRecord(value)) return undefined;
  const collapsed: Record<string, true> = {};
  if (isRecord(value["collapsed"])) {
    for (const [id, flag] of Object.entries(value["collapsed"])) if (flag === true) collapsed[id] = true;
  }
  const height = value["consoleHeight"];
  return {
    sidebarOpen: typeof value["sidebarOpen"] === "boolean" ? value["sidebarOpen"] : DEFAULT_PREFS.sidebarOpen,
    collapsed,
    consoleOpen: typeof value["consoleOpen"] === "boolean" ? value["consoleOpen"] : DEFAULT_PREFS.consoleOpen,
    consoleHeight: typeof height === "number" && Number.isFinite(height) ? clampHeight(height) : DEFAULT_PREFS.consoleHeight,
  };
}

const decodeMode = (value: unknown): MainViewMode | undefined => (value === "map" || value === "room" ? value : undefined);

/**
 * #2 网格停靠留下的两个布局键（ADR 0005：启动时清除，不迁移）。
 * 它们已不是本应用存储的键，不登记进 STORED_KEYS；存储键扫描测试（settings-transfer.test.ts）把它们列为豁免。
 */
export const LEGACY_LAYOUT_KEYS: readonly string[] = ["msc.layout.desktop", "msc.layout.monitor"];

export function clearLegacyLayout(storage: (KeyValueStorage & Partial<Pick<Storage, "removeItem">>) | undefined): void {
  for (const key of LEGACY_LAYOUT_KEYS) removeKey(storage, key);
}

export interface ShellState {
  // ---- 位置（唯一的读写入口） ----
  readonly location: Accessor<ShellLocation>;
  navigate(to: NavigateTo): void;
  /** navigate 的简写：World Map 与 Room View 互换 */
  toggleMainView(): void;
  /** location().view 的简写 */
  readonly mainView: Accessor<MainViewMode>;
  /** 每次 navigate 到房间产生的新请求（只给 Room View 用，据此切房间） */
  readonly roomRequest: Accessor<RoomRequest | undefined>;
  /** Room View 回报它此刻显示的房间与 Replay 起始 Tick（只给 Room View 用） */
  reportRoom(target: RoomTarget | undefined, replayTick?: number, latest?: boolean): void;

  // ---- Sidebar ----
  readonly sidebarOpen: Accessor<boolean>;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  sectionCollapsed(id: string): boolean;
  setSectionCollapsed(id: string, collapsed: boolean): void;
  toggleSection(id: string): void;

  // ---- Console Panel ----
  readonly consoleOpen: Accessor<boolean>;
  setConsoleOpen(open: boolean): void;
  toggleConsole(): void;
  readonly consoleHeight: Accessor<number>;
  setConsoleHeight(px: number): void;

  // ---- Menu（不持久化） ----
  readonly menuOpen: Accessor<boolean>;
  /** Menu 里此刻显示的项；undefined 时只列出各项 */
  readonly menuItem: Accessor<string | undefined>;
  /** 打开 Menu；给了 item 就直接显示该项 */
  openMenu(item?: string): void;
  closeMenu(): void;
}

/** storage 一般是 browserStorage()。 */
export function createShellState(
  storage: (KeyValueStorage & Partial<Pick<Storage, "removeItem">>) | undefined,
  settings: ShardSettings,
): ShellState {
  clearLegacyLayout(storage);

  const [prefs, setPrefs] = createSignal<ShellPrefs>(readJson(storage, SHELL_STORAGE.key, decodePrefs, DEFAULT_PREFS));
  const change = (patch: Partial<ShellPrefs>) => {
    const next = { ...prefs(), ...patch };
    setPrefs(next);
    writeJson(storage, SHELL_STORAGE.key, next);
  };

  const [mainView, setMainView] = createSignal<MainViewMode>(readJson(storage, MAIN_VIEW_STORAGE.key, decodeMode, "map"));
  const showMainView = (mode: MainViewMode) => {
    setMainView(mode);
    writeJson(storage, MAIN_VIEW_STORAGE.key, mode);
  };

  const [room, setRoom] = createSignal<RoomTarget>();
  const [replay, setReplay] = createSignal<ReplayAt | undefined>(undefined, {
    equals: (a, b) => a?.tick === b?.tick && a?.latest === b?.latest,
  });
  const [roomRequest, setRoomRequest] = createSignal<RoomRequest>();

  const currentShard = () => (settings.server().sharded ? settings.shard() : undefined);

  // 一次 navigate 的各项改动合成一次位置变化（URL 路由据此只写一次地址）
  const navigate = (to: NavigateTo) =>
    batch(() => {
      const shard = to.shard ?? currentShard();
      if (to.shard !== undefined && settings.server().sharded && to.shard !== settings.shard()) settings.setShard(to.shard);
      if (to.room !== undefined) {
        const target = { shard: shard ?? "", room: to.room };
        const replayAt = to.replay && { tick: to.replay.tick, ...(to.replay.latest ? { latest: true } : {}) };
        setRoom(target);
        setReplay(replayAt);
        setRoomRequest(replayAt ? { ...target, replay: replayAt } : target);
      }
      const view = to.view ?? (to.room !== undefined ? "room" : undefined);
      if (view) showMainView(view);
    });

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [menuItem, setMenuItem] = createSignal<string>();

  const sectionCollapsed = (id: string) => prefs().collapsed[id] === true;
  const setSectionCollapsed = (id: string, collapsed: boolean) => {
    if (sectionCollapsed(id) === collapsed) return;
    const { [id]: _dropped, ...rest } = prefs().collapsed;
    change({ collapsed: collapsed ? { ...rest, [id]: true } : rest });
  };

  return {
    location: () => ({
      view: mainView(),
      shard: currentShard(),
      room: room()?.room,
      replay: replay(),
    }),
    navigate,
    toggleMainView: () => navigate({ view: mainView() === "map" ? "room" : "map" }),
    mainView,
    roomRequest,
    reportRoom(target, tick, latest) {
      batch(() => {
        setRoom(target && { shard: target.shard, room: target.room });
        setReplay(target && tick !== undefined ? { tick, ...(latest ? { latest: true } : {}) } : undefined);
      });
    },

    sidebarOpen: () => prefs().sidebarOpen,
    setSidebarOpen: (open) => change({ sidebarOpen: open }),
    toggleSidebar: () => change({ sidebarOpen: !prefs().sidebarOpen }),
    sectionCollapsed,
    setSectionCollapsed,
    toggleSection: (id) => setSectionCollapsed(id, !sectionCollapsed(id)),

    consoleOpen: () => prefs().consoleOpen,
    setConsoleOpen: (open) => change({ consoleOpen: open }),
    toggleConsole: () => change({ consoleOpen: !prefs().consoleOpen }),
    consoleHeight: () => prefs().consoleHeight,
    setConsoleHeight: (px) => change({ consoleHeight: clampHeight(px) }),

    menuOpen,
    menuItem,
    openMenu(item) {
      setMenuItem(item);
      setMenuOpen(true);
    },
    closeMenu() {
      setMenuOpen(false);
      setMenuItem(undefined);
    },
  };
}
