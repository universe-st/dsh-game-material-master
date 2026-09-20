/**
 * 序列帧生成模块。
 *
 * 先用 MiniMax 生成一段视频（支持两种输入模式，平台规定二者互斥）：
 *   - **首尾帧模式**：上传首帧（必填）/ 尾帧（选填）
 *   - **多模态参考模式**：上传参考图 + 参考视频
 * 然后依次做：序列帧提取（张数可配）→ 绿幕抠像 → 横向合成，并可在界面里
 * 直接预览播放效果。
 *
 * 目录结构：
 *   <DSH_HOME>/game-material-master/sequence-jobs/<任务 id>/
 *     job.json
 *     refs/          参考图
 *     video-refs/    参考视频
 *     videos/        生成的视频
 *     frames/        抽出的原始帧 + raw.bin（RGBA 缓存）
 *     keyed/         抠完背景的帧
 *     out/           合成结果
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig, sequenceJobsRoot } from "./config.js";
import { downloadVideo, normalizeDuration, normalizeResolution, queryVideo, retrieveFile, submitVideo } from "./minimax.js";
import { extractFrames, fileSize, mimeOf, toJpegDataUri } from "./media.js";
import { composeSheet, keyGreen } from "./chroma.js";
import { encodePng } from "./png.js";
import { appendJobLog, messageOf, readJson, writeJsonAtomic } from "./jsonio.js";
import { safeName, sniffImage } from "./imagegen.js";
const JOB_ID_PATTERN = /^s[a-z0-9]{4,40}$/;
export function sequenceJobDir(id) {
    return join(sequenceJobsRoot(), id);
}
function jobFile(id) {
    return join(sequenceJobDir(id), "job.json");
}
export function sequenceAssetPath(id, relative) {
    const base = resolve(sequenceJobDir(id));
    const target = resolve(base, relative);
    if (target !== base && !target.startsWith(base + sep))
        throw new Error(`非法的任务内路径：${relative}`);
    return target;
}
export function isValidSequenceJobId(id) {
    return JOB_ID_PATTERN.test(id);
}
export async function ensureSequenceJobLayout(id) {
    for (const sub of ["refs", "video-refs", "videos", "frames", "keyed", "out"]) {
        await mkdir(join(sequenceJobDir(id), sub), { recursive: true });
    }
}
export async function createSequenceJob(name) {
    const config = await loadConfig();
    const id = `s${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = Date.now();
    const job = {
        id,
        name: name.trim() === "" ? "未命名序列帧任务" : name.trim().slice(0, 80),
        createdAt: now,
        updatedAt: now,
        mode: "frames",
        prompt: "",
        suffix: "",
        refs: { referenceImages: [], referenceVideos: [] },
        settings: {
            model: config.minimaxModel,
            duration: config.minimaxDuration,
            resolution: config.minimaxResolution,
            promptOptimizer: config.minimaxPromptOptimizer,
            frameCount: config.frameCount,
            cellWidth: config.cellWidth,
            cellHeight: config.cellHeight,
            longEdge: config.workingLongEdge,
            cropInset: config.cropInset,
            pixelSize: config.pixelSize
        },
        keying: {
            keyLow: config.keyLow,
            keyHigh: config.keyHigh,
            despill: config.despill,
            bgTolerance: config.bgTolerance,
            edgeShrink: config.edgeShrink
        },
        video: { status: "empty" },
        frames: { status: "empty", count: config.frameCount, files: [], keyed: [] },
        sheet: { status: "empty" },
        log: []
    };
    await ensureSequenceJobLayout(id);
    await writeJsonAtomic(jobFile(id), job);
    return job;
}
export async function readSequenceJob(id) {
    if (!isValidSequenceJobId(id))
        return undefined;
    const raw = await readJson(jobFile(id));
    if (raw === undefined)
        return undefined;
    return normalizeSequenceJob(raw);
}
export async function writeSequenceJob(job) {
    job.updatedAt = Date.now();
    await writeJsonAtomic(jobFile(job.id), job);
}
export async function listSequenceJobs() {
    const { readdir } = await import("node:fs/promises");
    let entries = [];
    try {
        const dirents = await readdir(sequenceJobsRoot(), { withFileTypes: true });
        entries = dirents.filter((d) => d.isDirectory() && isValidSequenceJobId(d.name)).map((d) => d.name);
    }
    catch {
        return [];
    }
    const out = [];
    for (const id of entries) {
        const job = await readSequenceJob(id);
        if (job === undefined)
            continue;
        out.push(summarizeSequenceJob(job));
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
}
export function summarizeSequenceJob(job) {
    return {
        id: job.id,
        name: job.name,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        mode: job.mode,
        videoReady: job.video.status === "ready",
        frameReady: job.frames.status === "ready",
        sheetReady: job.sheet.status === "ready"
    };
}
export async function deleteSequenceJob(id) {
    stopSequencePoller(id);
    await rm(sequenceJobDir(id), { recursive: true, force: true });
}
export async function sequenceJobExists(id) {
    try {
        return (await stat(sequenceJobDir(id))).isDirectory();
    }
    catch {
        return false;
    }
}
function normalizeSequenceJob(raw) {
    const ref = (value) => typeof value?.file === "string" ? { file: value.file, name: String(value.name ?? basename(value.file)) } : undefined;
    const refList = (value) => Array.isArray(value) ? value.map(ref).filter((r) => r !== undefined) : [];
    return {
        id: String(raw?.id ?? ""),
        name: typeof raw?.name === "string" && raw.name.trim() !== "" ? raw.name : "未命名序列帧任务",
        createdAt: Number(raw?.createdAt) || Date.now(),
        updatedAt: Number(raw?.updatedAt) || Date.now(),
        mode: raw?.mode === "reference" ? "reference" : "frames",
        prompt: typeof raw?.prompt === "string" ? raw.prompt : "",
        suffix: typeof raw?.suffix === "string" ? raw.suffix : "",
        refs: {
            firstFrame: ref(raw?.refs?.firstFrame),
            lastFrame: ref(raw?.refs?.lastFrame),
            referenceImages: refList(raw?.refs?.referenceImages),
            referenceVideos: refList(raw?.refs?.referenceVideos)
        },
        settings: {
            model: typeof raw?.settings?.model === "string" ? raw.settings.model : "",
            duration: num(raw?.settings?.duration, 5),
            resolution: typeof raw?.settings?.resolution === "string" ? raw.settings.resolution : "768P",
            promptOptimizer: raw?.settings?.promptOptimizer !== false,
            frameCount: clampInt(raw?.settings?.frameCount, 8, 1, 64),
            cellWidth: clampInt(raw?.settings?.cellWidth, 256, 16, 2048),
            cellHeight: clampInt(raw?.settings?.cellHeight, 256, 16, 2048),
            longEdge: clampInt(raw?.settings?.longEdge, 768, 128, 2048),
            cropInset: num(raw?.settings?.cropInset, 0),
            pixelSize: clampInt(raw?.settings?.pixelSize, 0, 0, 32)
        },
        keying: {
            keyLow: clampInt(raw?.keying?.keyLow, 14, 0, 255),
            keyHigh: clampInt(raw?.keying?.keyHigh, 80, 1, 255),
            despill: num(raw?.keying?.despill, 0.65),
            bgTolerance: clampInt(raw?.keying?.bgTolerance, 90, 0, 160),
            edgeShrink: clampInt(raw?.keying?.edgeShrink, 0, 0, 8)
        },
        video: {
            status: (raw?.video?.status ?? "empty"),
            taskId: typeof raw?.video?.taskId === "string" ? raw.video.taskId : undefined,
            remoteStatus: typeof raw?.video?.remoteStatus === "string" ? raw.video.remoteStatus : undefined,
            file: typeof raw?.video?.file === "string" ? raw.video.file : undefined,
            error: typeof raw?.video?.error === "string" ? raw.video.error : undefined,
            approved: raw?.video?.approved === true,
            updatedAt: typeof raw?.video?.updatedAt === "number" ? raw.video.updatedAt : undefined
        },
        frames: {
            status: (raw?.frames?.status ?? "empty"),
            count: clampInt(raw?.frames?.count, 8, 1, 64),
            files: Array.isArray(raw?.frames?.files) ? raw.frames.files.map(String) : [],
            keyed: Array.isArray(raw?.frames?.keyed) ? raw.frames.keyed.map(String) : [],
            raw: typeof raw?.frames?.raw === "string" ? raw.frames.raw : undefined,
            width: typeof raw?.frames?.width === "number" ? raw.frames.width : undefined,
            height: typeof raw?.frames?.height === "number" ? raw.frames.height : undefined,
            duration: typeof raw?.frames?.duration === "number" ? raw.frames.duration : undefined,
            error: typeof raw?.frames?.error === "string" ? raw.frames.error : undefined,
            stale: raw?.frames?.stale === true,
            approved: raw?.frames?.approved === true,
            updatedAt: typeof raw?.frames?.updatedAt === "number" ? raw.frames.updatedAt : undefined
        },
        sheet: {
            status: (raw?.sheet?.status ?? "empty"),
            file: typeof raw?.sheet?.file === "string" ? raw.sheet.file : undefined,
            width: typeof raw?.sheet?.width === "number" ? raw.sheet.width : undefined,
            height: typeof raw?.sheet?.height === "number" ? raw.sheet.height : undefined,
            error: typeof raw?.sheet?.error === "string" ? raw.sheet.error : undefined,
            approved: raw?.sheet?.approved === true,
            updatedAt: typeof raw?.sheet?.updatedAt === "number" ? raw.sheet.updatedAt : undefined
        },
        reviewMode: raw?.reviewMode === "manual" ? "manual" : raw?.reviewMode === "auto" ? "auto" : undefined,
        log: Array.isArray(raw?.log) ? raw.log.slice(-200) : []
    };
}
function num(value, fallback) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? n : fallback;
}
function clampInt(value, fallback, min, max) {
    const n = num(value, fallback);
    return Math.min(max, Math.max(min, Math.round(n)));
}
export function buildSequencePrompt(job) {
    const base = job.prompt.trim();
    if (base === "")
        return { error: "提示词为空，请先填写视频提示词" };
    const suffix = job.suffix.trim();
    return { prompt: suffix === "" ? base : `${base}\n${suffix}` };
}
// ── 后台任务与轮询 ──────────────────────────────────────────────────────
const jobsRunning = new Map();
const pollers = new Map();
let disposed = false;
export function disposeSequence() {
    disposed = true;
    for (const timer of pollers.values())
        clearInterval(timer);
    pollers.clear();
    jobsRunning.clear();
}
export function listSequenceTasks(jobId) {
    return [...(jobsRunning.get(jobId) ?? [])];
}
function kick(jobId, taskKey, fn) {
    if (disposed)
        return false;
    const set = jobsRunning.get(jobId) ?? new Set();
    jobsRunning.set(jobId, set);
    if (set.has(taskKey))
        return false;
    set.add(taskKey);
    void (async () => {
        try {
            await fn();
        }
        catch (error) {
            const job = await readSequenceJob(jobId);
            if (job !== undefined) {
                appendJobLog(job.log, "error", `${taskKey} 失败：${messageOf(error)}`);
                await writeSequenceJob(job);
            }
        }
        finally {
            set.delete(taskKey);
            if (set.size === 0)
                jobsRunning.delete(jobId);
        }
    })();
    return true;
}
/** 拒绝重复提交：同类型的后台任务已在跑时直接报错，避免覆盖 taskId 变成孤儿。 */
function assertIdle(jobId, taskKey, what) {
    if (jobsRunning.get(jobId)?.has(taskKey) === true)
        throw new Error(`${what}已在进行中，请等它跑完`);
}
// ── 视频生成 ────────────────────────────────────────────────────────────
export function startSequenceVideo(jobId) {
    try {
        assertIdle(jobId, "video:submit", "视频生成");
    }
    catch (error) {
        return { started: false, reason: messageOf(error) };
    }
    const started = kick(jobId, "video:submit", () => submitSequenceVideo(jobId));
    return started ? { started: true } : { started: false, reason: "视频任务已在进行中" };
}
async function submitSequenceVideo(jobId) {
    const job = await readSequenceJob(jobId);
    if (job === undefined)
        throw new Error(`任务不存在：${jobId}`);
    const config = await loadConfig();
    if (config.minimaxApiKey.trim() === "")
        throw new Error("尚未配置 MiniMax API Key");
    // 模型是全局设置（设置 → 游戏素材大师 → 视频模型），任务只跟随、不覆盖：
    // 任务的模型快照一旦和当前网关/Key 对不上（例如官方 H3 + 优云智算网关），
    // 就会打出 cp.compshare.cn/v2/... 这种 404。这里以全局配置为准并回写任务。
    const model = config.minimaxModel;
    job.settings.model = model;
    job.settings.duration = normalizeDuration(model, job.settings.duration);
    job.settings.resolution = normalizeResolution(model, job.settings.resolution);
    const built = buildSequencePrompt(job);
    if ("error" in built)
        throw new Error(built.error);
    // 按模式收集素材，转成 data URI（平台只接受公网 URL 或 base64）。
    const firstFrameImage = await toDataUriIfPresent(jobId, job.refs.firstFrame?.file);
    const lastFrameImage = await toDataUriIfPresent(jobId, job.refs.lastFrame?.file);
    const referenceImages = [];
    for (const ref of job.refs.referenceImages) {
        const uri = await toDataUriIfPresent(jobId, ref.file);
        if (uri !== undefined)
            referenceImages.push(uri);
    }
    const referenceVideos = [];
    for (const ref of job.refs.referenceVideos) {
        const uri = await videoDataUri(jobId, ref.file);
        if (uri !== undefined)
            referenceVideos.push(uri);
    }
    if (job.mode === "frames" && firstFrameImage === undefined) {
        throw new Error("首尾帧模式必须上传一张首帧图");
    }
    if (job.mode === "reference" && referenceImages.length === 0 && referenceVideos.length === 0) {
        throw new Error("参考模式至少要上传一张参考图或一段参考视频");
    }
    const previous = job.video;
    job.video = { status: "running", remoteStatus: "提交中", updatedAt: Date.now() };
    appendJobLog(job.log, "info", `提交视频任务（${job.mode === "frames" ? "首尾帧模式" : "参考模式"}）`);
    await writeSequenceJob(job);
    try {
        const taskId = await submitVideo({
            baseUrl: config.minimaxBaseUrl,
            apiKey: config.minimaxApiKey,
            model,
            timeoutMs: config.minimaxTimeoutMs,
            prompt: built.prompt,
            firstFrameImage,
            lastFrameImage,
            referenceImages,
            referenceVideos,
            duration: job.settings.duration,
            resolution: job.settings.resolution,
            promptOptimizer: job.settings.promptOptimizer
        });
        const fresh = await readSequenceJob(jobId);
        if (fresh === undefined)
            return;
        fresh.video = { status: "running", taskId, remoteStatus: "已提交", updatedAt: Date.now() };
        appendJobLog(fresh.log, "info", `视频任务已提交（${taskId}）`);
        await writeSequenceJob(fresh);
        ensureSequencePoller(jobId);
    }
    catch (error) {
        const fresh = await readSequenceJob(jobId);
        if (fresh === undefined)
            return;
        fresh.video = { ...previous, status: "error", remoteStatus: "提交失败", error: messageOf(error), updatedAt: Date.now() };
        appendJobLog(fresh.log, "error", `视频提交失败：${messageOf(error)}`);
        await writeSequenceJob(fresh);
        throw error;
    }
}
async function toDataUriIfPresent(jobId, file) {
    if (file === undefined)
        return undefined;
    const absolute = sequenceAssetPath(jobId, file);
    const { readFile: rf } = await import("node:fs/promises");
    const bytes = await rf(absolute);
    return `data:${mimeOf(file)};base64,${bytes.toString("base64")}`;
}
async function videoDataUri(jobId, file) {
    const absolute = sequenceAssetPath(jobId, file);
    const size = await fileSize(absolute);
    // 请求体总上限 64MB；base64 会放大 1/3，所以原始文件卡在 40MB。
    if (size > 40 * 1024 * 1024)
        throw new Error(`参考视频 ${basename(file)} 超过 40 MB，平台要求改用公网 URL，本地文件请先压缩`);
    const bytes = await readFile(absolute);
    const mime = file.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
    return `data:${mime};base64,${bytes.toString("base64")}`;
}
export function ensureSequencePoller(jobId) {
    if (pollers.has(jobId))
        return;
    const timer = setInterval(() => {
        void pollSequenceOnce(jobId).catch(() => undefined);
    }, 15000);
    timer.unref?.();
    pollers.set(jobId, timer);
    void pollSequenceOnce(jobId).catch(() => undefined);
}
export function stopSequencePoller(jobId) {
    const timer = pollers.get(jobId);
    if (timer !== undefined)
        clearInterval(timer);
    pollers.delete(jobId);
}
export async function pollSequenceOnce(jobId) {
    if (disposed)
        return;
    const job = await readSequenceJob(jobId);
    if (job === undefined) {
        stopSequencePoller(jobId);
        return;
    }
    const taskId = job.video.taskId;
    if (job.video.status !== "running" || taskId === undefined) {
        stopSequencePoller(jobId);
        return;
    }
    const config = await loadConfig();
    const request = {
        baseUrl: config.minimaxBaseUrl,
        apiKey: config.minimaxApiKey,
        model: job.settings.model || config.minimaxModel,
        timeoutMs: config.minimaxTimeoutMs
    };
    try {
        const query = await queryVideo({ ...request, taskId });
        if (query.status === "failed") {
            const fresh = await readSequenceJob(jobId);
            if (fresh === undefined)
                return;
            fresh.video = { ...fresh.video, status: "error", remoteStatus: query.remoteStatus, error: query.error ?? "MiniMax 报告任务失败", updatedAt: Date.now() };
            appendJobLog(fresh.log, "error", `视频生成失败：${fresh.video.error}`);
            await writeSequenceJob(fresh);
            stopSequencePoller(jobId);
            return;
        }
        if (query.status !== "succeeded") {
            const fresh = await readSequenceJob(jobId);
            if (fresh === undefined)
                return;
            fresh.video = { ...fresh.video, remoteStatus: query.remoteStatus, updatedAt: Date.now() };
            await writeSequenceJob(fresh);
            return;
        }
        const url = query.videoUrl ?? (query.fileId !== undefined ? await retrieveFile({ ...request, fileId: query.fileId }) : undefined);
        if (url === undefined)
            throw new Error("任务已成功，但响应里既没有视频地址也没有 file_id");
        const bytes = await downloadVideo(url, config.minimaxTimeoutMs);
        const relative = "videos/output.mp4";
        await writeFile(sequenceAssetPath(jobId, relative), bytes);
        const fresh = await readSequenceJob(jobId);
        if (fresh === undefined)
            return;
        fresh.video = { status: "ready", taskId, remoteStatus: query.remoteStatus, file: relative, error: undefined, updatedAt: Date.now() };
        fresh.frames = { status: "empty", count: fresh.settings.frameCount, files: [], keyed: [] };
        fresh.sheet = { status: "empty" };
        appendJobLog(fresh.log, "info", `视频已下载（${(bytes.length / 1024 / 1024).toFixed(1)} MB）`);
        await writeSequenceJob(fresh);
        stopSequencePoller(jobId);
    }
    catch (error) {
        // 单次轮询失败不等于任务失败，保留 running 让下一轮重试。
        const fresh = await readSequenceJob(jobId);
        if (fresh === undefined)
            return;
        fresh.video = { ...fresh.video, remoteStatus: `查询异常：${messageOf(error)}` };
        await writeSequenceJob(fresh);
    }
}
// ── 抽帧 / 抠像 / 合成 ──────────────────────────────────────────────────
export function startSequenceFrames(jobId, count) {
    try {
        assertIdle(jobId, "frames", "抽帧");
    }
    catch (error) {
        return { started: false, reason: messageOf(error) };
    }
    const started = kick(jobId, "frames", () => extractSequenceFrames(jobId, count));
    return started ? { started: true } : { started: false, reason: "抽帧已在进行中" };
}
export async function extractSequenceFrames(jobId, count) {
    const job = await readSequenceJob(jobId);
    if (job === undefined)
        throw new Error(`任务不存在：${jobId}`);
    if (job.video.file === undefined)
        throw new Error("还没有可用视频，请先生成视频");
    const frameCount = clampInt(count ?? job.settings.frameCount, job.settings.frameCount, 1, 64);
    job.frames = { ...job.frames, status: "running", error: undefined, count: frameCount };
    appendJobLog(job.log, "info", `开始抽帧：${frameCount} 张`);
    await writeSequenceJob(job);
    try {
        const extracted = await extractFrames({
            video: sequenceAssetPath(jobId, job.video.file),
            frameCount,
            longEdge: job.settings.longEdge,
            cropInset: job.settings.cropInset
        });
        const rawRelative = "frames/raw.bin";
        await mkdir(join(sequenceJobDir(jobId), "frames"), { recursive: true });
        await writeFile(sequenceAssetPath(jobId, rawRelative), Buffer.concat(extracted.frames));
        await mkdir(join(sequenceJobDir(jobId), "keyed"), { recursive: true });
        const files = [];
        for (let i = 0; i < extracted.frames.length; i++) {
            const relative = `frames/f${String(i).padStart(2, "0")}.png`;
            await writeFile(sequenceAssetPath(jobId, relative), encodePng(extracted.frames[i], extracted.width, extracted.height));
            files.push(relative);
        }
        const fresh = await readSequenceJob(jobId);
        if (fresh === undefined)
            return;
        fresh.frames = {
            status: "ready",
            count: files.length,
            files,
            keyed: [],
            raw: rawRelative,
            width: extracted.width,
            height: extracted.height,
            duration: extracted.duration,
            stale: false,
            updatedAt: Date.now()
        };
        fresh.settings.frameCount = frameCount;
        appendJobLog(fresh.log, "info", `抽帧完成：${files.length} 张 / ${extracted.width}×${extracted.height} / 视频时长 ${extracted.duration.toFixed(2)} 秒`);
        await writeSequenceJob(fresh);
        await keySequenceFrames(jobId);
        await composeSequenceSheet(jobId);
    }
    catch (error) {
        const fresh = await readSequenceJob(jobId);
        if (fresh === undefined)
            return;
        fresh.frames = { ...fresh.frames, status: "error", error: messageOf(error) };
        appendJobLog(fresh.log, "error", `抽帧失败：${messageOf(error)}`);
        await writeSequenceJob(fresh);
        throw error;
    }
}
export function startSequenceKey(jobId) {
    try {
        assertIdle(jobId, "key", "抠像");
    }
    catch (error) {
        return { started: false, reason: messageOf(error) };
    }
    const started = kick(jobId, "key", async () => {
        await keySequenceFrames(jobId);
        await composeSequenceSheet(jobId);
    });
    return started ? { started: true } : { started: false, reason: "抠像已在进行中" };
}
/** 按当前参数对全部帧跑一遍抠像，写出透明 PNG。 */
export async function keySequenceFrames(jobId) {
    const job = await readSequenceJob(jobId);
    if (job === undefined)
        throw new Error(`任务不存在：${jobId}`);
    if (job.frames.raw === undefined || job.frames.width === undefined || job.frames.height === undefined) {
        throw new Error("还没有抽过帧，请先抽帧");
    }
    const raw = await readFile(sequenceAssetPath(jobId, job.frames.raw));
    const width = job.frames.width;
    const height = job.frames.height;
    const frameBytes = width * height * 4;
    const total = Math.max(0, Math.floor(raw.length / frameBytes));
    const keyed = [];
    for (let i = 0; i < total; i++) {
        const slice = Buffer.from(raw.subarray(i * frameBytes, (i + 1) * frameBytes));
        const result = keyGreen(slice, width, height, {
            keyLow: job.keying.keyLow,
            keyHigh: job.keying.keyHigh,
            despill: job.keying.despill,
            edgeShrink: job.keying.edgeShrink,
            bgTolerance: job.keying.bgTolerance
        });
        const relative = `keyed/f${String(i).padStart(2, "0")}.png`;
        await writeFile(sequenceAssetPath(jobId, relative), encodePng(result.rgba, width, height));
        keyed.push(relative);
    }
    const fresh = await readSequenceJob(jobId);
    if (fresh === undefined)
        return;
    fresh.frames = { ...fresh.frames, keyed, stale: false };
    appendJobLog(fresh.log, "info", `抠像完成：${keyed.length} 帧`);
    await writeSequenceJob(fresh);
}
/** 把所有抠好的帧横向拼成一张条图。 */
export async function composeSequenceSheet(jobId) {
    const job = await readSequenceJob(jobId);
    if (job === undefined)
        throw new Error(`任务不存在：${jobId}`);
    if (job.frames.raw === undefined || job.frames.width === undefined || job.frames.height === undefined) {
        throw new Error("还没有抽过帧，请先抽帧");
    }
    const raw = await readFile(sequenceAssetPath(jobId, job.frames.raw));
    const width = job.frames.width;
    const height = job.frames.height;
    const frameBytes = width * height * 4;
    const total = Math.max(0, Math.floor(raw.length / frameBytes));
    const frames = [];
    for (let i = 0; i < total; i++) {
        const slice = Buffer.from(raw.subarray(i * frameBytes, (i + 1) * frameBytes));
        const result = keyGreen(slice, width, height, {
            keyLow: job.keying.keyLow,
            keyHigh: job.keying.keyHigh,
            despill: job.keying.despill,
            edgeShrink: job.keying.edgeShrink,
            bgTolerance: job.keying.bgTolerance
        });
        frames.push(result.rgba);
    }
    if (frames.length === 0)
        throw new Error("没有可合成的帧");
    const row = { key: "sequence", frames, width, height };
    const sheet = composeSheet([row], {
        cellWidth: job.settings.cellWidth,
        cellHeight: job.settings.cellHeight,
        frameCount: frames.length,
        autoCrop: true,
        fillRatio: 0.94,
        pixelSize: job.settings.pixelSize,
        fitMode: "contain",
        bottomMargin: 2
    });
    const relative = "out/sequence-strip.png";
    await mkdir(join(sequenceJobDir(jobId), "out"), { recursive: true });
    await writeFile(sequenceAssetPath(jobId, relative), encodePng(sheet.rgba, sheet.width, sheet.height));
    const fresh = await readSequenceJob(jobId);
    if (fresh === undefined)
        return;
    fresh.sheet = { status: "ready", file: relative, width: sheet.width, height: sheet.height, updatedAt: Date.now() };
    appendJobLog(fresh.log, "info", `序列帧合成完成：${sheet.width}×${sheet.height}`);
    await writeSequenceJob(fresh);
}
export async function uploadSequenceRef(jobId, kind, name, base64) {
    const job = await readSequenceJob(jobId);
    if (job === undefined)
        throw new Error(`任务不存在：${jobId}`);
    const clean = base64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(clean, "base64");
    if (bytes.length === 0)
        throw new Error("文件数据为空");
    if (kind === "referenceVideo") {
        if (bytes.length > 40 * 1024 * 1024)
            throw new Error("参考视频超过 40 MB，平台要求改用公网 URL");
        if (job.refs.referenceVideos.length >= 3)
            throw new Error("参考视频最多 3 段");
        const ext = /\.mov$/i.test(name) ? "mov" : "mp4";
        const relative = `video-refs/${randomUUID().slice(0, 8)}.${ext}`;
        await mkdir(join(sequenceJobDir(jobId), "video-refs"), { recursive: true });
        await writeFile(sequenceAssetPath(jobId, relative), bytes);
        job.refs.referenceVideos.push({ file: relative, name: safeName(name) });
        appendJobLog(job.log, "info", `已添加参考视频：${safeName(name)}`);
        await writeSequenceJob(job);
        return;
    }
    const sniffed = sniffImage(clean);
    if (sniffed === undefined)
        throw new Error("无法识别的图片格式（支持 PNG / JPEG / WebP / BMP）");
    const relative = `refs/${kind}-${randomUUID().slice(0, 8)}.${sniffed.ext}`;
    await mkdir(join(sequenceJobDir(jobId), "refs"), { recursive: true });
    await writeFile(sequenceAssetPath(jobId, relative), bytes);
    const entry = { file: relative, name: safeName(name) };
    if (kind === "firstFrame")
        job.refs.firstFrame = entry;
    else if (kind === "lastFrame")
        job.refs.lastFrame = entry;
    else {
        if (job.refs.referenceImages.length >= 9)
            throw new Error("参考图最多 9 张");
        job.refs.referenceImages.push(entry);
    }
    appendJobLog(job.log, "info", `已添加${kind === "firstFrame" ? "首帧图" : kind === "lastFrame" ? "尾帧图" : "参考图"}：${entry.name}`);
    await writeSequenceJob(job);
}
export async function removeSequenceRef(jobId, kind, file) {
    const job = await readSequenceJob(jobId);
    if (job === undefined)
        throw new Error(`任务不存在：${jobId}`);
    if (kind === "firstFrame")
        job.refs.firstFrame = undefined;
    else if (kind === "lastFrame")
        job.refs.lastFrame = undefined;
    else if (kind === "referenceImage")
        job.refs.referenceImages = job.refs.referenceImages.filter((r) => r.file !== file);
    else
        job.refs.referenceVideos = job.refs.referenceVideos.filter((r) => r.file !== file);
    await writeSequenceJob(job);
}
export { toJpegDataUri };
