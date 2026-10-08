import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../scene/theme.ts";
import type { ImagePrimitive, Primitive, RectPrimitive } from "../scene/scene.ts";
import type { MapStats } from "../source/source.ts";
import { BLOCK_TILE_MIN_ZOOM, MAP_LAYER, ROOM_TILE_MIN_ZOOM, buildMapScene, type MapView } from "./map-scene.ts";
import { applyMapStats, mapStateFrom, roomAtWorld, type MapState } from "./map-state.ts";

const ME = "me-id";
const OTHER = "other-id";
const OTHER2 = "other3-id";

const tiles = {
  room: (room: string) => `/tiles/${room}.png`,
  block: (corner: string) => `/tiles/zoom2/${corner}.png`,
  sector: (corner: string) => `/tiles/zoom1/${corner}.png`,
};

/** 一个 102×102 的世界（与赛季服相同），W50 在世界坐标 0，E0 在 51。 */
function world(stats?: Partial<MapStats>): MapState {
  const base = mapStateFrom({ shard: "s", size: { width: 102, height: 102 }, tiles, me: ME });
  return stats ? applyMapStats(base, { shard: "s", gameTime: 1, rooms: {}, users: {}, ...stats }) : base;
}

/** W13S28 的世界坐标：x = -14 + 51 = 37，y = 28 + 51 = 79 */
const W13S28 = { x: 37, y: 79 };

function view(overrides: Partial<MapView> = {}): MapView {
  return {
    theme: DEFAULT_THEME,
    zoom: 10,
    visible: { x0: 0, y0: 0, x1: 102, y1: 102 },
    ...overrides,
  };
}

const images = (primitives: readonly Primitive[]) => primitives.filter((p): p is ImagePrimitive => p.kind === "image");
const ownership = (primitives: readonly Primitive[]) =>
  primitives.filter((p): p is RectPrimitive => p.kind === "rect" && p.layer === MAP_LAYER.ownership);

describe("MapState", () => {
  it("房间名与世界坐标互换：W 与 N 从 -1 开始", () => {
    const state = world();
    expect(roomAtWorld(state, W13S28.x + 0.5, W13S28.y + 0.5)).toBe("W13S28");
    expect(roomAtWorld(state, 51.2, 51.9)).toBe("E0S0");
    expect(roomAtWorld(state, 50.9, 50.1)).toBe("W0N0");
    expect(roomAtWorld(state, 0, 0)).toBe("W50N50");
    expect(roomAtWorld(state, 101.5, 101.5)).toBe("E50S50");
    expect(roomAtWorld(state, -0.1, 3)).toBeUndefined();
    expect(roomAtWorld(state, 3, 102)).toBeUndefined();
  });

  it("map-stats 合并进来：后到的覆盖先到的，其他房间保留", () => {
    const first = world({ rooms: { W13S28: { status: "normal", owner: { user: ME, level: 7 } }, W1S1: { status: "normal" } } });
    const second = applyMapStats(first, {
      shard: "s",
      gameTime: 2,
      rooms: { W13S28: { status: "normal", owner: { user: ME, level: 8 } } },
      users: { [ME]: { _id: ME, username: "me" } },
    });
    expect(second.rooms["W13S28"]!.owner!.level).toBe(8);
    expect(second.rooms["W1S1"]).toEqual({ status: "normal" });
    expect(second.users[ME]!.username).toBe("me");
    expect(first.rooms["W13S28"]!.owner!.level).toBe(7);
  });

  it("别的 Shard 的 map-stats 不合并", () => {
    const state = world();
    const next = applyMapStats(state, { shard: "other", gameTime: 1, rooms: { W1S1: { status: "normal" } }, users: {} });
    expect(next).toBe(state);
  });
});

describe("buildMapScene", () => {
  it("Scene 以房间为单位，覆盖整个世界", () => {
    const scene = buildMapScene(world(), view());
    expect(scene).toMatchObject({ width: 102, height: 102, background: DEFAULT_THEME.background });
  });

  describe("瓦片选择", () => {
    it("放大到阈值以上时每个可见房间一张单房间瓦片", () => {
      const scene = buildMapScene(
        world(),
        view({ zoom: ROOM_TILE_MIN_ZOOM, visible: { x0: W13S28.x, y0: W13S28.y, x1: W13S28.x + 2, y1: W13S28.y + 1 } }),
      );
      const tilesShown = images(scene.primitives);
      expect(tilesShown.map((p) => p.url).sort()).toEqual(["/tiles/W12S28.png", "/tiles/W13S28.png"]);
      expect(tilesShown.find((p) => p.url === "/tiles/W13S28.png")).toMatchObject({
        x: W13S28.x,
        y: W13S28.y,
        width: 1,
        height: 1,
        layer: MAP_LAYER.tile,
      });
    });

    it("阈值以下用 zoom2 块瓦片：一张盖 4×4 个房间，按块西北角房间命名", () => {
      const scene = buildMapScene(
        world(),
        view({ zoom: ROOM_TILE_MIN_ZOOM - 1, visible: { x0: W13S28.x, y0: W13S28.y, x1: W13S28.x + 1, y1: W13S28.y + 1 } }),
      );
      // W13S28 在 x = -14..，所在块的西北角是 x = -16（W15）、y = 28（S28）
      expect(images(scene.primitives)).toEqual([
        expect.objectContaining({ url: "/tiles/zoom2/W15S28.png", x: 35, y: 79, width: 4, height: 4 }),
      ]);
    });

    it("块角在 0 两侧都按 4 对齐：E0S0、W3N3、E0N3", () => {
      const scene = buildMapScene(world(), view({ zoom: BLOCK_TILE_MIN_ZOOM, visible: { x0: 50.5, y0: 50.5, x1: 51.5, y1: 51.5 } }));
      expect(images(scene.primitives).map((p) => p.url).sort()).toEqual(
        ["/tiles/zoom2/E0N3.png", "/tiles/zoom2/E0S0.png", "/tiles/zoom2/W3N3.png", "/tiles/zoom2/W3S0.png"].sort(),
      );
    });
  });

  describe("可见区域裁剪", () => {
    it("只为与可见区域相交的房间产出图元，世界之外不产出", () => {
      const scene = buildMapScene(
        world({ rooms: { W13S28: { status: "normal", owner: { user: ME, level: 8 } }, E20N20: { status: "normal", owner: { user: OTHER, level: 3 } } } }),
        view({ zoom: 60, visible: { x0: -5, y0: -5, x1: 2.5, y1: 1.5 } }),
      );
      const rooms = images(scene.primitives).map((p) => p.url.replace(/^\/tiles\/|\.png$/g, ""));
      expect(rooms.sort()).toEqual(["W49N50", "W49N49", "W50N49", "W50N50", "W48N50", "W48N49"].sort());
      expect(ownership(scene.primitives)).toEqual([]);
    });

    it("整个世界可见时块瓦片铺满世界", () => {
      const scene = buildMapScene(world(), view({ zoom: BLOCK_TILE_MIN_ZOOM }));
      // 有符号 x 从 -51 到 50：块角 -52..48，共 26 列；y 同理
      expect(images(scene.primitives)).toHaveLength(26 * 26);
      const keys = scene.primitives.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("远景（低于 zoom2 阈值）用 zoom1 扇区瓦片：一张盖 10×10 个房间，按扇区西北角房间命名", () => {
      const scene = buildMapScene(
        world(),
        view({ zoom: BLOCK_TILE_MIN_ZOOM - 1, visible: { x0: W13S28.x, y0: W13S28.y, x1: W13S28.x + 1, y1: W13S28.y + 1 } }),
      );
      // W13S28 在 x = -14，所在扇区的西北角是 x = -20（W19）、y = 20（S20）
      expect(images(scene.primitives)).toEqual([
        expect.objectContaining({ url: "/tiles/zoom1/W19S20.png", x: 31, y: 71, width: 10, height: 10 }),
      ]);
    });

    it("扇区角在 0 两侧都按 10 对齐：E0S0、W9N9、E0N9、W9S0", () => {
      const scene = buildMapScene(world(), view({ zoom: 5, visible: { x0: 50.5, y0: 50.5, x1: 51.5, y1: 51.5 } }));
      expect(images(scene.primitives).map((p) => p.url).sort()).toEqual(
        ["/tiles/zoom1/E0N9.png", "/tiles/zoom1/E0S0.png", "/tiles/zoom1/W9N9.png", "/tiles/zoom1/W9S0.png"].sort(),
      );
    });

    it("整个世界可见的远景只用扇区角瓦片：102×102 的世界共 12×12 张", () => {
      const scene = buildMapScene(world(), view({ zoom: 6 }));
      const shown = images(scene.primitives);
      // 有符号 x 从 -51 到 50：扇区角 -60..50，共 12 列；y 同理
      expect(shown).toHaveLength(12 * 12);
      for (const tile of shown) {
        const corner = /zoom1\/([WE])(\d+)([NS])(\d+)\.png$/.exec(tile.url)!;
        const signed = (dir: string, n: number) => (dir === "W" || dir === "N" ? -n - 1 : n);
        expect(Math.abs(signed(corner[1]!, Number(corner[2])) % 10)).toBe(0);
        expect(Math.abs(signed(corner[3]!, Number(corner[4])) % 10)).toBe(0);
        expect(tile).toMatchObject({ width: 10, height: 10 });
      }
      expect(new Set(shown.map((p) => p.key)).size).toBe(shown.length);
    });
  });

  describe("所有权着色", () => {
    const state = world({
      rooms: {
        W13S28: { status: "normal", owner: { user: ME, level: 8 } },
        W14S28: { status: "normal", owner: { user: ME, level: 0 } },
        W12S28: { status: "normal", owner: { user: OTHER, level: 8 } },
        W11S28: { status: "normal", owner: { user: OTHER2, level: 5 } },
        W10S28: { status: "normal" },
      },
    });
    const around = view({ visible: { x0: 30, y0: 75, x1: 45, y1: 85 } });

    function overlay(room: string): RectPrimitive | undefined {
      return ownership(buildMapScene(state, around).primitives).find((p) => p.key === `own:${room}`);
    }

    it("自己的房间用主题的己方颜色，盖住整个房间格", () => {
      expect(overlay("W13S28")).toMatchObject({ fill: DEFAULT_THEME.owned, x: W13S28.x, y: W13S28.y, width: 1, height: 1 });
    });

    it("预定的房间比占有的房间更淡，且没有边框", () => {
      const owned = overlay("W13S28")!;
      const reserved = overlay("W14S28")!;
      expect(reserved.fill).toBe(owned.fill);
      expect(reserved.alpha!).toBeLessThan(owned.alpha!);
      expect(owned.stroke).toBeDefined();
      expect(reserved.stroke).toBeUndefined();
    });

    it("不同玩家颜色不同，同一玩家颜色稳定，都不是己方颜色", () => {
      const other = overlay("W12S28")!.fill;
      const other2 = overlay("W11S28")!.fill;
      expect(other).not.toBe(DEFAULT_THEME.owned);
      expect(other2).not.toBe(DEFAULT_THEME.owned);
      expect(other).not.toBe(other2);
      expect(buildMapScene(state, around).primitives.find((p) => p.key === "own:W12S28")).toMatchObject({ fill: other });
    });

    it("可以换着色规则", () => {
      const scene = buildMapScene(state, { ...around, ownerColor: (user) => (user === OTHER ? 0x123456 : 0x654321) });
      expect(ownership(scene.primitives).find((p) => p.key === "own:W12S28")!.fill).toBe(0x123456);
    });

    it("无主的房间不着色；着色层在瓦片之上", () => {
      expect(overlay("W10S28")).toBeUndefined();
      expect(MAP_LAYER.ownership).toBeGreaterThan(MAP_LAYER.tile);
    });
  });
});
