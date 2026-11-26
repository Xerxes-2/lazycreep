import { describe, expect, it } from "vitest";
import { encodePixelImage, type PixelImage } from "../scene/pixel-image.ts";
import type { RoomMapUpdate } from "../source/source.ts";
import { createUnitsRaster, UNITS_RASTER_CACHE_SIZE } from "./units-raster.ts";

const coloring = { ownerColor: () => 0x00ff00, knownUsers: {} };

function counted(part: "ground" | "top") {
  const encoded: PixelImage[] = [];
  const raster = createUnitsRaster(part, (image) => {
    encoded.push(image);
    return encodePixelImage(image);
  });
  return { raster, encoded };
}

describe("单位像素图的缓存", () => {
  it("新的一帧但路与墙没变（私服每个 Tick 都是新对象）：不重新编码，给出同一个 URL", () => {
    const { raster, encoded } = counted("ground");
    const a = raster({ w: [[1, 1], [2, 2]], r: [[3, 3]], s: [[9, 9]] } satisfies RoomMapUpdate, coloring);
    const b = raster({ r: [[3, 3]], w: [[1, 1], [2, 2]], s: [[8, 8]] } satisfies RoomMapUpdate, coloring);
    expect(encoded).toHaveLength(1);
    expect(b).toBe(a);
  });

  it("内容变了才重新编码", () => {
    const { raster, encoded } = counted("ground");
    const a = raster({ w: [[1, 1]] }, coloring);
    const b = raster({ w: [[1, 2]] }, coloring);
    expect(encoded).toHaveLength(2);
    expect(b).not.toBe(a);
  });

  it("其余的点（单位）同样按内容命中：没动的房间不重新编码", () => {
    const { raster, encoded } = counted("top");
    raster({ s: [[4, 4]], "5a0000000000000000000003": [[5, 5]] }, coloring);
    raster({ "5a0000000000000000000003": [[5, 5]], s: [[4, 4]] }, coloring);
    expect(encoded).toHaveLength(1);
  });

  it("缓存有上限：超出后最久没用的被挤掉，再来要重新编码；常用的留着", () => {
    const { raster, encoded } = counted("ground");
    const frameAt = (i: number): RoomMapUpdate => ({ w: [[i % 50, Math.floor(i / 50)]] });
    raster(frameAt(0), coloring);
    for (let i = 1; i <= UNITS_RASTER_CACHE_SIZE; i++) {
      raster(frameAt(i), coloring);
      // 第 0 张一直在用
      raster(frameAt(0), coloring);
    }
    expect(encoded).toHaveLength(UNITS_RASTER_CACHE_SIZE + 1);
    raster(frameAt(0), coloring);
    expect(encoded).toHaveLength(UNITS_RASTER_CACHE_SIZE + 1);
    // 第 1 张最久没用，已被挤掉
    raster(frameAt(1), coloring);
    expect(encoded).toHaveLength(UNITS_RASTER_CACHE_SIZE + 2);
  });
});
