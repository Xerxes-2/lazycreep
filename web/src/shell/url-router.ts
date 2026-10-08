/**
 * URL 导航（#32）：地址是 Main View 位置的来源，格式参照官方客户端的 hashbang 路由，前面加一段 Server：
 *
 * - `#!/<server>/map/<shard>`：World Map
 * - `#!/<server>/room/<shard>/<room>`：Room View（Live）
 * - `#!/<server>/history/<shard>/<room>?t=<tick>`：Room View 的 Replay；`&latest=1` 表示 tick 是进入时的
 *   Live Tick，所在 chunk 还没生成时退到最近的已有历史（刷新时照样能打开）
 *
 * `<server>` 是 Server 的 id；不分 Shard 的 Server 省略 `<shard>` 段。旧的 `#/replay?shard=&room=&tick=`
 * 链接（#15）只作为输入：按当前 Server 解读，打开后地址换成新格式。
 *
 * 单向数据流，不会互相触发：
 * - 地址 → 位置：只在 hashchange / popstate（手动输入、书签、前进后退）与启动时解读地址，调用
 *   `settings.selectServer` 与 `shell.navigate`；地址与此刻的位置已一致时什么也不做。
 * - 位置 → 地址：位置变化后在微任务里把最终位置写回地址（同一轮里的中间状态合并成一次），用
 *   pushState / replaceState，二者都不触发 hashchange。由地址引起的导航只 replace（规范化写法）。
 * Replay 的地址只记起始 Tick：拖动时间轴、单步、播放都不改地址，也不产生历史记录。
 * 解读地址不依赖认证：Replay 链接在 token 缺失或失效时同样打开（#33）。
 */
import { batch, createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { Settings } from "../settings/settings.ts";
import { replayTick, type ShellLocation, type ShellState } from "./shell-state.ts";

export type Route =
  | { readonly kind: "map"; readonly server: string; readonly shard?: string }
  | { readonly kind: "room"; readonly server: string; readonly shard?: string; readonly room: string }
  | {
      readonly kind: "history";
      readonly server: string;
      readonly shard?: string;
      readonly room: string;
      readonly tick: number;
      readonly latest?: boolean;
    };

const ROOM_NAME = /^[WE]\d{1,3}[NS]\d{1,3}$/;
const SHARD_NAME = /^[\w.-]+$/;

const roomName = (raw: string | undefined) => {
  const room = raw?.trim().toUpperCase();
  return room && ROOM_NAME.test(room) ? room : undefined;
};

const tickOf = (raw: string | null) => {
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const tick = Number(raw);
  return Number.isSafeInteger(tick) ? tick : undefined;
};

/** 地址的解读结果：空地址、新格式、旧 Replay 格式（需要当前 Server）、无效 */
export type ParsedHash =
  | { readonly kind: "empty" }
  | { readonly kind: "route"; readonly route: Route }
  | { readonly kind: "legacy"; readonly toRoute: (server: string) => Route }
  | { readonly kind: "invalid" };

/** 解读 location.hash（不校验 Server 是否存在）。 */
export function parseHash(hash: string): ParsedHash {
  if (hash === "" || hash === "#" || hash === "#!" || hash === "#!/") return { kind: "empty" };
  if (hash.startsWith("#/replay?")) {
    const query = new URLSearchParams(hash.slice("#/replay?".length));
    const room = roomName(query.get("room") ?? undefined);
    const tick = tickOf(query.get("tick"));
    if (!room || tick === undefined) return { kind: "invalid" };
    const shard = query.get("shard") || undefined;
    const latest = query.get("latest") === "1";
    return {
      kind: "legacy",
      toRoute: (server) => ({ kind: "history", server, room, tick, ...(shard ? { shard } : {}), ...(latest ? { latest } : {}) }),
    };
  }
  if (!hash.startsWith("#!/")) return { kind: "invalid" };
  const [path = "", search = ""] = hash.slice(3).split("?", 2);
  let parts: string[];
  try {
    parts = path.split("/").filter((p) => p !== "").map(decodeURIComponent);
  } catch {
    return { kind: "invalid" };
  }
  const [server, kind, ...rest] = parts;
  if (!server) return { kind: "invalid" };
  const shardOf = (raw: string | undefined) => (raw === undefined ? {} : SHARD_NAME.test(raw) ? { shard: raw } : undefined);

  if (kind === "map" && rest.length <= 1) {
    const shard = shardOf(rest[0]);
    return shard ? { kind: "route", route: { kind: "map", server, ...shard } } : { kind: "invalid" };
  }
  if ((kind === "room" || kind === "history") && (rest.length === 1 || rest.length === 2)) {
    const shard = shardOf(rest.length === 2 ? rest[0] : undefined);
    const room = roomName(rest.at(-1));
    if (!shard || !room) return { kind: "invalid" };
    if (kind === "room") return { kind: "route", route: { kind: "room", server, room, ...shard } };
    const query = new URLSearchParams(search);
    const tick = tickOf(query.get("t"));
    if (tick === undefined) return { kind: "invalid" };
    const latest = query.get("latest") === "1" ? { latest: true } : {};
    return { kind: "route", route: { kind: "history", server, room, tick, ...shard, ...latest } };
  }
  return { kind: "invalid" };
}

/** 地址是否指向 Replay（新格式的 history 路由或旧的 `#/replay?…`）；不需要认证，启动时即可判断 */
export function isReplayAddress(hash: string): boolean {
  const parsed = parseHash(hash);
  return parsed.kind === "legacy" || (parsed.kind === "route" && parsed.route.kind === "history");
}

/** 路由的规范写法 */
export function routeHref(route: Route): string {
  const seg = (s: string) => encodeURIComponent(s);
  const shard = route.shard === undefined ? "" : `/${seg(route.shard)}`;
  const base = `#!/${seg(route.server)}/${route.kind}${shard}`;
  switch (route.kind) {
    case "map":
      return base;
    case "room":
      return `${base}/${route.room}`;
    case "history":
      return `${base}/${route.room}?t=${route.tick}${route.latest ? "&latest=1" : ""}`;
  }
}

/** 位置对应的路由；Room View 还没有房间时没有对应的地址（undefined，地址保持不变） */
export function routeOf(server: string, at: ShellLocation): Route | undefined {
  const shard = at.shard === undefined ? {} : { shard: at.shard };
  if (at.view === "map") return { kind: "map", server, ...shard };
  if (at.room === undefined) return undefined;
  if (!at.replay) return { kind: "room", server, room: at.room, ...shard };
  return { kind: "history", server, room: at.room, tick: at.replay.tick, ...shard, ...(at.replay.latest ? { latest: true } : {}) };
}

/** 地址无效时的提示（地址原文） */
export interface RouteNotice {
  readonly hash: string;
}

export interface UrlRouter {
  readonly notice: Accessor<RouteNotice | undefined>;
  dismissNotice(): void;
}

export type RouterSettings = Pick<Settings, "server" | "servers" | "selectServer">;

/** 需要在 Solid 的 owner 里调用（用到 effect 与 window 事件监听）。 */
export function createUrlRouter(shell: ShellState, settings: RouterSettings, win: Window = window): UrlRouter {
  const [notice, setNotice] = createSignal<RouteNotice>();
  const currentHref = () => {
    const route = routeOf(settings.server().id, shell.location());
    return route && routeHref(route);
  };

  // ---- 位置 → 地址 ----
  let queued = false;
  /** 下一次写回用 replace（由地址引起的导航、启动） */
  let replaceNext = true;
  /** 路由最近一次读到或写入的地址 */
  let known = win.location.hash;
  const flush = () => {
    queued = false;
    const replace = replaceNext;
    replaceNext = false;
    // 地址已被别处改了（例如刚在地址栏输入），它的 hashchange 还没处理：不能盖掉，等事件来
    if (win.location.hash !== known) return;
    const href = currentHref();
    if (href === undefined || href === known) return;
    const url = win.location.pathname + win.location.search + href;
    if (replace) win.history.replaceState(win.history.state, "", url);
    else win.history.pushState(null, "", url);
    known = href;
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  };
  createEffect(() => {
    currentHref();
    schedule();
  });

  // ---- 地址 → 位置 ----
  const apply = (route: Route) => {
    if (routeHref(route) === currentHref()) return;
    batch(() => {
      if (route.server !== settings.server().id) settings.selectServer(route.server);
      const shard = settings.server().sharded && route.shard !== undefined ? { shard: route.shard } : {};
      if (route.kind === "map") shell.navigate({ view: "map", ...shard });
      else if (route.kind === "room") shell.navigate({ room: route.room, ...shard });
      else shell.navigate({ room: route.room, ...shard, replay: replayTick(route.tick, route.latest) });
    });
  };
  const fromAddress = () => {
    const hash = win.location.hash;
    known = hash;
    const parsed = parseHash(hash);
    replaceNext = true;
    schedule();
    if (parsed.kind === "empty") return;
    const route = parsed.kind === "legacy" ? parsed.toRoute(settings.server().id) : parsed.kind === "route" ? parsed.route : undefined;
    if (route && settings.servers().some((s) => s.id === route.server)) {
      setNotice(undefined);
      apply(route);
      return;
    }
    // 无效：回到当前 Server 的 World Map 并提示
    setNotice({ hash });
    shell.navigate({ view: "map" });
  };
  fromAddress();
  win.addEventListener("hashchange", fromAddress);
  win.addEventListener("popstate", fromAddress);
  onCleanup(() => {
    win.removeEventListener("hashchange", fromAddress);
    win.removeEventListener("popstate", fromAddress);
  });

  return { notice, dismissNotice: () => setNotice(undefined) };
}
