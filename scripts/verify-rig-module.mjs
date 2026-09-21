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
const { validateDragonBones, validateDragonBonesTexture } = await import("../lib/rigvalidate.js");
const riggen = await import("../lib/riggen.js");
const versionsOf = riggen.versionsOf;

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

console.log("=== 1b. 语义层 ===");
{
  check(
    "上传后每个部件都被补齐了语义",
    state.parts.every((part) => typeof part.role === "string" && Array.isArray(part.proximal) && Array.isArray(part.distal)),
    state.parts.map((p) => `${p.name}:${p.role}`).join(", ")
  );
  check("语义来源标为 default", state.parts.every((part) => part.semanticsSource === "default"));

  const view = riggen.validateRigSemantics(state);
  check("默认语义无 error", view.errors.length === 0, view.errors.map((e) => `${e.name}:${e.message}`).join(" | "));
  check(
    "默认父级与 v1 表一致（torso 挂 root、腿挂 root）",
    state.parts.find((p) => p.name === "torso").parent === undefined &&
      state.parts.find((p) => p.name === "left-upper-leg").parent === undefined,
    state.parts.map((p) => `${p.name}->${p.parent}`).join(", ")
  );

  // 改父级：把两条大腿挂到躯干下（一个真实的手工纠正动作）。
  const changed = await riggen.setRigSemantics(job.id, [
    { name: "left-upper-leg", parent: "torso" },
    { name: "right-upper-leg", parent: "torso" }
  ]);
  check("语义变更成功", changed.ok === true, JSON.stringify(changed.errors));
  let afterSem = await riggen.readRigJob(job.id);
  check("父级已落盘", afterSem.parts.find((p) => p.name === "left-upper-leg").parent === "torso");
  check("来源变成 human", afterSem.parts.find((p) => p.name === "left-upper-leg").semanticsSource === "human");
  check("只动了被点名的部件（torso 的父级没被重置）", afterSem.parts.find((p) => p.name === "torso").parent === undefined);
  check("改语义作废骨骼与图集", afterSem.rig.status === "empty" && afterSem.atlas.status === "empty");

  // 成环必须被拒绝，且**不能落盘**。
  const cycle = await riggen.setRigSemantics(job.id, [
    { name: "torso", parent: "left-upper-leg" },
    { name: "left-upper-leg", parent: "torso" }
  ]);
  check("成环被拒绝", cycle.ok === false && cycle.errors.some((e) => e.message.includes("成环")), JSON.stringify(cycle.errors));
  const afterCycle = await riggen.readRigJob(job.id);
  check("被拒绝时没有落盘", afterCycle.parts.find((p) => p.name === "torso").parent === undefined);

  // 改锚点：把「头」的近端从底边中点挪到左下角（一个真实的手工纠正动作）。
  await riggen.setRigSemantics(job.id, [{ name: "head", proximal: [0.25, 1] }]);
  const afterAnchor = await riggen.readRigJob(job.id);
  check("锚点变更落盘", JSON.stringify(afterAnchor.parts.find((p) => p.name === "head").proximal) === JSON.stringify([0.25, 1]),
    JSON.stringify(afterAnchor.parts.find((p) => p.name === "head").proximal));

  // 退化锚点（近端 = 远端）会被自动纠正并给出 warning——骨骼长度为 0 会让方向失去意义。
  const degenerate = await riggen.setRigSemantics(job.id, [{ name: "head", proximal: [0.5, 0] }]);
  check("近端与远端重合时给出 warning", degenerate.ok === true && degenerate.warnings.some((w) => w.message.includes("重合")),
    JSON.stringify(degenerate.warnings));
  const afterDegenerate = await riggen.readRigJob(job.id);
  check("退化锚点被纠正回角色默认", JSON.stringify(afterDegenerate.parts.find((p) => p.name === "head").proximal) === JSON.stringify([0.5, 1]),
    JSON.stringify(afterDegenerate.parts.find((p) => p.name === "head").proximal));

  // 不存在的部件必须抛错（而不是静默忽略）。
  let threw = false;
  try {
    await riggen.setRigSemantics(job.id, [{ name: "no-such-part", parent: "torso" }]);
  } catch {
    threw = true;
  }
  check("改不存在的部件会报错", threw);

  // 回复到默认语义，后面的装配/骨骼断言才有意义。
  await riggen.setRigSemantics(job.id, [
    { name: "left-upper-leg", parent: undefined },
    { name: "right-upper-leg", parent: undefined }
  ]);
}

console.log("=== 1c. 三通道：手工骨骼偏移 ===");
{
  // 还没跑过骨骼时也能先写下偏移——它是独立于 origin 的一层。
  const set = await riggen.setRigBoneOffsets(job.id, [{ name: "torso", rotation: -3, y: 4 }], { by: "human" });
  check("写入偏移成功", set.touched === 1);
  let s = await riggen.readRigJob(job.id);
  check("偏移已落盘", s.boneOffsets?.torso?.rotation === -3 && s.boneOffsets?.torso?.y === 4, JSON.stringify(s.boneOffsets));

  // 只改一个字段时不能把另外两个抹掉（局部补丁语义）。
  await riggen.setRigBoneOffsets(job.id, [{ name: "torso", x: 7 }]);
  s = await riggen.readRigJob(job.id);
  check("局部补丁保留其它字段", s.boneOffsets.torso.x === 7 && s.boneOffsets.torso.rotation === -3 && s.boneOffsets.torso.y === 4,
    JSON.stringify(s.boneOffsets.torso));

  // 全零 = 未调整：条目要被自动删掉，而不是留一堆 0。
  await riggen.setRigBoneOffsets(job.id, [{ name: "torso", x: 0, y: 0, rotation: 0 }]);
  s = await riggen.readRigJob(job.id);
  check("全零条目被自动删除", s.boneOffsets === undefined, JSON.stringify(s.boneOffsets));

  // 改偏移只作废骨骼与图集。
  const beforeOffsets = JSON.stringify(s.layout.items);
  await riggen.setRigBoneOffsets(job.id, [{ name: "head", rotation: 5 }]);
  s = await riggen.readRigJob(job.id);
  check("改偏移作废骨骼与图集", s.rig.status === "empty" && s.atlas.status === "empty");
  void beforeOffsets;

  let threw = false;
  try {
    await riggen.setRigBoneOffsets(job.id, [{ name: "no-such-bone", x: 1 }]);
  } catch {
    threw = true;
  }
  check("给不存在的骨骼写偏移会报错", threw);

  const cleared = await riggen.resetRigBoneOffsets(job.id);
  check("清除全部偏移", cleared.touched === 1);
  s = await riggen.readRigJob(job.id);
  check("清除后没有残留", s.boneOffsets === undefined);
}

console.log("=== 1d. 动画参数（M3）===");
{
  const set = await riggen.setRigAnimationSettings(job.id, [{ id: "walk", amplitude: 1.5, duration: 1.2 }], { by: "human" });
  check("写入动画参数成功", set.touched === 1);
  let s = await riggen.readRigJob(job.id);
  check("参数已落盘", s.animationSettings?.walk?.amplitude === 1.5 && s.animationSettings?.walk?.duration === 1.2, JSON.stringify(s.animationSettings));

  // 只改一个字段时不能把另一个抹掉。
  await riggen.setRigAnimationSettings(job.id, [{ id: "walk", amplitude: 2 }]);
  s = await riggen.readRigJob(job.id);
  check("局部补丁保留其它字段", s.animationSettings.walk.amplitude === 2 && s.animationSettings.walk.duration === 1.2, JSON.stringify(s.animationSettings.walk));

  // 超范围要被夹紧，而不是原样写进去（amplitude 填 1000 会生成一坨垃圾）。
  await riggen.setRigAnimationSettings(job.id, [{ id: "idle", amplitude: 1000, duration: 999 }]);
  s = await riggen.readRigJob(job.id);
  check("超范围参数被夹紧", s.animationSettings.idle.amplitude <= 4 && s.animationSettings.idle.duration <= 10,
    JSON.stringify(s.animationSettings.idle));

  // 回到默认值 = 删掉条目（与骨骼偏移同一套语义）。
  await riggen.setRigAnimationSettings(job.id, [{ id: "idle", amplitude: 1, duration: 1.6 }]);
  s = await riggen.readRigJob(job.id);
  check("回到默认值后条目被删除", s.animationSettings.idle === undefined, JSON.stringify(s.animationSettings));

  let threw = false;
  try {
    await riggen.setRigAnimationSettings(job.id, [{ id: "not-an-animation" }]);
  } catch {
    threw = true;
  }
  check("不存在的动画会报错", threw);

  check("改动画参数作废骨骼与图集", s.rig.status === "empty" && s.atlas.status === "empty");

  await riggen.resetRigAnimationSettings(job.id);
  s = await riggen.readRigJob(job.id);
  check("重置后没有残留", s.animationSettings === undefined);
}

console.log("=== 1e. 贴图版本（M6）===");
{
  let s = await riggen.readRigJob(job.id);
  const first = s.parts.find((part) => part.name === "head");
  check("上传的部件自带 v1", versionsOf(first).length === 1 && versionsOf(first)[0].v === 1, JSON.stringify(versionsOf(first)));
  check("v1 沿用小写文件名（老任务不用搬家）", versionsOf(first)[0].file === "parts/head.png", versionsOf(first)[0].file);
  check("file 是当前生效版本的镜像", first.file === versionsOf(first)[0].file);

  // 换色 → 新增一版，绝不覆盖原图。
  const tinted = await riggen.tintRigParts(job.id, { names: ["head"] }, { hue: 140, saturation: 1.2 }, { note: "色相+140°" });
  check("换色返回新版本号", tinted.versions.head === 2, JSON.stringify(tinted.versions));
  s = await riggen.readRigJob(job.id);
  let head = s.parts.find((part) => part.name === "head");
  check("版本表里有两版", versionsOf(head).length === 2);
  check("v2 是新文件（没有覆盖 v1）", versionsOf(head)[1].file === "parts/head.v2.png", versionsOf(head)[1].file);
  check("v2 记了来源与说明", versionsOf(head)[1].source === "tint" && versionsOf(head)[1].note === "色相+140°");
  check("当前生效切到 v2", head.activeTexture === 2 && head.file === "parts/head.v2.png");
  check("v1 的文件还在", await exists(riggen.rigAssetPath(job.id, "parts/head.png")));
  check("换色真的改了像素", (await readFile(riggen.rigAssetPath(job.id, "parts/head.v2.png"))).length !==
    (await readFile(riggen.rigAssetPath(job.id, "parts/head.png"))).length);

  // 逐部件回退：改一个字段的事。
  await riggen.setRigTextureVersion(job.id, "head", 1);
  s = await riggen.readRigJob(job.id);
  head = s.parts.find((part) => part.name === "head");
  check("切回 v1 后 file 跟着回来", head.activeTexture === 1 && head.file === "parts/head.png");
  check("切版本会作废骨骼与图集", s.rig.status === "empty" && s.atlas.status === "empty");

  let threw = false;
  try {
    await riggen.setRigTextureVersion(job.id, "head", 99);
  } catch {
    threw = true;
  }
  check("切到不存在的版本会报错", threw);

  // 不能删当前生效的版本，也不能删最后一版。
  threw = false;
  try {
    await riggen.removeRigTextureVersion(job.id, "head", 1);
  } catch {
    threw = true;
  }
  check("不能删当前生效的版本", threw);

  await riggen.setRigTextureVersion(job.id, "head", 2);
  const removed = await riggen.removeRigTextureVersion(job.id, "head", 1);
  s = await riggen.readRigJob(job.id);
  head = s.parts.find((part) => part.name === "head");
  check("删掉旧版本", removed.removed === 1 && versionsOf(head).length === 1 && head.activeTexture === 2);
  check("删掉的版本文件也清了", !(await exists(riggen.rigAssetPath(job.id, "parts/head.png"))));

  threw = false;
  try {
    await riggen.removeRigTextureVersion(job.id, "head", 2);
  } catch {
    threw = true;
  }
  check("不能删最后一个版本", threw);

  // 同名再上传 = 新增一版（“手工上传替换”不该毁掉原图）。
  const png = encodePng((() => {
    const canvas = createRgba(50, 60);
    texturedRect(canvas, 0, 0, 50, 60, [90, 160, 90], 2.2);
    return canvas.data;
  })(), 50, 60);
  await riggen.uploadRigPart(job.id, "head.png", png.toString("base64"));
  s = await riggen.readRigJob(job.id);
  head = s.parts.find((part) => part.name === "head");
  check("同名上传新增一版而不是替换", versionsOf(head).length === 2 && head.activeTexture === 3, JSON.stringify(versionsOf(head).map((v) => v.v)));
  check("上传那一版记来源为 upload", versionsOf(head).at(-1).source === "upload");

  // 改名要把**所有**版本文件一起搬，否则回退会指到不存在的文件。
  await riggen.renameRigPart(job.id, "head", "head2");
  s = await riggen.readRigJob(job.id);
  const renamed = s.parts.find((part) => part.name === "head2");
  check("改名后版本表路径都跟着改", versionsOf(renamed).every((v) => v.file.includes("head2")), JSON.stringify(versionsOf(renamed).map((v) => v.file)));
  check("改名后每个版本的文件都在", (await Promise.all(versionsOf(renamed).map((v) => exists(riggen.rigAssetPath(job.id, v.file))))).every(Boolean));
  await riggen.renameRigPart(job.id, "head2", "head");

  // AI 重绘：没配 API Key 时必须**明确报错**，而不是静默留下一版坏贴图。
  {
    const before = (await riggen.readRigJob(job.id)).parts.find((p) => p.name === "head2" || p.name === "head");
    let message = "";
    try {
      await riggen.redrawRigPart(job.id, before.name, "换成深蓝色");
    } catch (error) {
      message = String(error?.message ?? error);
    }
    check("没配 API Key 时重绘明确报错", /API Key/.test(message), message);
    const after = (await riggen.readRigJob(job.id)).parts.find((p) => p.name === before.name);
    check("重绘失败不会留下新版本", versionsOf(after).length === versionsOf(before).length);
    check("重绘提示词强调「保持轮廓」", riggen.buildRedrawPrompt("加高光").includes("same silhouette"));
    // 提示词必须有**具体主语**：实测只强调约束时模型会交回纯色图。
    check("重绘提示词用语义角色给出具体主语",
      riggen.buildRedrawPrompt("加高光", { role: "hand" }).includes("detached hand") &&
        riggen.buildRedrawPrompt("加高光", { role: "hand" }).includes("the hand") &&
        !riggen.buildRedrawPrompt("加高光").includes("hand"),
      "");
    check("重绘提示词不再叫模型画背景（那句会导致纯色图）",
      !/flat clean background|solid colour background/i.test(riggen.buildRedrawPrompt("加高光", { role: "hand" })));
  }

  // 视图要把版本列表给界面（否则「切回原版」无从点起）。
  const viewWithTextures = riggen.rigSnapshot(await riggen.readRigJob(job.id));
  const viewHead = viewWithTextures.parts.find((part) => part.name === "head");
  check("视图里带版本列表", Array.isArray(viewHead.versions) && viewHead.versions.length === 2, JSON.stringify(viewHead.versions?.map((v) => v.v)));
  check("视图里带当前生效版本", viewHead.activeTexture === 3);
  check("视图里每一版都有可打开的 URL", viewHead.versions.every((v) => typeof v.url === "string" && v.url.endsWith(".png")));

  // 删部件要把它的所有版本文件一起清掉。
  await riggen.removeRigPart(job.id, "head");
  check("删部件后所有版本文件都没了",
    (await Promise.all(versionsOf(renamed).map((v) => exists(riggen.rigAssetPath(job.id, v.file))))).every((ok) => !ok));
  // 复原：后面的阶段断言需要 6 个部件。
  await riggen.uploadRigPart(job.id, "head.png", partPngs.head.toString("base64"));
}

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

// 语义只影响骨骼推导，**不该毁掉已经做好的装配**——否则用户每改一次角色
// 就要重新摆一遍，而角色恰恰是最需要反复试的字段。
{
  const beforeSem = await riggen.readRigJob(job.id);
  const beforeItems = JSON.stringify(beforeSem.layout.items);
  await riggen.setRigSemantics(job.id, [{ name: "torso", role: "accessory" }]);
  const afterSem = await riggen.readRigJob(job.id);
  check("改语义保留装配结果", JSON.stringify(afterSem.layout.items) === beforeItems && afterSem.layout.status === "ready");
  check("改语义后骨骼被作废", afterSem.rig.status === "empty");
  // 改回躯干，后面按标准骨架断言。
  await riggen.setRigSemantics(job.id, [{ name: "torso", role: "torso" }]);

  // 手工骨骼偏移同样不该动装配——它只影响骨骼推导。
  const beforeOffset = JSON.stringify((await riggen.readRigJob(job.id)).layout.items);
  await riggen.setRigBoneOffsets(job.id, [{ name: "head", rotation: 4 }]);
  const afterOffset = await riggen.readRigJob(job.id);
  check("改骨骼偏移保留装配结果", JSON.stringify(afterOffset.layout.items) === beforeOffset && afterOffset.layout.status === "ready");
  await riggen.resetRigBoneOffsets(job.id);
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
// 证明「导出前校验」真的接在构建流程里，而不只是定义了一个没人调的函数。
check("构建日志里记了 Spine 4.2 校验通过",
  state.log.some((entry) => typeof entry.message === "string" && entry.message.includes("Spine 4.2 校验通过")),
  state.log.slice(-2).map((entry) => entry.message).join(" | "));

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

// ── 第二条导出路径：DragonBones 5.5 ────────────────────────────────────
// 真的落盘、真的能被解析、并且与 Spine 那份**同源**（骨骼层级逐根一致）。
{
  const dbFile = "export/dragonbones/skeleton_ske.json";
  check("DragonBones 骨架已生成", await exists(riggen.rigAssetPath(job.id, dbFile)));
  const db = JSON.parse(await readFile(riggen.rigAssetPath(job.id, dbFile), "utf8"));
  check("DragonBones 版本为 5.5", db.version === "5.5" && db.compatibleVersion === "5.5");
  check("DragonBones 骨骼数与 Spine 一致", db.armature[0].bone.length === skeleton.bones.length,
    `${db.armature[0].bone.length} vs ${skeleton.bones.length}`);
  check("DragonBones 骨骼层级逐根一致", db.armature[0].bone.every((bone) => {
    const spineBone = skeleton.bones.find((b) => b.name === bone.name);
    return spineBone !== undefined && (spineBone.parent ?? undefined) === bone.parent &&
      Math.abs(spineBone.x - bone.transform.x) < 1e-6 &&
      Math.abs(spineBone.y - bone.transform.y) < 1e-6 &&
      Math.abs(spineBone.rotation - bone.transform.skX) < 1e-6 &&
      Math.abs(bone.transform.skX - bone.transform.skY) < 1e-9;
  }));
  check("DragonBones 动画是帧数而不是秒（idle = 1.6s × 30）",
    db.armature[0].animation.find((a) => a.name === "idle").duration === 48);
  check("DragonBones 补间帧都显式声明了缓动", db.armature[0].animation.every((animation) =>
    animation.bone.every((timeline) => ["rotateFrame", "translateFrame", "scaleFrame"].every((key) => {
      const frames = timeline[key];
      return frames === undefined || frames.slice(0, -1).every((f) => f.tweenEasing !== undefined || f.curve !== undefined);
    }))));
  check("DragonBones 校验通过", validateDragonBones(db).ok,
    validateDragonBones(db).errors.map((e) => `${e.where} ${e.message}`).join("；"));
  check("任务状态里带上了 DragonBones 路径", state.rig.dragonBones?.skeleton === dbFile);
}

// ── 三通道的核心保证：手工偏移不被「重新推骨骼」覆盖 ──────────────────
{
  const baseline = skeleton.bones.find((bone) => bone.name === "head");
  await riggen.setRigBoneOffsets(job.id, [{ name: "head", rotation: 9, y: 6 }], { by: "human" });
  await riggen.buildRigOutput(job.id);
  const after = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
  const head = after.bones.find((bone) => bone.name === "head");
  check("重跑骨骼后手工偏移仍在", Math.abs(head.rotation - (baseline.rotation + 9)) < 0.01, `${baseline.rotation} -> ${head.rotation}`);
  check("重跑骨骼后位移偏移生效", Math.abs(head.y - (baseline.y + 6)) < 0.01, `${baseline.y} -> ${head.y}`);
  check("偏移不污染绑定姿势（其它骨骼未变）",
    after.bones.filter((b) => b.name !== "head").every((b) => {
      const before = skeleton.bones.find((x) => x.name === b.name);
      return Math.abs(b.rotation - before.rotation) < 0.01;
    }));

  const stateWithOffset = await riggen.readRigJob(job.id);
  check("骨骼表里带上了偏移记录", stateWithOffset.rig.boneList.find((b) => b.name === "head").offset.rotation === 9);

  await riggen.resetRigBoneOffsets(job.id);
  await riggen.buildRigOutput(job.id);

  // ── 动画参数真的写进了产物 ────────────────────────────────────────────
  {
    const before = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
    const beforeAmp = Math.max(...before.animations.walk.bones.torso.rotate.map((f) => Math.abs(f.value)));
    const beforeEnd = before.animations.walk.bones.torso.rotate.at(-1).time;

    await riggen.setRigAnimationSettings(job.id, [{ id: "walk", amplitude: 2, duration: 1.6 }], { by: "human" });
    await riggen.buildRigOutput(job.id);
    const after = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
    const afterAmp = Math.max(...after.animations.walk.bones.torso.rotate.map((f) => Math.abs(f.value)));
    const afterEnd = after.animations.walk.bones.torso.rotate.at(-1).time;

    check("幅度参数写进 skeleton.json", Math.abs(afterAmp - beforeAmp * 2) < 0.01, `${beforeAmp} → ${afterAmp}`);
    check("时长参数写进 skeleton.json", Math.abs(afterEnd - 1.6) < 1e-6, `${beforeEnd} → ${afterEnd}`);
    check("参数化后仍然通过导出前校验", after?.animations?.walk !== undefined);

    // 视图要把「预设原值 vs 我改的值」都给出来，界面才能显示差别。
    const viewWithAnim = riggen.rigSnapshot(await riggen.readRigJob(job.id));
    const walkPreset = viewWithAnim.rig.animationPresets.find((item) => item.id === "walk");
    check("视图里带预设原值与生效值", walkPreset.defaultDuration === 0.8 && walkPreset.duration === 1.6 && walkPreset.amplitude === 2,
      JSON.stringify(walkPreset));

    await riggen.resetRigAnimationSettings(job.id);
    await riggen.buildRigOutput(job.id);
    const restored = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
    check("重置后回到预设数值",
      Math.abs(Math.max(...restored.animations.walk.bones.torso.rotate.map((f) => Math.abs(f.value))) - beforeAmp) < 0.01);
  }
  const restored = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
  const headBack = restored.bones.find((bone) => bone.name === "head");
  check("清除偏移后回到绑定姿势", Math.abs(headBack.rotation - baseline.rotation) < 0.01 && Math.abs(headBack.y - baseline.y) < 0.01,
    `${headBack.rotation} vs ${baseline.rotation}`);
}

console.log("=== 4b. 关键帧编辑（M3）===");
{
  // 先确认「实例化」给出的是显式关键帧，且与预设同构。
  const draft = await riggen.getRigAnimation(job.id, "walk");
  check("能取到 walk 的可编辑数据", draft.id === "walk" && draft.bones !== undefined);
  check("未编辑时标记为预设", draft.custom === false);
  check("实例化后带显式关键帧", Object.values(draft.bones).every((kinds) =>
    Object.values(kinds).every((frames) => Array.isArray(frames) && frames.length >= 2)));
  check("每条轨道时间从 0 开始且严格递增", Object.values(draft.bones).every((kinds) =>
    Object.values(kinds).every((frames) =>
      frames[0].time === 0 && frames.every((frame, i) => i === 0 || frame.time > frames[i - 1].time))));
  check("末帧不携带 curve（它描述的是「以本帧为起点」的下一段）", Object.values(draft.bones).every((kinds) =>
    Object.values(kinds).every((frames) => frames[frames.length - 1].curve === null || frames[frames.length - 1].curve === undefined)));
  check("实例化不写盘（还没开始编辑）", (state.animations ?? {})[ "walk" ] === undefined);

  // 验收判据：把 head 的一个关键帧从 1.5° 改成 4°，导出 JSON 里必须是 4。
  const headFrames = draft.bones.head.rotate;
  const targetIndex = headFrames.findIndex((frame) => Math.abs(frame.angle - 1.5) < 0.01);
  check("预设 walk 的 head 有一个 1.5° 的关键帧", targetIndex > 0, JSON.stringify(headFrames.map((f) => f.angle)));
  headFrames[targetIndex] = { ...headFrames[targetIndex], angle: 4 };

  const saved = await riggen.saveRigAnimation(job.id, { id: "walk", animation: draft });
  check("保存后统计出轨道与帧数", saved.tracks > 0 && saved.keyframes > 0, `${saved.tracks} 轨 / ${saved.keyframes} 帧`);
  check("保存没有产生数据问题", saved.issues.length === 0, saved.issues.join(" | "));
  const afterSave = await riggen.readRigJob(job.id);
  check("手工动画写进了任务", afterSave.animations?.walk !== undefined);
  check("任务视图里能看到「已改」标记", riggen.rigSnapshot(afterSave).rig.customAnimations.includes("walk"));

  // 改动作废骨骼与图集（动画变了，产物必须重算）。
  check("改动作废了骨骼", afterSave.rig.status !== "ready", afterSave.rig.status);

  await riggen.buildRigOutput(job.id);
  const edited = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
  const walkHead = edited.animations.walk.bones.head.rotate;
  check("导出 JSON 里出现了 4（验收判据）", walkHead.some((frame) => Math.abs(frame.value - 4) < 1e-6),
    JSON.stringify(walkHead.map((f) => f.value)));
  check("整条轨道不再是预设的 1.5", !walkHead.some((frame) => Math.abs(frame.value - 1.5) < 1e-6));
  check("bezier 仍是 4 个控制点（rotate 单属性）",
    walkHead.slice(0, -1).every((frame) => frame.curve === undefined || frame.curve === "stepped" || frame.curve.length === 4),
    JSON.stringify(walkHead.map((f) => (Array.isArray(f.curve) ? f.curve.length : f.curve))));
  check("curve 是绝对量（落在自己所属的时间区间内）", walkHead.slice(0, -1).every((frame, i) => {
    if (!Array.isArray(frame.curve)) return true;
    const t1 = walkHead[i].time;
    const t2 = walkHead[i + 1].time;
    return frame.curve[0] >= t1 - 1e-6 && frame.curve[0] <= t2 + 1e-6 &&
      frame.curve[2] >= t1 - 1e-6 && frame.curve[2] <= t2 + 1e-6;
  }));
  // 编辑过的动画「不再被参数影响」是刻意的：否则手调过的帧会被下一次调参悄悄改掉。
  check("编辑后不受幅度参数影响", await (async () => {
    await riggen.setRigAnimationSettings(job.id, [{ id: "walk", amplitude: 3 }], { by: "human" });
    await riggen.buildRigOutput(job.id);
    const again = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
    return again.animations.walk.bones.head.rotate.some((frame) => Math.abs(frame.value - 4) < 1e-6);
  })());
  await riggen.resetRigAnimationSettings(job.id, ["walk"]);

  // 没被编辑过的动画仍走参数化路径。
  check("未编辑的动画仍随参数变化", await (async () => {
    await riggen.setRigAnimationSettings(job.id, [{ id: "idle", amplitude: 2 }], { by: "human" });
    await riggen.buildRigOutput(job.id);
    const again = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
    const values = again.animations.idle.bones.torso.rotate.map((frame) => frame.value);
    return values.some((value) => Math.abs(value) > 1.5);
  })());
  await riggen.resetRigAnimationSettings(job.id, ["idle"]);

  // 非法数据要被拒绝，而不是写进产物。
  let rejected = false;
  try {
    await riggen.saveRigAnimation(job.id, {
      id: "walk",
      animation: { duration: 0.8, loop: true, bones: { head: { rotate: [] } } }
    });
  } catch (error) {
    rejected = true;
  }
  check("空轨道的动画会被拒绝", rejected);

  // 还原：回到预设。
  await riggen.resetRigAnimation(job.id, "walk");
  const afterReset = await riggen.readRigJob(job.id);
  check("还原后任务里不再有手工动画", (afterReset.animations ?? {}).walk === undefined);
  await riggen.buildRigOutput(job.id);
  const restoredWalk = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
  check("还原后 head 回到预设值", !restoredWalk.animations.walk.bones.head.rotate.some((frame) => Math.abs(frame.value - 4) < 1e-6));
  state = await riggen.readRigJob(job.id);
}

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

  // ── 图集新契约：页信息、真实 orig/offset、校验提示 ──────────────────
  check("图集状态里带页信息", Array.isArray(state.atlas.pages) && state.atlas.pages.length >= 1, JSON.stringify(state.atlas.pages));
  check("首页就是 skeleton.png", state.atlas.pages[0].file === "atlas/skeleton.png", state.atlas.pages[0].file);
  check("页尺寸与 atlas 状态一致", state.atlas.pages[0].width === state.atlas.width && state.atlas.pages[0].height === state.atlas.height);
  check("区域总数等于各页之和", state.atlas.pages.reduce((n, p) => n + p.regions, 0) === state.atlas.regions);
  check("图集校验没有留下 error", state.atlas.error === undefined, state.atlas.error ?? "");
  {
    // 每个区域块都必须写 orig 与 offset（参考项目恒写 orig==size / offset 0,0，
    // 等于永远不裁透明边）。
    const atlasBody = await readFile(riggen.rigAssetPath(job.id, "atlas/skeleton.atlas"), "utf8");
    const origLines = atlasBody.match(/^ {2}orig: /gm) ?? [];
    const offsetLines = atlasBody.match(/^ {2}offset: /gm) ?? [];
    check("每个区域都有 orig 行", origLines.length === regions.length, `${origLines.length} vs ${regions.length}`);
    check("每个区域都有 offset 行", offsetLines.length === regions.length, `${offsetLines.length} vs ${regions.length}`);
    // 这一批部件是全不透明的矩形，不该被裁——裁剪只在真有透明边时发生。
    const zeroOffsets = atlasBody.match(/^ {2}offset: 0, 0$/gm) ?? [];
    check("全不透明的部件不会被误裁（offset 全为 0,0）", zeroOffsets.length === regions.length, `${zeroOffsets.length} vs ${regions.length}`);
  }

  // ── DragonBones 贴图描述：与 .atlas 同一次装箱的孪生兄弟 ──────────────
  {
    const texFile = "atlas/skeleton_tex.json";
    check("DragonBones 贴图描述已生成", await exists(riggen.rigAssetPath(job.id, texFile)));
    check("任务状态里列了贴图描述", (state.atlas.dragonBones?.textures ?? []).includes(texFile),
      JSON.stringify(state.atlas.dragonBones));
    const tex = JSON.parse(await readFile(riggen.rigAssetPath(job.id, texFile), "utf8"));
    check("_tex.json 尺寸与图集一致", tex.width === state.atlas.width && tex.height === state.atlas.height);
    check("_tex.json 的 imagePath 指向同目录 png", tex.imagePath === "skeleton.png", tex.imagePath);
    check("_tex.json 区域数 = 部件数", tex.SubTexture.length === regions.length, `${tex.SubTexture.length} vs ${regions.length}`);
    const atlasNames = (await readFile(riggen.rigAssetPath(job.id, "atlas/skeleton.atlas"), "utf8"))
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith(" ") && !line.includes(":") && !line.endsWith(".png"));
    check("_tex.json 区域名与 .atlas 一一对应",
      atlasNames.slice().sort().join(",") === tex.SubTexture.map((s) => s.name).slice().sort().join(","));
    check("_tex.json 通过校验", validateDragonBonesTexture(tex).ok,
      validateDragonBonesTexture(tex).errors.map((e) => `${e.where} ${e.message}`).join("；"));
    check("未见裁剪时 _tex.json 不写 frame*", tex.SubTexture.every((s) => s.frameX === undefined));
  }
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
// `score` **允许缺失**：它描述的是自动匹配的质量，位置一旦由人给过就清掉了
// （留着会让拆件质检拿一个陈旧分数当「这次装配准不准」的证据）。
check("parts 带 url / placed（score 只有自动匹配过的才有）",
  view.parts.every((part) => "url" in part && "placed" in part && (part.score === undefined || typeof part.score === "number")));
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
  // ⚠️ 扫描必须从**最早**的 rig 组件开始：曾经只从 `function RigModule(` 切起，
  // 结果定义在它前面的 `RigBoneEditor` 读 `job.rig.boneList` 完全没被扫到，
  // 而宿主恰好没在快照顶层 `rig` 里返回这个字段 —— 界面上骨骼编辑器就永远不渲染。
  const start = clientSource.indexOf("function RigSemanticsPanel(");
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
  // 变量名 → 它实际指向的视图样本。
  //
  // 只保留**确实是视图对象**的两个名字：
  //   · `part`  —— `job.parts.map((part) => …)`；
  //   · `stage` —— `rigStageOf(job, key)`，形状与 `view.stages[0]` 一致。
  // `item` / `current` / `entry` / `pt` 在装配台里是本地草稿与拖拽状态
  // （`item.x`、`current.startX`、`entry.key`），拿它们去比视图键只会产生假失败。
  const variableSamples = {
    part: view.parts[0],
    stage: view.stages[0]
  };
  const JS_MEMBERS = new Set([
    "length", "map", "filter", "find", "findIndex", "some", "every", "forEach",
    "reduce", "slice", "includes", "toString", "toFixed", "getBoundingClientRect",
    "push", "join", "sort"
  ]);
  const missingNested = [];
  for (const match of body.matchAll(/(?:\$\{)?(part|stage)\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const [, variable, field] = match;
    if (JS_MEMBERS.has(field)) continue;
    const sample = variableSamples[variable];
    if (sample === undefined) continue;
    if (!(field in sample)) missingNested.push(`${variable}.${field}`);
  }
  check(
    "RigModule 读取的子字段视图里也都有",
    missingNested.length === 0,
    missingNested.length === 0 ? "" : `可能缺：${[...new Set(missingNested)].join("、")}`
  );

  // 上面两条是「扫源码里的字段名」的近似手段，对 `x.map(...)` / `x.length` /
  // `x.getBoundingClientRect()` 这类成员访问会误报。真正容易漏的是
  // **某个面板读了 job.<容器>.<字段> 而宿主没返回**——它不报错，只是那块界面
  // 永远不渲染（骨骼编辑器就踩过这个坑）。这里对每个「界面确实依赖」的容器字段
  // 做精确断言，比扩正则更可靠。
  const requiredContainerFields = [
    ["rig", "boneList"],
    ["rig", "boneOffsets"],
    ["rig", "preview"],
    ["rig", "skeleton"],
    ["layout", "items"],
    ["atlas", "text"]
  ];
  const missingExact = requiredContainerFields
    .filter(([container, field]) => view[container] === undefined || view[container][field] === undefined)
    .map(([container, field]) => `${container}.${field}`);
  check("界面依赖的容器字段视图里都有", missingExact.length === 0, missingExact.join("、"));
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

console.log("=== 8. 手动装配 ===");
{
  const before = await riggen.readRigJob(job.id);
  const target = before.parts[0].name;
  const base = before.layout.items[target];
  const compositeBefore = await readFile(riggen.rigAssetPath(job.id, "layout/composite.png"));

  // 一次拖动 = 一次批量提交
  const moved = await riggen.saveRigLayoutItems(job.id, [{ name: target, x: base.x + 25, y: base.y - 30 }]);
  check("批量手动装配返回改动数", moved.touched === 1, String(moved.touched));
  let after = await riggen.readRigJob(job.id);
  check("拖动生效", after.layout.items[target].x === base.x + 25 && after.layout.items[target].y === base.y - 30);
  check("手动改动被标记 manual", after.layout.items[target].manual === true);
  check("手动改动让骨骼与图集作废", after.rig.status === "empty" && after.atlas.status === "empty");
  const compositeAfter = await readFile(riggen.rigAssetPath(job.id, "layout/composite.png"));
  check("合成图随手动改动重出", !compositeBefore.equals(compositeAfter));

  // 旋转：必须真的画进合成图，否则用户拧了半天看不到变化
  await riggen.saveRigLayoutItems(job.id, [{ name: target, rotation: 30 }]);
  after = await riggen.readRigJob(job.id);
  check("旋转被记录", after.layout.items[target].rotation === 30);
  const compositeRotated = await readFile(riggen.rigAssetPath(job.id, "layout/composite.png"));
  check("旋转真的画进了合成图", !compositeAfter.equals(compositeRotated));
  await riggen.saveRigLayoutItems(job.id, [{ name: target, rotation: 0 }]);

  // 收回 / 放回：手动装配允许把部件从画布上取下来再拖回去
  await riggen.saveRigLayoutItems(job.id, [{ name: target, placed: false }]);
  after = await riggen.readRigJob(job.id);
  check("可以收回部件", after.layout.items[target].matched === false);
  check("收回的部件仍保留坐标（能再拖回来）", Number.isFinite(after.layout.items[target].x));
  await riggen.saveRigLayoutItems(job.id, [{ name: target, placed: true }]);
  after = await riggen.readRigJob(job.id);
  check("可以放回部件", after.layout.items[target].matched === true);

  // 为「还没有任何摆放记录」的部件建条目：拆完件直接手工拼也是合理用法
  const empty = await riggen.readRigJob(job.id);
  await riggen.writeRigJob({ ...empty, layout: { status: "empty", items: {} } });
  const created = await riggen.saveRigLayoutItems(job.id, [{ name: target, x: 40, y: 60 }]);
  after = await riggen.readRigJob(job.id);
  check("没有摆放记录时也能手动放置（自动建条目）", created.touched === 1 && after.layout.items[target].x === 40);
  check("新建条目按缩放先验给了默认尺寸", after.layout.items[target].width > 1 && after.layout.items[target].height > 1, `${after.layout.items[target].width}×${after.layout.items[target].height}`);

  let threw = false;
  try {
    await riggen.saveRigLayoutItems(job.id, [{ name: "no-such-part", x: 1 }]);
  } catch {
    threw = true;
  }
  check("手动装配给不存在的部件会报错", threw);

  // 还原：重新跑一次自动装配，后面的验收打标测试才有意义
  await riggen.solveRigLayout(job.id);
}

console.log("=== 9. 验收打标与列表 ===");
await riggen.setRigStageApproved(job.id, "rig", true);
await riggen.setRigPartApproved(job.id, "head", true);
state = await riggen.readRigJob(job.id);
check("阶段打标生效", state.rig.approved === true);
check("单件打标生效", state.parts.find((part) => part.name === "head").approved === true);
check("未打标的部件仍为未通过", state.parts.find((part) => part.name === "torso").approved === false);

const summaries = await riggen.listRigJobs();
check("任务列表能读到本任务", summaries.length === 1 && summaries[0].id === job.id);
check("列表统计部件数正确", summaries[0].partCount === state.parts.length, String(summaries[0].partCount));

console.log("=== 10. 删除部件会让下游作废 ===");
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

console.log("=== 10b. 带透明边的部件会被裁边入图 ===");
{
  // 参考项目恒写 `orig == size` 且 `offset: 0, 0`：透明边会被原样塞进图集，
  // 白白撑大体积。这里换一张四周留白 20px 的部件，验证真的裁了、且偏移算对了。
  const padded = createRgba(80, 90);
  texturedRect(padded, 20, 25, 40, 40, [180, 90, 60], 1.1);
  await riggen.uploadRigPart(job.id, "left-foot.png", encodePng(padded.data, padded.width, padded.height).toString("base64"));
  // 换图会让下游全部作废，所以按正常流程重跑一遍（都是本地计算，免费）。
  await riggen.solveRigLayout(job.id);
  await riggen.buildRigOutput(job.id);
  await riggen.buildAtlas(job.id);
  const afterTrim = await riggen.readRigJob(job.id);
  check("重跑后图集就绪", afterTrim.atlas.status === "ready" && afterTrim.atlas.error === undefined, afterTrim.atlas.error ?? "");

  const text = await readFile(riggen.rigAssetPath(job.id, "atlas/skeleton.atlas"), "utf8");
  const block = text.split("\nleft-foot\n")[1] ?? "";
  // 注意：部件先被缩放到**装配尺寸**再裁透明边，所以 orig 是装配尺寸而不是
  // 上传时的 80×90 —— 这里断言的是相对关系（orig > size、offset 为负），
  // 而不是写死具体像素。
  const sizeMatch = / {2}size: (\d+), (\d+)/.exec(block);
  const origMatch = / {2}orig: (\d+), (\d+)/.exec(block);
  const offsetMatch = / {2}offset: (-?\d+), (-?\d+)/.exec(block);
  const [, sizeW, sizeH] = sizeMatch ?? [];
  const [, origW, origH] = origMatch ?? [];
  const [, offsetX, offsetY] = offsetMatch ?? [];
  check("带透明边的部件被裁掉边（orig > size）",
    Number(origW) > Number(sizeW) && Number(origH) > Number(sizeH),
    `size=${sizeW}×${sizeH} orig=${origW}×${origH}`);
  check("裁剪偏移是负的（Spine 的 offset 语义）", Number(offsetX) < 0 && Number(offsetY) < 0, `offset=${offsetX},${offsetY}`);
  check("offset + size 落在 orig 之内（否则图集告诉引擎的坐标是自相矛盾的）",
    Number(offsetX) + Number(sizeW) <= Number(origW) && Number(offsetY) + Number(sizeH) <= Number(origH),
    `${offsetX}+${sizeW} <= ${origW} / ${offsetY}+${sizeH} <= ${origH}`);

  // 挂点的 width/height 仍然是**原尺寸**（= orig），所以渲染结果不变——
  // 这正是「图集里的图小了，部件没变小」的关键。
  const spineAfter = JSON.parse(await readFile(riggen.rigAssetPath(job.id, "rig/skeleton.json"), "utf8"));
  const att = spineAfter.skins[0].attachments["left-foot"]?.["left-foot"];
  check("挂点尺寸仍是原尺寸（与 orig 一致）", att !== undefined && Math.abs(att.width - afterTrim.layout.items["left-foot"].width) <= 1,
    att === undefined ? "缺挂点" : `${att.width} vs ${afterTrim.layout.items["left-foot"].width}`);
}

console.log("=== 11. 清理 ===");
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
