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
import { DEFAULT_TURN_PROMPT, DEFAULT_VIDEO_PROMPT, DIRECTION_KEYS, DEFAULT_ROW_ORDER, TURN_FRAME_COUNT_DEFAULT, TURN_DIRECTION_DEFAULT, TURN_FRAME_COUNT_MAX, TURN_FRAME_COUNT_MIN, defaultImagePrompts, defaultTurnPicks } from "./directions.js";
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
        concurrency: config.concurrency,
        turnFrameCount: TURN_FRAME_COUNT_DEFAULT
    };
}
function emptyImages() {
    const out = {};
    for (const key of DIRECTION_KEYS)
        out[key] = { status: "empty", approved: false };
    return out;
}
/** 八方向的默认截帧位置（转圈方向决定它们的先后）。 */
export function freshPicks(frameCount, direction = TURN_DIRECTION_DEFAULT) {
    return defaultTurnPicks(frameCount, direction);
}
function emptyTurn(frameCount = TURN_FRAME_COUNT_DEFAULT) {
    return {
        video: { status: "empty", approved: false },
        frames: { status: "empty", frames: [], times: [], picks: freshPicks(frameCount), approved: false },
        direction: TURN_DIRECTION_DEFAULT
    };
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
    for (const sub of ["source", "images", "videos", "frames", "keyed", "preview", "out", "turn"]) {
        await mkdir(join(base, sub), { recursive: true });
    }
}
export async function createProject(name) {
    const config = await loadConfig();
    const id = `p${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = Date.now();
    const settings = settingsFromConfig(config);
    const project = {
        id,
        name: name.trim() === "" ? "未命名项目" : name.trim(),
        createdAt: now,
        updatedAt: now,
        source: null,
        prompts: {
            images: defaultImagePrompts(),
            video: DEFAULT_VIDEO_PROMPT,
            turn: DEFAULT_TURN_PROMPT,
            videoPerDirection: {},
            suffix: ""
        },
        images: emptyImages(),
        videos: emptyVideos(),
        frames: emptyFrames(),
        sheet: { status: "empty", approved: false },
        settings,
        // 新项目默认走转圈截帧：「一致性」比「单张清晰度」更值钱，而八方向图
        // 恰恰最容易在一致性上翻车。逐方向生图保留为备选，随时可切。
        imageMode: "turn",
        turn: emptyTurn(settings.turnFrameCount),
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
        imageMode: project.imageMode,
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
        concurrency: num(settings.concurrency, defaults.concurrency),
        turnFrameCount: clampIntSetting(settings.turnFrameCount, defaults.turnFrameCount, TURN_FRAME_COUNT_MIN, TURN_FRAME_COUNT_MAX)
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
    const imageMode = deriveImageMode(raw);
    return {
        id: String(raw?.id ?? ""),
        name: typeof raw?.name === "string" && raw.name.trim() !== "" ? raw.name : "未命名项目",
        createdAt: num(raw?.createdAt, now),
        updatedAt: num(raw?.updatedAt, now),
        source: raw?.source?.file ? { file: String(raw.source.file), name: String(raw.source.name ?? "source") } : null,
        prompts: {
            images: images_prompts,
            video: typeof raw?.prompts?.video === "string" && raw.prompts.video.trim() !== "" ? raw.prompts.video : DEFAULT_VIDEO_PROMPT,
            turn: typeof raw?.prompts?.turn === "string" && raw.prompts.turn.trim() !== "" ? raw.prompts.turn : DEFAULT_TURN_PROMPT,
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
            frameCount: raw?.sheet?.frameCount,
            backgroundFraction: typeof raw?.sheet?.backgroundFraction === "number" ? raw.sheet.backgroundFraction : undefined,
            borderSamplesDropped: typeof raw?.sheet?.borderSamplesDropped === "number" ? raw.sheet.borderSamplesDropped : undefined,
            borderSamples: typeof raw?.sheet?.borderSamples === "number" ? raw.sheet.borderSamples : undefined
        },
        settings: merged,
        imageMode,
        turn: normalizeTurn(raw?.turn, merged.turnFrameCount),
        reviewMode: raw?.reviewMode === "manual" ? "manual" : raw?.reviewMode === "auto" ? "auto" : undefined,
        log: Array.isArray(raw?.log) ? raw.log.slice(-200) : []
    };
}
function num(value, fallback) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? n : fallback;
}
function clampIntSetting(value, fallback, min, max) {
    return Math.min(max, Math.max(min, Math.round(num(value, fallback))));
}
/**
 * 补齐项目的转圈状态。
 *
 * 老项目（这个字段还不存在时创建的）里 `picks` 一个都没有，这里补成默认的
 * 均分位置——补出来的位置和「用户从没拖过」等价，所以可以安全地当默认值用。
 */
function normalizeTurn(raw, frameCount) {
    const direction = raw?.direction === "cw" ? "cw" : raw?.direction === "ccw" ? "ccw" : TURN_DIRECTION_DEFAULT;
    const fallback = freshPicks(frameCount, direction);
    const picks = {};
    const rawPicks = raw?.frames?.picks;
    for (const key of DIRECTION_KEYS) {
        const value = rawPicks !== null && typeof rawPicks === "object" ? Number(rawPicks[key]) : Number.NaN;
        // 只做「是个合法的非负下标」这一层收敛，**不按 settings.turnFrameCount 夹**：
        // 候选帧的权威张数是 turn.frames.rawFrameCount（抽帧时写下的），而 settings
        // 里的那个值随时可能被用户先改小——按它夹会把用户拖好的位置当场压平
        // （实测：32 帧调到 16 之后 back/upRight/downRight 全挤到最后一帧）。
        // 真正的夹取放在用它的地方：applyTurnPicks 按实际帧数夹。
        picks[key] = Number.isFinite(value)
            ? Math.min(TURN_FRAME_COUNT_MAX - 1, Math.max(0, Math.round(value)))
            : fallback[key];
    }
    const times = Array.isArray(raw?.frames?.times) ? raw.frames.times.map((value) => num(value, 0)) : [];
    return {
        video: {
            status: (raw?.video?.status ?? "empty"),
            taskId: typeof raw?.video?.taskId === "string" ? raw.video.taskId : undefined,
            remoteStatus: typeof raw?.video?.remoteStatus === "string" ? raw.video.remoteStatus : undefined,
            file: typeof raw?.video?.file === "string" ? raw.video.file : undefined,
            approved: raw?.video?.approved === true,
            error: typeof raw?.video?.error === "string" ? raw.video.error : undefined,
            firstFrame: typeof raw?.video?.firstFrame === "string" ? raw.video.firstFrame : undefined,
            elapsedMs: typeof raw?.video?.elapsedMs === "number" ? raw.video.elapsedMs : undefined,
            updatedAt: typeof raw?.video?.updatedAt === "number" ? raw.video.updatedAt : undefined
        },
        frames: {
            status: (raw?.frames?.status ?? "empty"),
            frames: Array.isArray(raw?.frames?.frames) ? raw.frames.frames.map(String) : [],
            times,
            raw: typeof raw?.frames?.raw === "string" ? raw.frames.raw : undefined,
            rawWidth: typeof raw?.frames?.rawWidth === "number" ? raw.frames.rawWidth : undefined,
            rawHeight: typeof raw?.frames?.rawHeight === "number" ? raw.frames.rawHeight : undefined,
            rawFrameCount: typeof raw?.frames?.rawFrameCount === "number" ? raw.frames.rawFrameCount : undefined,
            duration: typeof raw?.frames?.duration === "number" ? raw.frames.duration : undefined,
            picks,
            strip: typeof raw?.frames?.strip === "string" ? raw.frames.strip : undefined,
            approved: raw?.frames?.approved === true,
            error: typeof raw?.frames?.error === "string" ? raw.frames.error : undefined,
            stale: raw?.frames?.stale === true,
            updatedAt: typeof raw?.frames?.updatedAt === "number" ? raw.frames.updatedAt : undefined
        },
        direction
    };
}
/**
 * 老项目（`imageMode` 还不存在时建的）沿用逐方向生图：它们已经有八张图了，
 * 直接跳到空白的转圈页只会让人以为产物丢了。新项目走 `createProject`，默认 turn。
 *
 * `imageMode` 与上面这条判断是**唯一**一处「新旧默认不同」的地方，其余一律
 * 以字段为准——否则读一遍写一遍就会把用户的显式选择改掉。
 */
function deriveImageMode(raw) {
    if (raw?.imageMode === "direct")
        return "direct";
    if (raw?.imageMode === "turn")
        return "turn";
    const hasImages = DIRECTION_KEYS.some((key) => typeof raw?.images?.[key]?.file === "string");
    return hasImages ? "direct" : "turn";
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
