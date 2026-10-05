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

/**
 * 等作业真正跑完。
 *
 * ⚠️ 不能只看 `tileBusy`：`background()` 先把 `job.running` 置空、**之后**才写
 * 那次收尾 patch（`stages[kind] = done`、`map.png` 之类）。只等 busy 会在
 * 收尾 patch 落盘前就返回 —— 实测「拼图阶段 done」偶发看到 `running`、
 * `map.png` 还是 undefined，后面「导出」直接报「还没拼图」。
 * 所以还要等到阶段状态**不再是 running**。
 */
const waitIdle = async (id, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!tilegen.tileBusy(id)) {
      const project = await tilegen.readTileProject(id).catch(() => undefined);
      const running = project !== undefined &&
        Object.values(project.stages ?? {}).some((stage) => stage?.status === "running");
      if (!running) return true;
    }
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

  // ── 新增地块（GUI 的「＋ 新增地块」走这条路）──────────────────────────
  {
    const current = await studio.getTileProject({ projectId: id });
    const added = [
      ...current.items.map((i) => ({
        key: i.key, label: i.label, kind: i.kind, family: i.family,
        content: i.content, mode: i.mode, variantCount: i.variantCount, variants: i.variants
      })),
      {
        key: "rock3", label: "灰色岩壁", kind: "terrain", family: "rock",
        footprint: [1, 1], content: "灰色岩壁，垂直节理明显。", mode: "template",
        variantCount: 2, variants: []
      }
    ];
    await studio.saveTileProject({ projectId: id, items: added });
    const afterAdd = await studio.getTileProject({ projectId: id });
    const created = afterAdd.items.find((i) => i.key === "rock3");
    check("新增的地块出现了", created !== undefined, afterAdd.items.map((i) => i.key).join(","));
    check("新增地块的字段都写对了",
      created?.label === "灰色岩壁" && created?.family === "rock" && created?.variantCount === 2,
      JSON.stringify({ label: created?.label, family: created?.family, variantCount: created?.variantCount }));
    check("新增地块没有产物", created?.variants.length === 0);
    check("新增地块计入 progress.expected", afterAdd.progress.expected === current.progress.expected + 2,
      `${current.progress.expected} → ${afterAdd.progress.expected}`);

    // 改家族 / 用途 / 占格 / 变体数（都不该动产物）
    const withVariants = afterAdd.items.map((i) => ({
      key: i.key, label: i.label, kind: i.kind, family: i.family,
      content: i.content, mode: i.mode, variantCount: i.variantCount, variants: i.variants
    }));
    const target = withVariants.find((i) => i.key === "rock3");
    target.label = "岩壁";
    target.kind = "decor";
    target.mode = "plain";
    target.family = "boulder";
    target.footprint = [2, 2];
    target.variantCount = 4;
    await studio.saveTileProject({ projectId: id, items: withVariants });
    const afterEdit = await studio.getTileProject({ projectId: id });
    const edited = afterEdit.items.find((i) => i.key === "rock3");
    check("改用途 / 生成方式 / 家族 / 占格 / 变体数都生效",
      edited?.kind === "decor" && edited?.mode === "plain" && edited?.family === "boulder" &&
      edited?.footprint?.join(",") === "2,2" && edited?.variantCount === 4,
      JSON.stringify({ kind: edited?.kind, mode: edited?.mode, family: edited?.family, fp: edited?.footprint, vc: edited?.variantCount }));

    // ── 删除地块（GUI 的「删除」走这条路）────────────────────────────────
    const without = afterEdit.items
      .filter((i) => i.key !== "rock3")
      .map((i) => ({
        key: i.key, label: i.label, kind: i.kind, family: i.family,
        content: i.content, mode: i.mode, variantCount: i.variantCount, variants: i.variants
      }));
    await studio.saveTileProject({ projectId: id, items: without });
    const afterDelete = await studio.getTileProject({ projectId: id });
    check("删除的地块没了", !afterDelete.items.some((i) => i.key === "rock3"));
    check("删掉后剩余地块数正确", afterDelete.items.length === afterEdit.items.length - 1,
      `${afterEdit.items.length} → ${afterDelete.items.length}`);

    // 删空必须被挡住（否则地图无图可铺，而且界面会白屏）
    let threw = false;
    try {
      await studio.saveTileProject({ projectId: id, items: [] });
    } catch {
      threw = true;
    }
    const afterEmpty = await studio.getTileProject({ projectId: id });
    check("提交空清单不会把项目清空", afterEmpty.items.length > 0, `${afterEmpty.items.length} 项`);
    void threw;
  }

  // ── resetItemsToDefault ──────────────────────────────────────────────
  {
    const r = await studio.saveTileProject({ projectId: id, resetItemsToDefault: true, lang: "zh" });
    check("恢复默认清单后是 14 项", r.items.length === 14, String(r.items.length));
    check("恢复默认清单后第一项是草地", r.items[0]?.key === "grass", String(r.items[0]?.key));
    const rEn = await studio.saveTileProject({ projectId: id, resetItemsToDefault: true, lang: "en" });
    check("lang=en 时恢复成英文默认清单", rEn.items[0]?.label === "Grass", String(rEn.items[0]?.label));
    // 复原成中文，后面的拼图测试要用 grass
    await studio.saveTileProject({ projectId: id, resetItemsToDefault: true, lang: "zh" });
  }
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

    // ── saveTileMapCells：GUI 的手动布局编辑走这条路 ────────────────────
    {
      const layout = [
        ["grass", "grass", ""],
        ["", "grass", "grass"],
        ["grass", "", "grass"]
      ];
      await studio.saveTileMapCells({ projectId: id, cells: layout, seed: 42 });
      const edited = await studio.getTileProject({ projectId: id });
      check("手动布局写回项目", JSON.stringify(edited.map.cells) === JSON.stringify(layout),
        JSON.stringify(edited.map.cells));
      check("手动布局同步了 rows / cols", edited.map.rows === 3 && edited.map.cols === 3,
        `${edited.map.rows}×${edited.map.cols}`);
      check("手动布局同步了 seed", edited.map.seed === 42, String(edited.map.seed));
      check("手动改布局不作废已生成的地块", edited.items[0].variants.length === 1,
        `${edited.items[0].variants.length} 个变体`);
      check("手动改布局会作废下游地图（需要重铺）", edited.map.png === undefined, String(edited.map.png));

      // 重新铺一次，确认空单元格被正确跳过而不是崩
      await studio.runTileMap({ projectId: id, rows: 3, cols: 3, seed: 42, fill: "grass", decorDensity: 0 });
      await waitIdle(id);
      const remapped = await studio.getTileProject({ projectId: id });
      check("带空单元格的布局能重新铺出来", remapped.map.png === "map/map.png");
      check("重新铺图后阶段回到 done", remapped.stages.map.status === "done", remapped.stages.map.status);

      // 空清单不能把地图清没
      await studio.saveTileMapCells({ projectId: id, cells: [] });
      const afterEmpty = await studio.getTileProject({ projectId: id });
      check("提交空 cells 不会把布局清空", afterEmpty.map.cells.length > 0,
        `${afterEmpty.map.cells.length} 行`);
    }

    // ── 建筑：布局里放一栋楼必须能拼出来，而且要真的画上去 ──────────────
    {
      // 造一个 2×2 建筑变体（借用地块的贴图，只为验证拼图管线）
      const beforeBuilding = await studio.getTileProject({ projectId: id });
      const grassRel = beforeBuilding.items.find((i) => i.variants.length > 0).variants[0].cell;
      const grassBytes = await readFile(tilegen.tileAssetPath(id, grassRel));
      await mkdir(join(tilegen.tileProjectDir(id), "cell"), { recursive: true });
      await writeFile(join(tilegen.tileProjectDir(id), "cell", "building.v1.png"), grassBytes);
      await tilegen.patchTileProject(id, (fresh) => {
        const b = fresh.items.find((i) => i.key === "building");
        if (b !== undefined) {
          b.variants[0] = {
            index: 0, cell: "cell/building.v1.png", approved: true,
            report: { mode: "measured", scale: [1, 1], baseFraction: 0.75 }
          };
        }
        const cells = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => "grass"));
        for (const [r, c] of [[2, 2], [2, 3], [3, 2], [3, 3]]) cells[r][c] = "building";
        fresh.map = {
          ...fresh.map, rows: 6, cols: 6, seed: 7, cells, decor: {},
          buildings: [], buildingGround: [], png: undefined, json: undefined, pixel: undefined
        };
      });
      const bStart = await studio.runTileMap({ projectId: id, rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0 });
      check("布局里有建筑时能拼图（不会被预校验拦下）", bStart.started === true, JSON.stringify(bStart));
      await waitIdle(id);
      const b1 = await studio.getTileProject({ projectId: id });
      check("建筑被记进了 buildings", (b1.map.buildings ?? []).length === 1,
        JSON.stringify(b1.map.buildings));
      // ★ 语义变了：占格铺**真地面**，不是空串、也不是建筑键。
      //
      // 清成空串的话那一格什么都不铺，建筑底面菱形的四个角露出纯色垫底，
      // 和周围有纹理的草地格格不入（真机上像建筑拖着一块塑料板）。
      // 现在占格铺默认地面，建筑贴图盖上去。
      check("★ 建筑的占格铺回了地面（不是空串，也不是建筑键）",
        b1.map.cells[2][2] === "grass" && b1.map.cells[3][3] === "grass",
        JSON.stringify(b1.map.cells[2]));
      check("建筑底面记了垫底地面，且是**变体名**（lookup 的键就是它）",
        (b1.map.buildingGround ?? []).length === 1 && String(b1.map.buildingGround[0][4]).includes("#"),
        JSON.stringify(b1.map.buildingGround));

      // ★ 重跑一次：建筑的键已经被自己清掉了，记录必须能沿用，否则楼会凭空消失
      await studio.runTileMap({ projectId: id, rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0 });
      await waitIdle(id);
      const b2 = await studio.getTileProject({ projectId: id });
      check("重跑拼图后建筑仍在（记录被沿用，没被自己清掉）", (b2.map.buildings ?? []).length === 1,
        JSON.stringify(b2.map.buildings));
      check("重跑后垫底地面还是变体名", String(b2.map.buildingGround?.[0]?.[4] ?? "").includes("#"),
        JSON.stringify(b2.map.buildingGround));
    }

    // ★ 幽灵建筑：重新保存布局时，旧的 buildings / buildingGround 必须清掉。
    // 它们是**由布局推导出来的**；留着的话用户把楼挪走之后，
    // 拼图会在没有建筑的地方硬画一栋楼（实测地图上凭空多出一片屋顶）。
    //
    // 放在最后：`saveTileMapCells` 会作废地图，后面的导出测试还要用那张图。
    {
      await studio.saveTileMapCells({
        projectId: id,
        cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "grass"))
      });
      const b3 = await studio.getTileProject({ projectId: id });
      check("重新保存布局会清掉旧的建筑记录（避免幽灵建筑）",
        (b3.map.buildings ?? []).length === 0 && (b3.map.buildingGround ?? []).length === 0,
        JSON.stringify({ buildings: b3.map.buildings, ground: b3.map.buildingGround }));
    }

    // ── 布局是唯一真源：重拼不得重新随机 ────────────────────────────────
    // 不冻住的话，用户「开始编辑布局」拿到的和刚才看到的不是同一张 ——
    // 这正是「编辑的不是刚才随机生成的那个」的来源。
    {
      // 撒装饰需要有装饰变体；借用地块贴图给 tree 造一个
      const grassForDecor = (await studio.getTileProject({ projectId: id }))
        .items.find((i) => i.variants.length > 0)?.variants[0]?.cell;
      if (typeof grassForDecor === "string") {
        const bytes = await readFile(tilegen.tileAssetPath(id, grassForDecor));
        await mkdir(join(tilegen.tileProjectDir(id), "decor"), { recursive: true });
        await writeFile(join(tilegen.tileProjectDir(id), "decor", "tree.v1.png"), bytes);
        await tilegen.patchTileProject(id, (fresh) => {
          const t = fresh.items.find((i) => i.key === "tree");
          if (t !== undefined && t.variants[0]?.cell === undefined) {
            t.variants[0] = { index: 0, cell: "decor/tree.v1.png", approved: true, report: { mode: "sprite", scale: [1, 1] } };
          }
        });
      }
      await studio.saveTileMapCells({
        projectId: id,
        cells: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => "grass")),
        seed: 12345,
        decor: {}
      });
      await studio.runTileMap({ projectId: id, rows: 6, cols: 6, seed: 12345, fill: "grass", decorDensity: 0.3 });
      await waitIdle(id);
      const m1 = await studio.getTileProject({ projectId: id });
      const decor1 = JSON.stringify(m1.map.decor);

      await studio.runTileMap({ projectId: id, rows: 6, cols: 6, seed: 12345, fill: "grass", decorDensity: 0.3 });
      await waitIdle(id);
      const m2 = await studio.getTileProject({ projectId: id });
      check("★ 重拼不会重新随机装饰（布局是唯一真源）",
        JSON.stringify(m2.map.decor) === decor1,
        `第一次 ${Object.keys(JSON.parse(decor1)).length} 个 vs 第二次 ${Object.keys(m2.map.decor ?? {}).length} 个`);
      check("重拼后地面布局也没变",
        JSON.stringify(m2.map.cells) === JSON.stringify(m1.map.cells));

      await studio.runTileMap({ projectId: id, rows: 6, cols: 6, seed: 999, fill: "grass", decorDensity: 0.3, reroll: true });
      await waitIdle(id);
      const m3 = await studio.getTileProject({ projectId: id });
      check("显式 reroll 时才会重撒装饰", Object.keys(m3.map.decor ?? {}).length > 0,
        `${Object.keys(m3.map.decor ?? {}).length} 个`);
    }

    // ── 界面回传 layouts：建筑要能原样往返 ──────────────────────────────
    {
      await tilegen.patchTileProject(id, (fresh) => {
        const b = fresh.items.find((i) => i.key === "building");
        if (b !== undefined && b.variants[0]?.cell === undefined) {
          b.variants[0] = {
            index: 0, cell: "cell/building.v1.png", approved: true,
            report: { mode: "measured", scale: [1, 1], baseFraction: 0.5 }
          };
        }
      });
      await studio.saveTileMapCells({
        projectId: id,
        cells: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => "grass")),
        seed: 7,
        decor: {},
        layouts: [{ r: 2, c: 2, width: 2, height: 2, key: "building", under: "grass#0" }]
      });
      const L = await studio.getTileProject({ projectId: id });
      check("★ 界面回传的 layouts 落成了建筑记录",
        (L.map.buildings ?? []).length === 1 && String(L.map.buildings[0][2]).startsWith("building#"),
        JSON.stringify(L.map.buildings));
      check("layouts 的占格与垫底地面一并落盘",
        JSON.stringify(L.map.buildingGround?.[0]?.slice(0, 4)) === "[2,2,2,2]",
        JSON.stringify(L.map.buildingGround));
      check("★ 回传 layouts 时占格铺了地面（不是空串）",
        L.map.cells[2][2] === "grass" && L.map.cells[3][3] === "grass",
        JSON.stringify(L.map.cells[2]));

      // ★ 多栋建筑 + 装饰的**保存往返**：一栋都不能丢。
      //
      // 真机踩过：界面草稿里有几栋楼，存回去时只剩一部分 —— 因为落盘只认
      // 「cells 里还留着的建筑键」，而拼图会把占格清空。现在靠显式 layouts，
      // 这里钉住「4 栋进、4 栋出」。
      await studio.saveTileMapCells({
        projectId: id,
        cells: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "grass")),
        seed: 11,
        decor: { "0,1": "tree", "1,5": "tree" },
        layouts: [
          { r: 0, c: 0, width: 2, height: 2, key: "building", under: "grass#0" },
          { r: 0, c: 4, width: 2, height: 2, key: "building", under: "grass#0" },
          { r: 4, c: 0, width: 2, height: 2, key: "building", under: "grass#0" },
          { r: 4, c: 4, width: 2, height: 2, key: "building", under: "grass#0" }
        ]
      });
      const R = await studio.getTileProject({ projectId: id });
      check("★ 4 栋建筑经过一次保存往返后一栋不少",
        (R.map.buildings ?? []).length === 4,
        JSON.stringify((R.map.buildings ?? []).map((b) => `${b[0]},${b[1]}`)));
      check("★ 往返后装饰也一栋不少",
        Object.keys(R.map.decor ?? {}).length === 2,
        JSON.stringify(R.map.decor));
      check("★ preview 也看到 4 栋（界面据此画预览）",
        (R.preview?.buildings ?? []).length === 4,
        String((R.preview?.buildings ?? []).length));
      check("★ 建筑占格都铺着地面（不再被清空成空串）",
        R.map.buildings.every(([br, bc]) =>
          R.map.cells[br][bc] !== "" && R.map.cells[br + 1][bc + 1] !== ""),
        JSON.stringify(R.map.cells.map((row) => row.join(""))));

      // ★ 「大格子铺了之后清不掉」：显式传 layouts:[] 要能把楼拆干净，
      // 并且占格**补回地面**（否则拆完留下四个洞，看着还是没清掉）。
      await studio.saveTileMapCells({
        projectId: id,
        cells: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "grass")),
        seed: 11,
        decor: {},
        layouts: []
      });
      const lifted = await studio.getTileProject({ projectId: id });
      check("★ 显式清空 layouts 后建筑记录全清（不留幽灵建筑）",
        (lifted.map.buildings ?? []).length === 0,
        JSON.stringify(lifted.map.buildings));
      check("★ 拆楼后占格回到地面（不是四个洞）",
        lifted.map.cells[2][2] === "grass" && lifted.map.cells[3][3] === "grass",
        JSON.stringify(lifted.map.cells[2]));
      check("拆楼后 preview 里也没有建筑了", (lifted.preview?.buildings ?? []).length === 0);
    }

    // ── 装饰回传：**地块键**与**贴图路径**两种写法都要认 ──────────────
    // 界面回传键，早期数据里可能是路径。只认一种另一种会静默消失。
    {
      await studio.saveTileMapCells({
        projectId: id,
        cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "grass")),
        seed: 7,
        decor: { "0,1": "tree", "2,1": "decor/tree.v1.png" }
      });
      const D = await studio.getTileProject({ projectId: id });
      check("★ 装饰回传地块键能被解析成 key#index",
        String(D.map.decor?.["0,1"] ?? "").startsWith("tree#"),
        String(D.map.decor?.["0,1"]));
      check("★ 装饰回传贴图路径也能被解析成 key#index",
        String(D.map.decor?.["2,1"] ?? "").startsWith("tree#"),
        String(D.map.decor?.["2,1"]));
      check("两种写法解析到的是同一个变体",
        D.map.decor["0,1"] === D.map.decor["2,1"],
        `${D.map.decor["0,1"]} vs ${D.map.decor["2,1"]}`);
      // 再读一次 preview，确认装饰没有在往返中丢掉
      const pv = D.preview;
      check("★ 往返之后 preview.decor 仍有这两棵树",
        Object.keys(pv.decor ?? {}).length === 2,
        JSON.stringify(Object.keys(pv.decor ?? {})));
      check("preview.decor 给的是贴图路径",
        String(pv.decor?.["0,1"]?.[1] ?? "").includes("decor/"),
        JSON.stringify(pv.decor?.["0,1"]));
    }
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
