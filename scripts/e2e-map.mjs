#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· **真实链路端到端**：不联网、不花钱，产物落在真实数据目录里，
 * 方便直接用界面或文件管理器验收。
 *
 *   node scripts/e2e-map.mjs [项目名]
 *
 * 与自检脚本的区别：自检用临时 DSH_HOME、跑完就删；这个脚本**故意留下产物**
 * （图集、预览图、导出的 PNG / JSON / Tiled 文件），并打印它们的绝对路径。
 *
 * 它演的是这样一条真实链路：
 *   合成一张 tileset → 导入 → 切分 → 把 47 个掩码按顺序配给「草地」族 →
 *   画一块草地 + 一小块别的族（看过渡）→ 出一张 2×2 建筑大小的装饰 →
 *   生成验收预览图 → 导出（PNG + JSON + Tiled）→ 打印路径。
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const projectName = process.argv[2] ?? "地图编辑器 端到端";

const { dataRoot } = await import("../lib/config.js");
const mapgen = await import("../lib/mapgen.js");
const maptiles = await import("../lib/maptiles.js");
const auto = await import("../lib/mapauto.js");
const { encodePng } = await import("../lib/png.js");

const step = (n, text) => console.log(`\n[${n}] ${text}`);

/** 合成一张能看出「哪块是哪块」的 tileset：每块一个可区分的颜色 + 一个角标。 */
function makeTilesetPng(tileSize, columns, rows) {
  const width = tileSize * columns;
  const height = tileSize * rows;
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < columns * rows; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const offset = ((row * tileSize + y) * width + column * tileSize + x) * 4;
        rgba[offset] = 40 + ((index * 37) % 200);
        rgba[offset + 1] = 60 + ((index * 71) % 180);
        rgba[offset + 2] = 30 + ((index * 113) % 200);
        rgba[offset + 3] = 255;
      }
    }
    // 左上角点一个白点：一眼能看出这格是哪块、有没有被切错
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const offset = ((row * tileSize + y) * width + column * tileSize + x) * 4;
        rgba[offset] = 255;
        rgba[offset + 1] = 255;
        rgba[offset + 2] = 255;
      }
    }
  }
  return encodePng(rgba, width, height);
}

console.log(`数据目录：${dataRoot()}`);
console.log(`生图调用：**0 次**（这个模块全本地，不花钱）`);

step(1, "建项目（正方形俯视 16×16）");
const project = await mapgen.createMapProject(projectName, { grid: { kind: "square", tileWidth: 16, tileHeight: 16, heightStep: 8 } });
const projectId = project.id;
console.log(`  projectId = ${projectId}`);
console.log(`  目录      = ${mapgen.mapProjectDir(projectId)}`);

step(2, "导入 tileset（本地合成 128×128，8×8 块）");
const png = makeTilesetPng(16, 8, 8);
const imported = await mapgen.importMapTileset(projectId, "合成图集", png.toString("base64"));
console.log(`  图集 ${imported.tileset.imageWidth}×${imported.tileset.imageHeight} → ${imported.tileset.tiles.length} 块`);
console.log(`  切分建议：${imported.suggestions.slice(0, 4).map((item) => item.label).join("；")}`);

step(3, "配地形族：草地 47 掩码 + 岩石单块");
const tilesetId = imported.tileset.id;
await mapgen.saveMapTileset(projectId, tilesetId, {
  tiles: imported.tileset.tiles.map((tile, index) => ({
    id: tile.id,
    familyId: index < auto.BLOB47_MASKS.length ? "grass" : index === auto.BLOB47_MASKS.length ? "rock" : undefined,
    mask: index < auto.BLOB47_MASKS.length ? auto.BLOB47_MASKS[index] : undefined,
    name: index < auto.BLOB47_MASKS.length ? `草地 ${index + 1}` : index === auto.BLOB47_MASKS.length ? "岩石" : tile.id
  }))
});
await mapgen.saveMapFamilies(projectId, [
  { id: "grass", name: "草地", autotile: "blob47", priority: 0, color: "#3f9b2f" },
  { id: "rock", name: "岩石", autotile: "single", priority: 1, color: "#888888" }
]);
const coverage = mapgen.familyCoverage(await mapgen.readMapProject(projectId));
console.log(`  覆盖率：${coverage.map((row) => `${row.name} ${row.assigned}/${row.expected}`).join("，")}`);

step(4, "画地图：24×24，草地铺底 + 一条岩石路 + 一个 2×2 小建筑");
const fresh = await mapgen.readMapProject(projectId);
const mapId = fresh.activeMapId;
await mapgen.saveMapDocStructure(projectId, mapId, { cols: 24, rows: 24 });
await mapgen.saveMapDocStructure(projectId, mapId, {
  addLayer: { kind: "object", name: "建筑" }
});
const grassRepresentative = auto.BLOB47_MASKS.indexOf(255) + 1;
const rockTile = auto.BLOB47_MASKS.length + 1;
await mapgen.applyMapOps(projectId, mapId, [
  { kind: "rect", layerId: "l0", r0: 0, c0: 0, r1: 23, c1: 23, tile: grassRepresentative, filled: true },
  { kind: "rect", layerId: "l0", r0: 2, c0: 4, r1: 20, c1: 7, tile: rockTile, filled: true },
  { kind: "paint", layerId: "l1", cells: [{ r: 10, c: 12, tile: rockTile }] }
]);
const plan = await mapgen.mapPlan(projectId, mapId);
console.log(`  计划：${plan.chunks.reduce((sum, chunk) => sum + chunk.ops.length, 0)} 块贴图，${plan.chunks.length} 个 chunk`);
console.log(`  包围盒：${plan.bounds.originX},${plan.bounds.originY} ${plan.bounds.width}×${plan.bounds.height}`);
console.log(`  自动过渡回退：${plan.fallbacks.length === 0 ? "无（掩码齐全）" : JSON.stringify(plan.fallbacks)}`);

step(5, "生成验收预览图（切片 contact sheet / 掩码覆盖矩阵 / 地图渲染图）");
await mapgen.runPreviewStage(projectId, { mapId });
for (let i = 0; i < 600 && mapgen.mapBusy(projectId); i++) await new Promise((resolve) => setTimeout(resolve, 100));
const previewDir = join(mapgen.mapProjectDir(projectId), "preview");
console.log(`  ${existsSync(previewDir) ? (await readdir(previewDir)).join("、") : "（没有产出，看下面第 6 步的日志）"}`);

step(6, "导出（合并 PNG + 分层 PNG + map.json + Tiled .tmj/.tsj）");
const started = await mapgen.runExportStage(projectId, { mapId, scale: 1 });
if (started.started !== true) console.log(`  ⚠️ 导出没启动：${started.reason}`);
for (let i = 0; i < 600 && mapgen.mapBusy(projectId); i++) await new Promise((resolve) => setTimeout(resolve, 100));
const project2 = await mapgen.readMapProject(projectId);
const doc = await mapgen.readMapDoc(projectId, mapId);
const exportDir = join(mapgen.mapProjectDir(projectId), "export", doc.name.replace(/[^\p{L}\p{N}_-]+/gu, "_"));
console.log(`  导出目录：${exportDir}`);
console.log(`  产物：${existsSync(exportDir) ? (await readdir(exportDir)).join("、") : "（没有产出）"}`);
console.log(`  阶段状态：${JSON.stringify(project2.stages.export)}`);
console.log(`  日志尾部：${project2.logs.slice(-3).map((entry) => entry.message).join(" | ")}`);

console.log(`\n验收建议：`);
console.log(`  · 用「在访达中打开项目目录」看 ${mapgen.mapProjectDir(projectId)}`);
console.log(`  · preview/coverage.png 是掩码覆盖矩阵（缺块会画红框）`);
console.log(`  · export/<地图名>/map.png 是成品；map.tmj 可以直接用 Tiled 打开`);
console.log(`  · 界面上：侧栏「游戏素材大师」→ 地图编辑器 → 选这个项目`);
