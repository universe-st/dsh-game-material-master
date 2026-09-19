/**
 * 端到端测试：用真实 API 跑完整条流水线。
 *
 *   node scripts/e2e-8dir.mjs --source /path/to/source.jpg          # 新建项目并生成八方向图
 *   node scripts/e2e-8dir.mjs --project <id> --from videos          # 从视频阶段续跑
 *   node scripts/e2e-8dir.mjs --project <id> --from frames          # 抽帧
 *   node scripts/e2e-8dir.mjs --project <id> --from sheet           # 合成整图
 *
 * 分阶段是刻意的：图片阶段便宜且快，先看清像素风对不对，再决定要不要
 * 花掉八段视频的钱。项目数据写在真实 DSH_HOME 下，重启 DSH 后能直接在界面里看到。
 *
 * 用的是与线上完全相同的代码路径（真实 cordis Context 里挂载插件、调用远程服务）。
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const { directionalPrompts, videoPrompt, describeDirections } = await import("./e2e-prompts.mjs");

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}
const SOURCE = arg("source", "/Users/kuangshensheng/Downloads/1104_S.jpg");
const PROJECT = arg("project", "");
const FROM = arg("from", "images");
const UNTIL = arg("until", "sheet");
const ORDER = ["images", "videos", "frames", "sheet"];
const shouldRun = (stage) => ORDER.indexOf(stage) >= ORDER.indexOf(FROM) && ORDER.indexOf(stage) <= ORDER.indexOf(UNTIL);
const CELL = Number.parseInt(arg("cell", "256"), 10);
const FRAMES = Number.parseInt(arg("frames", "8"), 10);
const DURATION = Number.parseInt(arg("duration", "5"), 10);
const RESOLUTION = arg("resolution", "768P");
const PIXEL = Number.parseInt(arg("pixelsize", "4"), 10);
const RESET_PROMPTS = argv.includes("--reset-prompts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 挂载插件（与宿主启动时同样的方式）──────────────────────────────────
const ctx = new Context();
ctx.provide("typert", { register: () => () => {} });
ctx.provide("webServer", { register: () => () => {} });
plugin.apply(ctx);
const studio = ctx.get("gameStudio");
if (studio === undefined) throw new Error("gameStudio 服务未注册");

async function state(projectId) {
  return studio.getProject({ projectId });
}

function summarize(project) {
  const keys = project.settings.rowOrder;
  const cell = (node) => {
    const map = { empty: "·", running: "▶", ready: "✓", error: "✗" };
    return map[node?.status] ?? "?";
  };
  const line = (title, pick) => `  ${title.padEnd(6)} ${keys.map((k) => cell(pick(k))).join(" ")}`;
  return [
    `  方向   ${keys.map((k) => k.slice(0, 3).padEnd(3)).join(" ")}`,
    line("图", (k) => project.images[k]),
    line("视频", (k) => project.videos[k]),
    line("帧", (k) => project.frames[k])
  ].join("\n");
}

/** 轮询到某个阶段全部收敛（不再有 running）。 */
async function waitFor(projectId, pick, label, timeoutMs) {
  const startedAt = Date.now();
  let last = "";
  for (;;) {
    await sleep(8000);
    const project = await state(projectId);
    const keys = Object.keys(pick(project));
    const running = keys.filter((k) => pick(project)[k]?.status === "running");
    const errors = keys.filter((k) => pick(project)[k]?.status === "error");
    const ready = keys.filter((k) => pick(project)[k]?.status === "ready");
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const snapshot = `${ready.length}✓ ${running.length}▶ ${errors.length}✗`;
    if (snapshot !== last) {
      console.log(`  [${label}] ${elapsed}s  ${snapshot}`);
      last = snapshot;
    }
    if (running.length === 0) return project;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`[${label}] 等待超时（${Math.round(timeoutMs / 1000)} 秒）`);
  }
}

function reportErrors(project, pick, label) {
  const keys = Object.keys(pick(project));
  const failed = keys.filter((k) => pick(project)[k]?.status === "error");
  for (const key of failed) {
    console.log(`  ✗ ${label}/${key}: ${pick(project)[key].error}`);
  }
  return failed;
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const config = await studio.getConfig();
  console.log(`DSH_HOME       ${process.env.DSH_HOME ?? "(未设置)"}`);
  console.log(`生图模型       ${config.arkModel} @ ${config.arkSize}`);
  console.log(`视频模型       ${config.minimaxModel}（协议 ${config.minimaxCapabilities?.protocol}）`);
  console.log(`ffmpeg         ${config.ffmpeg?.ok ? config.ffmpeg.version : `不可用：${config.ffmpeg?.error}`}`);
  if (!config.arkApiKeySet) throw new Error("火山方舟 Key 未配置");
  if (!config.minimaxApiKeySet) throw new Error("MiniMax Key 未配置");

  let projectId = PROJECT;

  // ── 建项目 ────────────────────────────────────────────────────────────
  if (projectId === "") {
    const created = await studio.createProject({ name: `1104 像素风八方向（E2E）` });
    projectId = created.projectId;
    console.log(`\n项目 ${projectId}`);

    const bytes = await readFile(SOURCE);
    await studio.uploadSource({ projectId, name: basename(SOURCE), data: bytes.toString("base64") });
    console.log(`源图 ${SOURCE}（${(bytes.length / 1024).toFixed(0)} KB）`);

    await studio.saveSettings({
      projectId,
      settings: {
        cellWidth: CELL,
        cellHeight: CELL,
        frameCount: FRAMES,
        // 像素风要硬边：nearest 保边，pixelSize 做确定性量化。
        scaleFilter: "nearest",
        pixelSize: PIXEL,
        fitMode: "contain",
        concurrency: 3
      }
    });
    await studio.savePrompts({ projectId, images: directionalPrompts(), video: videoPrompt() });
    await studio.saveConfig({ minimaxResolution: RESOLUTION, minimaxDuration: DURATION, minimaxModel: "MiniMax-H3" });
    console.log(`参数：单格 ${CELL}×${CELL} / 每段 ${FRAMES} 帧 / 像素块 ${PIXEL}px / 视频 ${RESOLUTION} ${DURATION}s`);
  }
  const effective = await studio.getConfig();
  if (PROJECT !== "" && RESET_PROMPTS) {
    await studio.savePrompts({ projectId, resetImagesToDefault: true, resetVideoToDefault: true, images: directionalPrompts(), video: videoPrompt() });
    console.log("已把提示词重置为当前默认模板");
  }
  console.log(`\n项目 ${projectId}`);
  console.log(`视频实际配置   ${effective.minimaxModel} / ${effective.minimaxResolution} / ${effective.minimaxDuration}s`);
  console.log("方向对照：\n" + describeDirections());

  // ── ① 八方向绿幕图 ────────────────────────────────────────────────────
  if (shouldRun("images")) {
    console.log("\n① 生成八方向绿幕图（按依赖分层）");
    const kicked = await studio.runImages({ projectId });
    console.log(`  启动：${JSON.stringify(kicked)}`);
    let project = await waitFor(projectId, (p) => p.images, "images", 30 * 60 * 1000);
    reportErrors(project, (p) => p.images, "images");
    console.log(summarize(project));
    project = await state(projectId);
    const ready = Object.values(project.images).filter((n) => n.status === "ready").length;
    console.log(`\n  图片阶段完成：${ready}/8`);
    for (const key of project.settings.rowOrder) {
      const node = project.images[key];
      console.log(`    ${key.padEnd(10)} ${node.status}${node.stale ? "（需重做）" : ""} ${node.file ?? ""}`);
    }
    console.log(`\n  产物目录：${config.dataRoot}/${projectId}/images/`);
  }

  // ── ② 视频 ────────────────────────────────────────────────────────────
  if (shouldRun("videos")) {
    console.log(`\n② 生成八段行走视频（${config.minimaxModel} / ${RESOLUTION} / ${DURATION}s）`);
    const kicked = await studio.runVideos({ projectId });
    console.log(`  启动：${JSON.stringify(kicked)}`);
    if (kicked.started !== true) throw new Error(`视频阶段未能启动：${kicked.reason}`);
    const project = await waitFor(projectId, (p) => p.videos, "videos", 60 * 60 * 1000);
    reportErrors(project, (p) => p.videos, "videos");
    const ready = Object.values(project.videos).filter((n) => n.status === "ready").length;
    console.log(`\n  视频阶段完成：${ready}/8`);
    for (const key of project.settings.rowOrder) {
      const node = project.videos[key];
      console.log(`    ${key.padEnd(10)} ${node.status} ${node.remoteStatus ?? ""} ${node.file ?? ""}`);
    }
  }

  // ── ③ 抽帧 ────────────────────────────────────────────────────────────
  if (shouldRun("frames")) {
    console.log(`\n③ 抽帧（每段视频按时长平均 ${FRAMES} 帧）`);
    const kicked = await studio.runFrames({ projectId });
    console.log(`  启动：${JSON.stringify(kicked)}`);
    const project = await waitFor(projectId, (p) => p.frames, "frames", 20 * 60 * 1000);
    reportErrors(project, (p) => p.frames, "frames");
    for (const key of project.settings.rowOrder) {
      const node = project.frames[key];
      console.log(`    ${key.padEnd(10)} ${node.status} ${node.frames?.length ?? 0} 帧 ${node.duration ? `${node.duration.toFixed(2)}s` : ""}`);
    }
  }

  // ── ④ 合成 ────────────────────────────────────────────────────────────
  if (!shouldRun("sheet")) {
    const partial = await state(projectId);
    console.log("\n阶段性结果：");
    console.log(summarize(partial));
    console.log(`\n项目 id：${projectId}`);
    return 0;
  }
  console.log("\n④ 抠绿幕 + 合成整图");
  const kicked = await studio.compose({ projectId });
  console.log(`  启动：${JSON.stringify(kicked)}`);
  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    const project = await state(projectId);
    if (project.sheet.status !== "running") {
      if (project.sheet.status === "error") throw new Error(`合成失败：${project.sheet.error}`);
      console.log(`\n  ✓ 整图 ${project.sheet.width}×${project.sheet.height}`);
      console.log(`  ${config.dataRoot}/${projectId}/${project.sheet.file}`);
      break;
    }
  }

  const final = await state(projectId);
  console.log("\n最终状态：");
  console.log(summarize(final));
  console.log(`\n项目 id：${projectId}`);
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(`\n失败：${error instanceof Error ? error.message : String(error)}`);
  code = 1;
}
process.exit(code);
