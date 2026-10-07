import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { FixtureSource, fixtureBundle } from "../source/fixture-source.ts";
import type { Terrain } from "../source/source.ts";
import { LAYER, ROOM_OBJECT_PAINTERS, buildRoomScene, type ObjectPainter } from "./room-scene.ts";
import { reduceLiveTick, roomStateFrom, type RoomState } from "./room-state.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const view = { theme: DEFAULT_THEME };

function stateWith(objects: Record<string, Record<string, unknown>>): RoomState {
  return roomStateFrom({ objects, users: { me: { _id: "me", username: "me" } } });
}

/** 图元的包围盒（世界单位）。 */
function bounds(p: Primitive): { x0: number; y0: number; x1: number; y1: number } {
  switch (p.kind) {
    case "rect":
    case "bar":
      return { x0: p.x, y0: p.y, x1: p.x + p.width, y1: p.y + p.height };
    case "circle":
      return { x0: p.x - p.radius, y0: p.y - p.radius, x1: p.x + p.radius, y1: p.y + p.radius };
    case "text":
      return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    case "line":
    case "polygon": {
      const xs = p.points.filter((_, i) => i % 2 === 0);
      const ys = p.points.filter((_, i) => i % 2 === 1);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
  }
}

function covers(p: Primitive, x: number, y: number): boolean {
  const b = bounds(p);
  return b.x0 <= x && x <= b.x1 && b.y0 <= y && y <= b.y1;
}

const ofObject = (scene: Scene, id: string) => scene.primitives.filter((p) => p.objectId === id);

describe("buildRoomScene：地形", () => {
  // 第 0 行：x=0..2 墙、x=3 沼泽，其余平原；第 1 行 x=10 墙
  const encoded = ("1112" + "0".repeat(46) + "0".repeat(10) + "1" + "0".repeat(39)).padEnd(2500, "0");
  const terrain: Terrain = { shard: "s", room: "W1N1", encoded };

  it("墙与沼泽画成矩形，平原不画；地形在对象之下", () => {
    const scene = buildRoomScene({ state: stateWith({}), terrain }, view);
    expect(scene.width).toBe(50);
    expect(scene.height).toBe(50);
    const terrainPrims = scene.primitives.filter((p) => p.objectId === undefined);
    const at = (x: number, y: number) => terrainPrims.filter((p) => covers(p, x + 0.5, y + 0.5));
    expect(at(0, 0)).toHaveLength(1);
    expect(at(2, 0)).toHaveLength(1);
    expect(at(10, 1)).toHaveLength(1);
    expect(at(3, 0)).toHaveLength(1);
    const fillAt = (x: number, y: number) => {
      const [p] = at(x, y);
      return p?.kind === "rect" ? p.fill : undefined;
    };
    expect(fillAt(0, 0)).toBeDefined();
    expect(fillAt(3, 0)).toBeDefined();
    expect(fillAt(3, 0)).not.toBe(fillAt(0, 0));
    expect(at(5, 0)).toHaveLength(0);
    expect(at(25, 25)).toHaveLength(0);
    expect(terrainPrims.every((p) => p.layer === LAYER.terrain)).toBe(true);
  });

  it("没有地形时只画对象", () => {
    const scene = buildRoomScene({ state: stateWith({}) }, view);
    expect(scene.primitives).toHaveLength(0);
  });
});

describe("buildRoomScene：对象", () => {
  const common = [
    "spawn",
    "extension",
    "tower",
    "storage",
    "terminal",
    "container",
    "link",
    "lab",
    "controller",
    "source",
    "mineral",
    "extractor",
    "observer",
    "constructedWall",
    "rampart",
    "road",
    "creep",
    "tombstone",
    "ruin",
    "energy",
    "constructionSite",
  ];

  it.each(common)("%s 有专用画法：带对象 id，画在它的格子上，不是占位图元", (type) => {
    const scene = buildRoomScene(
      { state: stateWith({ o1: { _id: "o1", type, x: 20, y: 30, user: "me", hits: 50, hitsMax: 100 } }) },
      view,
    );
    const prims = ofObject(scene, "o1");
    expect(prims.length).toBeGreaterThan(0);
    expect(prims.some((p) => covers(p, 20.5, 30.5))).toBe(true);
    expect(prims.some((p) => p.kind === "text" && p.text === type)).toBe(false);
  });

  it("未知类型落到带类型名的占位图元", () => {
    const scene = buildRoomScene({ state: stateWith({ q: { _id: "q", type: "scoreCollector", x: 7, y: 8 } }) }, view);
    const prims = ofObject(scene, "q");
    expect(prims.some((p) => p.kind === "text" && p.text === "scoreCollector")).toBe(true);
    expect(prims.some((p) => p.kind !== "text" && covers(p, 7.5, 8.5))).toBe(true);
  });

  it("缺坐标的对象跳过而不是抛错", () => {
    const scene = buildRoomScene({ state: stateWith({ bad: { _id: "bad", type: "creep" } }) }, view);
    expect(ofObject(scene, "bad")).toHaveLength(0);
  });

  it("creep 带血条，按 hits / hitsMax 填充", () => {
    const scene = buildRoomScene(
      { state: stateWith({ c: { _id: "c", type: "creep", x: 1, y: 1, user: "me", hits: 30, hitsMax: 120 } }) },
      { ...view, zoom: 100 },
    );
    const bar = ofObject(scene, "c").find((p) => p.kind === "bar");
    expect(bar).toMatchObject({ kind: "bar", value: 0.25 });
  });

  it("层级：道路在建筑下，creep 在建筑上，rampart 盖住 creep", () => {
    const scene = buildRoomScene(
      {
        state: stateWith({
          r: { _id: "r", type: "road", x: 1, y: 1 },
          s: { _id: "s", type: "spawn", x: 2, y: 1, user: "me" },
          c: { _id: "c", type: "creep", x: 3, y: 1, user: "me" },
          w: { _id: "w", type: "rampart", x: 3, y: 1, user: "me" },
        }),
      },
      view,
    );
    const top = (id: string) => Math.max(...ofObject(scene, id).map((p) => p.layer));
    const bottom = (id: string) => Math.min(...ofObject(scene, id).map((p) => p.layer));
    expect(top("r")).toBeLessThan(bottom("s"));
    expect(top("s")).toBeLessThan(bottom("c"));
    expect(bottom("w")).toBeGreaterThan(bottom("c"));
  });

  it("映射表可扩展：传入新条目即改变该类型的画法", () => {
    const painter: ObjectPainter = (obj) => [
      { part: "body", kind: "circle", layer: LAYER.structure, x: Number(obj["x"]) + 0.5, y: Number(obj["y"]) + 0.5, radius: 0.3, fill: 0xff00ff },
    ];
    const scene = buildRoomScene(
      { state: stateWith({ q: { _id: "q", type: "scoreCollector", x: 7, y: 8 } }) },
      view,
      { ...ROOM_OBJECT_PAINTERS, scoreCollector: painter },
    );
    expect(ofObject(scene, "q")).toEqual([
      { key: "q/body", objectId: "q", kind: "circle", layer: LAYER.structure, x: 7.5, y: 8.5, radius: 0.3, fill: 0xff00ff },
    ]);
  });
});

describe("buildRoomScene：录制的房间", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function finalState(room: string): Promise<RoomState> {
    const source = new FixtureSource(bundle, { speed: Infinity });
    let state: RoomState | undefined;
    source.subscribeRoom("shardSeason", room, (tick) => (state = reduceLiveTick(state, tick)));
    await vi.runAllTimersAsync();
    return state!;
  }

  it.each(["W13S28", "E13N21"])("%s：每个对象都有图元，图元 key 唯一，Scene 是纯数据", async (room) => {
    const state = await finalState(room);
    vi.useRealTimers();
    const terrain = await new FixtureSource(bundle).getTerrain("shardSeason", room);
    const scene = buildRoomScene({ state, terrain }, view);

    for (const id of Object.keys(state.objects)) expect(ofObject(scene, id).length).toBeGreaterThan(0);
    const keys = scene.primitives.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
    // 录到的类型都有专用画法
    const placeholders = scene.primitives.filter(
      (p) => p.kind === "text" && p.objectId !== undefined && p.text === state.objects[p.objectId]?.["type"],
    );
    expect(placeholders).toEqual([]);
  });
});
