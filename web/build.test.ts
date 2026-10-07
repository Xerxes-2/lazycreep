// @vitest-environment node
/**
 * 生产构建产物检查：录制回放只在开发时可用，`fixtures/` 不得进入 dist 与 PWA 预缓存。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtureDir = join(here, "../fixtures/season");
/** 录制文件名去掉 .json，例如 `room.shardSeason.W13S28` */
const fixtureNames = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => basename(f, ".json"));

/** 只在录制数据里出现的字符串：录制的 creep id 与录制者的用户 id */
const FIXTURE_MARKERS = ["6ac66da2ff77778f44a644e4", "6253e4a3a3d173248b5a2691"];

/** 由某个录制文件产生的产物：`<name>.json` 本身，或 `<name>-<hash>.js` 之类的 chunk */
function fromFixture(path: string): boolean {
  const file = basename(path);
  return fixtureNames.some((name) => file.startsWith(`${name}-`) || file.startsWith(`${name}.`));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let outDir: string;
let files: string[];

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "screeps-web-dist-"));
  // vitest 把 NODE_ENV 设成 test，那样 Vite 会按开发模式替换 import.meta.env.DEV
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({
      root: here,
      configFile: join(here, "vite.config.ts"),
      mode: "production",
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
  files = walk(outDir).map((path) => relative(outDir, path));
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("生产构建不包含录制回放", () => {
  it("确实产出了应用与 service worker", () => {
    expect(files).toContain("index.html");
    expect(files).toContain("sw.js");
  });

  it("dist 里没有任何 fixture 文件或由它们生成的 chunk", () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
    expect(files.filter(fromFixture)).toEqual([]);
    for (const file of files) {
      const text = readFileSync(join(outDir, file), "latin1");
      for (const marker of FIXTURE_MARKERS) expect(text.includes(marker), `${file} 含有 ${marker}`).toBe(false);
    }
  });

  it("PWA 预缓存清单不引用 fixture", () => {
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    const precached = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
    expect(precached).toContain("index.html");
    expect(precached.filter(fromFixture)).toEqual([]);
  });
});
