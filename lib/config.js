/**
 * 插件配置：API 凭证、模型选择、以及整条流水线的默认参数。
 *
 * 落盘位置：`${DSH_HOME:-~/.dsh}/game-material-master/config.json`。
 * Key 只存在宿主本机，从不回传给浏览器明文（`maskConfig` 负责脱敏）。
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ROW_ORDER } from "./directions.js";
import { DEFAULT_KEY_COLOR, normalizeKeyColor } from "./keycolor.js";
import { STUDIO_MODULES } from "./links.js";
import { MUSIC_DEFAULT_MODEL } from "./musicmodels.js";
import { SFX_DEFAULT_BASE_URL, SFX_DEFAULT_FORMAT, SFX_DEFAULT_MODEL, SFX_DEFAULT_SAMPLE_RATE, sfxFormatOrDefault, sfxSampleRateOrDefault } from "./sfxapi.js";
/**
 * 上一版的默认行序（按生成依赖顺序）。方位语义修正后，默认改成罗盘顺时针；
 * 配置里还留着旧默认值的用户应当自动迁过去，而不是被卡在旧顺序上。
 */
const LEGACY_ROW_ORDER = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];
/**
 * 行序语义版本。1 = 旧的生成依赖顺序，2 = 罗盘顺时针。
 * 迁移只在「没有版本号且恰好等于旧默认值」时发生一次，之后用户显式设成
 * 任何顺序（哪怕是旧默认那串）都会被尊重，不会被反复迁走。
 */
export const ROW_ORDER_VERSION = 2;
/** 判断一份行序是不是「上一版的默认值」。 */
export function isLegacyRowOrder(order) {
    return (Array.isArray(order) &&
        order.length === LEGACY_ROW_ORDER.length &&
        order.every((key, index) => key === LEGACY_ROW_ORDER[index]));
}
import { COMP_SHARE_MODEL_ID, normalizeDuration, normalizeResolution, rootOf } from "./minimax.js";
import { DEFAULT_COMFY_WORKFLOW_TEXT, normalizeComfyBaseUrl, normalizeComfyCookies } from "./comfy.js";
export function dshHome() {
    const raw = process.env.DSH_HOME?.trim();
    return raw && raw !== "" ? raw : join(homedir(), ".dsh");
}
export function dataRoot() {
    return join(dshHome(), "game-material-master");
}
export function configPath() {
    return join(dataRoot(), "config.json");
}
/** 八方向图模块的项目根。 */
export function projectsRoot() {
    return join(dataRoot(), "projects");
}
/** 图片生成模块的任务根。 */
export function imageJobsRoot() {
    return join(dataRoot(), "image-jobs");
}
/** 序列帧生成模块的任务根。 */
export function sequenceJobsRoot() {
    return join(dataRoot(), "sequence-jobs");
}
/** 骨骼动画生成模块的任务根。 */
export function rigJobsRoot() {
    return join(dataRoot(), "rig-jobs");
}
/** 地图地块生成模块的项目根。 */
export function tileJobsRoot() {
    return join(dataRoot(), "tile-jobs");
}
/** 音乐生成编辑模块（模块七）的任务根。 */
export function musicJobsRoot() {
    return join(dataRoot(), "music-jobs");
}
/** 音效生成模块（模块八）的任务根。 */
export function sfxJobsRoot() {
    return join(dataRoot(), "sfx-jobs");
}
/**
 * 旧版本把数据放在 `8dir-sprites/`。第一次以新名字启动时整体搬过去，
 * 让已有项目和配置无缝接上——只搬一次，之后两个目录互不影响。
 */
export async function migrateLegacyDataRoot() {
    const legacy = join(dshHome(), "8dir-sprites");
    const current = dataRoot();
    try {
        await stat(legacy);
    }
    catch {
        return false;
    }
    try {
        await stat(current);
        return false; // 新目录已存在，不动
    }
    catch {
        /* 新目录不存在，执行迁移 */
    }
    try {
        await rename(legacy, current);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 生图后端。
 *
 * `ark` = 火山方舟 Seedream（默认，也是唯一「开箱即用」的云端选择）；
 * `custom` = 用户自己的生图服务，协议再分 OpenAI / ComfyUI / Stable Diffusion WebUI。
 * 换后端只改这一个字段：所有生图调用点都走 `imageprovider.generateImageWithProvider`。
 */
export const IMAGE_PROVIDERS = ["ark", "custom", "toapis"];
/** 自定义生图服务的协议。 */
export const CUSTOM_PROTOCOLS = ["openai", "comfyui", "sdwebui"];
/**
 * 各协议的默认地址。
 *
 * 设置页在**协议切换**时会拿它做「原来那个地址还是默认值吗」的判断，
 * 是就顺手换成新协议的默认地址（和 MiniMax 切「优云智算版」同一套做法）——
 * 手动改过地址的用户不会被覆盖。
 */
export const CUSTOM_PROTOCOL_DEFAULTS = {
    openai: {
        baseUrl: "https://api.openai.com/v1",
        label: "OpenAI API",
        hint: "POST {base}/images/generations（带参考图时优先 POST {base}/images/edits）"
    },
    comfyui: {
        baseUrl: "http://127.0.0.1:8188",
        label: "ComfyUI API",
        hint: "POST {base}/prompt + GET {base}/history/{id} + GET {base}/view（需要用 API 格式的工作流 JSON）"
    },
    sdwebui: {
        baseUrl: "http://127.0.0.1:7860",
        label: "Stable Diffusion WebUI API",
        hint: "POST {base}/sdapi/v1/txt2img（带参考图时走 /sdapi/v1/img2img，需要启动时加 --api）"
    }
};
export const DEFAULT_CONFIG = {
    toapisBaseUrl: "https://toapis.cn/v1",
    toapisApiKey: "",
    toapisImageModel: "gpt-image-2-vip",
    toapisImageSize: "1K",
    toapisImageQuality: "low",
    toapisImageBackground: "auto",
    toapisVideo: false,
    toapisVideoModel: "seedance-2-mini",
    toapisVideoDuration: 4,
    toapisVideoResolution: "480p",
    toapisVideoAspectRatio: "16:9",
    toapisTimeoutMs: 600000,
    imageProvider: "ark",
    customProtocol: "openai",
    customBaseUrl: CUSTOM_PROTOCOL_DEFAULTS.openai.baseUrl,
    customApiKey: "",
    customModel: "gpt-image-1",
    customSize: "1024x1024",
    customNegativePrompt: "",
    customSteps: 28,
    customCfgScale: 7,
    customSampler: "DPM++ 2M Karras",
    customDenoising: 0.65,
    customSeed: -1,
    customWorkflow: "",
    customTimeoutMs: 300000,
    arkApiKey: "",
    arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    /**
     * 默认模型。
     *
     * ⚠️ **不要改回 `doubao-seedream-4-0-*`。** 实测（同一张洋红菱形模板 + 同一段
     * 模板填充提示词，各一次调用）：
     *
     * | 模型 | 输出 | 菱形包围盒比例 | 结果是 |
     * |---|---|---|---|
     * | `doubao-seedream-4-0-250828` | **JPEG**（背景烧进 RGB） | **1.058** | 量不出菱形，只能回退模板几何 |
     * | `doubao-seedream-5-0-flash-260915` | PNG | **1.987** | 测量可信，直接规整 |
     *
     * 4.0 会把「2:1 等距菱形」画成一个**接近正方形**的形状 —— 提示词里写满了
     * 「顶点位置必须与参考图一致」也没用。地图地块模块依赖这个几何，所以 4.0 不可用。
     */
    arkModel: "doubao-seedream-5-0-flash-260915",
    /** 默认跟随主模型；需要时可在设置里单独指定。 */
    arkRedrawModel: "",
    arkSize: "2K",
    arkWatermark: false,
    arkTimeoutMs: 180000,
    minimaxApiKey: "",
    minimaxBaseUrl: "https://api.minimaxi.com",
    minimaxModel: "MiniMax-H3",
    minimaxDuration: 5,
    minimaxResolution: "2K",
    minimaxPromptOptimizer: true,
    minimaxTimeoutMs: 120000,
    comfyVideo: false,
    comfyBaseUrl: "http://127.0.0.1:8188",
    comfyCookies: "",
    // 内置模板就是本机装好 FreeVideo 扩展后能直接跑的那份工作流；
    // 用户换成别的工作流（Wan / Hunyuan…）只要输入名符合常见约定就能直接用。
    comfyWorkflow: DEFAULT_COMFY_WORKFLOW_TEXT,
    comfyPromptTarget: "",
    comfyFirstFrameTarget: "",
    comfyWidth: 0,
    comfyHeight: 0,
    comfySeconds: 0,
    comfySeed: 0,
    comfyTimeoutMs: 600000,
    musicProvider: "puyue",
    musicApiKey: "",
    musicBaseUrl: "https://api.yourmusic.fun",
    musicModel: MUSIC_DEFAULT_MODEL,
    musicTimeoutMs: 120000,
    musicPollTimeoutMs: 900000,
    musicPythonPath: "",
    musicFluidsynthPath: "",
    musicSoundfontPath: "",
    sfxProvider: "volcengine",
    sfxApiKey: "",
    sfxBaseUrl: SFX_DEFAULT_BASE_URL,
    sfxModel: SFX_DEFAULT_MODEL,
    sfxFormat: SFX_DEFAULT_FORMAT,
    sfxSampleRate: SFX_DEFAULT_SAMPLE_RATE,
    sfxTimeoutMs: 300000,
    cellWidth: 256,
    cellHeight: 256,
    frameCount: 8,
    fitMode: "contain",
    workingLongEdge: 768,
    pixelSize: 0,
    autoCrop: true,
    fillRatio: 0.94,
    bottomMargin: 2,
    cropInset: 0,
    keyColor: DEFAULT_KEY_COLOR,
    keyLow: 14,
    keyHigh: 80,
    despill: 0.65,
    bgTolerance: 90,
    edgeShrink: 0,
    rowOrder: [...DEFAULT_ROW_ORDER],
    rowOrderVersion: ROW_ORDER_VERSION,
    hiddenModules: [],
    concurrency: 3
};
export const ARK_MODEL_PRESETS = [
    // 地图地块模块对几何很敏感：4.0 会把 2:1 等距菱形画成近正方形（实测比例 1.058），
    // 所以它排在最后并明确标注不适合。见 DEFAULT_CONFIG.arkModel 的注释。
    { id: "doubao-seedream-5-0-flash-260915", label: "Seedream 5.0 Flash（默认 · 快且几何准）" },
    { id: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro（单图质量最好）" },
    { id: "doubao-seedream-5-0-260128", label: "Seedream 5.0 Lite" },
    { id: "doubao-seedream-4-5-251128", label: "Seedream 4.5" },
    { id: "doubao-seedream-4-0-250828", label: "Seedream 4.0（⚠️ 不支持透明背景，会把等距菱形画变形，地图地块别用）" }
];
export const MINIMAX_HOST_PRESETS = [
    { id: "https://api.minimaxi.com", label: "国际站 api.minimaxi.com" },
    { id: "https://api.minimax.cn", label: "国内站 api.minimax.cn" }
];
/**
 * 视频模型下拉。优云智算版 H3 与官方 H3 是同一个模型，只是走第三方网关，
 * 所以做成一个独立的可选项——由用户显式选择，而不是从 Base URL / Key 前缀去猜。
 */
export const MINIMAX_MODEL_PRESETS = [
    { id: "MiniMax-H3", label: "MiniMax-H3（v2 · 768P/2K · 4~15 秒，推荐）" },
    { id: COMP_SHARE_MODEL_ID, label: "优云智算网关 · 768P/1080P/2K · 4~30 秒" },
    { id: "MiniMax-H3-Max", label: "MiniMax-H3-Max（v2 极速 · 480P/768P · 5~15 秒）" },
    { id: "MiniMax-Hailuo-02", label: "MiniMax-Hailuo-02（v1 · 6/10 秒）" },
    { id: "I2V-01-Director", label: "I2V-01-Director（v1 · 支持运镜指令）" },
    { id: "I2V-01", label: "I2V-01（v1）" },
    { id: "I2V-01-live", label: "I2V-01-live（v1）" }
];
function asInt(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
function asBool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function asString(value, fallback) {
    return typeof value === "string" ? value : fallback;
}
function asNumber(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
/**
 * 收敛「被隐藏的功能模块」：只留合法 key、去重，并按 `STUDIO_MODULES` 的固定
 * 顺序排列。
 *
 * 排序不是为了好看：它让「同一组勾选」永远序列化成同一份 JSON，于是界面可以
 * 用字符串比较判断「有没有变」，自检里也能直接对整份数组断言。
 * 不认识的 key 一律丢掉——旧版本配置里留着的模块名不该让整个设置页起不来。
 */
export function normalizeHiddenModules(value) {
    if (!Array.isArray(value))
        return [];
    const wanted = new Set(value.filter((key) => typeof key === "string"));
    return STUDIO_MODULES.filter((key) => wanted.has(key));
}
/** 把任意读入的 JSON 收敛成一份合法配置，缺项一律回落默认值。 */
export function normalizeConfig(input) {
    const raw = (input ?? {});
    const rowOrderRaw = Array.isArray(raw.rowOrder) ? raw.rowOrder.filter((k) => typeof k === "string") : [];
    // 一次性迁移：只有「没有版本号」的旧配置才会被迁到罗盘顺序。
    const needsOrderMigration = raw.rowOrderVersion === undefined && isLegacyRowOrder(rowOrderRaw);
    const rowOrder = rowOrderRaw.length === 0 || needsOrderMigration ? [...DEFAULT_ROW_ORDER] : rowOrderRaw;
    const keyLow = asInt(raw.keyLow, DEFAULT_CONFIG.keyLow, 0, 255);
    // 上限必须严格大于下限，否则抠像区间为空；单独改任一项时自动让路。
    const keyHigh = Math.min(255, Math.max(keyLow + 1, asInt(raw.keyHigh, DEFAULT_CONFIG.keyHigh, 1, 255)));
    // 视频参数都跟着模型走：换到 H3 之后旧的 `1080P` / `6 秒` 未必合法；
    // 选「优云智算版 H3」时档位放宽到 1080P、4~30 秒。
    const minimaxModel = asString(raw.minimaxModel, DEFAULT_CONFIG.minimaxModel);
    const minimaxBaseUrl = rootOf(asString(raw.minimaxBaseUrl, DEFAULT_CONFIG.minimaxBaseUrl)) || DEFAULT_CONFIG.minimaxBaseUrl;
    const minimaxDuration = normalizeDuration(minimaxModel, raw.minimaxDuration ?? DEFAULT_CONFIG.minimaxDuration);
    const minimaxResolution = normalizeResolution(minimaxModel, raw.minimaxResolution ?? DEFAULT_CONFIG.minimaxResolution);
    // 工作流不能为空：空工作流提交必然失败，回落内置模板比让用户对着报错发呆好。
    const comfyWorkflowRaw = asString(raw.comfyWorkflow, DEFAULT_CONFIG.comfyWorkflow);
    const comfyWorkflow = comfyWorkflowRaw.trim() === "" ? DEFAULT_CONFIG.comfyWorkflow : comfyWorkflowRaw;
    return {
        toapisBaseUrl: asString(raw.toapisBaseUrl, DEFAULT_CONFIG.toapisBaseUrl).trim(),
        toapisApiKey: asString(raw.toapisApiKey, DEFAULT_CONFIG.toapisApiKey).trim(),
        toapisImageModel: asString(raw.toapisImageModel, DEFAULT_CONFIG.toapisImageModel).trim(),
        toapisImageSize: asString(raw.toapisImageSize, DEFAULT_CONFIG.toapisImageSize).trim() || DEFAULT_CONFIG.toapisImageSize,
        toapisImageQuality: asString(raw.toapisImageQuality, DEFAULT_CONFIG.toapisImageQuality).trim(),
        toapisImageBackground: raw.toapisImageBackground === "transparent" || raw.toapisImageBackground === "opaque" ? raw.toapisImageBackground : "auto",
        toapisVideo: asBool(raw.toapisVideo, DEFAULT_CONFIG.toapisVideo),
        toapisVideoModel: asString(raw.toapisVideoModel, DEFAULT_CONFIG.toapisVideoModel).trim(),
        toapisVideoDuration: asInt(raw.toapisVideoDuration, DEFAULT_CONFIG.toapisVideoDuration, 4, 15),
        toapisVideoResolution: asString(raw.toapisVideoResolution, DEFAULT_CONFIG.toapisVideoResolution).trim(),
        toapisVideoAspectRatio: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(asString(raw.toapisVideoAspectRatio, "16:9")) ? asString(raw.toapisVideoAspectRatio, "16:9") : "16:9",
        toapisTimeoutMs: asInt(raw.toapisTimeoutMs, DEFAULT_CONFIG.toapisTimeoutMs, 10000, 3600000),
        imageProvider: raw.imageProvider === "toapis" ? "toapis" : raw.imageProvider === "custom" ? "custom" : "ark",
        customProtocol: CUSTOM_PROTOCOLS.includes(String(raw.customProtocol))
            ? raw.customProtocol
            : DEFAULT_CONFIG.customProtocol,
        customBaseUrl: asString(raw.customBaseUrl, DEFAULT_CONFIG.customBaseUrl).replace(/\/+$/, ""),
        customApiKey: asString(raw.customApiKey, DEFAULT_CONFIG.customApiKey),
        customModel: asString(raw.customModel, DEFAULT_CONFIG.customModel),
        customSize: asString(raw.customSize, DEFAULT_CONFIG.customSize).trim() || DEFAULT_CONFIG.customSize,
        customNegativePrompt: asString(raw.customNegativePrompt, DEFAULT_CONFIG.customNegativePrompt),
        customSteps: asInt(raw.customSteps, DEFAULT_CONFIG.customSteps, 1, 150),
        // 上限放到 30：有些后端把 CFG 当纯缩放用；下限 0 = 完全不看提示词（罕见但合法）。
        customCfgScale: asNumber(raw.customCfgScale, DEFAULT_CONFIG.customCfgScale, 0, 30),
        customSampler: asString(raw.customSampler, DEFAULT_CONFIG.customSampler),
        customDenoising: asNumber(raw.customDenoising, DEFAULT_CONFIG.customDenoising, 0, 1),
        // -1 是「随机」的约定值，其余收敛到 32 位无符号范围（ComfyUI 的 KSampler 是 int）。
        customSeed: asInt(raw.customSeed, DEFAULT_CONFIG.customSeed, -1, 2147483647),
        customWorkflow: asString(raw.customWorkflow, DEFAULT_CONFIG.customWorkflow),
        customTimeoutMs: asInt(raw.customTimeoutMs, DEFAULT_CONFIG.customTimeoutMs, 10000, 3600000),
        arkApiKey: asString(raw.arkApiKey, DEFAULT_CONFIG.arkApiKey),
        arkBaseUrl: asString(raw.arkBaseUrl, DEFAULT_CONFIG.arkBaseUrl).replace(/\/+$/, ""),
        arkModel: asString(raw.arkModel, DEFAULT_CONFIG.arkModel),
        arkRedrawModel: asString(raw.arkRedrawModel, DEFAULT_CONFIG.arkRedrawModel),
        arkSize: asString(raw.arkSize, DEFAULT_CONFIG.arkSize).trim() || DEFAULT_CONFIG.arkSize,
        arkWatermark: asBool(raw.arkWatermark, DEFAULT_CONFIG.arkWatermark),
        arkTimeoutMs: asInt(raw.arkTimeoutMs, DEFAULT_CONFIG.arkTimeoutMs, 10000, 900000),
        minimaxApiKey: asString(raw.minimaxApiKey, DEFAULT_CONFIG.minimaxApiKey),
        minimaxBaseUrl,
        minimaxModel,
        minimaxDuration,
        minimaxResolution,
        minimaxPromptOptimizer: asBool(raw.minimaxPromptOptimizer, DEFAULT_CONFIG.minimaxPromptOptimizer),
        minimaxTimeoutMs: asInt(raw.minimaxTimeoutMs, DEFAULT_CONFIG.minimaxTimeoutMs, 10000, 900000),
        comfyVideo: asBool(raw.comfyVideo, DEFAULT_CONFIG.comfyVideo),
        comfyBaseUrl: normalizeComfyBaseUrl(asString(raw.comfyBaseUrl, DEFAULT_CONFIG.comfyBaseUrl)),
        comfyCookies: normalizeComfyCookies(asString(raw.comfyCookies, DEFAULT_CONFIG.comfyCookies)),
        comfyWorkflow,
        comfyPromptTarget: asString(raw.comfyPromptTarget, DEFAULT_CONFIG.comfyPromptTarget).trim(),
        comfyFirstFrameTarget: asString(raw.comfyFirstFrameTarget, DEFAULT_CONFIG.comfyFirstFrameTarget).trim(),
        comfyWidth: asInt(raw.comfyWidth, DEFAULT_CONFIG.comfyWidth, 0, 4096),
        comfyHeight: asInt(raw.comfyHeight, DEFAULT_CONFIG.comfyHeight, 0, 4096),
        comfySeconds: asNumber(raw.comfySeconds, DEFAULT_CONFIG.comfySeconds, 0, 120),
        // 0 = 每次随机；生成器只在探测到 seed 输入时才会写进去。
        comfySeed: asInt(raw.comfySeed, DEFAULT_CONFIG.comfySeed, 0, 9007199254740991),
        comfyTimeoutMs: asInt(raw.comfyTimeoutMs, DEFAULT_CONFIG.comfyTimeoutMs, 10000, 3600000),
        musicProvider: "puyue",
        musicApiKey: asString(raw.musicApiKey, DEFAULT_CONFIG.musicApiKey),
        // 允许用户填本地 mock / 反代地址；去尾斜杠与误填的 /v1 在 musicapi 里再做一次。
        musicBaseUrl: asString(raw.musicBaseUrl, DEFAULT_CONFIG.musicBaseUrl).replace(/\/+$/u, "") || DEFAULT_CONFIG.musicBaseUrl,
        musicModel: asString(raw.musicModel, DEFAULT_CONFIG.musicModel).trim() || DEFAULT_CONFIG.musicModel,
        musicTimeoutMs: asInt(raw.musicTimeoutMs, DEFAULT_CONFIG.musicTimeoutMs, 10000, 900000),
        musicPollTimeoutMs: asInt(raw.musicPollTimeoutMs, DEFAULT_CONFIG.musicPollTimeoutMs, 60000, 3600000),
        musicPythonPath: asString(raw.musicPythonPath, DEFAULT_CONFIG.musicPythonPath).trim(),
        musicFluidsynthPath: asString(raw.musicFluidsynthPath, DEFAULT_CONFIG.musicFluidsynthPath).trim(),
        musicSoundfontPath: asString(raw.musicSoundfontPath, DEFAULT_CONFIG.musicSoundfontPath).trim(),
        sfxProvider: "volcengine",
        sfxApiKey: asString(raw.sfxApiKey, DEFAULT_CONFIG.sfxApiKey),
        // 允许本地 mock / 反代；完整端点 / /api/v3 的误填在 sfxapi 里再剥一次。
        sfxBaseUrl: asString(raw.sfxBaseUrl, DEFAULT_CONFIG.sfxBaseUrl).replace(/\/+$/u, "") || DEFAULT_CONFIG.sfxBaseUrl,
        sfxModel: asString(raw.sfxModel, DEFAULT_CONFIG.sfxModel).trim() || DEFAULT_CONFIG.sfxModel,
        sfxFormat: sfxFormatOrDefault(raw.sfxFormat),
        sfxSampleRate: sfxSampleRateOrDefault(raw.sfxSampleRate),
        sfxTimeoutMs: asInt(raw.sfxTimeoutMs, DEFAULT_CONFIG.sfxTimeoutMs, 30000, 900000),
        cellWidth: asInt(raw.cellWidth, DEFAULT_CONFIG.cellWidth, 16, 2048),
        cellHeight: asInt(raw.cellHeight, DEFAULT_CONFIG.cellHeight, 16, 2048),
        frameCount: asInt(raw.frameCount, DEFAULT_CONFIG.frameCount, 1, 64),
        fitMode: raw.fitMode === "stretch" ? "stretch" : "contain",
        workingLongEdge: asInt(raw.workingLongEdge, DEFAULT_CONFIG.workingLongEdge, 128, 2048),
        pixelSize: asInt(raw.pixelSize, DEFAULT_CONFIG.pixelSize, 0, 32),
        autoCrop: asBool(raw.autoCrop, DEFAULT_CONFIG.autoCrop),
        fillRatio: asNumber(raw.fillRatio, DEFAULT_CONFIG.fillRatio, 0.5, 1),
        bottomMargin: asInt(raw.bottomMargin, DEFAULT_CONFIG.bottomMargin, 0, 64),
        cropInset: asNumber(raw.cropInset, DEFAULT_CONFIG.cropInset, 0, 0.2),
        keyColor: normalizeKeyColor(raw.keyColor, DEFAULT_CONFIG.keyColor),
        keyLow,
        keyHigh,
        despill: asNumber(raw.despill, DEFAULT_CONFIG.despill, 0, 1),
        bgTolerance: asInt(raw.bgTolerance, DEFAULT_CONFIG.bgTolerance, 0, 160),
        edgeShrink: asInt(raw.edgeShrink, DEFAULT_CONFIG.edgeShrink, 0, 8),
        rowOrder,
        rowOrderVersion: ROW_ORDER_VERSION,
        hiddenModules: normalizeHiddenModules(raw.hiddenModules),
        concurrency: asInt(raw.concurrency, DEFAULT_CONFIG.concurrency, 1, 8)
    };
}
let cache;
export async function loadConfig() {
    if (cache !== undefined)
        return cache;
    try {
        const text = await readFile(configPath(), "utf8");
        cache = normalizeConfig(JSON.parse(text));
    }
    catch {
        cache = { ...DEFAULT_CONFIG, rowOrder: [...DEFAULT_ROW_ORDER], hiddenModules: [] };
    }
    return cache;
}
export async function saveConfig(patch) {
    const current = await loadConfig();
    const next = normalizeConfig({ ...current, ...patch });
    await mkdir(dataRoot(), { recursive: true });
    const target = configPath();
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmp, target);
    cache = next;
    return next;
}
export function maskConfig(config) {
    const { toapisApiKey, arkApiKey, minimaxApiKey, customApiKey, comfyCookies, musicApiKey, sfxApiKey, ...rest } = config;
    const cookie = normalizeComfyCookies(comfyCookies);
    return {
        ...rest,
        rowOrder: [...config.rowOrder],
        // 复制一份再回传：界面改勾选后会把它当草稿改，共享同一个数组会互相写花。
        hiddenModules: [...config.hiddenModules],
        toapisApiKeySet: toapisApiKey.trim() !== "",
        toapisApiKeyHint: hintOf(toapisApiKey),
        arkApiKeySet: arkApiKey.trim() !== "",
        arkApiKeyHint: hintOf(arkApiKey),
        minimaxApiKeySet: minimaxApiKey.trim() !== "",
        minimaxApiKeyHint: hintOf(minimaxApiKey),
        customApiKeySet: customApiKey.trim() !== "",
        customApiKeyHint: hintOf(customApiKey),
        // Cookie 也是凭据（反代鉴权），同样不回传明文：只说配没配、尾巴 4 位。
        comfyCookiesSet: cookie !== "",
        comfyCookiesHint: hintOf(cookie),
        musicApiKeySet: musicApiKey.trim() !== "",
        musicApiKeyHint: hintOf(musicApiKey),
        sfxApiKeySet: sfxApiKey.trim() !== "",
        sfxApiKeyHint: hintOf(sfxApiKey)
    };
}
function hintOf(key) {
    const trimmed = key.trim();
    if (trimmed === "")
        return "";
    if (trimmed.length <= 8)
        return "已配置";
    return `…${trimmed.slice(-4)}`;
}
