/**
 * 45° 地图编辑器（模块五 · iso）的**宿主业务层**：项目、素材、文档、计划、
 * 撤销重做、一键生成、预览 / 导出。
 *
 * 一条项目 = 一张地图（`map.json`）+ 若干素材原图（`tilesets/`）。
 * 编辑期间文档以内存为权威副本、防抖落盘；导出前强制 flush。
 */
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendJobLog, messageOf, readJson, sweepTempFiles, writeJsonAtomic } from "./jsonio.js";
import { dataRoot } from "./config.js";
import { decodeFile, encodeBitmap, pngSize, probeImageSize, sniffImageExt } from "./bitmap.js";
import { keyGreen } from "./chroma.js";
import { keyScreenName, normalizeKeyColor } from "./keycolor.js";
import { MAX_ASSET_SCALE, cropTile, flatTiles, keyStampBackground, parseAssetFps, parseAssetLoop, parseClarity, resampleToSize, safeAssetStem, STAMP_KEY_OPTIONS } from "./maptiles.js";
import { DEFAULT_ISO_CELL, MAX_ISO_DIM, MAX_ISO_PLAN_CHUNKS, assertIsoCell, assertIsoMapSize, chunkKey, chunksInRange, dirtyChunksFor, layoutOf, normalizeIsoCell, viewCellRange, wrapCell } from "./isogeom.js";
import { addLayer as docAddLayer, applyIsoOps as applyOpsToDoc, clearLayer as docClearLayer, cellIndex, cloneIsoDoc, createIsoDoc, filledCount, moveLayer as docMoveLayer, normalizeIsoDoc, objectCount, removeLayer as docRemoveLayer, renameLayer as docRenameLayer, resizeDoc } from "./isodoc.js";
import { briefOf, parseIsoAnchor, parseIsoObjectScale, parseIsoTilesetKind, parsePassCells, rebuildIsoTiles, shapeOfKind } from "./isotiles.js";
import { buildIsoPlan, isoBitmapToPng, isoRenderContext, passCellsOf, planBounds, rasterizeIso, renderIsoView } from "./isorender.js";
import { exportIsoMap } from "./isoexport.js";
import { renderIsoSamples } from "./isosamplegen.js";
import { composeIsoFrames } from "./isocompose.js";
import { assetBasePath, originForLinks } from "./links.js";
export const ISO_STAGES = ["assets", "paint", "export"];
// ── 路径与 id ─────────────────────────────────────────────────────────────
export function isoJobsRoot() {
    return join(dataRoot(), "iso-jobs");
}
export function isoProjectDir(id) {
    return join(isoJobsRoot(), id);
}
export function isoProjectFile(id) {
    return join(isoProjectDir(id), "project.json");
}
export function isoDocFile(id) {
    return join(isoProjectDir(id), "map.json");
}
export function isoAssetPath(id, relative) {
    const base = isoProjectDir(id);
    const target = join(base, relative);
    if (!target.startsWith(base))
        throw new Error(`非法的项目内路径：${relative}`);
    return target;
}
/** `g` 前缀，避免与 p / i / s / r / m / a / f 撞。 */
export function isValidIsoProjectId(id) {
    return /^g[a-z0-9]{4,40}$/.test(id);
}
/**
 * 子目录白名单。**唯一真源**：`index.ts` 的资源路由直接引用它。
 * 少一条只表现为图裂 / 403，不报错。
 */
export const SERVABLE_ISO_DIRS = new Set(["tilesets", "preview", "export", "ai"]);
const DEFAULT_COLS = 32;
const DEFAULT_ROWS = 32;
function freshStages() {
    return {
        assets: { status: "idle" },
        paint: { status: "idle" },
        export: { status: "idle" }
    };
}
// ── 读写（带写队列）──────────────────────────────────────────────────────
const projectWriteQueue = new Map();
function enqueueWrite(key, task) {
    const previous = projectWriteQueue.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    projectWriteQueue.set(key, next.catch(() => undefined));
    return next;
}
async function writeIsoProject(project) {
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(isoProjectFile(project.id), project);
}
export async function patchIsoProject(id, mutator) {
    return enqueueWrite(id, async () => {
        const project = await readIsoProject(id);
        if (project === undefined)
            throw new Error(`项目不存在：${id}`);
        const result = mutator(project);
        await writeIsoProject(project);
        return result;
    });
}
function positiveInt(value, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
export async function createIsoProject(name, options = {}) {
    const cell = normalizeIsoCell(options.cell);
    assertIsoCell(cell);
    const cols = positiveInt(options.cols, DEFAULT_COLS);
    const rows = positiveInt(options.rows, DEFAULT_ROWS);
    assertIsoMapSize(cols, rows);
    const id = `g${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = {
        id,
        name: name.trim() === "" ? "未命名地图" : name.trim(),
        createdAt: now,
        updatedAt: now,
        cell,
        wrap: options.wrap !== false,
        tilesets: [],
        stages: freshStages(),
        logs: []
    };
    await mkdir(isoProjectDir(id), { recursive: true });
    for (const sub of SERVABLE_ISO_DIRS)
        await mkdir(join(isoProjectDir(id), sub), { recursive: true });
    appendJobLog(project.logs, "info", `新建 45° 地图项目：${project.name}（${cols}×${rows}，格子 ${cell.width}×${cell.height}）`);
    await writeTheDoc(id, createIsoDoc(id, project.name, cols, rows));
    await writeIsoProject(project);
    return project;
}
export async function readIsoProject(id) {
    const raw = await readJson(isoProjectFile(id));
    if (raw === undefined || typeof raw !== "object")
        return undefined;
    void sweepTempFiles(isoProjectDir(id));
    const stages = { ...freshStages(), ...(raw.stages ?? {}) };
    return {
        ...raw,
        cell: normalizeIsoCell(raw.cell),
        wrap: raw.wrap !== false,
        tilesets: Array.isArray(raw.tilesets) ? raw.tilesets.map(normalizeIsoTileset).filter((tileset) => tileset !== undefined) : [],
        stages,
        logs: Array.isArray(raw.logs) ? raw.logs : []
    };
}
function normalizeIsoTileset(raw) {
    if (raw === null || typeof raw !== "object")
        return undefined;
    const source = raw;
    const imageWidth = Math.max(1, Math.round(Number(source.imageWidth) || 1));
    const imageHeight = Math.max(1, Math.round(Number(source.imageHeight) || 1));
    const cell = normalizeIsoCell(source.cell);
    const kind = (() => {
        try {
            return parseIsoTilesetKind(source.kind);
        }
        catch {
            return "ground";
        }
    })();
    const framesRaw = Math.round(Number(source.frames));
    const frames = Number.isFinite(framesRaw) && framesRaw >= 1 && framesRaw <= 64 ? framesRaw : 1;
    const footprint = source.footprint === undefined ? undefined : normalizeFootprintFrom(source.footprint);
    const anchor = (() => {
        try {
            return parseIsoAnchor(source.anchor);
        }
        catch {
            return undefined;
        }
    })();
    const pass = (() => {
        try {
            return footprint === undefined ? undefined : parsePassCells(source.pass, footprint);
        }
        catch {
            return undefined;
        }
    })();
    const objectScale = (() => {
        try {
            return kind === "object" ? parseIsoObjectScale(source.objectScale) : undefined;
        }
        catch {
            return undefined;
        }
    })();
    const previous = Array.isArray(source.tiles) ? source.tiles : [];
    let tiles = [];
    try {
        tiles = rebuildIsoTiles({ kind, cell, imageWidth, imageHeight, frames, animRows: source.animRows === true, footprint }, previous);
    }
    catch {
        tiles = previous;
    }
    const columns = kind === "object" ? 1 : Math.max(1, Math.floor(imageWidth / Math.max(1, cell.width)));
    const animRows = kind === "ground" && source.animRows === true;
    const variants = kind === "object" || kind === "autotile" ? 1 : animRows ? columns : Math.max(1, tiles.length);
    return {
        id: typeof source.id === "string" && source.id !== "" ? source.id : `ts${randomUUID().slice(0, 6)}`,
        name: typeof source.name === "string" && source.name !== "" ? source.name : "素材",
        file: typeof source.file === "string" ? source.file : "",
        imageWidth,
        imageHeight,
        cell,
        kind,
        shape: shapeOfKind(kind),
        columns,
        frames,
        variants,
        animRows,
        footprint,
        anchor,
        objectScale,
        pass,
        loop: (() => {
            try {
                return parseAssetLoop(source.loop);
            }
            catch {
                return "forward";
            }
        })(),
        fps: (() => {
            try {
                return parseAssetFps(source.fps);
            }
            catch {
                return undefined;
            }
        })(),
        clarity: (() => {
            try {
                return parseClarity(source.clarity);
            }
            catch {
                return undefined;
            }
        })(),
        builtin: source.builtin === true ? true : undefined,
        tiles
    };
}
function normalizeFootprintFrom(value) {
    const raw = value;
    return { cols: Math.max(1, Math.round(Number(raw?.cols) || 1)), rows: Math.max(1, Math.round(Number(raw?.rows) || 1)) };
}
export async function listIsoProjects() {
    let names = [];
    try {
        names = await readdir(isoJobsRoot());
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        if (!isValidIsoProjectId(name))
            continue;
        const project = await readIsoProject(name);
        if (project === undefined)
            continue;
        out.push(await summarizeIsoProject(project));
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
export async function summarizeIsoProject(project) {
    const doc = (await readTheDoc(project.id)) ?? createIsoDoc(project.id, project.name, 32, 32);
    return {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        cell: project.cell,
        wrap: project.wrap,
        tilesetCount: project.tilesets.length,
        tileCount: flatTiles(project.tilesets).length,
        objectCount: doc.objects.length,
        filled: filledCount(doc),
        stages: project.stages
    };
}
export async function deleteIsoProject(id) {
    const state = docWrites.get(id);
    if (state?.timer != null)
        clearTimeout(state.timer);
    docWrites.delete(id);
    docCache.delete(id);
    history.delete(id);
    await rm(isoProjectDir(id), { recursive: true, force: true });
}
async function readProjectOrThrow(projectId) {
    const project = await readIsoProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    return project;
}
// ── 文档：内存真源 + 防抖落盘 ────────────────────────────────────────────
const docCache = new Map();
const docWrites = new Map();
const WRITE_MAX_LATENCY_MS = 2000;
const WRITE_IDLE_MS = 500;
export async function readTheDoc(projectId) {
    const cached = docCache.get(projectId);
    if (cached !== undefined)
        return cached;
    const raw = await readJson(isoDocFile(projectId));
    const doc = normalizeIsoDoc(raw, projectId);
    if (doc === undefined)
        return undefined;
    docCache.set(projectId, doc);
    return doc;
}
async function theDocOrFresh(projectId) {
    const doc = await readTheDoc(projectId);
    if (doc !== undefined)
        return doc;
    const fresh = createIsoDoc(projectId, "地图", DEFAULT_COLS, DEFAULT_ROWS);
    docCache.set(projectId, fresh);
    return fresh;
}
export async function writeTheDoc(projectId, doc) {
    await enqueueWrite(projectId, async () => {
        await writeJsonAtomic(isoDocFile(projectId), doc);
    });
}
function scheduleDocWrite(projectId, doc) {
    const state = docWrites.get(projectId) ?? { timer: null, lastWrite: 0 };
    docWrites.set(projectId, state);
    const now = Date.now();
    const elapsed = now - state.lastWrite;
    if (elapsed >= WRITE_MAX_LATENCY_MS) {
        state.lastWrite = now;
        void writeTheDoc(projectId, doc).catch(() => undefined);
        return;
    }
    if (state.timer !== null)
        return;
    state.timer = setTimeout(() => {
        state.timer = null;
        state.lastWrite = Date.now();
        void writeTheDoc(projectId, doc).catch(() => undefined);
    }, Math.max(WRITE_IDLE_MS, WRITE_MAX_LATENCY_MS - elapsed));
    if (typeof state.timer.unref === "function")
        state.timer.unref();
}
export async function flushIsoDoc(projectId) {
    const doc = docCache.get(projectId);
    if (doc === undefined)
        return;
    const state = docWrites.get(projectId);
    if (state?.timer != null) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    await writeTheDoc(projectId, doc);
}
const history = new Map();
const HISTORY_MAX_ENTRIES = 200;
const HISTORY_MAX_BYTES = 32 * 1024 * 1024;
function estimateEntryBytes(entry, doc) {
    if (entry.snapshot !== undefined)
        return doc.cols * doc.rows * (doc.layers.length + 1) * 4;
    return (entry.redo.length + entry.undo.length) * 32;
}
function pushHistory(projectId, entry, doc) {
    const state = history.get(projectId) ?? { entries: [], index: -1, bytes: 0 };
    if (state.index < state.entries.length - 1) {
        for (const dropped of state.entries.slice(state.index + 1))
            state.bytes -= estimateEntryBytes(dropped, doc);
        state.entries = state.entries.slice(0, state.index + 1);
    }
    const previous = state.entries[state.index];
    if (entry.snapshot === undefined && entry.stroke !== undefined && previous !== undefined && previous.snapshot === undefined && previous.stroke === entry.stroke) {
        previous.undo = [...entry.undo, ...previous.undo];
        previous.redo = [...previous.redo, ...entry.redo];
        state.bytes += estimateEntryBytes(entry, doc);
        history.set(projectId, state);
        return;
    }
    state.entries.push(entry);
    state.bytes += estimateEntryBytes(entry, doc);
    state.index = state.entries.length - 1;
    while (state.entries.length > HISTORY_MAX_ENTRIES || (state.bytes > HISTORY_MAX_BYTES && state.entries.length > 1)) {
        const dropped = state.entries.shift();
        if (dropped === undefined)
            break;
        state.bytes -= estimateEntryBytes(dropped, doc);
        state.index--;
    }
    state.index = Math.max(-1, state.index);
    history.set(projectId, state);
}
export function historyState(projectId) {
    const state = history.get(projectId);
    if (state === undefined)
        return { canUndo: false, canRedo: false, depth: 0 };
    return { canUndo: state.index >= 0, canRedo: state.index < state.entries.length - 1, depth: state.entries.length };
}
function restoreDoc(target, snapshot) {
    target.name = snapshot.name;
    target.cols = snapshot.cols;
    target.rows = snapshot.rows;
    target.layers = snapshot.layers.map((layer) => ({ ...layer }));
    target.data = Object.fromEntries(Object.entries(snapshot.data).map(([key, value]) => [key, [...value]]));
    target.objects = snapshot.objects.map((object) => ({ ...object }));
    target.markers = snapshot.markers.map((marker) => ({ ...marker }));
    target.updatedAt = new Date().toISOString();
}
function footprintResolver(project) {
    return (tilesetId) => project.tilesets.find((tileset) => tileset.id === tilesetId)?.footprint;
}
function objectTilesetResolver(project) {
    return (tilesetId) => project.tilesets.some((tileset) => tileset.id === tilesetId && tileset.kind === "object");
}
function applyDocOps(doc, ops, layout, project) {
    return applyOpsToDoc(doc, ops, layout, { footprintOf: footprintResolver(project), isObjectTileset: objectTilesetResolver(project) });
}
function newTilesetId() {
    return `ts${randomUUID().slice(0, 8)}`;
}
async function registerIsoTileset(project, input) {
    const tiles = rebuildIsoTiles({
        kind: input.kind,
        cell: project.cell,
        imageWidth: input.imageWidth,
        imageHeight: input.imageHeight,
        frames: input.frames,
        animRows: input.animRows,
        footprint: input.footprint
    }, []);
    const columns = input.kind === "object" ? 1 : Math.max(1, Math.floor(input.imageWidth / Math.max(1, project.cell.width)));
    const variants = input.kind === "object" || input.kind === "autotile" ? 1 : input.animRows ? columns : Math.max(1, tiles.length);
    const file = `tilesets/${input.id}.${sniffImageExt(input.bytes)}`;
    await writeFile(isoAssetPath(project.id, file), input.bytes);
    return {
        id: input.id,
        name: input.name,
        file,
        imageWidth: input.imageWidth,
        imageHeight: input.imageHeight,
        cell: project.cell,
        kind: input.kind,
        shape: shapeOfKind(input.kind),
        columns,
        frames: input.frames,
        variants,
        animRows: input.animRows,
        footprint: input.footprint,
        anchor: input.anchor,
        objectScale: input.kind === "object" ? input.objectScale ?? 1 : undefined,
        pass: input.pass,
        loop: input.loop,
        fps: input.fps,
        clarity: input.clarity,
        builtin: input.builtin === true ? true : undefined,
        tiles
    };
}
function blitBitmap(dst, src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= dst.height)
            continue;
        for (let x = 0; x < src.width; x++) {
            const tx = dx + x;
            if (tx < 0 || tx >= dst.width)
                continue;
            const si = (y * src.width + x) * 4;
            const di = (ty * dst.width + tx) * 4;
            const sa = src.rgba[si + 3];
            if (sa === 0)
                continue;
            if (sa === 255) {
                dst.rgba[di] = src.rgba[si];
                dst.rgba[di + 1] = src.rgba[si + 1];
                dst.rgba[di + 2] = src.rgba[si + 2];
                dst.rgba[di + 3] = 255;
                continue;
            }
            const a = sa / 255;
            const inv = 1 - a;
            const da = dst.rgba[di + 3] / 255;
            const outA = a + da * inv;
            if (outA <= 0)
                continue;
            dst.rgba[di] = Math.round((src.rgba[si] * a + dst.rgba[di] * da * inv) / outA);
            dst.rgba[di + 1] = Math.round((src.rgba[si + 1] * a + dst.rgba[di + 1] * da * inv) / outA);
            dst.rgba[di + 2] = Math.round((src.rgba[si + 2] * a + dst.rgba[di + 2] * da * inv) / outA);
            dst.rgba[di + 3] = Math.round(outA * 255);
        }
    }
}
function sheetFromSource(source, sourceCell, targetCell, clarity) {
    const cols = Math.max(1, Math.floor(source.width / sourceCell.width));
    const rows = Math.max(1, Math.floor(source.height / sourceCell.height));
    const out = { width: cols * targetCell.width, height: rows * targetCell.height, rgba: Buffer.alloc(cols * targetCell.width * rows * targetCell.height * 4) };
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cropped = cropTile(source, { x: c * sourceCell.width, y: r * sourceCell.height, width: sourceCell.width, height: sourceCell.height });
            const fitted = cropped.width === targetCell.width && cropped.height === targetCell.height ? cropped : resampleToSize(cropped, targetCell.width, targetCell.height, clarity);
            blitBitmap(out, fitted, c * targetCell.width, r * targetCell.height);
        }
    }
    return out;
}
function objectSheet(source, sourceCell, frameCount, targetWidth, clarity) {
    const sourceFrameHeight = source.height / frameCount;
    if (!Number.isFinite(sourceFrameHeight) || sourceFrameHeight <= 0)
        throw new Error("物件图的帧高不合法");
    const targetFrameHeight = Math.max(1, Math.round((sourceFrameHeight * targetWidth) / Math.max(1, source.width)));
    const out = { width: targetWidth, height: targetFrameHeight * frameCount, rgba: Buffer.alloc(targetWidth * targetFrameHeight * frameCount * 4) };
    for (let frame = 0; frame < frameCount; frame++) {
        const cropped = cropTile(source, { x: 0, y: Math.round(frame * sourceFrameHeight), width: source.width, height: Math.round(sourceFrameHeight) });
        const fitted = resampleToSize(cropped, targetWidth, targetFrameHeight, clarity);
        blitBitmap(out, fitted, 0, frame * targetFrameHeight);
    }
    return out;
}
export async function importIsoTileset(projectId, name, base64, opts = {}) {
    const project = await readProjectOrThrow(projectId);
    if (base64.trim() === "")
        throw new Error("图片内容为空。");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0)
        throw new Error("图片内容为空。");
    const kind = parseIsoTilesetKind(opts.kind);
    const size = pngSize(bytes) ?? (await probeImageSizeFromBytes(bytes));
    if (size === undefined || size.width < 1 || size.height < 1)
        throw new Error("读不出图片尺寸：请换一张 PNG / JPG / WebP。");
    const sourceCell = {
        width: Math.max(1, Math.round(Number(opts.sourceCell?.width ?? project.cell.width) || project.cell.width)),
        height: Math.max(1, Math.round(Number(opts.sourceCell?.height ?? project.cell.height) || project.cell.height))
    };
    const clarity = (() => {
        try {
            return parseClarity(opts.clarity);
        }
        catch (error) {
            throw new Error(messageOf(error));
        }
    })();
    const objectScale = (() => {
        try {
            return kind === "object" ? parseIsoObjectScale(opts.objectScale) ?? 1 : undefined;
        }
        catch (error) {
            throw new Error(messageOf(error));
        }
    })();
    const warnings = [];
    let bitmap = await decodeBytesToBitmap(bytes);
    let frames = 1;
    let animRows = false;
    let footprint;
    let anchor;
    let pass;
    let stored;
    if (kind === "object") {
        const rawFrames = Math.round(Number(opts.frames ?? 1));
        if (!Number.isFinite(rawFrames) || rawFrames < 1 || rawFrames > 64)
            throw new Error(`物件帧数必须是 1~64 的整数，收到 ${String(opts.frames)}`);
        frames = rawFrames;
        if (size.height % frames !== 0)
            throw new Error(`物件图高 ${size.height} 不能被帧数 ${frames} 整除`);
        footprint = normalizeFootprintFrom(opts.footprint);
        const layoutDoc = await theDocOrFresh(projectId);
        if (footprint.cols > layoutDoc.cols || footprint.rows > layoutDoc.rows) {
            throw new Error(`物件占格 ${footprint.cols}×${footprint.rows} 比地图（${layoutDoc.cols}×${layoutDoc.rows}）还大`);
        }
        anchor = parseIsoAnchor(opts.anchor) ?? { x: 0.5, y: 1 };
        pass = parsePassCells(opts.pass, footprint) ?? new Array(footprint.cols * footprint.rows).fill(1);
        if (opts.keyGreen === true) {
            const keyColor = normalizeKeyColor(opts.keyColor);
            const screen = keyScreenName(keyColor, "zh");
            const keyed = keyStampBackground(bitmap, (rgba, width, height) => keyGreen(rgba, width, height, { ...STAMP_KEY_OPTIONS, keyColor }));
            bitmap = keyed.bitmap;
            if (keyed.keyed === 0)
                warnings.push(`没有检测到${screen}背景，按原图用了。`);
        }
        const targetWidth = Math.max(1, Math.round(footprint.cols * project.cell.width * (objectScale ?? 1)));
        stored = objectSheet(bitmap, sourceCell, frames, targetWidth, clarity);
    }
    else {
        const cols = Math.floor(size.width / sourceCell.width);
        const rows = Math.floor(size.height / sourceCell.height);
        if (cols < 1 || rows < 1)
            throw new Error(`图片 ${size.width}×${size.height} 比一格 ${sourceCell.width}×${sourceCell.height} 还小，切不出地块。`);
        if (kind === "autotile" && (cols !== 4 || rows !== 4)) {
            throw new Error(`自动连接必须是 4×4 = 16 块（当前 ${cols}×${rows}），请按行优先 mask 0..15 排版`);
        }
        animRows = kind === "ground" && (opts.animRows === true || String(opts.animRows) === "true");
        frames = animRows ? rows : 1;
        const resized = sheetFromSource(bitmap, sourceCell, project.cell, clarity);
        stored = resized;
        if (size.width % sourceCell.width !== 0 || size.height % sourceCell.height !== 0) {
            warnings.push(`图片尺寸不是格子的整数倍（${size.width}×${size.height} / ${sourceCell.width}×${sourceCell.height}），右边 / 下边多出来的部分被忽略。`);
        }
        if (sourceCell.width !== project.cell.width || sourceCell.height !== project.cell.height) {
            warnings.push(`源图每格 ${sourceCell.width}×${sourceCell.height}，已按项目格子 ${project.cell.width}×${project.cell.height} 重采样。`);
        }
    }
    const id = newTilesetId();
    const tileset = await registerIsoTileset(project, {
        id,
        name: name.trim() === "" ? `素材 ${project.tilesets.length + 1}` : name.trim(),
        bytes: encodeBitmap(stored),
        kind,
        imageWidth: stored.width,
        imageHeight: stored.height,
        frames,
        animRows,
        footprint,
        anchor,
        objectScale,
        pass,
        fps: (() => {
            try {
                return parseAssetFps(opts.fps);
            }
            catch {
                return undefined;
            }
        })(),
        loop: (() => {
            try {
                return parseAssetLoop(opts.loop);
            }
            catch {
                return undefined;
            }
        })(),
        clarity
    });
    await patchIsoProject(projectId, (fresh) => {
        fresh.tilesets.push(tileset);
        fresh.stages.assets = { status: "done", at: new Date().toISOString(), approved: fresh.stages.assets.approved };
        appendJobLog(fresh.logs, "info", `导入素材：${tileset.name}（${tileset.kind}，${tileset.imageWidth}×${tileset.imageHeight} → ${tileset.tiles.length} 块）`);
    });
    return { tilesets: [tileset], warnings };
}
/**
 * 「AI 生成素材」的终点：把模型给的几张原图整理成 `ai/<名字>.png`。
 *
 * **只整理、不进素材列表**。素材属性在「新增素材」那一刻定死，所以最后一步
 * 必须由用户点「确定」；返链只负责把图与建议属性预填。
 */
export async function composeIsoAsset(input) {
    const project = await readProjectOrThrow(input.projectId);
    const files = (input.files ?? []).map((file) => String(file));
    if (files.length === 0)
        throw new Error("没有可整理的帧：files 不能为空。");
    if (input.kind !== "ground" && input.kind !== "object") {
        throw new Error(`AI 生成素材目前只支持 ground / object（收到 ${String(input.kind)}）。自动连接 4×4 请手工导入。`);
    }
    const footprint = input.kind === "object"
        ? {
            cols: Math.max(1, Math.round(Number(input.footprint?.cols ?? 1) || 1)),
            rows: Math.max(1, Math.round(Number(input.footprint?.rows ?? 1) || 1))
        }
        : undefined;
    if (footprint !== undefined) {
        const doc = await theDocOrFresh(project.id);
        if (footprint.cols > doc.cols || footprint.rows > doc.rows) {
            throw new Error(`物件占格 ${footprint.cols}×${footprint.rows} 比地图（${doc.cols}×${doc.rows}）还大`);
        }
    }
    const composed = await composeIsoFrames({
        files,
        kind: input.kind,
        cell: project.cell,
        footprint,
        keyGreen: input.keyGreen !== false,
        keyColor: input.keyColor
    });
    const name = input.name === undefined || String(input.name).trim() === "" ? "AI 素材" : String(input.name).trim();
    const file = `ai/${safeAssetStem(name)}.png`;
    await mkdir(join(isoProjectDir(project.id), "ai"), { recursive: true });
    await writeFile(isoAssetPath(project.id, file), encodeBitmap(composed.bitmap));
    const animRows = input.kind === "ground" && composed.frameCount > 1;
    await patchIsoProject(project.id, (fresh) => {
        appendJobLog(fresh.logs, "info", `整理 AI 素材：${name}（${input.kind} / ${composed.frameCount} 帧 → ${composed.bitmap.width}×${composed.bitmap.height}${composed.scale > 1 ? `，每格 ${project.cell.width * composed.scale}px（${composed.scale} 倍）` : ""}，落在 ${file}，等你在「新增素材」里确认）`);
    });
    const localPath = isoAssetPath(project.id, file);
    return {
        file,
        localPath,
        previewPath: localPath,
        name,
        kind: input.kind,
        cell: project.cell,
        width: composed.bitmap.width,
        height: composed.bitmap.height,
        frameCount: composed.frameCount,
        animRows,
        footprint,
        scale: composed.scale,
        keyed: composed.keyed,
        notes: composed.notes
    };
}
async function probeImageSizeFromBytes(bytes) {
    const ext = sniffImageExt(bytes);
    const scratch = join(dataRoot(), `iso-probe-${randomUUID().slice(0, 8)}.${ext}`);
    try {
        await writeFile(scratch, bytes);
        return await probeImageSize(scratch);
    }
    catch {
        return undefined;
    }
    finally {
        await rm(scratch, { force: true });
    }
}
async function decodeBytesToBitmap(bytes) {
    const ext = sniffImageExt(bytes);
    const scratch = join(dataRoot(), `iso-decode-${randomUUID().slice(0, 8)}.${ext}`);
    try {
        await writeFile(scratch, bytes);
        return await decodeFile(scratch);
    }
    finally {
        await rm(scratch, { force: true });
    }
}
export async function importIsoSampleTileset(projectId) {
    const project = await readProjectOrThrow(projectId);
    const byName = new Map(project.tilesets.map((tileset) => [tileset.name, tileset]));
    const warnings = [];
    const created = [];
    for (const sample of renderIsoSamples(project.cell)) {
        const existing = byName.get(sample.name);
        if (existing !== undefined && existing.builtin !== true) {
            warnings.push(`素材「${sample.name}」是你自己导入的，同名内置素材跳过。`);
            continue;
        }
        const size = pngSize(sample.bytes);
        if (size === undefined)
            throw new Error(`内置素材「${sample.name}」生成失败`);
        /**
         * 同名内置素材**原地刷新**（保留 id / 名字 / 速度 / 循环）。
         *
         * 为什么不是跳过：内置素材的生成代码改了（例如这次修水面接缝），老项目里那张图
         * 还是旧版本；跳过的表现就是「点了恢复默认素材，缝还在」。刷新时图块顺序不变，
         * `map.json` 里的序号仍然指同一块，已画的地图不用重画。
         */
        const replacing = existing !== undefined;
        if (replacing && existing.tiles.length !== rebuildIsoTiles({ kind: sample.kind, cell: project.cell, imageWidth: size.width, imageHeight: size.height, frames: sample.frames, animRows: sample.animRows, footprint: sample.footprint }).length) {
            warnings.push(`内置素材「${sample.name}」的图块数变了，为避免错位已跳过刷新；请新建项目。`);
            continue;
        }
        const tileset = await registerIsoTileset(project, {
            id: existing?.id ?? newTilesetId(),
            name: existing?.name ?? sample.name,
            bytes: sample.bytes,
            kind: sample.kind,
            imageWidth: size.width,
            imageHeight: size.height,
            frames: sample.frames,
            animRows: sample.animRows,
            footprint: sample.footprint,
            pass: sample.pass,
            builtin: true,
            fps: existing?.fps,
            loop: existing?.loop,
            clarity: existing?.clarity
        });
        await patchIsoProject(projectId, (fresh) => {
            const at = fresh.tilesets.findIndex((entry) => entry.id === tileset.id);
            if (at >= 0)
                fresh.tilesets[at] = tileset;
            else
                fresh.tilesets.push(tileset);
            fresh.stages.assets = { status: "done", at: new Date().toISOString(), approved: fresh.stages.assets.approved };
        });
        created.push(tileset);
    }
    if (created.length > 0) {
        await patchIsoProject(projectId, (fresh) => {
            appendJobLog(fresh.logs, "info", `导入 / 刷新内置素材：${created.map((tileset) => tileset.name).join("、")}`);
        });
    }
    return { tilesets: created, warnings };
}
// ── 素材属性 / 删除 ──────────────────────────────────────────────────────
export async function saveIsoTileset(projectId, tilesetId, patch) {
    const project = await readProjectOrThrow(projectId);
    const index = project.tilesets.findIndex((tileset) => tileset.id === tilesetId);
    if (index < 0)
        throw new Error(`没有这块素材：${tilesetId}`);
    const current = project.tilesets[index];
    const next = { ...current, tiles: current.tiles };
    if (patch.name !== undefined) {
        const trimmed = String(patch.name).trim();
        if (trimmed !== "")
            next.name = trimmed;
    }
    if (patch.fps !== undefined) {
        if (patch.fps === null)
            next.fps = undefined;
        else {
            const fps = parseAssetFps(patch.fps);
            if (fps === undefined)
                throw new Error(`播放速度必须是 ${0.5}~${30} 帧/秒`);
            next.fps = fps;
        }
    }
    if (patch.loop !== undefined)
        next.loop = parseAssetLoop(patch.loop);
    const warnings = [];
    await patchIsoProject(projectId, (fresh) => {
        const at = fresh.tilesets.findIndex((tileset) => tileset.id === tilesetId);
        if (at >= 0)
            fresh.tilesets[at] = next;
        appendJobLog(fresh.logs, "info", `修改素材属性：${next.name}`);
    });
    return { tileset: next, warnings };
}
export async function removeIsoTileset(projectId, tilesetId) {
    const project = await readProjectOrThrow(projectId);
    const index = project.tilesets.findIndex((tileset) => tileset.id === tilesetId);
    if (index < 0)
        throw new Error(`没有这块素材：${tilesetId}`);
    const removed = project.tilesets[index];
    const nextTilesets = project.tilesets.filter((tileset) => tileset.id !== tilesetId);
    const doc = await theDocOrFresh(projectId);
    const oldFlat = new Map(flatTiles(project.tilesets).map((flat) => [flat.index, flat]));
    const newFlat = new Map();
    for (const flat of flatTiles(nextTilesets))
        newFlat.set(`${flat.tilesetId}|${flat.tile.id}`, flat);
    let clearedCells = 0;
    for (const layer of doc.layers) {
        if (layer.kind !== "ground")
            continue;
        const data = doc.data[layer.id];
        if (data === undefined)
            continue;
        for (let i = 0; i < data.length; i++) {
            const value = data[i] ?? 0;
            if (value <= 0)
                continue;
            const flat = oldFlat.get(value);
            if (flat === undefined || flat.tilesetId === removed.id) {
                data[i] = 0;
                clearedCells++;
                continue;
            }
            const mapped = newFlat.get(`${flat.tilesetId}|${flat.tile.id}`);
            if (mapped === undefined) {
                data[i] = 0;
                clearedCells++;
            }
            else {
                data[i] = mapped.index;
            }
        }
    }
    const before = doc.objects.length;
    doc.objects = doc.objects.filter((object) => object.tilesetId !== removed.id);
    const removedObjects = before - doc.objects.length;
    doc.updatedAt = new Date().toISOString();
    await patchIsoProject(projectId, (fresh) => {
        fresh.tilesets = nextTilesets;
        appendJobLog(fresh.logs, "info", `删除素材：${removed.name}`);
    });
    scheduleDocWrite(projectId, doc);
    await flushIsoDoc(projectId);
    const warnings = [];
    if (clearedCells > 0)
        warnings.push(`清掉了 ${clearedCells} 个用这张素材画过的格子。`);
    if (removedObjects > 0)
        warnings.push(`删掉了 ${removedObjects} 个用这张素材放的物件。`);
    return { removedObjects, clearedCells, warnings };
}
/** 网关 / 工具面用的素材摘要（补上 rev）。 */
export function isoTilesetBrief(tileset, rev, allTilesets) {
    return briefOf(tileset, rev, allTilesets ?? [tileset]);
}
export function isoAssetBase(projectId) {
    return assetBasePath(`/dsh-game-material-master/iso-assets/${projectId}/`);
}
async function fileRevision(path) {
    try {
        const info = await stat(path);
        return Math.round(info.mtimeMs);
    }
    catch {
        return undefined;
    }
}
export async function tilesetRevisions(projectId) {
    const project = await readProjectOrThrow(projectId);
    return new Map(await Promise.all(project.tilesets.map(async (tileset) => [tileset.id, await fileRevision(join(isoProjectDir(projectId), tileset.file))])));
}
/**
 * 文档 + 素材元数据 + 素材图 mtime 的短哈希（与 `mapgen.mapRevision` 同口径）。
 * 不落盘；同一状态稳定。
 */
export async function isoRevision(project, doc, revisions) {
    const revs = revisions ?? (await tilesetRevisions(project.id));
    const payload = JSON.stringify({
        cell: project.cell,
        wrap: project.wrap,
        doc: {
            cols: doc.cols,
            rows: doc.rows,
            layers: doc.layers,
            data: doc.data,
            objects: doc.objects,
            markers: doc.markers
        },
        tilesets: project.tilesets.map((tileset) => ({
            id: tileset.id,
            name: tileset.name,
            file: tileset.file,
            imageWidth: tileset.imageWidth,
            imageHeight: tileset.imageHeight,
            cell: tileset.cell,
            kind: tileset.kind,
            columns: tileset.columns,
            frames: tileset.frames,
            variants: tileset.variants,
            animRows: tileset.animRows,
            footprint: tileset.footprint,
            anchor: tileset.anchor,
            objectScale: tileset.objectScale,
            pass: tileset.pass,
            loop: tileset.loop,
            clarity: tileset.clarity,
            fps: tileset.fps,
            builtin: tileset.builtin === true,
            tileCount: tileset.tiles.length
        })),
        files: project.tilesets.map((tileset) => [tileset.id, revs.get(tileset.id) ?? 0])
    });
    return createHash("sha1").update(payload).digest("hex").slice(0, 12);
}
export async function isoView(project) {
    const doc = await theDocOrFresh(project.id);
    const layout = layoutOf(project.cell, doc.cols, doc.rows, project.wrap);
    const flat = flatTiles(project.tilesets);
    const revisions = await tilesetRevisions(project.id);
    const state = historyState(project.id);
    const layers = doc.layers.map((layer) => ({ ...layer, filled: filledCount(doc, layer.id) }));
    const listing = await readExportListingRelative(project);
    const preview = (await readPreviewFiles(project.id)).map((name) => `preview/${name}`);
    return {
        id: project.id,
        name: project.name,
        assetBase: isoAssetBase(project.id),
        cell: project.cell,
        wrap: project.wrap,
        cols: doc.cols,
        rows: doc.rows,
        revision: await isoRevision(project, doc, revisions),
        layout: { stepX: layout.stepX, stepY: layout.stepY, diamondHeight: layout.diamondHeight },
        bounds: planBounds(isoRenderContext(project, doc, project.tilesets), doc),
        tilesets: project.tilesets.map((tileset) => briefOf(tileset, revisions.get(tileset.id), project.tilesets)),
        legend: flat.map((flat) => {
            const tileset = project.tilesets.find((entry) => entry.id === flat.tilesetId);
            return { index: flat.index, tilesetId: flat.tilesetId, rect: flat.tile.rect, kind: (tileset?.kind ?? "ground") };
        }),
        layers,
        markers: doc.markers.map((marker, index) => ({
            id: marker.id,
            n: index + 1,
            r: marker.r,
            c: marker.c,
            name: marker.name,
            ...(marker.kind === undefined ? {} : { kind: marker.kind }),
            ...(marker.color === undefined ? {} : { color: marker.color }),
            ...(marker.note === undefined ? {} : { note: marker.note }),
            ...(marker.tags === undefined ? {} : { tags: marker.tags })
        })),
        filled: filledCount(doc),
        objects: objectCount(doc),
        objectList: doc.objects.map((object) => {
            const tileset = project.tilesets.find((entry) => entry.id === object.tilesetId);
            return { id: object.id, layerId: object.layerId, tilesetId: object.tilesetId, r: object.r, c: object.c, cols: tileset?.footprint?.cols ?? 1, rows: tileset?.footprint?.rows ?? 1 };
        }),
        stages: project.stages,
        reviewMode: project.reviewMode,
        busy: isoBusy(project.id),
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        maxChunks: MAX_ISO_PLAN_CHUNKS,
        warnings: warningsFor(project, doc),
        logs: project.logs.slice(-40),
        preview,
        previewPaths: preview.map((relative) => join(isoProjectDir(project.id), relative)),
        exportBase: listing?.base ?? "",
        exportFiles: listing?.files ?? [],
        exportPath: listing === undefined ? "" : join(isoProjectDir(project.id), "export", isoExportDirName(doc, project))
    };
}
const ISO_INSPECT_SYMBOLS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function isoInspectInt(value, fallback, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, n));
}
function isoInspectRegion(value, doc) {
    const raw = (value ?? {});
    const r0 = isoInspectInt(raw.r0, 0, -MAX_ISO_DIM, MAX_ISO_DIM);
    const c0 = isoInspectInt(raw.c0, 0, -MAX_ISO_DIM, MAX_ISO_DIM);
    const r1 = isoInspectInt(raw.r1, doc.rows, -MAX_ISO_DIM, MAX_ISO_DIM);
    const c1 = isoInspectInt(raw.c1, doc.cols, -MAX_ISO_DIM, MAX_ISO_DIM);
    if (r1 <= r0 || c1 <= c0)
        throw new Error("region 必须是正矩形（r1 > r0、c1 > c0）。");
    return { r0, c0, r1, c1 };
}
function isoInspectNextRange(region, limit) {
    const width = Math.max(1, Math.min(region.c1 - region.c0, limit));
    const height = Math.max(1, Math.min(region.r1 - region.r0, Math.ceil(limit / width)));
    return { r0: region.r0, c0: region.c0, r1: region.r0 + height, c1: region.c0 + width };
}
function isoObjectInRegion(object, footprint, region) {
    for (let dr = 0; dr < footprint.rows; dr++) {
        for (let dc = 0; dc < footprint.cols; dc++) {
            const r = object.r + dr;
            const c = object.c + dc;
            if (r >= region.r0 && r < region.r1 && c >= region.c0 && c < region.c1)
                return true;
        }
    }
    return false;
}
/**
 * 读一块 45° 地图的语义状态：地面网格、物件、标记、通行性、统计。
 * 与 `isoPlan` 分开：这里没有像素坐标 / chunk / visibleKeys。
 */
export async function isoInspect(projectId, options = {}) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const layout = layoutOf(project.cell, doc.cols, doc.rows, project.wrap);
    const region = isoInspectRegion(options.region, doc);
    const maxCells = isoInspectInt(options.maxCells, 4096, 1, 65_536);
    const maxItems = isoInspectInt(options.maxItems, 200, 1, 2_000);
    const format = options.format === "text" || options.format === "json" ? options.format : "both";
    const include = new Set(options.include ?? ["layers", "markers", "objects", "pass", "stats", "legend"]);
    const layerFilter = options.layerIds === undefined ? undefined : new Set(options.layerIds.map(String));
    const cells = (region.r1 - region.r0) * (region.c1 - region.c0);
    const truncated = cells > maxCells;
    const nextRange = truncated ? isoInspectNextRange(region, maxCells) : null;
    const flat = flatTiles(project.tilesets);
    const byIndex = new Map(flat.map((entry) => [entry.index, entry]));
    const used = new Map();
    const symbolOf = new Map();
    const symbolFor = (index) => {
        const existing = symbolOf.get(index);
        if (existing !== undefined)
            return existing;
        const symbol = symbolOf.size < ISO_INSPECT_SYMBOLS.length ? ISO_INSPECT_SYMBOLS[symbolOf.size] : "?";
        symbolOf.set(index, symbol);
        return symbol;
    };
    const layers = [];
    const rowsByLayer = new Map();
    const histogram = new Map();
    let filled = 0;
    const wantRows = !truncated && format !== "json";
    for (const layer of doc.layers) {
        if (layerFilter !== undefined && !layerFilter.has(layer.id))
            continue;
        if (layer.kind === "object") {
            const count = objectCount(doc, layer.id);
            layers.push({ id: layer.id, name: layer.name, kind: layer.kind, filled: count });
            rowsByLayer.set(layer.id, []);
            continue;
        }
        const data = doc.data[layer.id] ?? [];
        const rows = [];
        let layerFilled = 0;
        for (let r = region.r0; r < region.r1; r++) {
            let row = "";
            for (let c = region.c0; c < region.c1; c++) {
                const wrapped = wrapCell(layout, r, c);
                const outside = wrapped.r < 0 || wrapped.c < 0 || wrapped.r >= doc.rows || wrapped.c >= doc.cols;
                const value = outside ? 0 : data[cellIndex(doc, wrapped.r, wrapped.c)] ?? 0;
                if (value > 0) {
                    layerFilled++;
                    filled++;
                    used.set(value, (used.get(value) ?? 0) + 1);
                    histogram.set(value, (histogram.get(value) ?? 0) + 1);
                }
                if (!wantRows)
                    continue;
                if (outside)
                    row += "#";
                else if (value <= 0)
                    row += "·";
                else
                    row += symbolFor(value);
            }
            if (wantRows)
                rows.push(row);
        }
        rowsByLayer.set(layer.id, rows);
        layers.push({ id: layer.id, name: layer.name, kind: layer.kind, filled: layerFilled, ...(format === "text" || truncated ? {} : { rows }) });
    }
    const legend = [...used.keys()]
        .sort((a, b) => a - b)
        .slice(0, ISO_INSPECT_SYMBOLS.length)
        .map((index) => {
        const entry = byIndex.get(index);
        const tileset = entry === undefined ? undefined : project.tilesets.find((item) => item.id === entry.tilesetId);
        return {
            symbol: symbolFor(index),
            index,
            ...(entry === undefined
                ? {}
                : {
                    tilesetId: entry.tilesetId,
                    tilesetName: tileset?.name ?? entry.tilesetId,
                    tileId: entry.tile.id,
                    rect: entry.tile.rect,
                    kind: tileset?.kind,
                    mask: entry.tile.mask,
                    variant: entry.tile.variant,
                    frame: entry.tile.frame
                })
        };
    });
    const markersInRegion = doc.markers.filter((marker) => marker.r >= region.r0 && marker.r < region.r1 && marker.c >= region.c0 && marker.c < region.c1);
    const markers = markersInRegion.slice(0, maxItems).map((marker) => ({
        id: marker.id,
        n: doc.markers.indexOf(marker) + 1,
        r: marker.r,
        c: marker.c,
        name: marker.name,
        kind: marker.kind ?? "custom",
        color: marker.color ?? null,
        note: marker.note ?? "",
        tags: marker.tags ?? []
    }));
    const objectsInRegion = doc.objects.filter((object) => {
        if (layerFilter !== undefined && !layerFilter.has(object.layerId))
            return false;
        const tileset = project.tilesets.find((entry) => entry.id === object.tilesetId);
        return isoObjectInRegion(object, tileset?.footprint ?? { cols: 1, rows: 1 }, region);
    });
    const objects = objectsInRegion.slice(0, maxItems).map((object) => {
        const tileset = project.tilesets.find((entry) => entry.id === object.tilesetId);
        const footprint = tileset?.footprint ?? { cols: 1, rows: 1 };
        return {
            id: object.id,
            layerId: object.layerId,
            tilesetId: object.tilesetId,
            name: tileset?.name ?? object.tilesetId,
            r: object.r,
            c: object.c,
            cols: footprint.cols,
            rows: footprint.rows,
            pass: tileset?.pass ?? []
        };
    });
    const pass = passCellsOf(isoRenderContext(project, doc, project.tilesets), doc).filter((cell) => cell.r >= region.r0 && cell.r < region.r1 && cell.c >= region.c0 && cell.c < region.c1);
    const markersByKind = new Map();
    for (const marker of markersInRegion) {
        const kind = typeof marker.kind === "string" && marker.kind !== "" ? marker.kind : "custom";
        markersByKind.set(kind, (markersByKind.get(kind) ?? 0) + 1);
    }
    const stats = {
        cells,
        filled,
        objects: objectsInRegion.length,
        markers: markersInRegion.length,
        tileHistogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([index, count]) => ({ index, count })),
        markersByKind: [...markersByKind.entries()].map(([kind, count]) => ({ kind, count }))
    };
    const text = format === "json"
        ? undefined
        : [
            `45° 地图 ${doc.cols}×${doc.rows} · 区域 (${region.r0},${region.c0})–(${region.r1 - 1},${region.c1 - 1})`,
            ...layers.map((layer) => `${String(layer.name)}\n${layer.kind === "object"
                ? "（物件层，见 objects）"
                : (rowsByLayer.get(String(layer.id)) ?? []).join("\n") || "（内容过大，已省略逐格文本）"}`),
            `图例：${legend.map((entry) => `${String(entry.symbol)}=${String(entry.tilesetName ?? entry.tilesetId ?? "未知")}/${String(entry.index)}`).join(" ")}`
        ].join("\n\n");
    return {
        module: "iso",
        projectId,
        revision: await isoRevision(project, doc),
        cols: doc.cols,
        rows: doc.rows,
        cell: project.cell,
        wrap: project.wrap,
        range: region,
        truncated,
        nextRange,
        truncatedItems: [
            ...(markersInRegion.length > markers.length ? ["markers"] : []),
            ...(objectsInRegion.length > objects.length ? ["objects"] : [])
        ],
        legend: include.has("legend") ? legend : [],
        layers: include.has("layers") ? layers : [],
        markers: include.has("markers") ? markers : undefined,
        objects: include.has("objects") ? objects : undefined,
        pass: include.has("pass") ? pass : undefined,
        stats,
        warnings: [
            ...warningsFor(project, doc),
            ...(used.size > ISO_INSPECT_SYMBOLS.length ? [`不同图块超过 ${ISO_INSPECT_SYMBOLS.length} 种，文本网格用 ? 代替，精确值请用 format=json。`] : [])
        ],
        busy: isoBusy(projectId),
        canUndo: historyState(projectId).canUndo,
        canRedo: historyState(projectId).canRedo,
        ...(text === undefined ? {} : { text })
    };
}
function warningsFor(project, doc) {
    const out = [];
    if (project.tilesets.length === 0)
        out.push("还没有素材：先导入一张素材图，或者用「恢复默认素材」装一套内置素材。");
    for (const tileset of project.tilesets) {
        if (tileset.kind === "autotile" && tileset.tiles.length !== 16)
            out.push(`素材「${tileset.name}」是自动连接，但只有 ${tileset.tiles.length} 块（需要 16 块）。`);
        if (tileset.kind === "object" && tileset.footprint !== undefined) {
            if (tileset.footprint.cols > doc.cols || tileset.footprint.rows > doc.rows)
                out.push(`素材「${tileset.name}」的占格比地图还大，放不下去。`);
        }
    }
    const ground = doc.layers.find((layer) => layer.kind === "ground");
    if (ground !== undefined && filledCount(doc, ground.id) === 0)
        out.push(`「${ground.name}」还是空的：先用笔刷铺一层，或者一键生成。`);
    return out;
}
/** 物件可能高出很多格：视口范围要多给多少格 padding。 */
function planPadding(project) {
    let pad = 2;
    for (const tileset of project.tilesets) {
        if (tileset.kind !== "object")
            continue;
        const rect = tileset.tiles.find((tile) => (tile.frame ?? 0) === 0)?.rect ?? tileset.tiles[0]?.rect;
        if (rect === undefined)
            continue;
        pad = Math.max(pad, Math.ceil(rect.width / Math.max(1, project.cell.width / 2)) + 1, Math.ceil(rect.height / Math.max(1, project.cell.width / 4)) + 1);
    }
    return Math.min(24, pad);
}
export async function isoPlan(projectId, o) {
    const project = await readProjectOrThrow(projectId);
    let doc = await theDocOrFresh(projectId);
    const forced = new Set();
    if (Array.isArray(o.pending) && o.pending.length > 0) {
        const preview = cloneIsoDoc(doc);
        const previewLayout = layoutOf(project.cell, preview.cols, preview.rows, project.wrap);
        const overlay = applyDocOps(preview, o.pending, previewLayout, project);
        doc = preview;
        for (const key of dirtyChunksFor(overlay.dirty, previewLayout))
            forced.add(key);
    }
    const context = isoRenderContext(project, doc, project.tilesets);
    const range = viewCellRange(context.layout, o.view, planPadding(project));
    const covering = chunksInRange(range);
    const truncated = covering.length > MAX_ISO_PLAN_CHUNKS;
    const visible = truncated ? covering.slice(0, MAX_ISO_PLAN_CHUNKS) : covering;
    const visibleKeys = visible.map(chunkKey);
    const wanted = new Set(visibleKeys);
    const have = new Set(o.have ?? []);
    const plan = buildIsoPlan(context, doc, { range, layers: o.layerIds === undefined ? undefined : [...o.layerIds], includeLegend: true });
    return {
        cell: project.cell,
        wrap: project.wrap,
        cols: doc.cols,
        rows: doc.rows,
        layout: { stepX: context.layout.stepX, stepY: context.layout.stepY, diamondHeight: context.layout.diamondHeight },
        bounds: plan.bounds,
        visibleKeys,
        chunks: plan.chunks.filter((chunk) => wanted.has(chunk.key) && (!have.has(chunk.key) || forced.has(chunk.key))),
        legend: plan.legend,
        markers: plan.markers,
        ...(o.pass === true ? { pass: passCellsOf(context, doc) } : {}),
        fps: plan.fps,
        fpsMax: plan.fpsMax,
        frameCount: plan.frameCount,
        truncated,
        warnings: plan.warnings
    };
}
export async function applyIsoOps(projectId, ops, options = {}) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const currentRevision = await isoRevision(project, doc);
    if (options.ifRevision !== undefined && options.ifRevision !== "" && options.ifRevision !== currentRevision) {
        throw new Error(`版本不一致：当前 ${currentRevision}，请求 ${options.ifRevision}；请重新 isoInspect 后再改。`);
    }
    const target = options.dryRun === true ? cloneIsoDoc(doc) : doc;
    const layout = layoutOf(project.cell, target.cols, target.rows, project.wrap);
    const result = applyDocOps(target, ops, layout, project);
    if (options.dryRun !== true && (result.changed > 0 || result.touched)) {
        pushHistory(projectId, { undo: result.undo, redo: result.redo, stroke: options.stroke }, doc);
        scheduleDocWrite(projectId, doc);
    }
    const dirty = dirtyChunksFor(result.dirty, layout);
    const have = new Set(options.have ?? []);
    const dropKeys = dirty.filter((key) => have.has(key));
    const state = historyState(projectId);
    return {
        changed: result.changed,
        skipped: result.skipped,
        dirtyChunks: dirty,
        dropKeys,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        touched: result.touched,
        revision: options.dryRun === true ? currentRevision : await isoRevision(project, doc),
        ...(options.dryRun === true ? { dryRun: true } : {}),
        summary: {
            cells: result.changed,
            markers: ops.filter((op) => op?.kind === "marker").length,
            stamps: 0,
            objects: ops.filter((op) => op?.kind === "object").length
        }
    };
}
export async function isoUndo(projectId, have = []) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const state = history.get(projectId);
    if (state === undefined || state.index < 0) {
        return { changed: 0, skipped: [], dirtyChunks: [], dropKeys: [], canUndo: false, canRedo: false, touched: false, revision: await isoRevision(project, doc) };
    }
    const entry = state.entries[state.index];
    const layout = layoutOf(project.cell, doc.cols, doc.rows, project.wrap);
    let dirty = [];
    if (entry.snapshot !== undefined) {
        restoreDoc(doc, entry.snapshot.before);
        dirty = Array.from({ length: doc.rows * doc.cols }, (_unused, index) => ({ r: Math.floor(index / doc.cols), c: index % doc.cols }));
    }
    else {
        const result = applyDocOps(doc, entry.undo, layout, project);
        dirty = result.dirty;
    }
    state.index--;
    scheduleDocWrite(projectId, doc);
    const dirtyChunks = dirtyChunksFor(dirty, layout);
    const haveSet = new Set(have);
    return {
        changed: dirty.length,
        skipped: [],
        dirtyChunks,
        dropKeys: dirtyChunks.filter((key) => haveSet.has(key)),
        canUndo: state.index >= 0,
        canRedo: state.index < state.entries.length - 1,
        touched: true,
        revision: await isoRevision(project, doc)
    };
}
export async function isoRedo(projectId, have = []) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const state = history.get(projectId);
    if (state === undefined || state.index >= state.entries.length - 1) {
        return { changed: 0, skipped: [], dirtyChunks: [], dropKeys: [], canUndo: false, canRedo: false, touched: false, revision: await isoRevision(project, doc) };
    }
    const entry = state.entries[state.index + 1];
    const layout = layoutOf(project.cell, doc.cols, doc.rows, project.wrap);
    let dirty = [];
    if (entry.snapshot !== undefined) {
        restoreDoc(doc, entry.snapshot.after);
        dirty = Array.from({ length: doc.rows * doc.cols }, (_unused, index) => ({ r: Math.floor(index / doc.cols), c: index % doc.cols }));
    }
    else {
        const result = applyDocOps(doc, entry.redo, layout, project);
        dirty = result.dirty;
    }
    state.index++;
    scheduleDocWrite(projectId, doc);
    const dirtyChunks = dirtyChunksFor(dirty, layout);
    const haveSet = new Set(have);
    return {
        changed: dirty.length,
        skipped: [],
        dirtyChunks,
        dropKeys: dirtyChunks.filter((key) => haveSet.has(key)),
        canUndo: state.index >= 0,
        canRedo: state.index < state.entries.length - 1,
        touched: true,
        revision: await isoRevision(project, doc)
    };
}
export async function saveIsoDoc(projectId, patch) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const before = cloneIsoDoc(doc);
    const warnings = [];
    let structural = false;
    if (typeof patch.name === "string" && patch.name.trim() !== "" && patch.name.trim() !== doc.name) {
        doc.name = patch.name.trim();
        structural = true;
    }
    if (patch.cols !== undefined || patch.rows !== undefined) {
        const cols = positiveInt(patch.cols, doc.cols);
        const rows = positiveInt(patch.rows, doc.rows);
        if (cols !== doc.cols || rows !== doc.rows) {
            const result = resizeDoc(doc, cols, rows);
            warnings.push(`地图改成 ${cols}×${rows}${result.dropped > 0 ? `，丢掉 ${result.dropped} 个格子` : ""}${result.droppedObjects > 0 ? `、${result.droppedObjects} 个物件` : ""}${result.droppedMarkers > 0 ? `、${result.droppedMarkers} 个标记` : ""}。`);
            structural = true;
        }
    }
    if (Array.isArray(patch.layers)) {
        for (const item of patch.layers) {
            if (docRenameLayer(doc, item.id, item.name))
                structural = true;
        }
    }
    if (patch.addLayer !== undefined) {
        const kind = patch.addLayer.kind === "object" ? "object" : "ground";
        docAddLayer(doc, patch.addLayer.name, kind);
        structural = true;
    }
    if (patch.removeLayerId !== undefined) {
        const removed = docRemoveLayer(doc, patch.removeLayerId);
        if (removed)
            structural = true;
        else
            warnings.push("至少要留一层，不能把最后一层删掉。");
    }
    if (patch.moveLayer !== undefined) {
        if (docMoveLayer(doc, patch.moveLayer.id, patch.moveLayer.toIndex))
            structural = true;
    }
    if (patch.clearLayerId !== undefined) {
        const cleared = docClearLayer(doc, patch.clearLayerId);
        if (cleared > 0)
            structural = true;
    }
    if (structural) {
        const after = cloneIsoDoc(doc);
        doc.updatedAt = new Date().toISOString();
        pushHistory(projectId, { undo: [], redo: [], snapshot: { before, after } }, doc);
        scheduleDocWrite(projectId, doc);
        await flushIsoDoc(projectId);
    }
    return {
        doc: cloneIsoDoc(doc),
        dropped: 0,
        droppedMarkers: 0,
        droppedObjects: 0,
        warnings,
        revision: await isoRevision(await readProjectOrThrow(projectId), doc)
    };
}
export async function saveIsoProject(projectId, patch) {
    const project = await patchIsoProject(projectId, (fresh) => {
        if (typeof patch.name === "string" && patch.name.trim() !== "")
            fresh.name = patch.name.trim();
        if (typeof patch.wrap === "boolean" && patch.wrap !== fresh.wrap) {
            fresh.wrap = patch.wrap;
            appendJobLog(fresh.logs, "info", `地图环绕：${patch.wrap ? "开" : "关"}`);
        }
        return fresh;
    });
    return isoView(project);
}
// ── 一键生成 ────────────────────────────────────────────────────────────
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export async function runIsoGenerate(projectId, options) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const layout = layoutOf(project.cell, doc.cols, doc.rows, project.wrap);
    const layer = options.layerId === undefined ? doc.layers.find((entry) => entry.kind === "ground") : doc.layers.find((entry) => entry.id === options.layerId);
    if (layer === undefined || layer.kind !== "ground")
        throw new Error("一键生成只能铺在地面层");
    const tiles = (options.tiles ?? []).map((value) => Math.round(Number(value))).filter((value) => Number.isFinite(value) && value > 0);
    if (tiles.length === 0)
        throw new Error("先至少选一块地面素材：在左边点一下，再点一键生成。");
    const seed = Number.isFinite(Number(options.seed)) ? Math.round(Number(options.seed)) : 20261024;
    const rng = mulberry32(seed);
    const data = doc.data[layer.id];
    const cells = [];
    if (options.kind === "random") {
        for (let r = 0; r < doc.rows; r++)
            for (let c = 0; c < doc.cols; c++)
                cells.push({ r, c, tile: tiles[Math.floor(rng() * tiles.length)] ?? tiles[0] });
    }
    else if (options.kind === "maze") {
        if (tiles.length < 2)
            throw new Error("迷宫需要两块素材：第一块当墙、第二块当通路。");
        const wall = tiles[0];
        const floor = tiles[1];
        const maze = new Array(doc.cols * doc.rows).fill(wall);
        const visited = new Set();
        const stack = [{ r: 1, c: 1 }];
        visited.add("1,1");
        maze[1 * doc.cols + 1] = floor;
        while (stack.length > 0) {
            const at = stack[stack.length - 1];
            const dirs = [
                { dr: -2, dc: 0 },
                { dr: 2, dc: 0 },
                { dr: 0, dc: -2 },
                { dr: 0, dc: 2 }
            ].filter((dir) => {
                const nr = at.r + dir.dr;
                const nc = at.c + dir.dc;
                return nr > 0 && nc > 0 && nr < doc.rows - 1 && nc < doc.cols - 1 && !visited.has(`${nr},${nc}`);
            });
            if (dirs.length === 0) {
                stack.pop();
                continue;
            }
            const dir = dirs[Math.floor(rng() * dirs.length)];
            const nr = at.r + dir.dr;
            const nc = at.c + dir.dc;
            maze[(at.r + dir.dr / 2) * doc.cols + (at.c + dir.dc / 2)] = floor;
            maze[nr * doc.cols + nc] = floor;
            visited.add(`${nr},${nc}`);
            stack.push({ r: nr, c: nc });
        }
        for (let r = 0; r < doc.rows; r++)
            for (let c = 0; c < doc.cols; c++)
                cells.push({ r, c, tile: maze[r * doc.cols + c] ?? wall });
    }
    else {
        if (tiles.length < 4)
            throw new Error("大陆需要按顺序选 4 块素材：深水 / 浅水 / 草地 / 高地。");
        const size = 17;
        const grid = Array.from({ length: size }, () => new Array(size).fill(0));
        const corners = [
            [0, 0],
            [0, size - 1],
            [size - 1, 0],
            [size - 1, size - 1]
        ];
        const vals = [0, 0.3, 0.65, 1];
        corners.forEach(([r, c], index) => {
            grid[r][c] = vals[index] + rng() * 0.08;
        });
        const mid = Math.floor(size / 2);
        grid[mid][mid] = 0.55 + rng() * 0.1;
        for (let step = mid; step > 0; step = Math.floor(step / 2)) {
            for (let r = 0; r < size; r += step) {
                for (let c = 0; c < size; c += step) {
                    if (r % (step * 2) === 0 && c % (step * 2) === 0)
                        continue;
                    const neighbors = [];
                    if (r - step >= 0)
                        neighbors.push(grid[r - step][c]);
                    if (r + step < size)
                        neighbors.push(grid[r + step][c]);
                    if (c - step >= 0)
                        neighbors.push(grid[r][c - step]);
                    if (c + step < size)
                        neighbors.push(grid[r][c + step]);
                    if (neighbors.length === 0)
                        continue;
                    grid[r][c] = neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length + (rng() - 0.5) * 0.08;
                }
            }
            // step = 1 时「中点」落在半格上（grid[8.5] 不存在，旧代码在这里直接抛
            // TypeError）；而 step = 1 的第一段已经把每个格子插值完了，这一段本来就不需要。
            if (step < 2)
                continue;
            for (let r = 0; r < size; r += step * 2) {
                for (let c = 0; c < size; c += step * 2) {
                    if (r + step < size && c + step < size) {
                        const avg = (grid[r][c] + grid[r + step][c] + grid[r][c + step] + grid[r + step][c + step]) / 4;
                        if (r + step < size)
                            grid[r + step][c + step / 2] = avg + (rng() - 0.5) * 0.06;
                        if (c + step < size)
                            grid[r + step / 2][c + step] = avg + (rng() - 0.5) * 0.06;
                    }
                }
            }
        }
        const tileFor = (value) => {
            if (value < 0.28)
                return tiles[0];
            if (value < 0.48)
                return tiles[1];
            if (value < 0.72)
                return tiles[2];
            return tiles[3];
        };
        for (let r = 0; r < doc.rows; r++) {
            for (let c = 0; c < doc.cols; c++) {
                const sr = Math.min(size - 1, Math.floor((r / Math.max(1, doc.rows)) * size));
                const sc = Math.min(size - 1, Math.floor((c / Math.max(1, doc.cols)) * size));
                cells.push({ r, c, tile: tileFor(grid[sr][sc]) });
            }
        }
    }
    const outcome = await applyIsoOps(projectId, [{ kind: "paint", layerId: layer.id, cells }], { stroke: `generate-${seed}` });
    return { changed: outcome.changed, seed, warnings: outcome.skipped, revision: outcome.revision };
}
// ── 预览 / 导出 ─────────────────────────────────────────────────────────
const reserved = new Set();
const cancelled = new Set();
export function isoBusy(projectId) {
    return reserved.has(projectId);
}
export function cancelIsoJob(projectId) {
    cancelled.add(projectId);
}
function reserve(projectId) {
    if (reserved.has(projectId))
        return "这个项目已经有任务在跑了，等它跑完再提交。";
    reserved.add(projectId);
    return undefined;
}
async function background(projectId, stage, run) {
    cancelled.delete(projectId);
    await patchIsoProject(projectId, (project) => {
        project.stages[stage] = { status: "running", at: new Date().toISOString() };
    }).catch(() => undefined);
    try {
        await run();
        await patchIsoProject(projectId, (project) => {
            if (project.stages[stage].status === "running")
                project.stages[stage] = { status: "done", at: new Date().toISOString(), approved: project.stages[stage].approved };
        });
    }
    catch (error) {
        const message = messageOf(error);
        await patchIsoProject(projectId, (project) => {
            project.stages[stage] = { status: "error", error: message, at: new Date().toISOString() };
            appendJobLog(project.logs, "error", `${stage === "paint" ? "预览" : "导出"}失败：${message}`);
        }).catch(() => undefined);
    }
    finally {
        reserved.delete(projectId);
    }
}
async function decodeTilesetsForProject(project) {
    const lookup = new Map();
    for (const tileset of project.tilesets) {
        if (tileset.file === "")
            continue;
        try {
            lookup.set(tileset.id, await decodeFile(isoAssetPath(project.id, tileset.file)));
        }
        catch {
            /* 缺图按透明跳过，rasterize 会报警 */
        }
    }
    return lookup;
}
export async function runIsoPreview(projectId) {
    const reason = reserve(projectId);
    if (reason !== undefined)
        return { started: false, reason };
    let project;
    try {
        project = await readProjectOrThrow(projectId);
    }
    catch (error) {
        reserved.delete(projectId);
        throw error;
    }
    const previewPath = join(isoProjectDir(projectId), "preview", "map.png");
    if (project.tilesets.length === 0) {
        reserved.delete(projectId);
        return { started: false, reason: "还没有素材。", previewPath };
    }
    const revisionAtStart = await isoRevision(project, await theDocOrFresh(projectId));
    void background(projectId, "paint", async () => {
        const fresh = await readProjectOrThrow(projectId);
        const doc = await theDocOrFresh(projectId);
        await flushIsoDoc(projectId);
        if (cancelled.has(projectId))
            return;
        const bitmaps = await decodeTilesetsForProject(fresh);
        const raster = rasterizeIso(isoRenderContext(fresh, doc, fresh.tilesets), doc, bitmaps, { scale: 1 });
        const previewDir = join(isoProjectDir(projectId), "preview");
        await mkdir(previewDir, { recursive: true });
        await writeFile(join(previewDir, "map.png"), isoBitmapToPng(raster.bitmap));
        await patchIsoProject(projectId, (current) => {
            appendJobLog(current.logs, "info", `生成地图预览图：preview/map.png（${doc.cols}×${doc.rows}，${raster.bitmap.width}×${raster.bitmap.height} 像素）`);
            if (raster.drawn === 0)
                appendJobLog(current.logs, "warn", "地图还是空的：预览图是全透明的，先画点东西再看大图。");
            for (const warning of raster.warnings)
                appendJobLog(current.logs, "warn", `预览告警：${warning}`);
        });
    });
    return { started: true, previewPath, revisionAtStart };
}
async function pruneAgentRenders(projectId, keep = 20) {
    const dir = join(isoProjectDir(projectId), "preview", "agent");
    let names;
    try {
        names = (await readdir(dir)).filter((name) => name.endsWith(".png"));
    }
    catch {
        return;
    }
    if (names.length <= keep)
        return;
    const entries = await Promise.all(names.map(async (name) => {
        try {
            return { name, mtime: (await stat(join(dir, name))).mtimeMs };
        }
        catch {
            return { name, mtime: 0 };
        }
    }));
    entries.sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(keep))
        await rm(join(dir, entry.name), { force: true }).catch(() => undefined);
}
/** 同步渲染一块 45° 地图区域；与导出共用 `buildIsoPlan` 和同一个 z 排序。 */
export async function runIsoRender(projectId, options = {}) {
    const startedAt = Date.now();
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const revisionAtStart = await isoRevision(project, doc);
    const region = isoInspectRegion(options.region, doc);
    const layerIndexes = options.layerIds === undefined
        ? undefined
        : options.layerIds
            .map((id) => doc.layers.findIndex((layer) => layer.id === id))
            .filter((index) => index >= 0);
    const context = isoRenderContext(project, doc, project.tilesets);
    const lookup = await decodeTilesetsForProject(project);
    const passCells = options.overlay?.pass === true ? passCellsOf(context, doc) : undefined;
    const rendered = renderIsoView(context, doc, lookup, {
        range: { r0: region.r0, c0: region.c0, r1: region.r1, c1: region.c1 },
        scale: options.scale,
        layers: layerIndexes,
        frame: options.frame,
        background: options.background,
        overlay: options.overlay,
        passCells,
        maxPixels: options.maxPixels
    });
    const dir = join(isoProjectDir(projectId), "preview", "agent");
    await mkdir(dir, { recursive: true });
    const safe = (options.name ?? "inspect").replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "inspect";
    const optionsHash = createHash("sha1")
        .update(JSON.stringify({ region, scale: rendered.scale, layerIndexes, frame: options.frame ?? 0, background: options.background ?? "transparent", overlay: options.overlay ?? {} }))
        .digest("hex")
        .slice(0, 8);
    const file = `preview/agent/${safe}-${revisionAtStart}-${optionsHash}.png`;
    const localPath = join(isoProjectDir(projectId), file);
    await writeFile(localPath, isoBitmapToPng(rendered.bitmap));
    await pruneAgentRenders(projectId);
    const revision = await isoRevision(project, doc);
    return {
        module: "iso",
        projectId,
        revision,
        revisionAtStart,
        stale: revision !== revisionAtStart,
        file,
        localPath,
        url: `${originForLinks()}${isoAssetBase(projectId)}${file}`,
        width: rendered.bitmap.width,
        height: rendered.bitmap.height,
        crop: rendered.crop,
        scale: rendered.scale,
        range: rendered.range,
        drawn: rendered.drawn,
        markersDrawn: rendered.markersDrawn,
        warnings: rendered.warnings,
        elapsedMs: Date.now() - startedAt
    };
}
export function isoExportDirName(doc, project) {
    const name = doc?.name ?? project.name;
    const safe = name.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
    return safe === "" ? project.id : safe;
}
export function isoExportDir(projectId, doc, project) {
    return join(isoProjectDir(projectId), "export", isoExportDirName(doc, project));
}
async function readExportListingRelative(project) {
    const doc = await readTheDoc(project.id);
    if (doc === undefined)
        return undefined;
    const dir = isoExportDir(project.id, doc, project);
    try {
        const names = await readdir(dir);
        return { base: `export/${isoExportDirName(doc, project)}/`, files: names.sort(), warnings: [] };
    }
    catch {
        return undefined;
    }
}
async function readPreviewFiles(projectId) {
    try {
        const names = await readdir(join(isoProjectDir(projectId), "preview"));
        return names.filter((name) => name.endsWith(".png")).sort();
    }
    catch {
        return [];
    }
}
export async function runIsoExport(projectId, options = {}) {
    const reason = reserve(projectId);
    if (reason !== undefined)
        return { started: false, reason };
    let project;
    try {
        project = await readProjectOrThrow(projectId);
    }
    catch (error) {
        reserved.delete(projectId);
        throw error;
    }
    void background(projectId, "export", async () => {
        const fresh = await readProjectOrThrow(projectId);
        const doc = await theDocOrFresh(projectId);
        await flushIsoDoc(projectId);
        if (cancelled.has(projectId))
            return;
        const dir = isoExportDir(projectId, doc, fresh);
        const manifest = await exportIsoMap({
            project: { id: fresh.id, name: fresh.name },
            doc,
            context: isoRenderContext(fresh, doc, fresh.tilesets),
            dir,
            formats: { ...options.formats, scale: options.scale },
            tilesetPath: (file) => isoAssetPath(projectId, file)
        });
        await patchIsoProject(projectId, (current) => {
            appendJobLog(current.logs, "info", `导出完成：${dir}（${manifest.files.length} 个文件）`);
            for (const warning of manifest.warnings)
                appendJobLog(current.logs, "warn", `导出告警：${warning}`);
        });
    });
    return { started: true };
}
export async function isoRevealDir(projectId, target = "project") {
    const project = await readProjectOrThrow(projectId);
    if (target === "export") {
        const doc = await readTheDoc(projectId);
        const dir = isoExportDir(projectId, doc, project);
        try {
            await stat(dir);
            return dir;
        }
        catch {
            return isoProjectDir(projectId);
        }
    }
    return isoProjectDir(projectId);
}
function absoluteIsoAssetUrl(projectId, origin, relative) {
    return `${origin}${assetBasePath(`/dsh-game-material-master/iso-assets/${projectId}/`)}${relative}`;
}
export async function isoSnapshot(project, origin) {
    const view = await isoView(project);
    const doc = await theDocOrFresh(project.id);
    const listing = await readExportListingRelative(project);
    const preview = view.preview;
    const nextActions = [];
    if (view.tilesets.length === 0)
        nextActions.push({ step: "assets", why: "还没有素材：importIsoTileset 传图片 base64，或者 importIsoSampleTileset 装内置素材（免费）。" });
    if (view.filled === 0)
        nextActions.push({ step: "paint", why: "地图还是空的：runIsoGenerate 一键铺，或者 applyIsoOps 直接画。" });
    else if (listing === undefined)
        nextActions.push({ step: "export", why: "还没导出过：runIsoExport 出 map.png + map.json（本地免费）。" });
    if (nextActions.length === 0)
        nextActions.push({ step: "done", why: "素材、地图、导出都有产物了。可以继续改地图，或 runIsoPreview 重新出验收图。" });
    return {
        ...view,
        projection: "isometric-2:1",
        assetBase: `${origin}${isoAssetBase(project.id)}`,
        tilesets: view.tilesets.map((tileset) => ({ ...tileset, url: absoluteIsoAssetUrl(project.id, origin, tileset.file) })),
        stages: ISO_STAGES.map((stage) => {
            const node = view.stages[stage];
            return { stage, status: node?.status ?? "idle", approved: node?.approved, error: node?.error, at: node?.at };
        }),
        previewUrls: preview.map((relative) => absoluteIsoAssetUrl(project.id, origin, relative)),
        exportBaseUrl: listing === undefined ? "" : absoluteIsoAssetUrl(project.id, origin, listing.base),
        exportWarnings: listing?.warnings ?? [],
        nextActions,
        exportPath: listing === undefined ? "" : isoExportDir(project.id, doc, project),
        exportFiles: listing?.files ?? []
    };
}
/** 给工具面 / 自检用的类型出口。 */
export { MAX_ISO_DIM, MAX_ISO_PLAN_CHUNKS, MAX_ASSET_SCALE, DEFAULT_ISO_CELL };
