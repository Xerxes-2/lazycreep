/**
 * 玩家名放在 creep 下方：上方留给 say 气泡（#22），不与格子下沿内的血条 / 资源条重叠。
 */
import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { BAR_MIN_ZOOM } from "./room-detail-rules.ts";
import { buildRoomScene } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

const users = { me1: { _id: "me1", username: "Xerxes_2" } };
const creep = {
  _id: "c",
  type: "creep",
  x: 10,
  y: 10,
  user: "me1",
  hits: 50,
  hitsMax: 100,
  body: [{ type: "carry", hits: 100 }],
  store: { energy: 25 },
  storeCapacity: 50,
  actionLog: { say: { message: "⛏", isPublic: false } },
};

function scene(artStyle: "official" | "geometric"): Scene {
  return buildRoomScene({ state: roomStateFrom({ objects: { c: creep }, users }) }, { theme: DEFAULT_THEME, me: "me1", zoom: BAR_MIN_ZOOM + 20, artStyle });
}
const part = (s: Scene, name: string): Primitive | undefined => s.primitives.find((p) => p.key === `c/${name}`);

describe.each(["official", "geometric"] as const)("玩家名（%s 画风）", (artStyle) => {
  const s = scene(artStyle);
  const label = part(s, "owner-name");
  const cy = 10.5;

  it("在 creep 下方、格子之外", () => {
    expect(label?.kind).toBe("text");
    if (label?.kind !== "text") return;
    expect(label.y - label.size / 2).toBeGreaterThanOrEqual(cy + 0.5);
  });

  it("不与 say 气泡重叠（气泡在上方）", () => {
    const bubbleYs = s.primitives
      .filter((p) => p.key.startsWith("c/say"))
      .flatMap((p) => (p.kind === "polygon" ? p.points.filter((_, i) => i % 2 === 1) : p.kind === "text" ? [p.y] : []));
    expect(bubbleYs.length).toBeGreaterThan(0);
    if (label?.kind !== "text") return;
    expect(Math.max(...bubbleYs)).toBeLessThan(label.y - label.size / 2);
  });

  it("不与进度条重叠", () => {
    if (label?.kind !== "text") return;
    for (const p of s.primitives.filter((q) => q.objectId === "c" && q.kind === "bar")) {
      if (p.kind !== "bar") continue;
      expect(p.y + p.height).toBeLessThanOrEqual(label.y - label.size / 2);
    }
  });
});
