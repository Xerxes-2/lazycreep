import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { buildRoomScene } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

// 样本取自 2026-10-08 匿名 GET /season/api/game/room-objects?room=E15N25&shard=shardSeason 与 ?room=W3N4
const REACTOR = {
  _id: "6a901a3ab8684d0008337e49",
  room: "E15N25",
  x: 37,
  y: 15,
  type: "reactor",
  store: { T: 509 },
  storeCapacityResource: { T: 1000 },
  user: "65b2ded6e582880012134da6",
  launchTime: 981890,
};
const THORIUM_MINERAL = { _id: "6a901a46b8684d0008338bd4", room: "W3N4", x: 21, y: 13, type: "mineral", mineralType: "T", density: 3, mineralAmount: 22000 };
const HYDROGEN_MINERAL = { _id: "6a8cae989a27bdd9986d34dc", type: "mineral", density: 4, mineralType: "H", mineralAmount: 100000, x: 9, y: 15, room: "W3N4" };

function scene(objects: Record<string, Record<string, unknown>>): Scene {
  const state = roomStateFrom({ objects, users: { [REACTOR.user]: { _id: REACTOR.user, username: "volotsyouga" } } });
  return buildRoomScene({ state }, { theme: DEFAULT_THEME, me: REACTOR.user });
}

const of = (s: Scene, id: string) => s.primitives.filter((p) => p.objectId === id);
const isLabel = (p: Primitive, text: string) => p.kind === "text" && p.text === text;
const fills = (prims: Primitive[]) => prims.flatMap((p) => ("fill" in p && p.fill !== undefined ? [p.fill] : []));

function covers(p: Primitive, x: number, y: number): boolean {
  if (p.kind === "circle") return Math.hypot(p.x - x, p.y - y) <= p.radius;
  if (p.kind === "rect" || p.kind === "bar") return p.x <= x && x <= p.x + p.width && p.y <= y && y <= p.y + p.height;
  if (p.kind === "polygon") {
    const xs = p.points.filter((_, i) => i % 2 === 0);
    const ys = p.points.filter((_, i) => i % 2 === 1);
    return Math.min(...xs) <= x && x <= Math.max(...xs) && Math.min(...ys) <= y && y <= Math.max(...ys);
  }
  return false;
}

describe("赛季对象：reactor", () => {
  it("有专用画法：画在自己的格子上，不是占位图元", () => {
    const prims = of(scene({ r: REACTOR }), "r");
    expect(prims.length).toBeGreaterThan(0);
    expect(prims.some((p) => covers(p, 37.5, 15.5))).toBe(true);
    expect(prims.some((p) => isLabel(p, "reactor"))).toBe(false);
  });

  it("钍装得越多，钍芯越大；空的 reactor 不画钍芯", () => {
    const core = (amount: number) =>
      of(scene({ r: { ...REACTOR, store: { T: amount } } }), "r").find((p) => p.key === "r/thorium");
    const half = core(509);
    const full = core(1000);
    expect(half?.kind).toBe("circle");
    expect(full?.kind).toBe("circle");
    if (half?.kind !== "circle" || full?.kind !== "circle") return;
    expect(full.radius).toBeGreaterThan(half.radius);
    expect(core(0)).toBeUndefined();
  });

  it("钍芯与地上的钍矿同色，且与普通矿物不同色", () => {
    const s = scene({ r: REACTOR, t: THORIUM_MINERAL, h: HYDROGEN_MINERAL });
    const reactorCore = of(s, "r").find((p) => p.key === "r/thorium");
    const thoriumFill = fills(of(s, "t"));
    const hydrogenFill = fills(of(s, "h"));
    expect(reactorCore && "fill" in reactorCore ? reactorCore.fill : undefined).toBe(thoriumFill[0]);
    expect(thoriumFill[0]).not.toBe(hydrogenFill[0]);
  });

  it("外形与其他结构可区分：图元组合不同于 container、extractor、storage", () => {
    const signature = (type: string) =>
      of(scene({ o: { ...REACTOR, type } }), "o")
        .map((p) => `${p.key}:${p.kind}`)
        .sort()
        .join(",");
    for (const other of ["container", "extractor", "storage", "lab", "powerSpawn"]) {
      expect(signature("reactor")).not.toBe(signature(other));
    }
  });

  it("有主 reactor 用主人颜色描边，无主的不用", () => {
    const owned = of(scene({ r: REACTOR }), "r").find((p) => p.key === "r/body");
    const free = of(scene({ r: { ...REACTOR, user: undefined } }), "r").find((p) => p.key === "r/body");
    const strokeColor = (p: Primitive | undefined) => (p && "stroke" in p ? p.stroke?.color : undefined);
    expect(strokeColor(owned)).toBe(DEFAULT_THEME.owned);
    expect(strokeColor(free)).not.toBe(DEFAULT_THEME.owned);
  });
});

describe("赛季资源：钍（T）", () => {
  it("钍矿仍按矿物画（带 T 标记），但颜色专用", () => {
    const prims = of(scene({ t: THORIUM_MINERAL }), "t");
    expect(prims.some((p) => isLabel(p, "T"))).toBe(true);
    expect(prims.some((p) => isLabel(p, "mineral"))).toBe(false);
    expect(fills(prims)[0]).not.toBe(DEFAULT_THEME.mineral);
  });

  it("掉在地上的钍与钍矿同色", () => {
    const s = scene({
      t: THORIUM_MINERAL,
      d: { _id: "d", type: "resource", resourceType: "T", T: 300, x: 4, y: 4 },
      e: { _id: "e", type: "energy", resourceType: "energy", energy: 300, x: 5, y: 4 },
    });
    expect(fills(of(s, "d"))[0]).toBe(fills(of(s, "t"))[0]);
    expect(fills(of(s, "e"))[0]).not.toBe(fills(of(s, "t"))[0]);
  });
});

describe("通用占位", () => {
  it("其他未知类型仍画成带类型名的占位", () => {
    const prims = of(scene({ q: { _id: "q", type: "scoreContainer", x: 3, y: 4 } }), "q");
    expect(prims.some((p) => isLabel(p, "scoreContainer"))).toBe(true);
  });
});
