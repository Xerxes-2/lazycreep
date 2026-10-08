/**
 * 玩家名放在 creep 下方：上方留给 say 气泡（#22）。
 */
import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { LABEL_MIN_ZOOM } from "./room-detail-rules.ts";
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

function scene(): Scene {
  return buildRoomScene({ state: roomStateFrom({ objects: { c: creep }, users }) }, { theme: DEFAULT_THEME, me: "me1", zoom: LABEL_MIN_ZOOM + 20 });
}
const part = (s: Scene, name: string): Primitive | undefined => s.primitives.find((p) => p.key === `c/${name}`);

describe("玩家名", () => {
  const s = scene();
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
});
