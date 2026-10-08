import { describe, expect, it } from "vitest";
import { mapTileRootFromFeatures, mapTileUrls } from "./map-tiles.ts";
import { versionFromWire } from "./wire.ts";

/** 赛季服 `GET /season/api/version` 的 serverData.features（2026-10-08，节选） */
const SEASON_FEATURES = [
  { name: "season11", version: 1, resourceTypeNames: { T: "thorium" } },
  { name: "map-url-replace", version: 1, mapUrl: "https://s3.amazonaws.com/static.screeps.com/seasons/season11/map/" },
  { name: "season-chronicle", version: 1 },
];

describe("地图瓦片根地址（版本信息的 map-url-replace）", () => {
  it("赛季服：换成 Gateway 的同源只读路径", () => {
    expect(mapTileRootFromFeatures(SEASON_FEATURES)).toBe("/season-static/season11/map");
  });

  it("静态资源域名的写法也认", () => {
    const features = [{ name: "map-url-replace", mapUrl: "https://static.screeps.com/seasons/season12/map/" }];
    expect(mapTileRootFromFeatures(features)).toBe("/season-static/season12/map");
  });

  it("没有覆盖（MMO）、形状不对、认不出的主机或可疑路径时为 null（用 Server 的默认根地址）", () => {
    expect(mapTileRootFromFeatures(undefined)).toBeNull();
    expect(mapTileRootFromFeatures([{ name: "auth", version: 1 }])).toBeNull();
    expect(mapTileRootFromFeatures({ name: "map-url-replace" })).toBeNull();
    expect(mapTileRootFromFeatures([{ name: "map-url-replace", mapUrl: 42 }])).toBeNull();
    expect(mapTileRootFromFeatures([{ name: "map-url-replace", mapUrl: "https://evil.example/seasons/x/map/" }])).toBeNull();
    expect(mapTileRootFromFeatures([{ name: "map-url-replace", mapUrl: "https://static.screeps.com/seasons/../map/" }])).toBeNull();
  });

  it("版本信息带上瓦片根地址", () => {
    const wire = { ok: 1, package: 1, protocol: 14, serverData: { historyChunkSize: 100, features: SEASON_FEATURES } };
    expect(versionFromWire(wire).mapTileRoot).toBe("/season-static/season11/map");
    const mmo = { ok: 1, package: 1, protocol: 14, serverData: { historyChunkSize: 100 } };
    expect(versionFromWire(mmo).mapTileRoot).toBeNull();
  });

  it("单房间、zoom2 块、zoom1 扇区三种瓦片都在同一根地址下", () => {
    const tiles = mapTileUrls("/season-static/season11/map", "shardSeason");
    expect(tiles.room("W18S26")).toBe("/season-static/season11/map/shardSeason/W18S26.png");
    expect(tiles.block("W16S28")).toBe("/season-static/season11/map/shardSeason/zoom2/W16S28.png");
    expect(tiles.sector("W59N59")).toBe("/season-static/season11/map/shardSeason/zoom1/W59N59.png");
  });
});
