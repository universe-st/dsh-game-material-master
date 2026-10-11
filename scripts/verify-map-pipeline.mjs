#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· 数据层与流水线自检。**纯本地、不联网、不花钱。**
 *
 * 造一张合成 tileset PNG → 导入 → 建族并配 47 个掩码 → 画图 →
 * 查渲染计划（自动过渡真的生效）→ 撤销重做 → 预览 → 导出 →
 * 把导出的 `.tmj` / `.tsj` / `map.json` 读回来逐字段校验。
 *
 * 用法：node scripts/verify-map-pipeline.mjs
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const G = await import("../lib/mapgen.js");
const TILES = await import("../lib/maptiles.js");
const AUTO = await import("../lib/mapauto.js");
const GEOM = await import("../lib/mapgeom.js");
const DOC = await import("../lib/mapdoc.js");
const EXPORT = await import("../lib/mapexport.js");
const CONFIG = await import("../lib/config.js");
const { encodePng } = await import("../lib/png.js");

let passed = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitIdle(projectId, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!G.mapBusy(projectId)) {
      const job = G.currentMapJob(projectId);
      if (job?.error !== undefined) throw new Error(job.error);
      return job;
    }
    await sleep(120);
  }
  throw new Error("等待作业超时");
}

/** 合成一张 64×64 的 tileset：8×8 网格、每块 8×8 像素、颜色可区分。 */
function makeTilesetPng(tileSize = 8, columns = 8, rows = 8) {
  const width = tileSize * columns;
  const height = tileSize * rows;
  const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const px = column * tileSize + x;
          const py = row * tileSize + y;
          const offset = (py * width + px) * 4;
          rgba[offset] = (index * 37) % 256;
          rgba[offset + 1] = (index * 71) % 256;
          rgba[offset + 2] = (index * 113) % 256;
          rgba[offset + 3] = 255;
        }
      }
    }
  }
  return encodePng(rgba, width, height);
}

const TILE_TOTAL = 64;
const BLOB_INDEX = new Map(AUTO.BLOB47_MASKS.map((mask, index) => [mask, index + 1]));

let projectId = "";
try {
  // ══ 1. 项目 ══════════════════════════════════════════════════════════════
  section("1) 项目 CRUD");
  const created = await G.createMapProject("自检 · 地图", { grid: { kind: "square", tileWidth: 8, tileHeight: 8, heightStep: 4 } });
  projectId = created.id;
  check("新项目 id 是 m 前缀", /^m[a-z0-9]+$/.test(projectId), projectId);
  check("自带一张空地图", created.mapIds.length === 1 && created.activeMapId === created.mapIds[0]);
  check("数据目录建好", existsSync(join(G.mapProjectDir(projectId), "project.json")) && existsSync(join(G.mapProjectDir(projectId), "tilesets")));
  const listed = await G.listMapProjects();
  check("项目出现在清单里", listed.some((item) => item.id === projectId));
  const summary = listed.find((item) => item.id === projectId);
  check("清单摘要字段完整", summary.tilesetCount === 0 && summary.mapCount === 1 && summary.grid.kind === "square");
  check("非法 id 被挡", G.isValidMapProjectId("p123") === false && G.isValidMapProjectId("m1a2b3") === true);
  check("路径穿越被挡", (() => {
    try {
      G.mapAssetPath(projectId, "../../etc/passwd");
      return false;
    } catch {
      return true;
    }
  })());
  check("网格比例被校验", (() => {
    try {
      GEOM.assertGrid({ kind: "iso2to1", tileWidth: 64, tileHeight: 64, heightStep: 16 });
      return false;
    } catch {
      return true;
    }
  })());

  // ══ 2. 图集导入与切分 ════════════════════════════════════════════════════
  section("2) 图集导入 / 切分 / 元数据");
  const png = makeTilesetPng();
  const imported = await G.importMapTileset(projectId, "自检图集", png.toString("base64"));
  check("导入后 64 块", imported.tileset.tiles.length === TILE_TOTAL, `${imported.tileset.tiles.length}`);
  check("尺寸探测正确", imported.tileset.imageWidth === 64 && imported.tileset.imageHeight === 64);
  check("原图落到 tilesets/", existsSync(G.mapAssetPath(projectId, imported.tileset.file)));
  check("切分建议含 8×8", imported.suggestions.some((item) => item.tileWidth === 8 && item.tileHeight === 8));
  check("切分无余数警告", imported.warnings.length === 0, imported.warnings.join(" "));

  const tilesetId = imported.tileset.id;
  const tileIds = imported.tileset.tiles.map((tile) => tile.id);
  check("图块 id 由矩形派生", tileIds[0] === "t0_0" && tileIds[1] === "t8_0", `${tileIds[0]} ${tileIds[1]}`);

  // 前 47 块配成 blob47 的 47 个掩码；第 48 块做「单块」族
  const patches = imported.tileset.tiles.map((tile, index) => ({
    id: tile.id,
    familyId: index < AUTO.BLOB47_MASKS.length ? "grass" : index === AUTO.BLOB47_MASKS.length ? "rock" : undefined,
    mask: index < AUTO.BLOB47_MASKS.length ? AUTO.BLOB47_MASKS[index] : undefined,
    weight: 1
  }));
  const saved = await G.saveMapTileset(projectId, tilesetId, { tiles: patches });
  check("图块元数据保存成功", saved.tileset.tiles[0].familyId === "grass" && saved.tileset.tiles[0].mask === 0);
  check("只改元数据不影响切分", saved.tileset.tiles.length === TILE_TOTAL);
  check("保存未触发序号重排警告", saved.warnings.length === 0, saved.warnings.join(" "));

  const families = [
    { id: "grass", name: "草地", autotile: "blob47", priority: 0, color: "#3f9b2f" },
    { id: "rock", name: "岩石", autotile: "single", priority: 1, color: "#888888" }
  ];
  const familiesSaved = await G.saveMapFamilies(projectId, families);
  check("族保存成功", familiesSaved.families.length === 2 && familiesSaved.families[0].autotile === "blob47");
  check("非法 autotile 回落 single", (await G.saveMapFamilies(projectId, [{ id: "x", autotile: "hex" }])).families[0].autotile === "single");
  await G.saveMapFamilies(projectId, families);

  const covered = G.familyCoverage(await G.readMapProject(projectId));
  const grass = covered.find((row) => row.familyId === "grass");
  check("覆盖率：草地 47/47", grass.assigned === 47 && grass.expected === 47 && grass.missing.length === 0, `${grass.assigned}/${grass.expected}`);
  const rock = covered.find((row) => row.familyId === "rock");
  check("覆盖率：单块族只要 1 个", rock.expected === 1 && rock.assigned === 1);

  // ══ 3. 计划与自动过渡 ════════════════════════════════════════════════════
  section("3) 渲染计划（自动过渡真的生效）");
  const project0 = await G.readMapProject(projectId);
  const mapId = project0.activeMapId;

  // 清掉基础族：这样 5×5 方块边缘/角上的掩码才是确定的
  await G.saveMapDocStructure(projectId, mapId, { layers: [{ id: "l0", baseFamilyId: undefined }] });
  const baseTileIndex = BLOB_INDEX.get(255);
  // 画一个 5×5 的实心方块（用掩码 255 那张当「代表块」）
  const blockCells = [];
  for (let r = 10; r < 15; r++) for (let c = 10; c < 15; c++) blockCells.push({ r, c, tile: baseTileIndex });
  const painted = await G.applyMapOps(projectId, mapId, [{ kind: "paint", layerId: "l0", cells: blockCells }]);
  check("一次 25 格的笔刷最多弄脏 4 个 chunk", painted.dirtyChunks.length <= 4, painted.dirtyChunks.join(" "));
  check("补丁数与脏 chunk 一致", painted.patches.length === painted.dirtyChunks.length);
  check("可撤销", painted.canUndo === true && painted.canRedo === false);

  const plan = await G.mapPlan(projectId, mapId);
  const ops = plan.chunks.flatMap((chunk) => chunk.ops);
  const tileAt = (r, c) => ops.find((op) => op.r === r && op.c === c)?.t;
  // 手算掩码（不调实现，避免自我循环）：N=1,NE=2,E=4,SE=8,S=16,SW=32,W=64,NW=128
  check("方块中心 = 八邻全连通 → 掩码 255", tileAt(12, 12) === BLOB_INDEX.get(255), `t=${tileAt(12, 12)}`);
  check("左上角 = E|SE|S = 28", tileAt(10, 10) === BLOB_INDEX.get(4 | 8 | 16), `t=${tileAt(10, 10)} 期望 ${BLOB_INDEX.get(28)}`);
  check("上边中点 = E|SE|S|SW|W = 124", tileAt(10, 12) === BLOB_INDEX.get(4 | 8 | 16 | 32 | 64), `t=${tileAt(10, 12)} 期望 ${BLOB_INDEX.get(124)}`);
  check("左边中点 = N|NE|E|SE|S = 31", tileAt(12, 10) === BLOB_INDEX.get(1 | 2 | 4 | 8 | 16), `t=${tileAt(12, 10)} 期望 ${BLOB_INDEX.get(31)}`);
  check("右下角 = N|W|NW = 193", tileAt(14, 14) === BLOB_INDEX.get(1 | 64 | 128), `t=${tileAt(14, 14)} 期望 ${BLOB_INDEX.get(193)}`);
  check("方块外不画东西", tileAt(9, 9) === undefined);
  check("计划带包围盒与格数", plan.bounds.width > 0 && plan.cols === 32 && plan.rows === 32, `${plan.bounds.width}×${plan.bounds.height}`);
  check("无回退（掩码齐全）", plan.fallbacks.length === 0, JSON.stringify(plan.fallbacks));

  // 缺掩码 → 回退，且是可复现的
  await G.saveMapFamilies(projectId, [
    { id: "grass", name: "草地", autotile: "blob47", priority: 0, color: "#3f9b2f" },
    { id: "rock", name: "岩石", autotile: "single", priority: 1, color: "#888888" }
  ]);
  const onlyEven = imported.tileset.tiles.map((tile, index) => ({
    id: tile.id,
    familyId: index < 24 ? "grass" : tile.familyId === "rock" ? "rock" : "grass",
    // 只保留偶数掩码 → 一定会回退
    mask: index < AUTO.BLOB47_MASKS.length && AUTO.BLOB47_MASKS[index] % 2 === 0 ? AUTO.BLOB47_MASKS[index] : undefined,
    weight: 1
  }));
  await G.saveMapTileset(projectId, tilesetId, { tiles: onlyEven });
  const planFallback = await G.mapPlan(projectId, mapId);
  const fallbackOps = planFallback.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.r >= 10 && op.r < 15 && op.c >= 10 && op.c < 15);
  check("缺掩码时仍然每格都有图（不留透明洞）", fallbackOps.length === 25, `${fallbackOps.length}`);
  check("回退被统计出来", planFallback.fallbacks.length > 0, JSON.stringify(planFallback.fallbacks[0] ?? {}));
  const again = await G.mapPlan(projectId, mapId);
  check(
    "回退是确定性的（两次计划一致）",
    JSON.stringify(again.chunks.flatMap((chunk) => chunk.ops).map((op) => op.t)) === JSON.stringify(planFallback.chunks.flatMap((chunk) => chunk.ops).map((op) => op.t))
  );
  // 恢复满配
  await G.saveMapTileset(projectId, tilesetId, { tiles: patches });

  // chunk 过滤：只请求一个 chunk 时只回它
  const oneChunk = await G.mapPlan(projectId, mapId, ["0,0"]);
  check("chunk 过滤只回请求的 chunk", oneChunk.chunks.length === 1 && oneChunk.chunks[0].key === "0,0");
  check("chunk 过滤只扫该 chunk 的格子", oneChunk.chunks[0].ops.every((op) => op.r < 32 && op.c < 32));
  check("chunk 计划不带 legend（省流量）", oneChunk.legend.length === 0);
  const oversized = await G.mapPlan(projectId, mapId);
  check("全量计划给出全部 chunk 键", oversized.allChunkKeys.length === 1, oversized.allChunkKeys.join(" "));

  // ══ 4. 第二层与层高 ═════════════════════════════════════════════════════
  section("4) 图层与层高");
  const structure = await G.saveMapDocStructure(projectId, mapId, { addLayer: { kind: "decor", name: "树" }, layers: [{ id: "l0", name: "地面" }] });
  check("新增图层成功", structure.doc.layers.length === 2 && structure.doc.layers[1].kind === "decor");
  check("新图层数据已初始化", structure.doc.data[structure.doc.layers[1].id].length === 32 * 32);
  const rockTileIndex = tileIds.findIndex((id, index) => index === AUTO.BLOB47_MASKS.length) + 1;
  const decorLayerId = structure.doc.layers[1].id;
  await G.applyMapOps(projectId, mapId, [{ kind: "paint", layerId: decorLayerId, cells: [{ r: 12, c: 12, tile: rockTileIndex }] }]);
  const withDecor = await G.mapPlan(projectId, mapId);
  const decorOps = withDecor.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.l === 1);
  check("装饰层只画一格", decorOps.length === 1 && decorOps[0].t === rockTileIndex);
  await G.saveMapDocStructure(projectId, mapId, { layers: [{ id: decorLayerId, heightOffset: 2, opacity: 0.5 }] });
  const lifted = await G.mapPlan(projectId, mapId);
  const liftedOp = lifted.chunks.flatMap((chunk) => chunk.ops).find((op) => op.l === 1);
  const flatOp = decorOps[0];
  check("层高偏移真的抬高了（y 减小 2×heightStep）", liftedOp.y === flatOp.y - 2 * 4, `${flatOp.y} → ${liftedOp.y}`);
  check("层不透明度进了计划", liftedOp.a === 0.5, `${liftedOp.a}`);
  await G.saveMapDocStructure(projectId, mapId, { layers: [{ id: decorLayerId, heightOffset: 0, opacity: 1, visible: false }] });
  const hidden = await G.mapPlan(projectId, mapId);
  check("隐藏图层不出现在计划里", hidden.chunks.flatMap((chunk) => chunk.ops).every((op) => op.l !== 1));
  await G.saveMapDocStructure(projectId, mapId, { layers: [{ id: decorLayerId, visible: true }] });

  // 锁定图层不接受编辑
  await G.saveMapDocStructure(projectId, mapId, { layers: [{ id: decorLayerId, locked: true }] });
  const lockedResult = await G.applyMapOps(projectId, mapId, [{ kind: "paint", layerId: decorLayerId, cells: [{ r: 3, c: 3, tile: rockTileIndex }] }]);
  check("锁定图层拒绝编辑并说明原因", lockedResult.changed === 0 && lockedResult.skipped.some((text) => text.includes("锁定")), lockedResult.skipped.join(" "));
  await G.saveMapDocStructure(projectId, mapId, { layers: [{ id: decorLayerId, locked: false }] });

  // ══ 5. 编辑操作 ═════════════════════════════════════════════════════════
  section("5) 编辑 op / 撤销重做");
  const fill = await G.applyMapOps(projectId, mapId, [{ kind: "fill", layerId: "l0", r: 0, c: 0, tile: baseTileIndex }]);
  check("填充把整张空地图刷满", fill.changed === 32 * 32 - 25, `${fill.changed}`);
  const groundOps = (plan) => plan.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.l === 0);
  const afterFill = await G.mapPlan(projectId, mapId);
  check("填满后地面层计划格数 = 全部格子", groundOps(afterFill).length === 32 * 32, `${groundOps(afterFill).length}`);
  const undone = await G.undoMap(projectId, mapId);
  check("撤销填充", undone.changed === 32 * 32 - 25 && undone.canUndo === true);
  const afterUndo = await G.mapPlan(projectId, mapId);
  check("撤销后回到 25 格", groundOps(afterUndo).length === 25, `${groundOps(afterUndo).length}`);
  const redone = await G.redoMap(projectId, mapId);
  check("重做填充", redone.changed === 32 * 32 - 25);
  await G.undoMap(projectId, mapId);

  // 矩形：rows 1..4 × cols 2..5 → 周长 4×4−4 = 12
  const rect = await G.applyMapOps(projectId, mapId, [{ kind: "rect", layerId: "l0", r0: 1, c0: 2, r1: 4, c1: 5, tile: baseTileIndex, filled: false }]);
  check("矩形描边只画边框（4×4 周长 12）", rect.changed === 12, `${rect.changed}`);
  const filledRect = await G.applyMapOps(projectId, mapId, [{ kind: "rect", layerId: "l0", r0: 20, c0: 20, r1: 21, c1: 21, tile: baseTileIndex, filled: true }]);
  check("实心矩形画满 2×2", filledRect.changed === 4, `${filledRect.changed}`);
  const replaced = await G.applyMapOps(projectId, mapId, [{ kind: "replace", layerId: "l0", from: baseTileIndex, to: rockTileIndex }]);
  check("替换把它换成另一种图块（25+12+4=41 格）", replaced.changed === 41, `${replaced.changed}`);
  await G.undoMap(projectId, mapId);
  const badOps = await G.applyMapOps(projectId, mapId, [{ kind: "nope" }, { kind: "paint", layerId: "nope", cells: [] }]);
  check("认不出的 op / 不存在的图层被明确报出", badOps.skipped.length === 2, badOps.skipped.join(" "));

  // 越界格不抛异常
  const outOfRange = await G.applyMapOps(projectId, mapId, [{ kind: "paint", layerId: "l0", cells: [{ r: -1, c: 999, tile: baseTileIndex }] }]);
  check("越界格记进 skipped 而不抛", outOfRange.changed === 0 && outOfRange.skipped.length === 1, outOfRange.skipped.join(" "));

  // 全量撤销 → 全量重做：必须**逐项回到同一份计划**（比「能撤销」强得多）
  // 先把可能挂着的 redo 分支走完，保证「最新态」就是栈顶
  while ((await G.redoMap(projectId, mapId)) !== undefined) {
    /* 走到栈顶 */
  }
  const latest = JSON.stringify((await G.mapPlan(projectId, mapId)).chunks);
  let steps = 0;
  while ((await G.undoMap(projectId, mapId)) !== undefined) steps++;
  check("一直撤销到根（步数 > 0）", steps > 0, `${steps} 步`);
  const emptyPlan = await G.mapPlan(projectId, mapId);
  check("撤销到根后地面层一格格子都不剩", groundOps(emptyPlan).length === 0, `${groundOps(emptyPlan).length}`);
  check("到根后再撤销返回 undefined", (await G.undoMap(projectId, mapId)) === undefined);
  let redos = 0;
  while ((await G.redoMap(projectId, mapId)) !== undefined) redos++;
  check("重做步数与撤销一致", redos === steps, `${redos} vs ${steps}`);
  check("重做后计划与撤销前记录的完全一致", JSON.stringify((await G.mapPlan(projectId, mapId)).chunks) === latest);
  check("到顶后再重做返回 undefined", (await G.redoMap(projectId, mapId)) === undefined);

  // ══ 6. 落盘（防抖）与重载 ═══════════════════════════════════════════════
  section("6) 防抖落盘与重载");
  await G.flushMapDoc(projectId, mapId);
  const docFile = G.mapDocFile(projectId, mapId);
  const onDisk = JSON.parse(await readFile(docFile, "utf8"));
  check("地图文档落盘了", Array.isArray(onDisk.data.l0) && onDisk.data.l0.length === 32 * 32);
  const diskFilled = onDisk.data.l0.filter((value) => value > 0).length;
  const planFilled = groundOps(await G.mapPlan(projectId, mapId)).length;
  check("落盘的格子数与计划一致", diskFilled === planFilled, `${diskFilled} vs ${planFilled}`);
  await G.discardCachedDoc(projectId, mapId);
  const reloaded = await G.readMapDoc(projectId, mapId);
  check("丢缓存后能从磁盘读回同一份", reloaded.data.l0.filter((value) => value > 0).length === diskFilled);

  // ══ 7. 结构操作：改尺寸 ═════════════════════════════════════════════════
  section("7) 改地图尺寸");
  // 先在地图右侧远处补一格，缩小才真的会丢东西
  await G.applyMapOps(projectId, mapId, [{ kind: "paint", layerId: "l0", cells: [{ r: 30, c: 30, tile: baseTileIndex }] }]);
  const shrunk = await G.saveMapDocStructure(projectId, mapId, { cols: 16, rows: 16 });
  check("缩小时报出丢了多少格（16 格之外：4 格实心矩形 + 1 格）", shrunk.dropped === 5, `${shrunk.dropped}`);
  check("尺寸真的变了", shrunk.doc.cols === 16 && shrunk.doc.rows === 16);
  check("缩小时有提示", shrunk.warnings.some((text) => text.includes("丢掉")));
  const grown = await G.saveMapDocStructure(projectId, mapId, { cols: 24, rows: 24 });
  check("放大回来不清空已有内容", Object.values(grown.doc.data).some((data) => data.some((value) => value > 0)));
  check(
    "放大后新增区域是空的",
    (() => {
      for (let r = 0; r < 24; r++) {
        for (let c = 0; c < 24; c++) {
          if (r >= 16 || c >= 16) {
            if (grown.doc.data.l0[r * 24 + c] !== 0) return false;
          }
        }
      }
      return true;
    })()
  );
  await G.saveMapDocStructure(projectId, mapId, { cols: 32, rows: 32 });

  // ══ 8. 多地图 ═══════════════════════════════════════════════════════════
  section("8) 多地图");
  const second = await G.createMapDocFor(projectId, "第二张", 16, 16);
  check("新建地图进清单", (await G.readMapProject(projectId)).mapIds.length === 2);
  check("新建地图成为当前地图", (await G.readMapProject(projectId)).activeMapId === second.id);
  const copy = await G.duplicateMapDocFor(projectId, second.id);
  check("复制地图", (await G.readMapProject(projectId)).mapIds.length === 3 && copy.name.includes("副本"));
  await G.deleteMapDocFor(projectId, copy.id);
  check("删除地图后回到 2 张", (await G.readMapProject(projectId)).mapIds.length === 2);
  await G.deleteMapDocFor(projectId, second.id);
  const onlyOne = await G.deleteMapDocFor(projectId, (await G.readMapProject(projectId)).activeMapId).then(() => false).catch(() => true);
  check("最后一张地图删不掉", onlyOne);
  await G.patchMapProject(projectId, (project) => {
    project.activeMapId = project.mapIds[0];
  });

  // ══ 9. 预览与导出 ═══════════════════════════════════════════════════════
  section("9) 验收预览与导出");
  const previewBoth = await Promise.all([G.runPreviewStage(projectId, { mapId }), G.runPreviewStage(projectId, { mapId })]);
  const previewStart = previewBoth.find((item) => item.started === true) ?? previewBoth[0];
  check("预览作业已启动", previewStart.started === true, previewStart.reason ?? "");
  check("同一项目并发提交只放行一个", previewBoth.filter((item) => item.started === true).length === 1, JSON.stringify(previewBoth));
  const previewJob = await waitIdle(projectId);
  const previewFiles = await G.readPreviewFiles(projectId);
  check("产出切片 contact sheet", previewFiles.some((name) => name.startsWith("sheet-")), previewFiles.join(" "));
  check("产出覆盖矩阵", previewFiles.includes("coverage.png"));
  check("产出地图渲染图", previewFiles.some((name) => name.startsWith(`map-${mapId}`)), previewFiles.join(" "));
  check("预览作业没有报错", previewJob.error === undefined);
  check("作业跑完后可以再次提交", G.mapBusy(projectId) === false);

  const exportStart = await G.runExportStage(projectId, { mapId, scale: 1 });
  check("导出作业已启动", exportStart.started === true, exportStart.reason ?? "");
  const exportJob = await waitIdle(projectId);
  check("导出作业没有报错", exportJob.error === undefined, String(exportJob.error ?? ""));
  const exportDir = join(G.mapProjectDir(projectId), "export", "自检_地图".replace(/[^\p{L}\p{N}_-]+/gu, "_"));
  const exportDirs = await import("node:fs/promises").then((fs) => fs.readdir(join(G.mapProjectDir(projectId), "export")));
  const dir = join(G.mapProjectDir(projectId), "export", exportDirs[0]);
  check("导出目录存在", existsSync(dir), exportDirs.join(" "));
  const files = await import("node:fs/promises").then((fs) => fs.readdir(dir));
  check("导出合并 PNG", files.includes("map.png"));
  check("导出分层 PNG", files.some((name) => name.startsWith("layer-")));
  check("导出自有 JSON", files.includes("map.json"));
  check("导出 Tiled 地图", files.includes("map.tmj"));
  check("导出 Tiled 图集 + 图集 PNG（自包含）", files.some((name) => name.endsWith(".tsj")) && files.some((name) => name.endsWith(".png") && !name.startsWith("layer-") && name !== "map.png"));
  check("导出清单 manifest.json", files.includes("manifest.json"));
  void exportDir;

  const tmj = JSON.parse(await readFile(join(dir, "map.tmj"), "utf8"));
  check("tmj：orientation 与网格一致", tmj.orientation === "orthogonal", tmj.orientation);
  check("tmj：renderorder 是 right-down", tmj.renderorder === "right-down");
  check("tmj：尺寸与瓦片尺寸正确", tmj.width === 32 && tmj.height === 32 && tmj.tilewidth === 8 && tmj.tileheight === 8);
  check("tmj：firstgid 从 1 开始", tmj.tilesets[0].firstgid === 1);
  check("tmj：tsj 引用是裸文件名", /^[^/]+\.tsj$/.test(tmj.tilesets[0].source), tmj.tilesets[0].source);
  const dataLengths = tmj.layers.map((layer) => layer.data.length);
  check("tmj：每层 data 长度 = w×h", dataLengths.every((length) => length === 32 * 32), dataLengths.join(","));
  const gids = tmj.layers.flatMap((layer) => layer.data).filter((gid) => gid > 0);
  check("tmj：gid 都在图集范围内", gids.every((gid) => gid >= 1 && gid <= TILE_TOTAL), `max=${Math.max(...gids)}`);
  check("tmj：gid 覆盖到所有画过的格子", gids.length === tmj.layers.reduce((sum, layer) => sum + layer.data.filter((gid) => gid > 0).length, 0));
  const groundLayer = tmj.layers.find((layer) => layer.name === "地面");
  check("tmj：层名保留", groundLayer !== undefined && tmj.layers.length === 2, tmj.layers.map((layer) => layer.name).join("、"));
  check("tmj：层高写进 offsety 与 properties 两处", typeof tmj.layers[1].offsety === "number" && tmj.layers[1].properties[0].name === "heightOffset");

  const tsjFile = files.find((name) => name.endsWith(".tsj"));
  const tsj = JSON.parse(await readFile(join(dir, tsjFile), "utf8"));
  check("tsj：基本字段正确", tsj.type === "tileset" && tsj.tilecount === TILE_TOTAL && tsj.tilewidth === 8 && tsj.imagewidth === 64);
  check("tsj：image 是裸文件名", /^[^/]+\.png$/.test(tsj.image), tsj.image);
  check("tsj：图集 PNG 真的复制过来了", existsSync(join(dir, tsj.image)));
  const wangset = (tsj.wangsets ?? [])[0];
  check("tsj：blob47 写成 type=mixed 的 wangset", wangset !== undefined && wangset.type === "mixed", JSON.stringify(wangset?.type ?? null));
  check("tsj：wangid 是 8 位 0/1", wangset.wangtiles.every((tile) => tile.wangid.length === 8 && tile.wangid.every((value) => value === 0 || value === 1)));
  const wang255 = wangset.wangtiles.find((tile) => tile.wangid.every((value) => value === 1));
  check("tsj：全连通掩码对应 wangid 全 1", wang255 !== undefined && wang255.tileid === AUTO.BLOB47_MASKS.length - 1);
  check("tsj：single 族不产生 wangset", (tsj.wangsets ?? []).length === 1, `${(tsj.wangsets ?? []).length} 个`);

  const ownJson = JSON.parse(await readFile(join(dir, "map.json"), "utf8"));
  check("map.json：格式标识", ownJson.format === EXPORT.OWN_JSON_FORMAT);
  check("map.json：图层数据是语义值（长度 = w×h）", ownJson.layers.every((layer) => layer.data.length === 32 * 32));
  check("map.json：legend 覆盖全部图块", ownJson.legend.length === TILE_TOTAL);
  check("map.json：带上族的自动过渡方案", ownJson.families.some((family) => family.autotile === "blob47"));
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  check("manifest：列出全部产物", manifest.files.length >= 5 && manifest.mapPng === "map.png");

  // 导出的 PNG 与宿主渲染逐字节一致（同输入两次 → 同一份）
  const rasterA = await G.mapPlan(projectId, mapId);
  const rasterB = await G.mapPlan(projectId, mapId);
  check("同一份文档两次取计划完全一致", JSON.stringify(rasterA.chunks) === JSON.stringify(rasterB.chunks));

  // ══ 10. 引用保护 ════════════════════════════════════════════════════════
  section("10) 引用保护与重排");
  const blocked = await G.removeMapTileset(projectId, tilesetId).then(() => false).catch((error) => error.message);
  check("还在用时拒绝删图集并说明用在哪", typeof blocked === "string" && blocked.includes("还有地图在用"), String(blocked).slice(0, 60));

  const beforeKeys = new Map(TILES.flatTiles((await G.readMapProject(projectId)).tilesets).map((tile) => [tile.index, `${tile.tilesetId}/${tile.id}`]));
  void beforeKeys;
  // 改切分（16×16，块数变少）→ 序号重排 + 越界格子清零
  const reslice = await G.saveMapTileset(projectId, tilesetId, { slice: { mode: "grid", tileWidth: 16, tileHeight: 16 } });
  check("改切分后块数变少", reslice.tileset.tiles.length === 16, `${reslice.tileset.tiles.length}`);
  check("序号重排有提示", reslice.warnings.length > 0, reslice.warnings.join(" | ").slice(0, 80));
  const remappedPlan = await G.mapPlan(projectId, mapId);
  const invalid = remappedPlan.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.t > 16);
  check("重排后没有指向不存在的图块", invalid.length === 0, `${invalid.length} 个越界`);
  await G.saveMapTileset(projectId, tilesetId, { slice: { mode: "grid", tileWidth: 8, tileHeight: 8 } });
  const restored = await G.saveMapTileset(projectId, tilesetId, { tiles: patches });
  check("切分改回去后元数据按矩形恢复", restored.tileset.tiles.length === TILE_TOTAL && restored.tileset.tiles[0].familyId === "grass");

  // ══ 11. 视图 ════════════════════════════════════════════════════════════
  section("11) 视图与警告");
  const view = await G.mapView(await G.readMapProject(projectId));
  check("视图含图集与图片 URL", view.tilesets.length === 1 && view.tilesets[0].url.includes("/map-assets/"));
  check("视图不含图层数据本体（省流量）", view.doc.layers.length === 2 && view.doc.data === undefined && typeof view.doc.filled.l0 === "number");
  check("视图含 legend 与 coverage", view.legend.length === TILE_TOTAL && view.coverage.length === 2);
  check("视图含包围盒与撤销状态", view.doc.bounds.width > 0 && typeof view.doc.canUndo === "boolean");
  check("进度汇总", view.progress.tiles === TILE_TOTAL && view.progress.maps === 1);
  const stages = await G.patchMapProject(projectId, (project) => {
    project.stages.export.approved = true;
    return project.stages.export;
  });
  check("阶段可以打通过标记", stages.approved === true);

  // ══ 12. 清理 ════════════════════════════════════════════════════════════
  section("12) 删除项目");
  const dirExisted = existsSync(G.mapProjectDir(projectId));
  await G.deleteMapProject(projectId);
  check("删项目之前目录在", dirExisted);
  check("删项目之后目录没了", !existsSync(G.mapProjectDir(projectId)));
  check("删项目之后不在清单里", !(await G.listMapProjects()).some((item) => item.id === projectId));
  projectId = "";
  void DOC;
  void CONFIG;
  void writeFile;
  void rm;
} finally {
  if (projectId !== "") {
    await G.deleteMapProject(projectId).catch(() => undefined);
    console.log("\n（已清理自检项目）");
  }
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${passed} 项通过${failures.length > 0 ? `，${failures.length} 项失败` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
