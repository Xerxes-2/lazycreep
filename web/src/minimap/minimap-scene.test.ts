import { describe, expect, it } from "vitest";
import type { CirclePrimitive, ImagePrimitive, Primitive, RectPrimitive } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { buildMinimapScene, minimapRoomAt, type MinimapInput } from "./minimap-scene.ts";

/** 赛季服的世界：102×102 个房间，W50N50 在左上角 */
const SIZE = { width: 102, height: 102 };

function input(patch: Partial<MinimapInput> = {}): MinimapInput {
  return {
    center: "W13S28",
    size: SIZE,
    tileUrl: (room) => `/tiles/${room}.png`,
    rooms: {},
    positions: {},
    ownerColor: (user) => (user === "me" ? 0x0000ff : 0xff0000),
    theme: DEFAULT_THEME,
    ...patch,
  };
}

const of = <K extends Primitive["kind"]>(prims: readonly Primitive[], kind: K) =>
  prims.filter((p): p is Extract<Primitive, { kind: K }> => p.kind === kind);

const tiles = (prims: readonly Primitive[]) =>
  of(prims, "image").map((p: ImagePrimitive) => ({ x: p.x, y: p.y, url: p.url }));

describe("Minimap 的 Scene", () => {
  it("3×3 格、每格一张单房间瓦片，当前房间在中心", () => {
    const scene = buildMinimapScene(input());
    expect(scene.width).toBe(3);
    expect(scene.height).toBe(3);
    expect(tiles(scene.primitives)).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0, url: "/tiles/W14S27.png" },
        { x: 1, y: 0, url: "/tiles/W13S27.png" },
        { x: 2, y: 0, url: "/tiles/W12S27.png" },
        { x: 0, y: 1, url: "/tiles/W14S28.png" },
        { x: 1, y: 1, url: "/tiles/W13S28.png" },
        { x: 2, y: 1, url: "/tiles/W12S28.png" },
        { x: 0, y: 2, url: "/tiles/W14S29.png" },
        { x: 1, y: 2, url: "/tiles/W13S29.png" },
        { x: 2, y: 2, url: "/tiles/W12S29.png" },
      ]),
    );
    expect(of(scene.primitives, "image").every((p) => p.width === 1 && p.height === 1)).toBe(true);
    expect(tiles(scene.primitives)).toHaveLength(9);
  });

  it("跨越 0 线：E0S0 的西北是 W0N0", () => {
    const urls = tiles(buildMinimapScene(input({ center: "E0S0" })).primitives);
    expect(urls).toContainEqual({ x: 0, y: 0, url: "/tiles/W0N0.png" });
    expect(urls).toContainEqual({ x: 2, y: 2, url: "/tiles/E1S1.png" });
  });

  it("世界边缘外的格子为空：左上角的房间只有 4 格", () => {
    const scene = buildMinimapScene(input({ center: "W50N50", rooms: {}, positions: {} }));
    expect(tiles(scene.primitives)).toEqual(
      expect.arrayContaining([
        { x: 1, y: 1, url: "/tiles/W50N50.png" },
        { x: 2, y: 1, url: "/tiles/W49N50.png" },
        { x: 1, y: 2, url: "/tiles/W50N49.png" },
        { x: 2, y: 2, url: "/tiles/W49N49.png" },
      ]),
    );
    expect(tiles(scene.primitives)).toHaveLength(4);
    // 空格上什么都不画
    expect(scene.primitives.every((p) => !("x" in p) || (p.x >= 1 && p.y >= 1))).toBe(true);
  });

  it("按所有者着色：占有的房间整格着色，预定的更淡", () => {
    const scene = buildMinimapScene(
      input({
        rooms: {
          W12S28: { status: "normal", owner: { user: "me", level: 8 } },
          W13S27: { status: "normal", owner: { user: "foe", level: 0 } },
          W14S29: { status: "normal" },
        },
      }),
    );
    const rects = of(scene.primitives, "rect").filter((r) => r.fill !== undefined);
    const at = (x: number, y: number) => rects.find((r: RectPrimitive) => r.x === x && r.y === y);
    expect(at(2, 1)).toMatchObject({ width: 1, height: 1, fill: 0x0000ff });
    expect(at(1, 0)).toMatchObject({ width: 1, height: 1, fill: 0xff0000 });
    expect(at(1, 0)!.alpha!).toBeLessThan(at(2, 1)!.alpha!);
    expect(at(0, 2)).toBeUndefined();
  });

  it("roomMap2 的玩家位置画成所有者颜色的点，落在对应格子的对应坐标；地形类别不当作玩家", () => {
    const scene = buildMinimapScene(
      input({
        positions: {
          W12S28: { me: [[10, 20]], w: [[1, 1]], s: [[5, 5]] },
          W14S27: { foe: [[0, 49]] },
        },
      }),
    );
    const dots = of(scene.primitives, "circle");
    expect(dots).toHaveLength(2);
    const near = (dot: CirclePrimitive, x: number, y: number) => Math.abs(dot.x - x) < 1e-9 && Math.abs(dot.y - y) < 1e-9;
    const mine = dots.find((d) => d.fill === 0x0000ff)!;
    expect(near(mine, 2 + 10.5 / 50, 1 + 20.5 / 50)).toBe(true);
    const foe = dots.find((d) => d.fill === 0xff0000)!;
    expect(near(foe, 0 + 0.5 / 50, 0 + 49.5 / 50)).toBe(true);
    // 点在瓦片与所有权之上
    const tileLayer = of(scene.primitives, "image")[0]!.layer;
    expect(dots.every((d) => d.layer > tileLayer)).toBe(true);
  });

  it("世界坐标换算到格子里的房间；边缘外与画面外为 undefined", () => {
    expect(minimapRoomAt("W13S28", SIZE, 2.5, 1.5)).toBe("W12S28");
    expect(minimapRoomAt("W13S28", SIZE, 1.2, 0.1)).toBe("W13S27");
    expect(minimapRoomAt("W13S28", SIZE, 1.5, 1.5)).toBe("W13S28");
    expect(minimapRoomAt("W13S28", SIZE, 3.1, 1.5)).toBeUndefined();
    expect(minimapRoomAt("W13S28", SIZE, -0.1, 1.5)).toBeUndefined();
    expect(minimapRoomAt("W50N50", SIZE, 0.5, 1.5)).toBeUndefined();
  });
});
