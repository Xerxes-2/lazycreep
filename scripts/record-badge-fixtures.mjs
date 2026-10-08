/**
 * 录制徽章生成器的对照输出（#43）：用官方后端的原版 JS 生成器（screeps/backend-local 的
 * `lib/game/api/badge.js`，ISC）在一组已知徽章上实际运行，把得到的 SVG 写成测试 fixture，
 * 供 web/src/badge/badge-svg.test.ts 与我们的 TS 移植逐字对照。
 *
 *   git clone --depth 1 https://github.com/screeps/backend-local <dir>
 *   node scripts/record-badge-fixtures.mjs <dir>
 *
 * 原版只依赖 lodash 的 isString / isNumber；这里在 require 时换成等价的两个函数，不改动原版代码。
 * 输出：web/src/badge/official-badges.fixture.json（含 backend-local 的 commit）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { join, resolve } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("用法：node scripts/record-badge-fixtures.mjs <backend-local 的克隆目录>");
  process.exit(1);
}

const lodash = { isString: (v) => typeof v === "string", isNumber: (v) => typeof v === "number" };
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "lodash" ? "lodash-shim" : resolveFilename.call(this, request, ...rest);
};
Module._cache["lodash-shim"] = { id: "lodash-shim", filename: "lodash-shim", loaded: true, exports: lodash };

const { getBadgeSvg } = createRequire(import.meta.url)(resolve(dir, "lib/game/api/badge.js"));
const commit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/** Invader 的自定义徽章（录自 fixtures/season/room.shardSeason.W13S28.json 的 users["2"]） */
const room = JSON.parse(readFileSync("fixtures/season/room.shardSeason.W13S28.json", "utf8"));
const invader = room.frames.map((f) => f.data.users?.["2"]?.badge).find(Boolean);
if (!invader) throw new Error("录制里没有 Invader 的徽章");

const colors = { color1: "#ba0e09", color2: "#ffbf00", color3: "#1b6ae0" };
const cases = [];
for (let type = 1; type <= 24; type++) {
  for (const param of [-100, -68, 0, 37, 100]) cases.push({ badge: { type, ...colors, param, flip: false } });
  for (const param of [-100, 0, 100]) cases.push({ badge: { type, ...colors, param, flip: true } });
}
// 数字调色板（历史格式）：四档各取首尾与中间
for (const [c1, c2, c3] of [[0, 19, 20], [39, 40, 59], [60, 79, 10], [5, 45, 77]]) {
  cases.push({ badge: { type: 7, color1: c1, color2: c2, color3: c3, param: 12, flip: false } });
}
// 混用：字符串与数字颜色
cases.push({ badge: { type: 14, color1: "#000000", color2: 33, color3: "#ffffff", param: -40, flip: true } });
// 自定义路径对象（Invader）；flip 对自定义路径不生效
cases.push({ badge: invader });
cases.push({ badge: { ...invader, flip: true } });
// 带黑边（badge-svg 的 border=1）
cases.push({ badge: { type: 5, ...colors, param: -68, flip: false }, border: true });
cases.push({ badge: invader, border: true });

const out = cases.map(({ badge, border }) => ({ badge, ...(border ? { border } : {}), svg: getBadgeSvg(badge, border) }));
const file = join("web/src/badge/official-badges.fixture.json");
writeFileSync(
  file,
  JSON.stringify(
    {
      source: `https://github.com/screeps/backend-local/blob/${commit}/lib/game/api/badge.js`,
      generatedBy: "scripts/record-badge-fixtures.mjs",
      cases: out,
    },
    null,
    1,
  ) + "\n",
);
console.log(`写入 ${file}：${out.length} 个徽章`);
