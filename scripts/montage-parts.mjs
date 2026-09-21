#!/usr/bin/env node
/**
 * 把若干部件 PNG 横向拼成一张带标签的对比图，用来人工核对「哪几块其实是同一个部位」。
 *
 *   node scripts/montage-parts.mjs <部件目录> <输出 png> <部件名…>
 *
 * 存在的理由：拆件模型会把同一部位画进多个网格格子里（网格位置决定部件名，
 * 模型却不一定按那个语义画）。肉眼看蒙太奇小图分不清，把有疑问的几块放大并排
 * 才看得出来——这一步花几秒，比在错误素材上跑完整条链路便宜得多。
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeToRgba } from "../lib/media.js";
import { createRgba, resizeRgba } from "../lib/rigpose.js";
import { encodePng } from "../lib/png.js";

const [dir, out, ...names] = process.argv.slice(2);
if (dir === undefined || out === undefined || names.length === 0) {
  console.error("用法：node scripts/montage-parts.mjs <部件目录> <输出.png> <部件名…>");
  process.exit(2);
}

const CELL_H = 420;
const GAP = 14;
const LABEL_BAND = 0;
const cells = [];
for (const name of names) {
  const file = join(dir, `${name}.png`);
  let decoded;
  try {
    decoded = await decodeToRgba(file);
  } catch {
    cells.push({ name, image: createRgba(8, 8), missing: true });
    continue;
  }
  const ratio = CELL_H / decoded.height;
  const scaled = resizeRgba(
    { data: decoded.rgba, width: decoded.width, height: decoded.height },
    Math.max(1, Math.round(decoded.width * ratio)),
    CELL_H
  );
  cells.push({ name, image: scaled });
}

const totalW = cells.reduce((sum, cell) => sum + cell.image.width, 0) + GAP * (cells.length + 1);
const totalH = CELL_H + GAP * 2 + LABEL_BAND;
const canvas = createRgba(totalW, totalH, [245, 245, 248, 255]);

/** 画一条竖分隔线，避免相邻两块糊在一起。 */
function separator(x) {
  for (let y = 0; y < totalH; y++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx;
      if (px < 0 || px >= canvas.width) continue;
      const idx = (y * canvas.width + px) * 4;
      canvas.data[idx] = 120;
      canvas.data[idx + 1] = 120;
      canvas.data[idx + 2] = 130;
      canvas.data[idx + 3] = 255;
    }
  }
}

let x = GAP;
const order = [];
for (const cell of cells) {
  order.push(`${cell.name}@${x}..${x + cell.image.width}`);
  for (let row = 0; row < cell.image.height; row++) {
    for (let col = 0; col < cell.image.width; col++) {
      const src = (row * cell.image.width + col) * 4;
      const dst = ((row + GAP) * canvas.width + (x + col)) * 4;
      const alpha = cell.image.data[src + 3] / 255;
      for (let k = 0; k < 3; k++) {
        canvas.data[dst + k] = Math.round(canvas.data[dst + k] * (1 - alpha) + cell.image.data[src + k] * alpha);
      }
      canvas.data[dst + 3] = 255;
    }
  }
  x += cell.image.width;
  separator(x + Math.floor(GAP / 2));
  x += GAP;
}

await writeFile(out, encodePng(canvas.data, canvas.width, canvas.height));
console.log(`已写出 ${out}（${totalW}×${totalH}）`);
for (const entry of order) console.log(`  ${entry}`);
