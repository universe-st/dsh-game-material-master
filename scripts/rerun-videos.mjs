/**
 * 重跑指定方向的视频，并自动接着重抽帧与重新合成。
 *
 *   node scripts/rerun-videos.mjs <项目 id> <方向,方向,...>
 *
 * `runVideos` 默认会跳过已经 ready 的方向（防止重复提交把任务覆盖成孤儿），
 * 所以这里必须带 `regenerate: true`——宿主会先作废旧视频与其序列帧再提交。
 * 清掉之后那几段视频的帧也一并作废，必须重新抽帧，最后再合成一次整图。
 */

import { Context } from "@deepseek-ai/cordis";
import * as plugin from "../lib/index.js";

const projectId = process.argv[2];
const keys = (process.argv[3] ?? "").split(",").map((k) => k.trim()).filter((k) => k !== "");
if (projectId === undefined || keys.length === 0) {
  console.error("用法：node scripts/rerun-videos.mjs <项目 id> <方向,方向,...>");
  process.exit(2);
}

const ctx = new Context();
ctx.provide("typert", { register: () => () => {} });
ctx.provide("webServer", { register: () => () => {} });
plugin.apply(ctx);
const studio = ctx.get("gameStudio");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(label, pick, timeoutMs) {
  const startedAt = Date.now();
  let last = "";
  for (;;) {
    await sleep(8000);
    const project = await studio.getProject({ projectId });
    const nodes = keys.map((key) => pick(project)[key]);
    const running = nodes.filter((node) => node?.status === "running").length;
    const ready = nodes.filter((node) => node?.status === "ready").length;
    const failed = nodes.filter((node) => node?.status === "error").length;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const snapshot = `${ready}✓ ${running}▶ ${failed}✗`;
    if (snapshot !== last) {
      console.log(`  [${label}] ${elapsed}s  ${snapshot}`);
      last = snapshot;
    }
    if (running === 0) return project;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`[${label}] 等待超时`);
  }
}

const config = await studio.getConfig();
console.log(`视频模型 ${config.minimaxModel} / ${config.minimaxResolution} / ${config.minimaxDuration}s`);
console.log(`重跑方向：${keys.join("、")}`);
console.log(`预计花费：${keys.length} × ${config.minimaxDuration} 秒 × ${config.minimaxResolution === "2K" ? "0.8" : "0.5"} 元/秒\n`);

// 1) 提交新视频：regenerate 让宿主先把旧视频与它们的帧作废再提交
const kicked = await studio.runVideos({ projectId, keys, regenerate: true });
console.log(`提交：${JSON.stringify(kicked)}`);
if (kicked.started !== true) {
  console.error(`启动失败：${kicked.reason}`);
  process.exit(1);
}
let project = await waitUntil("videos", (p) => p.videos, 60 * 60 * 1000);
for (const key of keys) {
  const node = project.videos[key];
  console.log(`  ${key.padEnd(10)} ${node.status.padEnd(8)} ${node.remoteStatus ?? ""} ${node.file ?? node.error ?? ""}`);
}

const failed = keys.filter((key) => project.videos[key]?.status !== "ready");
if (failed.length > 0) {
  console.error(`\n以下方向未成功，可用 scripts/retry-video.mjs 单独重试：${failed.join("、")}`);
  process.exit(1);
}

// 2) 重抽帧（会顺带重新合成一次）
console.log("\n重新抽帧…");
const frames = await studio.runFrames({ projectId, keys });
console.log(`提交：${JSON.stringify(frames)}`);
project = await waitUntil("frames", (p) => p.frames, 20 * 60 * 1000);
for (const key of keys) {
  const node = project.frames[key];
  console.log(`  ${key.padEnd(10)} ${node.status.padEnd(8)} ${node.frames?.length ?? 0} 帧 ${node.duration ? `${node.duration.toFixed(2)}s` : ""} ${node.error ?? ""}`);
}

// 3) 最终合成一次
console.log("\n合成整图…");
await studio.compose({ projectId });
for (let i = 0; i < 120; i++) {
  await sleep(2000);
  const snapshot = await studio.getProject({ projectId });
  if (snapshot.sheet.status !== "running") {
    if (snapshot.sheet.status === "error") {
      console.error(`合成失败：${snapshot.sheet.error}`);
      process.exit(1);
    }
    console.log(`  ✓ ${snapshot.sheet.width}×${snapshot.sheet.height}`);
    console.log(`  ${config.dataRoot}/${projectId}/${snapshot.sheet.file}`);
    break;
  }
}
process.exit(0);
