#!/usr/bin/env node
/**
 * 地图地块模块的**真实链路**测试：真的调生图模型生成几个地块，然后走完规整、
 * 铺图、导出，产物落在真实数据目录里，方便直接用界面或文件管理器验收。
 *
 * 消耗：每个变体一次 Seedream 生图（默认只做 3 类 × 1 张 = 3 次），
 * 其余（模板 / 规整 / 铺图 / 导出）全部是本地计算，免费。
 *
 *   node scripts/e2e-tile-live.mjs [项目名] [key1,key2,…]
 *
 * 例：node scripts/e2e-tile-live.mjs 真机验证 grass,tree,rock
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const projectName = process.argv[2] ?? "地图地块实测";
const keys = (process.argv[3] ?? "grass,tree,rock").split(",").map((s) => s.trim()).filter((s) => s !== "");

const { configPath, dataRoot } = await import("../lib/config.js");
const tilegen = await import("../lib/tilegen.js");
const tilemedia = await import("../lib/tilemedia.js");
const tilegeom = await import("../lib/tilegeom.js");

const config = JSON.parse(await readFile(configPath(), "utf8"));
if (typeof config.arkApiKey !== "string" || config.arkApiKey.trim() === "") {
  console.error("尚未配置火山方舟 API Key，无法做真实生图测试。");
  process.exit(1);
}
console.log(`数据目录：${dataRoot()}`);
console.log(`生图模型：${config.arkModel}`);
console.log(`本次要生成：${keys.join("、")}（每个变体一次调用）`);

const step = (n, text) => console.log(`\n[${n}] ${text}`);

// ── ① 建项目，只留下要测的几类 ────────────────────────────────────────────
step(1, "建项目并收敛地块清单");
const project = await tilegen.createTileProject(projectName);
console.log(`  projectId = ${project.id}`);
await tilegen.patchTileProject(project.id, (fresh) => {
  fresh.items = fresh.items
    .filter((item) => keys.includes(item.key))
    .map((item) => ({ ...item, variantCount: 1 }));
  fresh.map = { ...fresh.map, rows: 6, cols: 6, seed: 20261004 };
});
const kept = await tilegen.readTileProject(project.id);
console.log(`  保留 ${kept.items.length} 类：${kept.items.map((i) => `${i.key}(${i.kind})`).join("、")}`);

// ── ② 模板（免费）────────────────────────────────────────────────────────
step(2, "生成模板（本地渲染，免费）");
await tilegen.runTemplateStage(project.id);
await waitIdle(project.id);
const tpl = join(tilegen.tileProjectDir(project.id), "template", "cell.png");
const tplBitmap = await tilemedia.decodeFile(tpl);
const tplBounds = await measureForeground(tplBitmap);
console.log(`  template/cell.png ${tplBitmap.width}×${tplBitmap.height}`);
console.log(`  菱形 ${tplBounds.w}×${tplBounds.h}，比例 ${(tplBounds.w / tplBounds.h).toFixed(4)}`);
if (Math.abs(tplBounds.w / tplBounds.h - 2) > 0.01) {
  console.error("  ✗ 模板比例不对，后面全不可信");
  process.exit(1);
}

// ── ③ 真实生成（★这一步花钱）─────────────────────────────────────────────
step(3, "调生图模型生成地块（★真实计费）");
const t0 = Date.now();
await tilegen.runGenerateStage(project.id);
await waitIdle(project.id, 600000);
console.log(`  用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);

const after = await tilegen.readTileProject(project.id);
let failures = 0;
for (const item of after.items) {
  for (const variant of item.variants) {
    if (variant.error !== undefined) {
      failures++;
      console.log(`  ✗ ${item.key} v${variant.index + 1}：${variant.error}`);
      continue;
    }
    const report = variant.report ?? {};
    const ratio = typeof report.ratioMeasured === "number" ? report.ratioMeasured.toFixed(4) : "—";
    const flag = report.mode === "measured" && Math.abs((report.ratioMeasured ?? 0) - 2) <= 0.02 ? "✓" : "?";
    console.log(`  ${flag} ${item.key} v${variant.index + 1}：几何 ${report.mode}，比例 ${ratio}` +
      (report.fallbackReason === undefined ? "" : `（${report.fallbackReason}）`));
    // 规整产物必须真的是标准菱形。**只对地形有意义**：
    // 装饰（树/巨石）走的是「锚点摆放」，它的形状本来就不是菱形，
    // 拿菱形去量它只会得到一堆看着吓人的数字。
    const cell = await tilemedia.decodeFile(tilegen.tileAssetPath(project.id, variant.cell));
    if (item.kind === "terrain") {
      const holes = countHoles(cell, after.settings);
      const outside = countOutside(cell, after.settings);
      console.log(`     产出 ${cell.width}×${cell.height}，缺口 ${holes}，越界 ${outside}`);
    } else {
      const bounds = await measureForeground(cell);
      const anchor = tilegeom.decorAnchorY(after.settings);
      console.log(`     产出 ${cell.width}×${cell.height}（${item.kind}，按锚点摆放）` +
        `，内容 ${bounds.w}×${bounds.h}，底边 ${bounds.bottom + 1}（锚点 ${anchor}）`);
    }
  }
}
if (failures > 0) console.log(`  注意：有 ${failures} 个变体生成失败（详情见上面的报错与项目日志）`);

// ── ④ 铺图（免费）────────────────────────────────────────────────────────
step(4, "铺成 6×6 地图（本地计算，免费）");
await tilegen.runMapStage(project.id, { rows: 6, cols: 6, seed: 20261004, fill: "grass", decorDensity: 0.12 });
await waitIdle(project.id);
const mapped = await tilegen.readTileProject(project.id);
if (mapped.map.png === undefined) {
  console.error("  ✗ 没有产出地图");
  process.exit(1);
}
const mapFile = tilegen.tileAssetPath(project.id, mapped.map.png);
const mapBitmap = await tilemedia.decodeFile(mapFile);
console.log(`  map/map.png ${mapBitmap.width}×${mapBitmap.height}`);

// 可复现性：同种子重铺必须逐像素一致
const once = await readFile(mapFile);
await tilegen.runMapStage(project.id, { rows: 6, cols: 6, seed: 20261004, fill: "grass", decorDensity: 0.12 });
await waitIdle(project.id);
const twice = await readFile(mapFile);
console.log(`  同种子重铺逐像素一致：${once.equals(twice) ? "✓" : "✗"}`);

// ── ⑤ 导出（免费）────────────────────────────────────────────────────────
step(5, "导出（本地计算，免费）");
await tilegen.runExportStage(project.id);
await waitIdle(project.id);
const exported = join(tilegen.tileProjectDir(project.id), "export");
for (const name of ["map.png", "map.json"]) {
  console.log(`  export/${name} ${existsSync(join(exported, name)) ? "✓" : "✗"}`);
}
console.log(`  export/tiles/ ${existsSync(join(exported, "tiles")) ? "✓" : "✗"}`);

// ── 方便肉眼验收：把地图与地块拷到项目根旁边 ──────────────────────────────
step(6, "验收提示");
const preview = join(exported, "preview.png");
const big = tilegeom.upscale(mapBitmap, 2);
await writeFile(preview, tilemedia.encodeBitmap(big));
console.log(`  地图预览（放大 2 倍）：${preview}`);
console.log(`  项目目录：${tilegen.tileProjectDir(project.id)}`);
console.log(`  界面深链接：/?dsh-gmm=1&module=tile&job=${project.id}`);
console.log("\n完成。");

async function waitIdle(id, timeoutMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!tilegen.tileBusy(id)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.warn("  等待超时，任务可能还在跑");
  return false;
}

async function measureForeground(bitmap) {
  let left = bitmap.width;
  let top = bitmap.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.rgba[(y * bitmap.width + x) * 4 + 3] < 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { left, top, right, bottom, w: right - left + 1, h: bottom - top + 1 };
}

function countHoles(bitmap, settings) {
  let holes = 0;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const d = tilegeom.diamondDistance(settings, x, y);
      if (d <= 0.9 && bitmap.rgba[(y * bitmap.width + x) * 4 + 3] < 40) holes++;
    }
  }
  return holes;
}

function countOutside(bitmap, settings) {
  let outside = 0;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const d = tilegeom.diamondDistance(settings, x, y);
      if (d > 1.12 && bitmap.rgba[(y * bitmap.width + x) * 4 + 3] > 8) outside++;
    }
  }
  return outside;
}
