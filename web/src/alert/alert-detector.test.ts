import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { RoomMapUpdate } from "../source/source.ts";
import { PVP_FETCH_INTERVAL, type PvpFeedData } from "../pvp/pvp-overview.ts";
import {
  DEFAULT_ALERT_CONFIG,
  createAlertDetector,
  myRoomsFrom,
  type AlertConfig,
  type AlertContext,
} from "./alert-detector.ts";

const files = Object.values(
  import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" }),
);
const season = new FixtureSource(fixtureBundle(files));

/** 录制的 roomMap2 帧（每 Tick 一帧） */
function roomMapFrames(room: string): RoomMapUpdate[] {
  const file = files.find(
    (f) => (f as { meta: { kind: string; room?: string } }).meta.kind === "roomMap2" && (f as { meta: { room?: string } }).meta.room === room,
  ) as { frames: { data: RoomMapUpdate }[] };
  return file.frames.map((f) => f.data);
}

async function feed(): Promise<PvpFeedData> {
  const [pvp, nukes] = await Promise.all([season.getPvp(PVP_FETCH_INTERVAL), season.getNukes()]);
  return { pvp, nukes };
}

const SHARD = "shardSeason";
// 录制里 E13N21 正在交火，房间里有 volotsyouga（2 个点，全程在）与 dump_table（前 44 帧连续在，之后进进出出）
const VOLOTSYOUGA = "65b2ded6e582880012134da6";
const DUMP_TABLE = "685da7c42df7a30011653e6a";
const XERXES = "6253e4a3a3d173248b5a2691";

function ctx(rooms: readonly string[], extra: Partial<AlertContext> = {}): AlertContext {
  return {
    me: VOLOTSYOUGA,
    rooms: new Map([[SHARD, new Set(rooms)]]),
    allies: new Set(),
    usernames: { [VOLOTSYOUGA]: "volotsyouga", [DUMP_TABLE]: "dump_table", [XERXES]: "Xerxes_2" },
    ...extra,
  };
}

const MIN = 60_000;
const config = (patch: Partial<AlertConfig> = {}): AlertConfig => ({ ...DEFAULT_ALERT_CONFIG, ...patch });

/** 逐帧喂 roomMap2，返回所有告警 */
function play(frames: readonly RoomMapUpdate[], room: string, context: AlertContext, cfg: AlertConfig, detector = createAlertDetector()) {
  return frames.flatMap((frame, i) => detector.roomMap(SHARD, room, frame, context, cfg, i * 3000));
}

describe("PvP 触发", () => {
  it("我的房间出现在 PvP 列表里：告警带最后战斗 Tick", async () => {
    const alerts = createAlertDetector().feed(await feed(), ctx(["E13N21"]), config(), 0);
    expect(alerts).toEqual([{ shard: SHARD, room: "E13N21", reason: "pvp", lastPvpTime: 1025187 }]);
  });

  it("不是我的房间的战斗不告警", async () => {
    expect(createAlertDetector().feed(await feed(), ctx(["W13S28"]), config(), 0)).toEqual([]);
  });

  it("lastPvpTime 没变就不再告警；冷却过后有更新的战斗才再告警", async () => {
    const data = await feed();
    const detector = createAlertDetector();
    const c = ctx(["E13N21"]);
    expect(detector.feed(data, c, config(), 0)).toHaveLength(1);
    const later = bump(data, "E13N21", 1025190);
    // 冷却内：同房间同原因不重复
    expect(detector.feed(later, c, config({ cooldownMinutes: 15 }), 10 * MIN)).toEqual([]);
    expect(detector.feed(later, c, config({ cooldownMinutes: 15 }), 16 * MIN)).toEqual([
      { shard: SHARD, room: "E13N21", reason: "pvp", lastPvpTime: 1025190 },
    ]);
    // 冷却早过了，但战斗没有更新：不告警
    expect(detector.feed(later, c, config({ cooldownMinutes: 15 }), 60 * MIN)).toEqual([]);
  });

  it("关掉 PvP 条件后不告警", async () => {
    expect(createAlertDetector().feed(await feed(), ctx(["E13N21"]), config({ pvp: false }), 0)).toEqual([]);
  });
});

function bump(data: PvpFeedData, room: string, lastPvpTime: number): PvpFeedData {
  return {
    ...data,
    pvp: data.pvp.map((s) => ({ ...s, rooms: s.rooms.map((r) => (r.room === room ? { ...r, lastPvpTime } : r)) })),
  };
}

describe("核弹触发", () => {
  it("核弹瞄准我的房间：告警带落地 Tick 与发射房间", async () => {
    const alerts = createAlertDetector().feed(await feed(), ctx(["W17N21"], { me: XERXES }), config({ pvp: false }), 0);
    expect(alerts).toEqual([
      { shard: SHARD, room: "W17N21", reason: "nuke", landTime: 1048646, launchRoom: "W12N25", count: 1 },
    ]);
  });

  it("同一颗核弹只告警一次；冷却内新发的核弹等冷却过后再告警", async () => {
    const data = await feed();
    const detector = createAlertDetector();
    const c = ctx(["W17N21"]);
    const cfg = config({ pvp: false, cooldownMinutes: 10 });
    expect(detector.feed(data, c, cfg, 0)).toHaveLength(1);
    expect(detector.feed(data, c, cfg, 60 * MIN)).toEqual([]);
    const second = { ...data, nukes: [...data.nukes, { ...data.nukes[0]!, id: "second", landTime: 1050000 }] };
    expect(detector.feed(second, c, cfg, 65 * MIN)).toHaveLength(1);
    const third = { ...second, nukes: [...second.nukes, { ...data.nukes[0]!, id: "third", landTime: 1050000 }] };
    expect(detector.feed(third, c, cfg, 70 * MIN)).toEqual([]);
    expect(detector.feed(third, c, cfg, 76 * MIN)).toEqual([
      { shard: SHARD, room: "W17N21", reason: "nuke", landTime: 1050000, launchRoom: "W12N25", count: 1 },
    ]);
  });

  it("关掉核弹条件后不告警", async () => {
    expect(createAlertDetector().feed(await feed(), ctx(["W17N21"]), config({ pvp: false, nuke: false }), 0)).toEqual([]);
  });
});

describe("陌生人停留触发", () => {
  const frames = roomMapFrames("E13N21");

  it("非我非盟友的玩家停留超过阈值：告警一次，带玩家名", () => {
    const alerts = play(frames, "E13N21", ctx(["E13N21"]), config({ strangerTicks: 30 }));
    expect(alerts).toEqual([
      { shard: SHARD, room: "E13N21", reason: "stranger", users: [{ id: DUMP_TABLE, username: "dump_table" }], ticks: 30 },
    ]);
  });

  it("盟友不触发（名单不分大小写）", () => {
    const alerts = play(frames, "E13N21", ctx(["E13N21"], { allies: new Set(["DUMP_Table"]) }), config({ strangerTicks: 30 }));
    expect(alerts).toEqual([]);
  });

  it("边界上进进出出的短暂缺席不打断停留计数", () => {
    // dump_table 第 44 帧之后隔帧出现；阈值 50 只有不清零才够得着
    const alerts = play(frames, "E13N21", ctx(["E13N21"]), config({ strangerTicks: 50 }));
    expect(alerts.map((a) => a.reason)).toEqual(["stranger"]);
  });

  it("路过侦察不触发：短暂经过后离开", () => {
    const quiet = roomMapFrames("W13S28");
    // 一只侦察兵在 W13S28 待了 20 Tick 后离开，之后房间里只有我
    const scouted = quiet.map((frame, i) => (i >= 5 && i < 25 ? { ...frame, [DUMP_TABLE]: [[i, 25] as const] } : frame));
    const alerts = play(scouted, "W13S28", ctx(["W13S28"], { me: XERXES }), config());
    expect(alerts).toEqual([]);
  });

  it("离开足够久后重新进入，从头计数", () => {
    const quiet = roomMapFrames("W13S28");
    const visits = quiet.map((frame, i) =>
      (i >= 0 && i < 20) || (i >= 30 && i < 50) ? { ...frame, [DUMP_TABLE]: [[i, 25] as const] } : frame,
    );
    expect(play(visits, "W13S28", ctx(["W13S28"], { me: XERXES }), config({ strangerTicks: 25 }))).toEqual([]);
  });

  it("我自己、NPC（Invader、Source Keeper）不算陌生人", () => {
    const quiet = roomMapFrames("W13S28");
    const npcs = quiet.map((frame) => ({ ...frame, "2": [[1, 1] as const], "3": [[2, 2] as const] }));
    expect(play(npcs, "W13S28", ctx(["W13S28"], { me: XERXES }), config({ strangerTicks: 10 }))).toEqual([]);
  });

  it("冷却内不重复；冷却过后人还在则再告警", () => {
    const detector = createAlertDetector();
    const c = ctx(["E13N21"]);
    const cfg = config({ strangerTicks: 10, cooldownMinutes: 1 });
    // 每帧 3 秒：51 帧约 150 秒，冷却 1 分钟 → 第 10、30、50 帧附近各一次
    const alerts = frames.flatMap((frame, i) => detector.roomMap(SHARD, "E13N21", frame, c, cfg, i * 3000));
    expect(alerts.map((a) => (a.reason === "stranger" ? a.ticks : 0))).toEqual([10, 30, 50]);
  });

  it("不是我的房间不判定；关掉条件后不告警", () => {
    expect(play(frames, "E13N21", ctx(["W13S28"]), config({ strangerTicks: 10 }))).toEqual([]);
    expect(play(frames, "E13N21", ctx(["E13N21"]), config({ strangerTicks: 10, stranger: false }))).toEqual([]);
  });

  it("不知道玩家名时照样告警（只缺名字）", () => {
    const alerts = play(frames, "E13N21", ctx(["E13N21"], { usernames: {} }), config({ strangerTicks: 30 }));
    expect(alerts).toEqual([{ shard: SHARD, room: "E13N21", reason: "stranger", users: [{ id: DUMP_TABLE }], ticks: 30 }]);
  });
});

describe("我的房间集合", () => {
  it("用户信息给出各 Shard 的房间；所有权数据里归我的房间一并算上", async () => {
    const me = await season.getMe();
    const rooms = myRoomsFrom(me, [
      {
        shard: "shard1",
        time: 1,
        nukes: [],
        rooms: [
          { room: "W1N1", lastPvpTime: 1, ago: 0, owner: { kind: "owned", userId: me.id, level: 3 } },
          { room: "W2N2", lastPvpTime: 1, ago: 0, owner: { kind: "reserved", userId: me.id, level: 0 } },
          { room: "W3N3", lastPvpTime: 1, ago: 0, owner: { kind: "owned", userId: "other", level: 8 } },
        ],
      },
    ]);
    expect([...rooms.get(SHARD)!].sort()).toEqual(["W12S26", "W12S28", "W13S28", "W15S28", "W17S25", "W17S29"]);
    expect([...rooms.get("shard1")!]).toEqual(["W1N1"]);
  });
});
