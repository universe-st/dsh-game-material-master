/**
 * 地图编辑器（模块六）的**数据层与作业**：**单项目 = 单张地图**。
 *
 * ## 落盘布局
 *
 * ```
 * <DSH_HOME>/game-material-master/map-jobs/<项目 id>/
 * ├── project.json          元数据：网格、素材、阶段、日志
 * ├── map.json              这张地图：图层元数据 + 每层数据（0 = 空）
 * ├── tilesets/<tsId>.png   导入的素材原图（原样保存，不改写）
 * ├── ai/<名字>.png         AI 生成素材的**暂存区**：对话里整理好、等用户确认的那张图
 * ├── preview/map.png       验收图：宿主算好的地图渲染图
 * └── export/<安全名>/      导出：map.png + map.json + manifest.json
 * ```
 *
 * ⚠️ `ai/` 里的东西**不是素材**：素材的属性在「新增素材」那一刻定死、之后只能删掉
 * 重来，所以宿主只把图整理好（`composeMapAsset`），由用户确认后走
 * `importMapTileset` 才进 `tilesets/`。
 *
 * 参考 AsLib 的 RPG Map Maker：一屏、零术语、地图四周**环绕**、A2 素材自动连接、
 * 动画地块、内置素材、一键生成。旧的「多地图 / 地形族 / 掩码覆盖 / 等距网格 /
 * 层高偏移 / Tiled 导出」全部删掉 —— 那些正是「预览好看、导出位移」「族配不齐
 * 就静默画错块」的来源。
 *
 * ## 编辑路径
 *
 * 界面**不发整份文档**，只发 op；宿主是唯一写者：
 * `applyMapOps` → 改内存里的文档 → 回传「脏 chunk + 该丢哪些客户端缓存」→ 防抖落盘。
 * 落盘是「最多 2 秒一次 + 停了 500ms 再补一次」，所以拖动时不会每笔都重写整个
 * 地图文件；进程被杀最多丢 2 秒的编辑（写入本身仍是原子的）。
 *
 * 撤销 / 重做是宿主侧**逆操作日志**（结构操作才存整份快照），界面不需要自己维护
 * 撤销栈 —— 旧模块那个「整份草稿 + 客户端撤销栈」正是「撤销跳步」的来源。
 */
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendJobLog, messageOf, readJson, sweepTempFiles, writeJsonAtomic } from "./jsonio.js";
import { dataRoot } from "./config.js";
import { decodeFile, encodeBitmap, pngSize, probeImageSize, sniffImageExt } from "./bitmap.js";
import { keyGreen } from "./chroma.js";
import { keyScreenName, normalizeKeyColor } from "./keycolor.js";
import { addLayer, applyOps, cellIndex, clearLayer, cloneDoc, createMapDoc, filledCount, isDocEmpty, moveLayer, normalizeMapDoc, removeLayer, renameLayer, resizeDoc, revertOps } from "./mapdoc.js";
import { assertGrid, assertMapSize, canonicalChunk, chunkKey, chunksInRange, dirtyChunksFor, layoutOf, normalizeGrid, parseChunkKey, viewCellRange, wrapCell, MAX_MAP_DIM, MAX_PLAN_CHUNKS } from "./mapgeom.js";
import { bitmapToPng, buildPlan, rasterize, renderMapView, stampCellsOf } from "./maprender.js";
import { COMMON_TILE_SIZES, buildTiles, composeAssetSheet, detectLayout, flatIndexByValue, flatTiles, layoutFor, safeAssetStem, sheetPlanOf, tileSeamRatios, trimUniformBorder, sizeFromBytes, parseAssetFps, parseAssetLoop, parseStampSpec, composeStampSource, stampTilesetImage, keyStampBackground, STAMP_KEY_OPTIONS, STAMP_MAX_CELLS, STAMP_MIN_CELLS, parseAssetScale, parseClarity, resampleToSize, A2_ROWS, MAX_ASSET_SCALE, assertStampFitsProject, } from "./maptiles.js";
import { exportMap, safeFileName } from "./mapexport.js";
import { assetBasePath, originForLinks } from "./links.js";
import { primeSampleTextures, renderSampleTilesets } from "./mapsamplegen.js";
/** 四个阶段（对话面契约：`stage=assets|rules|paint|export`；`rules` 自动完成、界面不显示）。 */
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
/** 单项目 = 单张地图，文档直接放项目根。 */
export function mapDocFile(id) {
    return join(mapProjectDir(id), "map.json");
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
/**
 * 子目录白名单（静态资源路由按**第一段**比对，漏一条就是 403 + 图裂）。
 *
 * **这是唯一真源**：`index.ts` 的资源路由直接引用这一份，建项目时的目录清单也用它 ——
 * 两边各写一份的话，「建了目录但路由 403」只会以「图裂了」的形式出现（曾经踩过）。
 *
 * ⚠️ 另一半仍要同步：`index.ts` 的 `AssetScope` 类型、`resolveAssetTarget` 分支、
 * `SCOPES` 数组（那三处是 **scope** 级，不是子目录级）。`maps/` 已经不存在了
 * （单项目单地图 → `map.json` 在项目根）；`ai/` 是「AI 生成素材」的暂存区
 * （整理好、等用户在「新增素材」里确认的那张图）。
 */
export const SERVABLE_MAP_DIRS = new Set(["tilesets", "preview", "export", "ai"]);
/** 新项目默认地图尺寸（单屏一屏就能画完）。 */
const DEFAULT_COLS = 32;
const DEFAULT_ROWS = 32;
function freshStages() {
    // `rules`（自动连接）现在没有可配置项：素材形态在导入时就识别好了、过渡是内置的，
    // 所以它一开始就是 done。key 保留只为不破坏对话面的阶段契约。
    return {
        assets: { status: "idle" },
        rules: { status: "done", at: new Date().toISOString() },
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
async function writeMapProject(project) {
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(mapProjectFile(project.id), project);
}
/**
 * 改项目元数据（改名 / 打勾 / 网格开关）。
 *
 * 读—改—写走同一条队列，两个并发的打勾不会互相覆盖。
 */
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
function positiveInt(value, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
export async function createMapProject(name, options = {}) {
    const grid = normalizeGrid(options.grid);
    assertGrid(grid);
    const cols = positiveInt(options.cols, DEFAULT_COLS);
    const rows = positiveInt(options.rows, DEFAULT_ROWS);
    assertMapSize(cols, rows);
    const id = `m${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = {
        id,
        name: name.trim() === "" ? "未命名地图" : name.trim(),
        createdAt: now,
        updatedAt: now,
        grid,
        tilesets: [],
        stages: freshStages(),
        logs: []
    };
    await mkdir(mapProjectDir(id), { recursive: true });
    for (const sub of SERVABLE_MAP_DIRS)
        await mkdir(join(mapProjectDir(id), sub), { recursive: true });
    appendJobLog(project.logs, "info", `新建地图项目：${project.name}（${cols}×${rows}）`);
    // 顺手建一张空地图：用户导入素材后就能直接画
    await writeTheDoc(id, createMapDoc(id, project.name, cols, rows));
    await writeMapProject(project);
    return project;
}
export async function readMapProject(id) {
    const raw = await readJson(mapProjectFile(id));
    if (raw === undefined || typeof raw !== "object")
        return undefined;
    void sweepTempFiles(mapProjectDir(id));
    const stages = { ...freshStages(), ...(raw.stages ?? {}) };
    if (stages.rules.status === "idle")
        stages.rules = { status: "done", at: stages.rules.at ?? new Date().toISOString(), approved: stages.rules.approved };
    return {
        ...raw,
        grid: normalizeGrid(raw.grid),
        tilesets: Array.isArray(raw.tilesets) ? raw.tilesets.map(normalizeTileset) : [],
        stages,
        logs: Array.isArray(raw.logs) ? raw.logs : []
    };
}
/**
 * 素材记录的自愈式归一化：**几何字段是唯一真源，`tiles` 由它现推**。
 *
 * 这样即使某次改了 `buildTiles` 的切分规则、或者老数据缺了新字段，读一次项目就
 * 自动补齐；逐块的人工元数据（名字 / 掩码 / 形状号）按「矩形 id」尽力保留。
 */
function normalizeTileset(raw) {
    const source = asRecord(raw);
    const imageWidth = Math.max(1, Math.round(Number(source.imageWidth) || 1));
    const imageHeight = Math.max(1, Math.round(Number(source.imageHeight) || 1));
    const cell = normalizeCell(source.cell) ?? { width: 32, height: 32 };
    const shape = isTilesetShape(source.shape) ? source.shape : "plain";
    const animRows = source.animRows === true;
    // 整图规格：读盘时**不抛**（老数据 / 坏数据当成「不是整图」处理，等重导），只认能解析出来的。
    let stamp;
    try {
        stamp = parseStampSpec(source.stamp);
    }
    catch {
        stamp = undefined;
    }
    const shapeSafe = stamp !== undefined ? "stamp" : shape === "stamp" ? "plain" : shape;
    const rawTiles = source.tiles;
    const previous = Array.isArray(rawTiles) ? rawTiles : undefined;
    const tiles = buildTiles({ shape: shapeSafe, cell, imageWidth, imageHeight, animRows, stamp }, previous);
    const tileset = {
        id: typeof source.id === "string" && source.id !== "" ? source.id : `ts${randomUUID().slice(0, 6)}`,
        name: typeof source.name === "string" && source.name !== "" ? source.name : "素材",
        file: typeof source.file === "string" ? source.file : "",
        imageWidth,
        imageHeight,
        cell,
        shape: shapeSafe,
        animRows,
        stamp,
        variants: stamp === undefined ? variantsOf(shapeSafe, cell, imageWidth, imageHeight, animRows) : stamp.frames,
        loop: parseAssetLoop(source.loop),
        clarity: parseClarity(source.clarity),
        fps: parseAssetFps(source.fps),
        builtin: source.builtin === true ? true : undefined,
        tiles
    };
    // 老数据里「整格自动连接」没配过掩码（旧版本压根没这条路径）——读一次就补齐，
    // 这样不用让用户回去重新切一次形态。告警交给 `warningsFor` 常驻显示。
    assignCorner16Masks(tileset, []);
    return tileset;
}
/** JSON 记录收口（读盘数据一律当作不认识的东西看）。 */
function asRecord(value) {
    return value !== null && typeof value === "object" ? value : {};
}
function isTilesetShape(value) {
    return value === "plain" || value === "a2quad" || value === "corner16" || value === "stamp";
}
/** 界面 / 工具面传上来的形态字符串收口：不合法**明确报错**，不静默改成别的值。 */
export function parseTilesetShape(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (!isTilesetShape(value))
        throw new Error(`未知素材形态：${String(value)}（可选 plain / a2quad / corner16 / stamp）`);
    return value;
}
/** 整数收口；形状不对时抛中文错，不静默改成别的值。 */
function normalizeCell(input) {
    if (input === undefined || input === null)
        return undefined;
    const source = asRecord(input);
    const width = Math.round(Number(source.width));
    const height = Math.round(Number(source.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 2048 || height > 2048) {
        throw new Error(`素材格子尺寸不合法：${JSON.stringify(input)}（应为 1..2048 的整数宽高）`);
    }
    return { width, height };
}
/** 变体数 / 动画帧数：A2 看块列数，普通形态看行数（`animRows` 时）。 */
function variantsOf(shape, cell, imageWidth, imageHeight, animRows) {
    if (shape === "a2quad")
        return Math.max(1, Math.floor(imageWidth / cell.width));
    if (animRows)
        return Math.max(1, Math.floor(imageHeight / cell.height));
    return 1;
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
        stages: project.stages
    };
}
export async function deleteMapProject(id) {
    /**
     * ⚠️ 先把**还没落盘的防抖定时器**停掉。
     *
     * 不停的话，用户删完项目、目录已经移走，定时器几秒后照样 fire → 往不存在的
     * 目录里 rename，抛 ENOENT。那是**未处理的 promise 拒绝**（自检里直接把整个
     * 脚本打挂，真机上只是控制台一声闷响，但会污染日志）。
     */
    const state = docWrites.get(id);
    if (state?.timer != null)
        clearTimeout(state.timer);
    docWrites.delete(id);
    docCache.delete(id);
    history.delete(id);
    await rm(mapProjectDir(id), { recursive: true, force: true });
}
async function readProjectOrThrow(projectId) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    return project;
}
// ── 地图文档：内存真源 + 防抖落盘 ─────────────────────────────────────────
/** `项目id` → 文档。编辑期间这是**权威副本**，磁盘是它的稳态快照。 */
const docCache = new Map();
const docWrites = new Map();
/** 上一笔编辑距今超过它就直接写盘（保证「最多丢 2 秒」）。 */
const WRITE_MAX_LATENCY_MS = 2000;
const WRITE_IDLE_MS = 500;
/** 读当前项目的地图文档（内存优先）；没有就返回 undefined。 */
export async function readTheDoc(projectId) {
    const cached = docCache.get(projectId);
    if (cached !== undefined)
        return cached;
    const raw = await readJson(mapDocFile(projectId));
    const doc = normalizeMapDoc(raw, projectId);
    if (doc === undefined)
        return undefined;
    docCache.set(projectId, doc);
    return doc;
}
/** 内部：读不到就给一份空地图（不落盘，第一次写的时候才存）。 */
async function theDocOrFresh(projectId) {
    const doc = await readTheDoc(projectId);
    if (doc !== undefined)
        return doc;
    const fresh = createMapDoc(projectId, "地图", DEFAULT_COLS, DEFAULT_ROWS);
    docCache.set(projectId, fresh);
    return fresh;
}
export async function writeTheDoc(projectId, doc) {
    await enqueueWrite(projectId, async () => {
        await writeJsonAtomic(mapDocFile(projectId), doc);
    });
}
/**
 * 防抖落盘：**最多 2 秒延迟 + 停笔 500ms 补齐**。
 *
 * 每笔都写的话，拖动笔刷时每 60ms 就要把整张地图（最大 512×512×多层）序列化一遍，
 * 界面会明显发涩；完全不防抖又会丢编辑。这个窗口是两者的折中。
 */
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
/** 立刻落盘（导出前、改结构后、删项目前调用）。 */
export async function flushMapDoc(projectId) {
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
    // 撤销之后又画了新东西：把「未来」截断
    if (state.index < state.entries.length - 1) {
        for (const dropped of state.entries.slice(state.index + 1))
            state.bytes -= estimateEntryBytes(dropped, doc);
        state.entries = state.entries.slice(0, state.index + 1);
    }
    const previous = state.entries[state.index];
    if (entry.snapshot === undefined &&
        entry.stroke !== undefined &&
        previous !== undefined &&
        previous.snapshot === undefined &&
        previous.stroke === entry.stroke) {
        // 同一笔的后续提交：并进上一条（撤销粒度 = 一笔，而不是一次 flush）
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
    // ⚠️ 标记也要一起还原：漏了这一句就会「撤销之后标记回不来」——而且不报错。
    target.markers = snapshot.markers.map((marker) => ({ ...marker }));
    target.updatedAt = new Date().toISOString();
}
// ── 渲染上下文与坐标 ──────────────────────────────────────────────────────
/**
 * 组装渲染上下文。
 *
 * ⚠️ 多了一个 `doc`：`RenderContext.layout` 的 cols/rows 只存在地图文档里
 * （项目元数据不存尺寸 —— 单项目单地图，尺寸是文档的属性）。
 */
export function renderContextFor(project, doc) {
    return {
        grid: project.grid,
        layout: layoutOf(project.grid, doc.cols, doc.rows),
        tilesets: project.tilesets,
        lookup: flatIndexByValue(project.tilesets)
    };
}
/**
 * 从客户端报上来的 `have` 里挑出「内容真变了」的那些。
 *
 * 客户端缓存的是**未取模**的 chunk key（画布可以拖到任何地方，同一格会以多个
 * 像素位置出现），而宿主算出来的是**规范** key（0..nx-1）。所以两边要先映射到
 * 同一套坐标才能比 —— 这一步刻意留在宿主：客户端一丝几何都不许算。
 */
function pickDropKeys(dirtyCanonical, have, doc) {
    if (have === undefined || have.length === 0)
        return [];
    const dirty = new Set(dirtyCanonical);
    const out = [];
    for (const key of have) {
        const chunk = parseChunkKey(key);
        if (chunk === undefined)
            continue;
        if (dirty.has(chunkKey(canonicalChunk(chunk, doc.cols, doc.rows))))
            out.push(key);
    }
    return out;
}
function outcomeOf(projectId, changed, skipped, layout, cells, have, doc, stamps = 0) {
    const dirtyChunks = cells.length === 0 ? [] : dirtyChunksFor(cells, layout);
    const state = historyState(projectId);
    return { changed, skipped, stamps, dirtyChunks, dropKeys: pickDropKeys(dirtyChunks, have, doc), canUndo: state.canUndo, canRedo: state.canRedo };
}
/**
 * 「素材 id → 占几格」：整图 op 只带素材 id，占格由**宿主**从素材上读
 * （客户端传 cols/rows 等于把印多大交给界面，一旦对不上就是几何错位）。
 */
function stampSpecResolver(project) {
    const byId = new Map(project.tilesets.map((tileset) => [tileset.id, tileset]));
    return (tilesetId) => {
        const spec = byId.get(tilesetId)?.stamp;
        return spec === undefined ? undefined : { cols: spec.cols, rows: spec.rows };
    };
}
/**
 * 整图占的格子 + 每格通行性（区域叠加用）。
 *
 * 与渲染计划同一个口径：`stampSpan` 算占格、`tileset.stamp.pass` 取三态、坐标取模。
 * 越界的格（地图改小过）直接跳过。
 */
function passCellsOf(project, doc) {
    if (doc.stamps.length === 0)
        return [];
    const context = renderContextFor(project, doc);
    const out = [];
    for (const stamp of doc.stamps) {
        for (const cell of stampCellsOf(context, doc, stamp))
            out.push({ r: cell.r, c: cell.c, kind: cell.pass });
    }
    return out;
}
function indexCells(indices, doc) {
    const out = [];
    for (const index of indices) {
        if (index < 0 || index >= doc.cols * doc.rows)
            continue;
        out.push({ r: Math.floor(index / doc.cols), c: index % doc.cols });
    }
    return out;
}
function allCells(doc) {
    const out = [];
    for (let r = 0; r < doc.rows; r++)
        for (let c = 0; c < doc.cols; c++)
            out.push({ r, c });
    return out;
}
/**
 * 应用一批编辑 op（界面拖动时按 ~60ms 批量提交）。
 *
 * 返回「脏 chunk + 该丢哪些客户端缓存」：界面照做即可，不需要自己算
 * 「这一笔影响了哪几格的过渡块」—— 那是宿主的知识。
 */
export async function applyMapOps(projectId, ops, opts = {}) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const currentRevision = await mapRevision(project, doc);
    if (opts.ifRevision !== undefined && opts.ifRevision !== "" && opts.ifRevision !== currentRevision) {
        throw new Error(`版本不一致：当前 ${currentRevision}，请求 ${opts.ifRevision}；请重新 mapInspect 后再改。`);
    }
    const target = opts.dryRun === true ? cloneDoc(doc) : doc;
    const layout = layoutOf(project.grid, target.cols, target.rows);
    const result = applyOps(target, ops, layout, { stampSpecOf: stampSpecResolver(project) });
    // `touched`（标记改名这类不占格的改动）也要记一步撤销 —— 只看 `changed > 0` 的话，
    // 改名会「生效了但撤不回来」。
    if (opts.dryRun !== true && (result.changed > 0 || result.touched === true)) {
        pushHistory(projectId, { undo: result.undo, redo: ops, stroke: opts.stroke }, doc);
        scheduleDocWrite(projectId, doc);
    }
    const summary = {
        cells: result.changed,
        markers: ops.filter((op) => op?.kind === "marker").length,
        stamps: result.stamps,
        objects: 0
    };
    const revision = opts.dryRun === true ? currentRevision : await mapRevision(project, doc);
    return {
        ...outcomeOf(projectId, result.changed, result.skipped, layout, result.dirty, opts.have, target, result.stamps),
        revision,
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        summary
    };
}
export async function undoMap(projectId, have) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const state = history.get(projectId);
    if (state === undefined || state.index < 0)
        return outcomeOf(projectId, 0, [], layoutOf(project.grid, doc.cols, doc.rows), [], have, doc);
    const entry = state.entries[state.index];
    let cells;
    if (entry.snapshot !== undefined) {
        restoreDoc(doc, entry.snapshot.before);
        cells = allCells(doc);
    }
    else {
        let indices;
        try {
            indices = revertOps(doc, entry.undo, { stampSpecOf: stampSpecResolver(project) });
        }
        catch {
            // 栈被容量上限裁剪过之后，这一步的逆操作可能已经对不上：**放弃这一步**，
            // 把它从栈里剔掉让下一次撤销落到更早的一步，而不是每次都卡在同一条上
            // （界面里抛异常就是「点了撤销整个面板报错」）。
            state.entries.splice(state.index, 1);
            state.index = Math.max(-1, state.index - 1);
            return { ...outcomeOf(projectId, 0, [], layoutOf(project.grid, doc.cols, doc.rows), [], have, doc), revision: await mapRevision(project, doc) };
        }
        cells = indexCells(indices, doc);
    }
    state.index--;
    scheduleDocWrite(projectId, doc);
    // 结构快照可能把尺寸改回去了 —— 脏块必须按**改完之后**的布局算。
    return { ...outcomeOf(projectId, cells.length, [], layoutOf(project.grid, doc.cols, doc.rows), cells, have, doc), revision: await mapRevision(project, doc) };
}
export async function redoMap(projectId, have) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const state = history.get(projectId);
    if (state === undefined || state.index >= state.entries.length - 1)
        return outcomeOf(projectId, 0, [], layoutOf(project.grid, doc.cols, doc.rows), [], have, doc);
    const entry = state.entries[state.index + 1];
    let cells;
    if (entry.snapshot !== undefined) {
        restoreDoc(doc, entry.snapshot.after);
        cells = allCells(doc);
    }
    else {
        let indices;
        try {
            indices = revertOps(doc, entry.redo, { stampSpecOf: stampSpecResolver(project) });
        }
        catch {
            state.entries.splice(state.index + 1, 1);
            return { ...outcomeOf(projectId, 0, [], layoutOf(project.grid, doc.cols, doc.rows), [], have, doc), revision: await mapRevision(project, doc) };
        }
        cells = indexCells(indices, doc);
    }
    state.index++;
    scheduleDocWrite(projectId, doc);
    // 结构快照可能改掉了尺寸 —— 脏块按**改完之后**的布局算（同 undoMap）。
    return { ...outcomeOf(projectId, cells.length, [], layoutOf(project.grid, doc.cols, doc.rows), cells, have, doc), revision: await mapRevision(project, doc) };
}
export async function saveMapDocStructure(projectId, patch) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const before = cloneDoc(doc);
    const warnings = [];
    let structural = false;
    let dropped = 0;
    if (typeof patch.name === "string" && patch.name.trim() !== "" && patch.name.trim() !== doc.name) {
        doc.name = patch.name.trim();
        structural = true;
    }
    for (const layerPatch of patch.layers ?? []) {
        if (typeof layerPatch?.name !== "string" || layerPatch.name.trim() === "")
            continue;
        // ⚠️ `renameLayer` 对「图层不存在」和「名字没变」都返回 false：
        // 不先判存在性的话，用户把名字原样提交一次就会看到一句「图层不存在」。
        if (!doc.layers.some((layer) => layer.id === layerPatch.id)) {
            warnings.push(`图层不存在：${layerPatch?.id}`);
            continue;
        }
        if (renameLayer(doc, layerPatch.id, layerPatch.name.trim()))
            structural = true;
    }
    if (patch.addLayer !== undefined) {
        addLayer(doc, patch.addLayer?.name);
        structural = true;
    }
    if (typeof patch.removeLayerId === "string") {
        if (removeLayer(doc, patch.removeLayerId))
            structural = true;
        else
            warnings.push("至少要留一个图层，最后一个删不掉。");
    }
    if (patch.moveLayer !== undefined) {
        if (moveLayer(doc, patch.moveLayer?.id, Math.round(Number(patch.moveLayer?.toIndex)) || 0))
            structural = true;
        else
            warnings.push(`图层不存在：${patch.moveLayer?.id}`);
    }
    if (typeof patch.clearLayerId === "string") {
        // ⚠️ 先判存在性：`clearLayer` 对「图层不存在」与「本来就空」都返回 0，
        // 不判的话用户会拿到一句「这一层本来就是空的。」—— 而那一层根本不存在。
        if (!doc.layers.some((layer) => layer.id === patch.clearLayerId)) {
            warnings.push(`图层不存在：${patch.clearLayerId}`);
        }
        else if (clearLayer(doc, patch.clearLayerId) > 0) {
            structural = true;
        }
        else {
            warnings.push("这一层本来就是空的。");
        }
    }
    if (Number.isFinite(patch.cols) || Number.isFinite(patch.rows)) {
        const cols = Number.isFinite(patch.cols) ? Math.round(Number(patch.cols)) : doc.cols;
        const rows = Number.isFinite(patch.rows) ? Math.round(Number(patch.rows)) : doc.rows;
        assertMapSize(cols, rows);
        if (cols !== doc.cols || rows !== doc.rows) {
            const result = resizeDoc(doc, cols, rows);
            dropped = result.dropped;
            structural = true;
            if (dropped > 0)
                warnings.push(`缩小地图丢掉了 ${dropped} 个已画的格子（可以撤销）。`);
            if (result.droppedMarkers > 0)
                warnings.push(`缩小地图丢掉了 ${result.droppedMarkers} 个落在界外的标记（可以撤销）。`);
        }
    }
    if (structural) {
        const after = cloneDoc(doc);
        doc.updatedAt = new Date().toISOString();
        pushHistory(projectId, { undo: [], redo: [], snapshot: { before, after } }, doc);
        scheduleDocWrite(projectId, doc);
    }
    // 环绕开关落在项目网格上：它只影响渲染与命中测试，不动一个格子。
    if (typeof patch.wrap === "boolean" && patch.wrap !== project.grid.wrap) {
        const grid = { ...project.grid, wrap: patch.wrap };
        assertGrid(grid);
        await patchMapProject(projectId, (fresh) => {
            fresh.grid = grid;
            appendJobLog(fresh.logs, "info", `地图环绕：${patch.wrap === true ? "开" : "关"}`);
        });
    }
    if (structural)
        await flushMapDoc(projectId);
    return { doc: cloneDoc(doc), dropped, warnings, revision: await mapRevision(await readProjectOrThrow(projectId), doc) };
}
/**
 * 导入一张素材图。**属性在这一刻定下来，之后只能删掉重来**（界面上不再提供修改入口）。
 *
 * `opts` 里留空的项走自动识别；给了就用用户的（值不合法就退回识别，不静默改）。
 */
/**
 * **原地重新整理**一张 AI 素材：用同一份源图按现在的规则重烘一遍，**保留素材 id 与图块数**。
 *
 * 为什么要有它：整格 / 拼块的 16 块是**烘进素材图**的（收口、竖段换向、转角斜接都在里面），
 * 生成规则一改，已有素材不会自动变。而「删掉再导一次」会把画在那张素材上的格子清空
 * （宿主按图块序号重映射，素材没了自然就空了）—— 用户的地图就废了。
 * 这条路径按 id 原地替换图片 + 重建 16 块，图块序号一个都不动。
 *
 * 前置条件：非内置素材、给了至少一张源图、形态与格子沿用素材自己的（不让这里改几何）。
 */
export async function recomposeMapTileset(projectId, tilesetId, input = {}) {
    const project = await readProjectOrThrow(projectId);
    const index = project.tilesets.findIndex((tileset) => tileset.id === tilesetId);
    if (index < 0)
        throw new Error(`没有这块素材：${tilesetId}`);
    const tileset = project.tilesets[index];
    if (tileset.builtin === true)
        throw new Error("内置素材不能重新整理（它们是程序化生成的，删掉重装即可）");
    const files = (input.files ?? []).map((file) => String(file)).filter((file) => file !== "");
    if (files.length === 0)
        throw new Error("重新整理需要源图：files 里给至少一张图片的绝对路径");
    if (tileset.shape === "corner16" && files.length !== 1) {
        throw new Error("整格只要**一块**无缝砖：files 给 1 张（整格没有帧这一维）");
    }
    const clarity = input.clarity === undefined ? parseClarity(tileset.clarity) : parseClarity(input.clarity);
    /** 先按 4 倍分辨率烘，再按清晰度缩到格子 —— 与 `composeMapAsset` 同一条口径（细节只丢一次）。 */
    const scale = MAX_ASSET_SCALE;
    const bigCell = { width: tileset.cell.width * scale, height: tileset.cell.height * scale };
    const frames = [];
    for (const file of files)
        frames.push(trimUniformBorder(await decodeFile(file)).bitmap);
    const plan = sheetPlanOf(tileset.shape, bigCell, frames.length, tileset.stamp);
    /**
     * 交给 `registerTileset` 的**源图**：
     * - 整图 = `cols × rows*frames` 的源图（**不烘旋转**）—— 烘焙由 `registerTileset` 做，
     *   这里先烘一遍的话会被烘第二次（真机翻车过：1024×2560 的图被再压成 256×64）。
     * - 其它形态 = 照旧缩到最终尺寸。
     */
    const payload = tileset.stamp === undefined
        ? (() => {
            const big = composeAssetSheet(frames, plan, "smooth");
            return resampleToSize(big, big.width / scale, big.height / scale, clarity);
        })()
        : composeStampSource(frames, tileset.stamp, bigCell, "smooth");
    /** 尺寸校验用**成品**尺寸：整图是烘完 4 个旋转之后的大小。 */
    const fitted = tileset.stamp === undefined ? payload : stampTilesetImage(payload, tileset.stamp, tileset.cell, clarity);
    /**
     * ⚠️ **写盘之前**先对尺寸：重烘只能把「本来就是 AI 整理出来的素材」重新烘一遍。
     * 手动导的图集（例如一张 2×2 的普通图 = 4 块）用 `composeMapAsset` 的口径烘出来只有 1 块，
     * 尺寸一变，图块序号就整体错位、地图上画过的地方全会变形 —— 这种必须明确拒绝，而不是写下去。
     */
    if (fitted.width !== tileset.imageWidth || fitted.height !== tileset.imageHeight) {
        throw new Error(`重烘出来的尺寸和原素材不一样（${fitted.width}×${fitted.height} vs ${tileset.imageWidth}×${tileset.imageHeight}）：` +
            `这块素材不是按「AI 生成素材」的方式整理的（整格 1 张 / 拼块 N 张 / 普通 N 帧），不能原地重烘 —— ` +
            `源图数量或用法对不上。`);
    }
    const warnings = [];
    const rebuilt = await registerTileset(projectId, {
        id: tileset.id,
        name: tileset.name,
        // 整图交**源图**（registerTileset 会缩到格子再烘旋转），其它形态交最终图。
        bytes: encodeBitmap(payload),
        overrides: tileset.stamp === undefined ? { clarity } : { clarity, stamp: tileset.stamp },
        known: {
            shape: tileset.shape,
            cell: { width: tileset.cell.width, height: tileset.cell.height },
            animRows: tileset.animRows,
            fps: tileset.fps,
            loop: tileset.loop,
            clarity,
            builtin: false
        },
        projectGrid: { width: project.grid.tileWidth, height: project.grid.tileHeight }
    }, warnings);
    await patchMapProject(projectId, (fresh) => {
        const at = fresh.tilesets.findIndex((entry) => entry.id === tileset.id);
        if (at >= 0)
            fresh.tilesets[at] = rebuilt;
        appendJobLog(fresh.logs, "info", `重新整理素材：${rebuilt.name}（按现在的规则重烘，图块序号不变，地图不用改）`);
    });
    // 用真实视图回给界面（调色板 / 说明都要现算，别在这里手搓一份）。
    const view = await mapView(await readMapProject(projectId));
    const fresh = view.tilesets.find((entry) => entry.id === rebuilt.id);
    if (fresh === undefined)
        throw new Error("重新整理后找不到这块素材，请刷新页面");
    return { tileset: fresh, warnings };
}
export async function importMapTileset(projectId, name, base64, opts = {}) {
    const project = await readProjectOrThrow(projectId);
    if (base64.trim() === "")
        throw new Error("图片内容为空。");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0)
        throw new Error("图片内容为空。");
    const warnings = [];
    const tileset = await registerTileset(projectId, {
        id: newTilesetId(),
        name: name.trim() === "" ? `素材 ${project.tilesets.length + 1}` : name.trim(),
        bytes,
        overrides: { cell: opts.cell, shape: opts.shape, animRows: opts.animRows, fps: opts.fps, clarity: opts.clarity, scale: opts.scale, loop: opts.loop, stamp: opts.stamp, stampKey: opts.stampKey, keyColor: opts.keyColor },
        projectGrid: { width: project.grid.tileWidth, height: project.grid.tileHeight }
    }, warnings);
    await patchMapProject(projectId, (fresh) => {
        fresh.tilesets.push(tileset);
        fresh.stages.assets = { status: "done", at: new Date().toISOString(), approved: fresh.stages.assets.approved };
        appendJobLog(fresh.logs, "info", `导入素材：${tileset.name}（${tileset.imageWidth}×${tileset.imageHeight} → ${tileset.tiles.length} 块）`);
    });
    return { tilesets: [tileset], warnings };
}
/**
 * 装内置素材：**本机现算**（`mapsamplegen.renderSampleTilesets()`），零成本、确定性。
 *
 * 4 张 A2 图（草地 / 土路 / 水 / 石墙）+ 1 张道具网格图。同名素材已经在项目里就
 * 跳过（不会因为点两次变成十张图），跳过的原因写进 warnings。
 */
export async function importSampleTileset(projectId) {
    // ⚠️ 先 prime 一次纹理覆盖表（幂等）：`renderSampleTilesets()` 是**同步**契约，
    // 而覆盖图（`--ark` 生成的那份 base64）解码要走 ffmpeg。配了覆盖却没 prime 时它会
    // 明确抛错（不静默退回程序化纹理），所以这条路径必须先把这一步做掉 ——
    // 现在覆盖表是空的，这一步是空操作。
    await primeSampleTextures();
    const project = await readProjectOrThrow(projectId);
    const existing = new Set(project.tilesets.map((tileset) => tileset.name));
    const warnings = [];
    const created = [];
    /**
     * 内置素材是按 **32×32 一格**画出来的。项目的网格可能是 16 / 48 / 64 —— 直接塞进去
     * 图块会压边（渲染按素材自己的格子画，和地图网格不一致就错位），所以这里按比例重采样：
     * 整数倍放大用最近邻（像素画放大，边缘干净），缩小 / 非整数倍用面积平均。
     */
    const samples = renderSampleTilesets();
    const targetCell = Math.max(1, Math.round(project.grid.tileWidth));
    const sourceCell = Math.max(1, samples[0]?.cell.width ?? 32);
    const scaled = targetCell !== sourceCell;
    const ratio = targetCell / sourceCell;
    // 整数倍放大用最近邻（像素画放大，边缘干净）；缩小 / 非整数倍用面积平均。
    const clarity = ratio >= 2 && Number.isInteger(ratio) ? "sharp" : "smooth";
    for (const sample of samples) {
        if (existing.has(sample.name)) {
            warnings.push(`内置素材「${sample.name}」已经在项目里了，跳过。`);
            continue;
        }
        let bytes = sample.bytes;
        if (scaled) {
            /**
             * PNG 解码统一走 ffmpeg，而 ffmpeg 只认文件路径 —— 落一个临时文件再删。
             * （`png.ts` 只有编码器；为这一点在 src 里再写一个 PNG 解码器不值得。）
             */
            const size = sizeFromBytes(sample.bytes) ?? { width: sample.cell.width, height: sample.cell.height };
            const scratch = join(mapProjectDir(projectId), `tilesets/${sample.file}.in.png`);
            await writeFile(scratch, sample.bytes);
            try {
                const source = await decodeFile(scratch);
                const fitted = resampleToSize(source, Math.max(1, Math.round(size.width * ratio)), Math.max(1, Math.round(size.height * ratio)), clarity);
                bytes = encodeBitmap(fitted);
            }
            finally {
                await rm(scratch, { force: true });
            }
        }
        const tileset = await registerTileset(projectId, {
            id: newTilesetId(),
            name: sample.name,
            bytes,
            known: { shape: sample.shape, cell: { width: targetCell, height: targetCell }, animRows: sample.animRows, builtin: true },
            projectGrid: { width: targetCell, height: targetCell }
        }, warnings);
        await patchMapProject(projectId, (fresh) => {
            fresh.tilesets.push(tileset);
            fresh.stages.assets = { status: "done", at: new Date().toISOString(), approved: fresh.stages.assets.approved };
        });
        created.push(tileset);
    }
    if (created.length > 0) {
        await patchMapProject(projectId, (fresh) => {
            appendJobLog(fresh.logs, "info", `导入内置素材：${created.map((tileset) => tileset.name).join("、")}`);
        });
    }
    return { tilesets: created, warnings };
}
// ── AI 生成素材：把对话里生成的一批帧整理成一张暂存的素材图 ────────────────
/** 一帧源图的字节上限（与上传那条路同一个上限）。 */
const FRAME_MAX_BYTES = 30 * 1024 * 1024;
/** 一列最多几帧。 */
const FRAME_COUNT_MAX = 64;
/**
 * 把「AI 生成的那几张图」按**事先定好的素材形态**整理成一张可直接导入的素材图，
 * 落在项目的 `ai/` 暂存区。
 *
 * 与 `importMapTileset` 的分工：这里**不进素材列表**。素材的属性在新增那一刻定死、
 * 之后只能删掉重来，所以放给用户在地图编辑器的「新增素材」窗口里确认一次
 * （名字 / 格子 / 用法 / 会动吗都预填好）—— 对话替用户把图整理好，但不替他拍板。
 *
 * 几何口径全在这里定死，调用方（对话里的 agent）不需要自己算：
 *   · **格子 = 地图网格**（`cell` 留空时）。图块按原始尺寸画在格子左上角，一格素材
 *     与网格不同尺寸就会压到邻居格上；
 *   · 普通：每张裁成方格 → 竖排（`stackFrames`）；
 *   · 整格：**一块**无缝墙砖 → 从同一块砖的像素拼出 16 种接法（`corner16SheetFromTile`），
 *     「断」的边由代码加收口；
 *   · 拼块：每个变体**一块**无缝砖 → 拼出 N 列 × 5 行（`a2SheetFromTiles`），
 *     每一格的四个小格按它自己那一侧的接法加收口。
 *
 * ⚠️ 整格 / 拼块**不再让模型直接画多格排布**：模型画的 n 个格子是各自独立的，而地图上
 * 相邻两格常常取自不同格子 —— 实测一条墙的接缝处边缘差 201、块内相邻列才 58，就是那条
 * 「接缝」。把「一块砖」交给模型、把「怎么拼」留给代码，接缝等于砖自身的环绕缝（最好的
 * 可能值），`tileSeamRatios` 还会把这个环绕缝量出来写进 `notes`。
 */
export async function composeMapAsset(input) {
    const project = await readProjectOrThrow(input.projectId);
    const files = (input.files ?? []).map((file) => String(file));
    if (files.length === 0)
        throw new Error("没有可整理的帧：files 不能为空。");
    if (files.length > FRAME_COUNT_MAX)
        throw new Error(`一份素材最多 ${FRAME_COUNT_MAX} 张图，收到 ${files.length} 张。`);
    const shape = parseTilesetShape(input.shape) ?? "plain";
    const cell = normalizeCell(input.cell) ?? { width: project.grid.tileWidth, height: project.grid.tileHeight };
    /**
     * 整图：**每张图 = 一帧的整张图**（不是一格），占几格由 `stampCols / stampRows` 定。
     *
     * 与另外三种形态的区别：普通 / 整格 / 拼块都是「一块砖或一格内容」，
     * 整图是「一张画占 N×M 格」—— 所以这里不做任何「从一块砖拼出全部格子」的事，
     * 只把每帧缩到 `cols × rows` 格、竖排、交给导入端的烘焙（4 个旋转）。
     */
    const stampSpec = shape === "stamp"
        ? parseStampSpec({ cols: input.stampCols, rows: input.stampRows, frames: files.length })
        : undefined;
    if (shape === "stamp" && stampSpec === undefined) {
        throw new Error(`整图要给「占几格」：stampCols / stampRows（${STAMP_MIN_CELLS}~${STAMP_MAX_CELLS}）。`);
    }
    /** 一张整图最多和整张地图一样大（再大地图上也画不全）。 */
    if (stampSpec !== undefined) {
        const owning = await readTheDoc(project.id);
        if (owning !== undefined)
            assertStampFitsProject(stampSpec, owning.cols, owning.rows);
    }
    /**
     * 整格只有 16 块、**没有「帧」这一维**（4×4 全是接法，动画行也是接法行），
     * 所以多给几张只有两种可能：形态判断错了，或者想要「会动的整格」（做不到）。
     * 两种都要说清楚 —— 默默用第一张会浪费一次真实计费的生图，只回一句「张数不对」
     * 则会让调用方/用户一直以为是参数问题。
     */
    if (shape === "corner16" && files.length !== 1) {
        throw new Error(`整格自动连接的素材需要**一块**无缝墙砖（收到 ${files.length} 张：16 种接法由宿主从这一块拼出来）。` +
            `整格**没有动画** —— 它只有 16 种接法，多出来的帧没有地方放；想要「既自动连接、又会动」的素材请改用拼块（a2quad），它的帧数就是变体。`);
    }
    const animRows = shape === "plain" ? input.animRows ?? files.length > 1 : false;
    const frames = [];
    /** 每张源图裁掉了多少边（全部为 0 时说明没白边，不用提）。 */
    const trimmedAmounts = [];
    /** 整图抠背景的结果（keyed = 被判成背景的像素占比；0 = 没抠）。 */
    const keyedAmounts = [];
    const keyColor = normalizeKeyColor(input.keyColor);
    const screen = keyScreenName(keyColor, "zh");
    for (const file of files) {
        let info;
        try {
            info = await stat(file);
        }
        catch {
            throw new Error(`读不到帧文件：${file}`);
        }
        if (!info.isFile())
            throw new Error(`不是文件：${file}`);
        if (info.size > FRAME_MAX_BYTES) {
            throw new Error(`帧文件 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过上限 ${FRAME_MAX_BYTES / 1024 / 1024}MB：${file}`);
        }
        /**
         * 模型经常在四周留一圈白边（提示词里写了「不要留边」也拦不住）。裁边要在**这里**做：
         * ① 这一步拿到的是原图，裁剪无损；② 拼成一张素材图之后再裁就只能裁到整张的边，
         * 多帧竖排时中间几帧的白框裁不到。
         */
        /**
         * 整图先抠绿幕：它是「立在格子上的物件」，绿幕是模型加的假背景 ——
         * 留着会在地图上出现一块绿框，而且把本该空着的角落也涂满。
         * 其它形态不抠（它们的背景就是材质本身）。
         */
        const keyed = shape === "stamp" ? keyStampBackground(await decodeFile(file), (rgba, width, height) => keyGreen(rgba, width, height, { ...STAMP_KEY_OPTIONS, keyColor })) : undefined;
        if (keyed !== undefined)
            keyedAmounts.push(keyed.keyed);
        const trimmed = trimUniformBorder(keyed === undefined ? (keyed === undefined ? await decodeFile(file) : keyed.bitmap) : keyed.bitmap);
        trimmedAmounts.push({ file, left: trimmed.left, top: trimmed.top, right: trimmed.right, bottom: trimmed.bottom });
        frames.push(trimmed.bitmap);
    }
    /**
     * 「图片最终处理的清晰度」：**这一步先不缩到格子**。
     *
     * 用户在「新增素材」里选好清晰度再缩，才可能真的更清楚 —— 如果这里就用最近邻缩到
     * 32px，细节已经丢了，后面再选什么算法都救不回来。所以这里只留到 `cell × k`
     * （k 由源图每块多大决定，上限 `MAX_ASSET_SCALE`），并把这个倍数交给回链：
     * 「新增素材」据此知道「这张图每格 128px，导入时按清晰度缩到 32px」。
     */
    const sourceBlockPx = (() => {
        if (shape === "corner16")
            return frames[0].width; // 一张 = 一块
        if (shape === "a2quad")
            return Math.min(frames[0].width, Math.round(frames[0].height / A2_ROWS)); // 一张 = 一列 5 行
        /**
          * 整图：一张 = 一整幅画（cols × rows 格）。按「一格平均多少像素」估倍数，
          * 这样 2048 的图对上 3×3 格时会留到 4 倍，导进 32px 格子也还够细。
          */
        if (shape === "stamp") {
            const spec = stampSpec;
            return Math.min(frames[0].width / spec.cols, frames[0].height / spec.rows);
        }
        return Math.min(frames[0].width, frames[0].height); // 普通：一张 = 一格
    })();
    const scale = Math.max(1, Math.min(MAX_ASSET_SCALE, Math.floor(sourceBlockPx / Math.max(1, Math.min(cell.width, cell.height)))));
    const bigCell = { width: cell.width * scale, height: cell.height * scale };
    const plan = sheetPlanOf(shape, bigCell, frames.length, stampSpec);
    const notes = [];
    if (shape === "stamp") {
        const keyedCount = keyedAmounts.filter((fraction) => fraction > 0).length;
        if (keyedCount > 0) {
            const average = keyedAmounts.reduce((sum, value) => sum + value, 0) / keyedAmounts.length;
            notes.push(`已抠掉${screen}背景（平均 ${Math.round(average * 100)}% 的像素变成透明${keyedCount < frames.length ? `，${keyedCount}/${frames.length} 张抠掉了` : ""}）：` +
                `整图是「立在格子上的物件」，背景要透明才看得见地砖；留着背景的话地图上会多出一块色块。`);
        }
        else {
            notes.push(`**没检测到${screen}背景**：这次按原图用了（画面会连背景一起印到地图上）。想要背景透明，让模型把背景画成**纯色 ${keyColor}**（不要渐变 / 阴影），或者自己用透明 PNG。`);
        }
    }
    {
        const touched = trimmedAmounts.filter((entry) => entry.left + entry.top + entry.right + entry.bottom > 0);
        if (touched.length > 0) {
            const first = touched[0];
            const sides = [first.left > 0 ? `左 ${first.left}px` : "", first.top > 0 ? `上 ${first.top}px` : "", first.right > 0 ? `右 ${first.right}px` : "", first.bottom > 0 ? `下 ${first.bottom}px` : ""].filter(Boolean).join("、");
            notes.push(`自动裁掉了四周的纯色边框（${sides}${touched.length > 1 ? `，${touched.length}/${frames.length} 张都有` : ""}）：模型在提示词之外另留了一圈边，` +
                `留着的话每块素材边上都会带一道白框。裁完才是真正的画面范围。`);
        }
    }
    /**
     * 源图比例与目标差得多时提醒一句：整格 / 拼块要的是**一块方砖**，长宽比差得多会被
     * 拉伸（内容变形，但砖的性质还在）；普通要的是格子比例。
     */
    /** 整图比的是「整张画」的比例（cols × rows 格），不是一格的方形。 */
    const targetRatio = stampSpec === undefined ? cell.width / cell.height : (stampSpec.cols * cell.width) / (stampSpec.rows * cell.height);
    const sourceRatios = frames.map((frame) => frame.width / frame.height);
    const worst = sourceRatios.reduce((acc, ratio) => Math.max(acc, Math.abs(Math.log(ratio / targetRatio))), 0);
    if (worst > Math.log(1.6)) {
        const wanted = stampSpec === undefined ? `${cell.width}:${cell.height}` : `${stampSpec.cols * cell.width}:${stampSpec.rows * cell.height}（整张 ${stampSpec.cols}×${stampSpec.rows} 格）`;
        notes.push(`这张图要求的长宽比是 ${wanted}（${shape === "corner16" ? "整格" : shape === "a2quad" ? "拼块" : "普通"}素材的**一块**），模型给的是 ${sourceRatios
            .map((ratio) => ratio.toFixed(2))
            .join(" / ")}：已经拉伸对齐，但内容会被压扁或拉长。下次可以在提示词里要求按这个比例出图。`);
    }
    /**
     * 砖自身的环绕缝：整格 / 拼块的图都是「一块砖铺出去」，砖左右 / 上下接不上自己的话，
     * 地图上每隔一格就会出现一道可见的缝 —— 那正是这次要根除的东西，所以必须量出来说清。
     */
    if (shape !== "plain" && shape !== "stamp") {
        const seams = frames.map((frame) => tileSeamRatios(resampleToSize(frame, Math.max(1, Math.floor(cell.width)), Math.max(1, Math.floor(cell.height)), "smooth")));
        const bad = seams.filter((seam) => Math.max(seam.horizontal, seam.vertical) > 2.2);
        if (bad.length > 0) {
            const worstSeam = bad.reduce((acc, seam) => (Math.max(seam.horizontal, seam.vertical) > Math.max(acc.horizontal, acc.vertical) ? seam : acc), bad[0]);
            notes.push(`这块砖自己接不上自己（左右缝是内部的 ${worstSeam.horizontal.toFixed(1)} 倍、上下缝是 ${worstSeam.vertical.toFixed(1)} 倍）：平铺出去每隔一格会有一道可见的缝。` +
                `让模型重画一张**四边都能与自身相接**的无缝材质（画面均匀、边缘不要有只出现一次的细节），比调格子参数有用。`);
        }
    }
    /**
     * 大图 → `cell × k` 这一步同样是**缩小**（2048 → 128 也有 16 倍），最近邻一样会走样，
     * 所以这里固定用面积平均；用户选的清晰度作用于最后那一步 `k× → 1×`（导入时）。
     */
    const sheet = stampSpec === undefined ? composeAssetSheet(frames, plan, "smooth") : composeStampSource(frames, stampSpec, bigCell, "smooth");
    const name = input.name === undefined || String(input.name).trim() === "" ? "AI 素材" : String(input.name).trim();
    const file = `ai/${safeAssetStem(name)}.png`;
    await mkdir(join(mapProjectDir(project.id), "ai"), { recursive: true });
    await writeFile(mapAssetPath(project.id, file), encodeBitmap(sheet));
    const shapeLabel = shape === "plain" ? "普通" : shape === "corner16" ? "整格" : shape === "a2quad" ? "拼块" : "整图";
    await patchMapProject(project.id, (fresh) => {
        appendJobLog(fresh.logs, "info", `整理 AI 素材：${name}（${shapeLabel} / ${frames.length} 张 → ${sheet.width}×${sheet.height}${scale > 1 ? `，每格 ${bigCell.width}px（${scale} 倍，导入时按清晰度缩到 ${cell.width}px）` : ""}，落在 ${file}，等你在「新增素材」里确认）`);
    });
    const localPath = mapAssetPath(project.id, file);
    return {
        file,
        localPath,
        previewPath: localPath,
        name,
        shape,
        cell,
        width: sheet.width,
        height: sheet.height,
        frameCount: shape === "corner16" ? 1 : frames.length,
        variants: shape === "a2quad" ? frames.length : 1,
        animRows,
        /** 仅整图：占几格 / 几帧（回链据此预填「占几格」）。 */
        ...(stampSpec === undefined ? {} : { stamp: { cols: stampSpec.cols, rows: stampSpec.rows, frames: stampSpec.frames } }),
        ...(stampSpec === undefined ? {} : { keyed: keyedAmounts.reduce((sum, value) => sum + value, 0) / Math.max(1, keyedAmounts.length) }),
        /** 这张素材图是「每格几倍分辨率」：1 = 就是格子大小；>1 = 导入时还要按清晰度缩一次。 */
        scale,
        notes
    };
}
function newTilesetId() {
    return `ts${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
}
/**
 * 登记一张素材图：写原图 → 量尺寸 → 定形态与格子 → 建块。
 *
 * `known` 是内置素材那条路：它的形态与格子是**生成时就知道的**（不用再猜）。
 */
async function registerTileset(projectId, input, warnings) {
    /**
     * ⚠️ 用户填的属性**先校验**，再写文件：`normalizeCell` 对不合法的尺寸是**抛错**的
     * （明确拒绝，不静默改成别的值），而原图是在这个函数里写盘的 —— 先写后抛会留下孤儿图。
     */
    const overrideCell = input.overrides?.cell === undefined ? undefined : normalizeCell(input.overrides.cell);
    const loop = parseAssetLoop(input.overrides?.loop);
    const clarity = parseClarity(input.overrides?.clarity);
    const scale = parseAssetScale(input.overrides?.scale);
    /**
     * 整图：规格（占几格 / 几帧 / 区域）先解析、先校验 —— 与别的属性一样「先校验再写文件」。
     * 有规格就**强制**形态为 `stamp`（用户不用再选一次，也避免「选了整图却没给占格」）。
     */
    const stamp = parseStampSpec(input.overrides?.stamp);
    /**
     * 整图最多和整张地图一样大。校验放在**写盘之前**（与其它属性同一个原则）：
     * `projectGrid` 是像素，这里用不到 —— 地图格子数从项目里现读（`registerTileset` 有 projectId）。
     */
    if (stamp !== undefined) {
        // 格子数是**地图文档**的属性（`MapDoc.cols/rows`），不在 project.json 里。
        const owning = await readTheDoc(projectId);
        if (owning !== undefined)
            assertStampFitsProject(stamp, owning.cols, owning.rows);
    }
    const forcedShape = parseTilesetShape(input.overrides?.shape);
    const ext = sniffImageExt(input.bytes);
    const relative = `tilesets/${input.id}.${ext}`;
    await mkdir(join(mapProjectDir(projectId), "tilesets"), { recursive: true });
    /**
     * 「图片最终处理的清晰度」就是在这一步生效的：
     * 素材图如果是「每格 k 倍分辨率」（AI 生成的那条路会带 `scale`），先按用户选的清晰度
     * 缩到 1 倍再落盘 —— 于是**存下来的素材图正好是格子大小**，调色板 / 渲染 / legend
     * 全都不用改，缩小的算法只在这一处决定。
     *
     * `scale = 1`（自己导一张格子大小的图，绝大多数情况）时一个像素都不动。
     */
    const target = mapAssetPath(projectId, relative);
    // 先落原字节（解码要读盘），`scale > 1` 时再把它换成缩好的那份。
    await writeFile(target, input.bytes);
    let storedBytes = input.bytes;
    /**
     * 整图的格子**必须等于地图网格**（整图一次占 N×M 格，格子不符就必然错位），
     * 所以这里直接拿项目网格当格尺寸，并缩到 `占格 × 帧数` 的目标尺寸再烘焙 4 个旋转。
     */
    const stampCell = stamp === undefined ? undefined : (overrideCell ?? { width: input.projectGrid?.width ?? 32, height: input.projectGrid?.height ?? 32 });
    try {
        // 「导入时抠绿幕」：手动导一张带绿幕的整图时用（AI 那条路在 composeMapAsset 里已经抠过）。
        const keyedSource = input.overrides?.stampKey === true;
        const keyColor = normalizeKeyColor(input.overrides?.keyColor);
        if (stamp !== undefined && stampCell !== undefined) {
            const rawSource = await decodeFile(target);
            const source = keyedSource ? keyStampBackground(rawSource, (rgba, width, height) => keyGreen(rgba, width, height, { ...STAMP_KEY_OPTIONS, keyColor })).bitmap : rawSource;
            if (keyedSource) {
                // 抠完的源图要写回去：下面 resample + 烘焙读的是盘上这份（也便于排查）。
                storedBytes = encodeBitmap(source);
                await writeFile(target, storedBytes);
            }
            const targetWidth = Math.max(1, stamp.cols * stampCell.width);
            const targetHeight = Math.max(1, stamp.rows * stamp.frames * stampCell.height);
            /**
             * ⚠️ 长宽比对不上时说一声：占几格填错了（例如 3×3 填成 3×2）时，画面会被拉伸，
             * 而「拉伸」这件事本身不报错、只体现在肉眼里。
             */
            const ratioSource = source.width / Math.max(1, source.height);
            const ratioTarget = targetWidth / Math.max(1, targetHeight);
            if (Math.abs(ratioSource - ratioTarget) / Math.max(1e-6, ratioTarget) > 0.05) {
                warnings.push(`这张图的长宽比（${source.width}×${source.height}）和「占 ${stamp.cols}×${stamp.rows} 格 × ${stamp.frames} 帧」对不上，` +
                    `已经按目标尺寸拉齐 —— 如果画面看起来被压扁/拉长，多半是占格填错了，删掉重新新增一张。`);
            }
            void targetWidth;
            void targetHeight;
            // 缩到「一格 = 一格地图格子」再烘 4 个旋转（与原地重烘同一条口径）。
            const baked = stampTilesetImage(source, stamp, stampCell, clarity);
            storedBytes = encodeBitmap(baked);
            await writeFile(target, storedBytes);
        }
        else if (scale > 1) {
            const source = await decodeFile(target);
            const fitted = resampleToSize(source, Math.max(1, Math.round(source.width / scale)), Math.max(1, Math.round(source.height / scale)), clarity);
            storedBytes = encodeBitmap(fitted);
            await writeFile(target, storedBytes);
        }
    }
    catch (error) {
        // 缩图失败不能留下一张「半成品」素材图：删掉再抛，用户重试时不会撞见上一张坏图。
        await rm(target, { force: true });
        throw error;
    }
    const size = await probeSize(target, storedBytes);
    const guess = input.known ?? detectLayout(size.width, size.height);
    const shape = stamp !== undefined ? "stamp" : (forcedShape ?? guess.shape);
    const cell = stamp !== undefined ? (stampCell ?? guess.cell) : (overrideCell ?? guess.cell);
    const animRows = input.known?.animRows ?? (input.overrides?.animRows === true);
    /** 播放速度：**先校验再写文件**（`parseAssetFps` 对越界值是抛错的，见同一个函数里的注释）。 */
    const fps = parseAssetFps(input.overrides?.fps);
    if (input.projectGrid !== undefined &&
        input.overrides?.cell === undefined &&
        input.known === undefined &&
        (cell.width !== input.projectGrid.width || cell.height !== input.projectGrid.height)) {
        warnings.push(`这张素材一格是 ${cell.width}×${cell.height}，而地图格子是 ${input.projectGrid.width}×${input.projectGrid.height} —— ` +
            `图块只会画在格子左上角，看起来像缩小了一圈。导入时把「格子大小」填成 ${input.projectGrid.width}×${input.projectGrid.height}（= 地图网格）就对了。`);
    }
    if (!commonSizeFits(size.width, size.height)) {
        // ⚠️ 文案要跟着产品规则走：属性在新增时定死、界面不再提供修改入口 ——
        // 所以这里告诉用户「删掉重新新增」，而不是让他去找一个界面上没有的入口。
        warnings.push(`这张图（${size.width}×${size.height}）不是常见瓦片尺寸的整数倍，已按 ${cell.width}×${cell.height} 试切；不对的话删掉它、按你想要的格子大小重新新增一张。`);
    }
    const tiles = buildTiles({ shape, cell, imageWidth: size.width, imageHeight: size.height, animRows, stamp });
    const tileset = {
        id: input.id,
        name: input.name,
        file: relative,
        imageWidth: size.width,
        imageHeight: size.height,
        cell,
        shape,
        animRows,
        stamp,
        variants: stamp === undefined ? variantsOf(shape, cell, size.width, size.height, animRows) : stamp.frames,
        loop,
        clarity,
        fps,
        // 内置素材：属性**不允许修改**（见 saveMapTileset），可以整张删掉，也能一键恢复
        builtin: input.known?.builtin === true ? true : undefined,
        tiles
    };
    assignCorner16Masks(tileset, warnings);
    return tileset;
}
/** 整格自动连接（corner16）要的块数（就是 16 个邻接掩码）。 */
const CORNER16_COUNT = 16;
/**
 * 给「整格自动连接」素材按位序配掩码（`mapauto` 的 N=1 / E=2 / S=4 / W=8）。
 *
 * ⚠️ 这一段以前**根本没人写**：`MapTile.mask` 只声明不赋值，于是 `maprender` 永远走
 * 「一块掩码都没配」的兜底 —— 整张图只画第一块，而界面上「整格自动连接」是个已经
 * 摆出来的选项，用户选了等于什么都没发生（还不报错）。契约 §3 写的是「导入时由宿主
 * 按位序一次性算好」，落点就在这里。
 *
 * - 只有**恰好 16 块**时才自动配（行优先第 i 块 = 掩码 i，正好是 4×4 的位序表）；
 * - 块数不对就**一块都不配**，把原因写进 warnings（界面会显示出来）；
 * - 已经配过的一律不动：重切 / 换格子尺寸时 `buildTiles` 会按「矩形 id」整份继承旧
 *   tile（含 mask），所以人工调过的位序不会被冲掉。
 */
function assignCorner16Masks(tileset, warnings) {
    if (tileset.shape !== "corner16")
        return;
    if (tileset.tiles.every((tile) => typeof tile.mask === "number"))
        return;
    if (tileset.tiles.length !== CORNER16_COUNT) {
        warnings.push(`整格自动连接需要 ${CORNER16_COUNT} 块，这张素材有 ${tileset.tiles.length} 块：没有自动配掩码，画出来会统一用第一块。`);
        return;
    }
    tileset.tiles.forEach((tile, index) => {
        tile.mask = index;
    });
}
/** 尺寸能不能被常见瓦片尺寸整除（A2 图另有一条 `height === 5×格子高` 的规则）。 */
function commonSizeFits(width, height) {
    return COMMON_TILE_SIZES.some((size) => width % size === 0 && height % size === 0) || COMMON_TILE_SIZES.some((size) => height === size * 5 && width % size === 0);
}
async function probeSize(file, bytes) {
    const fromHeader = pngSize(bytes);
    if (fromHeader !== undefined)
        return fromHeader;
    return probeImageSize(file);
}
/**
 * 改素材（名称 / 格子尺寸 / 形态 / 逐行动画）。
 *
 * ⚠️ 改了这些，图块序号可能整体平移 —— 地图里存的是序号，**必须按
 * 「素材 id + 图块 id」把地图的每一格重新映射**，否则会出现「明明画了却
 * 变成别的块」：序号指向了新表里的另一个位置。对不上的格子清零并计数。
 */
export async function saveMapTileset(projectId, tilesetId, patch) {
    const project = await readProjectOrThrow(projectId);
    const beforeKeys = indexKeys(project.tilesets);
    const warnings = [];
    const nextCell = normalizeCell(patch.cell);
    const nextShape = parseTilesetShape(patch.shape);
    let updated;
    await patchMapProject(projectId, (fresh) => {
        const tileset = fresh.tilesets.find((item) => item.id === tilesetId);
        if (tileset === undefined)
            throw new Error(`素材不存在：${tilesetId}`);
        /**
         * 内置素材：**表现层属性可以改**（名字 / 播放速度 / 循环方式），**几何不许改**
         * （形态 / 格子尺寸 —— 那会重切图块、把画过的格子整体错位，而且内置素材是按 32 格画的）。
         *
         * 老约定是「内置一律不许改」，但用户要的恰恰是「改名 / 调速度」这类轻量改动，
         * 所以这里把边界收在「几何」上，而不是「整张图」。
         */
        const touchesGeometry = patch.cell !== undefined ||
            patch.shape !== undefined ||
            (typeof patch.animRows === "boolean" && patch.animRows !== tileset.animRows) ||
            (nextCell !== undefined && (nextCell.width !== tileset.cell.width || nextCell.height !== tileset.cell.height)) ||
            (nextShape !== undefined && nextShape !== tileset.shape);
        if (tileset.builtin === true && touchesGeometry) {
            throw new Error(`「${tileset.name}」是内置素材：名字 / 播放速度 / 循环方式 / 整图的通行区域可以改，形态与格子尺寸不能改 —— 想换就自己新增一张。`);
        }
        if (typeof patch.name === "string" && patch.name.trim() !== "")
            tileset.name = patch.name.trim();
        /**
         * 整图的**逐格通行区域**：只改「这格能不能走 / 谁盖住谁」，不动几何、不动图块序号，
         * 所以和名字 / 速度一样随时能改（地图上已经印好的整图下一次 `mapPlan` 就用新值）。
         *
         * 长度必须与 `cols*rows` 一致：短了会被 `parseStampSpec` 按 0 补齐 ——
         * 那等于把用户没点过的格子静默改成「不可通过」，不报错、只在走位时绊住。
         */
        if (patch.stampPass !== undefined) {
            if (tileset.shape !== "stamp" || tileset.stamp === undefined) {
                throw new Error(`「${tileset.name}」不是整图素材，没有「哪些格子能走」这一项可改。`);
            }
            const expected = tileset.stamp.cols * tileset.stamp.rows;
            if (!Array.isArray(patch.stampPass) || patch.stampPass.length !== expected) {
                throw new Error(`整图的通行区域要给 ${expected} 个值（${tileset.stamp.cols}×${tileset.stamp.rows}），收到 ${Array.isArray(patch.stampPass) ? `${patch.stampPass.length} 个` : "的不是数组"}。`);
            }
            const nextStamp = parseStampSpec({
                cols: tileset.stamp.cols,
                rows: tileset.stamp.rows,
                frames: tileset.stamp.frames,
                pass: patch.stampPass
            });
            if (nextStamp !== undefined && JSON.stringify(nextStamp.pass) !== JSON.stringify(tileset.stamp.pass)) {
                tileset.stamp = nextStamp;
                const walkable = nextStamp.pass.filter((value) => value !== 0).length;
                appendJobLog(fresh.logs, "info", `改素材通行区域：${tileset.name}（${walkable}/${expected} 格能走）`);
            }
        }
        /**
         * 播放速度是**表现层属性**（不动几何、不动序号），所以单独走一条：不触发重切、
         * 不重映射图层数据，只是换个数 —— 想调快调慢随时改，不用删掉重来。
         * `null` = 清掉（跟「设置 → 动画速度」那条全局速度走）。
         */
        /**
         * 循环方式：只改「帧序怎么展开」，同样不动几何 / 序号，随时能改。
         * 改完立刻生效（下一次 `mapPlan` 就是新帧序），不需要重切素材。
         */
        if (patch.loop !== undefined) {
            const nextLoop = parseAssetLoop(patch.loop);
            if (nextLoop !== tileset.loop) {
                tileset.loop = nextLoop;
                appendJobLog(fresh.logs, "info", `改素材循环方式：${tileset.name}（${nextLoop === "forward" ? "正放" : nextLoop === "reverse" ? "倒放" : "来回"}）`);
            }
        }
        if (patch.fps !== undefined) {
            const nextFps = parseAssetFps(patch.fps);
            if (nextFps !== tileset.fps) {
                tileset.fps = nextFps;
                appendJobLog(fresh.logs, "info", `改素材播放速度：${tileset.name}（${nextFps === undefined ? "跟全局" : `${nextFps} 帧/秒`}）`);
            }
        }
        const shape = patch.shape ?? tileset.shape;
        const cell = nextCell ?? tileset.cell;
        const animRows = typeof patch.animRows === "boolean" ? patch.animRows : tileset.animRows;
        const changed = shape !== tileset.shape || cell.width !== tileset.cell.width || cell.height !== tileset.cell.height || animRows !== tileset.animRows;
        if (changed) {
            const previousIds = new Set(tileset.tiles.map((tile) => tile.id));
            tileset.shape = shape;
            tileset.cell = cell;
            tileset.animRows = animRows;
            tileset.variants = variantsOf(shape, cell, tileset.imageWidth, tileset.imageHeight, animRows);
            tileset.tiles = buildTiles({ shape, cell, imageWidth: tileset.imageWidth, imageHeight: tileset.imageHeight, animRows }, tileset.tiles);
            const removed = [...previousIds].filter((id) => !tileset.tiles.some((tile) => tile.id === id)).length;
            if (removed > 0)
                warnings.push(`${removed} 块的元数据随切分变化被丢掉（矩形已经不存在了）。`);
            appendJobLog(fresh.logs, "info", `改素材形态：${tileset.name}（${shape} / ${cell.width}×${cell.height}）`);
        }
        // 换形态也要能补掩码：用户可能先按普通图块导入、后来才改成「整格自动连接」。
        assignCorner16Masks(tileset, warnings);
        updated = tileset;
    });
    if (updated === undefined)
        throw new Error(`素材不存在：${tilesetId}`);
    const fresh = await readProjectOrThrow(projectId);
    const remap = await remapDocToIndices(projectId, beforeKeys, indexKeys(fresh.tilesets));
    warnings.push(...remap.warnings);
    return { tileset: updated, warnings };
}
/** 序号 → 「素材 id / 图块 id」键（重新映射时用它认人，而不是认序号）。 */
function indexKeys(tilesets) {
    return new Map(flatTiles(tilesets).map((tile) => [tile.index, `${tile.tilesetId}/${tile.tile.id}`]));
}
/**
 * 把地图每一格的序号从旧表平移到新表。
 *
 * 找不到对应图块的格子清零并计数：**不清零的后果是静默画错块**（旧序号落到
 * 新表里另一个位置），比报错难查得多。
 */
async function remapDocToIndices(projectId, before, after) {
    const doc = await readTheDoc(projectId);
    if (doc === undefined)
        return { pruned: 0, warnings: [] };
    const newIndexByKey = new Map([...after.entries()].map(([index, key]) => [key, index]));
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
    const warnings = [];
    if (lost > 0)
        warnings.push(`有 ${lost} 个格子指向的图块已经不存在，已清空。`);
    if (remapped > 0)
        warnings.push(`有 ${remapped} 个格子跟着素材变化重新映射了图块序号。`);
    if (lost > 0 || remapped > 0)
        await writeTheDoc(projectId, doc);
    return { pruned: lost, warnings };
}
/** 摘掉引用了某张素材的整图，返回张数（素材被删 / 换过切分时用）。 */
async function dropStampsOfTileset(projectId, tilesetId) {
    const doc = await theDocOrFresh(projectId);
    const keep = doc.stamps.filter((stamp) => stamp.tilesetId !== tilesetId);
    const dropped = doc.stamps.length - keep.length;
    if (dropped === 0)
        return 0;
    doc.stamps = keep;
    doc.updatedAt = new Date().toISOString();
    scheduleDocWrite(projectId, doc);
    await flushMapDoc(projectId);
    return dropped;
}
export async function removeMapTileset(projectId, tilesetId) {
    const project = await readProjectOrThrow(projectId);
    const tileset = project.tilesets.find((item) => item.id === tilesetId);
    if (tileset === undefined)
        throw new Error(`素材不存在：${tilesetId}`);
    const beforeKeys = indexKeys(project.tilesets);
    await patchMapProject(projectId, (fresh) => {
        fresh.tilesets = fresh.tilesets.filter((item) => item.id !== tilesetId);
        appendJobLog(fresh.logs, "info", `移除素材：${tileset.name}`);
    });
    await rm(mapAssetPath(projectId, tileset.file), { force: true });
    const fresh = await readProjectOrThrow(projectId);
    const remap = await remapDocToIndices(projectId, beforeKeys, indexKeys(fresh.tilesets));
    /**
     * 整图是**独立的对象**（不占 `layer.data`），所以 `remapDocToIndices` 清不到它们 ——
     * 素材没了、整图还在的话渲染器只会报一句「素材不见了」而地图上留个洞。这里一起摘掉。
     */
    const droppedStamps = await dropStampsOfTileset(projectId, tilesetId);
    const warnings = [...remap.warnings];
    if (droppedStamps > 0)
        warnings.push(`顺带删掉了 ${droppedStamps} 张用「${tileset.name}」印的整图（素材没了，它们画不出来）。`);
    return { removed: tileset.name, pruned: remap.pruned, warnings };
}
function xorshift32(seed) {
    let state = (seed >>> 0) === 0 ? 0xffffffff : seed >>> 0;
    const next = () => {
        state = (state ^ (state << 13)) >>> 0;
        state = (state ^ (state >>> 17)) >>> 0;
        state = (state ^ (state << 5)) >>> 0;
        return state;
    };
    return {
        upto: (inclusiveMax) => (inclusiveMax <= 0 ? 0 : (next() & 0x7fffffff) % (inclusiveMax + 1))
    };
}
/** 不传种子就现抽一个（返回给调用方，方便「同一个种子再铺一次」）。 */
function normalizeSeed(seed) {
    if (seed === undefined || seed === null)
        return Number.parseInt(randomUUID().slice(0, 8), 16) >>> 0 || 1;
    const n = Math.round(Number(seed));
    if (!Number.isFinite(n))
        throw new Error(`种子必须是整数：${String(seed)}`);
    return (n >>> 0) === 0 ? 0xffffffff : n >>> 0;
}
async function normalizeTilePool(tiles, project) {
    /**
     * 整图**不进随机池**：它一次占 N×M 格、要旋转、还要带区域，按格刷只会得到一堆错位的碎片
     * （`paint` 里对整图的图块序号本来就会跳过）。用户手选了也剔掉，并留一条警告说明原因。
     */
    const flat = flatTiles(project.tilesets);
    const stampValues = new Set();
    for (const tileset of project.tilesets) {
        if (tileset.stamp === undefined)
            continue;
        for (const entry of flat)
            if (entry.tilesetId === tileset.id)
                stampValues.add(entry.index);
    }
    const available = flat.map((tile) => tile.index).filter((index) => !stampValues.has(index));
    if (tiles === undefined || tiles.length === 0)
        return available;
    const max = flat.length;
    return tiles
        .map((value) => {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n) || n < 0 || n > max)
            throw new Error(`图块序号越界：${String(value)}（可选 0..${max}）`);
        return n;
    })
        .filter((n) => !stampValues.has(n));
}
/**
 * 一键铺满某一层（整个操作是**一次提交**，所以一次撤销就能回到原样）。
 *
 * 三种算法都是本机算的、零计费：
 * - `random`：整层在 `tiles` 里均匀随机。
 * - `maze`：奇数尺寸上的迭代 DFS 挖洞；墙 = `tiles[0]`、通路 = `tiles[1] ?? 0`。
 * - `continent`：17×17 菱形四角递归插值 + 种子随机，按 `tiles` 顺序映射
 *   `[浅底, 海, 草地, 雪]`，不足 4 个时回退到 `tiles[0]`。
 */
export async function runMapGenerate(projectId, opts) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const layerId = typeof opts.layerId === "string" && doc.layers.some((layer) => layer.id === opts.layerId) ? opts.layerId : doc.layers[0]?.id;
    if (layerId === undefined)
        throw new Error("地图文档没有图层，先建一层。");
    if (opts.kind !== "random" && opts.kind !== "maze" && opts.kind !== "continent")
        throw new Error(`未知生成算法：${String(opts.kind)}（可选 random / maze / continent）`);
    const pool = await normalizeTilePool(opts.tiles, project);
    const seed = normalizeSeed(opts.seed);
    const warnings = [];
    if (pool.length === 0) {
        warnings.push("没有可铺的图块：整图不能一笔一格地铺（它一次占 N×M 格），先把普通 / 整格 / 拼块素材选进「一键生成」。");
    }
    const values = generateValues(opts.kind, doc.cols, doc.rows, pool, seed, warnings);
    const cells = [];
    for (let r = 0; r < doc.rows; r++) {
        for (let c = 0; c < doc.cols; c++)
            cells.push({ r, c, tile: values[r * doc.cols + c] ?? 0 });
    }
    const ops = [{ kind: "paint", layerId, cells }];
    const result = await applyMapOps(projectId, ops, {});
    await patchMapProject(projectId, (fresh) => {
        const label = opts.kind === "random" ? "随机铺满" : opts.kind === "maze" ? "迷宫" : "大陆";
        appendJobLog(fresh.logs, "info", `一键生成（${label}）：改了 ${result.changed} 格，种子 ${seed}`);
    });
    return { changed: result.changed, seed, warnings: [...warnings, ...result.skipped], revision: result.revision };
}
function generateValues(kind, cols, rows, tiles, seed, warnings) {
    if (kind === "random")
        return generateRandom(cols, rows, tiles, seed, warnings);
    if (kind === "maze")
        return generateMaze(cols, rows, tiles, seed, warnings);
    return generateContinent(cols, rows, tiles, seed, warnings);
}
function generateRandom(cols, rows, tiles, seed, warnings) {
    if (tiles.length === 0) {
        warnings.push("项目里还没有图块：随机铺出来全是空的。先导入素材（或 importSampleTileset 装内置素材）。");
        return new Array(cols * rows).fill(0);
    }
    const rng = xorshift32(seed);
    const out = new Array(cols * rows);
    for (let i = 0; i < out.length; i++)
        out[i] = tiles[rng.upto(tiles.length - 1)];
    return out;
}
/**
 * 迷宫：奇数尺寸上的**迭代 DFS 挖洞**（AsLib `asMazeMapMake` 同款）。
 *
 * 偶数边长按 `cols-1` / `rows-1` 生成，多出来的那一行 / 一列**留空**（0），
 * 并在 warnings 里说清楚 —— 静默丢掉半行比出个缺口更难查。
 */
function generateMaze(cols, rows, tiles, seed, warnings) {
    const width = cols % 2 === 1 ? cols : cols - 1;
    const height = rows % 2 === 1 ? rows : rows - 1;
    const wall = tiles[0] ?? 0;
    const path = tiles.length >= 2 ? tiles[1] : 0;
    if (tiles.length === 0)
        warnings.push("没有指定图块：迷宫只画得出 0（空），先导入素材或用 tiles 指定墙与通路。");
    if (cols % 2 === 0 || rows % 2 === 0)
        warnings.push(`地图尺寸 ${cols}×${rows} 是偶数：迷宫按 ${width}×${height} 生成，多出来的那一行 / 一列留空。`);
    const out = new Array(cols * rows).fill(0);
    if (width < 3 || height < 3) {
        warnings.push(`地图太小（${cols}×${rows}）：迷宫至少要 3×3，这一层留空。`);
        return out;
    }
    for (let r = 0; r < height; r++)
        for (let c = 0; c < width; c++)
            out[r * cols + c] = wall;
    const rng = xorshift32(seed);
    const visited = new Uint8Array(cols * rows);
    const stack = [{ r: 1, c: 1 }];
    out[cols + 1] = path;
    visited[cols + 1] = 1;
    const steps = [
        { dr: -1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: 1 }
    ];
    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const options = steps.filter((step) => {
            const r = current.r + step.dr * 2;
            const c = current.c + step.dc * 2;
            return r > 0 && r < height - 1 && c > 0 && c < width - 1 && visited[r * cols + c] === 0;
        });
        if (options.length === 0) {
            stack.pop();
            continue;
        }
        const step = options[rng.upto(options.length - 1)];
        const nextR = current.r + step.dr * 2;
        const nextC = current.c + step.dc * 2;
        out[(current.r + step.dr) * cols + (current.c + step.dc)] = path;
        out[nextR * cols + nextC] = path;
        visited[nextR * cols + nextC] = 1;
        stack.push({ r: nextR, c: nextC });
    }
    return out;
}
/**
 * 世界地图的节点网格：17×17 个节点 = 16×16 个格子（AsLib 的区块边长同款）。
 *
 * 区块边长固定 16：地图尺寸不是 16 的倍数时，最后一个区块照样按 16 格生成高度场，
 * **只取实际存在的那几格**（补齐 + 裁掉）—— 少这一步，接缝上的节点就对不齐了。
 */
const WORLD_CHUNK = 16;
const WORLD_NODES = WORLD_CHUNK + 1;
/**
 * 大陆 / 海岛：AsLib `asWorldMapSimplePaint` 那套（四角随机 + 菱形方形递归）。
 *
 * ## 为什么角点必须是**纯函数**
 *
 * 第一版给每个区块开一条独立随机流、各抽四个角，结果相邻区块在共享边上取值不同：
 * 48×48 导出成 PNG 就是一盘**轴对齐的大矩形**（一整块纯蓝、一整块纯棕，中间一个硬十字）。
 * 现在角点高度只由「全局角点坐标」决定（`cornerHeight`），于是：
 *
 * - 区块 `(i,j)` 的右下角 == 区块 `(i+1,j+1)` 的左上角；
 * - 区块 `(i,j)` 的右边 == 区块 `(i+1,j)` 的左边（角点相同 ⇒ 两边的第一次插值相同）；
 * - 连**边中点的抖动**也只由「全局节点坐标 + 这一层的 size」决定，所以整条共享边在
 *   两个区块里算出来的是同一个值 —— 接缝处不会有细缝。
 */
function generateContinent(cols, rows, tiles, seed, warnings) {
    const under = tiles[0] ?? 0;
    const sea = tiles[1] ?? under;
    const green = tiles[2] ?? under;
    const snow = tiles[3] ?? under;
    if (tiles.length < 4)
        warnings.push(`只给了 ${tiles.length} 个图块：大陆按「浅底 / 海 / 草地 / 雪」的顺序取，缺的回退到第 1 块。`);
    if (tiles.length === 0)
        warnings.push("项目里还没有图块：大陆铺出来全是空的。先导入素材（或 importSampleTileset 装内置素材）。");
    const out = new Array(cols * rows).fill(under);
    const chunkCols = Math.max(1, Math.ceil(cols / WORLD_CHUNK));
    const chunkRows = Math.max(1, Math.ceil(rows / WORLD_CHUNK));
    for (let chunkI = 0; chunkI < chunkCols; chunkI++) {
        for (let chunkJ = 0; chunkJ < chunkRows; chunkJ++) {
            const baseI = chunkI * WORLD_CHUNK;
            const baseJ = chunkJ * WORLD_CHUNK;
            const levels = worldLevels(seed, chunkI, chunkJ);
            for (let i2 = 0; i2 < WORLD_CHUNK; i2++) {
                const r = baseI + i2;
                if (r >= rows)
                    break;
                for (let j2 = 0; j2 < WORLD_CHUNK; j2++) {
                    const c = baseJ + j2;
                    if (c >= cols)
                        break;
                    const level = levels[i2][j2];
                    // 色带照 AsLib 原样：<15 雪、≤50 草地、(50,110] 浅底、>110 海。
                    out[r * cols + c] = level < 15 ? snow : level <= 50 ? green : level <= 110 ? under : sea;
                }
            }
        }
    }
    return out;
}
/** 全局角点高度：**只看角点坐标**（相邻区块共享的那个角必然算出同一个值）。 */
function cornerHeight(seed, cornerI, cornerJ) {
    // 种子混合式照 AsLib：seed + i + j*0x3220 + (i^j)*0x292。
    const mixed = (seed + cornerI + Math.imul(cornerJ, 0x3220) + Math.imul(cornerI ^ cornerJ, 0x292)) >>> 0;
    return xorshift32(mixed === 0 ? 0xffffffff : mixed).upto(255);
}
/**
 * 一个节点的抖动：**全局节点坐标 + 这一层的 size** 的纯函数。
 *
 * 「纯」是接缝连续的关键：共享边上的节点会被左右两个区块各算一次，只有输入完全一样
 * 才会得到同一个高度。用 `Map` 缓存没有必要 —— 一次 48×48 也就几千次哈希。
 */
function nodeJitter(seed, nodeI, nodeJ, size) {
    if (size <= 0)
        return 0;
    let hash = (seed ^ Math.imul(nodeI + 1, 0x3220) ^ Math.imul(nodeJ + 1, 0x292) ^ Math.imul(size + 1, 0x9e3779b1)) >>> 0;
    hash = (hash ^ (hash >>> 15)) >>> 0;
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
    hash = (hash ^ (hash >>> 13)) >>> 0;
    hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
    return ((hash ^ (hash >>> 16)) >>> 0) % (size + 1);
}
function clamp255(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
}
/**
 * 一个区块的高度场：四角取自 `cornerHeight` → 菱形方形递归到 **size === 1**（每格一个节点）。
 *
 * 每个节点都只赋值一次（正方形中心 + 四条边中点），所以共享边的两边输入相同、
 * 结果也相同。边的中点**也加抖动**：只做平均的话一个区块就是一块平板（AsLib 的观感上限）。
 */
function worldLevels(seed, chunkI, chunkJ) {
    const levels = Array.from({ length: WORLD_NODES }, () => new Array(WORLD_NODES).fill(0));
    const baseI = chunkI * WORLD_CHUNK;
    const baseJ = chunkJ * WORLD_CHUNK;
    const last = WORLD_CHUNK;
    const topLeft = cornerHeight(seed, baseI, baseJ);
    const topRight = cornerHeight(seed, baseI, baseJ + last);
    const bottomLeft = cornerHeight(seed, baseI + last, baseJ);
    const bottomRight = cornerHeight(seed, baseI + last, baseJ + last);
    levels[0][0] = topLeft;
    levels[0][last] = topRight;
    levels[last][0] = bottomLeft;
    levels[last][last] = bottomRight;
    subdivide(levels, seed, baseI, baseJ, WORLD_CHUNK / 2, WORLD_CHUNK / 2, WORLD_CHUNK / 2, topLeft, topRight, bottomLeft, bottomRight);
    return levels;
}
/**
 * 菱形方形的一步：填正方形中心与四条边中点，再递归四个子方块。
 *
 * `(r,c)` 是本区块内**正方形的中心**（也是区块内坐标），`size` 是半边长；
 * `baseI/baseJ` 把它换算成全局节点坐标 —— 抖动的输入必须是全局坐标，否则相邻区块
 * 在共享边上各抖各的。
 */
function subdivide(levels, seed, baseI, baseJ, r, c, size, topLeft, topRight, bottomLeft, bottomRight) {
    if (size < 1)
        return;
    const jitterAt = (nodeI, nodeJ) => nodeJitter(seed, baseI + nodeI, baseJ + nodeJ, size);
    const center = clamp255(((topLeft + topRight + bottomLeft + bottomRight) >> 2) + jitterAt(r, c));
    const topEdge = clamp255(((topLeft + topRight) >> 1) + jitterAt(r - size, c));
    const bottomEdge = clamp255(((bottomLeft + bottomRight) >> 1) + jitterAt(r + size, c));
    const leftEdge = clamp255(((topLeft + bottomLeft) >> 1) + jitterAt(r, c - size));
    const rightEdge = clamp255(((topRight + bottomRight) >> 1) + jitterAt(r, c + size));
    levels[r][c] = center;
    levels[r - size][c] = topEdge;
    levels[r + size][c] = bottomEdge;
    levels[r][c - size] = leftEdge;
    levels[r][c + size] = rightEdge;
    const half = size >> 1;
    if (half < 1)
        return;
    subdivide(levels, seed, baseI, baseJ, r - half, c - half, half, topLeft, topEdge, leftEdge, center);
    subdivide(levels, seed, baseI, baseJ, r - half, c + half, half, topEdge, topRight, center, rightEdge);
    subdivide(levels, seed, baseI, baseJ, r + half, c - half, half, leftEdge, center, bottomLeft, bottomEdge);
    subdivide(levels, seed, baseI, baseJ, r + half, c + half, half, center, rightEdge, bottomEdge, bottomRight);
}
/**
 * 视口 → 绘制计划。
 *
 * `viewCellRange` 会带一行 padding（自动连接要看邻居），环绕时它的起点可以是
 * 负数、也可以超过地图尺寸 —— 所以同一格会以多个像素位置出现在计划里，这是
 * 有意的：界面只负责 drawImage，不需要知道环绕。
 */
export async function mapPlan(projectId, o) {
    const project = await readProjectOrThrow(projectId);
    let doc = await theDocOrFresh(projectId);
    /**
     * 预览期间必须**强制回传**被这一笔碰到的块，哪怕客户端说「我有」。
     *
     * ⚠️ 这是真机踩出来的：客户端查计划时会带 `have`（我有哪些块），而预览改的格子在
     * 它已有的块里 —— 宿主一看「你有」就不发了，于是**拖了一路什么都没有**，
     * 松手提交后 `dropKeys` 才让那几块重拉、画面才出现。自检当时那条断言写得太松
     * （`chunks 有 op` 或 `visibleKeys 非空`），把它放过去了。
     */
    const forced = new Set();
    if (Array.isArray(o.pending) && o.pending.length > 0) {
        const preview = cloneDoc(doc);
        // 同一个 applyOps：预览与真实编辑**走同一套校验与语义**，不会画出「提交后不一样」的东西
        const previewLayout = layoutOf(project.grid, preview.cols, preview.rows);
        const overlay = applyOps(preview, o.pending, previewLayout, { stampSpecOf: stampSpecResolver(project) });
        doc = preview;
        for (const key of dirtyChunksFor(overlay.dirty, previewLayout))
            forced.add(key);
    }
    const context = renderContextFor(project, doc);
    const range = viewCellRange(context.layout, o.view);
    const covering = chunksInRange(range);
    const truncated = covering.length > MAX_PLAN_CHUNKS;
    const visible = truncated ? covering.slice(0, MAX_PLAN_CHUNKS) : covering;
    const visibleKeys = visible.map(chunkKey);
    const wanted = new Set(visibleKeys);
    const have = new Set(o.have ?? []);
    const plan = buildPlan(context, doc, { range, layers: o.layerIds === undefined ? undefined : [...o.layerIds], includeLegend: true });
    return {
        grid: project.grid,
        cols: doc.cols,
        rows: doc.rows,
        bounds: plan.bounds,
        visibleKeys,
        chunks: plan.chunks.filter((chunk) => wanted.has(chunk.key) && (!have.has(chunk.key) || forced.has(chunk.key))),
        legend: plan.legend,
        markers: plan.markers,
        ...(o.pass === true ? { pass: passCellsOf(project, doc) } : {}),
        fps: plan.fps,
        fpsMax: plan.fpsMax,
        frameCount: plan.frameCount,
        truncated,
        warnings: plan.warnings
    };
}
// ── 视图 ──────────────────────────────────────────────────────────────────
export function mapAssetBase(projectId) {
    return assetBasePath(`/dsh-game-material-master/map-assets/${projectId}/`);
}
/**
 * 界面视图。
 *
 * `options` 里的 `projectId` / `origin` 是旧调用的兼容位（**视图一律用相对路径**，
 * 绝对 URL 由 `mapSnapshot` 拼给模型）—— 留着是为了不改动已有的调用点签名。
 */
/**
 * 每张素材图的版本号（文件 mtime，毫秒）：界面拼 URL 时带 `?v=`。
 *
 * 少了它，`recomposeMapTileset`（原地重烘）之后浏览器会继续用缓存里的旧图 ——
 * 表现是「重烘跑完了，画面一点没变」，只能靠硬刷新救。
 */
export async function tilesetRevisions(projectId) {
    const project = await readProjectOrThrow(projectId);
    return new Map(await Promise.all(project.tilesets.map(async (tileset) => [tileset.id, await fileRevision(join(mapProjectDir(projectId), tileset.file))])));
}
/** 文件 mtime（毫秒）；取不到就给 undefined（界面那边会退化成不带 `?v=`）。 */
async function fileRevision(path) {
    try {
        const info = await stat(path);
        return Math.round(info.mtimeMs);
    }
    catch {
        return undefined;
    }
}
const INSPECT_SYMBOLS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function inspectInt(value, fallback, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, n));
}
function inspectRegion(value, doc) {
    const raw = (value ?? {});
    const r0 = inspectInt(raw.r0, 0, -MAX_MAP_DIM, MAX_MAP_DIM);
    const c0 = inspectInt(raw.c0, 0, -MAX_MAP_DIM, MAX_MAP_DIM);
    const r1 = inspectInt(raw.r1, doc.rows, -MAX_MAP_DIM, MAX_MAP_DIM);
    const c1 = inspectInt(raw.c1, doc.cols, -MAX_MAP_DIM, MAX_MAP_DIM);
    if (r1 <= r0 || c1 <= c0)
        throw new Error("region 必须是正矩形（r1 > r0、c1 > c0）。");
    return { r0, c0, r1, c1 };
}
function regionCellCount(region) {
    return (region.r1 - region.r0) * (region.c1 - region.c0);
}
function nextInspectRange(region, limit) {
    const width = Math.max(1, Math.min(region.c1 - region.c0, limit));
    const height = Math.max(1, Math.min(region.r1 - region.r0, Math.ceil(limit / width)));
    return { r0: region.r0, c0: region.c0, r1: region.r0 + height, c1: region.c0 + width };
}
/**
 * 读一块地图的语义状态：逐格图块索引（文本 + 可选数组）、标记、整图、通行性、统计。
 *
 * 与 `mapPlan` 的区别：这里不返回像素坐标 / chunk / `have`，也不按视口变化。
 * 它是 Agent 回答「这一片是什么」的稳定入口。
 */
export async function mapInspect(projectId, options = {}) {
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const layout = layoutOf(project.grid, doc.cols, doc.rows);
    const region = inspectRegion(options.region, doc);
    const maxCells = inspectInt(options.maxCells, 4096, 1, 65_536);
    const maxItems = inspectInt(options.maxItems, 200, 1, 2_000);
    const format = options.format === "text" || options.format === "json" ? options.format : "both";
    const include = new Set(options.include ?? ["layers", "markers", "stamps", "pass", "stats", "legend"]);
    const layerFilter = options.layerIds === undefined ? undefined : new Set(options.layerIds.map(String));
    const cells = regionCellCount(region);
    const truncated = cells > maxCells;
    const nextRange = truncated ? nextInspectRange(region, maxCells) : null;
    const flat = flatTiles(project.tilesets);
    const byIndex = new Map(flat.map((entry) => [entry.index, entry]));
    const used = new Map();
    const symbolOf = new Map();
    const symbolFor = (index) => {
        const existing = symbolOf.get(index);
        if (existing !== undefined)
            return existing;
        const symbol = symbolOf.size < INSPECT_SYMBOLS.length ? INSPECT_SYMBOLS[symbolOf.size] : "?";
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
        layers.push({
            id: layer.id,
            name: layer.name,
            filled: layerFilled,
            ...(format === "text" || truncated ? {} : { rows })
        });
    }
    const legend = [...used.keys()]
        .sort((a, b) => a - b)
        .slice(0, INSPECT_SYMBOLS.length)
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
                    shape: tileset?.shape,
                    mask: entry.tile.mask,
                    variant: entry.tile.variant,
                    frame: entry.tile.frame
                })
        };
    });
    const markersInRegion = doc.markers.filter((marker) => marker.r >= region.r0 && marker.r < region.r1 && marker.c >= region.c0 && marker.c < region.c1);
    const markers = markersInRegion
        .slice(0, maxItems)
        .map((marker) => ({
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
    const stampsInRegion = doc.stamps.filter((stamp) => stamp.r >= region.r0 && stamp.r < region.r1 && stamp.c >= region.c0 && stamp.c < region.c1);
    const stamps = stampsInRegion
        .slice(0, maxItems)
        .map((stamp) => {
        const tileset = project.tilesets.find((entry) => entry.id === stamp.tilesetId);
        const spec = tileset?.stamp;
        return {
            id: stamp.id,
            layerId: stamp.layerId,
            tilesetId: stamp.tilesetId,
            name: tileset?.name ?? stamp.tilesetId,
            r: stamp.r,
            c: stamp.c,
            rot: stamp.rot,
            cols: spec?.cols,
            rows: spec?.rows,
            frames: spec?.frames
        };
    });
    const pass = passCellsOf(project, doc).filter((cell) => cell.r >= region.r0 && cell.r < region.r1 && cell.c >= region.c0 && cell.c < region.c1);
    const markersByKind = new Map();
    for (const marker of doc.markers) {
        if (marker.r < region.r0 || marker.r >= region.r1 || marker.c < region.c0 || marker.c >= region.c1)
            continue;
        const kind = typeof marker.kind === "string" && marker.kind !== "" ? marker.kind : "custom";
        markersByKind.set(kind, (markersByKind.get(kind) ?? 0) + 1);
    }
    const stats = {
        cells,
        filled,
        empty: Math.max(0, cells * Math.max(1, doc.layers.length) - filled),
        fillRate: cells > 0 ? filled / (cells * Math.max(1, doc.layers.length)) : 0,
        byLayer: layers.map((layer) => ({ id: layer.id, name: layer.name, filled: layer.filled })),
        tileHistogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([index, count]) => ({ index, count })),
        markersByKind: [...markersByKind.entries()].map(([kind, count]) => ({ kind, count })),
        stamps: doc.stamps.length,
        objects: 0
    };
    const text = format === "json"
        ? undefined
        : [
            `地图 ${doc.cols}×${doc.rows} · 区域 (${region.r0},${region.c0})–(${region.r1 - 1},${region.c1 - 1})`,
            ...layers.map((layer) => `${String(layer.name)}\n${(rowsByLayer.get(String(layer.id)) ?? []).join("\n") || "（内容过大，已省略逐格文本）"}`),
            `图例：${legend.map((entry) => `${String(entry.symbol)}=${String(entry.tilesetName ?? entry.tilesetId ?? "未知")}/${String(entry.index)}`).join(" ")}`
        ].join("\n\n");
    return {
        module: "map",
        projectId,
        revision: await mapRevision(project, doc),
        cols: doc.cols,
        rows: doc.rows,
        grid: project.grid,
        range: region,
        truncated,
        nextRange,
        truncatedItems: [
            ...(markersInRegion.length > markers.length ? ["markers"] : []),
            ...(stampsInRegion.length > stamps.length ? ["stamps"] : [])
        ],
        legend: include.has("legend") ? legend : [],
        layers: include.has("layers") ? layers : [],
        markers: include.has("markers") ? markers : undefined,
        stamps: include.has("stamps") ? stamps : undefined,
        pass: include.has("pass") ? pass : undefined,
        stats,
        warnings: [...warningsFor(project, doc), ...(used.size > INSPECT_SYMBOLS.length ? [`不同图块超过 ${INSPECT_SYMBOLS.length} 种，文本网格用 ? 代替，精确值请用 format=json。`] : [])],
        busy: mapBusy(projectId),
        canUndo: historyState(projectId).canUndo,
        canRedo: historyState(projectId).canRedo,
        ...(text === undefined ? {} : { text })
    };
}
/**
 * 文档 + 素材元数据 + 素材图 mtime 的短哈希。
 *
 * 不落盘（派生数据），同一状态稳定；写入 / 撤销 / 预览 / 检查图都带它，Agent 用它
 * 防止拿旧状态覆盖新状态。素材文件 mtime 也进哈希，因为 `recomposeMapTileset`
 * 会原地换图、元数据一个字段都不变。
 */
export async function mapRevision(project, doc, revisions) {
    const revs = revisions ?? (await tilesetRevisions(project.id));
    const payload = JSON.stringify({
        grid: project.grid,
        doc: {
            cols: doc.cols,
            rows: doc.rows,
            layers: doc.layers,
            data: doc.data,
            markers: doc.markers,
            stamps: doc.stamps
        },
        tilesets: project.tilesets.map((tileset) => ({
            id: tileset.id,
            name: tileset.name,
            file: tileset.file,
            imageWidth: tileset.imageWidth,
            imageHeight: tileset.imageHeight,
            cell: tileset.cell,
            shape: tileset.shape,
            animRows: tileset.animRows,
            variants: tileset.variants,
            loop: tileset.loop,
            clarity: tileset.clarity,
            fps: tileset.fps,
            stamp: tileset.stamp,
            builtin: tileset.builtin === true,
            tileCount: tileset.tiles.length
        })),
        files: project.tilesets.map((tileset) => [tileset.id, revisionsOr(revs, tileset.id)])
    });
    return createHash("sha1").update(payload).digest("hex").slice(0, 12);
}
function revisionsOr(revisions, id) {
    return revisions.get(id) ?? 0;
}
export async function mapView(p, options = {}) {
    void options;
    const doc = await theDocOrFresh(p.id);
    const flat = flatTiles(p.tilesets);
    const listing = await readExportListingRelative(p);
    const state = historyState(p.id);
    const layers = doc.layers.map((layer) => ({ id: layer.id, name: layer.name, filled: filledCount(doc, layer.id) }));
    // 素材图的版本号（mtime）先批量取好：`map` 里不能用 await，只能先算。
    const revisions = await tilesetRevisions(p.id);
    const preview = (await readPreviewFiles(p.id)).map((name) => `preview/${name}`);
    return {
        id: p.id,
        name: p.name,
        assetBase: mapAssetBase(p.id),
        grid: p.grid,
        cols: doc.cols,
        rows: doc.rows,
        revision: await mapRevision(p, doc, revisions),
        tilesets: p.tilesets.map((tileset) => ({
            id: tileset.id,
            name: tileset.name,
            file: tileset.file,
            imageWidth: tileset.imageWidth,
            imageHeight: tileset.imageHeight,
            cell: tileset.cell,
            shape: tileset.shape,
            animRows: tileset.animRows,
            variants: tileset.variants,
            loop: tileset.loop,
            clarity: tileset.clarity,
            fps: tileset.fps,
            stamp: tileset.stamp === undefined ? undefined : { cols: tileset.stamp.cols, rows: tileset.stamp.rows, frames: tileset.stamp.frames },
            tileCount: tileset.tiles.length,
            rev: revisions.get(tileset.id),
            builtin: tileset.builtin === true ? true : undefined,
            reason: layoutFor(tileset.shape, tileset.cell, tileset.imageWidth, tileset.imageHeight, tileset.stamp).reason,
            palette: paletteFor(tileset, flat)
        })),
        legend: flat.map((tile) => ({ index: tile.index, tilesetId: tile.tilesetId, rect: tile.tile.rect })),
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
        filled: layers.reduce((sum, layer) => sum + layer.filled, 0),
        stages: p.stages,
        reviewMode: p.reviewMode,
        busy: mapBusy(p.id),
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        maxChunks: MAX_PLAN_CHUNKS,
        warnings: warningsFor(p, doc),
        logs: p.logs.slice(-40),
        preview,
        previewPaths: preview.map((relative) => join(mapProjectDir(p.id), relative)),
        exportBase: listing?.base ?? "",
        exportFiles: listing?.files ?? [],
        exportPath: listing === undefined ? "" : join(mapProjectDir(p.id), "export", listing.dirName)
    };
}
/**
 * 素材 → 可点的笔刷列表。
 *
 * 普通素材每格一个条目；**A2 素材只出一个**：用户点的是「草地」这个自动连接笔刷，
 * 形状由邻居现推（`mapauto.a2QuadrantShapes`），所以画笔要落在**满格那一行**上 ——
 * 那一行的 32×32 逻辑块正好是一张完整的缩略图。写进图层数据的值取同一块的第一个
 * 小格序号：渲染时从它身上认「哪张素材、哪个变体」，形状由宿主现算。
 */
function paletteFor(tileset, flat) {
    const mine = flat.filter((tile) => tile.tilesetId === tileset.id);
    /**
     * 整图：调色板里**只有一条**，缩略图是**整张图**（frame 0 / 旋转 0 的整块）。
     *
     * 它印出来占 N×M 格、要旋转、要带区域 —— 一条一条列出 36 个小格只会让人
     * 以为「整图可以一格一格刷」（那正是它要解决的问题）。
     */
    if (tileset.shape === "stamp" && tileset.stamp !== undefined) {
        const spec = tileset.stamp;
        const first = mine.find((tile) => (tile.tile.stamp?.frame ?? 0) === 0 && tile.tile.stamp?.rot === 0 && tile.tile.stamp.r === 0 && tile.tile.stamp.c === 0);
        if (first === undefined)
            return [];
        return [
            {
                index: first.index,
                rect: { x: 0, y: 0, width: spec.cols * tileset.cell.width, height: spec.rows * tileset.cell.height }
            }
        ];
    }
    if (tileset.shape !== "a2quad") {
        /**
         * 「翻页图」（`animRows`）：同一列的每一行是**同一个逻辑块的不同帧**，帧由宿主按全局帧号
         * 现推（`maprender` 的 `cycle`），所以调色板每列只出**第 0 帧**那一条。
         *
         * 每帧都出一条的话，用户看到的就是 N 个一模一样的笔刷 —— 内置道具图（8 列 × 5 帧）
         * 曾经就是这样：`animRows` 少写了一个 true，40 个小格全成了独立图块，
         * 调色板里 40 条有 32 条逐像素重复。
         */
        if (tileset.animRows === true) {
            const first = mine.filter((tile) => (tile.tile.frame ?? 0) === 0);
            const list = first.length > 0 ? first : mine.slice(0, 1);
            return list.map((tile) => ({ index: tile.index, rect: tile.tile.rect }));
        }
        return mine.map((tile) => ({ index: tile.index, rect: tile.tile.rect }));
    }
    let fullRow = 0;
    for (const tile of mine)
        fullRow = Math.max(fullRow, tile.tile.shape ?? 0);
    const pick = mine.find((tile) => (tile.tile.shape ?? 0) === fullRow && (tile.tile.variant ?? 0) === 0) ?? mine[0];
    if (pick === undefined)
        return [];
    const variant = pick.tile.variant ?? 0;
    return [
        {
            index: pick.index,
            rect: { x: variant * tileset.cell.width, y: fullRow * tileset.cell.height, width: tileset.cell.width, height: tileset.cell.height }
        }
    ];
}
/**
 * 观测告警：只在「看出来的确会画错」时才说，全部中文。
 *
 * ⚠️ 这里**不放**「尺寸是偶数 ⇒ 迷宫会被截断」：默认尺寸就是 32×32（偶数），
 * 用户从没点过迷宫也会一直看到它。那条提示留在 `runMapGenerate` 的返回里 ——
 * 只有真的生成迷宫时才该出现。
 */
function warningsFor(project, doc) {
    const out = [];
    if (project.tilesets.length === 0)
        out.push("还没有素材：先导入一张 tileset 图，或者用 importSampleTileset 装内置素材。");
    for (const tileset of project.tilesets) {
        if (tileset.cell.width !== project.grid.tileWidth || tileset.cell.height !== project.grid.tileHeight) {
            out.push(`素材「${tileset.name}」的格子是 ${tileset.cell.width}×${tileset.cell.height}，项目网格是 ${project.grid.tileWidth}×${project.grid.tileHeight}：画出来会按网格缩放。`);
        }
        if (tileset.shape === "a2quad" && tileset.imageHeight !== tileset.cell.height * 5) {
            out.push(`素材「${tileset.name}」是 A2 拼块，但高度 ${tileset.imageHeight} 不等于 5×格子高（${tileset.cell.height * 5}）：形状行数对不上，自动连接会取错块。`);
        }
        // 「整格自动连接」但掩码没配齐：`assignCorner16Masks` 只在**恰好 16 块**时按位序配，
        // 块数不对就一块都不配（掩码不是猜的），画出来会统一用第一块 —— 这件事必须常驻显示。
        if (tileset.shape === "corner16") {
            const masks = new Set(tileset.tiles.map((tile) => tile.mask).filter((mask) => typeof mask === "number"));
            if (masks.size < CORNER16_COUNT) {
                out.push(`素材「${tileset.name}」是整格自动连接，但 ${tileset.tiles.length} 块里只有 ${masks.size} 个掩码（需要 ${CORNER16_COUNT} 块）：没配到的地方会统一用第一块。`);
            }
        }
    }
    const bottom = doc.layers[0];
    if (bottom !== undefined && filledCount(doc, bottom.id) === 0)
        out.push(`第 0 层（${bottom.name}）还是空的：先用笔刷铺一层，或者 runMapGenerate 一键生成。`);
    // 旧版项目（**第一版**模块六）把地图存在 `maps/<mapId>.json`，新版只读项目根的 `map.json`。
    // 于是用户升级后打开旧项目会看到一张**空的**地图 —— 什么都不说的话就是「我画的东西不见了」。
    // 旧文件并没有删，所以这里只提醒一句、给个去处（真去读两份数据等于养一套迁移口径）。
    if (existsSync(join(mapProjectDir(project.id), "maps"))) {
        out.push("这是旧版地图项目：原来的地图数据在项目目录的 maps/ 里，新版界面只读 map.json，所以现在看到的是一张空地图（maps/ 里的旧文件没有删）。");
    }
    return out;
}
// ── 作业（预览 / 导出）────────────────────────────────────────────────────
/**
 * 「已经有人预定要开工」的项目。
 *
 * `mapBusy` 读的就是这个集合，而作业是在**几个 await 之后**才真正开始的 ——
 * 两次并发提交（界面上手快连点、或工具面重复调用）会双双通过 `mapBusy` 检查，
 * 然后两个作业抢同一份文档。所以先用一个**同步**的预定集合把位置占住。
 * 占位一直保留到作业结束（`background` 的 finally 里释放）。
 */
const reserved = new Set();
const cancelled = new Set();
export function mapBusy(projectId) {
    return reserved.has(projectId);
}
export function cancelMapJob(projectId) {
    cancelled.add(projectId);
}
/** 同步占位；占不到就返回原因（调用方直接回 `{started:false, reason}`）。 */
function reserve(projectId) {
    if (reserved.has(projectId))
        return "这个项目已经有任务在跑了，等它跑完再提交。";
    reserved.add(projectId);
    return undefined;
}
async function background(projectId, stage, run) {
    cancelled.delete(projectId);
    await patchMapProject(projectId, (project) => {
        project.stages[stage] = { status: "running", at: new Date().toISOString() };
    }).catch(() => undefined);
    try {
        await run();
        await patchMapProject(projectId, (project) => {
            if (project.stages[stage].status === "running")
                project.stages[stage] = { status: "done", at: new Date().toISOString(), approved: project.stages[stage].approved };
        });
    }
    catch (error) {
        const message = messageOf(error);
        await patchMapProject(projectId, (project) => {
            project.stages[stage] = { status: "error", error: message, at: new Date().toISOString() };
            appendJobLog(project.logs, "error", `${stage === "paint" ? "预览" : "导出"}失败：${message}`);
        }).catch(() => undefined);
    }
    finally {
        reserved.delete(projectId);
    }
}
/** 解一遍素材位图（单张解不开不该让整次渲染失败，缺图的地方按透明跳过）。 */
async function decodeTilesets(project) {
    const lookup = new Map();
    for (const tileset of project.tilesets) {
        if (tileset.file === "")
            continue;
        try {
            lookup.set(tileset.id, await decodeFile(mapAssetPath(project.id, tileset.file)));
        }
        catch {
            /* 缺图时渲染按空处理 */
        }
    }
    return lookup;
}
/** 验收预览（本地免费）：只出**一张**地图渲染图 `preview/map.png`。 */
export async function runPreviewStage(projectId) {
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
    const previewPath = join(mapProjectDir(projectId), "preview", "map.png");
    if (project.tilesets.length === 0) {
        reserved.delete(projectId);
        return { started: false, reason: "还没有导入素材。", previewPath };
    }
    const revisionAtStart = await mapRevision(project, await theDocOrFresh(projectId));
    void background(projectId, "paint", async () => {
        const fresh = await readProjectOrThrow(projectId);
        const doc = await theDocOrFresh(projectId);
        await flushMapDoc(projectId);
        if (cancelled.has(projectId))
            return;
        const bitmaps = await decodeTilesets(fresh);
        const raster = rasterize(renderContextFor(fresh, doc), doc, bitmaps, { scale: 1 });
        const previewDir = join(mapProjectDir(projectId), "preview");
        await mkdir(previewDir, { recursive: true });
        await writeFile(join(previewDir, "map.png"), bitmapToPng(raster.bitmap));
        await patchMapProject(projectId, (current) => {
            appendJobLog(current.logs, "info", `生成地图预览图：preview/map.png（${doc.cols}×${doc.rows}，${raster.bitmap.width}×${raster.bitmap.height} 像素）`);
            // ⚠️ 一条 op 都没画进去 = 全透明 PNG。不提示的话界面只会看到一块空白，
            // 而阶段照样标 done（导出那条同款提示见 mapexport 的「所有图层都是空的」）。
            if (raster.drawn === 0)
                appendJobLog(current.logs, "warn", "地图还是空的：预览图是全透明的，先画点东西再看大图。");
            for (const warning of raster.warnings)
                appendJobLog(current.logs, "warn", `预览告警：${warning}`);
        });
    });
    return { started: true, previewPath, revisionAtStart };
}
/** 检查图目录里只留最近 20 张；失败不影响本次渲染。 */
async function pruneAgentRenders(projectId, keep = 20) {
    const dir = join(mapProjectDir(projectId), "preview", "agent");
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
/**
 * 同步渲染一块地图区域，供 Agent 用 `read_image` 看。
 *
 * 与 `runMapPreview` 的分工：这个不写阶段、不触发验收、不排队；它就是一张检查图。
 * 渲染走 `renderMapView`（同一份 `buildPlan`），所以区域图与导出图不会各算一套。
 */
export async function runMapRender(projectId, options = {}) {
    const startedAt = Date.now();
    const project = await readProjectOrThrow(projectId);
    const doc = await theDocOrFresh(projectId);
    const revisionAtStart = await mapRevision(project, doc);
    const region = inspectRegion(options.region, doc);
    const layerIndexes = options.layerIds === undefined
        ? undefined
        : options.layerIds
            .map((id) => doc.layers.findIndex((layer) => layer.id === id))
            .filter((index) => index >= 0);
    const context = renderContextFor(project, doc);
    const lookup = await decodeTilesets(project);
    const passCells = options.overlay?.pass === true ? passCellsOf(project, doc) : undefined;
    const rendered = renderMapView(context, doc, lookup, {
        range: { r0: region.r0, c0: region.c0, r1: region.r1, c1: region.c1 },
        scale: options.scale,
        layers: layerIndexes,
        frame: options.frame,
        background: options.background,
        overlay: options.overlay,
        passCells,
        maxPixels: options.maxPixels
    });
    const dir = join(mapProjectDir(projectId), "preview", "agent");
    await mkdir(dir, { recursive: true });
    const safe = safeFileName(options.name ?? "inspect", "inspect");
    const optionsHash = createHash("sha1")
        .update(JSON.stringify({ region, scale: rendered.scale, layerIndexes, frame: options.frame ?? 0, background: options.background ?? "transparent", overlay: options.overlay ?? {} }))
        .digest("hex")
        .slice(0, 8);
    const file = `preview/agent/${safe}-${revisionAtStart}-${optionsHash}.png`;
    const localPath = join(mapProjectDir(projectId), file);
    await writeFile(localPath, bitmapToPng(rendered.bitmap));
    await pruneAgentRenders(projectId);
    const revision = await mapRevision(project, doc);
    return {
        module: "map",
        projectId,
        revision,
        revisionAtStart,
        stale: revision !== revisionAtStart,
        file,
        localPath,
        url: `${originForLinks()}${mapAssetBase(projectId)}${file}`,
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
/**
 * 导出目录名：跟着**地图名**走（改名地图 = 换一个自包含目录，旧目录原样留着）。
 *
 * ⚠️ `runExportStage` / `readExportListingRelative` / `mapRevealDir` 三处必须同口径 ——
 * 分别算一次的话，会出现「界面列的清单在 A 目录、点开的是 B 目录」这种只看得到空文件夹的坏法。
 */
export function mapExportDirName(doc, project) {
    return safeFileName(doc?.name ?? project.name, doc?.id ?? project.id);
}
/** 导出目录的绝对路径。 */
export function mapExportDir(projectId, doc, project) {
    return join(mapProjectDir(projectId), "export", mapExportDirName(doc, project));
}
/**
 * 「在文件夹中显示」要打开的绝对路径。
 *
 * `target: "export"` 时打开**导出目录**（用户点的是「打开导出目录」，以前却打开项目根 ——
 * 那里并没有他要的文件）；还没导出过就退回项目目录，并由 `fallback` 告诉调用方，
 * 免得 explorer 收到一个不存在的路径（macOS 的 open 会直接报错）。
 */
export async function mapRevealDir(projectId, target) {
    const project = await readProjectOrThrow(projectId);
    if (target !== "export")
        return { dir: mapProjectDir(projectId), fallback: false };
    const dir = mapExportDir(projectId, await readTheDoc(projectId), project);
    if (existsSync(dir))
        return { dir, fallback: false };
    return { dir: mapProjectDir(projectId), fallback: true };
}
/** 导出（本地免费）：`map.png` + `map.json`(+ 素材原图 / zip) + `manifest.json`。 */
export async function runExportStage(projectId, options = {}) {
    const reason = reserve(projectId);
    if (reason !== undefined)
        return { started: false, reason };
    let project;
    try {
        project = await readProjectOrThrow(projectId);
        if (project.tilesets.length === 0) {
            reserved.delete(projectId);
            return { started: false, reason: "还没有导入素材，导出的地图会是空的。" };
        }
    }
    catch (error) {
        reserved.delete(projectId);
        throw error;
    }
    const scale = Number.isFinite(options.scale) ? Math.max(1, Math.round(Number(options.scale))) : undefined;
    void background(projectId, "export", async () => {
        const fresh = await readProjectOrThrow(projectId);
        const doc = await theDocOrFresh(projectId);
        if (isDocEmpty(doc))
            throw new Error("地图还是空的，先画点东西再导出。");
        await flushMapDoc(projectId);
        if (cancelled.has(projectId))
            return;
        // 导出目录按**地图名**取（改名地图 = 换一个自包含目录，旧目录原样留着）。
        const dirName = mapExportDirName(doc, fresh);
        const manifest = await exportMap({
            project: { id: fresh.id, name: fresh.name },
            doc,
            context: renderContextFor(fresh, doc),
            dir: join(mapProjectDir(projectId), "export", dirName),
            formats: { ...(options.formats ?? {}), ...(scale === undefined ? {} : { scale }) },
            // ⚠️ 一定要显式给 `lookup`：mapexport 的兜底分支会自己 `import` 本模块取路径 ——
            // 那是条循环引用（本模块 → mapexport → 本模块）。给我们已经解好的位图，
            // 运行时永远走不到那条兜底。
            lookup: await decodeTilesets(fresh)
        });
        await patchMapProject(projectId, (current) => {
            appendJobLog(current.logs, "info", `导出「${doc.name}」：${manifest.files.length} 个文件 → export/${dirName}/`);
        });
    });
    return { started: true };
}
/** 相对路径版的导出清单（界面用；绝对 URL 版见 `readExportListing`）。 */
async function readExportListingRelative(project) {
    // 目录名跟着**地图名**走（与 runExportStage 同一处口径）。
    const doc = await readTheDoc(project.id);
    const dirName = mapExportDirName(doc, project);
    const manifest = await readJson(join(mapProjectDir(project.id), "export", dirName, "manifest.json"));
    if (manifest === undefined)
        return undefined;
    return { base: `export/${dirName}/`, files: (manifest.files ?? []).map((file) => file.path), warnings: manifest.warnings ?? [], dirName };
}
/** 最近的导出清单（验收包用）：`base` 与每个文件都是**绝对 URL**。 */
export async function readExportListing(projectId, origin) {
    const project = await readMapProject(projectId);
    if (project === undefined)
        return undefined;
    const listing = await readExportListingRelative(project);
    if (listing === undefined)
        return undefined;
    return {
        base: absoluteAssetUrl(projectId, origin, listing.base),
        files: listing.files.map((file) => absoluteAssetUrl(projectId, origin, `${listing.base}${file}`))
    };
}
async function readPreviewFiles(projectId) {
    try {
        const names = await readdir(join(mapProjectDir(projectId), "preview"));
        return names.filter((name) => name.endsWith(".png")).sort();
    }
    catch {
        return [];
    }
}
function absoluteAssetUrl(projectId, origin, relative) {
    return `${origin}${assetBasePath(`/dsh-game-material-master/map-assets/${projectId}/`)}${relative}`;
}
/**
 * 工具用的快照：把界面里的**相对**资源路径全部换成可点的**绝对** URL
 * （模型要直接贴给用户），并附上「下一步该做什么」。
 */
export async function mapSnapshot(project, origin, options = {}) {
    void options;
    const view = await mapView(project);
    const { preview, exportBase, ...rest } = view;
    const listing = await readExportListing(project.id, origin);
    const relative = await readExportListingRelative(project);
    const nextActions = [];
    if (view.tilesets.length === 0) {
        nextActions.push({ step: "assets", why: "还没有素材：importMapTileset({projectId,name,data}) 传图片 base64，或者 importSampleTileset({projectId}) 装内置素材（免费、本机现算）。" });
    }
    if (view.filled === 0) {
        nextActions.push({ step: "paint", why: "地图还是空的：runMapGenerate({projectId,kind:'random'|'maze'|'continent'}) 一键铺，或者 applyMapOps({projectId,ops}) 直接画。" });
    }
    else if (exportBase === "") {
        nextActions.push({ step: "export", why: "还没导出过：runMapExport({projectId}) 出 map.png + map.json（本地免费）。" });
    }
    if (nextActions.length === 0)
        nextActions.push({ step: "done", why: "素材、地图、导出都有产物了。可以继续改地图，或 runMapPreview({projectId}) 重新出验收图。" });
    return {
        ...rest,
        assetBase: `${origin}${mapAssetBase(project.id)}`,
        tilesets: view.tilesets.map((tileset) => ({ ...tileset, url: absoluteAssetUrl(project.id, origin, tileset.file) })),
        previewUrls: preview.map((relative) => absoluteAssetUrl(project.id, origin, relative)),
        exportBaseUrl: listing?.base ?? "",
        exportWarnings: relative?.warnings ?? [],
        nextActions
    };
}
// 尺寸上限是几何模块的口径，但网关与自检脚本一直是按 `mapgen.MAX_MAP_DIM` 读的
// （模块六的公开面就是这个文件），所以在这里转出去，别让调用方猜它搬去了哪。
export { MAX_MAP_DIM };
