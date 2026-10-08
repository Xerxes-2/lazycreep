// @vitest-environment node
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFICIAL_SVG_NAMES, officialArtUrl } from "./official-art.ts";

const dir = fileURLToPath(new URL("../../public/official-art/", import.meta.url));

describe("官方美术清单（#42）", () => {
  it("名单与 public/official-art 下的 SVG 一一对应", () => {
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4))
      .sort();
    expect([...OFFICIAL_SVG_NAMES].sort()).toEqual(onDisk);
  });

  it("URL 同源、指向站点下的 official-art 目录", () => {
    expect(officialArtUrl("storage")).toBe("/official-art/storage.svg");
  });
});
