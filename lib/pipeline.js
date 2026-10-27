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
 * 阶段 1 有两种生成方式（`Project.imageMode`）：
 *   - `turn`（默认）先让视频模型绕竖轴转一整圈，再按时长匀抽候选帧，
 *     按八个截帧位置切出八张绿幕图——八个方向出自同一段视频，一致性最好；
 *   - `direct` 逐个方向 Seedream 生图（原来那条路，按依赖顺序生成）。
 * 两条路产出的都是同一批 `images/<方向>.png`，所以阶段 2~4 完全不必区分。
 *
 * 所有耗时操作都通过 kick() 丢到后台，远程调用只负责「启动」和「读状态」，
 * 界面靠自己轮询 getState 看进度——一次 Hailuo 生成要几分钟，绝不能同步阻塞。
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { DEFAULT_TURN_PROMPT, DIRECTIONS, DIRECTION_KEYS, TURN_DIRECTION_DEFAULT, TURN_FRAME_COUNT_MAX, TURN_FRAME_COUNT_MIN, directionOf, turnOrder } from "./directions.js";
import { assertImageProviderReady, generateImageWithProvider, imageModelOf, imageSizeOf, imageWatermarkOf } from "./imageprovider.js";
import { extractFrames, mimeOf, sniffVideo, toDataUri, toJpegDataUri } from "./media.js";
import { assertVideoBackendReady, downloadVideoTask, queryVideoTask, submitVideoTask, videoFailureReason, videoBackendOf } from "./videogen.js";
import { composeSheet, keyGreen } from "./chroma.js";
import { applyKeyColorToPrompt } from "./keycolor.js";
import { encodePng } from "./png.js";
import { zipEntries } from "./zip.js";
import { assetPath, freshPicks, log, patchProject, readProject, referenceFiles } from "./store.js";
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
/**
 * 复位后台任务表。
 *
 * 插件被 DSH 重载时，`ctx.effect` 的清理会跑 `disposePipeline()`；只要 Node 的模块缓存
 * 还留着这个模块（同一份 lib 被再次 apply），`disposed` 就会一直停在 true——此后每一次
 * 生成类调用都只得到一句「任务已在进行中」，界面看着像按钮点了没反应，其实一个任务都没建。
 * 所以**每次 apply 都必须复位**，不能只依赖进程重启。
 */
export function activatePipeline() {
    disposed = false;
    jobs.clear();
}
/**
 * `kick` 返回 false 时的理由。
 *
 * 必须区分「真的已经在跑」与「实例已废」：后者只说「任务已在进行中」的话，
 * 用户会一直等一个根本不存在的任务。
 */
const PIPELINE_DISPOSED_REASON = "插件实例已被 DSH 重载（旧实例已卸载），请重启 DSH 后再试";
function kickFailure(detail) {
    return { started: false, reason: disposed ? PIPELINE_DISPOSED_REASON : detail };
}
export function listJobs(projectId) {
    return [...(jobs.get(projectId)?.values() ?? [])];
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
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
    return started ? { started: true } : kickFailure("任务已在进行中");
}
async function generateOne(projectId, key, promptOverride) {
    const direction = directionOf(key);
    if (direction === undefined)
        throw new Error(`未知方向：${key}`);
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const config = await loadConfig();
    // 后端没配好就不要往下走：这一步会真实计费，早失败比「跑到一半报错」好。
    assertImageProviderReady(config);
    const keyColor = project.settings.keyColorOverride === true ? project.settings.keyColor : config.keyColor;
    const basePrompt = applyKeyColorToPrompt((promptOverride ?? project.prompts.images[key] ?? "").trim(), keyColor, "zh");
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
        const result = await generateImageWithProvider({
            prompt,
            images,
            size: imageSizeOf(config),
            watermark: imageWatermarkOf(config)
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
                model: imageModelOf(config),
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
    return started ? { started: true } : kickFailure("批量生成已在进行中");
}
// ── 阶段 1b：转圈截帧（八方向绿幕图的默认生成方式）──────────────────────
//
// 一次生成、多次截取：整圈只有一段视频，八个方向是它时间轴上的八个截帧位置。
// 好处是八个方向天生一致（同一个角色、同一段光线、同一套画风），
// 代价是分辨率取决于视频、以及「转速是否真的均匀」——所以位置必须可拖。
function clampInt(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}
/** 取文件的修改时间；读不到（还没落盘 / 已经被删）时返回 null。 */
async function fileMtimeMs(absolute) {
    try {
        return (await stat(absolute)).mtimeMs;
    }
    catch {
        return null;
    }
}
/**
 * 转圈视频的首帧。
 *
 * 优先用已经有的正面绿幕图，没有就退回源图：源图不一定是绿幕，但提示词里
 * 已经明确要求「纯色绿幕 #00FF00」，模型会照着重画背景。把实际用的那张记进
 * `turn.video.firstFrame`，排查「第一帧就不是正面」时才有据可依。
 *
 * ⚠️ 正面绿幕图如果比源图还旧，说明源图是后来换的（换源图会作废派生产物，
 * 但历史项目、手工替换文件、以及从前留下的旧数据都可能带着这种状态）：
 * 那一张画的是**上一个角色**，用它当首帧就会「新角色配旧脸」——生成的图
 * 看着没问题，只有肉眼看内容才发现。所以这里拿文件时间兜一道，宁可退回
 * 源图（哪怕不是绿幕），也不拿旧角色的脸去生成。
 */
async function turnFirstFrame(projectId, project) {
    const front = project.images["front"]?.file;
    const source = project.source?.file;
    if (front !== undefined) {
        if (source !== undefined) {
            const [frontAt, sourceAt] = await Promise.all([
                fileMtimeMs(assetPath(projectId, front)),
                fileMtimeMs(assetPath(projectId, source))
            ]);
            if (frontAt !== null && sourceAt !== null && sourceAt > frontAt + 1000) {
                return {
                    file: source,
                    label: "源图",
                    note: "正面绿幕图比源图旧（源图是后来换的），这次改用源图当首帧——否则会拿上一个角色的脸去生成。"
                };
            }
        }
        return { file: front, label: "正面绿幕图" };
    }
    if (source !== undefined)
        return { file: source, label: "源图" };
    return undefined;
}
export function startTurnVideo(projectId) {
    if (jobs.get(projectId)?.has("turn:video") === true)
        return { started: false, reason: "转圈视频正在生成中" };
    const started = kick(projectId, "turn:video", "生成转圈视频", () => submitTurnVideo(projectId));
    return started ? { started: true } : kickFailure("任务已在进行中");
}
async function submitTurnVideo(projectId) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const config = await loadConfig();
    assertVideoBackendReady(config);
    const first = await turnFirstFrame(projectId, project);
    if (first === undefined)
        throw new Error("还没有源图，无法生成转圈视频");
    const keyColor = project.settings.keyColorOverride === true ? project.settings.keyColor : config.keyColor;
    const base = applyKeyColorToPrompt((project.prompts.turn ?? DEFAULT_TURN_PROMPT).trim(), keyColor, "zh");
    if (base === "")
        throw new Error("提示词为空，请先填写转圈视频提示词");
    const suffix = (project.prompts.suffix ?? "").trim();
    const prompt = suffix === "" ? base : `${base}\n${suffix}`;
    await patchProject(projectId, (current) => {
        current.turn.video = {
            ...current.turn.video,
            status: "running",
            remoteStatus: "提交中",
            error: undefined,
            firstFrame: first.file
        };
        // 旧视频的候选帧还在，但已经和这次的新视频对不上了：标成「需重抽」，
        // 而不是直接清空——用户还能对着上一版继续调位置，直到新视频落地。
        if (current.turn.frames.frames.length > 0)
            current.turn.frames.stale = true;
        log(current, "info", `开始生成转圈视频（首帧：${first.label}）`);
        if (first.note !== undefined)
            log(current, "warn", first.note);
    });
    const startedAt = Date.now();
    try {
        const jpegRel = "videos/turn-first-frame.jpg";
        const dataUri = await toJpegDataUri(assetPath(projectId, first.file), assetPath(projectId, jpegRel), 1280, 3, videoBackendOf(config) === "toapis" ? "white" : undefined);
        const submitted = await submitVideoTask(config, {
            prompt,
            firstFrameImage: dataUri,
            duration: config.minimaxDuration,
            resolution: config.minimaxResolution,
            promptOptimizer: config.minimaxPromptOptimizer
        });
        await patchProject(projectId, (current) => {
            current.turn.video = {
                ...current.turn.video,
                status: "running",
                taskId: submitted.taskId,
                backend: submitted.backend,
                remoteStatus: "已提交",
                elapsedMs: Date.now() - startedAt,
                updatedAt: Date.now()
            };
            log(current, "info", `转圈视频任务已提交（${submitted.taskId}）`);
            // 自动探测出来的注入点（改了哪个节点的哪个输入）记进日志：
            // 生成结果不对时，第一件要确认的事就是「提示词和首帧到底注进去了没有」。
            for (const note of submitted.notes)
                log(current, "info", note);
        });
        ensurePoller(projectId);
    }
    catch (error) {
        const message = messageOf(error);
        await patchProject(projectId, (current) => {
            current.turn.video = { ...current.turn.video, status: "error", error: message, remoteStatus: "提交失败", updatedAt: Date.now() };
            log(current, "error", `转圈视频提交失败：${message}`);
        });
        throw error;
    }
}
/** 轮询一次转圈视频任务（由 ensurePoller 的定时器驱动）。 */
async function pollTurnVideoOnce(projectId, config) {
    const project = await readProject(projectId);
    if (project === undefined)
        return;
    const node = project.turn?.video;
    const taskId = node?.taskId;
    if (node?.status !== "running" || taskId === undefined)
        return;
    // 后端按节点上记的那个值走，不按当前配置：任务可能是改设置之前提交的。
    const backend = node.backend ?? "minimax";
    try {
        const query = await queryVideoTask(config, backend, taskId);
        if (query.status === "failed") {
            const reason = videoFailureReason(backend, query.error);
            await patchProject(projectId, (current) => {
                current.turn.video = { ...current.turn.video, status: "error", error: reason, remoteStatus: query.remoteStatus, updatedAt: Date.now() };
                log(current, "error", `转圈视频生成失败：${reason}`);
            });
            return;
        }
        if (query.status !== "succeeded") {
            await patchProject(projectId, (current) => {
                current.turn.video = { ...current.turn.video, remoteStatus: query.remoteStatus, updatedAt: Date.now() };
            });
            return;
        }
        const url = query.url;
        if (url === undefined)
            throw new Error("任务已成功，但查询结果里没有视频地址");
        const bytes = await downloadVideoTask(config, backend, url);
        const relative = "videos/turn.mp4";
        await writeFile(assetPath(projectId, relative), bytes);
        await patchProject(projectId, (current) => {
            current.turn.video = {
                ...current.turn.video,
                status: "ready",
                file: relative,
                remoteStatus: query.remoteStatus,
                error: undefined,
                updatedAt: Date.now()
            };
            current.turn.frames.stale = true;
            log(current, "info", `转圈视频已下载（${(bytes.length / 1024 / 1024).toFixed(1)} MB），接着抽取候选帧`);
        });
        // 视频到手就把候选帧抽出来：抽帧是本机 ffmpeg，不花钱，让链路自己往下走
        // 比「再点一次按钮」更省事。用户拖圆圈之前本来也要先有候选帧。
        startTurnFrames(projectId);
    }
    catch (error) {
        // 单次轮询失败不等于任务失败（网络抖动很常见），保留 running 让下一轮重试。
        await patchProject(projectId, (current) => {
            const node = current.turn?.video;
            if (node !== undefined)
                node.remoteStatus = `查询异常：${messageOf(error)}`;
        });
    }
}
export function startTurnFrames(projectId, count) {
    if (jobs.get(projectId)?.has("turn:frames") === true)
        return { started: false, reason: "抽帧已在进行中" };
    const started = kick(projectId, "turn:frames", "抽取转圈候选帧", async () => {
        // 第一个 await 之前公布覆盖面：抽完候选帧才会逐个切出八张方向图，
        // 那段空窗里八个格子全靠这张表盖着（与批量抽帧同一套约定）。
        setJobTargets(projectId, "turn:frames", DIRECTION_KEYS);
        await extractTurnFrames(projectId, count);
    });
    return started ? { started: true } : kickFailure("任务已在进行中");
}
/**
 * 候选帧数变了之后，把用户拖过的位置按比例换算过去。
 *
 * 直接保留下标是不行的：32 帧里的第 17 帧和 64 帧里的第 17 帧朝向完全不同，
 * 相当于把用户调好的八个位置整体打乱。按比例缩放至少保持「相对位置」不变。
 */
function rescalePicks(picks, from, to) {
    const out = {};
    const ratio = from > 0 ? to / from : 1;
    for (const key of DIRECTION_KEYS) {
        out[key] = clampInt((picks[key] ?? 0) * ratio, 0, Math.max(0, to - 1));
    }
    return out;
}
async function extractTurnFrames(projectId, count) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (project.turn?.video?.file === undefined)
        throw new Error("还没有转圈视频，请先生成转圈视频");
    const frameCount = clampInt(count ?? project.settings.turnFrameCount, TURN_FRAME_COUNT_MIN, TURN_FRAME_COUNT_MAX);
    const previous = project.turn.frames;
    await patchProject(projectId, (current) => {
        current.turn.frames = { ...current.turn.frames, status: "running", error: undefined };
        current.settings.turnFrameCount = frameCount;
        log(current, "info", `开始抽取转圈候选帧：${frameCount} 张`);
    });
    try {
        const settings = project.settings;
        const extracted = await extractFrames({
            video: assetPath(projectId, project.turn.video.file),
            frameCount,
            longEdge: settings.workingLongEdge,
            cropInset: settings.cropInset
        });
        const rawRelative = "turn/raw.bin";
        await mkdir(dirname(assetPath(projectId, rawRelative)), { recursive: true });
        await writeFile(assetPath(projectId, rawRelative), Buffer.concat(extracted.frames));
        const files = [];
        const times = [];
        // 候选帧写在 turn/frames/ 下，ensureLayout 只建到 turn/ 这一层，这里补建。
        await mkdir(dirname(assetPath(projectId, "turn/frames/f00.png")), { recursive: true });
        for (let i = 0; i < extracted.frames.length; i++) {
            const relative = `turn/frames/f${String(i).padStart(2, "0")}.png`;
            await writeFile(assetPath(projectId, relative), encodePng(extracted.frames[i], extracted.width, extracted.height));
            files.push(relative);
            // 与 ffmpeg 的 `fps=张数/时长` 一致：第 i 帧取在 i * 时长/张数 秒处。
            times.push((i * extracted.duration) / Math.max(1, extracted.frames.length));
        }
        // 轴上的圆圈是「对着整圈缩略条带」拖的，所以条带必须和候选帧一一对应。
        const strip = composeSheet([{ key: "turn", frames: extracted.frames, width: extracted.width, height: extracted.height }], {
            cellWidth: 96,
            cellHeight: Math.max(24, Math.round((96 * extracted.height) / Math.max(1, extracted.width))),
            frameCount: extracted.frames.length,
            autoCrop: false,
            fillRatio: 1,
            pixelSize: 0,
            fitMode: "stretch",
            bottomMargin: 0
        });
        const stripRelative = "turn/strip.png";
        await writeFile(assetPath(projectId, stripRelative), encodePng(strip.rgba, strip.width, strip.height));
        // 位置怎么来：
        //   · 从来没有抽过候选帧（rawFrameCount 还没有）→ 这八个位置只是占位，
        //     按**这次的**张数重新等分。否则第一次抽 16 张时，那套按 32 张算的
        //     默认位置会有四个方向一起被夹到最后一帧（实测过）。
        //   · 抽过、这次张数变了 → 按比例换算（保留用户拖过的相对位置）。
        //   · 抽过、张数没变 → 原样保留。
        const picks = previous.rawFrameCount !== undefined && previous.rawFrameCount > 0
            ? previous.rawFrameCount !== files.length
                ? rescalePicks(previous.picks, previous.rawFrameCount, files.length)
                : previous.picks
            : freshPicks(files.length, project.turn?.direction ?? TURN_DIRECTION_DEFAULT);
        await patchProject(projectId, (current) => {
            current.turn.frames = {
                status: "ready",
                frames: files,
                times,
                raw: rawRelative,
                rawWidth: extracted.width,
                rawHeight: extracted.height,
                rawFrameCount: files.length,
                duration: extracted.duration,
                picks,
                strip: stripRelative,
                approved: false,
                stale: false,
                updatedAt: Date.now()
            };
            log(current, "info", `候选帧抽取完成：${files.length} 张 / ${extracted.width}×${extracted.height} / 视频时长 ${extracted.duration.toFixed(2)} 秒`);
        });
        await applyTurnPicks(projectId);
    }
    catch (error) {
        const message = messageOf(error);
        await patchProject(projectId, (current) => {
            current.turn.frames = { ...current.turn.frames, status: "error", error: message };
            log(current, "error", `候选帧抽取失败：${message}`);
        });
        throw error;
    }
}
/**
 * 按 `picks` 把八个方向的绿幕图从候选帧里切出来。
 *
 * 这一步是本机 CPU：读 `turn/raw.bin` 的第 N 帧 → 编码成 PNG → 覆盖
 * `images/<方向>.png`。所以拖动圆圈可以随便试，改一个位置不必重新抽帧、
 * 更不必重新生成视频。
 *
 * 换了朝向 = 这个方向的行走视频与它的序列帧都作废（它们拍的是另一个朝向），
 * 整图同样作废——不然后面几步会拿着旧朝向的帧合成。
 */
export async function applyTurnPicks(projectId, keys) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const node = project.turn?.frames;
    if (node?.raw === undefined || node.rawWidth === undefined || node.rawWidth <= 0) {
        throw new Error("还没有候选帧，请先抽取转圈候选帧");
    }
    const width = node.rawWidth;
    const height = node.rawHeight;
    const raw = await readFile(assetPath(projectId, node.raw));
    const frameBytes = width * height * 4;
    const total = Math.max(0, Math.floor(raw.length / frameBytes));
    if (total === 0)
        throw new Error("候选帧缓存是空的，请重新抽取候选帧");
    const targets = (keys ?? DIRECTION_KEYS).filter((key) => directionOf(key) !== undefined);
    for (const key of targets) {
        const index = clampInt(node.picks[key] ?? 0, 0, total - 1);
        const slice = Buffer.from(raw.subarray(index * frameBytes, (index + 1) * frameBytes));
        const relative = `images/${key}.png`;
        await writeFile(assetPath(projectId, relative), encodePng(slice, width, height));
        const label = directionOf(key)?.label ?? key;
        await patchProject(projectId, (current) => {
            current.images[key] = {
                status: "ready",
                file: relative,
                approved: false,
                stale: false,
                model: "转圈截帧",
                updatedAt: Date.now()
            };
            if (current.videos[key]?.file !== undefined || current.videos[key]?.status !== "empty") {
                current.videos[key] = { status: "empty", approved: false };
            }
            if (current.frames[key]?.raw !== undefined || current.frames[key]?.status !== "empty") {
                current.frames[key] = { status: "empty", frames: [], keyed: [], approved: false };
            }
            current.sheet = { status: "empty", approved: false };
            log(current, "info", `截出「${label}」：第 ${index + 1}/${total} 帧（${(node.times[index] ?? 0).toFixed(2)} 秒）`);
        });
        // 这一格的方向图已经写出来了，把它从「抽帧中」的覆盖面里摘掉。
        dropJobTarget(projectId, "turn:frames", key);
    }
}
/** 改一个方向的截帧位置（拖动圆圈松手时调用），只重切那一张。 */
export async function setTurnPick(projectId, key, index) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (directionOf(key) === undefined)
        throw new Error(`未知方向：${key}`);
    const total = project.turn?.frames?.frames?.length ?? 0;
    const next = clampInt(index, 0, Math.max(0, total - 1));
    const currentPick = project.turn?.frames?.picks?.[key];
    const unchanged = currentPick === next && project.images[key]?.file !== undefined;
    await patchProject(projectId, (current) => {
        current.turn.frames.picks = { ...current.turn.frames.picks, [key]: next };
    });
    // 位置没变、图也已经在，就别白重切一遍——更要紧的是**不要**因此把下游作废。
    if (!unchanged)
        await applyTurnPicks(projectId, [key]);
    return { index: next, changed: !unchanged };
}
/** 重新铺一遍八个位置（用一个转圈方向的默认等分位置）。 */
export async function resetTurnPicks(projectId, direction) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const round = direction ?? project.turn?.direction ?? TURN_DIRECTION_DEFAULT;
    const count = project.turn?.frames?.frames?.length || project.settings.turnFrameCount;
    await patchProject(projectId, (current) => {
        current.turn.direction = round;
        current.turn.frames.picks = freshPicks(count, round);
        log(current, "info", `八个截帧位置已重置为${round === "ccw" ? "逆时针" : "顺时针"}的默认等分位置（依次：${turnOrder(round)
            .map((key) => directionOf(key)?.label ?? key)
            .join(" → ")}）`);
    });
    if ((project.turn?.frames?.raw ?? undefined) !== undefined)
        await applyTurnPicks(projectId);
}
/**
 * 一次写多个截帧位置（agent 看完条带后整份写回，与 `setRigLayoutHints` 同一角色）。
 *
 * 只看单张方向图判断不了「是不是转反了」——必须对着整圈条带看。所以这条路的
 * 正确用法是：`read_image` 看 `turn.stripUrl` → 判断八个朝向各落在第几帧 →
 * 一次写回，而不是逐个点方向图去猜。
 */
export async function setTurnPicks(projectId, picks) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const total = project.turn?.frames?.frames?.length ?? 0;
    const next = { ...(project.turn?.frames?.picks ?? {}) };
    const keys = [];
    for (const [key, value] of Object.entries(picks)) {
        if (directionOf(key) === undefined)
            throw new Error(`未知方向：${key}`);
        if (!Number.isFinite(Number(value)))
            throw new Error(`${key} 的截帧位置必须是数字`);
        next[key] = clampInt(Number(value), 0, Math.max(0, total - 1));
        keys.push(key);
    }
    if (keys.length === 0)
        throw new Error("没有要改的方向");
    await patchProject(projectId, (current) => {
        current.turn.frames.picks = next;
    });
    if (total > 0)
        await applyTurnPicks(projectId, keys);
    return { picks: next };
}
/** 切换阶段①的生成方式。只换「怎么产出八张图」，产物一律不动。 */
export async function setImageMode(projectId, mode) {
    await patchProject(projectId, (project) => {
        if (project.imageMode === mode)
            return;
        project.imageMode = mode;
        log(project, "info", mode === "turn" ? "阶段①改用「转圈截帧」" : "阶段①改用「逐方向生图」");
    });
}
// ── 本地自选视频：阶段①（转圈）与阶段②（八段行走）的第三条输入 ────────────
//
// 两处「需要生成视频」的地方都可以直接**自己选一段本地视频**，跳过远程生成：
//   · `turn`       → 一段原地转圈的绿幕视频（导入后自动抽候选帧、切八张方向图）；
//   · 八个方向 key → 某一段行走视频（导入后照旧在第 3 步抽帧）。
//
// 产物与远端生成的**完全同形**（同一个 `videos/` 目录、同一个 VideoNode 形状，
// 只有 `origin: "local"` 这一个字段不同），所以阶段 3、4 一行都不用改。
// 这条链路只在本机跑 ffmpeg，没有任何网络调用，因此上限比「发给模型」宽得多。
/** 本地自选视频的大小上限（只受本机内存与传输体量限制，见 `importLocalVideo`）。 */
export const LOCAL_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** 落盘用的文件名安全化：用户给的名字会直接拼进项目目录。 */
function safeFileStem(input, fallback) {
    const cleaned = (input ?? "")
        .replace(/[^\p{L}\p{N}_-]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
    return cleaned === "" ? fallback : cleaned;
}
/**
 * 把一段本地视频放进 `turn` 或某个方向的槽位。
 *
 * 除了写文件，还要做三件“不写就会静默坏掉”的事：
 *   1. **作废旧产物**：这个槽位原来的视频、它抽出来的帧、以及由那些帧合成的
 *      整图都属于上一段视频。尤其是抽帧缓存 `raw.bin`，留着就会拿旧帧去合成
 *      （界面看着一切正常，只是人物朝向对不上）。
 *   2. **摘掉远端任务号**：如果这一刻正好有一个远端任务在跑，它的结果稍后会
 *      把我们的本地视频**直接覆盖掉**。写 `status: ready` 并清掉 `taskId`，
 *      轮询器下一轮就不会再认领它（单次已经在下载途中的那一轮仍可能落盘，
 *      所以日志里明确写一条）。
 *   3. **转圈模式顺手抽帧**：远端路径也是「视频到手就抽候选帧」，这里保持一致，
 *      否则用户导入完还得自己找「抽取候选帧」按钮，而且不知道时间轴为什么是空的。
 */
export async function importLocalVideo(projectId, key, name, base64) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const isTurn = key === "turn";
    if (!isTurn && directionOf(key) === undefined) {
        throw new Error(`未知方位：${key}（可用 turn 或 ${DIRECTION_KEYS.join(" / ")}）`);
    }
    const clean = base64.replace(/^data:[^;]+;base64,/, "");
    if (clean.trim() === "")
        throw new Error("没有收到视频数据");
    const bytes = Buffer.from(clean, "base64");
    if (bytes.length === 0)
        throw new Error("视频数据为空");
    if (bytes.length > LOCAL_VIDEO_MAX_BYTES) {
        throw new Error(`视频 ${(bytes.length / 1024 / 1024).toFixed(1)}MB 超过上限 ${Math.round(LOCAL_VIDEO_MAX_BYTES / 1024 / 1024)}MB，请先压缩或裁剪`);
    }
    const sniffed = sniffVideo(clean);
    if (sniffed === undefined) {
        throw new Error("无法识别的视频格式（支持 MP4 / MOV / M4V / WebM / MKV / AVI）");
    }
    const originalName = safeFileStem(name.replace(/\.[^.]+$/, ""), `local-${key}`) + "." + sniffed.ext;
    const relative = `videos/${isTurn ? "turn" : key}.${sniffed.ext}`;
    const mb = (bytes.length / 1024 / 1024).toFixed(1);
    await mkdir(dirname(assetPath(projectId, relative)), { recursive: true });
    await writeFile(assetPath(projectId, relative), bytes);
    if (isTurn) {
        await patchProject(projectId, (current) => {
            const droppedTask = current.turn.video?.taskId;
            current.turn.video = {
                status: "ready",
                file: relative,
                approved: false,
                // 远端状态这一栏在界面上同时是「这段视频的来路」，本地导入就照实写。
                remoteStatus: "本地视频",
                origin: "local",
                originalName,
                // 首帧只对「图生视频」有意义，本地视频没有输入图，清掉免得界面指向一张无关的图。
                firstFrame: undefined,
                updatedAt: Date.now()
            };
            if (current.turn.frames.frames.length > 0)
                current.turn.frames.stale = true;
            log(current, "info", `已选用本地视频作为转圈视频：${originalName}（${mb} MB）`);
            if (droppedTask !== undefined) {
                log(current, "warn", `原先的转圈视频远端任务（${droppedTask}）已作废，它的结果不会再被采用`);
            }
        });
        const started = startTurnFrames(projectId);
        return {
            key,
            file: relative,
            name: originalName,
            bytes: bytes.length,
            extractStarted: started.started === true,
            extractReason: started.reason
        };
    }
    const label = directionOf(key)?.label ?? key;
    await patchProject(projectId, (current) => {
        const droppedTask = current.videos[key]?.taskId;
        current.videos[key] = {
            status: "ready",
            file: relative,
            approved: false,
            remoteStatus: "本地视频",
            origin: "local",
            originalName,
            updatedAt: Date.now()
        };
        // 旧帧与整图都属于上一段视频：不清掉就会拿另一段视频的帧继续往下走。
        current.frames[key] = { status: "empty", frames: [], keyed: [], approved: false };
        current.sheet = { status: "empty", approved: false };
        log(current, "info", `已选用本地视频作为「${label}」的行走视频：${originalName}（${mb} MB），需要到第 3 步重新抽帧`);
        if (droppedTask !== undefined) {
            log(current, "warn", `「${label}」原先的远端任务（${droppedTask}）已作废，它的结果不会再被采用`);
        }
    });
    return { key, file: relative, name: originalName, bytes: bytes.length };
}
/**
 * 这个项目里所有**中间图片**的相对路径。
 *
 * 「中间」= 一路生成下来留下的每一张图：八方向绿幕图、转圈候选帧与整圈条带、
 * 每段视频抽出来的绿幕帧与它的手动选帧候选、抠完绿幕的帧、以及最后合成的整图。
 * 源图（用户自己的输入）不算，它不是这条路产出的东西。
 *
 * 顺序刻意按阶段走（① → ② → ③ → ④），解压出来的人眼一翻就能对上流程。
 */
export function intermediateImagePaths(project) {
    const out = [];
    const push = (value) => {
        if (typeof value === "string" && value !== "")
            out.push(value);
    };
    for (const key of DIRECTION_KEYS) {
        push(project.images[key]?.file);
        const node = project.frames[key];
        for (const file of node?.frames ?? [])
            push(file);
        for (const file of node?.keyed ?? [])
            push(file);
        for (const file of node?.candidates?.frames ?? [])
            push(file);
        push(node?.strip);
        push(node?.candidates?.strip);
    }
    push(project.turn?.frames?.strip);
    for (const file of project.turn?.frames?.frames ?? [])
        push(file);
    push(project.sheet?.file);
    push(project.sheet?.thumb);
    return [...new Set(out)];
}
/**
 * 把所有中间图片打成一个 zip，落在 `out/` 下（静态资源路由可直接下载）。
 *
 * 为什么是 zip 而不是几十个下载链接：转圈模式的候选帧一抽就是 32~64 张，
 * 一张一个按钮既点不完也看不清。包里保留**项目内的相对路径**
 * （`images/front.png`、`turn/frames/f00.png`、`frames/front/f00.png`…），
 * 这样解压出来还能和项目目录对上号。
 */
export async function exportImages(projectId) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const wanted = intermediateImagePaths(project);
    if (wanted.length === 0) {
        throw new Error("还没有任何图片可保存：先在阶段①出绿幕图，或在阶段③抽取序列帧");
    }
    const entries = [];
    let bytes = 0;
    let skipped = 0;
    for (const relative of wanted) {
        try {
            const data = await readFile(assetPath(projectId, relative));
            entries.push({ path: relative, data });
            bytes += data.length;
        }
        catch {
            // 单张读不到不该让整包失败（可能是手删过的旧记录）：跳过并如实报数。
            skipped++;
        }
    }
    if (entries.length === 0)
        throw new Error("这些图片文件都不在了，请重新生成或重新抽帧");
    const zip = zipEntries(entries);
    const relative = `out/${safeFileStem(project.name, project.id)}-images.zip`;
    await mkdir(dirname(assetPath(projectId, relative)), { recursive: true });
    await writeFile(assetPath(projectId, relative), zip);
    await patchProject(projectId, (current) => {
        log(current, "info", `已打包 ${entries.length} 张图片（${(zip.length / 1024 / 1024).toFixed(1)} MB）${skipped > 0 ? `，${skipped} 张读不到已跳过` : ""}`);
    });
    return { file: relative, count: entries.length, skipped, bytes };
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
        assertVideoBackendReady(config);
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
                const dataUri = await toJpegDataUri(assetPath(projectId, image.file), assetPath(projectId, jpegRel), 1280, 3, videoBackendOf(config) === "toapis" ? "white" : undefined);
                const keyColor = fresh.settings.keyColorOverride === true ? fresh.settings.keyColor : config.keyColor;
                const prompt = applyKeyColorToPrompt((fresh.prompts.videoPerDirection?.[key] ?? fresh.prompts.video).trim(), keyColor, "zh");
                const submitted = await submitVideoTask(config, {
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
                        taskId: submitted.taskId,
                        backend: submitted.backend,
                        remoteStatus: "已提交",
                        updatedAt: Date.now()
                    };
                    log(current, "info", `「${label}」视频任务已提交（${submitted.taskId}）`);
                    for (const note of submitted.notes)
                        log(current, "info", `「${label}」${note}`);
                });
                // Start tracking accepted jobs immediately, even if another batch member fails locally.
                ensurePoller(projectId);
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
    return started ? { started: true } : kickFailure("视频任务提交已在进行中");
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
    // 转圈视频走同一个轮询器：它和八段行走视频是同一类任务（同一个模型、同一套
    // query/download），单独再起一个定时器只多一份「谁负责停」的账。
    const turnPending = project.turn?.video?.status === "running" && typeof project.turn?.video?.taskId === "string";
    if (pending.length === 0 && !turnPending) {
        stopPoller(projectId);
        return;
    }
    await Promise.all(pending.map(async (key) => {
        const label = directionOf(key)?.label ?? key;
        const taskId = project.videos[key].taskId;
        const backend = project.videos[key].backend ?? "minimax";
        try {
            const query = await queryVideoTask(config, backend, taskId);
            if (query.status === "failed") {
                const reason = videoFailureReason(backend, query.error);
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
            const url = query.url;
            if (url === undefined)
                throw new Error("任务已成功，但查询结果里没有视频地址");
            const bytes = await downloadVideoTask(config, backend, url);
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
    if (turnPending) {
        await pollTurnVideoOnce(projectId, config).catch(() => undefined);
    }
    const after = await readProject(projectId);
    if (after !== undefined &&
        !DIRECTION_KEYS.some((key) => after.videos[key]?.status === "running") &&
        after.turn?.video?.status !== "running") {
        stopPoller(projectId);
    }
}
// ── 阶段 3：抽帧 ─────────────────────────────────────────────────────────
/** 手动选帧的候选帧张数。和转圈轴用同一档范围：太少拖不动，太多抽帧变慢。 */
const WALK_CANDIDATE_DEFAULT = 32;
/**
 * 把 `outputCount` 个输出帧均匀铺到 `candidateCount` 张候选帧上。
 * 下标用「格心」（第 i 等份的中点），和转圈轴上圆圈的算法一致。
 */
function evenSlotPicks(outputCount, candidateCount) {
    const total = Math.max(1, candidateCount);
    const count = Math.max(1, outputCount);
    const picks = [];
    for (let i = 0; i < count; i++) {
        picks.push(Math.min(total - 1, Math.max(0, Math.round(((i + 0.5) * total) / count - 0.5))));
    }
    return picks;
}
/** 候选帧张数变了之后，按比例换算已经拖过的圆圈，避免下标对不上新条带。 */
function rescaleSlotPicks(picks, from, to) {
    const ratio = from > 0 ? to / from : 1;
    return picks.map((index) => clampInt(index * ratio, 0, Math.max(0, to - 1)));
}
/**
 * 按候选帧缓存，把这个方向的序列帧切出来（绿幕 PNG + raw.bin），再走一遍抠像合成。
 * 拖动圆圈只改下标，不必重新解码视频。
 */
async function applyWalkPicks(projectId, key) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const candidates = project.frames[key]?.candidates;
    if (candidates?.raw === undefined || (candidates.rawWidth ?? 0) <= 0 || (candidates.rawHeight ?? 0) <= 0) {
        throw new Error("还没有候选帧，请先手动抽取");
    }
    const width = candidates.rawWidth;
    const height = candidates.rawHeight ?? 0;
    const raw = await readFile(assetPath(projectId, candidates.raw));
    const frameBytes = width * height * 4;
    const total = Math.max(0, Math.floor(raw.length / frameBytes));
    if (total === 0)
        throw new Error("候选帧缓存是空的，请重新抽取");
    const outputCount = Math.max(1, project.settings.frameCount);
    const picks = candidates.picks.length === outputCount
        ? candidates.picks.map((index) => clampInt(index, 0, total - 1))
        : evenSlotPicks(outputCount, total);
    const slices = [];
    const framePaths = [];
    for (let slot = 0; slot < picks.length; slot++) {
        const index = picks[slot];
        slices.push(Buffer.from(raw.subarray(index * frameBytes, (index + 1) * frameBytes)));
        framePaths.push(`frames/${key}/f${String(slot).padStart(2, "0")}.png`);
    }
    const rawRelative = `frames/${key}/raw.bin`;
    await mkdir(dirname(assetPath(projectId, rawRelative)), { recursive: true });
    await writeFile(assetPath(projectId, rawRelative), Buffer.concat(slices));
    for (let slot = 0; slot < slices.length; slot++) {
        await writeFile(assetPath(projectId, framePaths[slot]), encodePng(slices[slot], width, height));
    }
    await patchProject(projectId, (current) => {
        const node = current.frames[key];
        current.frames[key] = {
            ...node,
            status: "ready",
            frames: framePaths,
            keyed: [],
            approved: false,
            stale: false,
            error: undefined,
            raw: rawRelative,
            rawWidth: width,
            rawHeight: height,
            rawFrameCount: picks.length,
            duration: candidates.duration,
            updatedAt: Date.now(),
            candidates: node.candidates === undefined ? undefined : { ...node.candidates, picks, status: "ready", stale: false, error: undefined }
        };
        const label = directionOf(key)?.label ?? key;
        log(current, "info", `「${label}」按手动选帧切出 ${picks.length} 帧`);
    });
    await renderSheet(projectId);
}
/**
 * 从一个方向的行走视频里抽出候选帧，并按当前圆圈（没有就等分）切成序列帧。
 * 只动这一个方向；其它方向的帧保持原样。
 */
export async function startFramePick(projectId, key, count) {
    if (directionOf(key) === undefined)
        throw new Error(`未知方向：${key}`);
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (project.videos[key]?.file === undefined)
        throw new Error("还没有可抽帧的视频，请先在第 2 步生成视频");
    const requested = clampInt(count ?? project.frames[key]?.candidates?.rawFrameCount ?? WALK_CANDIDATE_DEFAULT, TURN_FRAME_COUNT_MIN, TURN_FRAME_COUNT_MAX);
    const label = directionOf(key)?.label ?? key;
    const taskKey = `frames:pick:${key}`;
    const started = kick(projectId, taskKey, `手动选帧·${label}`, async () => {
        setJobTargets(projectId, taskKey, [key]);
        const fresh = await readProject(projectId);
        if (fresh === undefined)
            throw new Error(`项目不存在：${projectId}`);
        const video = fresh.videos[key];
        if (video?.file === undefined)
            throw new Error("还没有可抽帧的视频，请先在第 2 步生成视频");
        const previous = fresh.frames[key]?.candidates;
        await patchProject(projectId, (current) => {
            const node = current.frames[key];
            current.frames[key] = {
                ...node,
                status: "running",
                error: undefined,
                candidates: {
                    status: "running",
                    frames: previous?.frames ?? [],
                    times: previous?.times ?? [],
                    picks: previous?.picks ?? [],
                    raw: previous?.raw,
                    rawWidth: previous?.rawWidth,
                    rawHeight: previous?.rawHeight,
                    rawFrameCount: previous?.rawFrameCount,
                    duration: previous?.duration,
                    strip: previous?.strip,
                    error: undefined
                }
            };
            log(current, "info", `开始抽取「${label}」的候选帧：${requested} 张`);
        });
        try {
            const extracted = await extractFrames({
                video: assetPath(projectId, video.file),
                frameCount: requested,
                longEdge: fresh.settings.workingLongEdge,
                cropInset: fresh.settings.cropInset
            });
            const total = extracted.frames.length;
            const outputCount = Math.max(1, fresh.settings.frameCount);
            const picks = previous?.picks !== undefined && previous.picks.length === outputCount && (previous.rawFrameCount ?? 0) > 0
                ? previous.rawFrameCount === total
                    ? previous.picks.map((index) => clampInt(index, 0, total - 1))
                    : rescaleSlotPicks(previous.picks, previous.rawFrameCount ?? total, total)
                : evenSlotPicks(outputCount, total);
            const rawRelative = `frames/${key}/candidates/raw.bin`;
            await mkdir(dirname(assetPath(projectId, rawRelative)), { recursive: true });
            await writeFile(assetPath(projectId, rawRelative), Buffer.concat(extracted.frames));
            const files = [];
            const times = [];
            for (let i = 0; i < extracted.frames.length; i++) {
                const relative = `frames/${key}/candidates/f${String(i).padStart(2, "0")}.png`;
                await writeFile(assetPath(projectId, relative), encodePng(extracted.frames[i], extracted.width, extracted.height));
                files.push(relative);
                times.push((i * extracted.duration) / Math.max(1, extracted.frames.length));
            }
            const strip = composeSheet([{ key, frames: extracted.frames, width: extracted.width, height: extracted.height }], {
                cellWidth: 96,
                cellHeight: Math.max(24, Math.round((96 * extracted.height) / Math.max(1, extracted.width))),
                frameCount: extracted.frames.length,
                autoCrop: false,
                fillRatio: 1,
                pixelSize: 0,
                fitMode: "stretch",
                bottomMargin: 0
            });
            const stripRelative = `frames/${key}/candidates/strip.png`;
            await writeFile(assetPath(projectId, stripRelative), encodePng(strip.rgba, strip.width, strip.height));
            await patchProject(projectId, (current) => {
                const node = current.frames[key];
                current.frames[key] = {
                    ...node,
                    candidates: {
                        status: "ready",
                        frames: files,
                        times,
                        raw: rawRelative,
                        rawWidth: extracted.width,
                        rawHeight: extracted.height,
                        rawFrameCount: files.length,
                        duration: extracted.duration,
                        strip: stripRelative,
                        picks,
                        stale: false,
                        updatedAt: Date.now()
                    }
                };
                log(current, "info", `「${label}」候选帧抽取完成：${files.length} 张 / 视频 ${extracted.duration.toFixed(2)} 秒`);
            });
            await applyWalkPicks(projectId, key);
        }
        catch (error) {
            const message = messageOf(error);
            await patchProject(projectId, (current) => {
                const node = current.frames[key];
                current.frames[key] = {
                    ...node,
                    status: node.raw === undefined ? "error" : node.status,
                    error: message,
                    candidates: node.candidates === undefined ? undefined : { ...node.candidates, status: "error", error: message }
                };
                log(current, "error", `「${label}」手动选帧失败：${message}`);
            });
            throw error;
        }
        finally {
            dropJobTarget(projectId, taskKey, key);
        }
    });
    return started ? { started: true } : kickFailure("这个方向正在手动选帧");
}
/** 改这个方向某一个输出帧落在哪张候选帧上（圆圈松手时调用）。 */
export async function setFramePick(projectId, key, slot, index) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (directionOf(key) === undefined)
        throw new Error(`未知方向：${key}`);
    const candidates = project.frames[key]?.candidates;
    const total = candidates?.frames?.length ?? 0;
    if (total === 0 || candidates?.raw === undefined)
        throw new Error("还没有候选帧，请先手动抽取");
    const outputCount = Math.max(1, project.settings.frameCount);
    const picks = candidates.picks.length === outputCount
        ? candidates.picks.map((value) => clampInt(value, 0, total - 1))
        : evenSlotPicks(outputCount, total);
    const nextSlot = clampInt(slot, 0, outputCount - 1);
    const nextIndex = clampInt(index, 0, total - 1);
    const unchanged = candidates.picks.length === outputCount &&
        candidates.picks[nextSlot] === nextIndex &&
        project.frames[key]?.status === "ready";
    picks[nextSlot] = nextIndex;
    await patchProject(projectId, (current) => {
        const node = current.frames[key];
        if (node.candidates !== undefined)
            node.candidates = { ...node.candidates, picks: [...picks] };
    });
    if (!unchanged)
        await applyWalkPicks(projectId, key);
    return { slot: nextSlot, index: nextIndex, changed: !unchanged, picks };
}
/** 一次写回这个方向的全部圆圈。长度必须等于「每段视频抽帧数」，整图才是整齐的格子。 */
export async function setFramePicks(projectId, key, picks) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (directionOf(key) === undefined)
        throw new Error(`未知方向：${key}`);
    const total = project.frames[key]?.candidates?.frames?.length ?? 0;
    if (total === 0)
        throw new Error("还没有候选帧，请先手动抽取");
    const outputCount = Math.max(1, project.settings.frameCount);
    if (picks.length !== outputCount) {
        throw new Error(`这一方向要选 ${outputCount} 帧（与「每段视频抽帧数」一致），收到 ${picks.length} 个位置`);
    }
    const next = picks.map((value) => {
        if (!Number.isFinite(Number(value)))
            throw new Error("截帧位置必须是数字");
        return clampInt(Number(value), 0, total - 1);
    });
    await patchProject(projectId, (current) => {
        const node = current.frames[key];
        if (node.candidates !== undefined)
            node.candidates = { ...node.candidates, picks: next };
    });
    await applyWalkPicks(projectId, key);
    return { picks: next };
}
/** 把这个方向的圆圈放回等分位置，并按新位置重切序列帧。 */
export async function resetFramePicks(projectId, key) {
    const project = await readProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (directionOf(key) === undefined)
        throw new Error(`未知方向：${key}`);
    const total = project.frames[key]?.candidates?.frames?.length ?? 0;
    if (total === 0)
        throw new Error("还没有候选帧，请先手动抽取");
    const picks = evenSlotPicks(Math.max(1, project.settings.frameCount), total);
    await patchProject(projectId, (current) => {
        const node = current.frames[key];
        if (node.candidates !== undefined)
            node.candidates = { ...node.candidates, picks };
        const label = directionOf(key)?.label ?? key;
        log(current, "info", `「${label}」的选帧圆圈已回到等分位置`);
    });
    await applyWalkPicks(projectId, key);
    return { picks };
}
/**
 * 抽取序列帧。`keys` 是要抽的方向；省略则按「有视频的方向」全抽。
 * 调用方（`runFrames`）已经把没有视频的方向滤掉了，这里再滤一次兜底。
 *
 * 这条路按时长等分，会清掉该方向上一次的手动选帧。要逐帧挑位置，走 `startFramePick`。
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
    return started ? { started: true } : kickFailure("抽帧任务已在进行中");
}
// ── 阶段 4：抠像 + 合成整图 ──────────────────────────────────────────────
/** 只按当前参数重跑抠像与合成（不重新解码视频）。 */
export function startRekey(projectId) {
    const started = kick(projectId, "sheet:key", "重新抠像", async () => {
        await renderSheet(projectId, { requireFrames: true });
    });
    return started ? { started: true } : kickFailure("抠像任务已在进行中");
}
export function startCompose(projectId) {
    const started = kick(projectId, "sheet:compose", "合成整图", async () => {
        await renderSheet(projectId, { requireFrames: true });
    });
    return started ? { started: true } : kickFailure("合成任务已在进行中");
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
    const config = await loadConfig();
    const keyColor = settings.keyColorOverride === true ? settings.keyColor : config.keyColor;
    await patchProject(projectId, (current) => {
        current.sheet = { ...current.sheet, status: "running", error: undefined };
    });
    try {
        const keyOptions = {
            keyColor,
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
        // 抠像诊断：背景占比能看出「是不是没抠干净」，被排除的边框采样点能看出
        // 「角色是不是贴到了画面边缘」（贴边时那一小撮角色色会被挡在调色板之外）。
        let backgroundSum = 0;
        let keyedSamples = 0;
        let borderSamples = 0;
        let borderSamplesDropped = 0;
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
                    backgroundSum += result.backgroundFraction;
                    keyedSamples++;
                    borderSamples += result.borderSamples;
                    borderSamplesDropped += result.borderSamplesDropped;
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
            const backgroundFraction = keyedSamples > 0 ? backgroundSum / keyedSamples : undefined;
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
                frameCount: settings.frameCount,
                backgroundFraction,
                borderSamples,
                borderSamplesDropped
            };
            const droppedNote = borderSamplesDropped > 0
                ? `；边框采样 ${borderSamples} 个里排除了 ${borderSamplesDropped} 个不属于背景主色的点（通常是角色贴到了画面边缘，已自动排除）`
                : "";
            log(current, "info", `整图合成完成：${sheet.width}×${sheet.height}（${sheet.columns} 列 × ${sheet.rows} 行，裁剪框 ${sheet.bbox.width}×${sheet.bbox.height}，背景占比 ${backgroundFraction === undefined ? "?" : (backgroundFraction * 100).toFixed(1)}%${droppedNote}）`);
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
