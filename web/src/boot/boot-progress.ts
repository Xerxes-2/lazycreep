/**
 * 启动进度（#33）：从真实事件推断启动走到了哪一步，不改被观察模块的接口。
 *
 * 观察点都在应用装配处：
 * - Source 工厂（包在 sharedSources 之前）：连接状态流、HTTP 响应、地图与房间数据；
 * - SceneView 工厂（交给 MapAndRoom 的 createView）：Main View 第一次 show。
 *
 * 阶段与判定：
 * - program 加载程序：本模块运行即完成；
 * - connect 连接 Server：任一 HTTP 得到 Server 的回应，或 WebSocket 已认证 / 被拒；
 * - auth 认证：连接状态到 authenticated（authOptional 时跳过，例如 Replay 匿名可用）；
 * - map 获取地图数据：首个 roomMap2 帧、房间帧、map-stats、地形或历史 chunk；
 * - frame 收到首帧：拿到地图数据之后 World Map 或 Room View 第一次 show。
 * 失败：连接状态 reconnecting（认证前）或 HTTP 网络错误（连上之前）→ 停在 connect；
 * 连接状态 unauthorized → 停在 auth。之后若恢复，进度照常继续。
 * 全部完成或调用 finish() 后状态锁定为 done。
 */
import { createSignal, untrack, type Accessor } from "solid-js";
import type { SceneView, SceneViewOptions } from "../scene/pixi-scene-view.ts";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import { SourceError, type ConnectionState, type Source } from "../source/source.ts";

export const BOOT_STAGES = ["program", "connect", "auth", "map", "frame"] as const;
export type BootStage = (typeof BOOT_STAGES)[number];

/** network：连不上 Server；unauthorized：token 被拒绝 */
export type BootFailure = "network" | "unauthorized";

export type BootStatus =
  | { readonly phase: "running"; readonly stage: BootStage; readonly done: number }
  | { readonly phase: "failed"; readonly stage: BootStage; readonly done: number; readonly reason: BootFailure }
  | { readonly phase: "done" };

export type CreateView = (options: SceneViewOptions) => Promise<SceneView>;

export interface BootProgress {
  readonly status: Accessor<BootStatus>;
  /** 观察经它创建的 Source；应包在 sharedSources 里面，使每个底层 Source 只观察一次 */
  wrapSources(factory: SourceFactory): SourceFactory;
  /** 观察经它创建的 SceneView 的第一次 show */
  wrapView(create: CreateView): CreateView;
  /** 直接结束（无 token、用户选择进入等） */
  finish(): void;
}

export interface BootProgressOptions {
  /** 此刻不需要认证（例如 URL 指向 Replay）：认证阶段跳过，被拒也不阻挡 */
  readonly authOptional?: () => boolean;
}

/** 得到 Server 回应之前的哪些失败算作连不上：请求没有响应，或 Gateway 报上游不可用 */
function unreachable(error: unknown): boolean | undefined {
  if (!(error instanceof SourceError)) return undefined;
  return error.kind === "network" || (error.kind === "http" && (error.status ?? 0) >= 500);
}

/** 返回的是地图或房间数据的 Source 方法 */
const MAP_DATA_CALLS = new Set(["getMapStats", "getTerrain", "getHistoryChunk"]);
const MAP_DATA_STREAMS = new Set(["subscribeRoomMap", "subscribeRoom"]);

export function createBootProgress(options: BootProgressOptions = {}): BootProgress {
  const [connected, setConnected] = createSignal(false);
  const [authenticated, setAuthenticated] = createSignal(false);
  const [socket, setSocket] = createSignal<ConnectionState>("disconnected");
  const [networkError, setNetworkError] = createSignal(false);
  const [mapData, setMapData] = createSignal(false);
  const [frame, setFrame] = createSignal(false);
  const [finished, setFinished] = createSignal(false);

  const authOptional = () => options.authOptional?.() ?? false;

  const compute = (): BootStatus => {
    if (finished()) return { phase: "done" };
    const doneStages: Record<BootStage, boolean> = {
      program: true,
      connect: connected() || authenticated(),
      auth: authenticated() || authOptional(),
      map: mapData(),
      frame: frame(),
    };
    const stage = BOOT_STAGES.find((s) => !doneStages[s]);
    if (!stage) return { phase: "done" };
    const done = BOOT_STAGES.filter((s) => doneStages[s]).length;
    if (!doneStages.auth && socket() === "unauthorized") return { phase: "failed", stage: "auth", done, reason: "unauthorized" };
    const lost = (!doneStages.auth && socket() === "reconnecting") || (!doneStages.connect && networkError());
    if (lost) return { phase: "failed", stage: doneStages.connect ? "auth" : "connect", done, reason: "network" };
    return { phase: "running", stage, done };
  };

  const status = (): BootStatus => {
    const next = compute();
    // 一旦完成就锁定：之后连接断开、换 token 都不再回到启动画面
    if (next.phase === "done" && !finished()) queueMicrotask(() => setFinished(true));
    return next;
  };

  // 下面的观察点会在别人的 effect 里被调用（例如 MapView 在 effect 里 show）：读信号一律 untrack，
  // 免得让那些 effect 依赖启动进度、在启动完成时重跑（重订阅）
  const markMap = () => {
    if (!untrack(mapData)) setMapData(true);
  };

  const observeResult = (result: unknown, isMapData: boolean) => {
    if (!(result instanceof Promise)) return;
    result.then(
      () => {
        setConnected(true);
        setNetworkError(false);
        if (isMapData) markMap();
      },
      (error: unknown) => {
        const down = unreachable(error);
        if (down === true) setNetworkError(true);
        else if (down === false) setConnected(true);
      },
    );
  };

  const observe = (source: Source): Source => {
    const off = source.onConnection((state) => {
      setSocket(state);
      if (state === "authenticated") setAuthenticated(true);
      if (state === "authenticated" || state === "unauthorized") setConnected(true);
    });
    return new Proxy(source, {
      get(target, prop) {
        if (prop === "close")
          return () => {
            off();
            target.close();
          };
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function" || typeof prop !== "string") return value;
        const method = (value as (...args: unknown[]) => unknown).bind(target);
        if (untrack(finished)) return method;
        if (MAP_DATA_STREAMS.has(prop))
          return (shard: unknown, room: unknown, listener: (data: unknown) => void, ...rest: unknown[]) =>
            method(
              shard,
              room,
              (data: unknown) => {
                markMap();
                listener(data);
              },
              ...rest,
            );
        return (...args: unknown[]) => {
          const result = method(...args);
          observeResult(result, MAP_DATA_CALLS.has(prop));
          return result;
        };
      },
    });
  };

  return {
    status,
    wrapSources: (factory) => (server, token) => observe(factory(server, token)),
    wrapView: (create) => async (viewOptions) => {
      const view = await create(viewOptions);
      return new Proxy(view, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          if (prop !== "show") return (value as (...args: unknown[]) => unknown).bind(target);
          return (...args: Parameters<SceneView["show"]>) => {
            if (untrack(mapData) && !untrack(frame)) setFrame(true);
            return target.show(...args);
          };
        },
      });
    },
    finish: () => setFinished(true),
  };
}
