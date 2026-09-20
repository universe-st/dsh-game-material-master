/**
 * 流水线编排。
 *
 * 四个阶段，每个阶段都可独立重跑、独立验收：
 *
 *   1. images  源图 → 正面 → 背面 → 四斜向 → 左右        （火山方舟 Seedream）
 *   2. videos  每张绿幕图 → 一段「固定镜头 + 走三步」视频   （MiniMax 图生视频）
 *   3. frames  每段视频按时长平均抽 N 帧                    （ffmpeg）
 *   4. sheet   全部帧抠绿幕 → 拼成一张 8×8 整图             （内置抠像 + PNGu 编码）
 *
 * 所有耗时操作都通过 kick() 丢到后台，远程调用只负责「启动」和「读状态」，
 * 界面靠自己轮询 getState 看进度——一次 Hailuo 生成要几分钟，绝不能同步阻塞。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { DIRECTIONS, DIRECTION_KEYS, directionOf } from "./directions.js";
import { generateImage } from "./ark.js";
import { downloadVideo, queryVideo, retrieveFile, submitVideo } from "./minimax.js";
import { extractFrames, mimeOf, toDataUri, toJpegDataUri } from "./media.js";
import { composeSheet, keyGreen } from "./chroma.js";
import { encodePng } from "./png.js";
import { assetPath, log, patchProject, readProject, referenceFiles } from "./store.js";
/** 生图的依赖分层：同一层内可并发，层与层之间必须按序。 */
const IMAGE_STAGES = [
    ["front"],
    ["back"],
    ["downLeft", "downRight"],
    ["upLeft", "upRight"],
    ["left", "right"]
];
const jobs = new Map();
const pollers = new Map();
let disposed = false;
export function disposePipeline() {
    disposed = true;
    for (const timer of pollers.values())
        clearInterval(timer);
    pollers.clear();
    jobs.clear();
}
export function listJobs(projectId) {
    return [...(jobs.get(projectId)?.values() ?? [])];
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function arkRequest(config) {
    return {
        baseUrl: config.arkBaseUrl,
        apiKey: config.arkApiKey,
        model: config.arkModel,
        timeoutMs: config.arkTimeoutMs
    };
}
function miniMaxRequest(config) {
    return {
        baseUrl: config.minimaxBaseUrl,
        apiKey: config.minimaxApiKey,
        model: config.minimaxModel,
        timeoutMs: config.minimaxTimeoutMs
    };
}
/** 把一个后台任务登记进运行表并立刻返回；重复的 taskKey 会被拒绝。 */
function kick(projectId, taskKey, label, fn) {
    if (disposed)
        return false;
    const map = jobs.get(projectId) ?? new Map();
    jobs.set(projectId, map);
    if (map.has(taskKey))
        return false;
    map.set(taskKey, { key: taskKey, label, startedAt: Date.now() });
    void (async () => {
        try {
            await fn();
        }
        catch (error) {
            await patchProject(projectId, (project) => {
                log(project, "error", `${label}失败：${messageOf(error)}`);
            }).catch(() => undefined);
        }
        finally {
            map.delete(taskKey);
            if (map.size === 0)
                jobs.delete(projectId);
        }
    })();
    return true;
}
async function mapLimit(items, limit, fn) {
    const size = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    await Promise.all(Array.from({ length: size }, async () => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length || disposed)
                return;
            await fn(items[index], index);
        }
    }));
}
/**
 * 公布 / 更新一个后台任务覆盖的方向。
 *
 * 在 kick 的回调**第一个 await 之前**调用，远程调用返回时列表已经就绪——
 * 界面第一次轮询就能看到，不会出现「本地 pending 撤了、宿主列表还没写」的空窗。
 */
function setJobTargets(projectId, taskKey, targets) {
    const info = jobs.get(projectId)?.get(taskKey);
    if (info !== undefined)
        info.targets = [...targets];
}
/** 某个方向的产物已经可见，从任务的覆盖面里摘掉，界面不再盖着它。 */
function dropJobTarget(projectId, taskKey, key) {
    const info = jobs.get(projectId)?.get(taskKey);
    if (info === undefined || info.targets === undefined)
        return;
    info.targets = info.targets.filter((item) => item !== key);
}
export function startImage(projectId, key, options = {}) {
    const direction = directionOf(key);
    if (direction === undefined)
        return { started: false, reason: `未知方向：${key}` };
    if (jobs.get(projectId)?.has(`image:${key}`) === true)
        return { started: false, reason: "该方向正在生成中" };
    const started = kick(projectId, `image:${key}`, `生成「${direction.label}」`, () => generateOne(projectId, key, options.prompt));
    return started ? { started: true } : { started: false, reason: "任务已在进行中" };
}
async function generateOne(projectId, key, promptOverride) {
    const direction = directionOf(key);
    if (direction === undefined)
        throw new Error(`未知方向：${key}`);
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const config = await loadConfig();
    const basePrompt = (promptOverride ?? project.prompts.images[key] ?? "").trim();
    if (basePrompt === "")
        throw new Error("提示词为空，请先填写生图提示词");
    // 统一附加提示词接在每个方向的提示词后面（跨方向的共同注意事项）。
    const suffix = (project.prompts.suffix ?? "").trim();
    const prompt = suffix === "" ? basePrompt : `${basePrompt}\n${suffix}`;
    const refs = referenceFiles(project, direction.refs);
    if (direction.refs.includes("source") && refs.length === 0) {
        throw new Error("还没有上传源图，无法生成正面基准图");
    }
    const missing = direction.refs.filter((ref) => ref !== "source" && project.images[ref]?.file === undefined);
    if (missing.length > 0) {
        throw new Error(`参考图还没准备好：${missing.map((k) => directionOf(k)?.label ?? k).join("、")}`);
    }
    await patchProject(projectId, (current) => {
        current.images[key] = { ...current.images[key], status: "running", error: undefined };
        log(current, "info", `开始生成「${direction.label}」`);
    });
    const startedAt = Date.now();
    try {
        const images = await Promise.all(refs.map((file) => toDataUri(file, mimeOf(file))));
        const result = await generateImage({
            ...arkRequest(config),
            prompt,
            images,
            size: config.arkSize,
            watermark: config.arkWatermark
        });
        const relative = `images/${key}.${result.ext}`;
        await mkdir(dirname(assetPath(projectId, relative)), { recursive: true });
        await writeFile(assetPath(projectId, relative), result.bytes);
        const elapsed = Date.now() - startedAt;
        await patchProject(projectId, (current) => {
            const obsolete = current.images[key]?.file;
            current.images[key] = {
                status: "ready",
                file: relative,
                approved: false,
                stale: false,
                model: config.arkModel,
                elapsedMs: elapsed,
                updatedAt: Date.now()
            };
            // 依赖这一张的下游全部标记为「已过期」，提示用户重新生成。
            if (obsolete !== undefined) {
                markDependentsStale(current, key);
            }
            log(current, "info", `「${direction.label}」生成完成，用时 ${(elapsed / 1000).toFixed(1)} 秒`);
        });
    }
    catch (error) {
        const message = messageOf(error);
        await patchProject(projectId, (current) => {
            current.images[key] = { ...current.images[key], status: "error", error: message };
            log(current, "error", `「${direction.label}」生成失败：${message}`);
        });
        throw error;
    }
}
function markDependentsStale(project, changed) {
    for (const direction of DIRECTIONS) {
        if (!direction.refs.includes(changed))
            continue;
        const node = project.images[direction.key];
        if (node?.status === "ready")
            node.stale = true;
    }
}
/** 按依赖顺序把八张图全部生成一遍（用户已手工通过的图会被跳过）。 */
export function startAllImages(projectId, force = false) {
    const started = kick(projectId, "images:all", "批量生成八方向图", async () => {
        // 一开工先把八个方向都盖住（与「刚点下去」时本地 pending 表的表现一致），
        // 等这一批到底要重做哪些方向算出来再收窄——生图要跑好几分钟，
        // 已经通过验收、这次不会重做的方向不能一直盖着。
        setJobTargets(projectId, "images:all", DIRECTION_KEYS);
        const plan = [];
        for (const stage of IMAGE_STAGES) {
            const project = await readProject(projectId);
            if (project === undefined)
                throw new Error(`项目不存在：${projectId}`);
            plan.push(stage.filter((key) => {
                const node = project.images[key];
                const fresh = node?.status === "ready" && node.stale !== true;
                return force || !(fresh && node.approved);
            }));
        }
        // 收窄到这一批真要做的方向：还没轮到的也要盖住，跳过的一个都不多盖。
        setJobTargets(projectId, "images:all", plan.flat());
        const config = await loadConfig();
        for (const todo of plan) {
            if (disposed)
                return;
            // 出图落地后逐个摘掉：成功是露出新图，失败是露出错误。
            await mapLimit(todo, config.concurrency, async (key) => {
                try {
                    await generateOne(projectId, key, undefined);
                }
                catch {
                    // generateOne 已经把错误写进节点状态，这里继续推进其余方向。
                }
                finally {
                    dropJobTarget(projectId, "images:all", key);
                }
            });
        }
    });
    return started ? { started: true } : { started: false, reason: "批量生成已在进行中" };
}
// ── 阶段 2：八段视频 ──────────────────────────────────────────────────────
export function startVideos(projectId, keys) {
    const started = kick(projectId, "videos:submit", "提交视频任务", async () => {
        // 第一个 await 之前就把覆盖面公布出去：远程调用返回时界面已经能靠它
        // 盖住「还没轮到」的方向，不必等本地 pending 表那 700ms 的缓冲。
        setJobTargets(projectId, "videos:submit", keys ?? DIRECTION_KEYS);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        const config = await loadConfig();
        if (config.minimaxApiKey.trim() === "")
            throw new Error("尚未配置 MiniMax API Key");
        const targets = (keys ?? DIRECTION_KEYS).filter((key) => {
            const image = project.images[key];
            const video = project.videos[key];
            if (image?.file === undefined)
                return false;
            if (video?.status === "ready")
                return false;
            // 已经在跑的任务绝不能重复提交：覆盖掉 taskId 会让前一个任务变成
            // 无人认领的孤儿，钱照花、结果拿不到。
            if (video?.status === "running" && typeof video.taskId === "string")
                return false;
            return true;
        });
        // 收窄成真正要提交的那几个：被跳过（已经完成）的方向不该被盖上遮罩。
        setJobTargets(projectId, "videos:submit", targets);
        if (targets.length === 0) {
            const already = (keys ?? DIRECTION_KEYS).filter((key) => project.videos[key]?.status === "running");
            throw new Error(already.length > 0
                ? `这些方向已经在生成中，请等它们跑完：${already.join("、")}`
                : "没有可提交的方向：请先生成绿幕图，或先清掉已完成的视频");
        }
        await mapLimit(targets, config.concurrency, async (key) => {
            const label = directionOf(key)?.label ?? key;
            const fresh = await readProject(projectId);
            if (fresh === undefined)
                return;
            const image = fresh.images[key];
            if (image?.file === undefined)
                return;
            await patchProject(projectId, (current) => {
                current.videos[key] = { ...current.videos[key], status: "running", error: undefined, remoteStatus: "提交中" };
                log(current, "info", `提交「${label}」视频任务`);
            });
            try {
                const jpegRel = `videos/${key}-first-frame.jpg`;
                const dataUri = await toJpegDataUri(assetPath(projectId, image.file), assetPath(projectId, jpegRel));
                const prompt = (fresh.prompts.videoPerDirection?.[key] ?? fresh.prompts.video).trim();
                const taskId = await submitVideo({
                    ...miniMaxRequest(config),
                    prompt,
                    firstFrameImage: dataUri,
                    duration: config.minimaxDuration,
                    resolution: config.minimaxResolution,
                    promptOptimizer: config.minimaxPromptOptimizer
                });
                await patchProject(projectId, (current) => {
                    current.videos[key] = {
                        ...current.videos[key],
                        status: "running",
                        taskId,
                        remoteStatus: "已提交",
                        updatedAt: Date.now()
                    };
                    log(current, "info", `「${label}」视频任务已提交（${taskId}）`);
                });
            }
            catch (error) {
                const message = messageOf(error);
                await patchProject(projectId, (current) => {
                    current.videos[key] = { ...current.videos[key], status: "error", error: message, remoteStatus: "提交失败", updatedAt: Date.now() };
                    log(current, "error", `「${label}」视频提交失败：${message}`);
                });
            }
            finally {
                // 提交这一步结束（成功进 running、失败进 error）就摘掉：
                // 之后的进度由节点自己的 running 状态负责，不该再靠这张覆盖面。
                dropJobTarget(projectId, "videos:submit", key);
            }
        });
        ensurePoller(projectId);
    });
    return started ? { started: true } : { started: false, reason: "视频任务提交已在进行中" };
}
export function ensurePoller(projectId) {
    if (pollers.has(projectId))
        return;
    const timer = setInterval(() => {
        void pollVideosOnce(projectId).catch(() => undefined);
    }, 15000);
    timer.unref?.();
    pollers.set(projectId, timer);
    // 立刻跑一次，避免用户等满一个轮询周期。
    void pollVideosOnce(projectId).catch(() => undefined);
}
export function stopPoller(projectId) {
    const timer = pollers.get(projectId);
    if (timer !== undefined)
        clearInterval(timer);
    pollers.delete(projectId);
}
/** 手动触发一次轮询（界面上的「刷新」按钮）。 */
export async function pollVideosOnce(projectId) {
    if (disposed)
        return;
    const project = await readProject(projectId);
    if (project === undefined) {
        stopPoller(projectId);
        return;
    }
    const config = await loadConfig();
    const pending = DIRECTION_KEYS.filter((key) => project.videos[key]?.status === "running" && typeof project.videos[key]?.taskId === "string");
    if (pending.length === 0) {
        stopPoller(projectId);
        return;
    }
    await Promise.all(pending.map(async (key) => {
        const label = directionOf(key)?.label ?? key;
        const taskId = project.videos[key].taskId;
        try {
            const query = await queryVideo({ ...miniMaxRequest(config), taskId });
            if (query.status === "failed") {
                const reason = query.error ?? "MiniMax 报告该任务失败";
                await patchProject(projectId, (current) => {
                    current.videos[key] = { ...current.videos[key], status: "error", error: reason, remoteStatus: query.remoteStatus, updatedAt: Date.now() };
                    log(current, "error", `「${label}」视频生成失败：${reason}`);
                });
                return;
            }
            if (query.status !== "succeeded") {
                await patchProject(projectId, (current) => {
                    current.videos[key] = { ...current.videos[key], remoteStatus: query.remoteStatus, updatedAt: Date.now() };
                });
                return;
            }
            // v2（H3）在查询结果里直接给地址；v1 还要拿 file_id 再换一次。
            const url = query.videoUrl ??
                (query.fileId !== undefined ? await retrieveFile({ ...miniMaxRequest(config), fileId: query.fileId }) : undefined);
            if (url === undefined)
                throw new Error("任务已成功，但响应里既没有视频地址也没有 file_id");
            const bytes = await downloadVideo(url, config.minimaxTimeoutMs);
            const relative = `videos/${key}.mp4`;
            await writeFile(assetPath(projectId, relative), bytes);
            await patchProject(projectId, (current) => {
                current.videos[key] = {
                    status: "ready",
                    file: relative,
                    taskId,
                    remoteStatus: query.remoteStatus,
                    approved: false,
                    updatedAt: Date.now()
                };
                log(current, "info", `「${label}」视频已下载（${(bytes.length / 1024 / 1024).toFixed(1)} MB）`);
            });
        }
        catch (error) {
            const message = messageOf(error);
            // 单次轮询失败不等于任务失败——网络抖动很常见，保留 running 让下一轮重试。
            await patchProject(projectId, (current) => {
                const node = current.videos[key];
                if (node !== undefined)
                    node.remoteStatus = `查询异常：${message}`;
            });
        }
    }));
    const after = await readProject(projectId);
    if (after !== undefined && !DIRECTION_KEYS.some((key) => after.videos[key]?.status === "running")) {
        stopPoller(projectId);
    }
}
// ── 阶段 3：抽帧 ─────────────────────────────────────────────────────────
/**
 * 抽取序列帧。`keys` 是要抽的方向；省略则按「有视频的方向」全抽。
 * 调用方（`runFrames`）已经把没有视频的方向滤掉了，这里再滤一次兜底。
 */
export function startExtract(projectId, keys) {
    const started = kick(projectId, "frames:extract", "抽取序列帧", async () => {
        const scope = keys ?? DIRECTION_KEYS;
        // 第一个 await 之前就公布覆盖面，理由同 startVideos：抽帧是「一次两个方向」
        // 慢慢做的，还没轮到的方向必须靠这张表盖着，否则界面会闪回「尚未抽帧」。
        setJobTargets(projectId, "frames:extract", scope);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        const config = await loadConfig();
        const targets = scope.filter((key) => project.videos[key]?.file !== undefined);
        // 没有视频的方向不会产出任何东西，必须从覆盖面里去掉——留着它们会一直转圈。
        setJobTargets(projectId, "frames:extract", targets);
        if (targets.length === 0)
            throw new Error("还没有可抽帧的视频");
        await mapLimit(targets, Math.min(2, config.concurrency), async (key) => {
            const label = directionOf(key)?.label ?? key;
            const fresh = await readProject(projectId);
            if (fresh === undefined)
                return;
            const video = fresh.videos[key];
            if (video?.file === undefined)
                return;
            await patchProject(projectId, (current) => {
                current.frames[key] = { ...current.frames[key], status: "running", error: undefined };
                log(current, "info", `开始抽取「${label}」序列帧`);
            });
            try {
                const settings = fresh.settings;
                // 抽到「工作尺寸」而不是最终格子尺寸：自动裁剪、缩放和像素量化
                // 全部放在 JS 里做，才能让八个方向共享同一个裁剪框和缩放比例。
                const extracted = await extractFrames({
                    video: assetPath(projectId, video.file),
                    frameCount: settings.frameCount,
                    longEdge: settings.workingLongEdge,
                    cropInset: settings.cropInset
                });
                const rawRelative = `frames/${key}/raw.bin`;
                await mkdir(dirname(assetPath(projectId, rawRelative)), { recursive: true });
                // 抠好的帧写在另一个子目录下，必须单独建——ensureLayout 只建到 keyed/ 这一层。
                await mkdir(dirname(assetPath(projectId, `keyed/${key}/f00.png`)), { recursive: true });
                await writeFile(assetPath(projectId, rawRelative), Buffer.concat(extracted.frames));
                const framePaths = [];
                for (let i = 0; i < extracted.frames.length; i++) {
                    const suffix = String(i).padStart(2, "0");
                    const greenRelative = `frames/${key}/f${suffix}.png`;
                    await writeFile(assetPath(projectId, greenRelative), encodePng(extracted.frames[i], extracted.width, extracted.height));
                    framePaths.push(greenRelative);
                }
                await patchProject(projectId, (current) => {
                    current.frames[key] = {
                        status: "ready",
                        frames: framePaths,
                        keyed: [],
                        approved: false,
                        stale: false,
                        raw: rawRelative,
                        rawWidth: extracted.width,
                        rawHeight: extracted.height,
                        rawFrameCount: settings.frameCount,
                        duration: extracted.duration,
                        updatedAt: Date.now()
                    };
                    log(current, "info", `「${label}」抽帧完成：${framePaths.length} 帧 / ${extracted.width}×${extracted.height} / 视频时长 ${extracted.duration.toFixed(2)} 秒`);
                });
            }
            catch (error) {
                const message = messageOf(error);
                await patchProject(projectId, (current) => {
                    current.frames[key] = { ...current.frames[key], status: "error", error: message };
                    log(current, "error", `「${label}」抽帧失败：${message}`);
                });
            }
        });
        // 抽完帧立刻按当前参数出一次抠像结果与预览带。
        await renderSheet(projectId);
    });
    return started ? { started: true } : { started: false, reason: "抽帧任务已在进行中" };
}
// ── 阶段 4：抠像 + 合成整图 ──────────────────────────────────────────────
/** 只按当前参数重跑抠像与合成（不重新解码视频）。 */
export function startRekey(projectId) {
    const started = kick(projectId, "sheet:key", "重新抠像", async () => {
        await renderSheet(projectId, { requireFrames: true });
    });
    return started ? { started: true } : { started: false, reason: "抠像任务已在进行中" };
}
export function startCompose(projectId) {
    const started = kick(projectId, "sheet:compose", "合成整图", async () => {
        await renderSheet(projectId, { requireFrames: true });
    });
    return started ? { started: true } : { started: false, reason: "合成任务已在进行中" };
}
/**
 * 抠像 + 合成。`startExtract` / `startRekey` / `startCompose` 都走这一条路径，
 * 保证「界面看到的预览」和「最终整图」永远出自同一套参数。
 *
 * 关键点：所有方向共用**一个**裁剪框（各帧 alpha 包围盒的并集）与缩放比例，
 * 否则每个方向角色大小不一、脚底高低不齐，整图就没法当精灵图用。
 */
async function renderSheet(projectId, options = {}) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const settings = project.settings;
    await patchProject(projectId, (current) => {
        current.sheet = { ...current.sheet, status: "running", error: undefined };
    });
    try {
        const keyOptions = {
            keyLow: settings.keyLow,
            keyHigh: settings.keyHigh,
            despill: settings.despill,
            edgeShrink: settings.edgeShrink,
            bgTolerance: settings.bgTolerance
        };
        const order = settings.rowOrder.filter((key) => directionOf(key) !== undefined);
        const rows = [];
        let hasFrames = false;
        let working = { width: 0, height: 0 };
        for (const key of order) {
            const node = project.frames[key];
            if (node?.rawWidth !== undefined && node.rawWidth > 0)
                working = { width: node.rawWidth, height: node.rawHeight };
        }
        for (const key of order) {
            const node = project.frames[key];
            const row = { key, frames: [], width: working.width, height: working.height };
            if (node?.raw !== undefined && node.rawWidth !== undefined && node.rawWidth > 0) {
                const width = node.rawWidth;
                const height = node.rawHeight;
                const raw = await readFile(assetPath(projectId, node.raw));
                const frameBytes = width * height * 4;
                const count = Math.max(0, Math.floor(raw.length / frameBytes));
                const keyedPaths = [];
                const keyedBuffers = [];
                for (let i = 0; i < count; i++) {
                    const slice = Buffer.from(raw.subarray(i * frameBytes, (i + 1) * frameBytes));
                    const result = keyGreen(slice, width, height, keyOptions);
                    row.frames.push(result.rgba);
                    keyedBuffers.push(result.rgba);
                    const relative = `keyed/${key}/f${String(i).padStart(2, "0")}.png`;
                    await writeFile(assetPath(projectId, relative), encodePng(result.rgba, width, height));
                    keyedPaths.push(relative);
                }
                if (keyedBuffers.length > 0) {
                    hasFrames = true;
                    // 预览带按最终格子尺寸重采样，所见即所得。
                    const preview = composeSheet([{ ...row }], {
                        cellWidth: settings.cellWidth,
                        cellHeight: settings.cellHeight,
                        frameCount: Math.max(1, keyedBuffers.length),
                        autoCrop: settings.autoCrop,
                        fillRatio: settings.fillRatio,
                        pixelSize: settings.pixelSize,
                        fitMode: settings.fitMode,
                        bottomMargin: settings.bottomMargin
                    });
                    await writeFile(assetPath(projectId, `preview/${key}.png`), encodePng(preview.rgba, preview.width, preview.height));
                    await patchProject(projectId, (current) => {
                        const target = current.frames[key];
                        if (target !== undefined) {
                            target.keyed = keyedPaths;
                            target.strip = `preview/${key}.png`;
                        }
                    });
                    // 第 3 步里「抽帧完成」和「预览带可见」之间隔着这一步，所以抽帧任务的
                    // 覆盖面要留到条带真的写出来才摘：摘早了界面会闪回「尚未抽帧」，
                    // 摘晚了会把已经出好的预览一直盖着。
                    dropJobTarget(projectId, "frames:extract", key);
                }
            }
            rows.push(row);
        }
        if (!hasFrames) {
            if (options.requireFrames === true)
                throw new Error("还没有抽过帧，请先在第 3 步抽取序列帧");
            await patchProject(projectId, (current) => {
                current.sheet = { status: "empty", approved: false };
            });
            return;
        }
        const sheet = composeSheet(rows, {
            cellWidth: settings.cellWidth,
            cellHeight: settings.cellHeight,
            frameCount: settings.frameCount,
            autoCrop: settings.autoCrop,
            fillRatio: settings.fillRatio,
            pixelSize: settings.pixelSize,
            fitMode: settings.fitMode,
            bottomMargin: settings.bottomMargin
        });
        const relative = "out/sheet.png";
        await writeFile(assetPath(projectId, relative), encodePng(sheet.rgba, sheet.width, sheet.height));
        await patchProject(projectId, (current) => {
            current.sheet = {
                status: "ready",
                file: relative,
                approved: false,
                width: sheet.width,
                height: sheet.height,
                generatedAt: Date.now(),
                // 记下这张图**实际**是怎么切的，消费者就不必猜。
                rowOrder: [...order],
                cellWidth: settings.cellWidth,
                cellHeight: settings.cellHeight,
                frameCount: settings.frameCount
            };
            log(current, "info", `整图合成完成：${sheet.width}×${sheet.height}（${sheet.columns} 列 × ${sheet.rows} 行，裁剪框 ${sheet.bbox.width}×${sheet.bbox.height}）`);
        });
    }
    catch (error) {
        const message = messageOf(error);
        await patchProject(projectId, (current) => {
            current.sheet = { ...current.sheet, status: "error", error: message };
            log(current, "error", `整图合成失败：${message}`);
        });
        throw error;
    }
}
export async function clearVideos(projectId, keys) {
    const targets = keys ?? DIRECTION_KEYS;
    await patchProject(projectId, (project) => {
        for (const key of targets) {
            project.videos[key] = { status: "empty", approved: false };
            project.frames[key] = { status: "empty", frames: [], keyed: [], approved: false };
        }
        project.sheet = { status: "empty", approved: false };
    });
}
