#!/usr/bin/env node
/**
 * 生成**免费的**合成部件 PNG，用于骨骼动画模块的界面/链路测试。
 *
 * 为什么需要它：真实拆件要调生图模型（花钱），而很多测试只需要「有几个名字正确、
 * 尺寸不同的透明部件」就能跑通上传 → 语义 → 装配 → 骨骼 → 图集。用它可以在不花
 * 一分钱的前提下把除拆件以外的整条链走完。
 *
 *   node scripts/make-rig-fixtures.mjs <输出目录> [--full]
 *
 * 默认出 6 件（head / torso / 两条大腿 / 两只脚），带 --full 出完整 16 件标准人形，
 * 这样六个动画预设都有内容。
 *
 * 纹理刻意用**归一化坐标**的正弦叠加（结构一致、分辨率无关）——逐像素随机噪声在
 * 缩放后完全对不上，模板匹配会掉到 0，测出来的就是假失败。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodePng } from "../lib/png.js";
import { createRgba } from "../lib/rigpose.js";

/** 标准 16 件套的尺寸与基色；顺序与 `spine.ts` 的 RIG_SLOTS 一致。 */
const FULL_SPECS = [
  ["head", 120, 140, [232, 196, 156]],
  ["neck", 70, 54, [226, 188, 148]],
  ["torso", 160, 240, [72, 110, 190]],
  ["hip", 140, 90, [60, 92, 160]],
  ["left-upper-arm", 54, 120, [216, 176, 140]],
  ["left-lower-arm", 46, 110, [208, 168, 132]],
  ["right-upper-arm", 54, 120, [220, 180, 144]],
  ["right-lower-arm", 46, 110, [212, 172, 136]],
  ["left-hand", 48, 54, [236, 200, 160]],
  ["right-hand", 48, 54, [240, 204, 164]],
  ["left-upper-leg", 60, 130, [56, 66, 88]],
  ["right-upper-leg", 60, 130, [74, 84, 108]],
  ["left-lower-leg", 52, 120, [48, 58, 78]],
  ["right-lower-leg", 52, 120, [66, 76, 98]],
  ["left-foot", 62, 40, [36, 40, 54]],
  ["right-foot", 62, 40, [52, 56, 72]]
];

const MINIMAL = ["head", "torso", "left-upper-leg", "right-upper-leg", "left-foot", "right-foot"];

/** 按归一化坐标画一层「结构一致、分辨率无关」的明暗。 */
function paint(canvas, base) {
  const { width, height } = canvas;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const shade =
        34 * Math.sin((u * 2 + 0.4) * Math.PI) +
        26 * Math.cos((v * 3 + 0.4) * Math.PI * 0.9) +
        18 * Math.sin((u + v) * Math.PI * 1.6 + 0.4);
      const at = (y * width + x) * 4;
      canvas.data[at] = Math.max(0, Math.min(255, Math.round(base[0] + shade)));
      canvas.data[at + 1] = Math.max(0, Math.min(255, Math.round(base[1] + shade)));
      canvas.data[at + 2] = Math.max(0, Math.min(255, Math.round(base[2] + shade)));
      canvas.data[at + 3] = 255;
    }
  }
}

const args = process.argv.slice(2);
const full = args.includes("--full");
const target = resolve(args.find((item) => !item.startsWith("--")) ?? "");
if (target === "" || target === resolve("")) {
  console.error("用法：node scripts/make-rig-fixtures.mjs <输出目录> [--full]");
  process.exit(1);
}

const wanted = full ? FULL_SPECS : FULL_SPECS.filter(([name]) => MINIMAL.includes(name));
await mkdir(target, { recursive: true });
for (const [name, width, height, base] of wanted) {
  const canvas = createRgba(width, height);
  paint(canvas, base);
  await writeFile(join(target, `${name}.png`), encodePng(canvas.data, canvas.width, canvas.height));
}
console.log(`已生成 ${wanted.length} 个部件 PNG → ${target}`);
console.log(wanted.map(([name]) => name).join(", "));
