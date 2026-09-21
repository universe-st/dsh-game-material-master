/**
* dsh-8dir-sprites —— 宿主半区。
*
* 一个 Typert 远程服务（"spriteStudio"）承担整条流水线的控制面：
* 配置读写、项目 CRUD、生图 / 视频 / 抽帧 / 合成四个阶段的启动与状态查询、
* 以及每一步的验收打标。
*
* 另外用 `ctx.webServer` 注册一条 prefix 路由，把项目目录里的图片和视频
* 直接发给浏览器——否则界面每帧都要靠 RPC 传 base64，又慢又费内存。
*/
import { createReadStream, statSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { ARK_MODEL_PRESETS, DEFAULT_CONFIG, ROW_ORDER_VERSION, MINIMAX_HOST_PRESETS, MINIMAX_MODEL_PRESETS, loadConfig, maskConfig, migrateLegacyDataRoot, projectsRoot, saveConfig } from "./config.js";
import { DEFAULT_ROW_ORDER, DEFAULT_VIDEO_PROMPT, DIRECTION_KEYS, defaultImagePrompts, directionOf } from "./directions.js";
import { checkFfmpeg } from "./media.js";
import { testArk } from "./ark.js";
import { COMP_SHARE_BASE_URL, COMP_SHARE_MODEL_ID, capabilityOf, isCompshareModel, normalizeDuration, normalizeResolution, pathPrefixOf, testMiniMax } from "./minimax.js";
import { disposePipeline, ensurePoller, listJobs, pollVideosOnce, startAllImages, startCompose, startExtract, startImage, startRekey, startVideos, clearVideos } from "./pipeline.js";
import { assetPath, createProject, deleteProject, listProjects, log, patchProject, projectDir, projectExists, readProject, } from "./store.js";
import * as imagegen from "./imagegen.js";
import * as seqgen from "./seqgen.js";
import * as riggen from "./riggen.js";
import { MANIFEST, METHODS, SERVICE_NAME } from "./wire.js";
import { rememberClientOrigin } from "./links.js";
import { registerStudioTools } from "./tools.js";
/**
 * 游戏素材大师 —— 宿主半区。
 *
 * 一个 Typert 远程服务（"gameStudio"）承载三个功能模块的控制面：
 *   ① 八方向图生成  ② 图片生成  ③ 序列帧生成
 * 三者共用同一套配置（API Key / 模型 / 抠像默认值），但各自独立存项目。
 *
 * 另外用 `ctx.webServer` 注册一条 prefix 路由，把三个模块的产物直接发给浏览器。
 */
export const name = "dsh-game-material-master";
/**
* `webServer` 必须声明成硬依赖：它要等真正 listen 成功之后才可用，
* 而本插件的 `apply` 与它几乎同时发生——只用 `ctx.get()` 探测的话，
* 大概率拿到 undefined，路由就永远不会注册（表现是资源请求一路 404）。
* 声明 inject 后 cordis 会把本插件挂起，直到 webServer 就绪再 apply。
*/
export const inject = ["typert", "webServer"];
const ROUTE_PREFIX = "/dsh-game-material-master";
/**
 * 本模块**被 import 时**捕获的自身信息，用于 `/_health`。
 *
 * 关键在「被 import 时」：宿主半区是进程启动时冻结的模块图，改了 `lib/*.js` 之后
 * 如果没有真正重新 import，这里的 `mtime` 就还是旧的。于是 `GET
 * /dsh-game-material-master/_health` 变成一条**廉价且确定**的探针——
 * 用来回答「运行中的宿主到底吃到了哪一版代码」，而不用去猜。
 * （Playwright 端到端测试与 `scripts/verify-live-bundle.mjs` 都依赖它。）
 */
const BOOT_INFO = (() => {
    const info = { bootedAt: Date.now() };
    try {
        const self = fileURLToPath(import.meta.url);
        info.module = basename(self);
        info.mtimeMs = statSync(self).mtimeMs;
        void dirname(self);
    }
    catch {
        /* 取不到就只报 bootedAt，探针退化成「进程内不变」仍可用 */
    }
    return info;
})();
/**
* 改动这些设置会让已经生成的整图失效，必须重新合成。
* `workingLongEdge` / `cropInset` 不在其中——它们属于抽帧参数，另走 stale 标记。
*/
const COMPOSE_SETTINGS = [
    "cellWidth",
    "cellHeight",
    "frameCount",
    "pixelSize",
    "autoCrop",
    "fillRatio",
    "bottomMargin",
    "fitMode",
    "rowOrder",
    "keyLow",
    "keyHigh",
    "despill",
    "bgTolerance",
    "edgeShrink"
];
const PROJECT_ID_PATTERN = /^p[a-z0-9]{4,40}$/;
const MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".json": "application/json; charset=utf-8",
    // 骨骼动画的自包含预览是一整个 HTML 文件，必须用 text/html 才能被 iframe 渲染。
    ".html": "text/html; charset=utf-8",
    ".atlas": "text/plain; charset=utf-8"
};
function asString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function asRecord(value) {
    return value !== null && typeof value === "object" ? value : {};
}
function clampInt(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
function clampFloat(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
/** 从 base64 头部嗅探图片类型，避免用户上传一个改了后缀的任意文件。 */
function sniffImage(base64) {
    let head;
    try {
        head = Buffer.from(base64.slice(0, 64), "base64");
    }
    catch {
        return undefined;
    }
    if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
        return { ext: "png", mime: "image/png" };
    }
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
        return { ext: "jpg", mime: "image/jpeg" };
    }
    if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
        return { ext: "webp", mime: "image/webp" };
    }
    if (head.length >= 6 && head.toString("ascii", 0, 3) === "GIF") {
        return { ext: "gif", mime: "image/gif" };
    }
    if (head.length >= 2 && head.toString("ascii", 0, 2) === "BM") {
        return { ext: "bmp", mime: "image/bmp" };
    }
    return undefined;
}
function safeFileName(input) {
    const base = basename(input).replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_");
    return base === "" ? "source" : base.slice(0, 120);
}
export class GameStudioGateway extends TypertRemoteService {
    ffmpegCache;
    constructor(ctx) {
        super(ctx, SERVICE_NAME);
    }
    // ── 配置 ────────────────────────────────────────────────────────────────
    async configView() {
        const config = await loadConfig();
        return this.decorateConfig(config);
    }
    async decorateConfig(config) {
        if (this.ffmpegCache === undefined)
            this.ffmpegCache = await checkFfmpeg();
        return {
            ...maskConfig(config),
            rowOrder: [...config.rowOrder],
            defaults: { ...DEFAULT_CONFIG },
            arkModels: ARK_MODEL_PRESETS,
            minimaxModels: MINIMAX_MODEL_PRESETS,
            minimaxHosts: MINIMAX_HOST_PRESETS,
            // 「优云智算版 H3」由用户在模型下拉里显式选择，选中后网关地址/路径/档位全部跟着它走。
            minimaxCompshareModelId: COMP_SHARE_MODEL_ID,
            minimaxCompshareBaseUrl: COMP_SHARE_BASE_URL,
            // 选中优云智算版时，界面显示的 Base URL 就是插件真正会用的那个地址。
            minimaxBaseUrl: isCompshareModel(config.minimaxModel) ? COMP_SHARE_BASE_URL : config.minimaxBaseUrl,
            // 优云智算网关的请求路径多一层 /minimax，界面据此展示真实端点。
            minimaxPathPrefix: pathPrefixOf(config.minimaxModel),
            // 分辨率档位与时长区间都跟着模型走，界面据此渲染控件；优云智算版更宽。
            minimaxCapabilities: capabilityOf(config.minimaxModel),
            minimaxCapabilitiesByModel: Object.fromEntries(MINIMAX_MODEL_PRESETS.map((preset) => [preset.id, capabilityOf(preset.id)])),
            directions: DIRECTION_KEYS.map((key) => {
                const direction = directionOf(key);
                return { key, label: direction?.label ?? key, refs: direction?.refs ?? [] };
            }),
            ffmpeg: this.ffmpegCache,
            dataRoot: projectsRoot()
        };
    }
    async getConfig() {
        return this.configView();
    }
    /**
    * 保存配置。
    * 约定：`arkApiKey` / `minimaxApiKey` **只有用户确实改了才带**——不带就是保持原值，
    * 带空串才是清除。这样界面就不必把明文 key 回填到输入框里。
    */
    async saveConfig(payload) {
        const input = asRecord(payload);
        const patch = {};
        const directKeys = [
            "arkBaseUrl",
            "arkModel",
            "arkSize",
            "arkWatermark",
            "arkTimeoutMs",
            "minimaxBaseUrl",
            "minimaxModel",
            "minimaxDuration",
            "minimaxResolution",
            "minimaxPromptOptimizer",
            "minimaxTimeoutMs",
            "cellWidth",
            "cellHeight",
            "frameCount",
            "fitMode",
            "workingLongEdge",
            "pixelSize",
            "autoCrop",
            "fillRatio",
            "bottomMargin",
            "cropInset",
            "keyLow",
            "keyHigh",
            "despill",
            "bgTolerance",
            "edgeShrink",
            "rowOrder",
            "concurrency"
        ];
        for (const key of directKeys) {
            if (input[key] !== undefined)
                patch[key] = input[key];
        }
        if (typeof input.arkApiKey === "string")
            patch.arkApiKey = input.arkApiKey.trim();
        if (typeof input.minimaxApiKey === "string")
            patch.minimaxApiKey = input.minimaxApiKey.trim();
        if (input.clearArkApiKey === true)
            patch.arkApiKey = "";
        if (input.clearMinimaxApiKey === true)
            patch.minimaxApiKey = "";
        const saved = await saveConfig(patch);
        this.ffmpegCache = undefined;
        return this.decorateConfig(saved);
    }
    async testArk() {
        const config = await loadConfig();
        if (config.arkApiKey.trim() === "")
            throw new Error("尚未配置火山方舟 API Key");
        return testArk({
            baseUrl: config.arkBaseUrl,
            apiKey: config.arkApiKey,
            model: config.arkModel,
            timeoutMs: config.arkTimeoutMs
        });
    }
    async testMinimax() {
        const config = await loadConfig();
        return testMiniMax({
            baseUrl: config.minimaxBaseUrl,
            apiKey: config.minimaxApiKey,
            model: config.minimaxModel,
            timeoutMs: config.minimaxTimeoutMs
        });
    }
    /**
     * 浏览器半区上报自己的 `location.origin`。
     *
     * 宿主不知道对外 origin（可能被反代改写），而模型要在回复里贴可点链接，
     * 只能由页面自己报一次。返回体里回带上「认没认」，方便界面自检。
     */
    async reportClientOrigin(payload) {
        const origin = asString(asRecord(payload).origin);
        const accepted = rememberClientOrigin(origin);
        return accepted ? { ok: true, origin } : { ok: false, message: `拒绝非 http(s) origin：${origin}` };
    }
    // ── 项目 ────────────────────────────────────────────────────────────────
    async listProjects() {
        return { projects: await listProjects() };
    }
    async createProject(payload) {
        const project = await createProject(asString(asRecord(payload).name, ""));
        return { projectId: project.id };
    }
    async getProject(payload) {
        const projectId = asString(asRecord(payload).projectId);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        return {
            ...project,
            jobs: listJobs(projectId),
            assetBase: `${ROUTE_PREFIX}/assets/${projectId}/`
        };
    }
    async deleteProject(payload) {
        const projectId = asString(asRecord(payload).projectId);
        await deleteProject(projectId);
        return { ok: true };
    }
    async renameProject(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const nextName = asString(input.name).trim();
        if (nextName === "")
            throw new Error("项目名不能为空");
        await patchProject(projectId, (project) => {
            project.name = nextName.slice(0, 80);
        });
        return { ok: true };
    }
    async uploadSource(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        if (!(await projectExists(projectId)))
            throw new Error(`项目不存在：${projectId}`);
        const base64 = asString(input.data).replace(/^data:[^;]+;base64,/, "");
        if (base64 === "")
            throw new Error("没有收到图片数据");
        const bytes = Buffer.from(base64, "base64");
        if (bytes.length === 0)
            throw new Error("图片数据为空");
        if (bytes.length > 30 * 1024 * 1024)
            throw new Error("源图超过 30 MB，请先压缩后再上传");
        const sniffed = sniffImage(base64);
        if (sniffed === undefined)
            throw new Error("无法识别的图片格式（支持 PNG / JPEG / WebP / GIF / BMP）");
        const originalName = safeFileName(asString(input.name, `source.${sniffed.ext}`));
        const stem = originalName.replace(/\.[^.]+$/, "") || "source";
        const relative = `source/${stem}.${sniffed.ext}`;
        await mkdir(join(projectDir(projectId), "source"), { recursive: true });
        await writeFile(assetPath(projectId, relative), bytes);
        await patchProject(projectId, (project) => {
            project.source = { file: relative, name: originalName };
            log(project, "info", `已上传源图：${originalName}（${(bytes.length / 1024).toFixed(0)} KB）`);
        });
        return { ok: true, file: relative, name: originalName };
    }
    async savePrompts(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const images = input.images === undefined ? undefined : asRecord(input.images);
        const video = typeof input.video === "string" ? input.video : undefined;
        const perDirection = input.videoPerDirection === undefined ? undefined : asRecord(input.videoPerDirection);
        const resetImages = input.resetImagesToDefault === true;
        const resetVideo = input.resetVideoToDefault === true;
        await patchProject(projectId, (project) => {
            // 提示词模板升级后（例如这次把方位语义改对），老项目要能一键重新套用默认值。
            if (resetImages)
                project.prompts.images = defaultImagePrompts();
            if (resetVideo) {
                project.prompts.video = DEFAULT_VIDEO_PROMPT;
                project.prompts.videoPerDirection = {};
            }
            if (images !== undefined) {
                for (const key of DIRECTION_KEYS) {
                    if (typeof images[key] === "string" && images[key].trim() !== "") {
                        project.prompts.images[key] = images[key];
                    }
                }
            }
            if (video !== undefined && video.trim() !== "")
                project.prompts.video = video;
            if (perDirection !== undefined) {
                for (const key of DIRECTION_KEYS) {
                    const value = perDirection[key];
                    if (typeof value === "string" && value.trim() !== "")
                        project.prompts.videoPerDirection[key] = value;
                    else
                        delete project.prompts.videoPerDirection[key];
                }
            }
        });
        return { ok: true };
    }
    async saveSettings(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const raw = asRecord(input.settings);
        const changed = await patchProject(projectId, (project) => {
            const before = { ...project.settings };
            const current = project.settings;
            project.settings = {
                cellWidth: clampInt(raw.cellWidth, current.cellWidth, 16, 2048),
                cellHeight: clampInt(raw.cellHeight, current.cellHeight, 16, 2048),
                frameCount: clampInt(raw.frameCount, current.frameCount, 1, 64),
                fitMode: raw.fitMode === "stretch" ? "stretch" : raw.fitMode === "contain" ? "contain" : current.fitMode,
                workingLongEdge: clampInt(raw.workingLongEdge, current.workingLongEdge, 128, 2048),
                pixelSize: clampInt(raw.pixelSize, current.pixelSize, 0, 32),
                autoCrop: typeof raw.autoCrop === "boolean" ? raw.autoCrop : current.autoCrop,
                fillRatio: clampFloat(raw.fillRatio, current.fillRatio, 0.5, 1),
                bottomMargin: clampInt(raw.bottomMargin, current.bottomMargin, 0, 64),
                cropInset: clampFloat(raw.cropInset, current.cropInset, 0, 0.2),
                keyLow: clampInt(raw.keyLow, current.keyLow, 0, 255),
                keyHigh: clampInt(raw.keyHigh, current.keyHigh, 1, 255),
                despill: clampFloat(raw.despill, current.despill, 0, 1),
                bgTolerance: clampInt(raw.bgTolerance, current.bgTolerance, 0, 160),
                edgeShrink: clampInt(raw.edgeShrink, current.edgeShrink, 0, 8),
                rowOrder: Array.isArray(raw.rowOrder) && raw.rowOrder.length > 0
                    ? raw.rowOrder.filter((key) => typeof key === "string" && directionOf(key) !== undefined)
                    : current.rowOrder.length > 0
                        ? current.rowOrder
                        : [...DEFAULT_ROW_ORDER],
                rowOrderVersion: ROW_ORDER_VERSION,
                concurrency: clampInt(raw.concurrency, current.concurrency, 1, 8)
            };
            if (project.settings.rowOrder.length === 0)
                project.settings.rowOrder = [...DEFAULT_ROW_ORDER];
            if (project.settings.keyHigh <= project.settings.keyLow)
                project.settings.keyHigh = Math.min(255, project.settings.keyLow + 1);
            const differs = (fields) => fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(project.settings[field]));
            if (differs(["workingLongEdge", "cropInset"])) {
                // 抽帧参数变了：raw.bin 已经作废，必须重抽，不能只重新合成。
                for (const key of DIRECTION_KEYS) {
                    const node = project.frames[key];
                    if (node?.raw !== undefined)
                        node.stale = true;
                }
            }
            return { compose: differs(COMPOSE_SETTINGS) };
        });
        // 改行序、格子尺寸、抠像参数……都会让已经生成的整图失效。这里自动重跑一次
        // 合成，否则整图/预览会和设置对不上（按新行号去切旧图 → 取到错误的方向）。
        if (changed.compose === true) {
            const fresh = await readProject(projectId);
            const hasFrames = fresh !== undefined && DIRECTION_KEYS.some((key) => fresh.frames[key]?.raw !== undefined);
            if (hasFrames)
                startCompose(projectId);
        }
        return { ok: true };
    }
    async setApproved(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const stage = asString(input.stage);
        const key = typeof input.key === "string" ? input.key : undefined;
        const approved = input.approved === true;
        await patchProject(projectId, (project) => {
            if (stage === "images" && key !== undefined && project.images[key] !== undefined) {
                project.images[key].approved = approved;
            }
            else if (stage === "images") {
                for (const k of DIRECTION_KEYS)
                    project.images[k].approved = approved;
            }
            else if (stage === "videos" && key !== undefined && project.videos[key] !== undefined) {
                project.videos[key].approved = approved;
            }
            else if (stage === "videos") {
                for (const k of DIRECTION_KEYS)
                    if (project.videos[k].status === "ready")
                        project.videos[k].approved = approved;
            }
            else if (stage === "frames" && key !== undefined && project.frames[key] !== undefined) {
                project.frames[key].approved = approved;
            }
            else if (stage === "frames") {
                for (const k of DIRECTION_KEYS)
                    if (project.frames[k].status === "ready")
                        project.frames[k].approved = approved;
            }
            else if (stage === "sheet") {
                project.sheet.approved = approved;
            }
        });
        return { ok: true };
    }
    async revealProject(payload) {
        const projectId = asString(asRecord(payload).projectId);
        if (!(await projectExists(projectId)))
            throw new Error(`项目不存在：${projectId}`);
        const dir = projectDir(projectId);
        const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
        try {
            spawn(command, [dir], { detached: true, stdio: "ignore" }).unref();
        }
        catch (error) {
            throw new Error(`无法打开目录：${error instanceof Error ? error.message : String(error)}`);
        }
        return { ok: true, dir };
    }
    /**
     * 记录审核模式（`auto` = agent 自己审完继续；`manual` = 每步停下等用户确认）。
     *
     * 固定流程要求：动手之前先问用户选哪个。选完存在目标自己身上，
     * 之后每一轮都由它决定「agent 继续」还是「停下来等回复」——不靠模型记性。
     */
    async setReviewMode(payload) {
        const input = asRecord(payload);
        const id = asString(input.id);
        const module = asString(input.module);
        const reviewMode = asString(input.reviewMode);
        if (reviewMode !== "auto" && reviewMode !== "manual")
            throw new Error(`未知审核模式：${reviewMode}`);
        if (module === "sprite") {
            await patchProject(id, (project) => {
                project.reviewMode = reviewMode;
                log(project, "info", `审核模式：${reviewMode === "manual" ? "每一步人工审核" : "agent 自动审核"}`);
            });
            return { ok: true, id, module, reviewMode };
        }
        if (module === "image") {
            const job = await imagegen.readImageJob(id);
            if (job === undefined)
                throw new Error(`任务不存在：${id}`);
            job.reviewMode = reviewMode;
            await imagegen.writeImageJob(job);
            return { ok: true, id, module, reviewMode };
        }
        if (module === "sequence") {
            const job = await seqgen.readSequenceJob(id);
            if (job === undefined)
                throw new Error(`任务不存在：${id}`);
            job.reviewMode = reviewMode;
            await seqgen.writeSequenceJob(job);
            return { ok: true, id, module, reviewMode };
        }
        // 骨骼动画：模块四的 RigJob 也有 reviewMode 字段，但早期版本的这里与 wire 的
        // module 枚举都漏了 rig —— 于是「固定流程第 0 步必须问清审核模式」这条规则对
        // 骨骼动画根本落不了地（走到这里会抛「未知模块：rig」）。
        if (module === "rig") {
            const job = await riggen.readRigJob(id);
            if (job === undefined)
                throw new Error(`任务不存在：${id}`);
            job.reviewMode = reviewMode;
            await riggen.writeRigJob(job);
            return { ok: true, id, module, reviewMode };
        }
        throw new Error(`未知模块：${module}`);
    }
    // ── 流水线控制 ──────────────────────────────────────────────────────────
    async runImage(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const key = asString(input.key);
        if (directionOf(key) === undefined)
            throw new Error(`未知方向：${key}`);
        return startImage(projectId, key, {
            prompt: typeof input.prompt === "string" ? input.prompt : undefined
        });
    }
    async runImages(payload) {
        const input = asRecord(payload);
        return startAllImages(asString(input.projectId), input.force === true);
    }
    async runVideos(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        const keys = Array.isArray(input.keys) ? input.keys.filter((k) => directionOf(k) !== undefined) : undefined;
        // 「重新生成」只允许点名方向：批量提交带这个标记会把八段视频全部重跑一遍，
        // 用户点一下「生成全部视频」就白花八段视频的钱。
        const regenerate = input.regenerate === true;
        if (regenerate && keys === undefined) {
            throw new Error("「重新生成」必须指定方向：请点对应方向的「重新生成」，或先「清空视频重来」");
        }
        const candidates = keys ?? DIRECTION_KEYS;
        if (!candidates.some((key) => project.images[key]?.file !== undefined)) {
            throw new Error("还没有可用的绿幕图，请先在第 1 步生成绿幕图");
        }
        // 重复提交会把正在跑的任务覆盖成孤儿（钱照花、结果拿不到），
        // 所以这里同步拦掉，并且让界面能直接看到原因而不是只在日志里。
        const running = candidates.filter((key) => {
            const node = project.videos[key];
            return node?.status === "running" && typeof node.taskId === "string";
        });
        const pending = candidates.filter((key) => !running.includes(key));
        if (pending.length === 0) {
            throw new Error(`这些方向已经在生成中，请等它们跑完：${running.join("、")}`);
        }
        // 「重新生成」：先把旧视频与它抽出来的帧作废，否则 startVideos 会把 ready 的方向
        // 当成「已完成」跳过——界面表现为转一圈就结束，失败信息只留在日志里
        // （实测报错：「没有可提交的方向：请先生成绿幕图，或先清掉已完成的视频」）。
        const obsolete = regenerate
            ? pending.filter((key) => project.videos[key]?.status === "ready" || project.videos[key]?.file !== undefined)
            : [];
        if (obsolete.length > 0) {
            await clearVideos(projectId, obsolete);
            const labels = obsolete.map((key) => directionOf(key)?.label ?? key).join("、");
            await patchProject(projectId, (current) => {
                log(current, "info", `重新生成：已作废「${labels}」的旧视频与序列帧，需要重新抽帧与合成整图`);
            });
        }
        // 已经完成的方向默认不重复提交；只有点名「重新生成」的才重跑。
        const submittable = pending.filter((key) => regenerate || project.videos[key]?.status !== "ready");
        if (submittable.length === 0) {
            throw new Error("这些方向的视频都已经生成完成；要重做请点该方向的「重新生成」");
        }
        return startVideos(projectId, submittable);
    }
    async pollVideos(payload) {
        const projectId = asString(asRecord(payload).projectId);
        await pollVideosOnce(projectId);
        return { ok: true, jobs: listJobs(projectId) };
    }
    async clearVideos(payload) {
        const input = asRecord(payload);
        const keys = Array.isArray(input.keys) ? input.keys.filter((k) => directionOf(k) !== undefined) : undefined;
        await clearVideos(asString(input.projectId), keys);
        return { ok: true };
    }
    async runFrames(payload) {
        const input = asRecord(payload);
        const projectId = asString(input.projectId);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        const keys = Array.isArray(input.keys) ? input.keys.filter((k) => directionOf(k) !== undefined) : undefined;
        const candidates = keys ?? DIRECTION_KEYS;
        // 这里就把「到底要抽哪几个方向」定死再交给流水线：宿主要把它写进任务的覆盖面
        // （界面靠它盖住还没轮到的方向），而没视频的方向永远抽不出东西，留在里面
        // 会让那个格子一直转圈。
        const targets = candidates.filter((key) => project.videos[key]?.file !== undefined);
        if (targets.length === 0) {
            throw new Error("还没有可抽帧的视频，请先在第 2 步生成视频");
        }
        return startExtract(projectId, targets);
    }
    async rekey(payload) {
        const projectId = asString(asRecord(payload).projectId);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        if (!DIRECTION_KEYS.some((key) => project.frames[key]?.raw !== undefined)) {
            throw new Error("还没有抽过帧，请先在第 3 步抽取序列帧");
        }
        return startRekey(projectId);
    }
    async compose(payload) {
        const projectId = asString(asRecord(payload).projectId);
        const project = await readProject(projectId);
        if (project === undefined)
            throw new Error(`项目不存在：${projectId}`);
        if (!DIRECTION_KEYS.some((key) => project.frames[key]?.raw !== undefined)) {
            throw new Error("还没有抽过帧，请先在第 3 步抽取序列帧");
        }
        return startCompose(projectId);
    }
    /** 方法表里声明的名字都要真实存在，这里做一次自检（仅开发期会失败）。 */
    // ── 图片生成模块 ──────────────────────────────────────────────────────
    async listImageJobs() {
        return { jobs: await imagegen.listImageJobs() };
    }
    async createImageJob(payload) {
        const job = await imagegen.createImageJob(asString(asRecord(payload).name, ""));
        return { jobId: job.id };
    }
    async getImageJob(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await imagegen.readImageJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        return { ...job, assetBase: `${ROUTE_PREFIX}/image-assets/${jobId}/` };
    }
    async deleteImageJob(payload) {
        await imagegen.deleteImageJob(asString(asRecord(payload).jobId));
        return { ok: true };
    }
    async saveImageJob(payload) {
        const input = asRecord(payload);
        const jobId = asString(input.jobId);
        const job = await imagegen.readImageJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (typeof input.name === "string" && input.name.trim() !== "")
            job.name = input.name.trim().slice(0, 80);
        if (typeof input.prompt === "string")
            job.prompt = input.prompt;
        if (typeof input.suffix === "string")
            job.suffix = input.suffix;
        if (input.settings !== undefined) {
            const raw = asRecord(input.settings);
            // 生图模型是全局设置（设置 → 游戏素材大师 → 生图模型），任务里不保留可覆盖的副本。
            job.settings.model = (await loadConfig()).arkModel;
            job.settings.size = asString(raw.size, job.settings.size);
            job.settings.count = clampInt(raw.count, job.settings.count, 1, 8);
            job.settings.watermark = raw.watermark === true;
        }
        if (input.keying !== undefined)
            applyKeying(job.keying, asRecord(input.keying));
        // 验收打标：不带 index 就是整个任务，带 index 只改那一张。和界面上的「通过」是同一份数据。
        if (typeof input.approved === "boolean") {
            const index = input.index === undefined || input.index === null ? undefined : clampInt(input.index, -1, 0, 9999);
            let touched = 0;
            for (const item of job.items) {
                if (index === undefined || item.index === index) {
                    item.approved = input.approved;
                    touched++;
                }
            }
            if (index !== undefined && touched === 0)
                throw new Error(`没有第 ${index} 张产物`);
        }
        await imagegen.writeImageJob(job);
        return { ok: true };
    }
    async uploadImageRef(payload) {
        const input = asRecord(payload);
        await imagegen.addImageRef(asString(input.jobId), asString(input.name, "ref.png"), asString(input.data));
        return { ok: true };
    }
    async removeImageRef(payload) {
        const input = asRecord(payload);
        await imagegen.removeImageRef(asString(input.jobId), asString(input.file));
        return { ok: true };
    }
    async addImageItem(payload) {
        const input = asRecord(payload);
        await imagegen.addImageToJob(asString(input.jobId), asString(input.name, "image.png"), asString(input.data));
        return { ok: true };
    }
    async removeImageItem(payload) {
        const input = asRecord(payload);
        await imagegen.removeImageItem(asString(input.jobId), clampInt(input.index, 0, 0, 9999));
        return { ok: true };
    }
    async runImageJob(payload) {
        const input = asRecord(payload);
        const jobId = asString(input.jobId);
        const job = await imagegen.readImageJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (job.prompt.trim() === "")
            throw new Error("提示词为空，请先填写");
        const count = clampInt(input.count, job.settings.count, 1, 8);
        if (count !== job.settings.count) {
            job.settings.count = count;
            await imagegen.writeImageJob(job);
        }
        let started = 0;
        for (let i = 0; i < count; i++) {
            if (kickImageItem(jobId, i))
                started++;
        }
        if (started === 0)
            throw new Error("这些图片已经在生成中，请等它们跑完");
        return { started: true, count: started };
    }
    async keyImageJob(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const ok = kickImageKey(jobId);
        return ok ? { started: true } : { started: false, reason: "抠像已在进行中" };
    }
    // ── 序列帧生成模块 ────────────────────────────────────────────────────
    async listSequenceJobs() {
        return { jobs: await seqgen.listSequenceJobs() };
    }
    async createSequenceJob(payload) {
        const job = await seqgen.createSequenceJob(asString(asRecord(payload).name, ""));
        return { jobId: job.id };
    }
    async getSequenceJob(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        return { ...job, tasks: seqgen.listSequenceTasks(jobId), assetBase: `${ROUTE_PREFIX}/sequence-assets/${jobId}/` };
    }
    async deleteSequenceJob(payload) {
        await seqgen.deleteSequenceJob(asString(asRecord(payload).jobId));
        return { ok: true };
    }
    async saveSequenceJob(payload) {
        const input = asRecord(payload);
        const jobId = asString(input.jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (typeof input.name === "string" && input.name.trim() !== "")
            job.name = input.name.trim().slice(0, 80);
        if (input.mode === "frames" || input.mode === "reference")
            job.mode = input.mode;
        if (typeof input.prompt === "string")
            job.prompt = input.prompt;
        if (typeof input.suffix === "string")
            job.suffix = input.suffix;
        if (input.settings !== undefined) {
            const raw = asRecord(input.settings);
            const before = { ...job.settings };
            // 视频模型是全局设置（含优云智算版），任务里不保留可覆盖的副本；
            // 时长/分辨率也跟着当前模型收敛，避免存下当前模型不支持的档位。
            const model = (await loadConfig()).minimaxModel;
            job.settings.model = model;
            job.settings.duration = normalizeDuration(model, clampInt(raw.duration, job.settings.duration, 1, 30));
            job.settings.resolution = normalizeResolution(model, asString(raw.resolution, job.settings.resolution));
            job.settings.promptOptimizer = raw.promptOptimizer !== false;
            job.settings.frameCount = clampInt(raw.frameCount, job.settings.frameCount, 1, 64);
            job.settings.cellWidth = clampInt(raw.cellWidth, job.settings.cellWidth, 16, 2048);
            job.settings.cellHeight = clampInt(raw.cellHeight, job.settings.cellHeight, 16, 2048);
            job.settings.longEdge = clampInt(raw.longEdge, job.settings.longEdge, 128, 2048);
            job.settings.cropInset = clampFloat(raw.cropInset, job.settings.cropInset, 0, 0.2);
            job.settings.pixelSize = clampInt(raw.pixelSize, job.settings.pixelSize, 0, 32);
            // 抽帧参数变了，raw.bin 作废，必须重抽。
            if (before.longEdge !== job.settings.longEdge || before.cropInset !== job.settings.cropInset) {
                if (job.frames.raw !== undefined)
                    job.frames.stale = true;
            }
        }
        if (input.keying !== undefined)
            applyKeying(job.keying, asRecord(input.keying));
        // 验收打标：不带 step 就是三步全打，带 step 只改那一步。与界面的「通过」共用同一份数据。
        if (typeof input.approved === "boolean") {
            const step = typeof input.step === "string" ? input.step : undefined;
            if (step === undefined) {
                job.video.approved = input.approved;
                job.frames.approved = input.approved;
                job.sheet.approved = input.approved;
            }
            else {
                if (step !== "video" && step !== "frames" && step !== "sheet")
                    throw new Error(`未知步骤：${step}`);
                job[step].approved = input.approved;
            }
        }
        await seqgen.writeSequenceJob(job);
        return { ok: true };
    }
    async uploadSequenceRef(payload) {
        const input = asRecord(payload);
        await seqgen.uploadSequenceRef(asString(input.jobId), asString(input.kind, "referenceImage"), asString(input.name, "file"), asString(input.data));
        return { ok: true };
    }
    async removeSequenceRef(payload) {
        const input = asRecord(payload);
        await seqgen.removeSequenceRef(asString(input.jobId), asString(input.kind, "referenceImage"), typeof input.file === "string" ? input.file : undefined);
        return { ok: true };
    }
    async runSequenceVideo(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (job.video.status === "running" && typeof job.video.taskId === "string") {
            throw new Error("视频已经在生成中，请等它跑完（重复提交会白花一次生成的钱）");
        }
        // 素材缺失同步报错，否则只会落进日志、界面上看着像「点了没反应」。
        if (job.mode === "frames" && job.refs.firstFrame === undefined) {
            throw new Error("首尾帧模式必须上传一张首帧图");
        }
        if (job.mode === "reference" && job.refs.referenceImages.length === 0 && job.refs.referenceVideos.length === 0) {
            throw new Error("参考模式至少要上传一张参考图或一段参考视频");
        }
        if (job.frames.raw !== undefined && job.video.status === "empty") {
            throw new Error("清空视频后才能重新生成");
        }
        return seqgen.startSequenceVideo(jobId);
    }
    async pollSequenceVideo(payload) {
        await seqgen.pollSequenceOnce(asString(asRecord(payload).jobId));
        return { ok: true };
    }
    async clearSequenceVideo(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        job.video = { status: "empty" };
        job.frames = { status: "empty", count: job.settings.frameCount, files: [], keyed: [] };
        job.sheet = { status: "empty" };
        await seqgen.writeSequenceJob(job);
        return { ok: true };
    }
    async runSequenceFrames(payload) {
        const input = asRecord(payload);
        const jobId = asString(input.jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (job.video.file === undefined)
            throw new Error("还没有可用视频，请先生成视频");
        const count = input.count === undefined ? undefined : clampInt(input.count, job.settings.frameCount, 1, 64);
        return seqgen.startSequenceFrames(jobId, count);
    }
    async keySequenceFrames(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (job.frames.raw === undefined)
            throw new Error("还没有抽过帧，请先抽帧");
        return seqgen.startSequenceKey(jobId);
    }
    async composeSequence(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await seqgen.readSequenceJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (job.frames.raw === undefined)
            throw new Error("还没有抽过帧，请先抽帧");
        await seqgen.composeSequenceSheet(jobId);
        return { started: true };
    }
    // ── 骨骼动画生成模块 ──────────────────────────────────────────────────
    async listRigJobs() {
        return { jobs: await riggen.listRigJobs() };
    }
    async createRigJob(payload) {
        const job = await riggen.createRigJob(asString(asRecord(payload).name, ""));
        return { jobId: job.id };
    }
    async getRigJob(payload) {
        const jobId = asString(asRecord(payload).jobId);
        const job = await riggen.readRigJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        // 界面拿的是**与对话工具同一份**任务视图（相对 URL），字段不会再各拼一份。
        return {
            ...riggen.rigSnapshot(job),
            stageList: riggen.RIG_STAGES,
            animationPresets: riggen.RIG_ANIMATIONS
        };
    }
    async deleteRigJob(payload) {
        await riggen.deleteRigJob(asString(asRecord(payload).jobId));
        return { ok: true };
    }
    async saveRigJob(payload) {
        const input = asRecord(payload);
        const jobId = asString(input.jobId);
        const job = await riggen.readRigJob(jobId);
        if (job === undefined)
            throw new Error(`任务不存在：${jobId}`);
        if (typeof input.name === "string" && input.name.trim() !== "") {
            await riggen.writeRigJob({ ...job, name: input.name.trim().slice(0, 80) });
        }
        if (typeof input.sheetPrompt === "string" || typeof input.suffix === "string" || input.resetSheetPrompt === true) {
            await riggen.saveRigPrompts(jobId, {
                sheet: typeof input.sheetPrompt === "string" ? input.sheetPrompt : undefined,
                suffix: typeof input.suffix === "string" ? input.suffix : undefined,
                resetSheet: input.resetSheetPrompt === true
            });
        }
        if (input.settings !== undefined)
            await riggen.saveRigSettings(jobId, asRecord(input.settings));
        if (typeof input.approved === "boolean") {
            const stage = typeof input.stage === "string" ? input.stage : undefined;
            if (stage === undefined) {
                await riggen.setRigStageApproved(jobId, "parts", input.approved);
                await riggen.setRigStageApproved(jobId, "layout", input.approved);
                await riggen.setRigStageApproved(jobId, "rig", input.approved);
                await riggen.setRigStageApproved(jobId, "atlas", input.approved);
            }
            else if (stage === "parts" && typeof input.part === "string") {
                await riggen.setRigPartApproved(jobId, input.part, input.approved);
            }
            else {
                await riggen.setRigStageApproved(jobId, stage, input.approved);
            }
        }
        return { ok: true };
    }
    async uploadRigSource(payload) {
        const input = asRecord(payload);
        const size = await riggen.setRigSource(asString(input.jobId), asString(input.name, "character.png"), asString(input.data));
        return { ok: true, ...size };
    }
    async uploadRigPart(payload) {
        const input = asRecord(payload);
        const result = await riggen.uploadRigPart(asString(input.jobId), asString(input.name, "part.png"), asString(input.data));
        return { ok: true, ...result };
    }
    async removeRigPart(payload) {
        const input = asRecord(payload);
        await riggen.removeRigPart(asString(input.jobId), asString(input.name));
        return { ok: true };
    }
    async renameRigPart(payload) {
        const input = asRecord(payload);
        await riggen.renameRigPart(asString(input.jobId), asString(input.from), asString(input.to));
        return { ok: true };
    }
    async setRigPartVisibility(payload) {
        const input = asRecord(payload);
        await riggen.setRigPartVisibility(asString(input.jobId), asString(input.name), input.hidden === true);
        return { ok: true };
    }
    async saveRigLayoutItem(payload) {
        const input = asRecord(payload);
        const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
        await riggen.saveLayoutItem(asString(input.jobId), asString(input.name), {
            x: num(input.x),
            y: num(input.y),
            width: num(input.width),
            height: num(input.height),
            rotation: num(input.rotation),
            z: num(input.z)
        });
        return { ok: true };
    }
    async saveRigLayoutItems(payload) {
        const input = asRecord(payload);
        const items = Array.isArray(input.items) ? input.items : [];
        const result = await riggen.saveRigLayoutItems(asString(input.jobId), items.map((entry) => ({
            name: asString(entry?.name),
            x: typeof entry?.x === "number" ? entry.x : undefined,
            y: typeof entry?.y === "number" ? entry.y : undefined,
            width: typeof entry?.width === "number" ? entry.width : undefined,
            height: typeof entry?.height === "number" ? entry.height : undefined,
            rotation: typeof entry?.rotation === "number" ? entry.rotation : undefined,
            z: typeof entry?.z === "number" ? entry.z : undefined,
            placed: typeof entry?.placed === "boolean" ? entry.placed : undefined
        })));
        return { ok: true, ...result };
    }
    async setRigLayoutHints(payload) {
        const input = asRecord(payload);
        const raw = asRecord(input.hints);
        const hints = {};
        for (const [name, value] of Object.entries(raw))
            hints[name] = value === null ? null : value;
        const result = await riggen.setRigLayoutHints(asString(input.jobId), hints);
        return { ok: true, ...result };
    }
    async runRigSheet(payload) {
        return riggen.startSheetGeneration(asString(asRecord(payload).jobId));
    }
    /**
     * 手工骨骼偏移（三通道的中间那一层）。
     *
     * 它与 `setRigSemantics` 一样只作废「骨骼与图集」：偏置只影响骨骼推导，
     * 部件摆在画布上的位置与它无关。
     */
    async setRigBoneOffsets(payload) {
        const input = asRecord(payload);
        const rawBones = Array.isArray(input.bones) ? input.bones : [];
        const bones = rawBones.map((item) => {
            const record = asRecord(item);
            const patch = { name: asString(record.name) };
            if (typeof record.x === "number")
                patch.x = record.x;
            if (typeof record.y === "number")
                patch.y = record.y;
            if (typeof record.rotation === "number")
                patch.rotation = record.rotation;
            return patch;
        });
        const touched = await riggen.setRigBoneOffsets(asString(input.jobId), bones, {
            by: input.by === "ai" ? "ai" : "human",
            label: typeof input.label === "string" ? input.label : undefined
        });
        return { ok: true, ...touched };
    }
    async resetRigBoneOffsets(payload) {
        const input = asRecord(payload);
        const names = Array.isArray(input.names) ? input.names.filter((name) => typeof name === "string") : undefined;
        return { ok: true, ...(await riggen.resetRigBoneOffsets(asString(input.jobId), names)) };
    }
    /** 动画参数：`amplitude`（统一缩放幅度）与 `duration`（循环时长）。 */
    async setRigAnimationSettings(payload) {
        const input = asRecord(payload);
        const raw = Array.isArray(input.animations) ? input.animations : [];
        const patches = raw.map((item) => {
            const record = asRecord(item);
            const patch = { id: asString(record.id) };
            if (typeof record.duration === "number")
                patch.duration = record.duration;
            if (typeof record.amplitude === "number")
                patch.amplitude = record.amplitude;
            return patch;
        });
        const result = await riggen.setRigAnimationSettings(asString(input.jobId), patches, {
            by: input.by === "ai" ? "ai" : "human"
        });
        return { ok: true, ...result };
    }
    async resetRigAnimationSettings(payload) {
        const input = asRecord(payload);
        const ids = Array.isArray(input.ids) ? input.ids.filter((id) => typeof id === "string") : undefined;
        return { ok: true, ...(await riggen.resetRigAnimationSettings(asString(input.jobId), ids)) };
    }
    /**
     * 换色（本地计算，免费）。
     *
     * 目标二选一：点名 `names`，或按语义 `tag` 批量。落成一个**新版本**，
     * 所以不满意随时用 `setRigTextureVersion` 切回去。
     */
    async tintRigParts(payload) {
        const input = asRecord(payload);
        const names = Array.isArray(input.names) ? input.names.filter((name) => typeof name === "string") : undefined;
        const raw = asRecord(input.tint);
        const tint = {};
        for (const key of ["hue", "saturation", "lightness", "brightness", "contrast"]) {
            if (typeof raw[key] === "number")
                tint[key] = raw[key];
        }
        if (Array.isArray(raw.rgb) && raw.rgb.length === 3) {
            tint.rgb = raw.rgb.map((value) => Number(value));
        }
        return {
            ok: true,
            ...(await riggen.tintRigParts(asString(input.jobId), { names, tag: typeof input.tag === "string" ? input.tag : undefined }, tint, { by: input.by === "ai" ? "ai" : "human", note: typeof input.note === "string" ? input.note : undefined }))
        };
    }
    /** 手工上传一张贴图顶掉当前版本（同样是新增一版，不覆盖）。 */
    async uploadRigTexture(payload) {
        const input = asRecord(payload);
        return {
            ok: true,
            ...(await riggen.uploadRigTexture(asString(input.jobId), asString(input.name), asString(input.data), {
                note: typeof input.note === "string" ? input.note : undefined
            }))
        };
    }
    /** 切到某一版贴图（「这张 AI 头发不行，换回原版」）。 */
    async setRigTextureVersion(payload) {
        const input = asRecord(payload);
        return { ok: true, ...(await riggen.setRigTextureVersion(asString(input.jobId), asString(input.name), Number(input.version))) };
    }
    async removeRigTextureVersion(payload) {
        const input = asRecord(payload);
        return { ok: true, ...(await riggen.removeRigTextureVersion(asString(input.jobId), asString(input.name), Number(input.version))) };
    }
    /**
     * 语义层（阶段③）：AI 或人改「这块是什么、挂在谁身上、骨骼从哪伸到哪」。
     *
     * 校验不通过时**不抛异常**，而是把 errors/warnings 原样回给调用方——
     * 界面要能把「哪一条、为什么不合法」显示出来，agent 也要能据此自我修正。
     */
    async setRigSemantics(payload) {
        const input = asRecord(payload);
        const rawParts = Array.isArray(input.parts) ? input.parts : [];
        const parts = rawParts.map((item) => {
            const record = asRecord(item);
            const patch = { name: asString(record.name) };
            if (typeof record.role === "string")
                patch.role = record.role;
            if (record.parent === null)
                patch.parent = undefined;
            else if (typeof record.parent === "string")
                patch.parent = record.parent;
            if (Array.isArray(record.proximal) && record.proximal.length === 2)
                patch.proximal = [Number(record.proximal[0]), Number(record.proximal[1])];
            if (Array.isArray(record.distal) && record.distal.length === 2)
                patch.distal = [Number(record.distal[0]), Number(record.distal[1])];
            if (Array.isArray(record.tags))
                patch.tags = record.tags.filter((tag) => typeof tag === "string");
            return patch;
        });
        return riggen.setRigSemantics(asString(input.jobId), parts, {
            humanoid: typeof input.humanoid === "boolean" ? input.humanoid : undefined,
            by: input.by === "ai" ? "ai" : "human"
        });
    }
    async runRigSegment(payload) {
        return riggen.startSegmentation(asString(asRecord(payload).jobId));
    }
    async runRigLayout(payload) {
        const input = asRecord(payload);
        const names = Array.isArray(input.names) ? input.names.filter((name) => typeof name === "string") : undefined;
        return riggen.startLayout(asString(input.jobId), names);
    }
    async runRigBones(payload) {
        return riggen.startRig(asString(asRecord(payload).jobId));
    }
    async runRigAtlas(payload) {
        return riggen.startAtlas(asString(asRecord(payload).jobId));
    }
    assertSurface() {
        for (const spec of METHODS) {
            if (typeof this[spec.method] !== "function") {
                throw new Error(`gameStudio 缺少方法：${spec.method}`);
            }
        }
    }
}
/**
 * 把界面传来的抠像参数收敛进目标对象。
 * 三个模块共用同一套参数名，所以收敛逻辑也共用。
 */
function applyKeying(target, raw) {
    target.keyLow = clampInt(raw.keyLow, target.keyLow, 0, 255);
    target.keyHigh = clampInt(raw.keyHigh, target.keyHigh, 1, 255);
    if (target.keyHigh <= target.keyLow)
        target.keyHigh = Math.min(255, target.keyLow + 1);
    target.despill = clampFloat(raw.despill, target.despill, 0, 1);
    target.bgTolerance = clampInt(raw.bgTolerance, target.bgTolerance, 0, 160);
    target.edgeShrink = clampInt(raw.edgeShrink, target.edgeShrink, 0, 8);
    if (typeof raw.enabled === "boolean")
        target.enabled = raw.enabled;
}
/**
 * 图片模块的运行表：一张图一个槽位。
 * 同一张图重复点「生成」会白花一次钱，所以这里和八方向模块一样做拒绝。
 */
const imageTasks = new Map();
function startedImageTask(jobId, key) {
    return imageTasks.get(jobId)?.has(key) === true;
}
function trackImageTask(jobId, key, run) {
    if (startedImageTask(jobId, key))
        return false;
    const set = imageTasks.get(jobId) ?? new Set();
    imageTasks.set(jobId, set);
    set.add(key);
    void run()
        .catch(() => undefined)
        .finally(() => {
        set.delete(key);
        if (set.size === 0)
            imageTasks.delete(jobId);
    });
    return true;
}
function kickImageItem(jobId, index) {
    return trackImageTask(jobId, `image:${index}`, () => imagegen.generateImageItem(jobId, index));
}
function kickImageKey(jobId) {
    return trackImageTask(jobId, "image:key", () => imagegen.rekeyImageJob(jobId));
}
function disposeImageTasks() {
    imageTasks.clear();
}
// ── 静态资源路由 ────────────────────────────────────────────────────────
/** 各模块允许通过 HTTP 路由读取的子目录白名单。 */
const SERVABLE_DIRS = new Set(["source", "images", "videos", "frames", "keyed", "preview", "out"]);
const SERVABLE_IMAGE_DIRS = new Set(["refs", "out", "keyed"]);
const SERVABLE_SEQUENCE_DIRS = new Set(["refs", "video-refs", "videos", "frames", "keyed", "out"]);
/** 骨骼动画：源图、拆件摊平图、部件、装配结果、骨骼与图集。 */
const SERVABLE_RIG_DIRS = new Set(["source", "sheet", "parts", "layout", "rig", "atlas"]);
function resolveAssetTarget(scope, id, relative) {
    if (scope === "assets") {
        if (!PROJECT_ID_PATTERN.test(id))
            return undefined;
        return { file: assetPath(id, relative), dirs: SERVABLE_DIRS };
    }
    if (scope === "image-assets") {
        if (!imagegen.isValidImageJobId(id))
            return undefined;
        return { file: imagegen.imageAssetPath(id, relative), dirs: SERVABLE_IMAGE_DIRS };
    }
    if (scope === "rig-assets") {
        if (!riggen.isValidRigJobId(id))
            return undefined;
        return { file: riggen.rigAssetPath(id, relative), dirs: SERVABLE_RIG_DIRS };
    }
    if (!seqgen.isValidSequenceJobId(id))
        return undefined;
    return { file: seqgen.sequenceAssetPath(id, relative), dirs: SERVABLE_SEQUENCE_DIRS };
}
function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(text);
}
/**
 * 把四个模块的产物路径映射到磁盘文件：
 *   /dsh-game-material-master/assets/<项目 id>/<相对路径>           八方向图
 *   /dsh-game-material-master/image-assets/<任务 id>/<相对路径>      图片生成
 *   /dsh-game-material-master/sequence-assets/<任务 id>/<相对路径>   序列帧生成
 *   /dsh-game-material-master/rig-assets/<任务 id>/<相对路径>        骨骼动画生成
 *
 * 支持 Range：没有它浏览器里的 <video> 就不能拖动进度条，验收视频时会很难受。
 */
async function handleAsset(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(res, 405, "Method Not Allowed");
        return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length)).replace(/^\/+/, "");
    /**
     * 构建探针。走 prefix 路由，所以路径是 `/dsh-game-material-master/_health`。
     *
     * 不读盘、无副作用，只回「本模块是哪次 import 进来的」——客户端 bundle 每次请求
     * 都从磁盘现读，宿主半区却只在进程启动（或 profile patch 热重载）时 import 一次，
     * 两者会不一致。有这个端点，界面与测试就能明确区分「代码没生效」和「功能坏了」，
     * 而不是像以前那样以「按钮一直是灰的 / 图片 404」的形式坏掉。
     */
    if (rest === "_health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(`${JSON.stringify({ ok: true, pid: process.pid, ...BOOT_INFO })}\n`);
        return;
    }
    const segments = rest.split("/").filter((segment) => segment !== "");
    if (segments.length < 3) {
        sendText(res, 404, "Not Found");
        return;
    }
    const scope = segments[0];
    if (scope !== "assets" && scope !== "image-assets" && scope !== "sequence-assets" && scope !== "rig-assets") {
        sendText(res, 404, "Not Found");
        return;
    }
    const id = segments[1];
    const relative = segments.slice(2).join("/");
    if (relative.includes("..")) {
        sendText(res, 400, "Bad Request");
        return;
    }
    let target;
    try {
        target = resolveAssetTarget(scope, id, relative);
    }
    catch {
        sendText(res, 400, "Bad Request");
        return;
    }
    if (target === undefined) {
        sendText(res, 400, "Bad Request");
        return;
    }
    if (!target.dirs.has(relative.split("/")[0])) {
        sendText(res, 403, "Forbidden");
        return;
    }
    let info;
    try {
        info = await stat(target.file);
    }
    catch {
        sendText(res, 404, "Not Found");
        return;
    }
    if (!info.isFile()) {
        sendText(res, 404, "Not Found");
        return;
    }
    const type = MIME_TYPES[extname(target.file).toLowerCase()] ?? "application/octet-stream";
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const baseHeaders = {
        "Content-Type": type,
        ETag: etag,
        "Last-Modified": new Date(info.mtimeMs).toUTCString(),
        // 产物是不可变的（每次重跑都会换 mtime → 换 ETag），所以可以放心长缓存。
        "Cache-Control": "private, max-age=300",
        "Accept-Ranges": "bytes"
    };
    if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, baseHeaders);
        res.end();
        return;
    }
    const rangeHeader = req.headers.range;
    if (typeof rangeHeader === "string") {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (match !== null) {
            const start = match[1] === "" ? Math.max(0, info.size - Number(match[2])) : Number(match[1]);
            const end = match[1] === "" || match[2] === "" ? info.size - 1 : Math.min(info.size - 1, Number(match[2]));
            if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < info.size) {
                res.writeHead(206, {
                    ...baseHeaders,
                    "Content-Range": `bytes ${start}-${end}/${info.size}`,
                    "Content-Length": String(end - start + 1)
                });
                if (req.method === "HEAD") {
                    res.end();
                    return;
                }
                const stream = createReadStream(target.file, { start, end });
                stream.on("error", () => res.destroy());
                stream.pipe(res);
                return;
            }
        }
    }
    res.writeHead(200, { ...baseHeaders, "Content-Length": String(info.size) });
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    const stream = createReadStream(target.file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
}
// ── cordis 插件体 ────────────────────────────────────────────────────────
export function apply(ctx) {
    // 旧版本的数据目录叫 8dir-sprites，插件改名后搬一次，已有项目无缝接上。
    void migrateLegacyDataRoot()
        .then((moved) => {
        if (moved)
            process.stderr.write("[game-material-master] 已把旧数据目录 8dir-sprites 迁移到 game-material-master\n");
    })
        .catch(() => undefined);
    const gateway = new GameStudioGateway(ctx);
    gateway.assertSurface();
    ctx.effect(() => ctx.typert.register(MANIFEST), "dsh-8dir-sprites: typert manifest");
    /**
     * 对话调用面：把网关的全部方法 + 多步流程编排注册成模型工具，
     * 并加一段系统提示词说明「怎么推进、怎么把验收链接贴给用户」。
     *
     * `tools` / `systemPrompt` 都是可选服务：最小化的测试组合里可能没有，
     * 缺了就只是没有对话调用面，插件本体照常工作。
     */
    ctx.effect(() => {
        const disposers = registerStudioTools({ tools: ctx.get("tools"), systemPrompt: ctx.get("systemPrompt") }, gateway);
        return () => {
            for (const dispose of disposers)
                dispose();
        };
    }, "dsh-game-material-master: 对话调用面");
    const webServer = ctx.get("webServer");
    if (webServer !== undefined) {
        ctx.effect(() => webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: handleAsset }), "dsh-8dir-sprites: asset route");
    }
    else {
        // inject 已声明 webServer，正常路径下走不到这里；留一条 stderr 诊断，
        // 因为 ctx.logger 的输出不会出现在启动日志里。
        process.stderr.write("[dsh-8dir-sprites] webServer 服务不可用，图片预览路由未注册\n");
    }
    // 进程重启后，把上次没跑完的视频轮询接上。
    void (async () => {
        try {
            for (const summary of await listProjects()) {
                const project = await readProject(summary.id);
                if (project === undefined)
                    continue;
                if (DIRECTION_KEYS.some((key) => project.videos[key]?.status === "running")) {
                    ensurePoller(summary.id);
                }
            }
        }
        catch {
            // 恢复轮询失败不影响插件本体。
        }
    })();
    ctx.effect(() => () => {
        disposePipeline();
        seqgen.disposeSequence();
        riggen.disposeRig();
    }, "dsh-game-material-master: pipeline cleanup");
}
