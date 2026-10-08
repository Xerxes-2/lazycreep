import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import type { FixtureFile, WireVersion } from "./fixture-format.ts";
import { LiveSource } from "./live-source.ts";
import { SERVER_PRESETS } from "./servers.ts";
import { SourceError, type ServerConfig } from "./source.ts";

const files = Object.values(
  import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }),
);
const bundle = fixtureBundle(files);
const fixture = new FixtureSource(bundle);

const SEASON = SERVER_PRESETS.season;
const SHARD = "shardSeason";
const OWN_ROOM = "W13S28";
const USER_ID = "6253e4a3a3d173248b5a2691";
const TOKEN = "token-for-tests";

function recorded<K extends FixtureFile["meta"]["kind"]>(kind: K, match: (f: FixtureFile) => boolean = () => true) {
  const file = bundle.files.find((f) => f.meta.kind === kind && match(f));
  if (!file || !("body" in file)) throw new Error(`fixture 里没有 ${kind}`);
  return file.body;
}

interface Reply {
  readonly status?: number;
  readonly body: unknown;
}

interface SeenRequest {
  readonly method: string;
  readonly url: URL;
  readonly token: string | null;
  readonly body: string;
}

/** 扮演 Gateway：按「路径?排好序的查询」应答，记下收到的请求。 */
function fakeGateway(routes: Record<string, Reply | (() => never)>) {
  const seen: SeenRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    seen.push({ method: request.method, url, token: request.headers.get("X-Token"), body: await request.text() });
    const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
    const key = params.length ? `${url.pathname}?${new URLSearchParams(params)}` : url.pathname;
    const route = routes[key];
    if (typeof route === "function") return route();
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch, seen };
}

const seasonRoutes: Record<string, Reply> = {
  "/season/api/version": {
    // 真实响应的 serverData 还带着别的字段，转换时忽略
    body: { ok: 1, ...(recorded("version") as WireVersion), serverData: { ...(recorded("version") as WireVersion).serverData, features: [] } },
  },
  "/season/api/game/time?shard=shardSeason": { body: { ok: 1, ...(recorded("time") as object) } },
  "/season/api/game/shards/info": { body: { ok: 1, ...(recorded("shards") as object) } },
  "/season/api/experimental/pvp?interval=100": { body: { ok: 1, ...(recorded("pvp") as object) } },
  "/season/api/experimental/nukes": { body: { ok: 1, ...(recorded("nukes") as object) } },
  "/season/api/game/room-terrain?encoded=1&room=W13S28&shard=shardSeason": {
    body: { ok: 1, ...(recorded("terrain", (f) => f.meta.room === OWN_ROOM) as object) },
  },
  "/season/api/auth/me": { body: { ok: 1, _id: USER_ID, username: "Xerxes_2", email: "x@example.com" } },
  [`/season/api/user/rooms?id=${USER_ID}`]: {
    body: { ok: 1, ...(recorded("me") as { rooms: object }).rooms, reservations: {} },
  },
  [`/season/api/user/find?id=${USER_ID}`]: {
    body: { ok: 1, user: { _id: USER_ID, username: "Xerxes_2", badge: {}, gcl: 1 } },
  },
  "/season/api/user/find?id=nobody": { body: { error: "user not found" } },
  "/season/api/game/world-size?shard=shardSeason": { body: { ok: 1, ...(recorded("worldSize") as object) } },
  // 真实响应还带 decorations 与完整的用户徽章
  "/season/api/game/map-stats": { body: { ok: 1, decorations: {}, ...(recorded("mapStats") as object) } },
  "/room-history/shardSeason/W13S28/1024900.json": {
    body: recorded("history", (f) => f.meta.room === OWN_ROOM),
  },
};

function live(options: { token?: string; server?: ServerConfig; routes?: Record<string, Reply | (() => never)> } = {}) {
  const gateway = fakeGateway(options.routes ?? seasonRoutes);
  const source = new LiveSource(options.server ?? SEASON, {
    ...(options.token === undefined ? {} : { token: options.token }),
    baseUrl: "https://gateway.test",
    fetch: gateway.fetch,
  });
  return { source, seen: gateway.seen };
}

describe("LiveSource HTTP：与同样 wire 数据的 FixtureSource 结果一致", () => {
  const { source } = live({ token: TOKEN });

  it("版本信息", async () => {
    expect(await source.getVersion()).toEqual(await fixture.getVersion());
  });

  it("服务器时间", async () => {
    expect(await source.getTime(SHARD)).toBe(await fixture.getTime(SHARD));
  });

  it("Shard 列表", async () => {
    expect(await source.getShards()).toEqual(await fixture.getShards());
  });

  it("PvP 列表", async () => {
    expect(await source.getPvp(100)).toEqual(await fixture.getPvp(100));
  });

  it("核弹列表", async () => {
    expect(await source.getNukes()).toEqual(await fixture.getNukes());
  });

  it("地形", async () => {
    expect(await source.getTerrain(SHARD, OWN_ROOM)).toEqual(await fixture.getTerrain(SHARD, OWN_ROOM));
  });

  it("用户信息：token 所属用户与各 Shard 的房间", async () => {
    expect(await source.getMe()).toEqual(await fixture.getMe());
  });

  it("按 id 查玩家名（user/find）", async () => {
    expect(await source.getUsername(USER_ID)).toBe("Xerxes_2");
    expect(await source.getUsername("nobody").catch((e: unknown) => e)).toMatchObject({ kind: "server" });
  });

  it("按 id 查玩家资料（user/find）：用户名与 GCL 点数", async () => {
    expect(await source.getPlayer(USER_ID)).toEqual({ id: USER_ID, username: "Xerxes_2", gcl: 1 });
    expect(await source.getPlayer("nobody").catch((e: unknown) => e)).toMatchObject({ kind: "server" });
  });

  it("历史 chunk", async () => {
    expect(await source.getHistoryChunk(SHARD, OWN_ROOM, 1024900)).toEqual(
      await fixture.getHistoryChunk(SHARD, OWN_ROOM, 1024900),
    );
  });

  it("瓦片 URL 是同源 Gateway 路径", () => {
    expect(source.tileUrl(SHARD, OWN_ROOM)).toBe("/map-tiles/shardSeason/W13S28.png");
    expect(source.blockTileUrl(SHARD, "W16S28")).toBe("/map-tiles/shardSeason/zoom2/W16S28.png");
    expect(source.sectorTileUrl(SHARD, "W19S20")).toBe("/map-tiles/shardSeason/zoom1/W19S20.png");
  });

  it("世界尺寸", async () => {
    expect(await source.getWorldSize(SHARD)).toEqual(await fixture.getWorldSize(SHARD));
  });

  it("map-stats", async () => {
    const rooms = [OWN_ROOM, "W14S28", "W12S21", "E40N40"];
    expect(await source.getMapStats(SHARD, rooms)).toEqual(await fixture.getMapStats(SHARD, rooms));
  });
});

describe("LiveSource map-stats 请求", () => {
  it("是带 token 的 POST，JSON 里是房间、minerals0 与 Shard（minerals0 同时带回所有权，额度相同）", async () => {
    const { source, seen } = live({ token: TOKEN });
    await source.getMapStats(SHARD, [OWN_ROOM, "W14S28"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url.pathname).toBe("/season/api/game/map-stats");
    expect(seen[0]!.token).toBe(TOKEN);
    expect(JSON.parse(seen[0]!.body)).toEqual({ rooms: [OWN_ROOM, "W14S28"], statName: "minerals0", shard: SHARD });
  });

  it("带出矿物、新手区 / 重生区 / 开放时间与安全模式（实测 MMO 响应的形状）", async () => {
    const { source } = live({
      token: TOKEN,
      routes: {
        "/season/api/game/map-stats": {
          body: {
            ok: 1,
            gameTime: 5,
            stats: {
              W38N13: {
                status: "normal",
                novice: 1717521321020,
                own: { user: "u1", level: 8 },
                minerals0: { type: "O", density: 3 },
              },
              W38N14: { status: "normal", respawnArea: 1890000000000, openTime: 1890000000001, safeMode: true },
              W38N15: { status: "out of borders" },
            },
            statsMax: {},
            decorations: {},
            users: { u1: { _id: "u1", username: "Alice", badge: {} } },
          },
        },
      },
    });
    const stats = await source.getMapStats(SHARD, ["W38N13", "W38N14", "W38N15"]);
    expect(stats.rooms).toEqual({
      W38N13: {
        status: "normal",
        novice: 1717521321020,
        owner: { user: "u1", level: 8 },
        mineral: { type: "O", density: 3 },
      },
      W38N14: { status: "normal", respawnArea: 1890000000000, openTime: 1890000000001, safeMode: true },
      W38N15: { status: "out of borders" },
    });
  });

  it("徽章（#43）：user/find、auth/me 与 map-stats 的 users 都保留合法的徽章", async () => {
    const BADGE = { type: 5, color1: "#ba0e09", color2: "#ffbf00", color3: "#ffbf00", param: -68, flip: false };
    const { source } = live({
      token: TOKEN,
      routes: {
        "/season/api/user/find?id=u1": { body: { ok: 1, user: { _id: "u1", username: "Alice", badge: BADGE, gcl: 1 } } },
        "/season/api/auth/me": { body: { ok: 1, _id: "u1", username: "Alice", badge: BADGE } },
        "/season/api/user/rooms?id=u1": { body: { ok: 1, shards: {} } },
        "/season/api/game/map-stats": {
          body: {
            ok: 1,
            gameTime: 5,
            stats: { W38N13: { status: "normal", own: { user: "u1", level: 8 } } },
            users: { u1: { _id: "u1", username: "Alice", badge: BADGE } },
          },
        },
      },
    });
    expect((await source.getPlayer("u1")).badge).toEqual(BADGE);
    expect((await source.getMe()).badge).toEqual(BADGE);
    expect((await source.getMapStats(SHARD, ["W38N13"])).users["u1"]).toMatchObject({ badge: BADGE });
  });

  it("速率限制（429）是 rateLimited", async () => {
    const { source } = live({
      token: TOKEN,
      routes: { "/season/api/game/map-stats":{ status: 429, body: { error: "Rate limit exceeded" } } },
    });
    await expect(source.getMapStats(SHARD, [OWN_ROOM])).rejects.toMatchObject({ kind: "rateLimited" });
  });
});

describe("LiveSource Console 命令", () => {
  it("是带 token 的 POST user/console，JSON 里是 expression 与 shard（与 node-screeps-api 的 userConsole 一致）", async () => {
    const { source, seen } = live({
      token: TOKEN,
      routes: { "/season/api/user/console": { body: { ok: 1, result: { ok: 1, n: 1 }, insertedCount: 1 } } },
    });
    await source.sendConsole(SHARD, "Game.time");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url.pathname).toBe("/season/api/user/console");
    expect(seen[0]!.token).toBe(TOKEN);
    expect(JSON.parse(seen[0]!.body)).toEqual({ expression: "Game.time", shard: SHARD });
  });

  it("不分 Shard 的 Server 不带 shard", async () => {
    const privateServer: ServerConfig = { ...SEASON, id: "private", apiRoot: "/api", sharded: false };
    const { source, seen } = live({
      server: privateServer,
      token: TOKEN,
      routes: { "/api/user/console": { body: { ok: 1 } } },
    });
    await source.sendConsole("ignored", "1+1");
    expect(JSON.parse(seen[0]!.body)).toEqual({ expression: "1+1" });
  });

  it("被拒绝时按原因归类：403 forbidden、429 rateLimited、响应体带 error 为 server", async () => {
    const reply = (r: Reply) => live({ token: TOKEN, routes: { "/season/api/user/console": r } }).source;
    await expect(reply({ status: 403, body: {} }).sendConsole(SHARD, "x")).rejects.toMatchObject({ kind: "forbidden" });
    await expect(reply({ status: 429, body: {} }).sendConsole(SHARD, "x")).rejects.toMatchObject({
      kind: "rateLimited",
    });
    await expect(reply({ body: { error: "not authorized" } }).sendConsole(SHARD, "x")).rejects.toMatchObject({
      kind: "server",
    });
  });
});

describe("LiveSource HTTP 请求", () => {
  it("API 请求带 X-Token", async () => {
    const { source, seen } = live({ token: TOKEN });
    await source.getMe();
    expect(seen.map((r) => r.token)).toEqual([TOKEN, TOKEN]);
  });

  it("没有 token 时不带 X-Token", async () => {
    const { source, seen } = live();
    await source.getShards();
    expect(seen[0]!.token).toBeNull();
  });

  it("请求按 baseUrl 解析成同源 Gateway 路径", async () => {
    const { source, seen } = live();
    await source.getTime(SHARD);
    expect(seen[0]!.url.origin).toBe("https://gateway.test");
    expect(seen[0]!.method).toBe("GET");
  });

  it("不分 Shard 的 Server 不带 shard 参数", async () => {
    const privateServer: ServerConfig = { ...SEASON, id: "private", apiRoot: "/api", sharded: false };
    const { source } = live({ server: privateServer, routes: { "/api/game/time": { body: { ok: 1, time: 42 } } } });
    expect(await source.getTime("ignored")).toBe(42);
  });

  it("历史不存在（404）得到 null", async () => {
    const { source } = live();
    expect(await source.getHistoryChunk(SHARD, OWN_ROOM, 100)).toBeNull();
  });

  it("玩家资料有缓存：同一玩家（含并发与查名）只请求一次；查不到的下次重试", async () => {
    const { source, seen } = live();
    const finds = () => seen.filter((r) => r.url.pathname.endsWith("/user/find")).map((r) => r.url.searchParams.get("id"));
    await Promise.all([source.getPlayer(USER_ID), source.getPlayer(USER_ID)]);
    expect(await source.getUsername(USER_ID)).toBe("Xerxes_2");
    expect(finds()).toEqual([USER_ID]);
    await source.getPlayer("nobody").catch(() => {});
    await source.getPlayer("nobody").catch(() => {});
    expect(finds()).toEqual([USER_ID, "nobody", "nobody"]);
  });
});

describe("LiveSource 错误", () => {
  async function failure(promise: Promise<unknown>): Promise<SourceError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    if (!(error instanceof SourceError)) throw new Error(`期望 SourceError，得到 ${String(error)}`);
    return error;
  }

  it("token 无效（401）是 unauthorized", async () => {
    const { source } = live({
      token: "bogus",
      routes: { "/season/api/auth/me": { status: 401, body: { error: "unauthorized" } } },
    });
    expect(await failure(source.getMe())).toMatchObject({ kind: "unauthorized", status: 401 });
  });

  it("Gateway 拒绝（403）是 forbidden", async () => {
    const { source } = live({ routes: { "/season/api/game/shards/info": { status: 403, body: "no" } } });
    expect(await failure(source.getShards())).toMatchObject({ kind: "forbidden", status: 403 });
  });

  it("速率限制（429）是 rateLimited", async () => {
    const { source } = live({ routes: { "/season/api/game/shards/info": { status: 429, body: {} } } });
    expect(await failure(source.getShards())).toMatchObject({ kind: "rateLimited" });
  });

  it("200 但响应体带 error 是 server", async () => {
    const { source } = live({
      routes: { "/season/api/game/time?shard=shardSeason": { body: { error: "invalid shard" } } },
    });
    const error = await failure(source.getTime(SHARD));
    expect(error.kind).toBe("server");
    expect(error.message).toContain("invalid shard");
  });

  it("请求失败是 network", async () => {
    const { source } = live({
      routes: {
        "/season/api/game/shards/info": () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    expect(await failure(source.getShards())).toMatchObject({ kind: "network" });
  });

  it("历史 chunk 的非 404 错误照常拒绝", async () => {
    const { source } = live({
      routes: { "/room-history/shardSeason/W13S28/1024900.json": { status: 502, body: {} } },
    });
    expect(await failure(source.getHistoryChunk(SHARD, OWN_ROOM, 1024900))).toMatchObject({
      kind: "http",
      status: 502,
    });
  });
});
