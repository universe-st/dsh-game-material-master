/**
 * 地图编辑器（模块六）的**导出**：PNG（分层 / 合并）、自有 JSON、Tiled `.tmj` + `.tsj`。
 *
 * ## 两条与旧模块不同的口径
 *
 * 1. **导出目录自包含**：图集 PNG 会复制进 `export/<mapId>/`，`.tsj` 里的 `image`
 *    写裸文件名。指向 `../tilesets/` 在 Tiled 里也能开，但用户一挪目录就裂图。
 * 2. **Tiled 里写的是「渲染后的真相」**：自动过渡已经解析成具体贴图（gid），
 *    同时把族的掩码表写进 `wangsets`，所以在 Tiled 里继续刷也会自动过渡。
 *
 * ## 关于 wangsets
 *
 * 本机**无法联网核对 Tiled 本体**（DNS 被拦），这里按 JSON 格式文档的形态写：
 * - `blob47` → `type: "mixed"`，`wangid` 8 位，顺序 top / top-right / right /
 *   bottom-right / bottom / bottom-left / left / top-left（正好是 N/NE/E/SE/S/SW/W/NW）
 * - `corner16` → `type: "edge"`，只用下标 0/2/4/6（top / right / bottom / left）
 * - 值 0 = 不连通、1 = 连通（对应 `colors[0]`）
 * 自检按这个形态逐字段断言；**能不能在 Tiled 里被认出来需要人工开一次 Tiled 确认**
 * （ENGINEERING.md 里写明这是「待人工确认」的一条）。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";
import { type Bitmap } from "./bitmap.js";
import { encodePng } from "./png.js";
import { type MapDoc } from "./mapdoc.js";
import { heightOffsetPixels } from "./mapgeom.js";
import { buildFamilyPlans, maskForScheme, type FamilyLike } from "./mapauto.js";
import { flatTiles, type MapTileset } from "./maptiles.js";
import { buildPlan, rasterize, type RenderContext } from "./maprender.js";

export interface MapFamily extends FamilyLike {
  name: string;
  /** 界面里给族标色（同时写进 Tiled 的 wangset colors）。 */
  color?: string;
}

export interface ExportFormatOptions {
  pngMerged?: boolean;
  pngLayers?: boolean;
  json?: boolean;
  tiled?: boolean;
}

export interface ExportOptions {
  scale?: number;
  formats?: ExportFormatOptions;
}

export interface ExportedFile {
  /** 相对 `export/<mapId>/` 的路径。 */
  path: string;
  bytes: number;
  kind: "image" | "json" | "tileset-image" | "tileset-json";
}

export interface ExportManifest {
  files: ExportedFile[];
  warnings: string[];
  mapPng?: string;
  mapJson?: string;
  tiledMap?: string;
  bounds: { originX: number; originY: number; width: number; height: number };
}

export const OWN_JSON_FORMAT = "dsh-gem-map@1";

/** 文件名安全化：图层 / 图集名字直接进路径会踩到 `/`、`:` 与超长名。 */
export function safeFileName(input: string, fallback = "map"): string {
  const cleaned = (input ?? "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned === "" ? fallback : cleaned;
}

// ── gid 映射 ──────────────────────────────────────────────────────────────

export interface GidMap {
  /** 图集 id → firstgid。 */
  firstgid: Map<string, number>;
  /** 全局图块序号 → gid。 */
  gidOfIndex: Map<number, number>;
  total: number;
}

export function buildGidMap(tilesets: readonly MapTileset[]): GidMap {
  const firstgid = new Map<string, number>();
  const gidOfIndex = new Map<number, number>();
  let next = 1;
  for (const tileset of tilesets) {
    firstgid.set(tileset.id, next);
    for (let position = 0; position < tileset.tiles.length; position++) gidOfIndex.set(next + position, next + position);
    next += tileset.tiles.length;
  }
  return { firstgid, gidOfIndex, total: next - 1 };
}

// ── 自有 JSON ─────────────────────────────────────────────────────────────

export function buildOwnJson(context: RenderContext, doc: MapDoc, project: { id: string; name: string }): Record<string, unknown> {
  return {
    format: OWN_JSON_FORMAT,
    project: { id: project.id, name: project.name },
    map: {
      id: doc.id,
      name: doc.name,
      cols: doc.cols,
      rows: doc.rows,
      variantSeed: doc.variantSeed,
      randomVariants: doc.randomVariants
    },
    grid: context.grid,
    tilesets: context.tilesets.map((tileset) => ({
      id: tileset.id,
      name: tileset.name,
      image: `${safeFileName(tileset.name, tileset.id)}.png`,
      imageWidth: tileset.imageWidth,
      imageHeight: tileset.imageHeight,
      slice: tileset.slice,
      tileCount: tileset.tiles.length,
      tiles: tileset.tiles.map((tile) => ({
        id: tile.id,
        rect: tile.rect,
        name: tile.name,
        familyId: tile.familyId ?? null,
        mask: typeof tile.mask === "number" ? tile.mask : null,
        weight: typeof tile.weight === "number" ? tile.weight : null,
        anchorX: typeof tile.anchorX === "number" ? tile.anchorX : null,
        anchorY: typeof tile.anchorY === "number" ? tile.anchorY : null
      }))
    })),
    families: context.families.map((family) => ({
      id: family.id,
      name: (family as MapFamily).name ?? family.id,
      autotile: family.autotile,
      priority: family.priority,
      edgeMode: family.edgeMode ?? "same"
    })),
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      heightOffset: layer.heightOffset,
      opacity: layer.opacity,
      visible: layer.visible,
      locked: layer.locked,
      baseFamilyId: layer.baseFamilyId ?? null,
      /** 存的是**语义值**（全局图块序号），不是解析后的贴图 —— 自己格式要能继续改。 */
      data: [...(doc.data[layer.id] ?? [])]
    })),
    legend: flatTiles(context.tilesets).map((tile) => ({
      index: tile.index,
      tilesetId: tile.tilesetId,
      id: tile.id,
      rect: tile.rect,
      name: tile.name,
      familyId: tile.familyId ?? null,
      mask: typeof tile.mask === "number" ? tile.mask : null
    }))
  };
}

// ── Tiled ─────────────────────────────────────────────────────────────────

export function buildTiledTileset(tileset: MapTileset, families: readonly MapFamily[], firstgid: number): Record<string, unknown> {
  const wangsets: Array<Record<string, unknown>> = [];
  const { plans } = buildFamilyPlans(
    families,
    tileset.tiles.map((tile) => ({ id: tile.id, familyId: tile.familyId, mask: tile.mask, weight: tile.weight }))
  );
  for (const family of families) {
    const plan = plans.get(family.id);
    if (plan === undefined || plan.scheme === "single" || plan.byMask.size === 0) continue;
    const type = plan.scheme === "blob47" ? "mixed" : "edge";
    const wangtiles: Array<{ tileid: number; wangid: number[] }> = [];
    tileset.tiles.forEach((tile, position) => {
      if (tile.familyId !== family.id) return;
      const mask = maskForScheme(plan.scheme, typeof tile.mask === "number" ? tile.mask : 0);
      const wangid = plan.scheme === "blob47"
        ? [mask & 1 ? 1 : 0, mask & 2 ? 1 : 0, mask & 4 ? 1 : 0, mask & 8 ? 1 : 0, mask & 16 ? 1 : 0, mask & 32 ? 1 : 0, mask & 64 ? 1 : 0, mask & 128 ? 1 : 0]
        : [mask & 1 ? 1 : 0, 0, mask & 2 ? 1 : 0, 0, mask & 4 ? 1 : 0, 0, mask & 8 ? 1 : 0, 0];
      wangtiles.push({ tileid: position, wangid });
    });
    if (wangtiles.length === 0) continue;
    wangsets.push({
      name: family.name ?? family.id,
      type,
      tile: -1,
      colors: [{ color: family.color ?? "#f00000", name: family.name ?? family.id, probability: 1, tile: -1 }],
      wangtiles
    });
  }
  const json: Record<string, unknown> = {
    type: "tileset",
    version: "1.10",
    tiledversion: "1.10.2",
    name: safeFileName(tileset.name, tileset.id),
    image: `${safeFileName(tileset.name, tileset.id)}.png`,
    imagewidth: tileset.imageWidth,
    imageheight: tileset.imageHeight,
    tilewidth: tileset.slice.tileWidth,
    tileheight: tileset.slice.tileHeight,
    tilecount: tileset.tiles.length,
    columns: Math.max(1, Math.round(tileset.imageWidth / (tileset.slice.tileWidth + tileset.slice.spacingX))),
    margin: 0,
    spacing: tileset.slice.spacingX,
    firstgid
  };
  const withMeta = tileset.tiles
    .map((tile, position) => ({ tile, position }))
    .filter(({ tile }) => tile.familyId !== undefined);
  if (tileset.slice.mode === "rects") {
    // 非均匀图集必须逐块给矩形（Tiled 的 per-tile x/y/width/height）
    json.tiles = tileset.tiles.map((tile) => ({
      id: tileset.tiles.indexOf(tile),
      x: tile.rect.x,
      y: tile.rect.y,
      width: tile.rect.width,
      height: tile.rect.height,
      ...(tile.familyId === undefined
        ? {}
        : {
            properties: [
              { name: "family", type: "string", value: tile.familyId },
              ...(typeof tile.mask === "number" ? [{ name: "mask", type: "int", value: tile.mask }] : [])
            ]
          })
    }));
  } else if (withMeta.length > 0) {
    json.tiles = withMeta.map(({ tile, position }) => ({
      id: position,
      properties: [
        { name: "family", type: "string", value: tile.familyId as string },
        ...(typeof tile.mask === "number" ? [{ name: "mask", type: "int", value: tile.mask }] : [])
      ]
    }));
  }
  if (wangsets.length > 0) json.wangsets = wangsets;
  return json;
}

/**
 * 逐格算出 Tiled 的 gid（自动过渡已解析）。
 *
 * 只走 `buildPlan` 这一条路：计划是唯一渲染真源，gid 从它的 op 反查
 * （op 自带格号），不再另写一套「格子 → 贴图」逻辑 —— 那样必然分叉成两份口径。
 */
function layerGids(context: RenderContext, doc: MapDoc, layerIndex: number, gids: GidMap): number[] {
  const data = new Array(doc.cols * doc.rows).fill(0);
  const plan = buildPlan(context, doc, { includeLegend: false });
  for (const chunk of plan.chunks) {
    for (const op of chunk.ops) {
      if (op.l !== layerIndex) continue;
      if (op.r < 0 || op.c < 0 || op.r >= doc.rows || op.c >= doc.cols) continue;
      const gid = gids.gidOfIndex.get(op.t);
      if (gid === undefined) continue;
      data[op.r * doc.cols + op.c] = gid;
    }
  }
  return data;
}

/**
 * `.tmj`。
 *
 * `layers[].data` 写的是**解析后的 gid**（视觉真相）；层高同时写 Tiled 的
 * `offsety` 和一条 `properties.heightOffset` —— 只写 properties 的话 Tiled 里
 * 看不出层高，只写 offsety 的话语义信息丢了。
 */
export function buildTiledMap(context: RenderContext, doc: MapDoc, project: { name: string }, gids: GidMap): Record<string, unknown> {
  const layers = doc.layers.map((layer, index) => ({
    type: "tilelayer",
    id: index + 1,
    name: layer.name,
    width: doc.cols,
    height: doc.rows,
    x: 0,
    y: 0,
    visible: layer.visible,
    opacity: layer.opacity,
    offsetx: 0,
    offsety: heightOffsetPixels(context.grid, layer.heightOffset),
    data: layerGids(context, doc, index, gids),
    properties: [{ name: "heightOffset", type: "float", value: layer.heightOffset }]
  }));
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: context.grid.kind === "iso2to1" ? "isometric" : "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: doc.cols,
    height: doc.rows,
    tilewidth: context.grid.tileWidth,
    tileheight: context.grid.tileHeight,
    nextlayerid: doc.layers.length + 1,
    nextobjectid: 1,
    tilesets: context.tilesets.map((tileset) => ({
      firstgid: gids.firstgid.get(tileset.id) ?? 1,
      source: `${safeFileName(tileset.name, tileset.id)}.tsj`
    })),
    layers,
    properties: [
      { name: "dshProject", type: "string", value: project.name },
      { name: "dshMapId", type: "string", value: doc.id },
      { name: "dshVariantSeed", type: "int", value: doc.variantSeed }
    ]
  };
}

// ── 落盘 ──────────────────────────────────────────────────────────────────

export interface ExportInput {
  dir: string;
  context: RenderContext;
  doc: MapDoc;
  project: { id: string; name: string };
  families: readonly MapFamily[];
  /** tilesetId → 已解码图集（调用方解一次）。 */
  lookup: Map<string, Bitmap>;
  /** 图集文件的绝对路径（复制进导出目录用）。 */
  tilesetFiles?: Map<string, string>;
  options?: ExportOptions;
}

export async function exportMap(input: ExportInput): Promise<ExportManifest> {
  const { dir, context, doc, lookup } = input;
  const scale = Math.max(1, Math.round(input.options?.scale ?? 1));
  const formats: ExportFormatOptions = input.options?.formats ?? { pngMerged: true, pngLayers: true, json: true, tiled: true };
  const files: ExportedFile[] = [];
  const warnings: string[] = [];
  const manifest: ExportManifest = { files, warnings, bounds: { originX: 0, originY: 0, width: 0, height: 0 } };
  await mkdir(dir, { recursive: true });

  const write = async (path: string, content: Buffer | string, kind: ExportedFile["kind"]) => {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    await writeFile(join(dir, path), data);
    files.push({ path, bytes: data.length, kind });
  };
  const writeJson = (path: string, value: unknown, kind: ExportedFile["kind"]) => write(path, `${JSON.stringify(value, null, 2)}\n`, kind);

  if (formats.pngMerged === true || formats.pngLayers === true) {
    const merged = formats.pngMerged === true ? rasterize(context, doc, lookup, { scale }) : undefined;
    if (merged !== undefined) {
      manifest.bounds = merged.bounds;
      warnings.push(...merged.warnings);
      if (merged.drawn === 0) warnings.push("这张地图所有图层都是空的，导出的 PNG 是全透明的。");
      await write("map.png", encodePng(merged.bitmap.rgba, merged.bitmap.width, merged.bitmap.height), "image");
      manifest.mapPng = "map.png";
    }
    if (formats.pngLayers === true) {
      for (let index = 0; index < doc.layers.length; index++) {
        const layer = doc.layers[index];
        if (layer.visible !== true) continue;
        const raster = rasterize(context, doc, lookup, { scale, layerIds: [layer.id] });
        const path = `layer-${index + 1}-${safeFileName(layer.name, layer.id)}.png`;
        await write(path, encodePng(raster.bitmap.rgba, raster.bitmap.width, raster.bitmap.height), "image");
        if (merged === undefined) manifest.bounds = raster.bounds;
      }
    }
  }

  if (formats.json === true) {
    await writeJson("map.json", buildOwnJson(context, doc, input.project), "json");
    manifest.mapJson = "map.json";
  }

  if (formats.tiled === true) {
    const gids = buildGidMap(context.tilesets);
    for (const tileset of context.tilesets) {
      const base = safeFileName(tileset.name, tileset.id);
      await writeJson(`${base}.tsj`, buildTiledTileset(tileset, input.families, gids.firstgid.get(tileset.id) ?? 1), "tileset-json");
      const source = input.tilesetFiles?.get(tileset.id);
      if (source !== undefined) {
        await copyFile(source, join(dir, `${base}.png`));
        files.push({ path: `${base}.png`, bytes: tileset.imageWidth * tileset.imageHeight, kind: "tileset-image" });
      } else {
        warnings.push(`图集「${tileset.name}」的源文件找不到，导出目录里没有它的 PNG（Tiled 会裂图）。`);
      }
    }
    await writeJson("map.tmj", buildTiledMap(context, doc, input.project, gids), "json");
    manifest.tiledMap = "map.tmj";
  }

  // 清单自己也要落盘：验收包（`game_material_review`）与「在文件夹中显示」都读它
  await writeJson("manifest.json", { ...manifest, files: [...manifest.files, { path: "manifest.json", bytes: 0, kind: "json" }] }, "json");
  return manifest;
}
