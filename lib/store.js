/**
 * 项目持久化。
 *
 * 每个项目一个目录：`${DSH_HOME}/game-material-master/projects/<id>/`
 *
 *   project.json          项目状态（本文件的 Project 结构）
 *   source/               用户上传的源图
 *   images/<方向>.png     八张绿幕图
 *   videos/<方向>.mp4     八段视频
 *   frames/<方向>/*.png   抽出来的原始绿幕帧
 *   keyed/<方向>/*.png    抠完绿幕的帧
 *   preview/<方向>.png    方向预览带（帧横向拼接）
 *   out/sheet.png         最终整图
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_VIDEO_PROMPT, DIRECTION_KEYS, DEFAULT_ROW_ORDER, defaultImagePrompts } from "./directions.js";
import { DEFAULT_CONFIG, ROW_ORDER_VERSION, isLegacyRowOrder, loadConfig, projectsRoot } from "./config.js";
/** 每个项目一条读-改-写串行链，见 patchProject。 */
const locks = new Map();
export function projectDir(id) {
    return join(projectsRoot(), id);
}
export function projectFile(id) {
    return join(projectDir(id), "project.json");
}
/** 把项目内的相对路径解析成绝对路径，并挡住目录穿越。 */
export function assetPath(id, relative) {
    const base = resolve(projectDir(id));
    const target = resolve(base, relative);
    if (target !== base && !target.startsWith(base + sep)) {
        throw new Error(`非法的项目内路径：${relative}`);
    }
    return target;
}
export function settingsFromConfig(config, rowOrder) {
    return {
        cellWidth: config.cellWidth,
        cellHeight: config.cellHeight,
        frameCount: config.frameCount,
        fitMode: config.fitMode,
        workingLongEdge: config.workingLongEdge,
        pixelSize: config.pixelSize,
        autoCrop: config.autoCrop,
        fillRatio: config.fillRatio,
        bottomMargin: config.bottomMargin,
        cropInset: config.cropInset,
        keyLow: config.keyLow,
        keyHigh: config.keyHigh,
        despill: config.despill,
        bgTolerance: config.bgTolerance,
        edgeShrink: config.edgeShrink,
        rowOrder: rowOrder ?? (config.rowOrder.length > 0 ? [...config.rowOrder] : [...DEFAULT_ROW_ORDER]),
        rowOrderVersion: ROW_ORDER_VERSION,
        concurrency: config.concurrency
    };
}
function emptyImages() {
    const out = {};
    for (const key of DIRECTION_KEYS)
        out[key] = { status: "empty", approved: false };
    return out;
}
function emptyVideos() {
    const out = {};
    for (const key of DIRECTION_KEYS)
        out[key] = { status: "empty", approved: false };
    return out;
}
function emptyFrames() {
    const out = {};
    for (const key of DIRECTION_KEYS)
        out[key] = { status: "empty", frames: [], keyed: [], approved: false };
    return out;
}
export async function ensureLayout(id) {
    const base = projectDir(id);
    for (const sub of ["source", "images", "videos", "frames", "keyed", "preview", "out"]) {
        await mkdir(join(base, sub), { recursive: true });
    }
}
export async function createProject(name) {
    const config = await loadConfig();
    const id = `p${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = Date.now();
    const project = {
        id,
        name: name.trim() === "" ? "未命名项目" : name.trim(),
        createdAt: now,
        updatedAt: now,
        source: null,
        prompts: {
            images: defaultImagePrompts(),
            video: DEFAULT_VIDEO_PROMPT,
            videoPerDirection: {},
            suffix: ""
        },
        images: emptyImages(),
        videos: emptyVideos(),
        frames: emptyFrames(),
        sheet: { status: "empty", approved: false },
        settings: settingsFromConfig(config),
        log: []
    };
    await ensureLayout(id);
    await writeProject(project);
    return project;
}
export async function readProject(id) {
    try {
        const text = await readFile(projectFile(id), "utf8");
        return normalizeProject(JSON.parse(text));
    }
    catch {
        return undefined;
    }
}
export async function writeProject(project) {
    project.updatedAt = Date.now();
    const target = projectFile(project.id);
    await mkdir(projectDir(project.id), { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    await rename(tmp, target);
}
export async function deleteProject(id) {
    await rm(projectDir(id), { recursive: true, force: true });
}
/**
 * 串行化同一项目的「读-改-写」。
 * mutator 必须是短操作且不要发网络请求——真正耗时的调用要放在锁外，
 * 只把状态变更包进这里，否则并发任务会互相排队。
 */
export function patchProject(id, mutator) {
    const previous = locks.get(id) ?? Promise.resolve();
    const run = previous.then(async () => {
        const project = await readProject(id);
        if (project === undefined)
            throw new Error(`项目不存在：${id}`);
        const result = await mutator(project);
        await writeProject(project);
        return result;
    });
    locks.set(id, run.then(() => undefined, () => undefined));
    return run;
}
export async function listProjects() {
    let entries = [];
    try {
        const dirents = await readdir(projectsRoot(), { withFileTypes: true });
        entries = dirents.filter((d) => d.isDirectory() && d.name.startsWith("p")).map((d) => d.name);
    }
    catch {
        return [];
    }
    const summaries = [];
    for (const id of entries) {
        const project = await readProject(id);
        if (project === undefined)
            continue;
        summaries.push(summarize(project));
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
}
export function summarize(project) {
    return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        hasSource: project.source !== null,
        imageReady: DIRECTION_KEYS.filter((k) => project.images[k]?.status === "ready").length,
        videoReady: DIRECTION_KEYS.filter((k) => project.videos[k]?.status === "ready").length,
        framesReady: DIRECTION_KEYS.filter((k) => project.frames[k]?.status === "ready").length,
        sheetReady: project.sheet.status === "ready"
    };
}
/** 补齐历史版本缺字段，保证读进来的对象形状永远完整。 */
function normalizeProject(raw) {
    const now = Date.now();
    const settings = { ...(raw?.settings ?? {}) };
    const defaults = settingsFromConfig(DEFAULT_CONFIG);
    const merged = {
        cellWidth: num(settings.cellWidth, defaults.cellWidth),
        cellHeight: num(settings.cellHeight, defaults.cellHeight),
        frameCount: num(settings.frameCount, defaults.frameCount),
        fitMode: settings.fitMode === "stretch" ? "stretch" : "contain",
        workingLongEdge: num(settings.workingLongEdge, defaults.workingLongEdge),
        pixelSize: num(settings.pixelSize, defaults.pixelSize),
        autoCrop: settings.autoCrop !== false,
        fillRatio: num(settings.fillRatio, defaults.fillRatio),
        bottomMargin: num(settings.bottomMargin, defaults.bottomMargin),
        cropInset: num(settings.cropInset, defaults.cropInset),
        keyLow: num(settings.keyLow, defaults.keyLow),
        keyHigh: num(settings.keyHigh, defaults.keyHigh),
        despill: num(settings.despill, defaults.despill),
        bgTolerance: num(settings.bgTolerance, defaults.bgTolerance),
        edgeShrink: num(settings.edgeShrink, defaults.edgeShrink),
        rowOrder: Array.isArray(settings.rowOrder) && settings.rowOrder.length > 0 && !(settings.rowOrderVersion === undefined && isLegacyRowOrder(settings.rowOrder))
            ? settings.rowOrder.map(String)
            : [...DEFAULT_ROW_ORDER],
        rowOrderVersion: ROW_ORDER_VERSION,
        concurrency: num(settings.concurrency, defaults.concurrency)
    };
    const images = emptyImages();
    for (const key of DIRECTION_KEYS) {
        const node = raw?.images?.[key];
        if (node !== undefined)
            images[key] = { ...images[key], ...node, approved: node.approved === true };
    }
    const videos = emptyVideos();
    for (const key of DIRECTION_KEYS) {
        const node = raw?.videos?.[key];
        if (node !== undefined)
            videos[key] = { ...videos[key], ...node, approved: node.approved === true };
    }
    const frames = emptyFrames();
    for (const key of DIRECTION_KEYS) {
        const node = raw?.frames?.[key];
        if (node !== undefined) {
            frames[key] = {
                ...frames[key],
                ...node,
                frames: Array.isArray(node.frames) ? node.frames.map(String) : [],
                keyed: Array.isArray(node.keyed) ? node.keyed.map(String) : [],
                approved: node.approved === true,
                stale: node.stale === true
            };
        }
    }
    const defaultPrompts = defaultImagePrompts();
    const images_prompts = {};
    for (const key of DIRECTION_KEYS) {
        const value = raw?.prompts?.images?.[key];
        images_prompts[key] = typeof value === "string" && value.trim() !== "" ? value : defaultPrompts[key];
    }
    return {
        id: String(raw?.id ?? ""),
        name: typeof raw?.name === "string" && raw.name.trim() !== "" ? raw.name : "未命名项目",
        createdAt: num(raw?.createdAt, now),
        updatedAt: num(raw?.updatedAt, now),
        source: raw?.source?.file ? { file: String(raw.source.file), name: String(raw.source.name ?? "source") } : null,
        prompts: {
            images: images_prompts,
            video: typeof raw?.prompts?.video === "string" && raw.prompts.video.trim() !== "" ? raw.prompts.video : DEFAULT_VIDEO_PROMPT,
            videoPerDirection: raw?.prompts?.videoPerDirection !== null && typeof raw?.prompts?.videoPerDirection === "object"
                ? { ...raw.prompts.videoPerDirection }
                : {},
            suffix: typeof raw?.prompts?.suffix === "string" ? raw.prompts.suffix : ""
        },
        images,
        videos,
        frames,
        sheet: {
            status: raw?.sheet?.status ?? "empty",
            file: raw?.sheet?.file,
            thumb: raw?.sheet?.thumb,
            approved: raw?.sheet?.approved === true,
            error: raw?.sheet?.error,
            width: raw?.sheet?.width,
            height: raw?.sheet?.height,
            generatedAt: raw?.sheet?.generatedAt,
            rowOrder: Array.isArray(raw?.sheet?.rowOrder) ? raw.sheet.rowOrder.map(String) : undefined,
            cellWidth: raw?.sheet?.cellWidth,
            cellHeight: raw?.sheet?.cellHeight,
            frameCount: raw?.sheet?.frameCount
        },
        settings: merged,
        log: Array.isArray(raw?.log) ? raw.log.slice(-200) : []
    };
}
function num(value, fallback) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? n : fallback;
}
/** 往项目日志里追加一条（最多保留 200 条）。 */
export function log(project, level, message) {
    project.log.push({ at: Date.now(), level, message });
    if (project.log.length > 200)
        project.log.splice(0, project.log.length - 200);
}
/** 某个方向的参考图绝对路径列表（source 或其它方向的产出）。 */
export function referenceFiles(project, refs) {
    const out = [];
    for (const ref of refs) {
        if (ref === "source") {
            if (project.source !== null)
                out.push(assetPath(project.id, project.source.file));
            continue;
        }
        const node = project.images[ref];
        if (node?.file !== undefined)
            out.push(assetPath(project.id, node.file));
    }
    return out;
}
/** 项目目录是否真实存在。 */
export async function projectExists(id) {
    try {
        const info = await stat(projectDir(id));
        return info.isDirectory();
    }
    catch {
        return false;
    }
}
