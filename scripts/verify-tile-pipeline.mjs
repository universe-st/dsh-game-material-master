/**
 * 地图地块模块 · 数据层与流水线自检（M1）。
 *
 * 纯本地、不联网：把「生成」以外的东西全跑一遍 ——
 * 建项目 → 生成模板 → 伪造一份 raw 产物 → 走规整 → 拼图 → 导出 → 失效传播。
 *
 * 「伪造 raw 产物」是刻意的：真实生成要花钱，而这里要验的是它之后的所有环节。
 * 伪造用的样本是**研究期真实生成的 2K 图**（probe/），所以规整走的是真数据。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PROBE = join(ROOT, "research", "tile-isometric", "probe");

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`\n── ${t} ──`);
}

/** 等到没有任务在跑（后台作业是异步的，固定 sleep 不可靠）。 */
async function waitIdle(id, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!G.tileBusy(id)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

const G = await import("../lib/tilegen.js");
const GEOM = await import("../lib/tilegeom.js");
const MEDIA = await import("../lib/tilemedia.js");
const TILEMAP = await import("../lib/tilemap.js");
const { tileJobsRoot } = await import("../lib/config.js");

// 隔离：用一个临时项目，跑完删掉（不污染用户真实的 tile-jobs/）
const projectIds = [];
process.on("exit", () => {
  for (const id of projectIds) {
    try {
      rmSync(join(tileJobsRoot(), id), { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }
});

section("项目 CRUD");
let project;
{
  project = await G.createTileProject("自检项目");
  projectIds.push(project.id);
  check("T1 新建项目：id 形如 t…", /^t[a-z0-9]+$/.test(project.id), project.id);
  check("T2 新建项目：带了默认地块清单", project.items.length >= 14, `${project.items.length} 项`);
  check("T3 默认清单包含 5 类：草/土/石/灌木/建筑",
    ["grass", "dirt", "rock", "bush", "building"].every((k) => project.items.some((i) => i.key === k)));
  check("T4 建筑占 2×2", project.items.find((i) => i.key === "building")?.footprint.join(",") === "2,2");
  check("T5 装饰的 mode = plain", project.items.find((i) => i.key === "tree")?.mode === "plain");
  check("T6 地形的 mode = template", project.items.find((i) => i.key === "grass")?.mode === "template");
  check("T7 五个阶段初始都是 idle",
    G.TILE_STAGES.every((s) => project.stages[s].status === "idle"));

  const read = await G.readTileProject(project.id);
  check("T8 读回项目一致", read !== undefined && read.name === "自检项目");

  const listed = await G.listTileProjects();
  check("T9 项目出现在列表里", listed.some((p) => p.id === project.id));

  // 非法单元格宽必须被拒（菱形半宽要落在整数格上）
  let threw = false;
  try {
    await G.createTileProject("坏参数", { settings: { cellWidth: 70, cellHeight: 96 } });
  } catch {
    threw = true;
  }
  check("T10 cellWidth 不能被 4 整除时拒绝建项目", threw);

  let threw2 = false;
  try {
    await G.createTileProject("坏参数2", { settings: { cellWidth: 64, cellHeight: 32 } });
  } catch {
    threw2 = true;
  }
  check("T11 cellHeight ≤ 菱形高时拒绝建项目", threw2);
}

section("① 模板阶段（本地，免费）");
{
  const started = await G.runTemplateStage(project.id);
  check("T12 模板阶段启动", started.started === true, started.reason ?? "");
  await waitIdle(project.id);
  const dir = G.tileProjectDir(project.id);
  check("T13 产出 template/cell.png", existsSync(join(dir, "template", "cell.png")));
  check("T14 产出 template/grid2x2.png", existsSync(join(dir, "template", "grid2x2.png")));

  const cell = await MEDIA.decodeFile(join(dir, "template", "cell.png"));
  check("T15 模板尺寸 2048×2048", cell.width === 2048 && cell.height === 2048, `${cell.width}×${cell.height}`);

  // 模板几何：量出来的比例必须是 2.0（这是整个模块的地基）
  let left = cell.width, top = cell.height, right = -1, bottom = -1;
  let magenta = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const i = (y * cell.width + x) * 4;
      if (cell.rgba[i + 3] < 128) continue;
      magenta++;
      if (x < left) left = x; if (x > right) right = x;
      if (y < top) top = y; if (y > bottom) bottom = y;
    }
  }
  const w = right - left + 1, h = bottom - top + 1;
  check("T16 模板菱形比例 = 2.000 ± 0.01", Math.abs(w / h - 2) <= 0.01, `实测 ${(w / h).toFixed(4)}`);
  console.log(`  · 模板菱形 ${w}×${h}，比例 ${(w / h).toFixed(4)}，中心 (${((left + right) / 2).toFixed(0)},${((top + bottom) / 2).toFixed(0)})`);
  check("T17 模板是洋红", magenta > 1000);
  check("T18 模板菱形居中", Math.abs((left + right) / 2 - 1024) <= 2 && Math.abs((top + bottom) / 2 - 1024) <= 2);
}

section("② 生成阶段：用研究期的真实 2K 图喂规整（不花钱）");
{
  // 直接把研究期的真实产物拷进 raw/，然后手工走 generateOne 的规整路径
  const probe = join(PROBE, "b8", "G-grass-flash.png");
  if (!existsSync(probe)) {
    console.log("  · probe/ 不存在 —— 跳过真实数据部分");
  } else {
    const dir = G.tileProjectDir(project.id);
    mkdirSync(join(dir, "raw"), { recursive: true });
    mkdirSync(join(dir, "cell"), { recursive: true });
    const rawRel = "raw/grass.v1.png";
    writeFileSync(G.tileAssetPath(project.id, rawRel), readFileSync(probe));

    const decoded = await MEDIA.decodeFile(G.tileAssetPath(project.id, rawRel));
    const m = GEOM.measureGroundDiamond(decoded);
    const sane = GEOM.measurementLooksSane(decoded, m);
    check("T19 真实生成图测量可信", sane === undefined, String(sane));
    check("T20 实测比例 ∈ [1.98, 2.02]", Math.abs(m.ratio - 2) <= 0.02, m.ratio.toFixed(4));

    const { bitmap, report } = GEOM.regularizeToCell(decoded, project.settings, m, "measured");
    const cellRel = "cell/grass.v1.png";
    writeFileSync(G.tileAssetPath(project.id, cellRel), MEDIA.encodeBitmap(bitmap));
    check("T21 规整产物尺寸 = 单元格", bitmap.width === project.settings.cellWidth && bitmap.height === project.settings.cellHeight);
    check("T22 报告 mode = measured", report.mode === "measured");

    await G.patchTileProject(project.id, (fresh) => {
      const item = fresh.items.find((i) => i.key === "grass");
      item.variants[0] = { index: 0, raw: rawRel, cell: cellRel, report, approved: true };
    });
    const after = await G.readTileProject(project.id);
    check("T23 变体被写入 project.json", after.items.find((i) => i.key === "grass").variants[0]?.cell === cellRel);
  }
}

section("形状与模板命名");

// `templateNameFor`：单格沿用老名字 `cell.png`，其余按包围矩形 `grid{C}x{R}.png`
// —— 2×2 正好是 `grid2x2.png`，与老文件名**逐字一致**，所以老项目不用重跑模板。
{
  const cases = [
    [[[0, 0]], "cell.png"],
    [[[0, 0], [0, 1], [1, 0], [1, 1]], "grid2x2.png"],
    [[[0, 0], [0, 1], [0, 2]], "grid3x1.png"],
    [[[0, 0], [1, 0], [2, 0]], "grid1x3.png"],
    [[[0, 0], [1, 0], [1, 1]], "grid2x2.png"],          // L 形的包围矩形正好是 2×2
    [[[0, 0], [0, 1], [0, 2], [1, 1]], "grid3x2.png"]   // T 形 → 3×2
  ];
  const bad = cases.filter(([shape, want]) => G.templateNameFor(shape) !== want)
    .map(([shape, want]) => `${JSON.stringify(shape)} → ${G.templateNameFor(shape)}（期望 ${want}）`);
  check("templateNameFor：单格 cell.png、其余 grid{C}x{R}.png（2×2 与老名一致）",
    bad.length === 0, bad.join(" | "));
}

// 形状规范化：老数据只有 footprint，必须能无损读成矩形；格子集合去重排序。
{
  check("normalizeShape：只有 footprint → 矩形形状",
    JSON.stringify(G.normalizeShape({ footprint: [3, 1] }, undefined))
      === JSON.stringify([[0, 0], [0, 1], [0, 2]]),
    JSON.stringify(G.normalizeShape({ footprint: [3, 1] }, undefined)));
  check("normalizeShape：给 shape 就用它（L 形保留，且排序去重）",
    JSON.stringify(G.normalizeShape({ shape: [[1, 1], [0, 0], [1, 0]] }, undefined))
      === JSON.stringify([[0, 0], [1, 0], [1, 1]]),
    JSON.stringify(G.normalizeShape({ shape: [[1, 1], [0, 0], [1, 0]] }, undefined)));
  check("normalizeShape：非法 shape 退回 footprint",
    JSON.stringify(G.normalizeShape({ shape: [[-1, 0]], footprint: [2, 1] }, undefined))
      === JSON.stringify([[0, 0], [0, 1]]),
    JSON.stringify(G.normalizeShape({ shape: [[-1, 0]], footprint: [2, 1] }, undefined)));
  check("normalizeShape：都没有 → 退回 previous 的形状",
    JSON.stringify(G.normalizeShape({}, { shape: [[0, 0], [1, 1]] }))
      === JSON.stringify([[0, 0], [1, 1]]),
    JSON.stringify(G.normalizeShape({}, { shape: [[0, 0], [1, 1]] })));
  check("boundingRectOf：L 形的包围矩形是 2×2",
    JSON.stringify(G.boundingRectOf([[0, 0], [1, 0], [1, 1]])) === JSON.stringify([2, 2]),
    JSON.stringify(G.boundingRectOf([[0, 0], [1, 0], [1, 1]])));
  check("rectOfShape：实心矩形返回尺寸，L 形返回 undefined",
    JSON.stringify(G.rectOfShape([[0, 0], [0, 1], [1, 0], [1, 1]])) === JSON.stringify([2, 2])
    && G.rectOfShape([[0, 0], [1, 0], [1, 1]]) === undefined,
    `${JSON.stringify(G.rectOfShape([[0, 0], [1, 0], [1, 1]]))}`);
}

section("相对路径一律用正斜杠（会被拼进资源路由 URL）");
{
  // ⚠️ 这条钉的是一个只在 Windows 上「看着正常」的坑：
  // 存进 project.json 的相对路径如果用了 `join()`，Windows 上会得到
  // `cell\grass.v1.png`，而它会被直接拼进 `${assetBase}${relative}` 当 URL 用。
  // 浏览器宽容地把 `\` 当分隔符，所以本地不报错；换到 POSIX 文件名就对不上。
  const dash = await G.readTileProject(project.id);
  const relatives = [];
  for (const item of dash.items) {
    for (const variant of item.variants) {
      if (typeof variant.cell === "string") relatives.push(variant.cell);
      if (typeof variant.raw === "string") relatives.push(variant.raw);
    }
  }
  if (typeof dash.map.png === "string") relatives.push(dash.map.png);
  if (typeof dash.map.json === "string") relatives.push(dash.map.json);
  const withBackslash = relatives.filter((rel) => rel.includes("\\"));
  check("T23b 项目里的相对路径没有反斜杠", withBackslash.length === 0,
    withBackslash.join(" / ") || `共检查 ${relatives.length} 条`);
  check("T23c 相对路径都是「第一段/文件名」形态",
    relatives.length > 0 && relatives.every((rel) => /^[a-z0-9]+\/.+/.test(rel)),
    relatives.slice(0, 3).join(" / "));
  // 资源路由的目录白名单必须认得第一段
  const firstSegments = [...new Set(relatives.map((rel) => rel.split("/")[0]))];
  check("T23d 相对路径的第一段都在可服务目录白名单里",
    firstSegments.every((seg) => G.SERVABLE_TILE_DIRS.has(seg)), firstSegments.join("、"));
}

section("④ 拼图阶段（本地，免费）");
{
  const dir = G.tileProjectDir(project.id);
  // 再补一个装饰与一个建筑，让拼图有多样性
  const treeProbe = join(PROBE, "b13", "D-treeA-white.png");
  const buildProbe = join(PROBE, "b9", "H1-grid-flash.png");
  if (existsSync(treeProbe)) {
    mkdirSync(join(dir, "decor"), { recursive: true });
    const decoded = await MEDIA.decodeFile(treeProbe);
    const { bitmap, report } = GEOM.regularizeDecorSprite(decoded, project.settings);
    const rel = "decor/tree.v1.png";
    writeFileSync(G.tileAssetPath(project.id, rel), MEDIA.encodeBitmap(bitmap));
    await G.patchTileProject(project.id, (fresh) => {
      const item = fresh.items.find((i) => i.key === "tree");
      item.variants[0] = { index: 0, cell: rel, report: { mode: "sprite", scale: [report.scale, report.scale] }, approved: true };
    });
    check("T24 装饰规整产物写到 decor/", existsSync(G.tileAssetPath(project.id, rel)));
  }
  if (existsSync(buildProbe)) {
    const decoded = await MEDIA.decodeFile(buildProbe);
    const geom = { centerX: decoded.width / 2, centerY: decoded.height / 2, halfWidth: decoded.width * 0.46, halfHeight: decoded.width * 0.23 };
    const { bitmap } = GEOM.regularizeToCell(decoded, project.settings, geom, "template");
    const rel = "cell/building.v1.png";
    writeFileSync(G.tileAssetPath(project.id, rel), MEDIA.encodeBitmap(bitmap));
    await G.patchTileProject(project.id, (fresh) => {
      const item = fresh.items.find((i) => i.key === "building");
      item.variants[0] = { index: 0, cell: rel, report: { mode: "template", scale: [0.068, 0.068] }, approved: true };
    });
  }

  const started = await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0.15 });
  check("T25 拼图阶段启动", started.started === true, started.reason ?? "");
  await waitIdle(project.id);
  check("T26 产出 map/map.png", existsSync(join(dir, "map", "map.png")));
  check("T27 产出 map/map.json", existsSync(join(dir, "map", "map.json")));

  const after = await G.readTileProject(project.id);
  check("T28 项目里记下了 map.png 路径", after.map.png === "map/map.png");
  check("T29 stage map = done", after.stages.map.status === "done", after.stages.map.status);

  const mapJson = JSON.parse(readFileSync(join(dir, "map", "map.json"), "utf8"));
  check("T30 map.json 记录了 rows/cols/seed", mapJson.rows === 6 && mapJson.cols === 6 && mapJson.seed === 7);

  const map = await MEDIA.decodeFile(join(dir, "map", "map.png"));
  check("T31 地图比单元格大", map.width > 200 && map.height > 200, `${map.width}×${map.height}`);

  // ★ 回归：类别 ≠ 地块键时不能误报「没有已生成的图」。
  // 默认清单里 `dirt2` 的类别是 `dirt`，而预校验一度拿**类别**表去查**地块键**，
  // 于是「拼成地图」直接报「这些类别还没有已生成的地块：dirt2」——
  // 而 dirt2 明明已经生成好了，整个第 ④ 步不可用。
  {
    const dirt2 = G.defaultTileItems().find((i) => i.key === "dirt2");
    check("T31g dirt2 的类别与键不同（回归前提成立）",
      dirt2 !== undefined && dirt2.family !== dirt2.key,
      JSON.stringify({ key: dirt2?.key, family: dirt2?.family }));
  }

  // ★ 建筑：模板必须是「地基 + 立体空间」，不能是一整块实心洋红菱形。
  // 旧的实心模板会让模型把它理解成「把这块地面填满」，生成出一张平铺的菱形石板。
  {
    const tpl = GEOM.renderBuildingTemplate({ settings: project.settings, size: 512 });
    check("T31h 建筑模板不是正方形（留出了向上生长的空间）",
      tpl.bitmap.width > 0 && tpl.bitmap.height > 0 && tpl.bitmap.height !== tpl.bitmap.width,
      `${tpl.bitmap.width}x${tpl.bitmap.height}`);
    let wire = 0, magenta = 0, ground = 0;
    for (let i = 0; i < tpl.bitmap.width * tpl.bitmap.height; i++) {
      const o = i * 4;
      if (tpl.bitmap.rgba[o + 3] < 128) continue;
      const r = tpl.bitmap.rgba[o], g = tpl.bitmap.rgba[o + 1], b = tpl.bitmap.rgba[o + 2];
      if (b > 200 && r < 170 && g > 150) wire++;
      else if (r > 240 && g < 30 && b > 240) magenta++;
      else if (r > 200 && g > 200 && b > 200) ground++;
    }
    check("T31i 建筑模板有蓝色立体线框（表示能长多高）", wire > 100, `${wire} 像素`);
    check("T31j 建筑模板有洋红地基轮廓", magenta > 100, `${magenta} 像素`);
    check("T31k 建筑模板有浅灰地面（地基是地不是墙）", ground > 100, `${ground} 像素`);
    const layout = GEOM.buildingTemplateLayout(project.settings);
    check("T31l 模板高度 = 地基 + 生长空间",
      layout.boxH > 0 && layout.baseCenterY < layout.height,
      JSON.stringify(layout));
  }

  // ★ map.pixel：界面叠「可点格子」时要用它把等距坐标平移到裁剪后的画布上。
  // 少了它，叠层与预览图整体错位（地图看着对、点到的格子全错）。
  {
    // ⚠️ 先重置成一份干净的 6×6 满铺布局再测：后面几节会把 cells 改成带空格的小布局，
    // 那些状态（空的格子 + 旧的 pixel）会让 PNG 的裁剪包围盒与「满铺 6×6」的理论值对不上。
    await G.patchTileProject(project.id, (fresh) => {
      fresh.map = { ...fresh.map, rows: 6, cols: 6, seed: 7, cells: [], decor: {}, buildings: [], png: undefined, json: undefined, pixel: undefined };
    });
    await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 7, fill: "grass" });
    await waitIdle(project.id);
    const clean = await G.readTileProject(project.id);
    const cleanMap = await MEDIA.decodeFile(join(dir, "map", "map.png"));
    const layout = TILEMAP.tileLayout(clean.settings, 6, 6, 2);
    const pixel = clean.map.pixel;
    check("T31b 项目里记下了 map.pixel", pixel !== undefined, JSON.stringify(pixel));
    check("T31c map.pixel 的尺寸 = 实际 PNG 尺寸",
      pixel.width === cleanMap.width && pixel.height === cleanMap.height,
      `pixel ${pixel?.width}×${pixel?.height} vs PNG ${cleanMap.width}×${cleanMap.height}`);
    check("T31d map.pixel 的尺寸不超过未裁画布",
      pixel.width <= layout.canvasW && pixel.height <= layout.canvasH,
      `pixel ${pixel.width}×${pixel.height} vs layout ${layout.canvasW}×${layout.canvasH}`);
    check("T31e 叠层坐标（未裁 − 偏移）都落在 PNG 范围内",
      pixel.left >= 0 && pixel.top >= 0, JSON.stringify(pixel));
    // 逐格验证：叠层用的「未裁坐标 − 偏移」必须**落在成品图范围内**。
    //
    // 坐标系（实测确认，别弄混）：
    //   · `tileLayout(..., scale=2)` 与 `tileOriginAt` 给的是**放大后（2×）**的坐标；
    //   · `map.pixel.left/top` 也是 2× 的裁剪偏移；
    //   · 菱形在 64×96 贴图里位于 (0,31)-(63,64)，中心是**1× 的**局部 (32,48)。
    // 把 1× 的 (32,48) 直接加到 2× 的原点上就会错半个格子（实测 1 格假越界）。
    let outside = 0;
    let firstBad = "";
    const scale = pixel.scale ?? 2;
    const halfW = (clean.settings.cellWidth / 2) * scale;
    const halfH = (clean.settings.cellWidth / 4) * scale;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const at = TILEMAP.tileOriginAt(layout, r, c);
        const cx = at.x + 32 * scale - pixel.left;
        const cy = at.y + 48 * scale - pixel.top;
        const bad = (cx - halfW < -1 || cx + halfW > cleanMap.width + 1 || cy - halfH < -1 || cy + halfH > cleanMap.height + 1);
        if (bad) {
          outside++;
          if (firstBad === "") {
            firstBad = `(${r},${c}) 中心(${cx},${cy}) span x ${cx - halfW}..${cx + halfW} y ${cy - halfH}..${cy + halfH}` +
              `，容器 ${cleanMap.width}×${cleanMap.height}`;
          }
        }
      }
    }
    check("T31f 所有格子的菱形平移后都落在成品图内", outside === 0, `${outside} 格越界；首个：${firstBad}`);

    // 把状态放回 T25~T29 留下的那份，免得后面的可复现性断言读到别的布局。
    // （原样重铺一次即可 —— 同种子同参数就是那份图。）
    await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0.15 });
    await waitIdle(project.id);
  }

  // 可复现性：同种子重拼必须逐像素一致
  const first = readFileSync(join(dir, "map", "map.png"));
  await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0.15 });
  await waitIdle(project.id);
  const second = readFileSync(join(dir, "map", "map.png"));
  check("T32 同种子重拼 → 逐像素一致", first.equals(second));

  // 换种子**在「沿用已存布局」这条路径上不一定改变像素**：
  // 布局里每格用哪个类别是存下来的，若每个类别只有 1 个变体，换种子也抽不出别的图。
  // 所以这里分两种情况断言：
  //   · 先清掉布局（回到「按 fill 铺满」）—— 换种子必然改抽到的变体 / 装饰
  //   · 再验证「有存布局时，同种子仍然逐像素一致」（那才是可复现性的真正含义）
  await G.patchTileProject(project.id, (fresh) => {
    fresh.map = { ...fresh.map, cells: [] };
  });
  await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 99, fill: "grass" });
  await waitIdle(project.id);
  const third = readFileSync(join(dir, "map", "map.png"));
  check("T33 换种子 → 结果不同（无存布局时）", !first.equals(third));

  // 有了存布局之后：同种子必须仍然逐像素一致（手改布局不影响可复现性）
  {
    // 只用这个测试项目里真的有产物的类别：grass（地形）、tree（装饰）、building（建筑）
    const layout = [
      ["grass", "grass", "grass", "grass", "grass", "grass"],
      ["grass", "tree", "grass", "grass", "tree", "grass"],
      ["grass", "grass", "grass", "grass", "grass", "grass"],
      ["grass", "grass", "grass", "building", "building", "grass"],
      ["grass", "tree", "grass", "building", "building", "grass"],
      ["grass", "grass", "grass", "grass", "tree", "grass"]
    ];
    await G.patchTileProject(project.id, (fresh) => {
      fresh.map = { ...fresh.map, cells: layout, rows: 6, cols: 6 };
    });
    await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0.1 });
    await waitIdle(project.id);
    const a = readFileSync(join(dir, "map", "map.png"));
    await G.runMapStage(project.id, { rows: 6, cols: 6, seed: 7, fill: "grass", decorDensity: 0.1 });
    await waitIdle(project.id);
    const b = readFileSync(join(dir, "map", "map.png"));
    check("T33b 有手改布局时同种子仍逐像素一致", a.equals(b));

    // ★ 最关键的一条：传了覆盖参数（界面永远会传 decorDensity）也不能丢掉手改布局。
    //
    // ⚠️ 注意比的是「**渲染后的地面**」而不是原样那份 layout：
    // `layout` 里的 `tree` / `building` 是**单层时代的写法**（把装饰与建筑当格子键涂）。
    // 拼图会把它们升格成真正的装饰/建筑，并把那几格补成默认地面 ——
    // 留空的话正是真机上那些「白色菱形洞」。
    //
    // 建筑占格也补地面（不是清空）：清了的话建筑底面菱形的四角会露出纯色垫底。
    const mappedJson = JSON.parse(readFileSync(join(dir, "map", "map.json"), "utf8"));
    const expectedGround = layout.map((row) => row.map((k) => (k === "tree" || k === "building" ? "grass" : k)));
    check("T33c 传覆盖参数时手改布局被保留（不会被 fill 覆盖掉）",
      JSON.stringify(mappedJson.cells) === JSON.stringify(expectedGround),
      JSON.stringify(mappedJson.cells?.[0] ?? null));
    check("T33c2 布局里的装饰键被升格成真正的装饰（不再只是格子键）",
      Object.keys(mappedJson.decor ?? {}).length >= 4,
      JSON.stringify(mappedJson.decor));
    check("T33c3 布局里的建筑键被升格成建筑记录",
      (mappedJson.buildings ?? []).length === 1,
      JSON.stringify(mappedJson.buildings));
    const afterLayout = await G.readTileProject(project.id);
    check("T33d 项目里存的布局也还是手改的那份",
      JSON.stringify(afterLayout.map.cells) === JSON.stringify(expectedGround));
    check("T33d2 项目里的装饰与建筑也一并留着",
      Object.keys(afterLayout.map.decor ?? {}).length >= 4 &&
      (afterLayout.map.buildings ?? []).length === 1,
      JSON.stringify({ decor: Object.keys(afterLayout.map.decor ?? {}).length, buildings: afterLayout.map.buildings }));
  }

  // 没有已生成地块时必须明确报错，而不是产出一张空图
  let threw = false;
  try {
    await G.runMapStage(project.id, { rows: 4, cols: 4, fill: "不存在的类别" });
  } catch {
    threw = true;
  }
  check("T34 用不存在的类别拼图会报错（而不是输出空图）", threw);
}

section("⑤ 导出阶段（本地，免费）");
{
  const dir = G.tileProjectDir(project.id);
  const started = await G.runExportStage(project.id);
  check("T35 导出阶段启动", started.started === true, started.reason ?? "");
  await waitIdle(project.id);
  check("T36 产出 export/map.png", existsSync(join(dir, "export", "map.png")));
  check("T37 产出 export/map.json", existsSync(join(dir, "export", "map.json")));
  check("T38 产出 export/tiles/ 下的地块", existsSync(join(dir, "export", "tiles", "grass.v1.png")));
  const after = await G.readTileProject(project.id);
  check("T39 stage export = done", after.stages.export.status === "done", after.stages.export.status);
}

section("失效传播（改上游 → 下游作废）");
{
  await G.patchTileProject(project.id, (fresh) => {
    G.invalidateFrom(fresh, "generate");
  });
  const after = await G.readTileProject(project.id);
  check("T40 作废 generate → 地块变体被清空", after.items.every((i) => i.variants.length === 0));
  check("T41 作废 generate → map 也作废", after.map.png === undefined);
  check("T42 作废 generate → stage 全部回到 idle",
    ["generate", "review", "map", "export"].every((s) => after.stages[s].status === "idle"));

  // 只作废 map 时，地块必须保住（那是花钱买的）
  await G.patchTileProject(project.id, (fresh) => {
    fresh.items.find((i) => i.key === "grass").variants[0] = { index: 0, cell: "cell/grass.v1.png" };
    fresh.stages.generate = { status: "done" };
    G.invalidateFrom(fresh, "map");
  });
  const after2 = await G.readTileProject(project.id);
  check("T43 只作废 map → 地块保住", after2.items.find((i) => i.key === "grass").variants.length === 1);
  check("T44 只作废 map → generate 仍是 done", after2.stages.generate.status === "done");
}

section("提示词构造");
{
  const grass = project.items.find((i) => i.key === "grass");
  const decor = project.items.find((i) => i.key === "tree");
  const building = project.items.find((i) => i.key === "building");
  const p1 = G.buildTilePrompt(grass, project.style);
  const p2 = G.buildTilePrompt(decor, project.style);
  const p3 = G.buildTilePrompt(building, project.style);
  check("T45 地形提示词带固定前缀", p1.startsWith(G.TERRAIN_PREFIX.slice(0, 20)));
  check("T46 地形提示词包含内容描述", p1.includes(grass.content.slice(0, 10)));
  check("T47 地形提示词包含画风", p1.includes(project.style.slice(0, 10)));
  check("T48 装饰提示词用白底（不是透明）", p2.startsWith(G.DECOR_PREFIX) && p2.includes("纯白色背景"));
  check("T49 装饰提示词不含「透明」", !p2.includes("透明"));
  // 建筑提示词必须说清「底面 = 浅灰地基、往上长高」，并**明确禁止**把地基
  // 涂成一块平铺地面 —— 旧的实心洋红菱形模板就是这么让模型画出一张菱形石板的。
  check("T50 建筑提示词说明底面地基与向上长高",
    p3.includes("地基") && p3.includes("向上") && p3.includes("屋顶") &&
    (p3.includes("平铺") || p3.includes("有高度")),
    p3.slice(0, 140));
  check("T50b 建筑提示词不再用「在这个范围内画一栋建筑」这种含糊说法",
    !p3.includes("请在这个范围内画一栋建筑"));
  check("T51 中文默认文案是中文", G.defaultTileStyle().includes("像素画"));
  check("T52 英文默认文案是英文", G.defaultTileStyle("en").includes("pixel-art"));
  check("T53 中英清单条目数一致",
    G.defaultTileItems().length === G.defaultTileItems("en").length,
    `${G.defaultTileItems().length} vs ${G.defaultTileItems("en").length}`);
}

section("汇总视图与摘要");
{
  const view = G.tileView(await G.readTileProject(project.id));
  // 视图给界面用：产物是**相对**路径 + 一个 assetBase，由浏览器自己拼 origin
  check("T54 tileView 带 assetBase", typeof view.assetBase === "string" && view.assetBase.endsWith("/"), view.assetBase);
  check("T54b assetBase 指向本模块的资源路由",
    view.assetBase === `/dsh-game-material-master/tile-assets/${project.id}/`, view.assetBase);
  // 对话工具用另一份快照：产物必须是**绝对** URL（会直接贴给用户点）
  const snap = G.tileSnapshot(await G.readTileProject(project.id), "http://127.0.0.1:19387");
  const firstUrl = snap.items.flatMap((i) => i.variants).map((v) => v.url).find((u) => typeof u === "string");
  check("T55 tileSnapshot 的产物是绝对 URL", typeof firstUrl === "string" && firstUrl.startsWith("http://127.0.0.1:19387/"), String(firstUrl));
  check("T55b tileSnapshot 带进度统计", typeof snap.progress?.expected === "number" && snap.progress.expected > 0);
  check("T55c tileSnapshot 带地图信息", snap.map !== undefined && typeof snap.map.ready === "boolean");
  const summary = G.summarizeTileProject(await G.readTileProject(project.id));
  check("T56 摘要统计 expectedCount > 0", summary.expectedCount > 0, String(summary.expectedCount));
  check("T57 isValidTileProjectId 认得自己的 id", G.isValidTileProjectId(project.id));
  check("T58 isValidTileProjectId 拒绝别的模块的 id", !G.isValidTileProjectId("p123456"));
  check("T59 单元目录白名单齐备",
    ["template", "raw", "cell", "decor", "map", "export"].every((d) => G.SERVABLE_TILE_DIRS.has(d)));
}

section("作业与并发保护");
{
  check("T60 空闲时 tileBusy = false", G.tileBusy(project.id) === false);
  const job = G.currentTileJob(project.id);
  check("T61 没有在跑时 tileBusy = false", G.tileBusy(project.id) === false);
  check("T61b 完成后的作业记录保留（界面要显示最终状态）", job !== undefined && job.running === null);
}

console.log(`\n${"═".repeat(60)}`);
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log("\n失败清单：");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("地图地块数据层与流水线自检全绿 ✅");

void writeFileSync;
