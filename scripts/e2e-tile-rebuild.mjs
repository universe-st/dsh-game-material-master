#!/usr/bin/env node
/**
 * 在**当前代码**上重建一个干净的地图地块项目，用来做真机验证。
 *
 * 与 `e2e-tile-live.mjs` 的区别：**不调任何生图接口、不花钱**——
 * 直接复用已有项目里的 raw 产物走规整 → 铺图 → 导出。
 * 用途：改了几何 / 路径 / 界面之后，快速造一个「内容真实、数据干净」的项目，
 * 然后在浏览器里看界面。
 *
 *   node scripts/e2e-tile-rebuild.mjs <源项目id> [新项目名]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sourceId = process.argv[2] ?? "tmutsqtg034a129";
const name = process.argv[3] ?? "真机验证（当前代码）";

const G = await import("../lib/tilegen.js");
const GEOM = await import("../lib/tilegeom.js");
const MEDIA = await import("../lib/tilemedia.js");

const source = await G.readTileProject(sourceId);
if (source === undefined) {
  console.error(`源项目不存在：${sourceId}`);
  process.exit(1);
}
console.log(`源项目：${source.name}（${sourceId}），模型配置无关，本次不调生图接口`);

const project = await G.createTileProject(name);
console.log(`新项目：${project.id}`);

// ── 只留下源项目里真的有产物的那几类 ──────────────────────────────────────
const usable = source.items.filter((item) => item.variants.some((v) => v.raw !== undefined || v.cell !== undefined));
console.log(`可复用：${usable.map((i) => `${i.key}(${i.kind})`).join("、")}`);
await G.patchTileProject(project.id, (fresh) => {
  fresh.items = fresh.items.filter((item) => usable.some((u) => u.key === item.key)).map((item) => ({ ...item, variantCount: 1 }));
  fresh.map = { ...fresh.map, rows: 8, cols: 8, seed: 20261004 };
});
await G.runTemplateStage(project.id);
await waitIdle(project.id);

// ── 用源项目的 raw 重新规整（几何按当前代码算）─────────────────────────────
for (const item of usable) {
  const variant = item.variants.find((v) => v.raw !== undefined || v.cell !== undefined);
  const sourceRel = variant.raw ?? variant.cell;
  const bytes = await readFile(G.tileAssetPath(sourceId, sourceRel));
  const ext = MEDIA.sniffImageExt(bytes);
  const rawRel = `raw/${item.key}.v1.${ext}`;
  await writeFile(G.tileAssetPath(project.id, rawRel), bytes);

  const decoded = await MEDIA.decodeFile(G.tileAssetPath(project.id, rawRel));
  let cellRel;
  let report;
  if (item.kind === "decor") {
    const out = GEOM.regularizeDecorSprite(decoded, source.settings);
    cellRel = `decor/${item.key}.v1.png`;
    await writeFile(G.tileAssetPath(project.id, cellRel), MEDIA.encodeBitmap(out.bitmap));
    report = { mode: "sprite", scale: [out.report.scale, out.report.scale] };
    console.log(`  ${item.key}: 装饰锚点 y=${out.report.anchorY}`);
  } else {
    const measure = GEOM.measureGroundDiamond(decoded);
    const reason = GEOM.measurementLooksSane(decoded, measure);
    const out = reason === undefined
      ? GEOM.regularizeToCell(decoded, source.settings, measure, "measured")
      : GEOM.regularizeToCell(decoded, source.settings,
          { centerX: decoded.width / 2, centerY: decoded.height / 2, halfWidth: decoded.width * 0.46, halfHeight: decoded.width * 0.23 },
          "template", reason);
    cellRel = `cell/${item.key}.v1.png`;
    await writeFile(G.tileAssetPath(project.id, cellRel), MEDIA.encodeBitmap(out.bitmap));
    report = out.report;
    console.log(`  ${item.key}: 几何 ${out.report.mode}，比例 ${(out.report.ratioMeasured ?? measure.ratio).toFixed(4)}`);
  }
  await G.patchTileProject(project.id, (fresh) => {
    const target = fresh.items.find((i) => i.key === item.key);
    target.variants[0] = { index: 0, raw: rawRel, cell: cellRel, report, approved: true };
  });
}

// ── 铺图 + 导出（都免费）──────────────────────────────────────────────────
await G.runMapStage(project.id, { rows: 8, cols: 8, seed: 20261004, fill: "grass", decorDensity: 0.10 });
await waitIdle(project.id);
await G.runExportStage(project.id);
await waitIdle(project.id);

// ── 自检：相对路径必须是正斜杠 ────────────────────────────────────────────
const final = await G.readTileProject(project.id);
const relatives = [];
for (const item of final.items) {
  for (const v of item.variants) {
    if (typeof v.cell === "string") relatives.push(v.cell);
    if (typeof v.raw === "string") relatives.push(v.raw);
  }
}
if (typeof final.map.png === "string") relatives.push(final.map.png);
const bad = relatives.filter((r) => r.includes("\\"));
console.log(`\n相对路径 ${relatives.length} 条，含反斜杠 ${bad.length} 条${bad.length ? "：" + bad.join("、") : " ✓"}`);
console.log(`地图：${final.map.png} ${final.map.rows}×${final.map.cols} seed=${final.map.seed}`);
console.log(`\n界面深链接：/?dsh-gmm=1&module=tile&job=${project.id}`);
console.log(`项目目录：${G.tileProjectDir(project.id)}`);

async function waitIdle(id, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!G.tileBusy(id)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
void join;
