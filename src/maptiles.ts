/**
 * 地图编辑器（模块六）的**图集（tileset）模型与切分**。
 *
 * 一个项目可以导入多张图集；每张图集按「网格切分」或「显式矩形列表」切成若干
 * 图块；每个图块带元数据（所属族、掩码、权重、锚点、标签）。
 *
 * ## 两条铁律
 *
 * 1. **图块 id 由矩形派生**（`t{x}_{y}`），不是数组下标。重新切分（改间距、改格
 *    尺寸）之后，同一个矩形的元数据仍然挂在同一个 id 上；用下标的话会静默漂移。
 * 2. **单元格里存的是「全局图块序号」（1-based，0 = 空）**，不是图块 id —— 导出
 *    Tiled 的 gid、渲染计划、chunk 增量都靠它。序号由 `flatTiles()` 唯一决定，
 *    顺序即「图集顺序 → 图集内切分顺序（行优先）」。
 */

import { pngSize, type Bitmap } from "./bitmap.js";

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapTile {
  /** 由矩形派生的稳定 id（`t{x}_{y}`）。 */
  id: string;
  rect: MapRect;
  name: string;
  familyId?: string;
  /** 族内掩码（`blob47` 用 8 位、`corner16` 用 4 位）。 */
  mask?: number;
  /** 同掩码多张 = 变体，按权重挑。 */
  weight?: number;
  tags?: string[];
  solid?: boolean;
  /** 贴图锚点（归一化，默认底边中点），比一格大的贴图靠它对齐。 */
  anchorX?: number;
  anchorY?: number;
}

export interface MapSlice {
  mode: "grid" | "rects";
  offsetX: number;
  offsetY: number;
  spacingX: number;
  spacingY: number;
  tileWidth: number;
  tileHeight: number;
  /** `mode = "rects"` 时使用。 */
  rects?: MapRect[];
}

export interface MapTileset {
  id: string;
  name: string;
  /** 相对项目目录的路径（`tilesets/<id>.<ext>`）。 */
  file: string;
  imageWidth: number;
  imageHeight: number;
  slice: MapSlice;
  tiles: MapTile[];
}

export const COMMON_TILE_SIZES = [8, 16, 24, 32, 48, 64, 96, 128] as const;

export function tileIdFor(rect: MapRect): string {
  return `t${rect.x}_${rect.y}`;
}

export function rectKey(rect: MapRect): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

export function normalizeSlice(input: unknown, imageWidth: number, imageHeight: number): MapSlice {
  const raw = (input ?? {}) as Record<string, unknown>;
  const int = (value: unknown, fallback: number, min = 0): number => {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? Math.max(min, Math.round(n)) : fallback;
  };
  const mode = raw.mode === "rects" ? "rects" : "grid";
  const slice: MapSlice = {
    mode,
    offsetX: int(raw.offsetX, 0),
    offsetY: int(raw.offsetY, 0),
    spacingX: int(raw.spacingX, 0),
    spacingY: int(raw.spacingY, 0),
    tileWidth: int(raw.tileWidth, Math.min(32, imageWidth)),
    tileHeight: int(raw.tileHeight, Math.min(32, imageHeight))
  };
  if (mode === "rects") {
    slice.rects = Array.isArray(raw.rects)
      ? (raw.rects as unknown[])
          .map((piece) => {
            const r = (piece ?? {}) as Record<string, unknown>;
            return {
              x: int(r.x, 0),
              y: int(r.y, 0),
              width: int(r.width, 0),
              height: int(r.height, 0)
            };
          })
          .filter((rect) => rect.width > 0 && rect.height > 0)
      : [];
  }
  return slice;
}

export interface SliceResult {
  rects: MapRect[];
  cols: number;
  rows: number;
  /** 网格切分时右侧 / 底部剩下的像素（>0 说明尺寸不是整数倍）。 */
  remainderX: number;
  remainderY: number;
  warnings: string[];
}

/**
 * 切分。**余数不静默吞掉**：图集宽 130、格宽 32 时右边剩 2 像素，
 * 界面要明确写出来，否则用户会以为「少了最后一列」是程序坏了。
 */
export function sliceRects(slice: MapSlice, imageWidth: number, imageHeight: number): SliceResult {
  const warnings: string[] = [];
  if (slice.tileWidth < 1 || slice.tileHeight < 1) {
    return { rects: [], cols: 0, rows: 0, remainderX: 0, remainderY: 0, warnings: ["瓦片尺寸必须是正整数。"] };
  }
  if (slice.mode === "rects") {
    const rects = (slice.rects ?? []).filter(
      (rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= imageWidth && rect.y + rect.height <= imageHeight
    );
    if (rects.length !== (slice.rects ?? []).length) {
      warnings.push(`有 ${(slice.rects ?? []).length - rects.length} 个矩形超出图集范围，已忽略。`);
    }
    return { rects, cols: 0, rows: 0, remainderX: 0, remainderY: 0, warnings };
  }
  const usableWidth = imageWidth - slice.offsetX;
  const usableHeight = imageHeight - slice.offsetY;
  const stepX = slice.tileWidth + slice.spacingX;
  const stepY = slice.tileHeight + slice.spacingY;
  const cols = Math.floor((usableWidth + slice.spacingX) / stepX);
  const rows = Math.floor((usableHeight + slice.spacingY) / stepY);
  if (cols <= 0 || rows <= 0) {
    return {
      rects: [],
      cols: 0,
      rows: 0,
      remainderX: Math.max(0, usableWidth),
      remainderY: Math.max(0, usableHeight),
      warnings: [`按 ${slice.tileWidth}×${slice.tileHeight} 切不出任何一块：图集是 ${imageWidth}×${imageHeight}，偏移 ${slice.offsetX},${slice.offsetY}。`]
    };
  }
  const rects: MapRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      rects.push({
        x: slice.offsetX + col * stepX,
        y: slice.offsetY + row * stepY,
        width: slice.tileWidth,
        height: slice.tileHeight
      });
    }
  }
  const remainderX = usableWidth - (cols * stepX - slice.spacingX);
  const remainderY = usableHeight - (rows * stepY - slice.spacingY);
  if (remainderX > 0) warnings.push(`右侧还剩 ${remainderX} 像素不足一格（已裁掉）。`);
  if (remainderY > 0) warnings.push(`底部还剩 ${remainderY} 像素不足一格（已裁掉）。`);
  return { rects, cols, rows, remainderX, remainderY, warnings };
}

/** 常见网格建议（尺寸能整除图集才会出现）。 */
export function suggestGrids(imageWidth: number, imageHeight: number): Array<{ tileWidth: number; tileHeight: number; cols: number; rows: number; label: string }> {
  const out: Array<{ tileWidth: number; tileHeight: number; cols: number; rows: number; label: string }> = [];
  for (const size of COMMON_TILE_SIZES) {
    if (imageWidth % size !== 0 || imageHeight % size !== 0) continue;
    out.push({ tileWidth: size, tileHeight: size, cols: imageWidth / size, rows: imageHeight / size, label: `${size}×${size} 正方形` });
  }
  for (const size of COMMON_TILE_SIZES) {
    const height = size / 2;
    if (!Number.isInteger(height)) continue;
    if (imageWidth % size !== 0 || imageHeight % height !== 0) continue;
    out.push({ tileWidth: size, tileHeight: height, cols: imageWidth / size, rows: imageHeight / height, label: `${size}×${height} 2:1 等距` });
  }
  return out;
}

/**
 * 按切分结果生成图块表，并**保留已有元数据**。
 *
 * 保留的判据是矩形（`tileIdFor`）；切分变化后仍存在的矩形继续带着族 / 掩码 /
 * 权重，消失的丢弃，新出现的给默认值。界面上的编辑不会被一次改格尺寸全抹掉。
 */
export function buildTiles(slice: MapSlice, imageWidth: number, imageHeight: number, previous: readonly MapTile[] = []):
  { tiles: MapTile[]; result: SliceResult } {
  const result = sliceRects(slice, imageWidth, imageHeight);
  const byId = new Map(previous.map((tile) => [tile.id, tile]));
  const tiles: MapTile[] = result.rects.map((rect) => {
    const id = tileIdFor(rect);
    const old = byId.get(id);
    return {
      id,
      rect,
      name: old?.name ?? id,
      familyId: old?.familyId,
      mask: old?.mask,
      weight: old?.weight,
      tags: old?.tags,
      solid: old?.solid,
      anchorX: old?.anchorX,
      anchorY: old?.anchorY
    };
  });
  return { tiles, result };
}

/**
 * 元数据合并（`saveMapTileset` 用）：按 id 合并，不认识的 id 丢掉。
 *
 * ⚠️ 判据是「**键在不在**」而不是「值是不是 undefined」：界面只提交改过的字段时，
 * 缺的键必须保留原值。写成 `patch.familyId === undefined ? undefined : …` 的话，
 * 只改一个名称就会把整个族 / 掩码静默清空。
 */
export function mergeTileMeta(current: readonly MapTile[], incoming: readonly MapTile[]): MapTile[] {
  const out = current.map((tile) => ({ ...tile }));
  const index = new Map(out.map((tile, position) => [tile.id, position]));
  const has = (patch: MapTile, key: keyof MapTile) => Object.prototype.hasOwnProperty.call(patch, key);
  for (const patch of incoming) {
    const position = index.get(patch.id);
    if (position === undefined) continue;
    const base = out[position];
    const next: MapTile = { ...base };
    if (has(patch, "name") && typeof patch.name === "string" && patch.name !== "") next.name = patch.name;
    if (has(patch, "familyId")) {
      next.familyId = typeof patch.familyId === "string" && patch.familyId !== "" ? patch.familyId : undefined;
    }
    if (has(patch, "mask")) {
      next.mask = typeof patch.mask === "number" && Number.isFinite(patch.mask) ? Math.round(patch.mask) : undefined;
    }
    if (has(patch, "weight")) {
      next.weight = typeof patch.weight === "number" && Number.isFinite(patch.weight) ? patch.weight : undefined;
    }
    if (has(patch, "tags")) {
      next.tags = Array.isArray(patch.tags) ? patch.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
    }
    if (has(patch, "solid")) next.solid = typeof patch.solid === "boolean" ? patch.solid : undefined;
    if (has(patch, "anchorX")) {
      next.anchorX = typeof patch.anchorX === "number" && Number.isFinite(patch.anchorX) ? patch.anchorX : undefined;
    }
    if (has(patch, "anchorY")) {
      next.anchorY = typeof patch.anchorY === "number" && Number.isFinite(patch.anchorY) ? patch.anchorY : undefined;
    }
    out[position] = next;
  }
  return out;
}

/** 同一张图集里两个图块指向同一个矩形（允许，但要提示）。 */
export function duplicateRects(tilesets: readonly MapTileset[]): Array<{ tilesetId: string; rect: MapRect; tileIds: string[] }> {
  const out: Array<{ tilesetId: string; rect: MapRect; tileIds: string[] }> = [];
  for (const tileset of tilesets) {
    const seen = new Map<string, string[]>();
    for (const tile of tileset.tiles) {
      const key = rectKey(tile.rect);
      const list = seen.get(key);
      if (list === undefined) seen.set(key, [tile.id]);
      else list.push(tile.id);
    }
    for (const [, ids] of seen) {
      if (ids.length > 1) {
        const first = tileset.tiles.find((tile) => tile.id === ids[0]);
        if (first !== undefined) out.push({ tilesetId: tileset.id, rect: first.rect, tileIds: ids });
      }
    }
  }
  return out;
}

// ── 全局图块索引 ─────────────────────────────────────────────────────────

export interface FlatTile {
  /** 1-based 全局序号（0 留给「空」）。 */
  index: number;
  id: string;
  tilesetId: string;
  tilesetName: string;
  rect: MapRect;
  name: string;
  familyId?: string;
  mask?: number;
  weight?: number;
  anchorX: number;
  anchorY: number;
}

/**
 * 展平成一个全项目通用的索引。
 *
 * 顺序 = 图集顺序 → 图集内切分顺序，**因此只要不动图集顺序与切分参数，
 * 序号就稳定**；这也是 `applyMapOps` 里存的序号能跨会话读回来的前提。
 * 序号的唯一真源是这里，别的任何地方都不许自己按数组下标算。
 */
export function flatTiles(tilesets: readonly MapTileset[]): FlatTile[] {
  const out: FlatTile[] = [];
  let index = 1;
  for (const tileset of tilesets) {
    for (const tile of tileset.tiles) {
      out.push({
        index,
        id: tile.id,
        tilesetId: tileset.id,
        tilesetName: tileset.name,
        rect: tile.rect,
        name: tile.name,
        familyId: tile.familyId,
        mask: tile.mask,
        weight: tile.weight,
        anchorX: typeof tile.anchorX === "number" ? tile.anchorX : 0.5,
        anchorY: typeof tile.anchorY === "number" ? tile.anchorY : 1
      });
      index++;
    }
  }
  return out;
}

export function flatIndexByValue(tilesets: readonly MapTileset[]): Map<number, FlatTile> {
  return new Map(flatTiles(tilesets).map((tile) => [tile.index, tile]));
}

/** 图集里用到的族 id（删族 / 删图集前查引用）。 */
export function tilesUsingFamily(tilesets: readonly MapTileset[], familyId: string): FlatTile[] {
  return flatTiles(tilesets).filter((tile) => tile.familyId === familyId);
}

// ── 缩略图（界面与验收图共用同一份坐标）──────────────────────────────────

export interface TilesetPreview {
  tilesetId: string;
  name: string;
  imageWidth: number;
  imageHeight: number;
  slice: MapSlice;
  /** 网格线：切分参数的可视化（界面直接画）。 */
  gridLinesX: number[];
  gridLinesY: number[];
  tiles: Array<{ id: string; index: number; rect: MapRect; name: string; familyId?: string; mask?: number }>;
  warnings: string[];
}

export function tilesetPreview(tileset: MapTileset, startIndex: number): TilesetPreview {
  const { rects, cols, rows, warnings } = sliceRects(tileset.slice, tileset.imageWidth, tileset.imageHeight);
  const gridLinesX: number[] = [];
  const gridLinesY: number[] = [];
  if (tileset.slice.mode === "grid") {
    for (let col = 0; col <= cols; col++) gridLinesX.push(tileset.slice.offsetX + col * (tileset.slice.tileWidth + tileset.slice.spacingX) - tileset.slice.spacingX);
    for (let row = 0; row <= rows; row++) gridLinesY.push(tileset.slice.offsetY + row * (tileset.slice.tileHeight + tileset.slice.spacingY) - tileset.slice.spacingY);
  }
  const byId = new Map(tileset.tiles.map((tile) => [tile.id, tile]));
  return {
    tilesetId: tileset.id,
    name: tileset.name,
    imageWidth: tileset.imageWidth,
    imageHeight: tileset.imageHeight,
    slice: tileset.slice,
    gridLinesX,
    gridLinesY,
    tiles: rects.map((rect, offset) => {
      const id = tileIdFor(rect);
      const tile = byId.get(id);
      return {
        id,
        index: startIndex + offset,
        rect,
        name: tile?.name ?? id,
        familyId: tile?.familyId,
        mask: tile?.mask
      };
    }),
    warnings
  };
}

// ── 图像尺寸探测 ─────────────────────────────────────────────────────────

/** 从文件头拿尺寸；PNG 之外的类型回落到 ffmpeg（见 `bitmap.probeImageSize`）。 */
export function sizeFromBytes(bytes: Buffer): { width: number; height: number } | undefined {
  return pngSize(bytes);
}

/** 给验收 / 界面用的图块位图（裁剪出一块）。 */
export function cropTile(source: Bitmap, rect: MapRect): Bitmap {
  const width = Math.max(1, Math.min(rect.width, source.width - rect.x));
  const height = Math.max(1, Math.min(rect.height, source.height - rect.y));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((rect.y + y) * source.width + rect.x) * 4;
    source.rgba.copy(rgba, y * width * 4, from, from + width * 4);
  }
  return { width, height, rgba };
}
