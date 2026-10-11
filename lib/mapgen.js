/**
 * 地图编辑器（模块六）的**数据层与作业**：项目 / 图集 / 族 / 地图文档 / 导出。
 *
 * ## 落盘布局
 *
 * ```
 * <DSH_HOME>/game-material-master/map-jobs/<项目 id>/
 * ├── project.json          元数据：网格、图集、族、地图清单、阶段、日志
 * ├── maps/<mapId>.json     单张地图：图层元数据 + 每层数据（0 = 空）
 * ├── tilesets/<tsId>.<ext> 导入的原图（原样保存，不改写）
 * ├── preview/*.png         验收图：切片 contact sheet、掩码覆盖矩阵、地图渲染图
 * └── export/<mapId>/       导出：map.png / layer-*.png / map.tmj / *.tsj / *.png
 * ```
 *
 * ## 编辑路径（与旧模块最大的不同）
 *
 * 界面**不发整份文档**，只发 op；宿主是唯一写者：
 * `applyMapOps` → 改内存里的文档 → 回传脏 chunk 的计划补丁 → 防抖落盘。
 * 落盘是「最多 2 秒一次 + 停了 500ms 再补一次」，所以拖动时不会每笔都重写整个
 * 地图文件；进程被杀最多丢 2 秒的编辑（写入本身仍是原子的）。
 *
 * 撤销 / 重做是宿主侧**逆操作日志**（结构操作才存整份快照），因此界面不需要
 * 自己维护撤销栈 —— 旧模块那个「整份草稿 + 客户端撤销栈」正是「撤销跳步」的来源。
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendJobLog, messageOf, readJson, sweepTempFiles, writeJsonAtomic } from "./jsonio.js";
import { dataRoot } from "./config.js";
import { decodeFile, pngSize, probeImageSize, sniffImageExt } from "./bitmap.js";
import { encodePng } from "./png.js";
import { addLayer, applyOps, cloneDoc, createMapDoc, filledCount, isDocEmpty, moveLayer, normalizeMapDoc, removeLayer, resizeDoc, revertOps, usedTileIndices } from "./mapdoc.js";
import { assertGrid, dirtyChunksFor, normalizeGrid, pointToCell, layoutOf, chunksCovering, chunkKey, parseChunkKey, allChunks, MAX_MAP_DIM } from "./mapgeom.js";
import { buildPlan, buildChunk, contactSheet, coverageMatrix, planBounds, rasterize } from "./maprender.js";
import { coverageReport, expectedMasks, isAutotileScheme } from "./mapauto.js";
import { buildTiles, duplicateRects, flatTiles, mergeTileMeta, normalizeSlice, suggestGrids, tilesetPreview } from "./maptiles.js";
import { exportMap, safeFileName } from "./mapexport.js";
export const MAP_STAGES = ["assets", "rules", "paint", "export"];
// ── 路径与 id ─────────────────────────────────────────────────────────────
export function mapJobsRoot() {
    return join(dataRoot(), "map-jobs");
}
export function mapProjectDir(id) {
    return join(mapJobsRoot(), id);
}
export function mapProjectFile(id) {
    return join(mapProjectDir(id), "project.json");
}
export function mapDocFile(id, mapId) {
    return join(mapProjectDir(id), "maps", `${mapId}.json`);
}
/** 项目内的相对路径 → 绝对路径（挡住目录穿越）。 */
export function mapAssetPath(id, relative) {
    const base = mapProjectDir(id);
    const target = join(base, relative);
    if (!target.startsWith(base))
        throw new Error(`非法的项目内路径：${relative}`);
    return target;
}
/** `m` 前缀，避免与 p / i / s / r / t 撞。 */
export function isValidMapProjectId(id) {
    return /^m[a-z0-9]{4,40}$/.test(id);
}
/** 子目录白名单（静态资源路由按**第一段**比对，漏一条就是 403 + 图裂）。 */
export const SERVABLE_MAP_DIRS = new Set(["tilesets", "maps", "preview", "export"]);
function freshStages() {
    return { assets: { status: "idle" }, rules: { status: "idle" }, paint: { status: "idle" }, export: { status: "idle" } };
}
function defaultFamilies() {
    return [];
}
// ── 读写（带写队列）──────────────────────────────────────────────────────
const projectWriteQueue = new Map();
function enqueueWrite(key, task) {
    const previous = projectWriteQueue.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    projectWriteQueue.set(key, next.catch(() => undefined));
    return next;
}
export async function writeMapProject(project) {
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(mapProjectFile(project.id), project);
}
export async function patchMapProject(id, mutator) {
    return enqueueWrite(id, async () => {
        const project = await readMapProject(id);
        if (project === undefined)
            throw new Error(`项目不存在：${id}`);
        const result = mutator(project);
        await writeMapProject(project);
        return result;
    });
}
export async function createMapProject(name, options = {}) {
    const grid = normalizeGrid(options.grid);
    assertGrid(grid);
    const id = `m${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = {
        id,
        name: name.trim() === "" ? "未命名地图项目" : name.trim(),
        createdAt: now,
        updatedAt: now,
        grid,
        tilesets: [],
        families: defaultFamilies(),
        mapIds: [],
        stages: freshStages(),
        logs: []
    };
    await mkdir(mapProjectDir(id), { recursive: true });
    for (const sub of ["tilesets", "maps", "preview", "export"])
        await mkdir(join(mapProjectDir(id), sub), { recursive: true });
    appendJobLog(project.logs, "info", `新建地图项目：${project.name}`);
    // 顺手建一张 32×32 的空地图，用户导入图集后就能直接画
    const doc = createMapDoc(newMapId(), "地图 1", 32, 32);
    project.mapIds.push(doc.id);
    project.activeMapId = doc.id;
    await writeMapDoc(project.id, doc);
    await writeMapProject(project);
    return project;
}
export async function readMapProject(id) {
    const raw = await readJson(mapProjectFile(id));
    if (raw === undefined || typeof raw !== "object")
        return undefined;
    void sweepTempFiles(mapProjectDir(id));
    const project = {
        ...raw,
        grid: normalizeGrid(raw.grid),
        tilesets: Array.isArray(raw.tilesets) ? raw.tilesets.map(normalizeTileset) : [],
        families: Array.isArray(raw.families) ? raw.families.map(normalizeFamily) : [],
        mapIds: Array.isArray(raw.mapIds) ? raw.mapIds.filter((item) => typeof item === "string") : [],
        stages: { ...freshStages(), ...(raw.stages ?? {}) },
        logs: Array.isArray(raw.logs) ? raw.logs : []
    };
    return project;
}
function normalizeTileset(raw) {
    const imageWidth = Math.max(1, Math.round(Number(raw?.imageWidth) || 1));
    const imageHeight = Math.max(1, Math.round(Number(raw?.imageHeight) || 1));
    const slice = normalizeSlice(raw?.slice, imageWidth, imageHeight);
    return {
        id: typeof raw?.id === "string" ? raw.id : `ts${randomUUID().slice(0, 6)}`,
        name: typeof raw?.name === "string" && raw.name !== "" ? raw.name : "图集",
        file: typeof raw?.file === "string" ? raw.file : "",
        imageWidth,
        imageHeight,
        slice,
        tiles: Array.isArray(raw?.tiles) ? raw.tiles.map(normalizeTile) : []
    };
}
function normalizeTile(raw) {
    return {
        id: typeof raw?.id === "string" ? raw.id : `t${Math.round(Number(raw?.rect?.x) || 0)}_${Math.round(Number(raw?.rect?.y) || 0)}`,
        rect: {
            x: Math.max(0, Math.round(Number(raw?.rect?.x) || 0)),
            y: Math.max(0, Math.round(Number(raw?.rect?.y) || 0)),
            width: Math.max(1, Math.round(Number(raw?.rect?.width) || 1)),
            height: Math.max(1, Math.round(Number(raw?.rect?.height) || 1))
        },
        name: typeof raw?.name === "string" ? raw.name : "",
        familyId: typeof raw?.familyId === "string" && raw.familyId !== "" ? raw.familyId : undefined,
        mask: Number.isFinite(Number(raw?.mask)) ? Math.round(Number(raw.mask)) : undefined,
        weight: Number.isFinite(Number(raw?.weight)) ? Number(raw.weight) : undefined,
        tags: Array.isArray(raw?.tags) ? raw.tags : undefined,
        solid: typeof raw?.solid === "boolean" ? raw.solid : undefined,
        anchorX: Number.isFinite(Number(raw?.anchorX)) ? Number(raw.anchorX) : undefined,
        anchorY: Number.isFinite(Number(raw?.anchorY)) ? Number(raw.anchorY) : undefined
    };
}
function normalizeFamily(raw, index) {
    return {
        id: typeof raw?.id === "string" && raw.id !== "" ? raw.id : `f${index}`,
        name: typeof raw?.name === "string" && raw.name !== "" ? raw.name : `族 ${index + 1}`,
        autotile: isAutotileScheme(raw?.autotile) ? raw.autotile : "single",
        priority: Number.isFinite(Number(raw?.priority)) ? Number(raw.priority) : index,
        edgeMode: raw?.edgeMode === "different" ? "different" : "same",
        color: typeof raw?.color === "string" ? raw.color : undefined
    };
}
export async function listMapProjects() {
    let names = [];
    try {
        names = await readdir(mapJobsRoot());
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        if (!isValidMapProjectId(name))
            continue;
        const project = await readMapProject(name);
        if (project === undefined)
            continue;
        out.push(await summarizeMapProject(project));
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
export async function summarizeMapProject(project) {
    return {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        grid: project.grid,
        tilesetCount: project.tilesets.length,
        tileCount: flatTiles(project.tilesets).length,
        familyCount: project.families.length,
        mapCount: project.mapIds.length,
        stages: project.stages
    };
}
export async function deleteMapProject(id) {
    docCache.clear();
    const prefix = `${id}/`;
    for (const key of [...history.keys()])
        if (key.startsWith(prefix))
            history.delete(key);
    await rm(mapProjectDir(id), { recursive: true, force: true });
}
// ── 地图文档：内存真源 + 防抖落盘 ─────────────────────────────────────────
/** `项目id/地图id` → 文档。编辑期间这是**权威副本**，磁盘是它的稳态快照。 */
const docCache = new Map();
const docWrites = new Map();
/** 上一笔编辑距今超过它就直接写盘（保证「最多丢 2 秒」）。 */
const WRITE_MAX_LATENCY_MS = 2000;
const WRITE_IDLE_MS = 500;
function docKey(projectId, mapId) {
    return `${projectId}/${mapId}`;
}
export function newMapId() {
    return `md${Date.now().toString(36)}${randomUUID().slice(0, 5)}`;
}
export async function readMapDoc(projectId, mapId) {
    const key = docKey(projectId, mapId);
    const cached = docCache.get(key);
    if (cached !== undefined)
        return cached;
    const raw = await readJson(mapDocFile(projectId, mapId));
    const doc = normalizeMapDoc(raw, mapId);
    if (doc === undefined)
        return undefined;
    docCache.set(key, doc);
    return doc;
}
export async function writeMapDoc(projectId, doc) {
    await enqueueWrite(docKey(projectId, doc.id), async () => {
        await writeJsonAtomic(mapDocFile(projectId, doc.id), doc);
    });
}
/**
 * 防抖落盘：**最多 2 秒延迟 + 停笔 500ms 补齐**。
 *
 * 每笔都写的话，拖动笔刷时每 60ms 就要把整张地图（最大 512×512×4 层）序列化一遍，
 * 界面会明显发涩；完全不防抖又会丢编辑。这个窗口是两者的折中。
 */
function scheduleDocWrite(projectId, doc) {
    const key = docKey(projectId, doc.id);
    const state = docWrites.get(key) ?? { timer: null, lastWrite: 0, writing: false, pending: false };
    docWrites.set(key, state);
    const now = Date.now();
    const elapsed = now - state.lastWrite;
    if (elapsed >= WRITE_MAX_LATENCY_MS) {
        state.lastWrite = now;
        void writeMapDoc(projectId, doc);
        return;
    }
    state.pending = true;
    if (state.timer !== null)
        return;
    state.timer = setTimeout(() => {
        state.timer = null;
        state.lastWrite = Date.now();
        state.pending = false;
        void writeMapDoc(projectId, doc);
    }, Math.max(WRITE_IDLE_MS, WRITE_MAX_LATENCY_MS - elapsed));
    if (typeof state.timer.unref === "function")
        state.timer.unref();
}
/** 立刻落盘（导出前、删项目前、验收前调用）。 */
export async function flushMapDoc(projectId, mapId) {
    const doc = docCache.get(docKey(projectId, mapId));
    if (doc === undefined)
        return;
    const state = docWrites.get(docKey(projectId, mapId));
    if (state?.timer != null) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    await writeMapDoc(projectId, doc);
}
export async function discardCachedDoc(projectId, mapId) {
    const key = docKey(projectId, mapId);
    const state = docWrites.get(key);
    if (state?.timer != null) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    docWrites.delete(key);
    docCache.delete(key);
}
export async function listMapDocs(project) {
    const out = [];
    for (const mapId of project.mapIds) {
        const doc = await readMapDoc(project.id, mapId);
        if (doc !== undefined)
            out.push(doc);
    }
    return out;
}
const history = new Map();
const HISTORY_MAX_ENTRIES = 200;
const HISTORY_MAX_BYTES = 32 * 1024 * 1024;
function estimateEntryBytes(entry, doc) {
    if (entry.snapshot !== undefined)
        return doc.cols * doc.rows * (doc.layers.length + 1) * 4;
    return (entry.redo.length + entry.undo.length) * 32;
}
function pushHistory(projectId, mapId, entry, doc) {
    const key = docKey(projectId, mapId);
    const state = history.get(key) ?? { entries: [], index: -1, bytes: 0 };
    // 撤销之后又画了新东西：把「未来」截断
    if (state.index < state.entries.length - 1) {
        for (const dropped of state.entries.slice(state.index + 1))
            state.bytes -= estimateEntryBytes(dropped, doc);
        state.entries = state.entries.slice(0, state.index + 1);
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
    history.set(key, state);
}
export function historyState(projectId, mapId) {
    const state = history.get(docKey(projectId, mapId));
    if (state === undefined)
        return { canUndo: false, canRedo: false, depth: 0 };
    return { canUndo: state.index >= 0, canRedo: state.index < state.entries.length - 1, depth: state.entries.length };
}
function restoreDoc(target, snapshot) {
    target.cols = snapshot.cols;
    target.rows = snapshot.rows;
    target.layers = snapshot.layers.map((layer) => ({ ...layer }));
    target.data = Object.fromEntries(Object.entries(snapshot.data).map(([key, value]) => [key, [...value]]));
    target.variantSeed = snapshot.variantSeed;
    target.randomVariants = snapshot.randomVariants;
    target.name = snapshot.name;
    target.updatedAt = new Date().toISOString();
}
// ── 渲染上下文 ────────────────────────────────────────────────────────────
export function renderContext(project) {
    return { grid: project.grid, tilesets: project.tilesets, families: project.families };
}
/** 编辑版本号：每次改动 +1，界面据此判断补丁是不是新的。 */
const revisions = new Map();
export function docRevision(projectId, mapId) {
    return revisions.get(docKey(projectId, mapId)) ?? 0;
}
/**
 * 应用一批编辑 op（界面拖动时按 ~60ms 批量提交）。
 *
 * 返回**脏 chunk 的计划补丁**：界面拿它替换自己缓存的 chunk 即可，不需要
 * 自己算「这一笔影响了哪几格的过渡块」—— 那是宿主的知识。
 */
export async function applyMapOps(projectId, mapId, ops) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const doc = await readMapDoc(projectId, mapId);
    if (doc === undefined)
        throw new Error(`地图不存在：${mapId}`);
    const result = applyOps(doc, ops);
    const key = docKey(projectId, mapId);
    const changedCells = result.changed.map((index) => ({ r: Math.floor(index / doc.cols), c: index % doc.cols }));
    const dirtyChunks = dirtyChunksFor(changedCells, doc.cols, doc.rows);
    if (result.changed.length > 0) {
        revisions.set(key, (revisions.get(key) ?? 0) + 1);
        pushHistory(projectId, mapId, { undo: result.undo, redo: ops }, doc);
        scheduleDocWrite(projectId, doc);
    }
    const context = renderContext(project);
    const patches = dirtyChunks.map((chunk) => buildChunk(context, doc, chunk));
    const state = historyState(projectId, mapId);
    return {
        rev: docRevision(projectId, mapId),
        changed: result.changed.length,
        skipped: result.skipped,
        dirtyChunks,
        patches,
        canUndo: state.canUndo,
        canRedo: state.canRedo
    };
}
export async function undoMap(projectId, mapId) {
    const state = history.get(docKey(projectId, mapId));
    if (state === undefined || state.index < 0)
        return undefined;
    const project = await readMapProject(projectId);
    const doc = await readMapDoc(projectId, mapId);
    if (project === undefined || doc === undefined)
        return undefined;
    const entry = state.entries[state.index];
    let changedCells = [];
    if (entry.snapshot !== undefined) {
        restoreDoc(doc, entry.snapshot.before);
        changedCells = allCells(doc);
    }
    else {
        // 逆操作理论上一定能应用（顺序是 LIFO），但栈被容量上限裁剪过之后可能对不上：
        // 这时**放弃这一步撤销**比抛异常好 —— 界面里抛就是「点了撤销整个面板报错」。
        let changed;
        try {
            changed = revertOps(doc, entry.undo);
        }
        catch {
            return undefined;
        }
        changedCells = changed.map((index) => ({ r: Math.floor(index / doc.cols), c: index % doc.cols }));
    }
    state.index--;
    revisions.set(docKey(projectId, mapId), (revisions.get(docKey(projectId, mapId)) ?? 0) + 1);
    scheduleDocWrite(projectId, doc);
    const dirtyChunks = dirtyChunksFor(changedCells, doc.cols, doc.rows);
    const context = renderContext(project);
    return {
        rev: docRevision(projectId, mapId),
        changed: changedCells.length,
        skipped: [],
        dirtyChunks,
        patches: dirtyChunks.map((chunk) => buildChunk(context, doc, chunk)),
        canUndo: state.index >= 0,
        canRedo: state.index < state.entries.length - 1
    };
}
export async function redoMap(projectId, mapId) {
    const state = history.get(docKey(projectId, mapId));
    if (state === undefined || state.index >= state.entries.length - 1)
        return undefined;
    const project = await readMapProject(projectId);
    const doc = await readMapDoc(projectId, mapId);
    if (project === undefined || doc === undefined)
        return undefined;
    const entry = state.entries[state.index + 1];
    let changedCells = [];
    if (entry.snapshot !== undefined) {
        restoreDoc(doc, entry.snapshot.after);
        changedCells = allCells(doc);
    }
    else {
        let changed;
        try {
            changed = revertOps(doc, entry.redo);
        }
        catch {
            return undefined;
        }
        changedCells = changed.map((index) => ({ r: Math.floor(index / doc.cols), c: index % doc.cols }));
    }
    state.index++;
    revisions.set(docKey(projectId, mapId), (revisions.get(docKey(projectId, mapId)) ?? 0) + 1);
    scheduleDocWrite(projectId, doc);
    const dirtyChunks = dirtyChunksFor(changedCells, doc.cols, doc.rows);
    const context = renderContext(project);
    return {
        rev: docRevision(projectId, mapId),
        changed: changedCells.length,
        skipped: [],
        dirtyChunks,
        patches: dirtyChunks.map((chunk) => buildChunk(context, doc, chunk)),
        canUndo: state.index >= 0,
        canRedo: state.index < state.entries.length - 1
    };
}
function allCells(doc) {
    const out = [];
    for (let r = 0; r < doc.rows; r++)
        for (let c = 0; c < doc.cols; c++)
            out.push({ r, c });
    return out;
}
export async function saveMapDocStructure(projectId, mapId, patch) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const doc = await readMapDoc(projectId, mapId);
    if (doc === undefined)
        throw new Error(`地图不存在：${mapId}`);
    const before = cloneDoc(doc);
    const warnings = [];
    if (typeof patch.name === "string" && patch.name !== "")
        doc.name = patch.name;
    if (Number.isFinite(patch.variantSeed))
        doc.variantSeed = Math.round(Number(patch.variantSeed));
    if (typeof patch.randomVariants === "boolean")
        doc.randomVariants = patch.randomVariants;
    for (const layerPatch of patch.layers ?? []) {
        const layer = doc.layers.find((item) => item.id === layerPatch.id);
        if (layer === undefined)
            continue;
        if (typeof layerPatch.name === "string" && layerPatch.name !== "")
            layer.name = layerPatch.name;
        if (Number.isFinite(layerPatch.heightOffset))
            layer.heightOffset = Number(layerPatch.heightOffset);
        if (Number.isFinite(layerPatch.opacity))
            layer.opacity = Math.min(1, Math.max(0, Number(layerPatch.opacity)));
        if (typeof layerPatch.visible === "boolean")
            layer.visible = layerPatch.visible;
        if (typeof layerPatch.locked === "boolean")
            layer.locked = layerPatch.locked;
        if ("baseFamilyId" in layerPatch) {
            layer.baseFamilyId = typeof layerPatch.baseFamilyId === "string" && layerPatch.baseFamilyId !== "" ? layerPatch.baseFamilyId : undefined;
        }
    }
    if (patch.addLayer !== undefined)
        addLayer(doc, patch.addLayer.kind ?? "ground", patch.addLayer.name);
    if (typeof patch.removeLayerId === "string" && !removeLayer(doc, patch.removeLayerId)) {
        warnings.push("至少要留一个图层，最后一个删不掉。");
    }
    if (patch.moveLayer !== undefined)
        moveLayer(doc, patch.moveLayer.id, patch.moveLayer.toIndex);
    let dropped = 0;
    if (Number.isFinite(patch.cols) || Number.isFinite(patch.rows)) {
        const cols = Number.isFinite(patch.cols) ? Math.round(Number(patch.cols)) : doc.cols;
        const rows = Number.isFinite(patch.rows) ? Math.round(Number(patch.rows)) : doc.rows;
        const result = resizeDoc(doc, Math.min(MAX_MAP_DIM, Math.max(1, cols)), Math.min(MAX_MAP_DIM, Math.max(1, rows)));
        dropped = result.dropped;
        if (dropped > 0)
            warnings.push(`缩小地图丢掉了 ${dropped} 个已画的格子（可以撤销）。`);
    }
    const after = cloneDoc(doc);
    doc.updatedAt = new Date().toISOString();
    pushHistory(projectId, mapId, { undo: [], redo: [], snapshot: { before, after } }, doc);
    revisions.set(docKey(projectId, mapId), (revisions.get(docKey(projectId, mapId)) ?? 0) + 1);
    await writeMapDoc(projectId, doc);
    return { doc, dropped, warnings };
}
export async function createMapDocFor(projectId, name, cols = 32, rows = 32) {
    const doc = createMapDoc(newMapId(), name.trim() === "" ? "新地图" : name.trim(), cols, rows);
    await patchMapProject(projectId, (project) => {
        project.mapIds.push(doc.id);
        project.activeMapId = doc.id;
        appendJobLog(project.logs, "info", `新地图：${doc.name}（${cols}×${rows}）`);
    });
    await writeMapDoc(projectId, doc);
    docCache.set(docKey(projectId, doc.id), doc);
    return doc;
}
export async function duplicateMapDocFor(projectId, mapId) {
    const source = await readMapDoc(projectId, mapId);
    if (source === undefined)
        throw new Error(`地图不存在：${mapId}`);
    const copy = cloneDoc(source);
    copy.id = newMapId();
    copy.name = `${source.name} 副本`;
    copy.createdAt = new Date().toISOString();
    await patchMapProject(projectId, (project) => {
        project.mapIds.push(copy.id);
        project.activeMapId = copy.id;
    });
    await writeMapDoc(projectId, copy);
    docCache.set(docKey(projectId, copy.id), copy);
    return copy;
}
export async function deleteMapDocFor(projectId, mapId) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (project.mapIds.length <= 1)
        throw new Error("至少要留一张地图。");
    await patchMapProject(projectId, (fresh) => {
        fresh.mapIds = fresh.mapIds.filter((id) => id !== mapId);
        if (fresh.activeMapId === mapId)
            fresh.activeMapId = fresh.mapIds[0];
    });
    await discardCachedDoc(projectId, mapId);
    history.delete(docKey(projectId, mapId));
    revisions.delete(docKey(projectId, mapId));
    await rm(mapDocFile(projectId, mapId), { force: true });
}
export async function importMapTileset(projectId, name, base64) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (base64.trim() === "")
        throw new Error("图片内容为空。");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0)
        throw new Error("图片内容为空。");
    const ext = sniffImageExt(bytes);
    const id = `ts${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
    const relative = `tilesets/${id}.${ext}`;
    await mkdir(join(mapProjectDir(projectId), "tilesets"), { recursive: true });
    // 写原图（不改写：切分参数随便调，随时能重切）
    await writeFile(mapAssetPath(projectId, relative), bytes);
    const size = await probeSize(mapAssetPath(projectId, relative), bytes);
    const suggestions = suggestGrids(size.width, size.height);
    const initial = suggestions.find((item) => item.tileWidth === project.grid.tileWidth && item.tileHeight === project.grid.tileHeight) ?? suggestions[0] ?? { tileWidth: Math.min(32, size.width), tileHeight: Math.min(32, size.height) };
    const slice = normalizeSlice({ mode: "grid", tileWidth: initial.tileWidth, tileHeight: initial.tileHeight }, size.width, size.height);
    const { tiles, result } = buildTiles(slice, size.width, size.height, []);
    const tileset = { id, name: name.trim() === "" ? `图集 ${project.tilesets.length + 1}` : name.trim(), file: relative, imageWidth: size.width, imageHeight: size.height, slice, tiles };
    await patchMapProject(projectId, (fresh) => {
        fresh.tilesets.push(tileset);
        fresh.stages.assets = { status: "done", at: new Date().toISOString(), approved: fresh.stages.assets.approved };
        appendJobLog(fresh.logs, "info", `导入图集：${tileset.name}（${size.width}×${size.height} → ${tiles.length} 块）`);
    });
    const warnings = [...result.warnings];
    if (suggestions.length === 0)
        warnings.push("这张图的尺寸不是常见瓦片尺寸的整数倍，请手动填切分参数。");
    return { tileset, slice, suggestions, warnings, duplicates: duplicateRects([tileset]).map((item) => ({ tileIds: item.tileIds, rect: item.rect })) };
}
async function probeSize(file, bytes) {
    const fromHeader = pngSize(bytes);
    if (fromHeader !== undefined)
        return fromHeader;
    return probeImageSize(file);
}
/**
 * 改图集（名称 / 切分 / 图块元数据）。
 *
 * ⚠️ 改了切分，图块序号可能整体平移 —— 地图里存的是序号，**必须按
 * 「图集 id + 图块 id」把每张地图的格子重新映射**，否则会出现「明明画了却
 * 变成透明洞」：序号指向了别的块（甚至是别的图集的块）。这里先记下改之前的
 * 序号表，改完再按新的表平移，找不到对应图块的格子清零并计数。
 */
export async function saveMapTileset(projectId, tilesetId, patch) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const warnings = [];
    const beforeKeys = indexKeys(project.tilesets);
    let updated;
    await patchMapProject(projectId, (fresh) => {
        const tileset = fresh.tilesets.find((item) => item.id === tilesetId);
        if (tileset === undefined)
            throw new Error(`图集不存在：${tilesetId}`);
        if (typeof patch.name === "string" && patch.name !== "")
            tileset.name = patch.name;
        if (patch.slice !== undefined) {
            const previousIds = new Set(tileset.tiles.map((tile) => tile.id));
            const slice = normalizeSlice(patch.slice, tileset.imageWidth, tileset.imageHeight);
            const { tiles, result } = buildTiles(slice, tileset.imageWidth, tileset.imageHeight, tileset.tiles);
            tileset.slice = slice;
            tileset.tiles = tiles;
            warnings.push(...result.warnings);
            const removed = [...previousIds].filter((tileId) => !tiles.some((tile) => tile.id === tileId)).length;
            if (removed > 0)
                warnings.push(`${removed} 块的元数据随切分变化被丢掉（矩形已经不存在了）。`);
        }
        if (Array.isArray(patch.tiles))
            tileset.tiles = mergeTileMeta(tileset.tiles, patch.tiles);
        updated = tileset;
    });
    if (updated === undefined)
        throw new Error(`图集不存在：${tilesetId}`);
    const fresh = await readProjectOrThrow(projectId);
    const { pruned, warnings: remapWarnings } = await remapDocsToIndices(projectId, beforeKeys, indexKeys(fresh.tilesets));
    warnings.push(...remapWarnings);
    return { tileset: updated, warnings, pruned };
}
/** 序号 → 「图集 id / 图块 id」键。 */
function indexKeys(tilesets) {
    return new Map(flatTiles(tilesets).map((tile) => [tile.index, `${tile.tilesetId}/${tile.id}`]));
}
/**
 * 把每张地图的格子值从旧序号表平移到新序号表。
 *
 * 找不到对应图块的格子清零并计数：**不清零的后果是静默画错块**（旧索引落到
 * 了新表里另一个位置），比报错难查得多。
 */
async function remapDocsToIndices(projectId, before, after) {
    const project = await readProjectOrThrow(projectId);
    const newIndexByKey = new Map([...after.entries()].map(([index, key]) => [key, index]));
    let pruned = 0;
    const warnings = [];
    for (const mapId of project.mapIds) {
        const doc = await readMapDoc(projectId, mapId);
        if (doc === undefined)
            continue;
        let lost = 0;
        let remapped = 0;
        for (const layer of doc.layers) {
            const data = doc.data[layer.id];
            if (data === undefined)
                continue;
            for (let i = 0; i < data.length; i++) {
                const value = data[i];
                if (value <= 0)
                    continue;
                const key = before.get(value);
                const next = key === undefined ? undefined : newIndexByKey.get(key);
                if (next === undefined) {
                    data[i] = 0;
                    lost++;
                }
                else if (next !== value) {
                    data[i] = next;
                    remapped++;
                }
            }
        }
        if (lost > 0 || remapped > 0) {
            pruned += lost;
            if (lost > 0)
                warnings.push(`地图「${doc.name}」有 ${lost} 个格子指向的图块已经不存在，已清空。`);
            if (remapped > 0)
                warnings.push(`地图「${doc.name}」有 ${remapped} 个格子跟着切分变化重新映射了图块序号。`);
            await writeMapDoc(projectId, doc);
            revisions.set(docKey(projectId, mapId), (revisions.get(docKey(projectId, mapId)) ?? 0) + 1);
        }
    }
    return { pruned, warnings };
}
export async function removeMapTileset(projectId, tilesetId) {
    const project = await readProjectOrThrow(projectId);
    const tileset = project.tilesets.find((item) => item.id === tilesetId);
    if (tileset === undefined)
        throw new Error(`图集不存在：${tilesetId}`);
    const beforeKeys = indexKeys(project.tilesets);
    const mine = new Set(flatTiles(project.tilesets).filter((tile) => tile.tilesetId === tilesetId).map((tile) => tile.index));
    const users = [];
    for (const mapId of project.mapIds) {
        const doc = await readMapDoc(projectId, mapId);
        if (doc === undefined)
            continue;
        const used = [...usedTileIndices(doc)].filter((index) => mine.has(index));
        if (used.length > 0)
            users.push(`${doc.name}（${used.length} 个格子）`);
    }
    if (users.length > 0) {
        throw new Error(`图集「${tileset.name}」还有地图在用：${users.join("、")}。请先用「替换」把它换成别的图块，或删掉那几张地图。`);
    }
    await patchMapProject(projectId, (fresh) => {
        fresh.tilesets = fresh.tilesets.filter((item) => item.id !== tilesetId);
        appendJobLog(fresh.logs, "info", `移除图集：${tileset.name}`);
    });
    await rm(mapAssetPath(projectId, tileset.file), { force: true });
    const fresh = await readProjectOrThrow(projectId);
    const remapped = await remapDocsToIndices(projectId, beforeKeys, indexKeys(fresh.tilesets));
    return { removed: tileset.name, pruned: remapped.pruned, warnings: remapped.warnings };
}
export async function saveMapFamilies(projectId, families) {
    const normalized = (Array.isArray(families) ? families : []).map((raw, index) => normalizeFamily(raw, index));
    const seen = new Set();
    const warnings = [];
    for (const family of normalized) {
        if (seen.has(family.id)) {
            family.id = `${family.id}_${seen.size}`;
            warnings.push(`族 id 重复，已改成 ${family.id}。`);
        }
        seen.add(family.id);
    }
    await patchMapProject(projectId, (project) => {
        project.families = normalized;
        project.stages.rules = { status: "done", at: new Date().toISOString(), approved: project.stages.rules.approved };
        appendJobLog(project.logs, "info", `保存地形族：${normalized.map((family) => family.name).join("、") || "（空）"}`);
    });
    return { families: normalized, warnings };
}
export function familyCoverage(project) {
    const flat = flatTiles(project.tilesets);
    const rows = coverageReport(project.families, flat);
    return rows.map((row, index) => ({
        ...row,
        name: project.families[index]?.name ?? row.familyId,
        autotile: project.families[index]?.autotile ?? "single",
        expectedMasks: expectedMasks(project.families[index]?.autotile ?? "single")
    }));
}
export function mapAssetBase(projectId) {
    return `/dsh-game-material-master/map-assets/${projectId}/`;
}
export async function mapView(project, options = {}) {
    const flat = flatTiles(project.tilesets);
    const base = mapAssetBase(project.id);
    let startIndex = 1;
    const tilesets = project.tilesets.map((tileset) => {
        const preview = tilesetPreview(tileset, startIndex);
        startIndex += tileset.tiles.length;
        return {
            id: tileset.id,
            name: tileset.name,
            url: `${base}${tileset.file}`,
            file: tileset.file,
            imageWidth: tileset.imageWidth,
            imageHeight: tileset.imageHeight,
            slice: tileset.slice,
            tileCount: tileset.tiles.length,
            preview,
            suggestions: suggestGrids(tileset.imageWidth, tileset.imageHeight)
        };
    });
    const maps = [];
    let painted = 0;
    for (const mapId of project.mapIds) {
        const doc = await readMapDoc(project.id, mapId);
        if (doc === undefined)
            continue;
        const filled = filledCount(doc);
        painted += filled;
        maps.push({ id: doc.id, name: doc.name, cols: doc.cols, rows: doc.rows, layers: doc.layers.length, filled });
    }
    const activeId = options.mapId ?? project.activeMapId ?? project.mapIds[0];
    const listing = activeId === undefined ? undefined : await readExportListing(project.id, activeId);
    const active = activeId === undefined ? undefined : await readMapDoc(project.id, activeId);
    const historyInfo = active === undefined ? { canUndo: false, canRedo: false } : historyState(project.id, active.id);
    return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        grid: project.grid,
        tilesets,
        legend: flat.map((tile) => ({ index: tile.index, tilesetId: tile.tilesetId, rect: tile.rect })),
        families: project.families,
        coverage: familyCoverage(project),
        autotileMasks: { single: [0], corner16: expectedMasks("corner16"), blob47: expectedMasks("blob47") },
        maps,
        doc: active === undefined
            ? undefined
            : {
                id: active.id,
                name: active.name,
                cols: active.cols,
                rows: active.rows,
                variantSeed: active.variantSeed,
                randomVariants: active.randomVariants,
                layers: active.layers,
                filled: Object.fromEntries(active.layers.map((layer) => [layer.id, filledCount(active, layer.id)])),
                bounds: planBounds(renderContext(project), active),
                layout: layoutOf(project.grid, active.cols, active.rows),
                canUndo: historyInfo.canUndo,
                canRedo: historyInfo.canRedo,
                rev: docRevision(project.id, active.id)
            },
        stages: project.stages,
        reviewMode: project.reviewMode,
        duplicates: duplicateRects(project.tilesets).map((item) => ({ tilesetId: item.tilesetId, tileIds: item.tileIds })),
        previews: (await readPreviewFiles(project.id)).map((name) => `preview/${name}`),
        exportBase: listing === undefined ? "" : listing.base,
        exportFiles: listing?.files ?? [],
        job: currentMapJob(project.id),
        busy: mapBusy(project.id),
        assetBase: base,
        progress: { tilesets: project.tilesets.length, tiles: flat.length, families: project.families.length, maps: project.mapIds.length, painted },
        logs: project.logs.slice(-40),
        warnings: warningsFor(project, active)
    };
}
function warningsFor(project, doc) {
    const out = [];
    if (project.tilesets.length === 0)
        out.push("还没有导入图集：去「① 图集」上传一张 tileset 图。");
    if (project.families.length === 0)
        out.push("还没有地形族：没有族就只能一块一块地手工刷，自动过渡不会生效。");
    for (const row of familyCoverage(project)) {
        if (row.autotile !== "single" && row.missing.length > 0) {
            out.push(`族「${row.name}」缺 ${row.missing.length} 个掩码（${row.assigned}/${row.expected} 已配），缺的地方会回退成最近的块。`);
        }
    }
    if (doc !== undefined && isDocEmpty(doc))
        out.push(`地图「${doc.name}」还是空的。`);
    return out;
}
// ── 计划查询 ──────────────────────────────────────────────────────────────
/** 一次最多回多少 chunk（避免 512×512 全量计划把工具返回撑爆）。 */
export const MAX_PLAN_CHUNKS = 64;
export async function mapPlan(projectId, mapId, chunks) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const doc = await readMapDoc(projectId, mapId);
    if (doc === undefined)
        throw new Error(`地图不存在：${mapId}`);
    const context = renderContext(project);
    const allKeys = allChunks(doc.cols, doc.rows).map(chunkKey);
    const requested = chunks === undefined ? allKeys.slice(0, MAX_PLAN_CHUNKS) : chunks.filter((key) => parseChunkKey(key) !== undefined);
    const plan = buildPlan(context, doc, { chunks: requested, includeLegend: false });
    return {
        rev: docRevision(projectId, mapId),
        grid: project.grid,
        cols: doc.cols,
        rows: doc.rows,
        bounds: plan.bounds,
        chunks: plan.chunks,
        legend: [],
        fallbacks: plan.fallbacks,
        warnings: plan.warnings,
        truncated: chunks === undefined && allKeys.length > MAX_PLAN_CHUNKS,
        allChunkKeys: allKeys
    };
}
/** 视口矩形 → chunk 列表（agent 与界面都可用）。 */
export function chunksForViewport(project, doc, viewport) {
    return chunksCovering(layoutOf(project.grid, doc.cols, doc.rows), viewport).map(chunkKey);
}
/** 像素 → 格（给工具面用；界面那份是复刻，靠黄金对照钉住）。 */
export function cellAtPixel(project, doc, x, y) {
    return pointToCell(layoutOf(project.grid, doc.cols, doc.rows), x, y);
}
const jobs = new Map();
const cancelled = new Set();
/**
 * 「已经有人预定要开工」的项目。
 *
 * `mapBusy` 读的是 `jobs`，而作业是在**几个 await 之后**才登记进去的 ——
 * 两次并发提交（界面上手快连点、或工具面重复调用）会双双通过 `mapBusy` 检查，
 * 然后两个作业抢同一份文档。所以先用一个**同步**的预定集合把位置占住。
 */
const reserved = new Set();
export function currentMapJob(projectId) {
    return jobs.get(projectId);
}
export function mapBusy(projectId) {
    if (reserved.has(projectId))
        return true;
    const job = jobs.get(projectId);
    return job !== undefined && job.running !== null;
}
export function cancelMapJob(projectId) {
    cancelled.add(projectId);
}
/** 同步占位；占不到就返回原因（调用方直接回 `{started:false}`）。 */
function reserve(projectId) {
    if (reserved.has(projectId))
        return "这个项目已经有任务在跑了，等它跑完再提交。";
    const job = jobs.get(projectId);
    if (job !== undefined && job.running !== null)
        return "这个项目已经有任务在跑了，等它跑完再提交。";
    reserved.add(projectId);
    return undefined;
}
async function background(projectId, kind, targets, run) {
    const job = { projectId, kind, targets, done: [], running: targets[0] ?? null, startedAt: Date.now() };
    jobs.set(projectId, job);
    cancelled.delete(projectId);
    await patchMapProject(projectId, (project) => {
        project.stages[kind === "preview" ? "paint" : "export"] = { status: "running", at: new Date().toISOString() };
    }).catch(() => undefined);
    try {
        const result = await run(job);
        job.running = null;
        if (result !== undefined)
            job.result = result;
        await patchMapProject(projectId, (project) => {
            const stage = kind === "preview" ? "paint" : "export";
            if (project.stages[stage].status === "running")
                project.stages[stage] = { status: "done", at: new Date().toISOString(), approved: project.stages[stage].approved };
        });
    }
    catch (error) {
        job.error = messageOf(error);
        job.running = null;
        await patchMapProject(projectId, (project) => {
            const stage = kind === "preview" ? "paint" : "export";
            project.stages[stage] = { status: "error", error: job.error, at: new Date().toISOString() };
            appendJobLog(project.logs, "error", `${kind} 失败：${job.error}`);
        }).catch(() => undefined);
    }
    finally {
        reserved.delete(projectId);
    }
}
async function decodeTilesets(project) {
    const lookup = new Map();
    for (const tileset of project.tilesets) {
        if (tileset.file === "")
            continue;
        try {
            lookup.set(tileset.id, await decodeFile(mapAssetPath(project.id, tileset.file)));
        }
        catch {
            /* 单张图集解不开不该让整次预览失败，渲染时按缺图跳过 */
        }
    }
    return lookup;
}
/**
 * 验收预览（本地免费）：每张图集一张切片 contact sheet、一张掩码覆盖矩阵、
 * 以及当前地图的渲染图。这三张图是「图集切对了没 / 自动过渡配齐了没 /
 * 地图画出来对不对」最快的验收入口。
 */
export async function runPreviewStage(projectId, options = {}) {
    const busy = reserve(projectId);
    if (busy !== undefined)
        return { started: false, reason: busy };
    const project = await readProjectOrThrow(projectId);
    if (project.tilesets.length === 0) {
        reserved.delete(projectId);
        return { started: false, reason: "还没有导入图集。" };
    }
    const targets = [...project.tilesets.map((tileset) => `tileset:${tileset.id}`), "coverage", "map"];
    void background(projectId, "preview", targets, async (job) => {
        const fresh = await readProjectOrThrow(projectId);
        const lookup = await decodeTilesets(fresh);
        const previewDir = join(mapProjectDir(projectId), "preview");
        await mkdir(previewDir, { recursive: true });
        const written = [];
        for (const tileset of fresh.tilesets) {
            if (cancelled.has(projectId))
                break;
            const source = lookup.get(tileset.id);
            if (source === undefined)
                continue;
            const sheet = contactSheet(tileset, source, { scale: 1 });
            await writeFile(join(previewDir, `sheet-${tileset.id}.png`), bitmapToPng(sheet));
            job.done.push(`tileset:${tileset.id}`);
            written.push(`sheet-${tileset.id}.png`);
        }
        job.running = "coverage";
        const masks = new Map(fresh.families.map((family) => [family.id, expectedMasks(family.autotile)]));
        const matrix = coverageMatrix(fresh.families, fresh.tilesets, lookup, masks);
        await writeFile(join(previewDir, "coverage.png"), bitmapToPng(matrix));
        job.done.push("coverage");
        written.push("coverage.png");
        job.running = "map";
        const mapId = options.mapId ?? fresh.activeMapId ?? fresh.mapIds[0];
        const doc = mapId === undefined ? undefined : await readMapDoc(projectId, mapId);
        if (doc !== undefined) {
            const raster = rasterize(renderContext(fresh), doc, lookup, { scale: 1 });
            await writeFile(join(previewDir, `map-${doc.id}.png`), bitmapToPng(raster.bitmap));
            written.push(`map-${doc.id}.png`);
        }
        job.done.push("map");
        await patchMapProject(projectId, (project) => {
            project.stages.assets = { status: "done", at: new Date().toISOString(), approved: project.stages.assets.approved };
            appendJobLog(project.logs, "info", `生成验收预览：${written.join("、")}`);
        });
        return { files: written.map((name) => `preview/${name}`) };
    });
    return { started: true };
}
export function bitmapToPng(bitmap) {
    return encodePng(bitmap.rgba, bitmap.width, bitmap.height);
}
export async function runExportStage(projectId, options = {}) {
    const busy = reserve(projectId);
    if (busy !== undefined)
        return { started: false, reason: busy };
    const project = await readProjectOrThrow(projectId);
    const mapId = options.mapId ?? project.activeMapId ?? project.mapIds[0];
    if (mapId === undefined) {
        reserved.delete(projectId);
        return { started: false, reason: "这个项目还没有地图。" };
    }
    if (project.tilesets.length === 0) {
        reserved.delete(projectId);
        return { started: false, reason: "还没有导入图集，导出的地图会是空的。" };
    }
    void background(projectId, "export", ["prepare", "png", "json", "tiled"], async (job) => {
        const fresh = await readProjectOrThrow(projectId);
        await flushMapDoc(projectId, mapId);
        const doc = await readMapDoc(projectId, mapId);
        if (doc === undefined)
            throw new Error(`地图不存在：${mapId}`);
        if (isDocEmpty(doc))
            throw new Error(`地图「${doc.name}」还是空的，先画点东西再导出。`);
        const lookup = await decodeTilesets(fresh);
        const tilesetFiles = new Map(fresh.tilesets.map((tileset) => [tileset.id, mapAssetPath(projectId, tileset.file)]));
        const dir = join(mapProjectDir(projectId), "export", safeFileName(doc.name, doc.id));
        job.done.push("prepare");
        job.running = "png";
        const manifest = await exportMap({
            dir,
            context: renderContext(fresh),
            doc,
            project: { id: fresh.id, name: fresh.name },
            families: fresh.families,
            lookup,
            tilesetFiles,
            options: { scale: options.scale, formats: options.formats }
        });
        job.done.push("png", "json", "tiled");
        job.running = null;
        await patchMapProject(projectId, (project) => {
            project.stages.export = { status: "done", at: new Date().toISOString(), approved: project.stages.export.approved };
            appendJobLog(project.logs, "info", `导出「${doc.name}」：${manifest.files.length} 个文件`);
        });
        return { dir: `export/${safeFileName(doc.name, doc.id)}`, files: manifest.files.map((file) => file.path), warnings: manifest.warnings };
    });
    return { started: true };
}
async function readProjectOrThrow(projectId) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    return project;
}
/** 最近的导出清单（验收包用）。 */
export async function readExportManifest(projectId, mapId) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        return undefined;
    const doc = await readMapDoc(projectId, mapId);
    if (doc === undefined)
        return undefined;
    const dir = join(mapProjectDir(projectId), "export", safeFileName(doc.name, doc.id));
    return readJson(join(dir, "manifest.json"));
}
export async function readPreviewFiles(projectId) {
    try {
        const names = await readdir(join(mapProjectDir(projectId), "preview"));
        return names.filter((name) => name.endsWith(".png"));
    }
    catch {
        return [];
    }
}
function absoluteAssetUrl(projectId, origin, relative) {
    return `${origin}/dsh-game-material-master/map-assets/${projectId}/${relative}`;
}
export async function readExportListing(projectId, mapId) {
    const doc = await readMapDoc(projectId, mapId);
    if (doc === undefined)
        return undefined;
    const dirName = safeFileName(doc.name, doc.id);
    const manifest = await readJson(join(mapProjectDir(projectId), "export", dirName, "manifest.json"));
    if (manifest === undefined)
        return undefined;
    return {
        base: `export/${dirName}/`,
        files: manifest.files.map((file) => file.path),
        warnings: manifest.warnings ?? []
    };
}
/**
 * 工具用的快照：把界面里的**相对**资源路径全部换成可点的**绝对** URL
 * （模型要直接贴给用户），并附上「下一步该做什么」。
 */
export async function mapSnapshot(project, origin, options = {}) {
    const view = await mapView(project, options);
    const previews = await readPreviewFiles(project.id);
    const mapId = options.mapId ?? project.activeMapId ?? project.mapIds[0];
    const listing = mapId === undefined ? undefined : await readExportListing(project.id, mapId);
    const nextActions = [];
    if (view.tilesets.length === 0) {
        nextActions.push({ step: "assets", why: "还没导入图集：importMapTileset({projectId, name, data}) 传图片 base64，或让用户在界面上传。" });
    }
    else if (view.families.length === 0) {
        nextActions.push({ step: "rules", why: "还没有地形族：saveMapFamilies({projectId, families}) 定义族与自动过渡方案，否则画出来是手工拼块。" });
    }
    for (const row of view.coverage) {
        if (row.autotile !== "single" && row.missing.length > 0) {
            nextActions.push({ step: "rules", why: `族「${row.name}」缺 ${row.missing.length} 个掩码（${row.assigned}/${row.expected}），缺的地方会回退成最近的块。` });
        }
    }
    if (view.progress.painted === 0) {
        nextActions.push({ step: "paint", why: "地图还是空的：applyMapOps({projectId, mapId, ops}) 可以直接画（agent 也能画）。" });
    }
    else if (listing === undefined) {
        nextActions.push({ step: "export", why: "还没导出过：runMapExport({projectId, mapId}) 出 PNG + map.json + Tiled .tmj/.tsj。" });
    }
    if (nextActions.length === 0)
        nextActions.push({ step: "done", why: "图集、规则、地图、导出都有产物了。可以继续改地图，或 runMapPreview 重新出验收图。" });
    return {
        ...view,
        assetBase: `${origin}/dsh-game-material-master/map-assets/${project.id}/`,
        tilesets: view.tilesets.map((tileset) => ({ ...tileset, url: absoluteAssetUrl(project.id, origin, tileset.file) })),
        previewUrls: previews.map((name) => absoluteAssetUrl(project.id, origin, `preview/${name}`)),
        exportBaseUrl: listing === undefined ? "" : absoluteAssetUrl(project.id, origin, listing.base),
        exportFiles: listing?.files ?? [],
        exportWarnings: listing?.warnings ?? [],
        nextActions
    };
}
/** 保存网格设置：收敛 + 校验（比例不对要抛可执行的错误，不能静默改成别的值）。 */
export function saveGrid(input) {
    const grid = normalizeGrid(input);
    assertGrid(grid);
    return grid;
}
/** 读项目，读不到就抛（服务层到处要用）。 */
export async function readMapProjectOrThrow(projectId) {
    return readProjectOrThrow(projectId);
}
export { MAX_MAP_DIM };
