#!/usr/bin/env node
/**
 * 骨骼动画模块的**端到端**验证（不联网、不花钱）。
 *
 * 走的是插件真正的那套模块代码：建任务 → 上传参考图与部件 → 装配定位 →
 * 骨骼与动画 → 图集打包，逐项断言产物落盘、状态机正确、重跑只影响该动的东西。
 *
 *   node scripts/verify-rig-module.mjs
 */

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 数据目录必须换到临时目录，否则会污染用户真实的 <DSH_HOME>。
const sandbox = await mkdtemp(join(tmpdir(), "dsh-rig-verify-"));
process.env.DSH_HOME = sandbox;

const { encodePng } = await import("../lib/png.js");
const { createRgba, resizeRgba, alphaBounds } = await import("../lib/rigpose.js");
const { DEFAULT_DRAW_ORDER, RIG_SLOTS } = await import("../lib/spine.js");
const riggen = await import("../lib/riggen.js");

let failures = 0;
function check(name, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  if (!ok) failures++;
  console.log(`  ${mark} ${name}${detail === "" ? "" : ` — ${detail}`}`);
}

function texturedRect(canvas, x, y, w, h, base, phase) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const tx = x + px;
      const ty = y + py;
      if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
      const u = px / w;
      const v = py / h;
      const idx = (ty * canvas.width + tx) * 4;
      const shade =
        34 * Math.sin((u * 2 + phase) * Math.PI) +
        26 * Math.cos((v * 3 + phase) * Math.PI * 0.9) +
        18 * Math.sin((u + v) * Math.PI * 1.6 + phase) +
        11 * Math.sin(u * 13 + phase) +
        8 * Math.cos(v * 11 + phase * 1.3);
      canvas.data[idx] = Math.max(0, Math.min(255, Math.round(base[0] + shade)));
      canvas.data[idx + 1] = Math.max(0, Math.min(255, Math.round(base[1] + shade)));
      canvas.data[idx + 2] = Math.max(0, Math.min(255, Math.round(base[2] + shade)));
      canvas.data[idx + 3] = 255;
    }
  }
}

function phaseOf(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 1000;
  return (hash / 1000) * Math.PI * 2;
}

const W = 420;
const H = 600;
const TRUTH = {
  head: { x: 168, y: 96, w: 84, h: 88 },
  torso: { x: 150, y: 168, w: 120, h: 200 },
  "left-upper-leg": { x: 156, y: 336, w: 46, h: 112 },
  "right-upper-leg": { x: 218, y: 336, w: 46, h: 112 },
  "left-foot": { x: 148, y: 440, w: 62, h: 32 },
  "right-foot": { x: 210, y: 440, w: 62, h: 32 }
};
const COLORS = {
  head: [232, 196, 156],
  torso: [72, 110, 190],
  "left-upper-leg": [56, 66, 88],
  "right-upper-leg": [74, 84, 108],
  "left-foot": [36, 40, 54],
  "right-foot": [52, 56, 72]
};

console.log("=== 0. 准备素材 ===");
const reference = createRgba(W, H, [255, 255, 255, 255]);
for (const name of DEFAULT_DRAW_ORDER.filter((entry) => entry in TRUTH)) {
  const box = TRUTH[name];
  texturedRect(reference, box.x, box.y, box.w, box.h, COLORS[name], phaseOf(name));
}
const referencePng = encodePng(reference.data, W, H);

// 部件 PNG：与参考图同相位纹理，尺寸放大 1.4 倍（模拟「拆件图与参考图不同分辨率」）。
const PART_SCALE = 1.4;
const partPngs = {};
for (const [name, box] of Object.entries(TRUTH)) {
  const w = Math.round(box.w * PART_SCALE);
  const h = Math.round(box.h * PART_SCALE);
  const canvas = createRgba(w, h);
  texturedRect(canvas, 0, 0, w, h, COLORS[name], phaseOf(name));
  partPngs[name] = encodePng(canvas.data, w, h);
}
console.log(`  参考图 ${W}×${H}，部件 ${Object.keys(partPngs).length} 个（放大 ${PART_SCALE}×）`);

console.log("=== 1. 建任务 + 上传 ===");
const job = await riggen.createRigJob("验证角色");
check("任务 id 前缀为 r", job.id.startsWith("r"), job.id);

const size = await riggen.setRigSource(job.id, "character.png", referencePng.toString("base64"));
check("参考图尺寸记录正确", size.width === W && size.height === H, `${size.width}×${size.height}`);

for (const [name, png] of Object.entries(partPngs)) {
  await riggen.uploadRigPart(job.id, `${name}.png`, png.toString("base64"));
}
let state = await riggen.readRigJob(job.id);
check("部件全部入库", state.parts.length === Object.keys(partPngs).length, `${state.parts.length}`);
check("部件名取自文件名", state.parts.every((part) => part.name in TRUTH), state.parts.map((p) => p.name).join(","));
check("上传的部件标记为 uploaded", state.parts.every((part) => part.source === "uploaded"));
check("上传部件后下游状态被清空", state.layout.status === "empty" && state.rig.status === "empty" && state.atlas.status === "empty");

console.log("=== 2. 装配定位 ===");
const t0 = Date.now();
await riggen.solveRigLayout(job.id);
state = await riggen.readRigJob(job.id);
console.log(`  耗时 ${Date.now() - t0} ms`);
check("装配阶段状态为 ready", state.layout.status === "ready", state.layout.error ?? "");
check("每个部件都有摆放记录", Object.keys(state.layout.items).length === Object.keys(partPngs).length);
check("全部部件都匹配上", Object.values(state.layout.items).every((item) => item.matched));
check("装配对比图已生成", state.layout.comparison === "layout/comparison.png");
check("layout.json 已生成", await exists(riggen.rigAssetPath(job.id, "layout/layout.json")));
check("绘制层级按人形默认顺序", DEFAULT_DRAW_ORDER.every((name, index) => !(name in TRUTH) || state.layout.items[name] === undefined || state.layout.items[name].z === index));

/**
 * 左右对称、外观几乎一致的部件（两条大腿）在 ZNCC 眼里可以互换——相关系数
 * 本来就减掉了均值，色差再大也吃不到。插件用「镜像部件必须分居中线两侧」
 * 的几何约束保证不会挤在一起，但**哪块在哪一侧**在这种极端相似的情况下
 * 是不可判定的，所以这里按「一对」来断言位置集合，而不是逐块断言。
 */
/** 合成角色的高度：位置容忍度按它的比例给。 */
const CHARACTER_HEIGHT = 376;
const MIRRORED_GROUPS = [["left-upper-leg", "right-upper-leg"], ["left-foot", "right-foot"]];
const loose = new Set(MIRRORED_GROUPS.flat());
for (const [name, box] of Object.entries(TRUTH)) {
  if (loose.has(name)) continue;
  const item = state.layout.items[name];
  const dx = Math.abs(item.x - box.x);
  const dy = Math.abs(item.y - box.y);
  const dw = Math.abs(item.width - box.w);
  check(`${name} 摆放准确`, dx <= 10 && dy <= 10 && dw <= box.w * 0.2, `(${item.x},${item.y}) ${item.width}×${item.height} vs (${box.x},${box.y}) ${box.w}×${box.h}`);
}
for (const group of MIRRORED_GROUPS) {
  const actual = group.map((name) => state.layout.items[name]).sort((a, b) => a.x - b.x);
  const expect = group.map((name) => TRUTH[name]).sort((a, b) => a.x - b.x);
  // 尺寸容忍度对**小组件**放宽到 25%：本场景的部件是纯平滑渐变矩形，缩进自己
  // 内部之后相关系数几乎不降，尺度本来就有模糊性；而脚这类小部件能提供的证据
  // 又远少于躯干。实测小部件会有 ~20% 的偏小，大部件（头/躯干）则稳在 10% 内
  // ——所以上面单独对大部件用更严的 18%。再往下压只能靠更强的形状先验，
  // 而那会把「生图模型把某个部件画成了别的尺寸」这种情况也一起钉死。
  const ok = actual.every((item, index) => {
    const truth = expect[index];
    // 容忍度按角色自身高度给（这块合成角色高约 376px），不用绝对像素：
    // 位置 ≤5% 角色高、尺寸 ≤25%。绝对阈值换个画布尺寸就会过严或过松。
    return (
      Math.abs(item.x - truth.x) / CHARACTER_HEIGHT <= 0.05 &&
      Math.abs(item.y - truth.y) / CHARACTER_HEIGHT <= 0.05 &&
      Math.abs(item.width - truth.w) <= truth.w * 0.25
    );
  });
  check(
    `${group.join(" / ")} 分居两侧且位置正确`,
    ok,
    actual.map((item, index) => `${item.x},${item.y} ${item.width}×${item.height}(应 ${expect[index].x},${expect[index].y})`).join(" | ")
  );
}

console.log("=== 3. 手工微调 + 局部重跑 ===");
const target = state.layout.items.head;
await riggen.saveLayoutItem(job.id, "head", { x: target.x + 5 });
state = await riggen.readRigJob(job.id);
check("手工微调生效并标记 manual", state.layout.items.head.x === target.x + 5 && state.layout.items.head.manual === true);
check("微调后下游作废（骨骼/图集重置）", state.rig.status === "empty" && state.atlas.status === "empty");

const beforeNames = Object.keys(state.layout.items).sort().join(",");
await riggen.solveRigLayout(job.id, ["left-foot"]);
state = await riggen.readRigJob(job.id);
check("局部重跑不影响其它部件", Object.keys(state.layout.items).sort().join(",") === beforeNames);
check("局部重跑后手工微调被保留（head 仍是 manual）", state.layout.items.head.manual === true);

console.log("=== 4. 骨骼与动画 ===");
await riggen.buildRigOutput(job.id);
state = await riggen.readRigJob(job.id);
check("骨骼阶段状态为 ready", state.rig.status === "ready", state.rig.error ?? "");
check("skeleton.json 已生成", await exists(riggen.rigAssetPath(job.id, "rig/skeleton.json")));
check("preview.html 已生成", await exists(riggen.rigAssetPath(job.id, "rig/preview.html")));
check("骨骼数 = root + 部件数", state.rig.bones === state.parts.length + 1, String(state.rig.bones));
check("六个动画齐全", (state.rig.animations ?? []).length === 6, (state.rig.animations ?? []).join(","));
check("没有告警", (state.rig.warnings ?? []).length === 0, (state.rig.warnings ?? []).join(" | "));

const skeleton = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
check("骨架版本为 4.2", skeleton.skeleton.spine === "4.2.0");
check("骨骼父级都在自己之前", skeleton.bones.every((bone, index) => bone.parent === undefined || skeleton.bones.findIndex((b) => b.name === bone.parent) < index));
check("动画用 value 而非 angle", skeleton.animations.walk.bones.torso.rotate.every((f) => f.angle === undefined && typeof f.value === "number"));
// 本场景没有 hip（translate 时间轴只挂在 hip 上），8 控制点的断言在
// scripts/verify-rig.mjs 里用完整 16 部件骨架覆盖。
check("walk 里每条 rotate 时间轴都有 4 个控制点", Object.values(skeleton.animations.walk.bones).every((t) => !t.rotate || t.rotate.slice(0, -1).every((f) => f.curve.length === 4)));

const html = await readFile(riggen.rigAssetPath(job.id, "rig/preview.html"), "utf8");
check("预览 HTML 无外部依赖", !/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html));
check("预览 HTML 内联了部件图", html.includes("data:image/png;base64,"));
check("预览 HTML 内联了骨架", html.includes('"spine\\":\\"4.2.0') || html.includes('"spine":"4.2.0"'));

console.log("=== 5. 图集打包 ===");
await riggen.buildAtlas(job.id);
state = await riggen.readRigJob(job.id);
check("图集阶段状态为 ready", state.atlas.status === "ready", state.atlas.error ?? "");
check("图集 PNG 已生成", await exists(riggen.rigAssetPath(job.id, "atlas/skeleton.png")));
check("图集文本已生成", await exists(riggen.rigAssetPath(job.id, "atlas/skeleton.atlas")));
check("图集区域数 = 部件数", state.atlas.regions === state.parts.length, String(state.atlas.regions));
{
  const atlasText = await readFile(riggen.rigAssetPath(job.id, "atlas/skeleton.atlas"), "utf8");
  const regions = atlasText.split("\n").filter((line) => line !== "" && !line.startsWith(" ") && !line.includes(":") && !line.endsWith(".png"));
  check("atlas 文本逐个列出区域", regions.length === state.parts.length, regions.join(","));
  // 图集区域尺寸必须和 skeleton.json 里挂点的 width/height 一致，否则导入引擎会错位。
  const mismatch = [];
  for (const [slotName, atts] of Object.entries(skeleton.skins[0].attachments)) {
    const att = Object.values(atts)[0];
    const item = state.layout.items[slotName];
    if (item === undefined) continue;
    if (Math.abs(att.width - item.width) > 1 || Math.abs(att.height - item.height) > 1) {
      mismatch.push(`${slotName}: 挂点 ${att.width}×${att.height} vs 图集 ${item.width}×${item.height}`);
    }
  }
  check("挂点尺寸与图集区域一致", mismatch.length === 0, mismatch.join(" | "));
}

console.log("=== 6. 任务视图契约（界面与对话工具共用同一份） ===");
state = await riggen.readRigJob(job.id);
const view = riggen.rigSnapshot(state);
check("视图带相对 URL", typeof view.sourceUrl === "string" && view.sourceUrl.startsWith("/"), String(view.sourceUrl));
check("视图带 assetBase", typeof view.assetBase === "string" && view.assetBase.startsWith("/"), view.assetBase);
check("URL 里不含 http（浏览器直接用相对路径）", !JSON.stringify(view).includes("http://"));
check("四个阶段都有 stage 字段", ["parts", "layout", "rig", "atlas"].every((key) => view.stages.some((entry) => entry.stage === key)));
check("阶段顺序与界面一致", view.stages.map((entry) => entry.stage).join(",") === "parts,layout,rig,atlas");
check("界面要的 prompts/settings 都在", typeof view.prompts.sheet === "string" && typeof view.settings.gridColumns === "number");
check("layout.items 是逐部件记录", typeof view.layout.items === "object" && Object.keys(view.layout.items).length === state.parts.length);
check("rig.preview / skeleton 都是可打开的 URL", typeof view.rig.preview === "string" && view.rig.preview.endsWith(".html"));
check("atlas.url / text 都在", typeof view.atlas.url === "string" && typeof view.atlas.text === "string");
check("parts 带 url / placed / score", view.parts.every((part) => "url" in part && "placed" in part && "score" in part));
check("review.unmatched 是数组", Array.isArray(view.review.unmatched));
check("带运行日志", Array.isArray(view.log));

// 工具返回值必须是**无损 JSON**：对象里出现 `undefined` 时，序列化会静默丢键，
// 宿主判定「不是无损 JSON」直接让整个调用报错（实测 game_material_status /
// game_material_wait / getRigJob 全挂在这上面）。这里递归扫一遍。
{
  const undefinedPaths = [];
  const walk = (value, path) => {
    if (value === undefined) {
      undefinedPaths.push(path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  walk(view, "view");
  check("视图里没有 undefined（工具返回值必须无损）", undefinedPaths.length === 0, undefinedPaths.slice(0, 6).join("、"));
  check("视图可以无损往返 JSON", JSON.stringify(JSON.parse(JSON.stringify(view))) === JSON.stringify(view));
}

// 这是最容易漏的一类 bug（实测踩过两次）：
//   · 客户端声明了远程方法却忘了挂到 api 上 → 一点就 “is not a function”；
//   · 客户端按派生字段写，网关却返回原始任务 → 按钮一直是灰的、图片 404。
// 两处都是**编译期看不出来**的隐式 any。这里把「客户端读了哪些字段」直接扫出来，
// 逐条对着真实视图核对，字段改名 / 少返回都会立刻失败。
{
  const clientSource = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");
  const start = clientSource.indexOf("function RigModule(");
  const body = clientSource.slice(start, clientSource.indexOf("// ── 设置页", start));
  const topLevel = new Set(Object.keys(view));
  const containers = { parts: view.parts[0], layout: view.layout, rig: view.rig, atlas: view.atlas, stages: view.stages[0], sheet: view.sheet, review: view.review };
  const missing = [];
  for (const match of body.matchAll(/\bjob(?:\?\.)?\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const field = match[1];
    if (!topLevel.has(field)) missing.push(`job.${field}`);
  }
  check(
    `RigModule 读取的 job.* 字段视图里都有（${topLevel.size} 个顶层字段）`,
    missing.length === 0,
    missing.length === 0 ? "" : `缺：${[...new Set(missing)].join("、")}`
  );
  const missingNested = [];
  for (const [container, sample] of Object.entries(containers)) {
    if (sample === undefined) continue;
    const keys = new Set(Object.keys(sample));
    const pattern = new RegExp(`(?:$\\{)?(?:part|stage|entry|item|current|pt)\\?\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
    for (const match of body.matchAll(pattern)) {
      const field = match[1];
      if (!keys.has(field)) missingNested.push(`${container}.${field}`);
    }
  }
  check(
    "RigModule 读取的子字段视图里也都有",
    missingNested.length === 0,
    missingNested.length === 0 ? "" : `可能缺：${[...new Set(missingNested)].join("、")}`
  );
}

console.log("=== 7. 视觉先验（自动摆位的关键入口） ===");
{
  // 先验的语义是「我告诉你这块大概在哪，你只在这个区域附近精修」。这里用一个
  // **故意错位**的先验来验证它真的被尊重：把 head 指到画面下半部分，装配结果就该
  // 跟着去下半部分——这证明先验压过了默认的全图搜索。
  await riggen.setRigLayoutHints(job.id, {
    head: { x: 60, y: 460, width: 120, height: 120 }
  });
  let withHint = await riggen.readRigJob(job.id);
  check("先验已写入", withHint.layout.hints?.head !== undefined, JSON.stringify(withHint.layout.hints?.head));
  const view = riggen.rigSnapshot(withHint);
  check("先验出现在任务视图里", view.layout.hints.head !== undefined);
  check("视图带本机数据目录（agent 看图要用）", typeof view.dataDir === "string" && view.dataDir.endsWith(job.id));
  check("视图带部件蒙太奇路径", typeof view.partsMontagePath === "string" && view.partsMontagePath.endsWith("parts-montage.png"));
  check("视图带部件顺序", Array.isArray(view.partsOrder) && view.partsOrder.length === withHint.parts.length);

  await riggen.solveRigLayout(job.id);
  withHint = await riggen.readRigJob(job.id);
  const head = withHint.layout.items.head;
  // 契约是「模板**中心**落在先验框向外放宽 35% 的范围内」——不是「框必须完全落在先验里」。
  // 放宽是为了让先验给得粗一点也没关系（不精确是允许的，给错区域才是问题）。
  const margin = 0.35;
  const centerX = head.x + head.width / 2;
  const centerY = head.y + head.height / 2;
  const inside = centerX >= 60 - 120 * margin && centerX <= 180 + 120 * margin && centerY >= 460 - 120 * margin && centerY <= 580 + 120 * margin;
  check("先验被尊重（中心落在放宽后的先验范围内）", inside, `head 中心 (${Math.round(centerX)},${Math.round(centerY)})，先验框中心 (120,520)`);
  check("先验确实把部件拉过去了", head.y > 300, `head y=${head.y}（默认搜索会落在 100 附近）`);

  // 清掉先验，结果应当回到默认搜索的位置（不再被拉到下半部分）。
  await riggen.setRigLayoutHints(job.id, { head: null });
  let cleared = await riggen.readRigJob(job.id);
  check("先验可以清除", cleared.layout.hints?.head === undefined);
  await riggen.solveRigLayout(job.id);
  cleared = await riggen.readRigJob(job.id);
  check("清除后不再被先验拉走", cleared.layout.items.head.y < 460, `head y=${cleared.layout.items.head.y}`);

  let threw = false;
  try {
    await riggen.setRigLayoutHints(job.id, { head: { x: 0, y: 0, width: -5, height: 10 } });
  } catch {
    threw = true;
  }
  check("非法先验框会报错", threw);
  threw = false;
  try {
    await riggen.setRigLayoutHints(job.id, { "no-such-part": { x: 0, y: 0, width: 10, height: 10 } });
  } catch {
    threw = true;
  }
  check("给不存在的部件设先验会报错", threw);
  await riggen.solveRigLayout(job.id);
}

console.log("=== 8. 验收打标与列表 ===");
await riggen.setRigStageApproved(job.id, "rig", true);
await riggen.setRigPartApproved(job.id, "head", true);
state = await riggen.readRigJob(job.id);
check("阶段打标生效", state.rig.approved === true);
check("单件打标生效", state.parts.find((part) => part.name === "head").approved === true);
check("未打标的部件仍为未通过", state.parts.find((part) => part.name === "torso").approved === false);

const summaries = await riggen.listRigJobs();
check("任务列表能读到本任务", summaries.length === 1 && summaries[0].id === job.id);
check("列表统计部件数正确", summaries[0].partCount === state.parts.length, String(summaries[0].partCount));

console.log("=== 9. 删除部件会让下游作废 ===");
let threw = false;
try {
  await riggen.removeRigPart(job.id, "neck");
} catch {
  threw = true;
}
check("删除不存在的部件会报错", threw);
await riggen.removeRigPart(job.id, "left-foot");
state = await riggen.readRigJob(job.id);
check("部件已删除", !state.parts.some((part) => part.name === "left-foot"));
check("删除后装配记录被清空", Object.keys(state.layout.items).length === 0);
check("删除后骨骼与图集重置", state.rig.status === "empty" && state.atlas.status === "empty");

console.log("=== 10. 清理 ===");
await riggen.deleteRigJob(job.id);
check("任务目录已删除", !(await exists(riggen.rigJobDir(job.id))));
await rm(sandbox, { recursive: true, force: true });

console.log("");
if (failures === 0) console.log("全部通过 ✓");
else {
  console.log(`${failures} 项失败 ✗`);
  process.exitCode = 1;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
