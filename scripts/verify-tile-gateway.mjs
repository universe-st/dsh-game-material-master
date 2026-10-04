/**
 * 模块五 · **走真实网关方法**的端到端自检（不花钱）。
 *
 * 与另外两个 tile 自检的分工：
 *   · verify-tile.mjs           几何内核（纯函数）
 *   · verify-tile-pipeline.mjs  数据层流水线（直接调 tilegen）
 *   · **本脚本**                网关那一层：payload 解析、id 校验、保存/验收/状态回流
 *
 * 为什么值得单列：真机验证时抓到的 `getTileProject expected 0 argument(s)`、
 * `stages.filter is not a function`、`progress` 恒为 0/0 都属于这一层 ——
 * 纯函数全绿、直接调 tilegen 也全绿，只有走 `GameStudioGateway` 才暴露。
 *
 * 花钱的那一步（runTileItems）用**已有的 raw 产物**喂，不调生图接口：
 * 它验证的是「提交 → 后台作业 → 状态回流」这条管线，而不是模型本身。
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dsh-tile-gw-"));
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
const tilegen = await import("../lib/tilegen.js");

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
check("网关实例可用", studio !== undefined && typeof studio.createTileProject === "function");

const waitIdle = async (id, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!tilegen.tileBusy(id)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

// ═══════════════════════════════════════════════════════════════════════════
section("建项目 / 读回 / 列表");
// ═══════════════════════════════════════════════════════════════════════════
const created = await studio.createTileProject({ name: "网关自检", lang: "zh" });
const id = created.id;
check("createTileProject 返回项目", typeof id === "string" && id.startsWith("t"), id);
check("返回体带 assetBase", String(created.assetBase).endsWith(`/tile-assets/${id}/`), String(created.assetBase));
check("返回体带 progress", created.progress !== undefined && created.progress.expected > 0, JSON.stringify(created.progress));
check("默认清单是中文", created.items.some((i) => i.label === "草地"), created.items[0]?.label);

const readBack = await studio.getTileProject({ projectId: id, lang: "zh" });
check("getTileProject 能读回（payload 通道正常）", readBack.id === id);
check("读回也带 progress", readBack.progress !== undefined, JSON.stringify(readBack.progress));

const listed = await studio.listTileProjects();
check("listTileProjects 里有它", listed.projects.some((p) => p.id === id));

// 英文默认清单
const en = await studio.createTileProject({ name: "gw en", lang: "en" });
check("lang=en 时默认清单是英文", en.items.some((i) => i.label === "Grass"), en.items[0]?.label);
await studio.deleteTileProject({ projectId: en.id });

// ═══════════════════════════════════════════════════════════════════════════
section("① 模板阶段（走网关，免费）");
// ═══════════════════════════════════════════════════════════════════════════
const started = await studio.runTileTemplate({ projectId: id });
check("runTileTemplate 返回 started", started.started === true, JSON.stringify(started));
await waitIdle(id);
const afterTemplate = await studio.getTileProject({ projectId: id });
check("模板阶段落成 done", afterTemplate.stages.template.status === "done", afterTemplate.stages.template.status);
check("模板产物在磁盘上",
  existsSync(join(tilegen.tileProjectDir(id), "template", "cell.png")) &&
  existsSync(join(tilegen.tileProjectDir(id), "template", "grid2x2.png")));

// ═══════════════════════════════════════════════════════════════════════════
section("③ 验收（走网关）");
// ═══════════════════════════════════════════════════════════════════════════
{
  // 造一个假的变体，好在不打接口的前提下把验收路径跑通
  // ⚠️ 界面回传时是带着 `variants` 的；夹具也要带上，否则 mergeTileItems
  // 拿不到旧变体、会误判成「内容变了」而把产物清空 —— 那就测不出真问题了。
  await studio.saveTileProject({ projectId: id, items: afterTemplate.items.map((i) => ({
    key: i.key, label: i.label, kind: i.kind, family: i.family,
    content: i.content, mode: i.mode, variantCount: 1, variants: i.variants
  })) });
  await tilegen.patchTileProject(id, (fresh) => {
    fresh.items[0].variants[0] = { index: 0, cell: "cell/fake.png", report: { mode: "measured", ratioMeasured: 2.001, scale: [0.03, 0.03] } };
  });
  await mkdir(join(tilegen.tileProjectDir(id), "cell"), { recursive: true });
  await writeFile(join(tilegen.tileProjectDir(id), "cell", "fake.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const key = (await studio.getTileProject({ projectId: id })).items[0].key;
  const approved = await studio.setTileApproved({ projectId: id, key, variant: 0, approved: true });
  check("setTileApproved 返回 ok", approved.ok === true);
  const afterApprove = await studio.getTileProject({ projectId: id });
  check("验收标记写回去了", afterApprove.items[0].variants[0].approved === true);
  check("progress.approved 跟着涨", afterApprove.progress.approved === 1, JSON.stringify(afterApprove.progress));

  // 不存在的 key 必须明确报错
  let threw = false;
  try {
    await studio.setTileApproved({ projectId: id, key: "不存在的类别", approved: true });
  } catch {
    threw = true;
  }
  check("验收不存在的类别会报错", threw);
}

// ═══════════════════════════════════════════════════════════════════════════
section("saveTileProject：改内容会作废产物，改名字不会");
// ═══════════════════════════════════════════════════════════════════════════
{
  const before = await studio.getTileProject({ projectId: id });
  const key = before.items[0].key;
  // 只改标签 → 产物必须保住
  await studio.saveTileProject({ projectId: id, items: before.items.map((i) => ({
    key: i.key, label: i.key === key ? "草地（改名）" : i.label, kind: i.kind, family: i.family,
    content: i.content, mode: i.mode, variantCount: 1, variants: i.variants
  })) });
  const renamed = await studio.getTileProject({ projectId: id });
  check("只改标签时产物保住", renamed.items.find((i) => i.key === key).variants.length === 1,
    `${renamed.items.find((i) => i.key === key).variants.length} 个变体`);

  // 改内容 → 产物必须作废（它画的是旧内容）
  await studio.saveTileProject({ projectId: id, items: renamed.items.map((i) => ({
    key: i.key, label: i.label, kind: i.kind, family: i.family,
    content: i.key === key ? "完全不同的内容描述" : i.content, mode: i.mode, variantCount: 1, variants: i.variants
  })) });
  const changed = await studio.getTileProject({ projectId: id });
  check("改内容描述时产物被作废", changed.items.find((i) => i.key === key).variants.length === 0,
    `${changed.items.find((i) => i.key === key).variants.length} 个变体`);

  // 改 style → 全部作废
  await tilegen.patchTileProject(id, (fresh) => {
    fresh.items[0].variants[0] = { index: 0, cell: "cell/fake.png" };
  });
  await studio.saveTileProject({ projectId: id, style: "完全不同的画风" });
  const restyled = await studio.getTileProject({ projectId: id });
  check("改画风时产物被作废", restyled.items[0].variants.length === 0);
  check("画风写回去了", restyled.style === "完全不同的画风");
}

// ═══════════════════════════════════════════════════════════════════════════
section("④ 拼图 / ⑤ 导出（走网关，免费）");
// ═══════════════════════════════════════════════════════════════════════════
{
  // 用一个真实的正规化产物落地，拼图才有东西可铺
  const probe = join(process.cwd(), "research", "tile-isometric", "probe", "b8", "G-grass-flash.png");
  if (!existsSync(probe)) {
    console.log("  · probe/ 不存在 —— 跳过拼图/导出（它们依赖真实产物）");
  } else {
    const GEOM = await import("../lib/tilegeom.js");
    const MEDIA = await import("../lib/tilemedia.js");
    const decoded = await MEDIA.decodeFile(probe);
    const measure = GEOM.measureGroundDiamond(decoded);
    const out = GEOM.regularizeToCell(decoded, { cellWidth: 64, cellHeight: 96 }, measure, "measured");
    await mkdir(join(tilegen.tileProjectDir(id), "cell"), { recursive: true });
    await writeFile(join(tilegen.tileProjectDir(id), "cell", "grass.png"), MEDIA.encodeBitmap(out.bitmap));
    await tilegen.patchTileProject(id, (fresh) => {
      fresh.items[0].variants[0] = { index: 0, cell: "cell/grass.png", report: out.report };
      fresh.map = { ...fresh.map, rows: 4, cols: 4 };
    });

    const mapStarted = await studio.runTileMap({ projectId: id, rows: 4, cols: 4, seed: 7, fill: freshKey(await studio.getTileProject({ projectId: id })), decorDensity: 0.1 });
    check("runTileMap 返回 started", mapStarted.started === true, JSON.stringify(mapStarted));
    await waitIdle(id);
    const mapped = await studio.getTileProject({ projectId: id });
    check("拼图阶段 done", mapped.stages.map.status === "done", mapped.stages.map.status);
    check("map.png 落在磁盘上", existsSync(join(tilegen.tileProjectDir(id), "map", "map.png")));
    check("view 里 map.png 是正斜杠路径", String(mapped.map.png) === "map/map.png", String(mapped.map.png));
    check("view 里 map.png 存在（界面据此显示预览）", typeof mapped.map.png === "string");

    const exp = await studio.runTileExport({ projectId: id });
    check("runTileExport 返回 started", exp.started === true);
    await waitIdle(id);
    const exported = await studio.getTileProject({ projectId: id });
    check("导出阶段 done", exported.stages.export.status === "done", exported.stages.export.status);
    check("导出产物齐备",
      existsSync(join(tilegen.tileProjectDir(id), "export", "map.png")) &&
      existsSync(join(tilegen.tileProjectDir(id), "export", "map.json")));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section("错误路径");
// ═══════════════════════════════════════════════════════════════════════════
{
  let threw = false;
  try {
    await studio.getTileProject({ projectId: "tnotexist000" });
  } catch {
    threw = true;
  }
  check("读不存在的项目会报错", threw);

  threw = false;
  try {
    await studio.runTileTemplate({ projectId: "badid" });
  } catch {
    threw = true;
  }
  check("非法 id 会报错", threw);

  threw = false;
  try {
    await studio.runTileMap({ projectId: id, rows: 4, cols: 4, fill: "不存在的类别" });
  } catch {
    threw = true;
  }
  check("拼图时用不存在的类别会报错", threw);

  const ok = await studio.setReviewMode({ module: "tile", id, reviewMode: "manual" });
  check("setReviewMode 支持 tile", ok.ok === true && ok.reviewMode === "manual", JSON.stringify(ok));
  const modeBack = await studio.getTileProject({ projectId: id });
  check("审核模式写回了项目", modeBack.reviewMode === "manual", String(modeBack.reviewMode));
}

await studio.deleteTileProject({ projectId: id });
const after = await studio.listTileProjects();
check("项目已删除", !after.projects.some((p) => p.id === id));

function freshKey(project) {
  return project.items[0]?.key ?? "grass";
}

await rm(HOME, { recursive: true, force: true });
void readFile;
console.log("");
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
  process.exit(1);
}
console.log(`共 ${checks} 项检查，全部通过。`);
