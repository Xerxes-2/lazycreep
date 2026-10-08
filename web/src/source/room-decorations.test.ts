/**
 * #61：`game/room-decorations` 的解析（录制的赛季房间 + 构造的边界情况）。
 */
import { describe, expect, it } from "vitest";
import { FixtureSource, fixtureBundle } from "./fixture-source.ts";
import { NO_DECORATIONS, decodeRoomDecorations, roomDecorationsFromWire } from "./room-decorations.ts";

const bundle = fixtureBundle(
  Object.values(import.meta.glob<unknown>("../../../fixtures/season/*.json", { eager: true, import: "default" })),
);

const S3 = "https://s3.amazonaws.com/static.screeps.com/seasons/season11";

describe("房间装饰的解析", () => {
  it("赛季房间：墙、地面、控制器三条，图片换成同源路径", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    const decorations = await source.getRoomDecorations("shardSeason", "W13S28");
    expect(decorations.wall).toEqual({
      foregroundUrl: "/season-static/season11/decorations/wall.png",
      foregroundColor: "#CFAD01",
      foregroundAlpha: 0.15,
      foregroundBrightness: 1,
      backgroundColor: "#AB8812",
      backgroundBrightness: 0.3,
      strokeColor: "#A38A23",
      strokeBrightness: 0.5,
      strokeLighting: 0.1,
      strokeWidth: 10,
    });
    expect(decorations.floor).toEqual({
      floorForegroundUrl: "/season-static/season11/decorations/floor.png",
      tileScale: 2,
      floorBackgroundColor: "#CDA418",
      floorBackgroundBrightness: 0.7,
      floorForegroundColor: "#F3C300",
      floorForegroundAlpha: 0.1,
      floorForegroundBrightness: 1,
      swampColor: "#4A8200",
      swampStrokeColor: "#513F02",
      swampStrokeWidth: 30,
      roadsColor: "#C2B271",
      roadsBrightness: 0.8,
    });
    expect(decorations.objects).toEqual([
      {
        objectType: "controller",
        width: 240,
        height: 240,
        graphics: [{ url: "/season-static/season11/renderer/controller.svg", alpha: 1 }],
      },
    ]);
  });

  it("没录到的房间没有装饰", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    expect(await source.getRoomDecorations("shardSeason", "W1N1")).toEqual(NO_DECORATIONS);
  });

  it("landscape 同时给出墙与地面", () => {
    const active = {
      foregroundColor: "#111111", foregroundAlpha: 1, foregroundBrightness: 1, backgroundColor: "#222222", backgroundBrightness: 1,
      strokeColor: "#333333", strokeBrightness: 1, strokeLighting: 0.5, strokeWidth: 20,
      floorBackgroundColor: "#444444", floorBackgroundBrightness: 1, floorForegroundColor: "#555555", floorForegroundAlpha: 0.5,
      floorForegroundBrightness: 1, swampColor: "#666666", swampStrokeColor: "#777777", swampStrokeWidth: 10, roadsColor: "#888888", roadsBrightness: 1,
    };
    const decorations = roomDecorationsFromWire({
      ok: 1,
      decorations: [
        { active, user: "u1", decoration: { type: "landscape", foregroundUrl: `${S3}/a/wall.png`, floorForegroundUrl: `${S3}/a/floor.png` } },
      ],
    });
    expect(decorations.wall?.foregroundUrl).toBe("/season-static/season11/a/wall.png");
    expect(decorations.floor?.floorForegroundUrl).toBe("/season-static/season11/a/floor.png");
    expect(decorations.floor?.tileScale).toBeUndefined();
  });

  it("认不出的图片地址、缺字段的条目丢弃（用默认外观）", () => {
    const decorations = roomDecorationsFromWire({
      decorations: [
        { active: { foregroundColor: "#111111" }, decoration: { type: "wallLandscape", foregroundUrl: `${S3}/wall.png` } },
        { active: { width: 100, height: 100 }, decoration: { type: "object", objectType: "controller", graphics: [{ url: "https://evil.example/c.svg" }] } },
        "junk",
      ],
    });
    expect(decorations).toEqual(NO_DECORATIONS);
    expect(roomDecorationsFromWire({ ok: 1, decorations: [] })).toEqual(NO_DECORATIONS);
    expect(roomDecorationsFromWire(null)).toEqual(NO_DECORATIONS);
  });

  it("对象装饰带玩家与染色", () => {
    const decorations = roomDecorationsFromWire({
      decorations: [
        {
          user: "u1",
          active: { width: 200, height: 100, tint: "#ff0000", brightness: 0.5, a: 0.3 },
          decoration: { type: "object", objectType: "spawn", graphics: [{ url: `${S3}/s.png`, alpha: "a", color: "tint" }] },
        },
      ],
    });
    expect(decorations.objects).toEqual([
      { objectType: "spawn", user: "u1", width: 200, height: 100, graphics: [{ url: "/season-static/season11/s.png", alpha: 0.3, color: "#ff0000", brightness: 0.5 }] },
    ]);
  });

  it("解析结果原样存进存储后能读回；同源路径以外的地址读回失败", async () => {
    const source = new FixtureSource(bundle, { speed: Infinity });
    const decorations = await source.getRoomDecorations("shardSeason", "W13S28");
    expect(decodeRoomDecorations(JSON.parse(JSON.stringify(decorations)))).toEqual(decorations);
    expect(decodeRoomDecorations({ objects: [] })).toEqual(NO_DECORATIONS);
    const tampered = { ...decorations, wall: { ...decorations.wall, foregroundUrl: "https://evil.example/w.png" } };
    expect(decodeRoomDecorations(tampered)).toBeUndefined();
    expect(decodeRoomDecorations({ ...decorations, wall: { ...decorations.wall, foregroundUrl: "/season-static/../x.png" } })).toBeUndefined();
  });
});
