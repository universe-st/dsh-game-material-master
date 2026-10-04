/**
 * 地图地块模块的**拼图**：把单元格地块按等距网格铺成一张地图。
 *
 * ## 坐标系统（最容易写错的一处）
 *
 * ```
 * 单元格：cellWidth × cellHeight（默认 64×96）
 * 菱形：  宽 = cellWidth，高 = cellWidth / 2（2:1 等距）
 * 步进：  stepX = cellWidth / 2
 *         stepY = 菱形高 / 2 = cellWidth / 4     ← 来自菱形高，**不是 cellHeight**
 * ```
 *
 * 写成 `stepY = cellHeight / 4` 会得到 24（正确是 16），整张图就裂了。
 * 研究期第一次拼图正是把「贴图尺寸」当成了「网格步进」，整张图裂成白格。
 *
 * ## 绘制顺序即遮挡顺序
 *
 * 按 `(r + c)` 升序绘制。前面一行的地块天然会盖住后面那格装饰的下半部 ——
 * 这正是等距游戏想要的效果，**不需要**额外的 z 排序逻辑。
 */

import type { Bitmap } from "./tilemedia.js";
import { diamondHeight, diamondCenterY, type TileSettings } from "./tilegeom.js";

/** 地图布局。与几何分离，所以改布局是零成本的。 */
export interface TileMapState {
  rows: number;
  cols: number;
  /** 变体抽取用的随机种子。同种子 + 同布局 = 逐像素一致。 */
  seed: number;
  /** 每格的地形 key（`cells[r][c]`）；空串表示空格。 */
  cells: string[][];
  /** 独立装饰：`"r,c"` → 装饰 key。 */
  decor: Record<string, string>;
  /** 跨格建筑锚点：`[行, 列, key]`。 */
  buildings: Array<[number, number, string]>;
  /** 拼图产物（相对项目目录）。未拼图时无此字段。 */
  png?: string;
  json?: string;
}

export function emptyMapState(rows = 14, cols = 14, fill = "grass", seed = 20261004): TileMapState {
  return {
    rows,
    cols,
    seed,
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill)),
    decor: {},
    buildings: []
  };
}

/**
 * 确定性 PRNG（mulberry32）。
 *
 * **不能用 `Math.random`** —— 验收标准要求「同种子 + 同布局 → 逐像素一致」，
 * 而 `Math.random` 会让每次铺图都不同，用户也就无法复现一张满意的地图。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AssembleOptions {
  /** 背景色；alpha 为 0 时输出透明背景。 */
  background?: [number, number, number, number];
  settings: TileSettings;
  /** 按类别给出候选变体 key（地形 key → 可选变体列表）。 */
  families: Record<string, string[]>;
}

/**
 * 把地块铺成地图。
 *
 * `cells` 里给的是**地形类别**，具体用哪个变体由种子随机抽 ——
 * 这是打散网格重复感唯一的杠杆（实测只有 1 个变体时能看出明显的 2×2 重复）。
 */
export function assembleMap(
  lookup: Map<string, Bitmap>,
  state: TileMapState,
  options: AssembleOptions
): Bitmap {
  const { settings } = options;
  const stepX = settings.cellWidth / 2;
  const stepY = diamondHeight(settings) / 2;
  const cellW = settings.cellWidth;
  const cellH = settings.cellHeight;

  if (state.rows < 1 || state.cols < 1) throw new Error("地图至少要有 1 行 1 列");
  if (state.rows > 64 || state.cols > 64) throw new Error(`地图最大 64×64，收到 ${state.cols}×${state.rows}`);
  // 画布尺寸守卫：不守卫的话 64×64 会尝试分配几百 MB 然后 OOM
  const canvasW = Math.ceil((state.cols + state.rows) * stepX + cellW);
  const canvasH = Math.ceil((state.rows + state.cols) * stepY + cellH * 2);
  if (canvasW * canvasH > 64 * 1024 * 1024) {
    throw new Error(`地图画布过大（${canvasW}×${canvasH}）`);
  }

  const bg = options.background ?? [0, 0, 0, 0];
  const out = Buffer.alloc(canvasW * canvasH * 4);
  for (let i = 0; i < canvasW * canvasH; i++) {
    out[i * 4] = bg[0];
    out[i * 4 + 1] = bg[1];
    out[i * 4 + 2] = bg[2];
    out[i * 4 + 3] = bg[3];
  }

  const originX = (state.rows - 1) * stepX;
  const originY = cellH;
  const at = (r: number, c: number) => ({
    x: Math.round(originX + (c - r) * stepX),
    y: Math.round(originY + (c + r) * stepY)
  });

  const rng = mulberry32(state.seed);
  const decorAt = new Map<string, string[]>();
  for (const [key, name] of Object.entries(state.decor)) decorAt.set(key, [...(decorAt.get(key) ?? []), name]);

  // 按 (r+c) 升序：远的先画，近的盖住远的
  const order: Array<{ r: number; c: number; key: number }> = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) order.push({ r, c, key: r + c });
  }
  order.sort((a, b) => (a.key - b.key) || (a.r - b.r));

  for (const { r, c } of order) {
    const family = state.cells[r]?.[c] ?? "";
    if (family !== "") {
      const candidates = (options.families[family] ?? [family]).filter((k) => lookup.has(k));
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(rng() * candidates.length)];
        const cell = lookup.get(pick)!;
        const { x, y } = at(r, c);
        blit(out, canvasW, canvasH, cell, x, y);
      }
    }
    // 装饰插在「自己那格之后、下一格之前」：前排地块会自然盖住它的下半部
    for (const name of decorAt.get(`${r},${c}`) ?? []) {
      const sprite = lookup.get(name);
      if (sprite === undefined) continue;
      const { x, y } = at(r, c);
      blit(out, canvasW, canvasH, sprite, x, y);
    }
  }

  // 跨格建筑：贴图约定「大菱形下顶点」在 (w/2, h − 8·scaleFactor)，
  // 这里按 cellHeight 折算：贴图自己已经留了底边距，所以锚到 2×2 区域的下顶点。
  for (const [r, c, name] of state.buildings) {
    const sprite = lookup.get(name);
    if (sprite === undefined) continue;
    const x = Math.round(originX + (c - r) * stepX - sprite.width / 2);
    const y = Math.round(originY + (r + c + 2) * stepY - sprite.height + Math.round(cellH / 12));
    blit(out, canvasW, canvasH, sprite, x, y);
  }

  return { width: canvasW, height: canvasH, rgba: out };
}

/** 把 `src` 以 source-over 混合到 `dst` 的 (dx, dy)。 */
function blit(dst: Buffer, dstW: number, dstH: number, src: Bitmap, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dstH) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dstW) continue;
      const si = (y * src.width + x) * 4;
      const sa = src.rgba[si + 3];
      if (sa === 0) continue;
      const di = (ty * dstW + tx) * 4;
      if (sa === 255) {
        dst[di] = src.rgba[si];
        dst[di + 1] = src.rgba[si + 1];
        dst[di + 2] = src.rgba[si + 2];
        dst[di + 3] = 255;
        continue;
      }
      const a = sa / 255;
      const inv = 1 - a;
      const da = dst[di + 3] / 255;
      const outA = a + da * inv;
      if (outA <= 0) continue;
      dst[di] = Math.round((src.rgba[si] * a + dst[di] * da * inv) / outA);
      dst[di + 1] = Math.round((src.rgba[si + 1] * a + dst[di + 1] * da * inv) / outA);
      dst[di + 2] = Math.round((src.rgba[si + 2] * a + dst[di + 2] * da * inv) / outA);
      dst[di + 3] = Math.round(outA * 255);
    }
  }
}

/** 裁掉四周全透明的边（地图留白太多时用）。 */
export function trimTransparent(src: Bitmap, alphaThreshold = 8): Bitmap {
  let left = src.width;
  let top = src.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.rgba[(y * src.width + x) * 4 + 3] < alphaThreshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return src;
  const w = right - left + 1;
  const h = bottom - top + 1;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    src.rgba.copy(rgba, y * w * 4, ((y + top) * src.width + left) * 4, ((y + top) * src.width + left + w) * 4);
  }
  return { width: w, height: h, rgba };
}

/**
 * 统计一张地图里「完全透明的洞」的像素数 —— 验收断言 S1 用它。
 *
 * 判据是**内部**透明：先把外部背景连通的透明区域排除，剩下的就是洞。
 * 直接数 `alpha === 0` 会把外部背景也算进去，永远不为 0。
 */
export function countInteriorHoles(src: Bitmap): number {
  const total = src.width * src.height;
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const push = (index: number) => {
    if (outside[index] === 0 && src.rgba[index * 4 + 3] < 8) {
      outside[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < src.width; x++) {
    push(x);
    push((src.height - 1) * src.width + x);
  }
  for (let y = 0; y < src.height; y++) {
    push(y * src.width);
    push(y * src.width + src.width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % src.width;
    const y = (index - x) / src.width;
    if (x > 0) push(index - 1);
    if (x < src.width - 1) push(index + 1);
    if (y > 0) push(index - src.width);
    if (y < src.height - 1) push(index + src.width);
  }
  let holes = 0;
  for (let i = 0; i < total; i++) {
    if (outside[i] === 0 && src.rgba[i * 4 + 3] < 8) holes++;
  }
  return holes;
}
