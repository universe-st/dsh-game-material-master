#!/usr/bin/env node
/**
 * 一次性探针：验证「用生图模型原地重绘单个部件」的效果。
 *
 * 它与插件**共用同一个提示词构造器**（`riggen.buildRedrawPrompt`），
 * 所以测出来的就是插件会发的请求。用途是排查「插件里失败、但说不清是模型还是
 * 管线的问题」——直接看模型的原始输出，比在插件里反复重试便宜得多。
 *
 *   node scripts/probe-redraw.mjs <部件PNG> "<提示词>" [--role=hand] [模型ID...]
 *
 * 会真的花钱（每个模型一次调用）。输出落在系统临时目录，便于用 read_image 看。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../lib/config.js";
import { generateImage } from "../lib/ark.js";
import { decodeToRgba } from "../lib/media.js";
import { padToSquare, imageStats } from "../lib/rigpose.js";
import { encodePng } from "../lib/png.js";
import { buildRedrawPrompt } from "../lib/riggen.js";

const [partPath, prompt, ...rest] = process.argv.slice(2);
if (partPath === undefined || prompt === undefined) {
  console.error('用法：node scripts/probe-redraw.mjs <部件PNG> "<提示词>" [--role=hand] [模型ID...]');
  process.exit(1);
}
const roleArg = (rest.find((item) => item.startsWith("--role=")) ?? "--role=").slice("--role=".length) || undefined;
const models = rest.filter((item) => !item.startsWith("--"));

const config = await loadConfig();
if (config.arkApiKey.trim() === "") {
  console.error("还没配 API Key");
  process.exit(1);
}

const source = await decodeToRgba(partPath, 2048);
const original = { data: source.rgba, width: source.width, height: source.height };
const square = padToSquare(original, [128, 128, 128]);
const dataUri = `data:image/png;base64,${encodePng(square.image.data, square.image.width, square.image.height).toString("base64")}`;
console.log(`原图 ${original.width}×${original.height}，补边后 ${square.size}×${square.size}`);

const candidates = models.length > 0 ? models : [config.arkRedrawModel || config.arkModel];
// **和插件共用同一个提示词构造器**：否则「探针能跑通、插件跑不通」这种差异
// 会让人去猜模型行为，而真正的原因只是两处提示词不一样。
const fullPrompt = buildRedrawPrompt(prompt, { role: roleArg });
console.log(`提示词：\n${fullPrompt}\n`);

const outDir = join(tmpdir(), "gmm-redraw-probe");
await mkdir(outDir, { recursive: true });
for (const model of candidates) {
  const started = Date.now();
  try {
    const result = await generateImage({
      baseUrl: config.arkBaseUrl,
      apiKey: config.arkApiKey,
      model,
      prompt: fullPrompt,
      images: [dataUri],
      size: config.arkSize,
      watermark: false,
      timeoutMs: config.arkTimeoutMs
    });
    const rawPath = join(outDir, `${model}.raw.${result.ext}`);
    await writeFile(rawPath, result.bytes);
    const decoded = await decodeToRgba(rawPath, 2048);
    const stats = imageStats({ data: decoded.rgba, width: decoded.width, height: decoded.height });
    console.log(
      `${model}: ${Math.round((Date.now() - started) / 1000)}s ${decoded.width}×${decoded.height} ` +
        `均值亮度 ${stats.meanLuma.toFixed(0)} 标准差 ${stats.stdDev.toFixed(1)} ${stats.stdDev < 6 ? "← 纯色，失败" : "← 有内容"}`
    );
    console.log(`  → ${rawPath}`);
  } catch (error) {
    console.log(`${model}: 失败 ${error instanceof Error ? error.message : String(error)}`);
  }
}
