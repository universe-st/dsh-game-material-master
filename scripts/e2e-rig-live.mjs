#!/usr/bin/env node
/**
 * 骨骼动画模块的**真实链路**测试：真的调一次生图模型把角色拆件，然后走完装配、
 * 骨骼、图集，并把产物落到真实的数据目录里，方便用浏览器打开预览验收。
 *
 * 消耗：一次 Seedream 生图（约 0.2 元），其余全部是本地计算。
 *
 *   node scripts/e2e-rig-live.mjs <角色整图路径> [任务名]
 */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";

const sourcePath = resolve(process.argv[2] ?? "");
const jobName = process.argv[3] ?? "骨骼动画实测";
if (sourcePath === "" || !existsSync(sourcePath)) {
  console.error("用法：node scripts/e2e-rig-live.mjs <角色整图路径> [任务名]");
  process.exit(1);
}

const { configPath, dataRoot } = await import("../lib/config.js");
const riggen = await import("../lib/riggen.js");

const config = JSON.parse(await readFile(configPath(), "utf8"));
if (typeof config.arkApiKey !== "string" || config.arkApiKey.trim() === "") {
  console.error("尚未配置火山方舟 API Key，无法做真实生图测试。");
  process.exit(1);
}
console.log(`数据目录：${dataRoot()}`);
console.log(`生图模型：${config.arkModel}`);

const step = (n, text) => console.log(`\n[${n}] ${text}`);

step(1, "建任务 + 上传角色参考图");
const job = await riggen.createRigJob(jobName);
const bytes = await readFile(sourcePath);
await riggen.setRigSource(job.id, basename(sourcePath), bytes.toString("base64"));
console.log(`  jobId = ${job.id}`);

step(2, "调生图模型拆件（这一步花钱）");
const started = Date.now();
await riggen.generateSheet(job.id);
console.log(`  完成，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);

let state = await riggen.readRigJob(job.id);
console.log(`  拆件图：${state.sheet.file}（${state.sheet.status}）`);
console.log(`  分割出 ${state.parts.length} 个部件：`);
for (const part of state.parts) {
  console.log(`    · ${part.name.padEnd(18)} ${String(part.width).padStart(4)}×${String(part.height).padEnd(4)} 不透明占比 ${part.opacity}`);
}

step(3, "装配定位（本地计算）");
const layoutStart = Date.now();
await riggen.solveRigLayout(job.id);
state = await riggen.readRigJob(job.id);
console.log(`  完成，用时 ${((Date.now() - layoutStart) / 1000).toFixed(1)} 秒`);
console.log(`  几何先验缩放 hint = ${state.layout.hint}`);
for (const [name, item] of Object.entries(state.layout.items)) {
  console.log(
    `    · ${name.padEnd(18)} (${String(item.x).padStart(4)},${String(item.y).padStart(4)}) ${item.width}×${item.height} ` +
      `${item.matched ? `得分 ${item.score}` : "**未匹配**"}`
  );
}
if ((state.layout.resolved ?? []).length > 0) console.log(`  冲突/镜像消解：${state.layout.resolved.join("、")}`);
if ((state.layout.moved ?? []).length > 0) console.log(`  遮挡修正：${state.layout.moved.join("、")}`);

step(4, "生成骨骼与动画（本地计算）");
await riggen.buildRigOutput(job.id);
state = await riggen.readRigJob(job.id);
console.log(`  ${state.rig.bones} 根骨骼 / ${state.rig.slots} 个挂点 / 动画：${(state.rig.animations ?? []).join("、")}`);
if ((state.rig.warnings ?? []).length > 0) console.log(`  告警：${state.rig.warnings.join("；")}`);

step(5, "打包图集（本地计算）");
await riggen.buildAtlas(job.id);
state = await riggen.readRigJob(job.id);
console.log(`  图集 ${state.atlas.width}×${state.atlas.height}，${state.atlas.regions} 个区域`);

const dir = riggen.rigJobDir(job.id);
console.log("\n产物：");
for (const [label, file] of [
  ["参考图", state.source.file],
  ["拆件图", state.sheet.file],
  ["装配对比图", state.layout.comparison],
  ["layout.json", "layout/layout.json"],
  ["skeleton.json", state.rig.skeleton],
  ["动画预览", state.rig.preview],
  ["图集 PNG", state.atlas.image],
  ["图集文本", state.atlas.text]
]) {
  console.log(`  ${label.padEnd(12)} ${dir}/${file}`);
}
console.log(`\n预览页（浏览器直接打开）：${dir}/${state.rig.preview}`);
console.log(`jobId: ${job.id}`);
