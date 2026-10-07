/**
 * 全页共享数据源：同一 Server + token 只建一个 Source，各使用方拿到的是租约；
 * 用真实的 LiveSource 与假 socket 观察 WebSocket 数量与订阅命令。
 */
import { describe, expect, it } from "vitest";
import { LiveSource, type SocketFactory, type SocketHandlers } from "./live-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import { sharedSources } from "./shared-source.ts";
import type { ServerConfig, Source } from "./source.ts";

const SEASON = SERVER_PRESETS.season;
const SHARD = "shardSeason";
const TOKEN = "token-for-tests";

class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  constructor(private readonly handlers: SocketHandlers) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  accept() {
    this.handlers.open();
    this.handlers.message(`auth ok ${TOKEN}`);
  }
  get commands() {
    return this.sent.filter((c) => c.startsWith("subscribe ") || c.startsWith("unsubscribe "));
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const socket: SocketFactory = (_url, handlers) => {
    const fake = new FakeSocket(handlers);
    sockets.push(fake);
    return fake;
  };
  const created: LiveSource[] = [];
  const fetch = async () => new Response("not found", { status: 404 });
  const sourceFor = sharedSources((server: ServerConfig, token: string | undefined) => {
    const made = new LiveSource(server, { ...(token ? { token } : {}), baseUrl: "http://gateway.test", fetch, socket });
    created.push(made);
    return made;
  });
  return { sourceFor, sockets, created };
}

describe("全页共享一个 Source", () => {
  it("Room View、Attack Alert 与地图同时工作时只有一条 WebSocket", () => {
    const { sourceFor, sockets, created } = harness();
    const room = sourceFor(SEASON, TOKEN);
    const alert = sourceFor(SEASON, TOKEN);
    const map = sourceFor(SEASON, TOKEN);

    room.subscribeRoom(SHARD, "W13S28", () => {});
    alert.subscribeRoomMap(SHARD, "E13N21", () => {}, undefined, { keepWhileHidden: true });
    map.subscribeRoomMap(SHARD, "E13N21", () => {});
    map.subscribeRoomMap(SHARD, "E14N21", () => {});

    expect(created).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    sockets[0]!.accept();
    expect(new Set(sockets[0]!.commands)).toEqual(
      new Set([`subscribe room:${SHARD}/W13S28`, `subscribe roomMap2:${SHARD}/E13N21`, `subscribe roomMap2:${SHARD}/E14N21`]),
    );
  });

  it("地图退出（关闭它的租约）不会退掉告警仍在用的 roomMap2 频道，也不断开连接", () => {
    const { sourceFor, sockets } = harness();
    const alert = sourceFor(SEASON, TOKEN);
    const map = sourceFor(SEASON, TOKEN);
    alert.subscribeRoomMap(SHARD, "E13N21", () => {}, undefined, { keepWhileHidden: true });
    map.subscribeRoomMap(SHARD, "E13N21", () => {});
    map.subscribeRoomMap(SHARD, "E14N21", () => {});
    sockets[0]!.accept();

    map.close();
    expect(sockets[0]!.closed).toBe(false);
    expect(sockets[0]!.commands).not.toContain(`unsubscribe roomMap2:${SHARD}/E13N21`);
    expect(sockets[0]!.commands).toContain(`unsubscribe roomMap2:${SHARD}/E14N21`);
  });

  it("关掉租约后它的订阅随之退订，重复关闭无副作用", () => {
    const { sourceFor, sockets } = harness();
    const keep = sourceFor(SEASON, TOKEN);
    const lease = sourceFor(SEASON, TOKEN);
    keep.subscribeRoomMap(SHARD, "E1N1", () => {});
    lease.subscribeRoomMap(SHARD, "E2N2", () => {});
    sockets[0]!.accept();
    lease.close();
    lease.close();
    expect(sockets[0]!.commands).toContain(`unsubscribe roomMap2:${SHARD}/E2N2`);
    expect(sockets[0]!.commands).not.toContain(`unsubscribe roomMap2:${SHARD}/E1N1`);
    expect(sockets[0]!.closed).toBe(false);
  });

  it("最后一个租约关闭时关闭底层 Source；换 token 或 Server 时新建", () => {
    const { sourceFor, sockets, created } = harness();
    const a = sourceFor(SEASON, TOKEN);
    a.subscribeRoomMap(SHARD, "E1N1", () => {});
    const b = sourceFor(SEASON, "other-token");
    const c = sourceFor(SERVER_PRESETS.mmo, TOKEN);
    expect(created).toHaveLength(3);
    expect(b).not.toBe(a);
    expect(c.server.id).not.toBe(a.server.id);

    a.close();
    expect(sockets[0]!.closed).toBe(true);
    const again: Source = sourceFor(SEASON, TOKEN);
    expect(created).toHaveLength(4);
    expect(again.server).toBe(SEASON);
  });
});
