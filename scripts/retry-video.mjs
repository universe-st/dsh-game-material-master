/**
 * 重跑单个方向的视频（审核拦截、偶发失败时用）。
 *
 *   node scripts/retry-video.mjs <项目 id> <方向> [--soft]
 *
 * `--soft` 会把视频提示词换成更中性的措辞——MiniMax 的审核对某些写法更敏感，
 * 命中 1026 时通常换一版描述就能过。改动会写回项目提示词，界面上能看到。
 */

import { Context } from "@deepseek-ai/cordis";
import * as plugin from "../lib/index.js";

const projectId = process.argv[2];
const key = process.argv[3];
const soft = process.argv.includes("--soft");
if (projectId === undefined || key === undefined) {
  console.error("用法：node scripts/retry-video.mjs <项目 id> <方向> [--soft]");
  process.exit(2);
}

const ctx = new Context();
ctx.provide("typert", { register: () => () => {} });
ctx.provide("webServer", { register: () => () => {} });
plugin.apply(ctx);
const studio = ctx.get("gameStudio");

if (soft) {
  await studio.savePrompts({
    projectId,
    video: [
      "[Static shot] 固定机位、固定焦距、固定构图，镜头完全静止不动，绿幕背景保持原样不变。",
      "画面中只有一个角色，保持图中的朝向和位置不变，原地演示自然步行：双腿交替迈步，手臂自然摆动，完整走三步。",
      "画面保持平涂色块和干净的绿幕，不要补充纹理、光影或背景细节。",
      "不要转身、不要改变朝向、不要走出画面、不要出现第二个角色或任何其它物体，不出现转场、抖动、缩放、运镜或镜头移动。"
    ].join("\n")
  });
  console.log("已换成中性提示词");
}

const kicked = await studio.runVideos({ projectId, keys: [key] });
console.log(`提交 ${key}：${JSON.stringify(kicked)}`);
if (kicked.started !== true) process.exit(1);

for (let i = 0; i < 90; i++) {
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const project = await studio.getProject({ projectId });
  const node = project.videos[key];
  console.log(`  ${(i + 1) * 8}s  ${node.status}  ${node.remoteStatus ?? ""}  ${node.error ?? ""}`);
  if (node.status !== "running") {
    console.log(node.status === "ready" ? `✓ ${node.file}` : `✗ ${node.error}`);
    process.exit(node.status === "ready" ? 0 : 1);
  }
}
process.exit(1);
