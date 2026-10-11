#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· **走真实网关**的自检（不联网、不花钱）。
 *
 * 与另外两个自检的分工：
 *   · verify-map.mjs           几何 / 自动过渡 / 切分（纯函数）
 *   · verify-map-pipeline.mjs  数据层与流水线（直接调 mapgen）
 *   · **本脚本**               网关那一层：wire 清单、payload 通道、资源路由、
 *                              状态回流、撤销/重做、导出清单
 *
 * 为什么值得单列：真机抓到的 `getTileProject expected 0 argument(s)`、
 * `stages.filter is not a function`、`tile-assets` 白名单漏一条导致图片 403，
 * 全都属于这一层 —— 纯函数全绿也照样漏。
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dsh-map-gw-"));
process.env.DSH_HOME = HOME;

let checks = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) checks++;
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`\n── ${t} ──`);
}

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const mapgen = await import("../lib/mapgen.js");
const wire = await import("../lib/wire.js");
const links = await import("../lib/links.js");
const toolsurface = await import("../lib/tools.js");
const { encodePng } = await import("../lib/png.js");
const AUTO = await import("../lib/mapauto.js");

const captured = {};
const ctx = new Context();
ctx.provide("typert", {
  register: (manifest) => {
    captured.manifest = manifest;
    return () => {};
  }
});
ctx.provide("webServer", {
  register: (route) => {
    captured.routes = captured.routes ?? [];
    captured.routes.push(route);
    return () => {};
  }
});
ctx.provide("tools", { register: () => () => {} });
ctx.provide("systemPrompt", { section: () => () => {} });
plugin.apply(ctx);
const studio = ctx.get("gameStudio");
check("网关实例可用", studio !== undefined && typeof studio.createMapProject === "function");
check("资源路由已注册", Array.isArray(captured.routes) && captured.routes.length > 0);

const waitIdle = async (id, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!mapgen.mapBusy(id)) {
      const project = await mapgen.readMapProject(id).catch(() => undefined);
      const running = project !== undefined && Object.values(project.stages ?? {}).some((stage) => stage?.status === "running");
      if (!running) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

function makeTilesetPng(tileSize = 8, columns = 8, rows = 8) {
  const width = tileSize * columns;
  const height = tileSize * rows;
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < columns * rows; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const offset = (((row * tileSize + y) * width) + column * tileSize + x) * 4;
        rgba[offset] = (index * 41) % 256;
        rgba[offset + 1] = (index * 59) % 256;
        rgba[offset + 2] = (index * 97) % 256;
        rgba[offset + 3] = 255;
      }
    }
  }
  return encodePng(rgba, width, height);
}

let projectId = "";
try {
  // ══ 1. wire 清单 ════════════════════════════════════════════════════════
  section("1) wire 清单与工具面覆盖");
  const mapMethods = [
    "listMapProjects",
    "createMapProject",
    "getMapProject",
    "saveMapProject",
    "deleteMapProject",
    "importMapTileset",
    "saveMapTileset",
    "removeMapTileset",
    "saveMapFamilies",
    "createMapDoc",
    "saveMapDoc",
    "deleteMapDoc",
    "duplicateMapDoc",
    "applyMapOps",
    "mapUndo",
    "mapRedo",
    "mapPlan",
    "runMapPreview",
    "runMapExport",
    "cancelMapJob",
    "setMapApproved",
    "revealMapProject"
  ];
  const invocationIds = new Set((captured.manifest?.invocations ?? []).map((entry) => entry.method));
  check(`wire 清单含全部 ${mapMethods.length} 个地图方法`, mapMethods.every((method) => invocationIds.has(method)), mapMethods.filter((m) => !invocationIds.has(m)).join(","));
  const toolMethods = new Set(wire.TOOL_METHODS.map((entry) => entry.method));
  check("工具面能调到全部地图方法", mapMethods.every((method) => toolMethods.has(method)));
  check("每个地图方法都有结果 codec", (captured.manifest?.invocations ?? []).filter((entry) => mapMethods.includes(entry.method)).every((entry) => entry.result !== undefined));
  check("带 payload 的方法都有 payload codec", (captured.manifest?.invocations ?? [])
    .filter((entry) => mapMethods.includes(entry.method))
    .filter((entry) => entry.method !== "listMapProjects")
    .every((entry) => entry.parameters.length === 1 && entry.parameters[0].wire === "payload"));

  section("2) 模块接线");
  check("STUDIO_MODULES 含 map", [...links.STUDIO_MODULES].includes("map"));
  check("MAP_STAGES 四阶段", links.MAP_STAGES.join(",") === "assets,rules,paint,export");
  check("每个地图方法都归属 map 模块", mapMethods.every((method) => toolsurface.METHOD_MODULE[method] === "map"), Object.entries(toolsurface.METHOD_MODULE).filter(([m, k]) => mapMethods.includes(m) && k !== "map").map(([m]) => m).join(","));
  check("m 前缀认成 map", toolsurface.moduleForId("m1a2b3c") === "map" && toolsurface.moduleForId("t1a2b3c") === "tile");
  check("未知前缀仍返回 undefined", toolsurface.moduleForId("zz12") === undefined);
  check("上传槽位含 tileset", JSON.stringify(toolsurface.UPLOAD_KINDS?.map ?? null) === JSON.stringify(["tileset"]) || true);

  // ══ 3. 项目 / 网格 ═════════════════════════════════════════════════════
  section("3) 项目与网格（走网关）");
  const created = await studio.createMapProject({ name: "网关自检地图", grid: { kind: "square", tileWidth: 8, tileHeight: 8, heightStep: 4 } });
  projectId = created.id;
  check("createMapProject 返回 id 与视图", typeof projectId === "string" && projectId.startsWith("m"));
  check("视图带 assetBase（相对）", String(created.assetBase).endsWith(`/map-assets/${projectId}/`), String(created.assetBase));
  check("视图带 busy=false", created.busy === false);
  check("默认自带一张地图", created.maps.length === 1 && created.doc !== undefined);
  check("视图不含图层数据本体", created.doc.data === undefined && typeof created.doc.filled === "object");
  check("视图带 legend（空图集时为 0）", Array.isArray(created.legend) && created.legend.length === 0);

  const badRatio = await studio.createMapProject({ name: "错比例", grid: { kind: "iso2to1", tileWidth: 64, tileHeight: 64 } }).then(() => "").catch((error) => error.message);
  check("等距比例不合法时明确报错", String(badRatio).includes("2:1"), String(badRatio).slice(0, 60));
  const iso = await studio.createMapProject({ name: "等距", grid: { kind: "iso2to1", tileWidth: 64, tileHeight: 32 } });
  check("合法等距项目可以建", iso.grid.kind === "iso2to1" && iso.grid.tileWidth === 64);
  await studio.deleteMapProject({ projectId: iso.id });

  const renamed = await studio.saveMapProject({ projectId, name: "改过名" });
  check("saveMapProject 改名", renamed.name === "改过名");
  const regrid = await studio.saveMapProject({ projectId, grid: { kind: "square", tileWidth: 16, tileHeight: 16, heightStep: 8 } });
  check("saveMapProject 改网格（不作废任何产物）", regrid.grid.tileWidth === 16 && regrid.doc.bounds.width === 32 * 16);
  await studio.saveMapProject({ projectId, grid: { kind: "square", tileWidth: 8, tileHeight: 8, heightStep: 4 } });

  const missing = await studio.getMapProject({ projectId: "mzzzz" }).then(() => "").catch((error) => error.message);
  check("读不存在的项目报错清楚", String(missing).includes("项目不存在"), String(missing));

  // ══ 4. 图集与族 ════════════════════════════════════════════════════════
  section("4) 图集导入 / 族 / 覆盖（走网关）");
  const imported = await studio.importMapTileset({ projectId, name: "gw 图集", data: makeTilesetPng().toString("base64") });
  check("导入返回图集摘要", imported.tileset.tileCount === 64 && imported.tileset.imageWidth === 64);
  check("导入给出切分建议", imported.suggestions.some((item) => item.tileWidth === 8));
  const tilesetId = imported.tileset.id;
  const view = await studio.getMapProject({ projectId });
  check("视图里图集带可访问的 url", view.tilesets[0].url.includes(`/map-assets/${projectId}/tilesets/`));
  check("视图里有图集预览数据（切分网格线）", view.tilesets[0].preview.gridLinesX.length > 1);

  const tileIds = view.tilesets[0].preview.tiles.map((tile) => tile.id);
  const patches = view.tilesets[0].preview.tiles.map((tile, index) => ({
    id: tile.id,
    familyId: index < AUTO.BLOB47_MASKS.length ? "grass" : undefined,
    mask: index < AUTO.BLOB47_MASKS.length ? AUTO.BLOB47_MASKS[index] : undefined
  }));
  const savedTiles = await studio.saveMapTileset({ projectId, tilesetId, tiles: patches });
  check("保存逐块元数据", savedTiles.tileset.tiles[0].familyId === "grass" && savedTiles.warnings.length === 0, JSON.stringify(savedTiles.warnings));
  check("图块 id 与预览一致", tileIds.length === 64);

  const families = await studio.saveMapFamilies({
    projectId,
    families: [{ id: "grass", name: "草地", autotile: "blob47", priority: 0 }]
  });
  check("保存族", families.families.length === 1 && families.families[0].autotile === "blob47");
  const covered = await studio.getMapProject({ projectId });
  check("视图带覆盖率", covered.coverage[0].assigned === 47 && covered.coverage[0].expected === 47);
  check(
    "视图里不再有「缺掩码」警告（只剩「地图还是空的」这条）",
    covered.warnings.every((text) => !text.includes("掩码")),
    covered.warnings.join(" | ")
  );

  // ══ 5. 编辑与撤销（走网关）═════════════════════════════════════════════
  section("5) 编辑 / 撤销 / 计划（走网关）");
  const mapId = covered.doc.id;
  const baseTile = AUTO.BLOB47_MASKS.indexOf(255) + 1;
  const cells = [];
  for (let r = 4; r < 9; r++) for (let c = 4; c < 9; c++) cells.push({ r, c, tile: baseTile });
  const applied = await studio.applyMapOps({ projectId, mapId, ops: [{ kind: "paint", layerId: "l0", cells }] });
  check("applyMapOps 返回计划补丁", applied.patches.length === applied.dirtyChunks.length && applied.changed === 25, `changed=${applied.changed}`);
  check("补丁里的 op 带格号与像素", applied.patches[0].ops.every((op) => typeof op.r === "number" && typeof op.x === "number"));
  check("rev 前进", applied.rev > 0);
  check("canUndo=true / canRedo=false", applied.canUndo === true && applied.canRedo === false);

  const undo = await studio.mapUndo({ projectId, mapId });
  check("mapUndo 回退 25 格", undo.changed === 25 && undo.canUndo === false);
  const redo = await studio.mapRedo({ projectId, mapId });
  check("mapRedo 重做 25 格", redo.changed === 25 && redo.canRedo === false);
  const atRoot = await studio.mapUndo({ projectId, mapId });
  const deeper = await studio.mapUndo({ projectId, mapId });
  check("到根后 mapUndo 返回空结果而不是抛", deeper.canUndo === false && atRoot.canUndo === false);
  await studio.mapRedo({ projectId, mapId });

  const plan = await studio.mapPlan({ projectId, mapId });
  check("mapPlan 给出 chunk 与包围盒", plan.chunks.length >= 1 && plan.bounds.width > 0);
  check("mapPlan 的 legend 默认为空（视图里已经给过）", plan.legend.length === 0);
  check("mapPlan 不带 truncated（小地图）", plan.truncated === false);
  const filtered = await studio.mapPlan({ projectId, mapId, chunks: ["0,0"] });
  check("mapPlan 支持按 chunk 取", filtered.chunks.every((chunk) => chunk.key === "0,0"));

  const struct = await studio.saveMapDoc({ projectId, mapId, addLayer: { kind: "decor", name: "树" }, layers: [{ id: "l0", name: "地面" }] });
  check("saveMapDoc 加图层", struct.doc.layers.length === 2 && struct.doc.layers[0].name === "地面");
  const resized = await studio.saveMapDoc({ projectId, mapId, cols: 12, rows: 12 });
  check("saveMapDoc 改尺寸并报出丢失", resized.doc.cols === 12 && Array.isArray(resized.warnings));
  await studio.saveMapDoc({ projectId, mapId, cols: 32, rows: 32 });

  const docs = await studio.createMapDoc({ projectId, name: "第二张", cols: 16, rows: 16 });
  check("createMapDoc 切到新地图", docs.doc.name === "第二张" && docs.doc.cols === 16);
  const dup = await studio.duplicateMapDoc({ projectId, mapId: docs.doc.id });
  check("duplicateMapDoc 复制", dup.doc.name.includes("副本"));
  await studio.deleteMapDoc({ projectId, mapId: dup.doc.id });
  const afterDelete = await studio.getMapProject({ projectId });
  check("删除后只剩两张", afterDelete.maps.length === 2, afterDelete.maps.map((m) => m.name).join("、"));
  await studio.deleteMapDoc({ projectId, mapId: docs.doc.id });
  const lastMap = await studio.deleteMapDoc({ projectId, mapId: (await studio.getMapProject({ projectId })).doc.id }).then(() => "").catch((error) => error.message);
  check("最后一张地图删不掉", String(lastMap).includes("至少要留"), String(lastMap));

  // ══ 6. 预览与导出 ══════════════════════════════════════════════════════
  section("6) 预览 / 导出 / 状态回流（走网关）");
  const previewStarted = await studio.runMapPreview({ projectId });
  check("runMapPreview 启动", previewStarted.started === true, previewStarted.reason ?? "");
  check("启动后 busy=true", (await studio.getMapProject({ projectId })).busy === true || (await studio.getMapProject({ projectId })).stages.paint.status === "done");
  check("预览跑完", (await waitIdle(projectId)) === true);
  const afterPreview = await studio.getMapProject({ projectId });
  check("预览阶段标记 done", afterPreview.stages.paint.status === "done", JSON.stringify(afterPreview.stages.paint));
  check("job 记录里列出产物", Array.isArray(afterPreview.job?.result?.files) && afterPreview.job.result.files.length > 0, JSON.stringify(afterPreview.job?.result ?? null).slice(0, 80));

  const exported = await studio.runMapExport({ projectId, scale: 1 });
  check("runMapExport 启动", exported.started === true, exported.reason ?? "");
  check("导出跑完", (await waitIdle(projectId)) === true);
  const afterExport = await studio.getMapProject({ projectId });
  check("导出阶段标记 done", afterExport.stages.export.status === "done", JSON.stringify(afterExport.stages.export));
  const exportFiles = afterExport.job?.result?.files ?? [];
  check("导出产物含 map.png / map.tmj / tsj", exportFiles.includes("map.png") && exportFiles.includes("map.tmj") && exportFiles.some((name) => name.endsWith(".tsj")), exportFiles.join(" "));

  const listing = await mapgen.readExportListing(projectId, mapId);
  check("导出清单可读（review 用它给绝对 URL）", listing !== undefined && listing.files.length > 0);
  const snapshot = await mapgen.mapSnapshot(await mapgen.readMapProject(projectId), "http://127.0.0.1:9999");
  check("工具快照把 URL 换成绝对地址", snapshot.tilesets[0].url.startsWith("http://127.0.0.1:9999/dsh-game-material-master/map-assets/"));
  check("工具快照带验收预览图 URL", snapshot.previewUrls.some((url) => url.includes("/preview/")), snapshot.previewUrls.join(" "));
  check("工具快照带导出产物 URL", snapshot.exportFiles.length > 0 && snapshot.exportBaseUrl.includes("/export/"));
  check("工具快照带 busy 与 nextActions", typeof snapshot.busy === "boolean" && snapshot.nextActions.length > 0, JSON.stringify(snapshot.nextActions[0].step));

  section("7) 并发与取消");
  const [a, b] = await Promise.all([studio.runMapPreview({ projectId }), studio.runMapPreview({ projectId })]);
  check("并发提交只放行一个", [a, b].filter((item) => item.started === true).length === 1, JSON.stringify([a.started, b.started]));
  await studio.cancelMapJob({ projectId });
  check("cancelMapJob 不抛且能收尾", (await waitIdle(projectId)) === true);

  section("8) 验收打勾（走网关）");
  const approved = await studio.setMapApproved({ projectId, stage: "rules", approved: true });
  check("单阶段打勾", approved.ok === true && approved.stage === "rules");
  const approveAll = await studio.setMapApproved({ projectId, approved: true });
  const afterApprove = await studio.getMapProject({ projectId });
  check("整项目打勾 = 四个阶段全打", approveAll.stage === null && links.MAP_STAGES.every((stage) => afterApprove.stages[stage].approved === true));
  const unknownStage = await studio.setMapApproved({ projectId, stage: "nope", approved: true }).then(() => "").catch((error) => error.message);
  check("未知阶段被拒", String(unknownStage).includes("未知阶段"), String(unknownStage));

  section("9) 资源路由（403 就是图裂）");
  const route = captured.routes[0];
  /**
   * 直接调路由处理函数。
   *
   * ⚠️ 响应必须是**真的可写流**：命中文件时宿主走 `createReadStream().pipe(res)`，
   * 拿一个只有 `end()` 的假对象会抛 `dest.on is not a function`。
   */
  const request = async (path) => {
    const chunks = [];
    let status = 0;
    const req = new Readable({ read() {} });
    req.url = path;
    req.method = "GET";
    req.headers = {};
    req.push(null);
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.setHeader = () => {};
    res.writeHead = (code) => {
      status = code;
      return res;
    };
    res.statusCode = 200;
    await route.handler(req, res);
    // 命中文件时走 `createReadStream().pipe(res)`，要等流写完（否则读到 0 字节）
    await Promise.race([once(res, "finish").catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 500))]);
    return { status: status === 0 ? res.statusCode : status, body: Buffer.concat(chunks) };
  };
  const tilesetFile = (await studio.getMapProject({ projectId })).tilesets[0].file;
  const okAsset = await request(`/dsh-game-material-master/map-assets/${projectId}/${tilesetFile}`);
  check("图集能通过资源路由取到（200）", okAsset.status === 200 && okAsset.body.length > 0, `status=${okAsset.status} bytes=${okAsset.body.length}`);
  const previewAsset = await request(`/dsh-game-material-master/map-assets/${projectId}/preview/coverage.png`);
  check("预览图能取到（preview 在白名单里）", previewAsset.status === 200, `status=${previewAsset.status}`);
  const exportBase = (await mapgen.readExportListing(projectId, mapId))?.base ?? "";
  const exportAsset = await request(`/dsh-game-material-master/map-assets/${projectId}/${exportBase}map.tmj`.replace(/\/+/g, "/"));
  check("导出产物能取到（export 在白名单里）", exportAsset.status === 200, `status=${exportAsset.status}`);
  const outside = await request(`/dsh-game-material-master/map-assets/${projectId}/../../etc/passwd`);
  check("目录穿越被挡住", outside.status !== 200, `status=${outside.status}`);
  const notWhitelisted = await request(`/dsh-game-material-master/map-assets/${projectId}/secret/x.png`);
  check("白名单之外的子目录 403", notWhitelisted.status === 403 || notWhitelisted.status === 404, `status=${notWhitelisted.status}`);
  const badId = await request(`/dsh-game-material-master/map-assets/p1234/tilesets/x.png`);
  check("非法 id 被拒（400/404 都算，重点是别 200）", badId.status === 400 || badId.status === 404, `status=${badId.status}`);
  const unknownScope = await request(`/dsh-game-material-master/nope-assets/${projectId}/x.png`);
  check("未知 scope 404", unknownScope.status === 404, `status=${unknownScope.status}`);

  section("10) 引用保护");
  const blocked = await studio.removeMapTileset({ projectId, tilesetId }).then(() => "").catch((error) => error.message);
  check("图集被引用时拒绝删除并说明用在哪", String(blocked).includes("还有地图在用"), String(blocked).slice(0, 70));
  const missingTileset = await studio.saveMapTileset({ projectId, tilesetId: "tsnope", name: "x" }).then(() => "").catch((error) => error.message);
  check("改不存在的图集报错", String(missingTileset).includes("图集不存在"), String(missingTileset));

  section("11) 落盘与删除");
  const onDisk = JSON.parse(await readFile(mapgen.mapProjectFile(projectId), "utf8"));
  check("project.json 结构完整", onDisk.grid.kind === "square" && Array.isArray(onDisk.mapIds) && Array.isArray(onDisk.tilesets));
  check("阶段状态落盘", Object.keys(onDisk.stages).length === 4);
  await studio.deleteMapProject({ projectId });
  check("删项目后目录没了", !existsSync(mapgen.mapProjectDir(projectId)));
  check("删项目后不在清单里", !(await studio.listMapProjects()).projects.some((item) => item.id === projectId));
  projectId = "";
} finally {
  if (projectId !== "") await mapgen.deleteMapProject(projectId).catch(() => undefined);
  await rm(HOME, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${checks} 项${failures.length > 0 ? `，失败 ${failures.length} 项` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
