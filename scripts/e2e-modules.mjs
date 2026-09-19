/**
 * 两个新模块的真实 API 端到端验证（会花钱，默认只跑最小量）。
 *
 *   node scripts/e2e-modules.mjs
 *
 * 花费：
 *   图片生成  2 张 × 0.2 元 = 0.4 元
 *   序列帧    1 段 × 5 秒 × 0.5 元/秒（768P）= 2.5 元
 *   合计约 2.9 元
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const seqgen = await import("../lib/seqgen.js");

const ctx = new Context();
ctx.provide("typert", { register: () => () => {} });
ctx.provide("webServer", { register: () => () => {} });
plugin.apply(ctx);
const studio = ctx.get("gameStudio");

const HOME = process.env.DSH_HOME;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
    child.on("error", reject);
  });
}

async function waitFor(label, read, timeoutMs) {
  const startedAt = Date.now();
  let last = "";
  for (;;) {
    await sleep(8000);
    const state = await read();
    const snapshot = JSON.stringify(state);
    if (snapshot !== last) {
      console.log(`  [${label}] ${Math.round((Date.now() - startedAt) / 1000)}s  ${snapshot}`);
      last = snapshot;
    }
    if (state.done) return state.value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`[${label}] 超时`);
  }
}

const config = await studio.getConfig();
if (!config.arkApiKeySet) throw new Error("火山方舟 Key 未配置");
if (!config.minimaxApiKeySet) throw new Error("MiniMax Key 未配置");
console.log(`生图 ${config.arkModel} @ ${config.arkSize} · 视频 ${config.minimaxModel} @ ${config.minimaxResolution}\n`);

// 源图：用八方向项目里已经生成好的正面绿幕图当参考
const sourceFile = join(HOME, "game-material-master", "projects", "pmu84zq4dc732e3", "images", "front.jpg");
const sourceB64 = (await readFile(sourceFile)).toString("base64");
console.log(`参考图：${sourceFile}（${(sourceB64.length / 1024 / 1365).toFixed(0)} KB 原图）\n`);

// ── ① 图片生成模块 ──────────────────────────────────────────────────────
console.log("① 图片生成模块");
const imageJob = await studio.createImageJob({ name: "模块验证·图片" });
const imageId = imageJob.jobId;
await studio.uploadImageRef({ jobId: imageId, name: "front.jpg", data: sourceB64 });
await studio.saveImageJob({
  jobId: imageId,
  prompt: [
    "以参考图中的角色为唯一主体，画一张同一角色的全身立绘：正面朝向镜头，自然站立。",
    "完整保留她的蓝紫色长发、鲸鱼耳与鲸尾、深蓝女仆裙与白色围裙。",
    "纯色绿幕背景 #00FF00，背景完全均匀，不要阴影、渐变、地面或任何道具。",
    "人物完整居中不裁切，占满画面高度。"
  ].join("\n"),
  suffix: "不要出现文字、水印、边框或第二个人物。",
  settings: { count: 2, size: config.arkSize, model: config.arkModel },
  keying: { enabled: true, keyLow: 14, keyHigh: 80, despill: 0.65, bgTolerance: 90, edgeShrink: 0 }
});
console.log(`  任务 ${imageId}，开始生成 2 张…`);
await studio.runImageJob({ jobId: imageId });
const images = await waitFor(
  "images",
  async () => {
    const job = await studio.getImageJob({ jobId: imageId });
    return {
      done: job.items.length >= 2 && job.items.every((item) => item.status !== "running" && item.status !== "empty"),
      value: job
    };
  },
  20 * 60 * 1000
);
for (const [index, item] of images.items.entries()) {
  console.log(`  第 ${index + 1} 张 ${item.status} · ${item.file ?? item.error ?? ""} · 抠像 ${item.keyedFile ?? "无"} · 背景占比 ${item.backgroundFraction !== undefined ? (item.backgroundFraction * 100).toFixed(0) + "%" : "-"}`);
}

// ── ② 序列帧生成模块 ────────────────────────────────────────────────────
console.log("\n② 序列帧生成模块");
const seqJob = await studio.createSequenceJob({ name: "模块验证·序列帧" });
const seqId = seqJob.jobId;
// 首帧用刚生成的绿幕图
const firstFrame = await readFile(join(HOME, "game-material-master", "image-jobs", imageId, images.items[0].file));
await studio.uploadSequenceRef({ jobId: seqId, kind: "firstFrame", name: "first.png", data: firstFrame.toString("base64") });
await studio.saveSequenceJob({
  jobId: seqId,
  mode: "frames",
  prompt: [
    "[Static shot] 固定机位、固定焦距、固定构图，镜头完全静止不动，不俯视也不仰视。绿幕背景保持原样不变。",
    "画面中只有这一个角色，保持图中的朝向和位置不变，原地做自然的行走动作：双腿交替迈步，手臂自然摆动，完整走三步。",
    "行走时身体保持直立、视线水平，不要转身、不要出画、不要出现第二个人物。"
  ].join("\n"),
  suffix: "保持平涂色块与干净绿幕，不要补充纹理或背景细节。",
  settings: { frameCount: 8, resolution: "768P", duration: 5, model: config.minimaxModel, longEdge: 768, cellWidth: 128, cellHeight: 128, pixelSize: 0 },
  keying: { keyLow: 14, keyHigh: 80, despill: 0.65, bgTolerance: 90, edgeShrink: 0 }
});
console.log(`  任务 ${seqId}，提交视频（5 秒 768P，约 2.5 元）…`);
console.log(`  ${JSON.stringify(await studio.runSequenceVideo({ jobId: seqId }))}`);
const videoJob = await waitFor(
  "video",
  async () => {
    const job = await studio.getSequenceJob({ jobId: seqId });
    return { done: job.video.status !== "running", value: job };
  },
  60 * 60 * 1000
);
console.log(`  视频：${videoJob.video.status} ${videoJob.video.remoteStatus ?? ""} ${videoJob.video.file ?? videoJob.video.error ?? ""}`);
if (videoJob.video.status !== "ready") {
  console.error("  视频生成失败，后续抽帧无法验证");
  process.exit(1);
}

console.log("  抽帧 + 抠像 + 合成…");
await studio.runSequenceFrames({ jobId: seqId, count: 8 });
const seqDone = await waitFor(
  "frames",
  async () => {
    const job = await studio.getSequenceJob({ jobId: seqId });
    return {
      done: job.frames.status === "ready" && job.sheet.status !== "running" && job.sheet.status !== "empty",
      value: job
    };
  },
  20 * 60 * 1000
);
console.log(`  抽出 ${seqDone.frames.files.length} 帧 / ${seqDone.frames.width}×${seqDone.frames.height} / 时长 ${seqDone.frames.duration?.toFixed(2)}s`);
console.log(`  抠像 ${seqDone.frames.keyed.length} 帧 · 条图 ${seqDone.sheet.width}×${seqDone.sheet.height}`);

// 把结果汇总到一个便于查看的目录
const outDir = join(HOME, "module-verify-out");
await ffmpeg(["-i", join(HOME, "game-material-master", "sequence-jobs", seqId, seqDone.sheet.file), join(outDir, "sequence-strip.png")]).catch(() => undefined);
for (const [index, item] of images.items.entries()) {
  if (item.keyedFile === undefined) continue;
  await ffmpeg(["-i", join(HOME, "game-material-master", "image-jobs", imageId, item.keyedFile), join(outDir, `image-${index + 1}.png`)]).catch(() => undefined);
}
await writeFile(join(outDir, "summary.txt"), [
  `图片任务 ${imageId}：${images.items.filter((i) => i.status === "ready").length} 张成功，${images.items.filter((i) => i.keyedFile).length} 张抠像`,
  `序列帧任务 ${seqId}：${seqDone.frames.files.length} 帧，条图 ${seqDone.sheet.width}×${seqDone.sheet.height}`,
  `产物：${outDir}`
].join("\n"), "utf8");

console.log(`\n产物已汇总到 ${outDir}`);
console.log(`项目里也保留着：图片任务 ${imageId} · 序列帧任务 ${seqId}`);
process.exit(0);
