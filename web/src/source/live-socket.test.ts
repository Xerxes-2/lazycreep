/**
 * LiveSource 的 WebSocket 层：用可注入的假 socket 驱动，不触网。
 * 只经 Source 接口观察：收到的帧、连接状态、流错误，以及服务器看到的命令。
 */
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSource, type SocketFactory, type SocketHandlers } from "./live-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import type { ConnectionState, ConsoleEvent, CpuUpdate, RoomTick, ServerConfig, StreamError } from "./source.ts";
import { manualVisibility, type VisibilitySignal } from "../power/visibility.ts";

const SEASON = SERVER_PRESETS.season;
const SHARD = "shardSeason";
const TOKEN = "token-for-tests";
const USER_ID = "6253e4a3a3d173248b5a2691";

/** 扮演官方 WebSocket 的一端：记下客户端发来的命令，由测试推送服务器帧。 */
class FakeSocket {
  readonly sent: string[] = [];
  closedByClient = false;

  constructor(
    readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closedByClient = true;
  }

  open() {
    this.handlers.open();
  }

  receive(frame: string) {
    this.handlers.message(frame);
  }

  event(channel: string, payload: unknown) {
    this.receive(JSON.stringify([channel, payload]));
  }

  /** 服务器端断开（网络中断等） */
  drop() {
    this.handlers.close();
  }

  /** 握手到认证成功 */
  accept() {
    this.open();
    this.receive("time 1760000000000");
    this.receive("protocol 14");
    this.receive(`auth ok ${TOKEN}`);
  }

  /** 认证之后发出的订阅相关命令 */
  get commands() {
    return this.sent.filter((c) => c.startsWith("subscribe ") || c.startsWith("unsubscribe "));
  }
}

/** token 传 null 表示不给 token。 */
function harness(server: ServerConfig = SEASON, token: string | null = TOKEN, visibility?: VisibilitySignal) {
  const sockets: FakeSocket[] = [];
  const socket: SocketFactory = (url, handlers) => {
    const fake = new FakeSocket(url, handlers);
    sockets.push(fake);
    return fake;
  };
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(String(input), "http://gateway.test").pathname;
    if (path.endsWith("/auth/me")) return Response.json({ ok: 1, _id: USER_ID, username: "tester" });
    return new Response("not found", { status: 404 });
  };
  const source = new LiveSource(server, {
    ...(token === null ? {} : { token }),
    baseUrl: "http://gateway.test",
    fetch,
    socket,
    ...(visibility ? { visibility } : {}),
  });
  const states: ConnectionState[] = [];
  source.onConnection((state) => states.push(state));
  const last = () => {
    const s = sockets.at(-1);
    if (!s) throw new Error("还没有建立 socket");
    return s;
  };
  return { source, sockets, states, last };
}

function roomFrame(gameTime: number | undefined, objects: Record<string, unknown> = {}) {
  return { ...(gameTime === undefined ? {} : { gameTime }), objects, users: {}, visual: "" };
}

describe("LiveSource WebSocket：握手与房间流", () => {
  it("连接 Server 配置的 socketUrl，开启 gzip 并用 token 认证", () => {
    const { source, sockets, states, last } = harness();
    expect(states).toEqual(["disconnected"]);
    source.subscribeRoom(SHARD, "W13S28", () => {});
    expect(sockets).toHaveLength(1);
    expect(last().url).toBe("wss://screeps.com/season/socket/websocket");
    expect(states).toEqual(["disconnected", "connecting"]);
    last().open();
    expect(last().sent).toEqual(["gzip on", `auth ${TOKEN}`]);
    last().receive(`auth ok ${TOKEN}`);
    expect(states.at(-1)).toBe("authenticated");
    expect(last().commands).toEqual([`subscribe room:${SHARD}/W13S28`]);
  });

  it("把房间事件帧转换成 RoomTick：首帧无 gameTime，后续带", () => {
    const { source, last } = harness();
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick));
    last().accept();
    last().event(`room:${SHARD}/W13S28`, roomFrame(undefined, { a: { type: "spawn", x: 1, y: 2 } }));
    last().event(`room:${SHARD}/W13S28`, roomFrame(101, { a: { hits: 5 }, b: null }));
    last().event(`room:${SHARD}/E1N1`, roomFrame(101));
    expect(ticks).toEqual([
      { objects: { a: { type: "spawn", x: 1, y: 2 } }, users: {}, visual: "" },
      { gameTime: 101, objects: { a: { hits: 5 }, b: null }, users: {}, visual: "" },
    ]);
  });

  it("不分 Shard 的 Server 频道名不带 Shard", () => {
    const shardless: ServerConfig = { ...SEASON, id: "private", sharded: false, socketUrl: "ws://private.test/socket/websocket" };
    const { source, last } = harness(shardless);
    source.subscribeRoom("", "W1N1", () => {});
    last().accept();
    expect(last().url).toBe("ws://private.test/socket/websocket");
    expect(last().commands).toEqual(["subscribe room:W1N1"]);
  });

  it("解码 gz: 帧（base64 的 zlib 数据）", async () => {
    const { source, last } = harness();
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick));
    last().accept();
    const json = JSON.stringify([`room:${SHARD}/W13S28`, roomFrame(200)]);
    last().receive(`gz:${deflateSync(json).toString("base64")}`);
    // gz 之后紧跟的明文帧也要排在它后面
    last().event(`room:${SHARD}/W13S28`, roomFrame(201));
    await vi.waitFor(() => expect(ticks.map((t) => t.gameTime)).toEqual([200, 201]));
  });

  it("忽略 time / protocol / package 等非事件帧和坏帧", () => {
    const { source, last } = harness();
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick));
    last().accept();
    last().receive("package 123");
    last().receive("[not json");
    last().event(`room:${SHARD}/W13S28`, roomFrame(7));
    expect(ticks.map((t) => t.gameTime)).toEqual([7]);
  });

  it("退订最后一个监听者时向服务器退订，之后不再投递", () => {
    const { source, last } = harness();
    const ticks: RoomTick[] = [];
    const off = source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick));
    last().accept();
    off();
    last().event(`room:${SHARD}/W13S28`, roomFrame(7));
    expect(ticks).toEqual([]);
    expect(last().commands).toEqual([`subscribe room:${SHARD}/W13S28`, `unsubscribe room:${SHARD}/W13S28`]);
  });

  it("认证前订阅的频道在认证后才发出", () => {
    const { source, last } = harness();
    source.subscribeRoomMap(SHARD, "W13S28", () => {});
    last().open();
    expect(last().commands).toEqual([]);
    last().receive(`auth ok ${TOKEN}`);
    expect(last().commands).toEqual([`subscribe roomMap2:${SHARD}/W13S28`]);
  });

  it("同一连接承载多个频道", () => {
    const { source, sockets, last } = harness();
    source.subscribeRoom(SHARD, "W13S28", () => {});
    last().accept();
    const updates: unknown[] = [];
    source.subscribeRoomMap(SHARD, "W13S28", (u) => updates.push(u));
    source.subscribeRoomMap(SHARD, "W12S28", () => {});
    expect(sockets).toHaveLength(1);
    last().event(`roomMap2:${SHARD}/W13S28`, { w: [[1, 2]], [USER_ID]: [[3, 4]] });
    expect(updates).toEqual([{ w: [[1, 2]], [USER_ID]: [[3, 4]] }]);
    expect(last().commands).toEqual([
      `subscribe room:${SHARD}/W13S28`,
      `subscribe roomMap2:${SHARD}/W13S28`,
      `subscribe roomMap2:${SHARD}/W12S28`,
    ]);
  });
});

describe("LiveSource WebSocket：单房间约束（ADR 0002）", () => {
  it("订阅另一个房间时先退订旧房间，旧订阅收到 replaced 且不再收帧", () => {
    const { source, last } = harness();
    const oldTicks: RoomTick[] = [];
    const errors: StreamError[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => oldTicks.push(tick), (e) => errors.push(e));
    last().accept();
    const newTicks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "E13N21", (tick) => newTicks.push(tick));
    expect(last().commands).toEqual([
      `subscribe room:${SHARD}/W13S28`,
      `unsubscribe room:${SHARD}/W13S28`,
      `subscribe room:${SHARD}/E13N21`,
    ]);
    expect(errors.map((e) => e.kind)).toEqual(["replaced"]);
    last().event(`room:${SHARD}/W13S28`, roomFrame(1));
    last().event(`room:${SHARD}/E13N21`, roomFrame(2));
    expect(oldTicks).toEqual([]);
    expect(newTicks.map((t) => t.gameTime)).toEqual([2]);
  });

  it("旧订阅的退订函数在被顶替后调用是无害的", () => {
    const { source, last } = harness();
    const offOld = source.subscribeRoom(SHARD, "W13S28", () => {});
    last().accept();
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "E13N21", (tick) => ticks.push(tick));
    offOld();
    last().event(`room:${SHARD}/E13N21`, roomFrame(2));
    expect(ticks).toHaveLength(1);
    expect(last().commands.filter((c) => c.startsWith("unsubscribe"))).toEqual([`unsubscribe room:${SHARD}/W13S28`]);
  });

  it("同一房间的多个监听者共用一条订阅", () => {
    const { source, last } = harness();
    const a: RoomTick[] = [];
    const b: RoomTick[] = [];
    const offA = source.subscribeRoom(SHARD, "W13S28", (tick) => a.push(tick));
    source.subscribeRoom(SHARD, "W13S28", (tick) => b.push(tick));
    last().accept();
    last().event(`room:${SHARD}/W13S28`, roomFrame(1));
    offA();
    last().event(`room:${SHARD}/W13S28`, roomFrame(2));
    expect(a.map((t) => t.gameTime)).toEqual([1]);
    expect(b.map((t) => t.gameTime)).toEqual([1, 2]);
    expect(last().commands).toEqual([`subscribe room:${SHARD}/W13S28`]);
  });
});

describe("LiveSource WebSocket：错误帧", () => {
  it("err@<频道> 帧作为 server 错误送到该频道的订阅，订阅保留", () => {
    const { source, last } = harness();
    const errors: StreamError[] = [];
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick), (e) => errors.push(e));
    last().accept();
    last().event(`err@room:${SHARD}/W13S28`, "subscribe limit reached");
    last().event(`room:${SHARD}/W13S28`, roomFrame(3));
    expect(errors).toEqual([{ kind: "server", message: "subscribe limit reached" }]);
    expect(ticks.map((t) => t.gameTime)).toEqual([3]);
  });

  it("其他频道的错误帧不打扰", () => {
    const { source, last } = harness();
    const errors: StreamError[] = [];
    source.subscribeRoom(SHARD, "W13S28", () => {}, (e) => errors.push(e));
    last().accept();
    last().event(`err@roomMap2:${SHARD}/W13S28`, "subscribe limit reached");
    expect(errors).toEqual([]);
  });
});

describe("LiveSource WebSocket：用户频道", () => {
  it("Console 与 CPU 按 token 所属用户的 id 订阅", async () => {
    const { source, sockets, last } = harness();
    const events: ConsoleEvent[] = [];
    const cpu: CpuUpdate[] = [];
    source.subscribeConsole((e) => events.push(e));
    source.subscribeCpu((u) => cpu.push(u));
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    last().accept();
    await vi.waitFor(() =>
      expect(last().commands).toEqual([`subscribe user:${USER_ID}/console`, `subscribe user:${USER_ID}/cpu`]),
    );
    last().event(`user:${USER_ID}/console`, { messages: { log: ["hi"], results: [] }, shard: SHARD });
    last().event(`user:${USER_ID}/console`, { error: "boom", shard: SHARD });
    last().event(`user:${USER_ID}/cpu`, { cpu: 12, memory: 3456 });
    expect(events).toEqual([
      { kind: "output", shard: SHARD, log: ["hi"], results: [] },
      { kind: "error", shard: SHARD, error: "boom" },
    ]);
    expect(cpu).toEqual([{ cpu: 12, memory: 3456 }]);
  });

  it("在取到用户 id 前退订则不会订阅", async () => {
    const { source, last } = harness();
    source.subscribeRoom(SHARD, "W13S28", () => {});
    const off = source.subscribeConsole(() => {});
    off();
    last().accept();
    await vi.waitFor(() => expect(last().commands).toEqual([`subscribe room:${SHARD}/W13S28`]));
    await new Promise((r) => setTimeout(r, 10));
    expect(last().commands).toEqual([`subscribe room:${SHARD}/W13S28`]);
  });
});

describe("LiveSource WebSocket：认证", () => {
  it("服务器拒绝 token：状态为 unauthorized，不重连", async () => {
    vi.useFakeTimers();
    try {
      const { source, sockets, states, last } = harness();
      source.subscribeRoom(SHARD, "W13S28", () => {});
      last().open();
      last().receive("auth failed");
      expect(states.at(-1)).toBe("unauthorized");
      expect(last().closedByClient).toBe(true);
      last().drop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sockets).toHaveLength(1);
      expect(states.at(-1)).toBe("unauthorized");
    } finally {
      vi.useRealTimers();
    }
  });

  it("没有 token 时不连接，状态为 unauthorized", () => {
    const { source, sockets, states } = harness(SEASON, null);
    source.subscribeRoom(SHARD, "W13S28", () => {});
    expect(sockets).toHaveLength(0);
    expect(states).toEqual(["disconnected", "unauthorized"]);
  });
});

describe("LiveSource WebSocket：断线重连", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("断线后按指数退避重连，恢复后重订阅全部活跃频道", async () => {
    const { source, sockets, states, last } = harness();
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick));
    source.subscribeRoomMap(SHARD, "W13S28", () => {});
    const offMap = source.subscribeRoomMap(SHARD, "W12S28", () => {});
    last().accept();
    offMap();

    last().drop();
    expect(states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    // 第二次尝试也失败：等待时间翻倍
    last().drop();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
    expect(states.at(-1)).toBe("reconnecting");

    last().accept();
    expect(states.at(-1)).toBe("authenticated");
    expect(last().commands).toEqual([`subscribe room:${SHARD}/W13S28`, `subscribe roomMap2:${SHARD}/W13S28`]);
    last().event(`room:${SHARD}/W13S28`, roomFrame(9));
    expect(ticks.map((t) => t.gameTime)).toEqual([9]);
  });

  it("恢复后退避从头计算", async () => {
    const { source, sockets, last } = harness();
    source.subscribeRoom(SHARD, "W13S28", () => {});
    last().accept();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    last().drop();
    await vi.advanceTimersByTimeAsync(2000);
    last().accept();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(4);
  });

  it("退避有上限", async () => {
    const { source, sockets, last } = harness();
    source.subscribeRoom(SHARD, "W13S28", () => {});
    for (let i = 0; i < 10; i++) {
      last().drop();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(sockets).toHaveLength(11);
  });

  it("旧连接的迟到帧被忽略", async () => {
    const { source, sockets, last } = harness();
    const ticks: RoomTick[] = [];
    source.subscribeRoom(SHARD, "W13S28", (tick) => ticks.push(tick));
    last().accept();
    const old = last();
    old.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    old.event(`room:${SHARD}/W13S28`, roomFrame(1));
    expect(ticks).toEqual([]);
  });

  it("close 断开、停止重连，状态为 disconnected", async () => {
    const { source, sockets, states, last } = harness();
    source.subscribeRoom(SHARD, "W13S28", () => {});
    last().accept();
    last().drop();
    source.close();
    expect(states.at(-1)).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("close 主动关闭当前连接", () => {
    const { source, last, states } = harness();
    source.subscribeRoom(SHARD, "W13S28", () => {});
    last().accept();
    source.close();
    expect(last().closedByClient).toBe(true);
    expect(states).toEqual(["disconnected", "connecting", "authenticated", "disconnected"]);
  });
});

describe("LiveSource WebSocket：页面不可见时省电（#14）", () => {
  const map = `roomMap2:${SHARD}/W13S28`;
  const room = `room:${SHARD}/W13S28`;
  const user = (topic: string) => `user:${USER_ID}/${topic}`;

  async function watching() {
    const visibility = manualVisibility(true);
    const h = harness(SEASON, TOKEN, visibility);
    const got: string[] = [];
    h.source.subscribeRoom(SHARD, "W13S28", () => got.push("room"));
    h.source.subscribeRoomMap(SHARD, "W13S28", () => got.push("map"));
    h.source.subscribeConsole(() => got.push("console"));
    h.source.subscribeCpu(() => got.push("cpu"));
    h.last().accept();
    await vi.waitFor(() => expect(h.last().commands).toHaveLength(4));
    h.last().sent.length = 0;
    return { ...h, visibility, got };
  }

  it("隐藏时退订 roomMap2 与用户频道，保留当前房间；回到前台重订阅", async () => {
    const { visibility, last, got } = await watching();
    visibility.set(false);
    expect(last().commands.sort()).toEqual(
      [`unsubscribe ${map}`, `unsubscribe ${user("console")}`, `unsubscribe ${user("cpu")}`].sort(),
    );
    // 退订生效前到达的残余帧不再投递；房间流照常
    last().event(map, { w: [] });
    last().event(user("cpu"), { cpu: 1, memory: 1 });
    last().event(room, roomFrame(1));
    expect(got).toEqual(["room"]);

    last().sent.length = 0;
    visibility.set(true);
    expect(last().commands.sort()).toEqual(
      [`subscribe ${map}`, `subscribe ${user("console")}`, `subscribe ${user("cpu")}`].sort(),
    );
    last().event(map, { w: [] });
    last().event(user("cpu"), { cpu: 1, memory: 1 });
    expect(got).toEqual(["room", "map", "cpu"]);
  });

  it("隐藏期间新建的 roomMap2 订阅等回到前台才发出", async () => {
    const { source, visibility, last } = await watching();
    visibility.set(false);
    last().sent.length = 0;
    source.subscribeRoomMap(SHARD, "W12S28", () => {});
    expect(last().commands).toEqual([]);
    visibility.set(true);
    expect(last().commands).toContain(`subscribe roomMap2:${SHARD}/W12S28`);
  });

  it("隐藏期间退订的频道回到前台不再订阅", async () => {
    const visibility = manualVisibility(true);
    const { source, last } = harness(SEASON, TOKEN, visibility);
    source.subscribeRoom(SHARD, "W13S28", () => {});
    const off = source.subscribeRoomMap(SHARD, "W13S28", () => {});
    last().accept();
    visibility.set(false);
    off();
    last().sent.length = 0;
    visibility.set(true);
    expect(last().commands).toEqual([]);
  });

  it("close 之后不再响应可见性变化", async () => {
    const { source, visibility, last } = await watching();
    source.close();
    last().sent.length = 0;
    visibility.set(false);
    visibility.set(true);
    expect(last().sent).toEqual([]);
  });
});
