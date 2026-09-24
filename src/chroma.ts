/**
 * 绿幕抠像与整图合成。
 *
 * 抠像有两条判据，先空间、后颜色：
 *
 * 1. **边界洪水填充**（主判据）。从画面四边出发，只沿着「与相邻已判定背景
 *    像素颜色接近」的方向生长。它跟随的是**局部连续性**而不是某个固定颜色，
 *    所以绿幕、黄幕、甚至平缓渐变的背景都能整片吃掉，并在角色轮廓的突变处
 *    停下。这一步是必需的：图生视频模型经常会把纯色背景重新打光成渐变，
 *    只认绿色的做法在那些帧上会整片失效。
 *
 *    ★ 调色板只从**背景主色簇**的边框采样点建：角色一旦贴到画面边缘
 *    （尾巴、头发、裙摆被裁到边上），它的颜色也会出现在边框上；不筛掉的话
 *    调色板里就有了角色色，填充会顺着同色的身体部位一路吃进去。实测一张
 *    438×768 的转圈帧：尾巴贴住左边缘，1.6% 的边框采样点是藏青，默认容差
 *    下 7.7% 的掩码变成了角色的裙子与头发（半条裙子直接没了）。
 *
 * 2. **绿色优势值** `g - max(r, b)`（辅助判据）。只作用在未被判定为背景的
 *    像素上，用来清理角色轮廓残留的绿色边缘，并提供去绿溢出。
 *
 * 合成则是「统一裁剪 + 区域重采样 + 像素量化」：先在所有帧上求 alpha 包围盒
 * 的并集，全部帧共用同一个框——这样各方向的缩放一致、脚底也对齐在同一条
 * 基线上；再按盒式平均重采样到目标尺寸，最后量化成 pixelSize 的方块。
 */

import { encodePng } from "./png.js";

export interface KeyOptions {
  /** 绿色优势值 ≤ 该值 → 完全不透明。 */
  keyLow: number;
  /** 绿色优势值 ≥ 该值 → 完全透明。 */
  keyHigh: number;
  /** 去绿溢出强度 0~1。 */
  despill: number;
  /** 前景 alpha 腐蚀像素数，用于消除残留绿边。 */
  edgeShrink: number;
  /** 洪水填充的局部颜色容差（RGB 欧氏距离）。0 = 关闭空间分割。 */
  bgTolerance: number;
}

export const DEFAULT_KEY_OPTIONS: KeyOptions = {
  keyLow: 14,
  keyHigh: 80,
  despill: 0.65,
  edgeShrink: 0,
  bgTolerance: 40
};

export interface KeyResult {
  rgba: Buffer;
  /** 判定为背景的像素占比，可用来判断这次抠像是否可信。 */
  backgroundFraction: number;
  /** 是否真的用上了空间分割（容差为 0 或结果不合理时为 false）。 */
  usedSegmentation: boolean;
  /** 边框采样点总数（调色板的原料）。 */
  borderSamples: number;
  /**
   * 因「不属于背景主色簇」而被排除的边框采样点数。
   *
   * 大于 0 通常意味着**角色贴到了画面边缘**（尾巴 / 头发 / 裙摆被裁到边上）：
   * 这些点已经被正确地挡在调色板之外，不必再手动降容差；但如果数值很大
   * （比如超过采样点的 1/4），说明背景本身就不均匀，值得看一眼素材。
   */
  borderSamplesDropped: number;
}

/** 两个像素的 RGB 欧氏距离。 */
function colorDistance(rgba: Buffer, a: number, b: number): number {
  const dr = rgba[a] - rgba[b];
  const dg = rgba[a + 1] - rgba[b + 1];
  const db = rgba[a + 2] - rgba[b + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 背景调色板的量化格：每通道 16 档。 */
const PALETTE_GRID = 16;
const PALETTE_CELL = 256 / PALETTE_GRID;
const PALETTE_CELLS = PALETTE_GRID * PALETTE_GRID * PALETTE_GRID;

/**
 * 单链聚类时的「同一片背景色」阈值：格心距离 ≤ 2 格（= 32）。
 *
 * 取 2 格是刻意的：沿任一通道相邻（16）、斜一格（22.6）、体对角（27.7）
 * 都算连通，于是**平缓渐变会一路串成一簇**（这正是要保留的能力），而隔了
 * 两格以上的跳跃（35.8 起）断开——角色那种与背景明显不同的颜色因此自成
 * 一小簇，随后被主簇筛掉。
 */
const CLUSTER_STEP_SQ = (2 * PALETTE_CELL) ** 2;

/** 聚类邻域（格坐标偏移，只保留距离 ≤ 2 格的）。 */
const CLUSTER_NEIGHBORS: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dg = -2; dg <= 2; dg++) {
      for (let db = -2; db <= 2; db++) {
        if (dr === 0 && dg === 0 && db === 0) continue;
        const distSq = (dr * PALETTE_CELL) ** 2 + (dg * PALETTE_CELL) ** 2 + (db * PALETTE_CELL) ** 2;
        if (distSq <= CLUSTER_STEP_SQ + 1e-6) out.push([dr, dg, db]);
      }
    }
  }
  return out;
})();

/**
 * 一个簇至少要占多少边框采样点才配进调色板。
 *
 * 只留「最大簇」会把「上半绿幕 + 下半蓝幕」这类多色背景的另一半误伤，
 * 所以按占比放行：15% 以上的簇都算背景色（实测角色贴边时那一小撮只有
 * 1.6%，稳稳被挡在门外）。
 */
const CLUSTER_MIN_SHARE = 0.15;

export interface PaletteBuild {
  grid: Uint8Array;
  samples: number;
  kept: number;
  dropped: number;
}

/**
 * 用四边像素建一个「背景色查找格」。
 *
 * 为什么需要它：只用「和相邻像素颜色接近」来生长，会顺着抗锯齿的软边缘
 * 一路渗进角色——绿幕到白色围裙的过渡如果跨了 3~4 个像素，每一步的差值
 * 都小于局部容差，填充就穿过去了。加上这条全局约束后，像素还必须「本身就像
 * 背景色」才可能被判为背景，软边缘自然被挡住。
 *
 * 采样点覆盖整圈边界，所以平缓渐变的背景也能被完整覆盖。
 *
 * ★ 采样点先按颜色聚类、只保留属于**背景主色**的那些（见 CLUSTER_STEP_SQ）。
 * 这一步是「角色贴边」那个 bug 的正解：贴边会让角色自己的颜色混进边框采样，
 * 主色筛选把它剔除，而渐变背景因为一路相连仍然完整保留。
 */
function buildBackgroundPalette(rgba: Buffer, width: number, height: number, globalTolerance: number): PaletteBuild {
  const grid = new Uint8Array(PALETTE_CELLS);
  const samples: number[] = [];
  // 步长控制采样量：长边最多取 128 个点，够覆盖渐变又不至于拖慢。
  const stepX = Math.max(1, Math.floor(width / 128));
  const stepY = Math.max(1, Math.floor(height / 128));
  for (let x = 0; x < width; x += stepX) {
    samples.push(x * 4, ((height - 1) * width + x) * 4);
  }
  for (let y = 0; y < height; y += stepY) {
    samples.push(y * width * 4, (y * width + width - 1) * 4);
  }
  if (samples.length === 0) return { grid, samples: 0, kept: 0, dropped: 0 };

  // 1) 边框颜色量化计数。
  const cellOf = (offset: number) =>
    ((rgba[offset] >> 4) << 8) | ((rgba[offset + 1] >> 4) << 4) | (rgba[offset + 2] >> 4);
  const counts = new Uint32Array(PALETTE_CELLS);
  for (const offset of samples) counts[cellOf(offset)]++;

  // 2) 在「有采样的格子」之间做单链聚类（格子最多 4096 个，代价可忽略）。
  const cluster = new Int32Array(PALETTE_CELLS).fill(-1);
  const clusterSize: number[] = [];
  for (let seed = 0; seed < PALETTE_CELLS; seed++) {
    if (counts[seed] === 0 || cluster[seed] !== -1) continue;
    const id = clusterSize.length;
    let size = 0;
    cluster[seed] = id;
    const queue = [seed];
    while (queue.length > 0) {
      const cell = queue.pop() as number;
      size += counts[cell];
      const r = cell >> 8;
      const g = (cell >> 4) & 15;
      const b = cell & 15;
      for (const [dr, dg, db] of CLUSTER_NEIGHBORS) {
        const nr = r + dr;
        const ng = g + dg;
        const nb = b + db;
        if (nr < 0 || nr >= PALETTE_GRID || ng < 0 || ng >= PALETTE_GRID || nb < 0 || nb >= PALETTE_GRID) continue;
        const next = (nr << 8) | (ng << 4) | nb;
        if (counts[next] === 0 || cluster[next] !== -1) continue;
        cluster[next] = id;
        queue.push(next);
      }
    }
    clusterSize.push(size);
  }

  // 3) 按占比决定哪些簇算「背景色」（见 CLUSTER_MIN_SHARE）。
  let largest = 0;
  for (let i = 1; i < clusterSize.length; i++) if (clusterSize[i] > clusterSize[largest]) largest = i;
  const keepCluster = clusterSize.map((size, id) => id === largest || size / samples.length >= CLUSTER_MIN_SHARE);

  // 4) 只用保留下来的采样点做球体标记。
  // 量化误差最多 8*sqrt(3) ≈ 14，补进半径里，避免刚好卡在格边界的颜色被漏掉。
  const limit = globalTolerance + 14;
  const limitSq = limit * limit;
  const radius = Math.max(1, Math.ceil(limit / PALETTE_CELL));
  const seen = new Uint8Array(PALETTE_CELLS);
  let kept = 0;

  const mark = (index: number) => {
    const r = Math.min(PALETTE_GRID - 1, rgba[index] >> 4);
    const g = Math.min(PALETTE_GRID - 1, rgba[index + 1] >> 4);
    const b = Math.min(PALETTE_GRID - 1, rgba[index + 2] >> 4);
    const key = (r * PALETTE_GRID + g) * PALETTE_GRID + b;
    if (seen[key] === 1) return;
    seen[key] = 1;
    // 必须按**球体**标记，不能只按格坐标的范围扫一圈：
    // 那会标出一个立方体，角落到中心的距离可达 limit*sqrt(3)，
    // 于是离背景很远的角色颜色也会被误判成背景色。
    for (let dr = -radius; dr <= radius; dr++) {
      const nr = r + dr;
      if (nr < 0 || nr >= PALETTE_GRID) continue;
      for (let dg = -radius; dg <= radius; dg++) {
        const ng = g + dg;
        if (ng < 0 || ng >= PALETTE_GRID) continue;
        for (let db = -radius; db <= radius; db++) {
          const nb = b + db;
          if (nb < 0 || nb >= PALETTE_GRID) continue;
          const distSq = (dr * PALETTE_CELL) ** 2 + (dg * PALETTE_CELL) ** 2 + (db * PALETTE_CELL) ** 2;
          if (distSq > limitSq) continue;
          grid[(nr * PALETTE_GRID + ng) * PALETTE_GRID + nb] = 1;
        }
      }
    }
  };

  for (const offset of samples) {
    const id = cluster[cellOf(offset)];
    if (id < 0 || keepCluster[id] !== true) continue;
    kept++;
    mark(offset);
  }

  return { grid, samples: samples.length, kept, dropped: samples.length - kept };
}

function paletteHas(grid: Uint8Array, rgba: Buffer, index: number): boolean {
  const r = Math.min(PALETTE_GRID - 1, rgba[index] >> 4);
  const g = Math.min(PALETTE_GRID - 1, rgba[index + 1] >> 4);
  const b = Math.min(PALETTE_GRID - 1, rgba[index + 2] >> 4);
  return grid[(r * PALETTE_GRID + g) * PALETTE_GRID + b] === 1;
}

/**
 * 从四边洪水填充出背景掩码：**必须同时满足**「颜色像背景（全局调色板）」
 * 和「与相邻的已判定背景像素颜色接近（局部连续性）」。
 *
 * 全局约束挡住软边缘渗透，局部约束则让填充能跟随调色板覆盖不到的渐变。
 * 返回 1 = 背景，0 = 前景。
 */
export function segmentBackground(
  rgba: Buffer,
  width: number,
  height: number,
  globalTolerance: number,
  localTolerance?: number
): Uint8Array {
  return segmentBackgroundDetailed(rgba, width, height, globalTolerance, localTolerance).mask;
}

/** 与 `segmentBackground` 同一次计算，但把调色板的采样诊断一并带出来。 */
export function segmentBackgroundDetailed(
  rgba: Buffer,
  width: number,
  height: number,
  globalTolerance: number,
  localTolerance?: number
): { mask: Uint8Array; samples: number; kept: number; dropped: number } {
  // 局部容差故意收得很紧：它只用来跨过背景自身的细微噪声与编码块边界。
  // 背景的**大范围变化**（渐变、被重新打光）由全局调色板负责——边界采样本来就
  // 覆盖了整圈颜色，局部判据不需要承担这件事。
  //
  // 收得紧是必须的：填充一旦放宽就会顺着抗锯齿的软边缘渗进角色体内，把整个
  // 身体判成背景。实测真实素材（H3 输出）在 64 帧上的表现——12/14 全部正常，
  // 16 开始穿透，18 以上整片失效。
  //
  // 12 不会因为噪声而漏抠：4 邻域填充可以从别的方向绕开孤立的噪声像素，
  // 只有**连续成片**的强边缘（也就是角色轮廓）才能挡住它。
  const local = Math.max(1, Math.round(localTolerance ?? 12));
  const built = buildBackgroundPalette(rgba, width, height, globalTolerance);
  const palette = built.grid;

  const total = width * height;
  const background = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;

  // 种子必须自己就"像背景"，否则贴边裁切的角色会被整片误删。
  const push = (index: number) => {
    if (background[index] === 1) return;
    if (!paletteHas(palette, rgba, index * 4)) return;
    background[index] = 1;
    stack[top++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (top > 0) {
    const index = stack[--top];
    const current = index * 4;
    const x = index % width;
    const y = (index - x) / width;

    const visit = (n: number) => {
      if (background[n] === 1) return;
      if (!paletteHas(palette, rgba, n * 4)) return;
      if (colorDistance(rgba, current, n * 4) > local) return;
      background[n] = 1;
      stack[top++] = n;
    };

    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }

  return { mask: background, samples: built.samples, kept: built.kept, dropped: built.dropped };
}

/** 没启用空间分割时，用颜色判据粗略估一个背景占比，供界面判断可信度。 */
function countGreenBackground(rgba: Buffer, high: number): number {
  let count = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 1] - Math.max(rgba[p], rgba[p + 2]) >= high) count++;
  }
  return count;
}

/**
 * 抠掉背景，返回新的 RGBA 缓冲区与诊断信息。
 * 输入输出都是 `width * height * 4` 字节、非预乘 alpha。
 */
export function keyGreen(rgba: Buffer, width: number, height: number, options: KeyOptions): KeyResult {
  const low = Math.max(0, Math.min(255, options.keyLow));
  const high = Math.max(low + 1, Math.min(255, options.keyHigh));
  const span = high - low;
  const despill = Math.max(0, Math.min(1, options.despill));
  const tolerance = Math.max(0, options.bgTolerance ?? 0);
  const pixels = width * height;

  // 空间分割只在结果合理时采用：几乎全是背景说明画面里没有主体，
  // 几乎没有背景说明四边就是角色本身（贴边裁切）。两种都不可信。
  let background: Uint8Array | undefined;
  let backgroundCount = 0;
  let borderSamples = 0;
  let borderSamplesDropped = 0;
  if (tolerance > 0) {
    const built = segmentBackgroundDetailed(rgba, width, height, tolerance);
    borderSamples = built.samples;
    borderSamplesDropped = built.dropped;
    let count = 0;
    for (let i = 0; i < pixels; i++) count += built.mask[i];
    const fraction = count / pixels;
    if (fraction > 0.12 && fraction < 0.985) {
      background = built.mask;
      backgroundCount = count;
    }
  }

  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < pixels; i++) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const srcAlpha = rgba[p + 3];

    const other = r > b ? r : b;
    const greenness = g - other;

    let alpha = 1;
    if (greenness >= high) alpha = 0;
    else if (greenness > low) alpha = 1 - (greenness - low) / span;
    alpha *= srcAlpha / 255;

    // 空间上确认为背景的像素直接全透明；颜色判据只负责前景里的绿色残余。
    if (background !== undefined && background[i] === 1) alpha = 0;

    let outG = g;
    if (despill > 0 && g > other) {
      const weight = despill * (1 - alpha);
      if (weight > 0) outG = Math.round(g - (g - other) * weight);
    }

    out[p] = r;
    out[p + 1] = outG;
    out[p + 2] = b;
    out[p + 3] = Math.round(alpha * 255);
  }

  if (options.edgeShrink > 0) shrinkAlpha(out, width, height, Math.min(8, Math.round(options.edgeShrink)));

  return {
    rgba: out,
    backgroundFraction: background !== undefined ? backgroundCount / pixels : countGreenBackground(rgba, high) / pixels,
    usedSegmentation: background !== undefined,
    borderSamples,
    borderSamplesDropped
  };
}

/** 对 alpha 通道做可分离的最小值滤波，等价于把前景边界向内收缩 n 像素。 */
function shrinkAlpha(rgba: Buffer, width: number, height: number, radius: number): void {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = rgba[i * 4 + 3];

  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let min = 255;
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let k = from; k <= to; k++) {
        const v = alpha[row + k];
        if (v < min) min = v;
      }
      horizontal[row + x] = min;
    }
  }

  for (let y = 0; y < height; y++) {
    const from = Math.max(0, y - radius);
    const to = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      let min = 255;
      for (let k = from; k <= to; k++) {
        const v = horizontal[k * width + x];
        if (v < min) min = v;
      }
      rgba[(y * width + x) * 4 + 3] = min;
    }
  }
}

// ── 合成 ────────────────────────────────────────────────────────────────

export interface SheetRow {
  key: string;
  /** 抠完背景的帧。 */
  frames: Buffer[];
  /** 帧的像素尺寸（同一张图里所有帧必须一致）。 */
  width: number;
  height: number;
}

export interface ComposeOptions {
  cellWidth: number;
  cellHeight: number;
  frameCount: number;
  /** 缩放到所有帧的 alpha 包围盒并集，让角色填满格子且各帧缩放一致。 */
  autoCrop: boolean;
  /** 自动裁剪后角色占格子的比例（0~1），留一点边更耐看。 */
  fillRatio: number;
  /** 像素块边长；>1 时先按块做盒式平均再填满整块，得到硬边像素风。 */
  pixelSize: number;
  /** 关掉自动裁剪时的排布方式。 */
  fitMode: "contain" | "stretch";
  /** 底部留白像素。 */
  bottomMargin: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  empty: boolean;
}

export interface SheetResult {
  rgba: Buffer;
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** 所有帧共用的裁剪框（源图像素坐标）。 */
  bbox: BoundingBox;
  /** 每个格子里角色内容的落位（格子内坐标）与实际缩放比。 */
  content: { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number };
}

/** 所有帧 alpha 包围盒的并集。 */
export function unionBoundingBox(rows: SheetRow[], threshold = 8): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const row of rows) {
    for (const frame of row.frames) {
      if (frame.length < row.width * row.height * 4) continue;
      for (let y = 0; y < row.height; y++) {
        const rowStart = y * row.width * 4;
        for (let x = 0; x < row.width; x++) {
          if (frame[rowStart + x * 4 + 3] <= threshold) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0, empty: true };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, empty: false };
}

/**
 * 把一块的源区域做盒式平均（按 alpha 预乘，避免背景色渗进边缘），
 * 再填满输出里对应的整块。
 */
function blitBlock(
  out: Buffer,
  outWidth: number,
  outHeight: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
  frame: Buffer,
  frameWidth: number,
  frameHeight: number,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number
): void {
  const x0 = Math.max(0, destX);
  const y0 = Math.max(0, destY);
  const x1 = Math.min(outWidth, destX + destW);
  const y1 = Math.min(outHeight, destY + destH);
  if (x1 <= x0 || y1 <= y0) return;

  const sx0 = Math.max(0, Math.floor(srcX));
  const sy0 = Math.max(0, Math.floor(srcY));
  const sx1 = Math.min(frameWidth, Math.ceil(srcX + srcW));
  const sy1 = Math.min(frameHeight, Math.ceil(srcY + srcH));
  if (sx1 <= sx0 || sy1 <= sy0) return;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let count = 0;
  for (let y = sy0; y < sy1; y++) {
    let index = (y * frameWidth + sx0) * 4;
    for (let x = sx0; x < sx1; x++, index += 4) {
      const a = frame[index + 3];
      sumR += frame[index] * a;
      sumG += frame[index + 1] * a;
      sumB += frame[index + 2] * a;
      sumA += a;
      count++;
    }
  }
  if (count === 0 || sumA === 0) return;

  const r = Math.round(sumR / sumA);
  const g = Math.round(sumG / sumA);
  const b = Math.round(sumB / sumA);
  const a = Math.round(sumA / count);

  for (let y = y0; y < y1; y++) {
    let index = (y * outWidth + x0) * 4;
    for (let x = x0; x < x1; x++, index += 4) {
      out[index] = r;
      out[index + 1] = g;
      out[index + 2] = b;
      out[index + 3] = a;
    }
  }
}

/**
 * 把每个方向的 N 帧拼成一张整图：**行 = 方向，列 = 帧**。
 * 缺帧的格子留空（全透明），方便肉眼看出是哪一步没跑出来。
 */
export function composeSheet(rows: SheetRow[], options: ComposeOptions): SheetResult {
  const columns = Math.max(1, options.frameCount);
  const rowCount = Math.max(1, rows.length);
  const cellWidth = options.cellWidth;
  const cellHeight = options.cellHeight;
  const width = cellWidth * columns;
  const height = cellHeight * rowCount;
  const rgba = Buffer.alloc(width * height * 4);

  const pixelSize = Math.max(1, Math.round(options.pixelSize));
  const first = rows.find((row) => row.frames.length > 0);
  const frameWidth = first?.width ?? cellWidth;
  const frameHeight = first?.height ?? cellHeight;

  const bbox = options.autoCrop
    ? unionBoundingBox(rows)
    : { x: 0, y: 0, width: frameWidth, height: frameHeight, empty: false };
  const emptyContent = { x: 0, y: 0, width: 0, height: 0, scaleX: 0, scaleY: 0 };
  if (bbox.empty || bbox.width <= 0 || bbox.height <= 0) {
    return { rgba, width, height, columns, rows: rowCount, bbox, content: emptyContent };
  }

  const bottomMargin = Math.max(0, Math.min(cellHeight - 1, Math.round(options.bottomMargin)));
  let scaleX: number;
  let scaleY: number;
  if (options.fitMode === "stretch") {
    scaleX = cellWidth / bbox.width;
    scaleY = (cellHeight - bottomMargin) / bbox.height;
  } else {
    const fill = Math.max(0.1, Math.min(1, options.fillRatio));
    const scale = Math.min((cellWidth * fill) / bbox.width, ((cellHeight - bottomMargin) * fill) / bbox.height);
    scaleX = scale;
    scaleY = scale;
  }

  const contentW = Math.min(cellWidth, Math.max(1, Math.round(bbox.width * scaleX)));
  const contentH = Math.min(cellHeight - bottomMargin, Math.max(1, Math.round(bbox.height * scaleY)));
  const offsetX = Math.round((cellWidth - contentW) / 2);
  // 贴底放置：脚底落在同一条基线上，上下起伏才不会看起来在飘。
  const offsetY = Math.max(0, cellHeight - bottomMargin - contentH);

  const blocksX = Math.ceil(cellWidth / pixelSize);
  const blocksY = Math.ceil(cellHeight / pixelSize);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    for (let col = 0; col < columns; col++) {
      const frame = row.frames[col];
      if (frame === undefined || frame.length < frameWidth * frameHeight * 4) continue;

      const cellOriginX = col * cellWidth;
      const cellOriginY = rowIndex * cellHeight;

      // by/bx 是「相对内容左上角」的块序号，所以块在格子里的绝对位置是
      // offsetY + by*pixelSize；relY 就是它相对内容原点的偏移。
      for (let by = 0; by < blocksY; by++) {
        const relY = by * pixelSize;
        if (relY >= contentH) break;
        const destY = offsetY + relY;

        for (let bx = 0; bx < blocksX; bx++) {
          const relX = bx * pixelSize;
          if (relX >= contentW) break;
          const destX = offsetX + relX;

          // 只重采样落在内容区内的那一部分（块可能被内容边界截断）
          const clipLeft = Math.max(0, destX);
          const clipTop = Math.max(0, destY);
          const clipRight = Math.min(cellWidth, destX + pixelSize);
          const clipBottom = Math.min(cellHeight, destY + pixelSize);
          if (clipRight <= clipLeft || clipBottom <= clipTop) continue;
          if (clipRight <= offsetX || clipLeft >= offsetX + contentW) continue;
          if (clipBottom <= offsetY || clipTop >= offsetY + contentH) continue;

          blitBlock(
            rgba,
            width,
            height,
            cellOriginX + clipLeft,
            cellOriginY + clipTop,
            clipRight - clipLeft,
            clipBottom - clipTop,
            frame,
            frameWidth,
            frameHeight,
            bbox.x + (clipLeft - offsetX) / scaleX,
            bbox.y + (clipTop - offsetY) / scaleY,
            (clipRight - clipLeft) / scaleX,
            (clipBottom - clipTop) / scaleY
          );
        }
      }
    }
  }

  return {
    rgba,
    width,
    height,
    columns,
    rows: rowCount,
    bbox,
    content: { x: offsetX, y: offsetY, width: contentW, height: contentH, scaleX, scaleY }
  };
}

/** 把一串同尺寸帧横向拼成一条预览带（只给界面看）。 */
export function makeStrip(frames: Buffer[], cellWidth: number, cellHeight: number): Buffer {
  const width = cellWidth * frames.length;
  const rgba = Buffer.alloc(width * cellHeight * 4);
  const cellBytes = cellWidth * cellHeight * 4;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.length < cellBytes) continue;
    for (let y = 0; y < cellHeight; y++) {
      const srcStart = y * cellWidth * 4;
      const destStart = (y * width + i * cellWidth) * 4;
      frame.copy(rgba, destStart, srcStart, srcStart + cellWidth * 4);
    }
  }
  return encodePng(rgba, width, cellHeight);
}

/** 抠完一帧后直接编码成 PNG。 */
export function keyedPng(rgba: Buffer, width: number, height: number): Buffer {
  return encodePng(rgba, width, height);
}
