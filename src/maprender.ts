/**
 * 地图编辑器（模块六）的**渲染计划**：宿主是唯一渲染器。
 *
 * ## 为什么要有「计划」这一层
 *
 * 旧模块（`tilemap.ts` + 界面里的复刻）把「变体怎么挑、装饰怎么居中、裁剪偏移
 * 多少、建筑锚点在哪」写了两遍 —— 两边只要有一处口径不同，就表现为
 * 「保存后整体抬高 / 树木悬空 / 点到的格子和涂到的不是同一格」，而且**不报错**。
 *
 * 新模块只有一条路：宿主算出**绘制计划**（每一项 = 用哪块图、画在哪个像素），
 * 客户端拿 `<canvas>` 原样执行，导出 PNG 也执行同一份计划。于是
 * 「预览 = 导出」是构造出来的，不是靠自检碰运气对出来的。
 *
 * ## 计划里有什么 / 没有什么
 *
 * 有：`{l, t, x, y, a}` —— 层号、全局图块序号、目标左上角像素、层不透明度。
 * 没有：任何需要二次判断的东西（源矩形与图集在 `legend` 里按序号查一次）。
 * 坐标是**绝对像素**（可能为负），配合 `bounds.originX/Y` 平移即可。
 */

import { encodePng } from "./png.js";
import { type Bitmap } from "./bitmap.js";
import {
  cellIndex,
  type MapDoc,
  type MapLayer
} from "./mapdoc.js";
import {
  MAP_CHUNK_SIZE,
  cellTopLeft,
  chunkCellRange,
  chunkKey,
  heightOffsetPixels,
  layoutOf,
  type MapGrid
} from "./mapgeom.js";
import {
  buildFamilyPlans,
  connectsTo,
  neighborhoodMask8,
  resolveMask,
  type FamilyLike,
  type FamilyPlan
} from "./mapauto.js";
import { flatTiles, type MapRect, type MapTileset } from "./maptiles.js";

/** 单张导出图的最大像素数（超过就拒绝，而不是把进程 OOM 掉）。 */
export const MAX_RENDER_PIXELS = 64_000_000;

export interface RenderContext {
  grid: MapGrid;
  tilesets: readonly MapTileset[];
  families: readonly FamilyLike[];
}

export interface PlanOp {
  /** 图层序号（绘制顺序即数组顺序）。 */
  l: number;
  /** 格号（客户端用不到，导出 / 验收要把 op 反查回格子时用）。 */
  r: number;
  c: number;
  /** 全局图块序号（1-based）。 */
  t: number;
  x: number;
  y: number;
  /** 层不透明度（0~1）。 */
  a: number;
}

export interface PlanChunk {
  key: string;
  ops: PlanOp[];
}

export interface PlanLegendEntry {
  index: number;
  tilesetId: string;
  rect: MapRect;
}

export interface PlanBounds {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface PlanFallback {
  familyId: string;
  wanted: number;
  used: number | null;
  mode: string;
  count: number;
}

export interface RenderPlan {
  grid: MapGrid;
  cols: number;
  rows: number;
  chunks: PlanChunk[];
  bounds: PlanBounds;
  /** 用到的图块序号 → 图集与源矩形。客户端画一次就够（`mapPlan` 全量给）。 */
  legend: PlanLegendEntry[];
  warnings: string[];
  /** 缺掩码回退统计：界面与验收要能看见「哪些格子是回退出来的」。 */
  fallbacks: PlanFallback[];
  /** 计划里实际绘制的贴图数。 */
  drawn: number;
}

/**
 * 计划的包围盒。
 *
 * 按**下界估算**（网格脚印 + 最大的贴图溢出 + 层高偏移），宁大勿小：
 * 四周可能多出一点透明边，但同一份输入永远得到同一个矩形 —— 而「裁剪偏移
 * 现算」正是旧模块那个「保存后整体抬高」bug 的正解。**不要**改成读缓存。
 */
export function planBounds(context: RenderContext, doc: MapDoc): PlanBounds {
  const layout = layoutOf(context.grid, doc.cols, doc.rows);
  let maxW = context.grid.tileWidth;
  let maxH = context.grid.tileHeight;
  for (const tile of flatTiles(context.tilesets)) {
    maxW = Math.max(maxW, tile.rect.width);
    maxH = Math.max(maxH, tile.rect.height);
  }
  const overflowX = Math.max(0, (maxW - context.grid.tileWidth) / 2);
  const overflowTop = Math.max(0, maxH - context.grid.tileHeight);
  let left = -overflowX;
  let right = layout.width + overflowX;
  let top = -overflowTop;
  let bottom = layout.height;
  for (const layer of doc.layers) {
    const dy = heightOffsetPixels(context.grid, layer.heightOffset);
    top += Math.min(0, dy);
    bottom += Math.max(0, dy);
  }
  return { originX: left, originY: top, width: right - left, height: bottom - top };
}

/** 稳定哈希：变体挑选必须可复现（旧模块界面用 `Math.random()` 挑变体，预览永远对不上出图）。 */
export function stableHash(...parts: Array<number | string>): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = typeof part === "number" ? `#${part}` : part;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

interface Resolver {
  flatByIndex: Map<number, ReturnType<typeof flatTiles>[number]>;
  indexByTileId: Map<string, number>;
  weightByTileId: Map<string, number>;
  familyPlans: Map<string, FamilyPlan>;
  priorityOf: (familyId: string | undefined) => number | undefined;
  planOf: (familyId: string | undefined) => FamilyPlan | undefined;
}

function makeResolver(context: RenderContext): Resolver {
  const flat = flatTiles(context.tilesets);
  const flatByIndex = new Map(flat.map((tile) => [tile.index, tile]));
  const indexByTileId = new Map(flat.map((tile) => [tile.id, tile.index]));
  const weightByTileId = new Map(flat.map((tile) => [tile.id, typeof tile.weight === "number" && tile.weight > 0 ? tile.weight : 1]));
  const { plans } = buildFamilyPlans(context.families, flat);
  const priority = new Map(context.families.map((family) => [family.id, family.priority]));
  return {
    flatByIndex,
    indexByTileId,
    weightByTileId,
    familyPlans: plans,
    priorityOf: (familyId) => (familyId === undefined ? undefined : priority.get(familyId)),
    planOf: (familyId) => (familyId === undefined ? undefined : plans.get(familyId))
  };
}

interface CellResolution {
  index: number;
  /** 回退信息（只有真回退时才有）。 */
  fallback?: { familyId: string; wanted: number; used: number | null; mode: string };
}

/**
 * 解出一个格子最终画哪块图。
 *
 * 顺序：空 + 无基础族 → 不画；有族且不是 `single` → 算掩码再解析；
 * 其余情况原样画存的序号（包括跨格装饰、单个贴图）。
 */
function resolveCell(
  resolver: Resolver,
  layer: MapLayer,
  doc: MapDoc,
  layerIndex: number,
  r: number,
  c: number,
  lookupValue: (r: number, c: number) => number
): CellResolution | undefined {
  const data = doc.data[layer.id];
  const stored = lookupValue(r, c);
  const flat = stored > 0 ? resolver.flatByIndex.get(stored) : undefined;
  if (stored > 0 && flat === undefined) return undefined;
  const familyId = flat?.familyId ?? layer.baseFamilyId;
  const plan = resolver.planOf(familyId);
  if (familyId === undefined) return stored > 0 ? { index: stored } : undefined;
  if (plan === undefined || plan.scheme === "single") {
    if (stored > 0) return { index: stored };
    const baseId = plan?.baseTileIds[0];
    const index = baseId === undefined ? undefined : resolver.indexByTileId.get(baseId);
    return index === undefined ? undefined : { index };
  }
  const myPriority = resolver.priorityOf(familyId) ?? 0;
  const familyOfCell = (value: number): string | undefined => {
    if (value <= 0) return layer.baseFamilyId;
    return resolver.flatByIndex.get(value)?.familyId;
  };
  const mask = neighborhoodMask8(
    r,
    c,
    (nr, nc) => {
      if (nr < 0 || nc < 0 || nr >= doc.rows || nc >= doc.cols) return undefined;
      const value = data?.[cellIndex(doc, nr, nc)] ?? 0;
      return connectsTo(myPriority, resolver.priorityOf(familyOfCell(value)));
    },
    plan.edgeMode
  );
  const resolved = resolveMask(plan, mask, (candidates) => pickVariant(resolver, doc, layerIndex, r, c, candidates));
  if (resolved.tileId === undefined) return undefined;
  const index = resolver.indexByTileId.get(resolved.tileId);
  if (index === undefined) return undefined;
  const fallback = resolved.mode === "exact" ? undefined : { familyId, wanted: resolved.wanted, used: null, mode: resolved.mode };
  return fallback === undefined ? { index } : { index, fallback };
}

/** 变体挑选：同掩码多张时按权重 + 位置哈希确定性地挑一张。 */
function pickVariant(resolver: Resolver, doc: MapDoc, layerIndex: number, r: number, c: number, candidates: readonly string[]): string {
  if (candidates.length === 1 || !doc.randomVariants) return candidates[0];
  let total = 0;
  for (const id of candidates) total += resolver.weightByTileId.get(id) ?? 1;
  if (total <= 0) return candidates[0];
  let cursor = stableHash(doc.variantSeed, layerIndex, r, c) % total;
  for (const id of candidates) {
    cursor -= resolver.weightByTileId.get(id) ?? 1;
    if (cursor < 0) return id;
  }
  return candidates[candidates.length - 1];
}

function opAt(
  resolver: Resolver,
  context: RenderContext,
  layout: ReturnType<typeof layoutOf>,
  doc: MapDoc,
  layer: MapLayer,
  layerIndex: number,
  r: number,
  c: number
): { op: PlanOp; fallback?: CellResolution["fallback"] } | undefined {
  if (layer.visible !== true || layer.opacity <= 0) return undefined;
  const data = doc.data[layer.id];
  const resolution = resolveCell(resolver, layer, doc, layerIndex, r, c, (rr, cc) => data?.[cellIndex(doc, rr, cc)] ?? 0);
  if (resolution === undefined) return undefined;
  const flat = resolver.flatByIndex.get(resolution.index);
  if (flat === undefined) return undefined;
  const topLeft = cellTopLeft(layout, r, c, flat.rect.width, flat.rect.height, flat.anchorX, flat.anchorY);
  return {
    op: {
      l: layerIndex,
      r,
      c,
      t: resolution.index,
      x: Math.round(topLeft.x),
      y: Math.round(topLeft.y + heightOffsetPixels(context.grid, layer.heightOffset)),
      a: layer.opacity
    },
    fallback: resolution.fallback
  };
}

/**
 * 生成绘制计划。
 *
 * `options.chunks` 只算这几个 chunk（拖动时的增量刷新）；不传就是全图。
 * 顺序 = 层序 → 行 → 列，等价于 Tiled 的 `right-down`；chunk 之间也按
 * 行优先的 chunk 序拼接，客户端照序 `drawImage` 即可与宿主逐像素同构。
 */
export function buildPlan(context: RenderContext, doc: MapDoc, options: { chunks?: readonly string[]; includeLegend?: boolean } = {}): RenderPlan {
  const resolver = makeResolver(context);
  const layout = layoutOf(context.grid, doc.cols, doc.rows);
  const wantAll = options.chunks === undefined;
  const ranges = wantAll
    ? [{ r0: 0, c0: 0, r1: doc.rows, c1: doc.cols }]
    : (options.chunks ?? [])
        .map((key) => chunkRange(key, doc))
        .filter((range): range is { r0: number; c0: number; r1: number; c1: number } => range !== undefined);
  const chunkMap = new Map<string, PlanOp[]>();
  const fallbackCounts = new Map<string, PlanFallback>();
  const warnings: string[] = [];
  let drawn = 0;

  for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
    const layer = doc.layers[layerIndex];
    if (layer.visible !== true) continue;
    // ⚠️ 只扫请求到的 chunk 的格子范围：全图重扫的话，512×512×4 层每次拖动
    // 就是上百万次解析（实测几百毫秒），笔刷会明显发涩。
    for (const range of ranges) {
      for (let r = range.r0; r < range.r1; r++) {
        for (let c = range.c0; c < range.c1; c++) {
          const key = chunkKey({ cx: Math.floor(c / MAP_CHUNK_SIZE), cy: Math.floor(r / MAP_CHUNK_SIZE) });
          const result = opAt(resolver, context, layout, doc, layer, layerIndex, r, c);
          if (result === undefined) continue;
          const list = chunkMap.get(key);
          if (list === undefined) chunkMap.set(key, [result.op]);
          else list.push(result.op);
          drawn++;
          if (result.fallback !== undefined) {
            const id = `${result.fallback.familyId}:${result.fallback.mode}:${result.fallback.wanted}`;
            const row = fallbackCounts.get(id);
            if (row === undefined) {
              fallbackCounts.set(id, { familyId: result.fallback.familyId, wanted: result.fallback.wanted, used: null, mode: result.fallback.mode, count: 1 });
            } else {
              row.count++;
            }
          }
        }
      }
    }
  }

  for (const family of context.families) {
    const plan = resolver.familyPlans.get(family.id);
    if (plan === undefined) continue;
    if (plan.baseTileIds.length === 0) warnings.push(`族「${family.id}」下面一张贴图都没有，画不出来。`);
  }
  if (context.tilesets.length === 0) warnings.push("还没有导入任何图集。");

  const chunks: PlanChunk[] = [...chunkMap.entries()]
    .map(([key, ops]) => ({ key, ops }))
    .sort((a, b) => {
      const [ax, ay] = a.key.split(",").map(Number);
      const [bx, by] = b.key.split(",").map(Number);
      return ay - by || ax - bx;
    });

  return {
    grid: context.grid,
    cols: doc.cols,
    rows: doc.rows,
    chunks,
    bounds: planBounds(context, doc),
    legend: options.includeLegend === false ? [] : flatTiles(context.tilesets).map((tile) => ({ index: tile.index, tilesetId: tile.tilesetId, rect: tile.rect })),
    warnings,
    fallbacks: [...fallbackCounts.values()].sort((a, b) => b.count - a.count),
    drawn
  };
}

/** 只算一个 chunk（拖动时的增量刷新用，避免全图重扫）。 */
export function buildChunk(context: RenderContext, doc: MapDoc, key: string): PlanChunk {
  const plan = buildPlan(context, doc, { chunks: [key], includeLegend: false });
  return plan.chunks.find((chunk) => chunk.key === key) ?? { key, ops: [] };
}

/** chunk 真正覆盖到的格子范围（客户端画边界高亮时要用）。 */
export function chunkRange(key: string, doc: MapDoc): { r0: number; c0: number; r1: number; c1: number } | undefined {
  const [cx, cy] = key.split(",").map(Number);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return undefined;
  return chunkCellRange({ cx, cy }, doc.cols, doc.rows);
}

// ── 光栅化（导出 PNG 与验收预览图）────────────────────────────────────────

/** source-over 合成（与浏览器 canvas 的默认混合一致）。 */
function blendPixel(dst: Buffer, index: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  const sa = Math.min(1, a);
  const da = dst[index + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  const mix = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / outA);
  dst[index] = mix(r, dst[index]);
  dst[index + 1] = mix(g, dst[index + 1]);
  dst[index + 2] = mix(b, dst[index + 2]);
  dst[index + 3] = Math.round(outA * 255);
}

function blitScaled(dst: Bitmap, source: Bitmap, rect: MapRect, dx: number, dy: number, scale: number, alpha: number): void {
  const x0 = Math.max(0, -dx);
  const y0 = Math.max(0, -dy);
  const x1 = Math.min(rect.width, Math.ceil((dst.width - dx) / scale));
  const y1 = Math.min(rect.height, Math.ceil((dst.height - dy) / scale));
  for (let sy = y0; sy < y1; sy++) {
    const srcRow = (rect.y + sy) * source.width;
    if (rect.y + sy < 0 || rect.y + sy >= source.height) continue;
    for (let sx = x0; sx < x1; sx++) {
      const srcX = rect.x + sx;
      if (srcX < 0 || srcX >= source.width) continue;
      const si = (srcRow + srcX) * 4;
      const a = (source.rgba[si + 3] / 255) * alpha;
      if (a <= 0) continue;
      const r = source.rgba[si];
      const g = source.rgba[si + 1];
      const b = source.rgba[si + 2];
      for (let oy = 0; oy < scale; oy++) {
        const ty = dy + sy * scale + oy;
        if (ty < 0 || ty >= dst.height) continue;
        for (let ox = 0; ox < scale; ox++) {
          const tx = dx + sx * scale + ox;
          if (tx < 0 || tx >= dst.width) continue;
          blendPixel(dst.rgba, (ty * dst.width + tx) * 4, r, g, b, a);
        }
      }
    }
  }
}

export interface RasterOptions {
  /** 整数缩放（像素画专用，最近邻，不做插值）。 */
  scale?: number;
  /** 只画这些图层（不传 = 全部可见图层）。 */
  layerIds?: readonly string[];
}

export interface RasterResult {
  bitmap: Bitmap;
  bounds: PlanBounds;
  warnings: string[];
  fallbacks: PlanFallback[];
  drawn: number;
}

/**
 * 把计划光栅化成位图。
 *
 * `lookup` 是**已解码的图集**（tilesetId → 位图）；解码由调用方做一次，
 * 一张地图里同一张图集只解一次，不要每块贴图解一遍。
 */
export function rasterize(
  context: RenderContext,
  doc: MapDoc,
  lookup: Map<string, Bitmap>,
  options: RasterOptions = {}
): RasterResult {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const plan = buildPlan(context, doc, { includeLegend: true });
  const width = Math.ceil(plan.bounds.width * scale);
  const height = Math.ceil(plan.bounds.height * scale);
  if (width < 1 || height < 1) throw new Error("这张地图还没有任何内容，先画点东西再导出。");
  if (width * height > MAX_RENDER_PIXELS) {
    throw new Error(
      `导出图会到 ${width}×${height}（${(width * height / 1e6).toFixed(1)}M 像素），超过 ${MAX_RENDER_PIXELS / 1e6}M 上限。` +
        `请按图层分别导出、把缩放调成 1，或把地图拆小。`
    );
  }
  const bitmap: Bitmap = { width, height, rgba: Buffer.alloc(width * height * 4) };
  const legend = new Map(plan.legend.map((entry) => [entry.index, entry]));
  const keepLayers = options.layerIds === undefined ? undefined : new Set(options.layerIds);
  for (const chunk of plan.chunks) {
    for (const op of chunk.ops) {
      if (keepLayers !== undefined && !keepLayers.has(doc.layers[op.l]?.id ?? "")) continue;
      const entry = legend.get(op.t);
      if (entry === undefined) continue;
      const source = lookup.get(entry.tilesetId);
      if (source === undefined) continue;
      blitScaled(bitmap, source, entry.rect, Math.round((op.x - plan.bounds.originX) * scale), Math.round((op.y - plan.bounds.originY) * scale), scale, op.a);
    }
  }
  return { bitmap, bounds: plan.bounds, warnings: plan.warnings, fallbacks: plan.fallbacks, drawn: plan.drawn };
}

export function bitmapToPng(bitmap: Bitmap): Buffer {
  return encodePng(bitmap.rgba, bitmap.width, bitmap.height);
}

// ── 验收预览图 ────────────────────────────────────────────────────────────

/**
 * 切片 contact sheet：把一张图集的每块贴图按格排开，方便人眼验收「切对了没」。
 *
 * 用**固定格**（取最大的贴图尺寸 + 间隔），不按图集原图裁 —— 原图直接看图集就行，
 * 这张图的目的是「按切分结果确认每一块」。
 */
export function contactSheet(tileset: MapTileset, source: Bitmap, options: { columns?: number; padding?: number; scale?: number } = {}): Bitmap {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const padding = Math.max(0, Math.round(options.padding ?? 2));
  const tiles = tileset.tiles;
  if (tiles.length === 0) return { width: 1, height: 1, rgba: Buffer.alloc(4) };
  const cellW = Math.max(...tiles.map((tile) => tile.rect.width));
  const cellH = Math.max(...tiles.map((tile) => tile.rect.height));
  const columns = Math.max(1, Math.min(options.columns ?? Math.ceil(Math.sqrt(tiles.length)), tiles.length));
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * (cellW + padding) + padding;
  const height = rows * (cellH + padding) + padding;
  const bitmap: Bitmap = { width, height, rgba: Buffer.alloc(width * height * 4) };
  // 浅灰底：透明贴图也能看清边界
  for (let i = 0; i < width * height; i++) {
    bitmap.rgba[i * 4] = 236;
    bitmap.rgba[i * 4 + 1] = 236;
    bitmap.rgba[i * 4 + 2] = 236;
    bitmap.rgba[i * 4 + 3] = 255;
  }
  tiles.forEach((tile, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const dx = (padding + column * (cellW + padding)) * scale;
    const dy = (padding + row * (cellH + padding)) * scale;
    // 每块居中放在固定格里，方便数格子
    const offsetX = Math.round((cellW - tile.rect.width) / 2) * scale;
    const offsetY = Math.round((cellH - tile.rect.height) / 2) * scale;
    blitScaled(bitmap, source, tile.rect, dx + offsetX, dy + offsetY, scale, 1);
  });
  return bitmap;
}

export interface CoverageCell {
  familyId: string;
  mask: number;
  assigned: boolean;
  tileIds: string[];
}

/**
 * 掩码覆盖矩阵：每个族一行、每个掩码一格，已配的画缩略图、没配的画红框。
 *
 * 这一张图是「自动过渡能不能用」最快的验收方式：缺块的地方在地图上是**回退**
 * 出来的（能看，但过渡不自然），而这一点在界面上很容易被忽略。
 *
 * ⚠️ **行序 = `families` 数组顺序**，图上不写族名（本插件没有字体渲染，
 * 手写一套位图字体不值当）。要对照族名就用界面里的「掩码覆盖率」那张表
 * （那里有名字，是同一次 `coverageReport` 的输出）。
 */
export function coverageMatrix(
  families: readonly FamilyLike[],
  tileset: readonly MapTileset[],
  lookup: Map<string, Bitmap>,
  masks: Map<string, number[]>
): Bitmap {
  const cell = 40;
  const padding = 4;
  /** 只留一点点左边距 —— 族名不画在图上（见函数注释）。 */
  const labelWidth = 8;
  const flat = flatTiles(tileset);
  const familyIds = families.map((family) => family.id);
  const widest = Math.max(1, ...familyIds.map((id) => (masks.get(id) ?? [0]).length));
  const width = labelWidth + widest * (cell + padding) + padding;
  const height = 24 + families.length * (cell + padding) + padding;
  const bitmap: Bitmap = { width, height, rgba: Buffer.alloc(width * height * 4) };
  for (let i = 0; i < width * height; i++) {
    bitmap.rgba[i * 4] = 32;
    bitmap.rgba[i * 4 + 1] = 34;
    bitmap.rgba[i * 4 + 2] = 38;
    bitmap.rgba[i * 4 + 3] = 255;
  }
  const byFamily = new Map<string, Map<number, string[]>>();
  const { plans } = buildFamilyPlans(families, flat);
  for (const [familyId, plan] of plans) {
    byFamily.set(familyId, new Map(plan.byMask));
  }
  families.forEach((family, row) => {
    const maskList = masks.get(family.id) ?? [0];
    maskList.forEach((mask, column) => {
      const dx = labelWidth + column * (cell + padding);
      const dy = 24 + row * (cell + padding);
      const tileIds = byFamily.get(family.id)?.get(mask) ?? [];
      const assigned = tileIds.length > 0;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const index = ((dy + y) * width + dx + x) * 4;
          const on = x === 0 || y === 0 || x === cell - 1 || y === cell - 1;
          if (assigned) {
            bitmap.rgba[index] = 70;
            bitmap.rgba[index + 1] = 90;
            bitmap.rgba[index + 2] = 70;
          } else if (on) {
            bitmap.rgba[index] = 200;
            bitmap.rgba[index + 1] = 70;
            bitmap.rgba[index + 2] = 70;
          } else {
            bitmap.rgba[index] = 48;
            bitmap.rgba[index + 1] = 40;
            bitmap.rgba[index + 2] = 40;
          }
          bitmap.rgba[index + 3] = 255;
        }
      }
      if (assigned) {
        const tileId = tileIds[0];
        const entry = flat.find((tile) => tile.id === tileId);
        const source = entry === undefined ? undefined : lookup.get(entry.tilesetId);
        if (entry !== undefined && source !== undefined) {
          const scale = Math.max(1, Math.floor((cell - 4) / Math.max(entry.rect.width, entry.rect.height)));
          blitScaled(bitmap, source, entry.rect, dx + 2, dy + 2, scale, 1);
        }
      }
    });
  });
  return bitmap;
}
