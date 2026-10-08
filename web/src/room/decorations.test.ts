/**
 * #61：Room View 按装饰画地形（墙、地面、沼泽）、道路与对象（赛季控制器）。纯数据：给定装饰，看 Scene 与合成地形 SVG。
 * 期望颜色按官方 colorBrightness（HSL 的亮度乘以 brightness）用 Python colorsys 独立算出。
 */
import { describe, expect, it } from "vitest";
import { compositeSvgText } from "../scene/image-sources.ts";
import type { CirclePrimitive, ImagePrimitive, LinePrimitive, Primitive, Scene } from "../scene/scene.ts";
import { DEFAULT_THEME } from "../scene/theme.ts";
import { NO_DECORATIONS, roomDecorationsFromWire, type RoomDecorations } from "../source/room-decorations.ts";
import type { Terrain } from "../source/source.ts";
import { DEFAULT_ROOM_DISPLAY } from "./display-options.ts";
import { OFFICIAL_ROAD_COLOR } from "./official-terrain.ts";
import { buildRoomScene, type RoomSceneView } from "./room-scene.ts";
import { roomStateFrom } from "./room-state.ts";

const S3 = "https://s3.amazonaws.com/static.screeps.com/seasons/season11";

/** 2026-10-08 赛季服 W13S28 的 `game/room-decorations`（与 fixtures/season/roomDecorations.*.json 相同） */
const SEASON_WIRE = {
  ok: 1,
  decorations: [
    {
      active: {
        floorBackgroundColor: "#CDA418", floorBackgroundBrightness: 0.7, floorForegroundColor: "#F3C300", floorForegroundAlpha: 0.1,
        floorForegroundBrightness: 1, swampColor: "#4A8200", swampStrokeColor: "#513F02", swampStrokeWidth: 30,
        roadsColor: "#C2B271", roadsBrightness: 0.8, world: true,
      },
      decoration: { graphics: [], type: "floorLandscape", floorForegroundUrl: `${S3}/decorations/floor.png`, tileScale: 2 },
    },
    {
      active: {
        foregroundColor: "#CFAD01", foregroundAlpha: 0.15, foregroundBrightness: 1, backgroundColor: "#AB8812", backgroundBrightness: 0.3,
        strokeColor: "#A38A23", strokeBrightness: 0.5, strokeLighting: 0.1, strokeWidth: 10, world: true,
      },
      decoration: { graphics: [], type: "wallLandscape", foregroundUrl: `${S3}/decorations/wall.png` },
    },
    {
      active: { width: 240, height: 240, alpha: 1, animation: "" },
      decoration: {
        type: "object",
        objectType: "controller",
        graphics: [{ url: `${S3}/renderer/controller.svg`, alpha: "alpha" }],
      },
    },
  ],
};
const SEASON = roomDecorationsFromWire(SEASON_WIRE);

const users = { me1: { _id: "me1", username: "Me" }, foe1: { _id: "foe1", username: "Foe" } };
const view: RoomSceneView = { theme: DEFAULT_THEME, me: "me1" };

/** 墙在 (1,1)，沼泽在 (4,4) */
const terrain: Terrain = {
  shard: "shardSeason",
  room: "W13S28",
  encoded: Array.from({ length: 2500 }, (_, i) => (i === 51 ? "1" : i === 204 ? "2" : "0")).join(""),
};

const objects = {
  r1: { type: "road", x: 10, y: 10 },
  r2: { type: "road", x: 11, y: 10 },
  c: { type: "controller", x: 25, y: 25, user: "me1", level: 3 },
};

const sceneOf = (decorations: RoomDecorations | undefined, v: RoomSceneView = view, objs: Record<string, Record<string, unknown>> = objects): Scene =>
  buildRoomScene({ state: roomStateFrom({ gameTime: 1, objects: objs, users }), terrain, decorations }, v);

const byKey = (s: Scene, key: string) => s.primitives.find((p) => p.key === key);
const terrainSvg = (s: Scene) => compositeSvgText((byKey(s, "official-terrain") as ImagePrimitive).url)!;

describe("装饰：地形", () => {
  const svg = terrainSvg(sceneOf(SEASON));

  it("墙：底色与描边按装饰的颜色与亮度，前景图案铺满房间、只露在墙里、按前景色染色", () => {
    expect(svg).toContain(`<use href="#walls" fill="#332905" stroke="#524511" stroke-width="10" paint-order="stroke"/>`);
    expect(svg).toMatch(/<image href="\/season-static\/season11\/decorations\/wall\.png" x="0" y="0" width="5000" height="5000" preserveAspectRatio="none" filter="url\(#wallTint\)" opacity="0\.15" clip-path="url\(#wallClip\)"\/>/);
    // #CFAD01 → 0xcf/255, 0xad/255, 0x01/255
    expect(svg).toContain(`<filter id="wallTint" color-interpolation-filters="sRGB"><feColorMatrix values="0.8118 0 0 0 0 0 0.6784 0 0 0 0 0 0.0039 0 0 0 0 0 1 0"/></filter>`);
    // 光照层里墙的描边：hsl(0, 0, strokeLighting)
    expect(svg).toContain(`<use href="#walls" fill="#808080" stroke="#1a1a1a" stroke-width="10" paint-order="stroke" style="mix-blend-mode:screen"/>`);
  });

  it("地面：底色按装饰，前景图案按 tileScale 平铺（贴图 1024 像素 × 2），不再用默认的地面纹理", () => {
    expect(svg).toContain(`<rect x="0" y="0" width="5000" height="5000" fill="#907311"/>`);
    expect(svg).toContain(
      `<pattern id="floorTile" patternUnits="userSpaceOnUse" width="2048" height="2048"><image href="/season-static/season11/decorations/floor.png" width="2048" height="2048" preserveAspectRatio="none" filter="url(#floorTint)"/></pattern>`,
    );
    expect(svg).toContain(`<rect x="0" y="0" width="5000" height="5000" fill="url(#floorTile)" opacity="0.1"/>`);
    expect(svg).not.toContain("/official-art/textures/ground.png");
    expect(svg).not.toContain("/official-art/textures/ground-mask.png");
  });

  it("沼泽：填充、描边与描边宽度按装饰", () => {
    expect(svg).toContain(`<use href="#swamps" fill="#4A8200" stroke="#513F02" stroke-width="30" paint-order="stroke" opacity="0.4"/>`);
  });

  it("没有 tileScale 时前景图案拉伸铺满整个房间", () => {
    const floor = { ...SEASON.floor! };
    delete (floor as { tileScale?: number }).tileScale;
    const stretched = terrainSvg(sceneOf({ ...SEASON, floor }));
    expect(stretched).toContain(
      `<image href="/season-static/season11/decorations/floor.png" x="0" y="0" width="5000" height="5000" preserveAspectRatio="none" filter="url(#floorTint)" opacity="0.1"/>`,
    );
    expect(stretched).not.toContain("floorTile");
  });

  it("landscape 类型同时作用于墙与地面", () => {
    const [floorItem, wallItem] = SEASON_WIRE.decorations;
    const landscape = roomDecorationsFromWire({
      decorations: [
        {
          active: { ...floorItem!.active, ...wallItem!.active },
          decoration: { type: "landscape", foregroundUrl: `${S3}/decorations/wall.png`, floorForegroundUrl: `${S3}/decorations/floor.png`, tileScale: 2 },
        },
      ],
    });
    const both = terrainSvg(sceneOf(landscape));
    expect(both).toContain(`fill="#332905" stroke="#524511"`);
    expect(both).toContain(`fill="#907311"`);
    expect(both).toContain(`fill="#4A8200"`);
  });
});

describe("装饰：道路", () => {
  it("连线与圆按装饰的道路颜色与亮度（再乘官方环境光 0x808080）", () => {
    const s = sceneOf(SEASON);
    const line = s.primitives.find((p): p is LinePrimitive => p.key.startsWith("official-road/"))!;
    expect(line.stroke.color).toBe(0x564c25);
    expect((byKey(s, "r1/body") as CirclePrimitive).fill).toBe(0x564c25);
  });

  it("没有地面装饰时仍是官方道路色", () => {
    const s = sceneOf({ objects: SEASON.objects, wall: SEASON.wall! });
    expect((byKey(s, "r1/body") as CirclePrimitive).fill).toBe(OFFICIAL_ROAD_COLOR);
  });
});

describe("装饰：对象", () => {
  it("控制器下面垫一张赛季贴图：以格子为中心，尺寸与透明度按 active；控制器自身的部件都保留", () => {
    const s = sceneOf(SEASON);
    const plain = sceneOf(undefined);
    const deco = byKey(s, "c/decoration/0/0") as ImagePrimitive;
    expect(deco).toMatchObject({
      kind: "image",
      objectId: "c",
      url: "/season-static/season11/renderer/controller.svg",
      x: 25.5 - 1.2,
      y: 25.5 - 1.2,
      width: 2.4,
      height: 2.4,
      alpha: 1,
    });
    const own = (scene: Scene) => scene.primitives.filter((p) => p.objectId === "c" && !p.key.startsWith("c/decoration/"));
    expect(own(s)).toEqual(own(plain));
    // 画在控制器所有部件之下
    const keys = s.primitives.map((p) => p.key);
    expect(Math.min(...own(s).map((p) => keys.indexOf(p.key)))).toBeGreaterThan(keys.indexOf("c/decoration/0/0"));
    expect(deco.layer).toBeLessThanOrEqual(Math.min(...own(s).map((p) => p.layer)));
  });

  it("指定了玩家的对象装饰只作用于该玩家的对象", () => {
    const mine: RoomDecorations = { objects: [{ ...SEASON.objects[0]!, user: "foe1" }] };
    expect(byKey(sceneOf(mine), "c/decoration/0/0")).toBeUndefined();
    const theirs = sceneOf(mine, view, { c: { ...objects.c, user: "foe1" } });
    expect(byKey(theirs, "c/decoration/0/0")).toBeDefined();
  });

  it("贴图带染色时按颜色与亮度染色；透明度超出 0–1 时截到范围内", () => {
    const tinted: RoomDecorations = {
      objects: [{ objectType: "controller", width: 100, height: 100, graphics: [{ url: "/season-static/a.svg", alpha: 2, color: "#AB8812", brightness: 0.3 }] }],
    };
    expect(byKey(sceneOf(tinted), "c/decoration/0/0")).toMatchObject({ tint: 0x332905, alpha: 1 });
  });
});

describe("装饰开关与回退", () => {
  const strip = (s: Scene): readonly Primitive[] => s.primitives;

  it("关掉“装饰”时与没有装饰完全一致", () => {
    const off = sceneOf(SEASON, { ...view, display: { ...DEFAULT_ROOM_DISPLAY, decorations: false } });
    expect(strip(off)).toEqual(strip(sceneOf(undefined)));
  });

  it("没有装饰（空列表、取不到）时与不传装饰完全一致", () => {
    expect(strip(sceneOf(NO_DECORATIONS))).toEqual(strip(sceneOf(undefined)));
  });
});
