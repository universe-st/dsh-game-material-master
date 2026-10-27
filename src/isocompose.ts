/**
 * 45° 地图编辑器「AI 生成素材」的**像素整理**：把模型吐出来的原图整理成
 * 可直接交给 `importIsoTileset` 的素材图。
 *
 * 这一层只做几何 / 像素，不碰磁盘上的项目文件；`isogen.composeIsoAsset` 负责
 * 落盘到 `ai/`、写日志与返回回链信息。
 *
 * 首版只支持两种：
 *   · `ground`：一块 2:1 菱形地面；多帧竖排成动画地面；
 *   · `object`：一张完整物件图（多帧竖排），纯绿幕背景，按 footprint 占格。
 *
 * `autotile`（4×4 = 16 种接法）不在这里做：单张 AI 图无法可靠推导 16 种接法，
 * 继续走手工导入。
 */

import { stat } from "node:fs/promises";
import { decodeFile, type Bitmap } from "./bitmap.js";
import { MAX_ASSET_SCALE, keyStampBackground, resampleToSize, STAMP_KEY_OPTIONS } from "./maptiles.js";
import { isGreenKeyColor, keyScreenName, normalizeKeyColor } from "./keycolor.js";
import { keyGreen } from "./chroma.js";
import type { IsoCell, IsoFootprint } from "./isogeom.js";

export type IsoAiAssetKind = "ground" | "object";

export interface ComposeIsoFramesInput {
  /** 本机绝对路径，顺序即帧顺序。 */
  files: readonly string[];
  kind: IsoAiAssetKind;
  cell: IsoCell;
  /** 仅 object；默认 1×1。 */
  footprint?: IsoFootprint;
  /** 是否把背景抠成透明；默认 true。 */
  keyGreen?: boolean;
  /** 背景色（`#RRGGBB`，留空 = 默认绿）。 */
  keyColor?: string;
}

export interface ComposeIsoFramesResult {
  bitmap: Bitmap;
  frameCount: number;
  frameHeight: number;
  scale: number;
  /** 绿幕被抠掉的像素比例；0 = 没抠到 / 没开。 */
  keyed: number;
  notes: string[];
}

const MAX_AI_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_AI_FRAMES = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 按 alpha 裁到真正有内容的包围盒（绿幕 / 透明背景都能用）。 */
function cropOpaque(source: Bitmap): Bitmap {
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (source.rgba[(y * source.width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) throw new Error("整理后的素材是空白的（整张图都透明）。");
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width === source.width && height === source.height) return source;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((top + y) * source.width + left) * 4;
    source.rgba.copy(rgba, y * width * 4, from, from + width * 4);
  }
  return { width, height, rgba };
}

/** 读一张原图、抠绿、裁到内容边界；返回可直接缩放的帧。 */
async function readFrame(file: string, keyGreen: boolean, keyColor: string): Promise<{ bitmap: Bitmap; keyed: number }> {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new Error(`读不到帧文件：${file}`);
  }
  if (!info.isFile()) throw new Error(`不是文件：${file}`);
  if (info.size > MAX_AI_FRAME_BYTES) {
    throw new Error(`帧文件 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过上限 ${MAX_AI_FRAME_BYTES / 1024 / 1024}MB：${file}`);
  }
  let bitmap: Bitmap;
  try {
    bitmap = await decodeFile(file);
  } catch (error) {
    throw new Error(`读不出帧文件 ${file}：${messageOf(error)}`);
  }
  let keyed = 0;
  if (keyGreen) {
    const result = keyStampBackground(bitmap, (rgba, width, height) => {
      // 与「整图」同一条严格绿幕参数：只认饱和纯绿，避免把草地 / 深色阴影误判成背景。
      return keyBackgroundPixels(rgba, width, height, keyColor);
    });
    bitmap = result.bitmap;
    keyed = result.keyed;
  }
  return { bitmap: cropOpaque(bitmap), keyed };
}

/**
 * 严格绿幕（与 maptiles.STAMP_KEY_OPTIONS 同口径）。
 * 这里单独包一层是为了不把 chroma 的默认参数（适合角色）带进地图素材。
 */
function keyBackgroundPixels(rgba: Buffer, width: number, height: number, keyColor: string): { rgba: Buffer; backgroundFraction: number } {
  const color = normalizeKeyColor(keyColor);
  // 绿色保持原来的严格判据（只认饱和纯绿），避免把草地 / 深色阴影误判成背景。
  if (isGreenKeyColor(color)) {
    const out = Buffer.from(rgba);
    let hit = 0;
    for (let i = 0; i < width * height; i++) {
      const r = out[i * 4];
      const g = out[i * 4 + 1];
      const b = out[i * 4 + 2];
      const advantage = g - Math.max(r, b);
      if (g >= STAMP_KEY_OPTIONS.keyLow && advantage >= STAMP_KEY_OPTIONS.keyHigh) {
        out[i * 4 + 3] = 0;
        hit++;
      }
    }
    return { rgba: out, backgroundFraction: hit / Math.max(1, width * height) };
  }
  return keyGreen(rgba, width, height, { ...STAMP_KEY_OPTIONS, keyColor: color });
}

/** 把一帧贴进目标格子的菱形框；只保留菱形内部。 */
function drawGroundDiamond(source: Bitmap, cell: IsoCell, scale: number): Bitmap {
  const width = Math.max(1, cell.width * scale);
  const height = Math.max(1, cell.height * scale);
  const diamondWidth = width;
  const diamondHeight = Math.max(2, Math.round(width / 2));
  const fitted = resampleToSize(source, diamondWidth, diamondHeight, "smooth");
  const out: Bitmap = { width, height, rgba: Buffer.alloc(width * height * 4) };
  const cx = width / 2;
  const cy = height / 2;
  const halfW = diamondWidth / 2;
  const halfH = diamondHeight / 2;
  const originY = Math.round((height - diamondHeight) / 2);
  const border = averageEdgeColor(fitted);
  const band = Math.max(1, Math.round(diamondWidth * 0.018));
  for (let y = 0; y < diamondHeight; y++) {
    for (let x = 0; x < diamondWidth; x++) {
      const d = Math.abs(x + 0.5 - diamondWidth / 2) / halfW + Math.abs(y + 0.5 - diamondHeight / 2) / halfH;
      // 多铺一点点：相邻菱形共享的那条边必须两边都盖到，否则会留透明缝。
      if (d > 1.008) continue;
      const si = (y * diamondWidth + x) * 4;
      if (fitted.rgba[si + 3] === 0) continue;
      const tx = x;
      const ty = originY + y;
      const di = (ty * width + tx) * 4;
      const edgeStart = 1 - band / Math.max(1, Math.min(halfW, halfH));
      const t = d <= edgeStart ? 0 : clamp((d - edgeStart) / Math.max(0.0001, 1 - edgeStart), 0, 1);
      // 外圈向该帧的边缘平均色收敛：同一张素材重复铺时，相邻边颜色一致。
      const mix = t * 0.85;
      out.rgba[di] = Math.round(fitted.rgba[si] * (1 - mix) + border.r * mix);
      out.rgba[di + 1] = Math.round(fitted.rgba[si + 1] * (1 - mix) + border.g * mix);
      out.rgba[di + 2] = Math.round(fitted.rgba[si + 2] * (1 - mix) + border.b * mix);
      out.rgba[di + 3] = 255;
    }
  }
  return out;
}

/** 取菱形最外圈不透明像素的平均色，作为边缘收敛的目标色。 */
function averageEdgeColor(source: Bitmap): { r: number; g: number; b: number } {
  const halfW = source.width / 2;
  const halfH = source.height / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const d = Math.abs(x + 0.5 - halfW) / Math.max(1, halfW) + Math.abs(y + 0.5 - halfH) / Math.max(1, halfH);
      if (d < 0.82 || d > 1.01) continue;
      const i = (y * source.width + x) * 4;
      if (source.rgba[i + 3] === 0) continue;
      r += source.rgba[i];
      g += source.rgba[i + 1];
      b += source.rgba[i + 2];
      n++;
    }
  }
  if (n === 0) return { r: 128, g: 128, b: 128 };
  return { r: r / n, g: g / n, b: b / n };
}

/** 把一帧贴进物件图；保持第一帧的比例，所有帧共用同一尺寸。 */
function objectFrame(source: Bitmap, targetWidth: number, targetHeight: number): Bitmap {
  return resampleToSize(source, targetWidth, targetHeight, "smooth");
}

/** 竖向拼帧。 */
function stackFrames(frames: readonly Bitmap[]): Bitmap {
  if (frames.length === 0) throw new Error("没有可整理的帧。");
  const width = frames[0].width;
  const height = frames[0].height;
  const out: Bitmap = { width, height: height * frames.length, rgba: Buffer.alloc(width * height * frames.length * 4) };
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (frame.width !== width || frame.height !== height) throw new Error("各帧尺寸不一致，无法竖排。");
    frame.rgba.copy(out.rgba, index * width * height * 4);
  }
  return out;
}

export async function composeIsoFrames(input: ComposeIsoFramesInput): Promise<ComposeIsoFramesResult> {
  const files = (input.files ?? []).map((file) => String(file));
  if (files.length === 0) throw new Error("没有可整理的帧：files 不能为空。");
  if (files.length > MAX_AI_FRAMES) throw new Error(`一份素材最多 ${MAX_AI_FRAMES} 张图，收到 ${files.length} 张。`);
  if (input.kind !== "ground" && input.kind !== "object") {
    throw new Error(`AI 生成素材目前只支持 ground / object（收到 ${String(input.kind)}）。自动连接 4×4 请手工导入。`);
  }
  const cell = { width: Math.max(1, Math.round(input.cell.width)), height: Math.max(1, Math.round(input.cell.height)) };
  const footprint = input.footprint === undefined
    ? { cols: 1, rows: 1 }
    : { cols: Math.max(1, Math.round(input.footprint.cols)), rows: Math.max(1, Math.round(input.footprint.rows)) };
  const keyGreen = input.keyGreen !== false;
  const keyColor = normalizeKeyColor(input.keyColor);
  const notes: string[] = [];
  const read = [];
  for (const file of files) read.push(await readFrame(file, keyGreen, keyColor));

  const keyedValues = read.map((entry) => entry.keyed);
  const keyedCount = keyedValues.filter((value) => value > 0).length;
  const keyed = keyedValues.length === 0 ? 0 : keyedValues.reduce((sum, value) => sum + value, 0) / keyedValues.length;
  const screen = keyScreenName(keyColor, "zh");
  if (keyGreen && keyedCount === 0) {
    notes.push(`没检测到${screen}背景：这次按原图用了。想要透明背景，让模型把背景画成纯色 ${keyColor}（不要渐变 / 阴影）。`);
  } else if (keyedCount > 0) {
    notes.push(`已抠掉${screen}背景（平均 ${Math.round(keyed * 100)}% 的像素变成透明）。`);
  }

  if (input.kind === "ground") {
    const first = read[0].bitmap;
    const ratio = first.width / Math.max(1, first.height);
    if (Math.abs(Math.log(ratio / 2)) > Math.log(1.35)) {
      notes.push(`这张图的宽高比是 ${ratio.toFixed(2)}，不是 2:1 的等距菱形：已经缩放成菱形，内容会有一点压扁 / 拉长。下次在提示词里要求「严格 2:1 菱形」。`);
    }
    const scale = clamp(Math.floor(first.width / Math.max(1, cell.width)), 1, MAX_ASSET_SCALE);
    const frames = read.map((entry) => drawGroundDiamond(entry.bitmap, cell, scale));
    return {
      bitmap: stackFrames(frames),
      frameCount: frames.length,
      frameHeight: cell.height * scale,
      scale,
      keyed,
      notes
    };
  }

  const first = read[0].bitmap;
  const scale = clamp(Math.round(first.width / Math.max(1, footprint.cols * cell.width)), 1, MAX_ASSET_SCALE);
  const targetWidth = Math.max(1, footprint.cols * cell.width * scale);
  const targetHeight = Math.max(1, Math.round((first.height * targetWidth) / Math.max(1, first.width)));
  const frames = read.map((entry) => {
    if (Math.abs(entry.bitmap.width / Math.max(1, entry.bitmap.height) - first.width / Math.max(1, first.height)) > 0.05) {
      notes.push("各帧的宽高比不一致：已经统一到第一帧的尺寸，画面可能略有拉伸。");
    }
    return objectFrame(entry.bitmap, targetWidth, targetHeight);
  });
  return {
    bitmap: stackFrames(frames),
    frameCount: frames.length,
    frameHeight: targetHeight,
    scale,
    keyed,
    notes
  };
}
