/**
 * 地图地块模块的图像编解码与基础像素操作。
 *
 * 这一层只做「字节 ↔ RGBA 缓冲区」和几个原语（PNG 头、颜色统计、菱形遮罩）。
 * 一切几何算法都在 `tilegeom.ts`，拼图在 `tilemap.ts`。
 *
 * 为什么 PNG 解码走 ffmpeg：仓库**没有任何运行时依赖**（见 AGENTS.md），
 * 手写 PNG 解码器要处理 5 种 filter 类型，而 ffmpeg 已经是本插件的既有依赖
 * （抽帧、抠像都用它）。这里把调用集中成一个函数，以后要换只改一处。
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { encodePng } from "./png.js";
import { ffmpegPath } from "./media.js";

/** 解码出来的位图：RGBA8，逐行紧密排列，长度 = width * height * 4。 */
export interface Bitmap {
  width: number;
  height: number;
  rgba: Buffer;
  /**
   * 裁剪前的偏移（只有 `trimTransparent` 的返回值会带这两个字段）。
   *
   * 成品图是裁过边的，而等距布局算出来的是**未裁**坐标；界面要把可点的格子
   * 叠在裁剪后的预览图上，就必须先减掉这个偏移，否则叠层整体错位。
   */
  left?: number;
  top?: number;
}

/** PNG 头里的尺寸（不解码像素，用来做廉价校验）。 */
export function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** 文件头嗅探（与 ark.ts 同一套判据，但只回扩展名）。 */
export function sniffImageExt(bytes: Buffer): "png" | "jpg" | "webp" | "gif" {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 6 && bytes.toString("ascii", 0, 3) === "GIF") return "gif";
  return "png";
}

/**
 * 用 ffmpeg 把任意图片解成 RGBA8。
 *
 * `maxEdge > 0` 时先等比缩到长边不超过它（大图测量时省内存；规整必须用原图）。
 * 解出来的尺寸会和 PNG 头对一次账 —— 管道读二进制最容易出的错就是「少读/多读」，
 * 而那种错只会让几何量出偏差值，不会抛异常。
 */
export async function decodeImage(file: string, maxEdge = 0): Promise<Bitmap> {
  const args = ["-hide_banner", "-loglevel", "error", "-i", file];
  if (maxEdge > 0) {
    args.push("-vf", `scale='if(gt(iw,ih),min(iw,${maxEdge}),-2)':'if(gt(iw,ih),-2,min(ih,${maxEdge}))'`);
  }
  args.push("-f", "rawvideo", "-pix_fmt", "rgba", "-");

  const rgba = await runFfmpeg(args);
  // 尺寸取自 ffprobe 语义：先按 raw 长度反推单像素宽度不现实，所以单独探一次。
  const { width, height } = await probeDecodedSize(file, maxEdge);
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`解码 ${file} 得到 ${rgba.length} 字节，按 ${width}×${height} 应为 ${expected} 字节`);
  }
  return { width, height, rgba };
}

/** 解出缩放后的真实尺寸。 */
async function probeDecodedSize(file: string, maxEdge: number): Promise<{ width: number; height: number }> {
  const args = ["-hide_banner", "-loglevel", "error", "-i", file];
  if (maxEdge > 0) {
    args.push("-vf", `scale='if(gt(iw,ih),min(iw,${maxEdge}),-2)':'if(gt(iw,ih),-2,min(ih,${maxEdge}))'`);
  }
  args.push("-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-");
  const one = await runFfmpeg(args);
  const size = pngSize(one);
  if (size === undefined) throw new Error(`无法确定 ${file} 的尺寸`);
  return size;
}

function runFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", (error) => reject(new Error(`无法启动 ffmpeg：${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg 解码失败（退出码 ${code}）：${Buffer.concat(errors).toString("utf8").slice(0, 400)}`));
    });
  });
}

/** 读盘 + 解码。 */
export async function decodeFile(file: string, maxEdge = 0): Promise<Bitmap> {
  return decodeImage(file, maxEdge);
}

/** 编码落盘用的 PNG 字节。 */
export function encodeBitmap(bitmap: Bitmap): Buffer {
  return encodePng(bitmap.rgba, bitmap.width, bitmap.height);
}

/** 造一张纯色 RGBA 位图。 */
export function solidBitmap(width: number, height: number, color: [number, number, number, number]): Bitmap {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  return { width, height, rgba };
}

export function pixelAt(bitmap: Bitmap, x: number, y: number): [number, number, number, number] {
  const i = (y * bitmap.width + x) * 4;
  return [bitmap.rgba[i], bitmap.rgba[i + 1], bitmap.rgba[i + 2], bitmap.rgba[i + 3]];
}

/** 位图里是否至少有一个透明像素（用来判断「这张图到底带不带 alpha」）。 */
export function hasAlphaChannel(bitmap: Bitmap, threshold = 24): boolean {
  const { rgba } = bitmap;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < threshold) return true;
  }
  return false;
}

/**
 * 画布四边的众数颜色 —— 当作“背景色”。
 *
 * 为什么不用「四角平均」：生成图四角常带一点噪声（本次实测边框色有
 * (254,254,254) / (253,253,253) / (251,253,254) 几种），取众数比取平均稳。
 */
export function borderColor(bitmap: Bitmap): [number, number, number] {
  const counts = new Map<number, number>();
  const bump = (x: number, y: number) => {
    const i = (y * bitmap.width + x) * 4;
    const key = (bitmap.rgba[i] << 16) | (bitmap.rgba[i + 1] << 8) | bitmap.rgba[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < bitmap.width; x++) {
    bump(x, 0);
    bump(x, bitmap.height - 1);
  }
  for (let y = 0; y < bitmap.height; y++) {
    bump(0, y);
    bump(bitmap.width - 1, y);
  }
  let best = 0;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = key;
    }
  }
  return [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff];
}

/**
 * 从四边向内泛洪，标出「与边框连通的背景区域」。
 *
 * 为什么不用「离背景色远 = 前景」：草地地块的表面颜色和白色背景接近，
 * 那个判据会把整张画布当前景 —— 研究期实测拟合出的斜率变成 1.14（实际 2.0），
 * 而且不报任何错。泛洪只吃「与边框连通」的那一片，内部同色区域不会被误伤。
 */
export function backgroundMask(bitmap: Bitmap, tolerance = 22): Uint8Array {
  const { width, height, rgba } = bitmap;
  const bg = borderColor(bitmap);
  const near = new Uint8Array(width * height);
  const limit = tolerance * 3;
  for (let i = 0, p = 0; i < near.length; i++, p += 4) {
    const d = Math.abs(rgba[p] - bg[0]) + Math.abs(rgba[p + 1] - bg[1]) + Math.abs(rgba[p + 2] - bg[2]);
    near[i] = d <= limit ? 1 : 0;
  }
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const push = (index: number) => {
    if (near[index] === 1 && seen[index] === 0) {
      seen[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }
  return seen;
}

/** 前景掩码：带 alpha 就信 alpha，否则用泛洪找背景。 */
export function foregroundMask(bitmap: Bitmap, tolerance = 22): Uint8Array {
  const { width, height, rgba } = bitmap;
  if (hasAlphaChannel(bitmap)) {
    const mask = new Uint8Array(width * height);
    for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = rgba[p] >= 24 ? 1 : 0;
    return mask;
  }
  const bg = backgroundMask(bitmap, tolerance);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = bg[i] === 1 ? 0 : 1;
  return mask;
}

/** 掩码的紧致包围盒；全空时返回 undefined。 */
export function maskBounds(mask: Uint8Array, width: number, height: number):
  { left: number; top: number; right: number; bottom: number } | undefined {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return undefined;
  return { left, top, right, bottom };
}

/** 掩码里 1 的个数。 */
export function maskCount(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}
