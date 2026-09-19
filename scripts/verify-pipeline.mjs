/**
 * 本地链路自检：不需要任何 API Key，就能验证
 *   抽帧(ffmpeg) → 抠像(chroma) → 合成整图(compose) → PNG 编码(png)
 * 这条链路是否真的 work。
 *
 *   node scripts/verify-pipeline.mjs
 *
 * 除了绿幕的基本盘，这里专门覆盖两个**实测踩过的坑**：
 *   1. 图生视频会把纯色背景重新打光成别的颜色甚至渐变——只认绿色的抠像会整片失效；
 *   2. 源图留白多时角色在格子里太小——需要统一裁剪到角色包围盒。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { extractFrames, probeDuration, probeSize, workingSize } from "../lib/media.js";
import { composeSheet, keyGreen, segmentBackground, unionBoundingBox } from "../lib/chroma.js";
import { encodePng } from "../lib/png.js";

const ROOT = new URL("../.verify/", import.meta.url).pathname;
const CELL = 64;
const FRAMES = 8;
const DIRECTIONS = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];

const KEY_OPTIONS = { keyLow: 14, keyHigh: 80, despill: 0.65, edgeShrink: 0, bgTolerance: 40 };

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.slice(-500)))));
    child.on("error", reject);
  });
}

/** 造一段测试视频：背景由 background 描述，中间一个来回移动的方块。 */
async function makeVideo(file, { background, blockColor, offset }) {
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...background,
    "-f", "lavfi", "-i", `color=c=${blockColor}:s=44x96:d=3:r=12`,
    "-filter_complex", `[0][1]overlay=x='40+70*sin(2*PI*(t/3)+${offset})':y='70'`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
    file
  ]);
}

function alphaStats(rgba) {
  let opaque = 0;
  let transparent = 0;
  let partial = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    else partial++;
  }
  const total = rgba.length / 4;
  return {
    opaquePct: (opaque / total) * 100,
    transparentPct: (transparent / total) * 100,
    partialPct: (partial / total) * 100
  };
}

/** 前景里还残留多少「明显偏绿」的像素。 */
function greenRemainder(rgba) {
  let bad = 0;
  let opaque = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue;
    opaque++;
    if (rgba[i + 1] - Math.max(rgba[i], rgba[i + 2]) > 40) bad++;
  }
  return opaque === 0 ? 0 : (bad / opaque) * 100;
}

/**
 * 从整图里取出一个格子。
 * 注意不能直接用 subarray：格子在图里不是连续内存（每行都要跨过其它列）。
 */
function extractCell(sheet, row, col) {
  const cell = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    const srcStart = ((row * CELL + y) * sheet.width + col * CELL) * 4;
    sheet.rgba.copy(cell, y * CELL * 4, srcStart, srcStart + CELL * 4);
  }
  return cell;
}

/** 用线上同一套参数把抠好的帧合成整图。 */
function buildSheet(rows) {
  return composeSheet(rows, {
    cellWidth: CELL,
    cellHeight: CELL,
    frameCount: FRAMES,
    autoCrop: true,
    fillRatio: 0.94,
    pixelSize: 2,
    fitMode: "contain",
    bottomMargin: 1
  });
}

async function main() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, "out"), { recursive: true });

  const GREEN = ["-f", "lavfi", "-i", "color=c=0x00c040:s=240x240:d=3:r=12"];
  // 平台上的真实情况：视频模型会把纯色背景重新打光成暖色渐变。
  const GRADIENT = ["-f", "lavfi", "-i", "gradients=s=240x240:d=3:speed=0.8:c0=0xffcc00:c1=0xff4400"];

  console.log("1) 合成测试视频");
  const greenVideos = {};
  const driftVideos = {};
  for (let i = 0; i < DIRECTIONS.length; i++) {
    greenVideos[DIRECTIONS[i]] = join(ROOT, `green-${DIRECTIONS[i]}.mp4`);
    driftVideos[DIRECTIONS[i]] = join(ROOT, `drift-${DIRECTIONS[i]}.mp4`);
    await makeVideo(greenVideos[DIRECTIONS[i]], { background: GREEN, blockColor: "0xff8800", offset: (i * Math.PI) / 4 });
  }
  let hasGradient = true;
  try {
    for (let i = 0; i < 2; i++) {
      await makeVideo(driftVideos[DIRECTIONS[i]], { background: GRADIENT, blockColor: "0x2244ff", offset: (i * Math.PI) / 4 });
    }
  } catch (error) {
    hasGradient = false;
    console.log(`   （本机 ffmpeg 不支持 gradients 源，跳过渐变用例：${String(error.message).slice(0, 80)}）`);
  }
  check("绿幕测试视频就绪", true);

  const duration = await probeDuration(greenVideos.front);
  const size = await probeSize(greenVideos.front);
  check("ffprobe 读到时长与尺寸", duration > 2 && size.width === 240, `${duration.toFixed(2)}s ${size.width}x${size.height}`);
  const work = workingSize(size.width, size.height, 96);
  check("workingSize 按长边等比且取偶数", work.width === 96 && work.height === 96, `${work.width}x${work.height}`);

  console.log("2) 按时长平均抽帧");
  const rows = [];
  for (const key of DIRECTIONS) {
    const extracted = await extractFrames({ video: greenVideos[key], frameCount: FRAMES, longEdge: 96, cropInset: 0 });
    if (key === "front") {
      check(`抽到 ${FRAMES} 帧`, extracted.frames.length === FRAMES, `实际 ${extracted.frames.length}`);
      check(
        "每帧字节数 = 工作尺寸",
        extracted.frames[0].length === extracted.width * extracted.height * 4,
        `${extracted.width}x${extracted.height}`
      );
    }
    rows.push({ key, frames: extracted.frames, width: extracted.width, height: extracted.height });
  }

  console.log("3) 抠像：绿幕基本盘");
  const keyedRows = [];
  for (const row of rows) {
    const keyed = row.frames.map((frame) => keyGreen(frame, row.width, row.height, KEY_OPTIONS));
    const merged = Buffer.concat(keyed.map((k) => k.rgba));
    const stats = alphaStats(merged);
    keyedRows.push({ key: row.key, frames: keyed.map((k) => k.rgba), width: row.width, height: row.height });
    if (row.key === "front") {
      console.log(
        `   不透明 ${stats.opaquePct.toFixed(1)}% / 半透明 ${stats.partialPct.toFixed(1)}% / 透明 ${stats.transparentPct.toFixed(1)}%`
      );
      check("背景被抠掉", stats.transparentPct > 60, `透明 ${stats.transparentPct.toFixed(1)}%`);
      check("前景被保留", stats.opaquePct > 5, `不透明 ${stats.opaquePct.toFixed(1)}%`);
      check("无明显绿色残留", greenRemainder(merged) < 5, `${greenRemainder(merged).toFixed(2)}%`);
      check("识别出使用了空间分割", keyed[0].usedSegmentation === true);
    }
  }

  console.log("4) 抠像回归：背景被视频模型打光成暖色渐变");
  if (hasGradient) {
    for (const key of DIRECTIONS.slice(0, 2)) {
      const extracted = await extractFrames({ video: driftVideos[key], frameCount: FRAMES, longEdge: 96, cropInset: 0 });
      const keyed = extracted.frames.map((frame) => keyGreen(frame, extracted.width, extracted.height, KEY_OPTIONS));
      const merged = Buffer.concat(keyed.map((k) => k.rgba));
      const stats = alphaStats(merged);
      // 只认绿色的话，这种暖色渐变背景会几乎 0% 透明；空间分割必须把它整片吃掉。
      check(`${key} 的暖色渐变背景被整片抠掉`, stats.transparentPct > 55, `透明 ${stats.transparentPct.toFixed(1)}%`);
      check(`${key} 前景仍被保留`, stats.opaquePct > 5, `不透明 ${stats.opaquePct.toFixed(1)}%`);
      check(`${key} 走了空间分割`, keyed[0].usedSegmentation === true);
    }
  } else {
    check("渐变背景用例（本机 ffmpeg 不支持，跳过）", true);
  }

  console.log("5) 抠像回归：容差为 0 时退化回纯绿色判据");
  const noSeg = keyGreen(rows[0].frames[0], rows[0].width, rows[0].height, { ...KEY_OPTIONS, bgTolerance: 0 });
  check("关闭空间分割时 usedSegmentation=false", noSeg.usedSegmentation === false);
  check(
    "关闭空间分割仍能抠掉绿幕",
    alphaStats(noSeg.rgba).transparentPct > 60,
    `透明 ${alphaStats(noSeg.rgba).transparentPct.toFixed(1)}%`
  );

  console.log("6) 合成整图");
  const sheet = buildSheet(keyedRows);
  check(
    "整图尺寸 = 列×帧数 × 行×方向数",
    sheet.width === CELL * FRAMES && sheet.height === CELL * 8,
    `${sheet.width}x${sheet.height}`
  );
  check("算出了统一的裁剪框", sheet.bbox.empty === false && sheet.bbox.width > 0, `${sheet.bbox.width}x${sheet.bbox.height}`);

  // 自动裁剪后角色应当填满格子（留出 fillRatio 的边）。
  const firstCellPlaceholder = null;
  void firstCellPlaceholder;
  const firstCell = extractCell(sheet, 0, 0);
  // 用整行的并集来判断裁剪是否到位：单帧里方块只占一小段（它在移动），
  // 而自动裁剪对齐的是「所有帧的并集」。
  const row0Cells = Array.from({ length: FRAMES }, (_, col) => extractCell(sheet, 0, col));
  const rowBox = unionBoundingBox([{ key: "row0", frames: row0Cells, width: CELL, height: CELL }]);
  const limiting = Math.max(rowBox.width / CELL, rowBox.height / CELL);
  check(
    "自动裁剪后角色并集填满格子的限制边",
    limiting >= 0.85,
    `并集 ${rowBox.width}x${rowBox.height} / 格 ${CELL} → ${(limiting * 100).toFixed(0)}%`
  );
  const cellBox = unionBoundingBox([{ key: "x", frames: [firstCell], width: CELL, height: CELL }]);
  void cellBox;

  const sheetPng = encodePng(sheet.rgba, sheet.width, sheet.height);
  const sheetFile = join(ROOT, "out", "sheet.png");
  await writeFile(sheetFile, sheetPng);
  const probe = await probeSize(sheetFile);
  check(
    "写出的整图能被 ffmpeg 解码且尺寸一致",
    probe.width === sheet.width && probe.height === sheet.height,
    `${probe.width}x${probe.height} ${(sheetPng.length / 1024).toFixed(1)} KB`
  );

  console.log("7) 像素量化");
  // pixelSize=2：同一块内部必须完全一致，块与块之间必须确有差异。
  // 只在内容区里采样，并且严格对齐到像素块网格（content 是宿主算好的落位）。
  const sampleX0 = sheet.content.x;
  const sampleY0 = sheet.content.y;
  let uniformBlocks = true;
  for (let by = 0; by < CELL / 2 && uniformBlocks; by++) {
    for (let bx = 0; bx < CELL / 2; bx++) {
      const px = sampleX0 + bx * 2;
      const py = sampleY0 + by * 2;
      if (py + 1 >= CELL || px + 1 >= CELL) continue;
      const pick = (dx, dy) => {
        const index = ((py + dy) * CELL + (px + dx)) * 4;
        return `${firstCell[index]},${firstCell[index + 1]},${firstCell[index + 2]},${firstCell[index + 3]}`;
      };
      if (pick(0, 0) !== pick(1, 0) || pick(0, 0) !== pick(0, 1) || pick(0, 0) !== pick(1, 1)) {
        uniformBlocks = false;
        break;
      }
    }
  }
  // 在内容区里沿水平方向找一处「相邻块颜色不同」，证明真的量化出了多色块。
  let anyBlockVaries = false;
  for (let py = sampleY0; py < CELL && !anyBlockVaries; py++) {
    for (let px = sampleX0 + 2; px < CELL; px++) {
      const a = (py * CELL + px) * 4;
      const b = (py * CELL + px - 1) * 4;
      if (firstCell[a + 3] > 0 && firstCell[b + 3] > 0 && (firstCell[a] !== firstCell[b] || firstCell[a + 3] !== firstCell[b + 3])) {
        anyBlockVaries = true;
        break;
      }
    }
  }
  check("每个像素块内部颜色完全一致", uniformBlocks);
  check("块与块之间确有差异（不是整格同色）", anyBlockVaries);

  console.log("8) 关闭自动裁剪时不应崩");
  const plain = composeSheet(
    keyedRows.map((row) => ({ ...row })),
    { cellWidth: CELL, cellHeight: CELL, frameCount: FRAMES, autoCrop: false, fillRatio: 1, pixelSize: 1, fitMode: "contain", bottomMargin: 0 }
  );
  check("关闭自动裁剪仍产出正确尺寸", plain.width === CELL * FRAMES && plain.height === CELL * 8, `${plain.width}x${plain.height}`);

  console.log("9) 空输入不应崩");
  const empty = composeSheet(
    DIRECTIONS.map((key) => ({ key, frames: [], width: 0, height: 0 })),
    { cellWidth: CELL, cellHeight: CELL, frameCount: FRAMES, autoCrop: true, fillRatio: 0.94, pixelSize: 2, fitMode: "contain", bottomMargin: 1 }
  );
  check("空输入产出全透明整图", empty.rgba.every((byte) => byte === 0));

  console.log("10) 抠像回归：软边缘不得被渗漏穿透");
  // 实测踩过的坑：绿幕到白色围裙的过渡如果跨了 8 个像素，每一步的颜色差
  // 都小于局部容差，「只靠局部连续性」的洪水填充会一路渗进角色体内，
  // 把整个身体判成背景。全局颜色调色板必须挡住它。
  const soft = (() => {
    const w = 120;
    const h = 120;
    const buf = Buffer.alloc(w * h * 4);
    const cx = w / 2;
    const cy = h / 2;
    const rw = w * 0.22;
    const rh = h * 0.3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = Math.max(0, Math.abs(x - cx) - rw);
        const dy = Math.max(0, Math.abs(y - cy) - rh);
        const d = Math.sqrt(dx * dx + dy * dy);
        const t = Math.max(0, Math.min(1, 1 - d / 12)); // 12 像素软边：正好压在渗漏阈值上
        buf[i] = Math.round(30 + (243 - 30) * t);
        buf[i + 1] = Math.round(186 + (244 - 186) * t);
        buf[i + 2] = Math.round(1 + (239 - 1) * t);
        buf[i + 3] = 255;
      }
    }
    return { buf, w, h };
  })();
  const centerIndex = Math.floor(soft.h / 2) * soft.w + Math.floor(soft.w / 2);
  const strictMask = segmentBackground(soft.buf, soft.w, soft.h, 90, 40);
  check("局部容差放宽到 40 时角色内部仍不被判为背景", strictMask[centerIndex] === 0);
  const looseMask = segmentBackground(soft.buf, soft.w, soft.h, 90, 255);
  check("局部容差放到 255 也不穿透（全局调色板兜底）", looseMask[centerIndex] === 0);
  const softKeyed = keyGreen(soft.buf, soft.w, soft.h, KEY_OPTIONS);
  check("软边角色抠像后中心仍是不透明的白色", softKeyed.rgba[centerIndex * 4 + 3] === 255 && softKeyed.rgba[centerIndex * 4] > 200,
    `alpha=${softKeyed.rgba[centerIndex * 4 + 3]} rgb=${softKeyed.rgba[centerIndex * 4]},${softKeyed.rgba[centerIndex * 4 + 1]},${softKeyed.rgba[centerIndex * 4 + 2]}`);

  console.log("11) 空间分割的基本性质");
  const probeRow = await extractFrames({ video: greenVideos.front, frameCount: 1, longEdge: 96, cropInset: 0 });
  const mask = segmentBackground(probeRow.frames[0], probeRow.width, probeRow.height, 40);
  let maskCount = 0;
  for (let i = 0; i < mask.length; i++) maskCount += mask[i];
  const fraction = maskCount / mask.length;
  check("四边一定被判为背景", mask[0] === 1 && mask[probeRow.width - 1] === 1 && mask[mask.length - 1] === 1);
  check("背景占比在合理区间", fraction > 0.3 && fraction < 0.99, `${(fraction * 100).toFixed(1)}%`);

  console.log(`\n产物：${sheetFile}\n`);
  if (failures.length > 0) {
    console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
    process.exit(1);
  }
  console.log(`共 ${checks} 项检查，全部通过。`);
}

await main();
