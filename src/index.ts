import {assertVideoBackendReady,videoBackendOf} from "./videogen.js";
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
import { createReadStream, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { appendJobLog } from "./jsonio.js";
import { ARK_MODEL_PRESETS, CUSTOM_PROTOCOLS, CUSTOM_PROTOCOL_DEFAULTS, DEFAULT_CONFIG, ROW_ORDER_VERSION, MINIMAX_HOST_PRESETS, MINIMAX_MODEL_PRESETS, loadConfig, maskConfig, migrateLegacyDataRoot, projectsRoot, saveConfig } from "./config.js";
import {
  DEFAULT_ROW_ORDER,
  DIRECTION_KEYS,
  TURN_DIRECTION_DEFAULT,
  TURN_FRAME_COUNT_MAX,
  TURN_FRAME_COUNT_MIN,
  defaultPrompts,
  directionOf,
  localizePrompts,
  applyKeyColorToPrompts,
  normalizePromptLang
} from "./directions.js";
import { DEFAULT_KEY_COLOR, normalizeKeyColor } from "./keycolor.js";
import { checkFfmpeg } from "./media.js";
import { testArk } from "./ark.js";
import { customImageBlocker, imageModelOf, imageSizeOf, imageProviderBlocker, imageProviderSummary, testCustomImage } from "./imageprovider.js";
import {
  detectComfyBindings,
  fetchComfyObjectInfo,
  formatBinding,
  normalizeComfyBaseUrl,
  normalizeComfyCookies,
  parseComfyWorkflow,
  testComfy
} from "./comfy.js";
import {
  COMP_SHARE_BASE_URL,
  COMP_SHARE_MODEL_ID,
  capabilityOf,
  isCompshareModel,
  normalizeDuration,
  normalizeResolution,
  pathPrefixOf,
  testMiniMax
} from "./minimax.js";
import {
  activatePipeline,
  applyTurnPicks,
  clearVideos,
  disposePipeline,
  ensurePoller,
  exportImages,
  importLocalVideo,
  listJobs,
  pollVideosOnce,
  resetFramePicks,
  resetTurnPicks,
  setFramePick,
  setFramePicks,
  setImageMode,
  setTurnPick,
  setTurnPicks,
  startAllImages,
  startCompose,
  startFramePick,
  startExtract,
  startImage,
  startRekey,
  startTurnFrames,
  startTurnVideo,
  startVideos
} from "./pipeline.js";
import { assetPath, createProject, deleteProject, listProjects, log, patchProject, projectDir, projectExists, readProject, resetDerivedFromSource, } from "./store.js";
import * as imagegen from "./imagegen.js";
import * as seqgen from "./seqgen.js";
import * as riggen from "./riggen.js";
import * as isogen from "./isogen.js";
import * as mapgen from "./mapgen.js";
import * as musicgen from "./musicgen.js";
import * as sfxgen from "./sfxgen.js";
import { musicGuidePayload } from "./musicguide.js";
import { musicScoreGuidePayload } from "./musicscoreguide.js";
import { clearScoreDepsCache, detectScoreDeps } from "./musicscore.js";
import { musicBlocker, musicEngineSummary, testMusicConnection } from "./musicapi.js";
import { SFX_FORMATS, SFX_LIMITS, SFX_SAMPLE_RATES, sfxBlocker, testSfxConnection } from "./sfxapi.js";
import { MANIFEST, METHODS, SERVICE_NAME } from "./wire.js";
import { assetBasePath, originForLinks, rememberClientOrigin } from "./links.js";
import { registerStudioTools } from "./tools.js";
/**
 * 游戏素材大师 —— 宿主半区。
 *
 * 一个 Typert 远程服务（"gameStudio"）承载八个功能模块的控制面：
 *   ① 八方向图生成  ② 图片生成  ③ 序列帧生成  ④ 骨骼动画生成  ⑤ 地图地块生成
 * 八者共用同一套配置（各平台的 API Key / 模型 / 抠像默认值），但各自独立存项目 / 任务。
 *
 * 另外用 `ctx.webServer` 注册一条 prefix 路由，把各模块的产物直接发给浏览器。
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
 * 如果没有真正重新 import，这里的数值就还是旧的。于是 `GET
 * /dsh-game-material-master/_health` 变成一条**廉价且确定**的探针——
 * 用来回答「运行中的宿主到底吃到了哪一版代码」，而不用去猜。
 *
 * ⚠️ 别只看 `moduleMtimeMs`：`tsc` 对**内容没变**的输出文件不重写，所以只改
 * `riggen.js` 时 `index.js` 的 mtime 纹丝不动——曾经拿它当探针，结果误判成
 * 「宿主没重载」而多花了一次付费调用。`builtAtMs` 取的是**整个产物目录里最新的
 * 那个 mtime**，任何一次 build 都会让它前进。
 */
const BOOT_INFO: { module?: string; moduleMtimeMs?: number; builtAtMs?: number; bootedAt: number } = (() => {
  const info: { module?: string; moduleMtimeMs?: number; builtAtMs?: number; bootedAt: number } = { bootedAt: Date.now() };
  try {
    const self = fileURLToPath(import.meta.url);
    info.module = basename(self);
    info.moduleMtimeMs = statSync(self).mtimeMs;
    // 同目录下所有构建产物的最新 mtime。
    let newest = info.moduleMtimeMs;
    for (const entry of readdirSync(dirname(self))) {
      if (!entry.endsWith(".js")) continue;
      try {
        const stamp = statSync(join(dirname(self), entry)).mtimeMs;
        if (stamp > newest) newest = stamp;
      } catch {
        /* 单个文件读不到就跳过 */
      }
    }
    info.builtAtMs = newest;
  } catch {
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
  // 音乐模块（模块七）：音频 / 工具产物。少了这些，浏览器会把音频当 octet-stream，
  // <audio> 的拖动进度与时长都可能异常。
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".py": "text/x-python; charset=utf-8",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8",
  ".musicxml": "application/vnd.recordare.musicxml+xml; charset=utf-8",
  ".lrc": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // 模块六的导出包：`.zip` 少了这一条会掉进 octet-stream —— 浏览器照样存得下来，
  // 但少了这个类型，某些浏览器/壳会把「另存为」的默认扩展名写错。
  ".zip": "application/zip",
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
/** 工具面路径导入：宿主读盘、按文件头嗅探，返回 base64（供 import* 复用）。 */
async function readImageBase64FromPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`不是文件：${absolute}`);
  if (info.size > 30 * 1024 * 1024) throw new Error(`素材图 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过 30MB 上限：${absolute}`);
  const base64 = (await readFile(absolute)).toString("base64");
  if (sniffImage(base64) === undefined) throw new Error(`无法识别的图片格式（支持 PNG / JPEG / WebP / GIF / BMP）：${absolute}`);
  return base64;
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
      /**
       * 生图后端的呈现材料。
       *
       * `imageProviderBlocker` 由宿主算好回传，界面与**对话工具面**共用同一份判断
       * （tools.ts 的 intake 也读它）：两边各写一套「配好了没」的规则，
       * 迟早会出现「界面说没配好、模型说配好了」这种互相矛盾的提示。
       */
      customProtocols: CUSTOM_PROTOCOLS.map((key) => ({
        id: key,
        label: CUSTOM_PROTOCOL_DEFAULTS[key].label,
        baseUrl: CUSTOM_PROTOCOL_DEFAULTS[key].baseUrl,
        hint: CUSTOM_PROTOCOL_DEFAULTS[key].hint
      })),
      imageProviderSummary: imageProviderSummary(config),
      /** 当前生效的生图模型（模块里那个只读展示位用它，比 summary 短）。 */
      imageModel: imageModelOf(config),
      imageProviderSize: imageSizeOf(config),
      videoProviderBackend: videoBackendOf(config),
      videoProviderModel: videoBackendOf(config) === "toapis" ? config.toapisVideoModel : config.minimaxModel,
      videoProviderBaseUrl: videoBackendOf(config) === "toapis" ? config.toapisBaseUrl : videoBackendOf(config) === "comfy" ? config.comfyBaseUrl : config.minimaxBaseUrl,
      videoProviderBlocker: (()=>{try {assertVideoBackendReady(config);return null;}catch(error){return (error as Error).message;}})(),
      imageProviderBlocker: imageProviderBlocker(config) ?? null,
      customImageBlocker: customImageBlocker(config) ?? null,
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
      /** 音乐生成编辑（模块七）：引擎/模型预设、Key 阻塞原因、文档地址。 */
      musicEngines: musicEngineSummary(),
      musicBlocker: musicBlocker(config) ?? null,
      /** 音效生成（模块八，火山引擎 Seed-Audio）：格式/采样率/限制与 Key 阻塞原因。 */
      sfxBlocker: sfxBlocker(config) ?? null,
      sfxFormats: SFX_FORMATS.map((format) => ({
        id: format,
        label:
          format === "mp3"
            ? "MP3（体积小，适合预览 / 网页）"
            : format === "wav"
              ? "WAV（无损，游戏引擎常用）"
              : "Ogg Opus（体积更小）"
      })),
      sfxSampleRates: [...SFX_SAMPLE_RATES],
      sfxLimits: { ...SFX_LIMITS },
      sfxModelPresets: [
        { id: "seed-audio-1.0", label: "seed-audio-1.0（默认 · 音效 / 环境音 / 角色配音）" }
      ],
      sfxDocsUrl: "https://docs.volcengine.com/docs/DoubaoVoice/audio-generation-http",
      sfxConsoleUrl: "https://console.volcengine.com/speech/new/setting/apikeys",
      /** 谱曲模式依赖（Python / scoremill / FluidSynth / SoundFont / ffmpeg）。 */
      musicScoreStatus: await detectScoreDeps(config),
      musicDocsUrl: "https://api.yourmusic.fun/docs",
      musicConsoleUrl: "https://api.yourmusic.fun/dashboard",
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
  * 约定：`arkApiKey` / `minimaxApiKey` / `customApiKey` **只有用户确实改了才带**——
  * 不带就是保持原值，带空串才是清除。这样界面就不必把明文 key 回填到输入框里。
  */
  async saveConfig(payload) {
    const input = asRecord(payload);
    const patch: any = {};
    const directKeys = [
      "toapisBaseUrl",
      "toapisImageModel",
      "toapisImageSize",
      "toapisImageQuality",
      "toapisImageBackground",
      "toapisVideo",
      "toapisVideoModel",
      "toapisVideoDuration",
      "toapisVideoResolution",
      "toapisVideoAspectRatio",
      "toapisTimeoutMs",
      "imageProvider",
      "customProtocol",
      "customBaseUrl",
      "customModel",
      "customSize",
      "customNegativePrompt",
      "customSteps",
      "customCfgScale",
      "customSampler",
      "customDenoising",
      "customSeed",
      "customWorkflow",
      "customTimeoutMs",
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
      // 本地 ComfyUI 后端（videogen.ts 按 comfyVideo 分派）。
      "comfyVideo",
      "comfyBaseUrl",
      "comfyWorkflow",
      "comfyPromptTarget",
      "comfyFirstFrameTarget",
      "comfyWidth",
      "comfyHeight",
      "comfySeconds",
      "comfySeed",
      "comfyTimeoutMs",
      // 音乐生成编辑（模块七）。Key 不进这里（见下面单独处理）。
      "musicProvider",
      "musicBaseUrl",
      "musicModel",
      "musicTimeoutMs",
      "musicPollTimeoutMs",
      // 谱曲模式依赖路径（空 = 自动探测）。
      "musicPythonPath",
      "musicFluidsynthPath",
      "musicSoundfontPath",
      // 音效生成（模块八）。Key 同样不进这里（见下面单独处理）。
      "sfxProvider",
      "sfxBaseUrl",
      "sfxModel",
      "sfxFormat",
      "sfxSampleRate",
      "sfxTimeoutMs",
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
      "keyColor",
      "keyLow",
      "keyHigh",
      "despill",
      "bgTolerance",
      "edgeShrink",
      "rowOrder",
      "concurrency",
      // 功能可见性：设置页的「功能管理」写它，`normalizeConfig` 会收敛成合法子集。
      // 对话工具面**不允许**改它（见 tools.ts），否则模型可以自己把隐藏的功能放出来。
      "hiddenModules"
    ];
    for (const key of directKeys) {
      if (input[key] !== undefined)
        patch[key] = input[key];
    }
    if (typeof input.toapisApiKey === "string") patch.toapisApiKey = input.toapisApiKey.trim();
    if (input.clearToapisApiKey === true) patch.toapisApiKey = "";
    if (typeof input.arkApiKey === "string")
      patch.arkApiKey = input.arkApiKey.trim();
    if (typeof input.minimaxApiKey === "string")
      patch.minimaxApiKey = input.minimaxApiKey.trim();
    if (typeof input.customApiKey === "string")
      patch.customApiKey = input.customApiKey.trim();
    // 音乐模块的 Key 与其它凭据同一套约定：不带 = 保持原值，带串 = 覆盖。
    if (typeof input.musicApiKey === "string")
      patch.musicApiKey = input.musicApiKey.trim();
    // 音效模块的 Key 是**语音控制台**的 API Key（X-Api-Key），与方舟 Key 不同源。
    if (typeof input.sfxApiKey === "string")
      patch.sfxApiKey = input.sfxApiKey.trim();
    if (input.clearArkApiKey === true)
      patch.arkApiKey = "";
    if (input.clearMinimaxApiKey === true)
      patch.minimaxApiKey = "";
    if (input.clearCustomApiKey === true)
      patch.customApiKey = "";
    if (input.clearMusicApiKey === true)
      patch.musicApiKey = "";
    if (input.clearSfxApiKey === true)
      patch.sfxApiKey = "";
    // ComfyUI 的 Cookie 也是凭据，与 API Key 同一套约定：不带 = 保持原值，带串 = 覆盖，
    // clearComfyCookies = 清空。它**不进** directKeys——那里是原样透传，Cookie 要先归一化。
    if (typeof input.comfyCookies === "string")
      patch.comfyCookies = normalizeComfyCookies(input.comfyCookies);
    if (input.clearComfyCookies === true)
      patch.comfyCookies = "";
    const saved = await saveConfig(patch);
    this.ffmpegCache = undefined;
    // 谱曲依赖路径可能变了；下一次 getConfig / testMusicScore 重新探测。
    clearScoreDepsCache();
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
  /** 测自定义生图后端。与 testArk 对称，各自测各自那一组配置。 */
  async testCustomImage() {
    return testCustomImage();
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
   * 【本地 ComfyUI】连接自检：读 `/system_stats` 与 `/queue`，不排队生图，不产生费用。
   *
   * 顺带报一次「工作流里探测到的注入点」——设置页只填 URL 和工作流，绑定对不对
   * 全靠这一步看得见；后面生成时用的就是同一套探测。
   */
  async testComfy() {
    const config = await loadConfig();
    const status = await testComfy({
      baseUrl: config.comfyBaseUrl,
      timeoutMs: config.comfyTimeoutMs,
      cookies: config.comfyCookies
    });
    let nodes = 0;
    let bindings: Record<string, string> | undefined;
    let notes: string[] = [];
    const parsed = parseComfyWorkflow(config.comfyWorkflow);
    if (parsed.ok === true) {
      nodes = parsed.nodes;
      // 连节点定义一起查：这样预览里能看到「工作流里没连、但接得下 IMAGE」的首帧注入点，
      // 与真正提交时的探测口径完全一致。
      const info = await fetchComfyObjectInfo(
        { baseUrl: config.comfyBaseUrl, timeoutMs: config.comfyTimeoutMs, cookies: config.comfyCookies },
        Object.keys(parsed.workflow).map((id) => parsed.workflow[id]?.class_type ?? "")
      ).catch(() => undefined);
      const detected = detectComfyBindings(
        parsed.workflow,
        {
          prompt: config.comfyPromptTarget,
          first: config.comfyFirstFrameTarget
        },
        info
      );
      bindings = {
        prompt: formatBinding(detected.bindings.prompt),
        first: formatBinding(detected.bindings.first),
        last: formatBinding(detected.bindings.last),
        width: formatBinding(detected.bindings.width),
        height: formatBinding(detected.bindings.height),
        seconds: formatBinding(detected.bindings.seconds),
        seed: formatBinding(detected.bindings.seed)
      };
      notes = detected.notes;
      // 界面格式（官方示例工作流就是这种）会在解析时自动转成 API 格式，这一步说出来，
      // 免得用户以为自己粘错了。
      if (parsed.converted === true) {
        notes = [`检测到 ComfyUI 界面格式的工作流，已自动转成 API 格式（${parsed.nodes} 个节点）。`, ...notes];
        if ((parsed.droppedWidgets ?? 0) > 0)
          notes.push(
            `有 ${parsed.droppedWidgets} 个控件值没能对应到输入名（这份工作流导出的版本比较老）。建议在 ComfyUI 里用「工作流 → 导出(API) / Save (API Format)」重新导出。`
          );
      }
    } else {
      notes = [`工作流无法解析：${parsed.error}`];
    }
    return {
      baseUrl: normalizeComfyBaseUrl(config.comfyBaseUrl),
      version: status.version,
      device: status.device ?? "",
      queueRunning: status.queueRunning,
      queuePending: status.queuePending,
      nodes,
      bindings,
      notes
    };
  }
  /**
   * 【谱乐 AI】连接自检：读一页历史，不生成、不排队、不扣生成积分。
   * 402 视为「Key 有效但积分不足」，由 `testMusicConnection` 用 warning 表达。
   */
  async testMusic() {
    const config = await loadConfig();
    if (config.musicApiKey.trim() === "") throw new Error("尚未配置谱乐 AI API Key");
    const result = await testMusicConnection({
      baseUrl: config.musicBaseUrl,
      apiKey: config.musicApiKey,
      timeoutMs: config.musicTimeoutMs
    });
    return {
      ...result,
      baseUrl: config.musicBaseUrl,
      model: config.musicModel
    };
  }
  /**
   * 【火山引擎 Seed-Audio】连接自检：真实生成一条极短音效。
   *
   * 没有免费的探活端点；读历史 / 模型列表都不能证明「Key 能生成」。设置页按钮
   * 必须写明会产生少量费用。
   */
  async testSfx() {
    const config = await loadConfig();
    const blocker = sfxBlocker(config);
    if (blocker !== undefined) throw new Error(blocker);
    const result = await testSfxConnection({
      baseUrl: config.sfxBaseUrl,
      apiKey: config.sfxApiKey,
      model: config.sfxModel,
      timeoutMs: Math.min(config.sfxTimeoutMs, 180000)
    });
    return {
      ...result,
      baseUrl: config.sfxBaseUrl,
      model: config.sfxModel
    };
  }
  /**
   * 浏览器半区上报自己的 `location.origin` 与应用路径前缀。
   *
   * 宿主不知道对外 origin（可能被反代改写），而模型要在回复里贴可点链接，
   * 只能由页面自己报一次。`path` 是 DSH 0.2.1 `--public-url` 的路径前缀
   * （例如挂在 `https://host/prefix/` 时是 `/prefix`），宿主据此拼回链与
   * 产物地址。返回体里回带上「认没认」，方便界面自检。
   */
  async reportClientOrigin(payload) {
    const input = asRecord(payload);
    const origin = asString(input.origin);
    const path = typeof input.path === "string" ? input.path : undefined;
    const accepted = rememberClientOrigin(origin, path);
    return accepted ? { ok: true, origin, path: path ?? "" } : { ok: false, message: `拒绝非 http(s) origin：${origin}` };
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
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    // 界面语言由浏览器半区带过来（宿主没有 locale 服务）。带上它，内置默认提示词
    // 才会跟着 DSH 的语言走——只有「从没被改过」的那些会被换成目标语言的默认值。
    const lang = input.lang === undefined ? undefined : normalizePromptLang(input.lang);
    let project = await readProject(projectId);
    if (project === undefined)
      throw new Error(`项目不存在：${projectId}`);
    // 底色也是项目级设置：没在项目里显式改过时跟随全局配置。
    const config = await loadConfig();
    const effectiveKeyColor = project.settings.keyColorOverride === true ? project.settings.keyColor : config.keyColor;
    const effectiveChanged = project.settings.keyColor !== effectiveKeyColor;
    if (effectiveChanged) project.settings.keyColor = effectiveKeyColor;
    // 读项目时把「仍是默认句式」的提示词同步到它的底色，这样老项目 / 刚改过底色的
    // 项目在界面上看到的就是生成时会用的那一版。
    const colorChanged = applyKeyColorToPrompts(project.prompts, effectiveKeyColor);
    const localized = lang !== undefined ? localizePrompts(project.prompts, lang, effectiveKeyColor) : false;
    if (colorChanged || localized || effectiveChanged) {
      project = await patchProject(projectId, (draft) => {
        draft.settings.keyColor = effectiveKeyColor;
        applyKeyColorToPrompts(draft.prompts, effectiveKeyColor);
        if (lang !== undefined) localizePrompts(draft.prompts, lang, effectiveKeyColor);
        return draft;
      });
    }
    return {
      ...project,
      jobs: listJobs(projectId),
      assetBase: assetBasePath(`${ROUTE_PREFIX}/assets/${projectId}/`)
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
    // 换了源图 = 阶段①重来：八个方向图 / 转圈视频 / 候选帧 / 阶段②③④的产物
    // 都是上一张图跑出来的。不清掉的话 turnFirstFrame() 会继续拿旧的方向图当首帧，
    // 新源图根本进不了模型——表现就是「换了源图，生成结果一点没变」。
    const discarded = await resetDerivedFromSource(projectId);
    return { ok: true, file: relative, name: originalName, discarded };
  }
  /**
   * 选用一段**本地视频**（用户自己选的，不走远程生成）。
   *
   * `key` 是槽位：`turn`（转圈视频）或八个方向之一的 key。远端生成与本地导入
   * 产出的节点完全同形，所以阶段 3、4 不必区分；转圈模式在导入后会自动抽候选帧。
   */
  async uploadVideo(payload) {
    const input = asRecord(payload);
    return importLocalVideo(
      asString(input.projectId),
      asString(input.key),
      asString(input.name, "local-video"),
      asString(input.data)
    );
  }
  /** 把项目里所有中间图片打成一个 zip（落在 `out/` 下，返回相对路径给界面下载）。 */
  async exportImages(payload) {
    const projectId = asString(asRecord(payload).projectId);
    const pack = await exportImages(projectId);
    const project = await readProject(projectId);
    return {
      ...pack,
      assetBase: assetBasePath(`${ROUTE_PREFIX}/assets/${projectId}/`),
      name: project?.name ?? projectId
    };
  }
  async savePrompts(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const images = input.images === undefined ? undefined : asRecord(input.images);
    const video = typeof input.video === "string" ? input.video : undefined;
    const turn = typeof input.turn === "string" ? input.turn : undefined;
    const perDirection = input.videoPerDirection === undefined ? undefined : asRecord(input.videoPerDirection);
    const resetImages = input.resetImagesToDefault === true;
    const resetVideo = input.resetVideoToDefault === true;
    const resetTurn = input.resetTurnToDefault === true;
    // 「重置为默认」要重置成**当前界面语言**的默认值，否则英文界面点一下会掉出中文提示词。
    const configured = await loadConfig();
    const projectForColor = await readProject(projectId);
    const effectiveKeyColor = projectForColor?.settings?.keyColorOverride === true
      ? projectForColor.settings.keyColor
      : configured.keyColor;
    const defaults = defaultPrompts(normalizePromptLang(input.lang), effectiveKeyColor);
    await patchProject(projectId, (project) => {
      // 提示词模板升级后（例如这次把方位语义改对），老项目要能一键重新套用默认值。
      if (resetImages)
        project.prompts.images = defaults.images;
      if (resetVideo) {
        project.prompts.video = defaults.video;
        project.prompts.videoPerDirection = {};
      }
      if (resetTurn)
        project.prompts.turn = defaults.turn;
      if (turn !== undefined && turn.trim() !== "")
        project.prompts.turn = turn;
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
    const config = await loadConfig();
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
        keyColor: normalizeKeyColor(raw.keyColor, current.keyColor),
        keyColorOverride: raw.keyColor === undefined
          ? current.keyColorOverride === true
          : normalizeKeyColor(raw.keyColor, current.keyColor) !== config.keyColor,
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
        concurrency: clampInt(raw.concurrency, current.concurrency, 1, 8),
        turnFrameCount: clampInt(raw.turnFrameCount, current.turnFrameCount, TURN_FRAME_COUNT_MIN, TURN_FRAME_COUNT_MAX)
      };
      if (project.settings.rowOrder.length === 0)
        project.settings.rowOrder = [...DEFAULT_ROW_ORDER];
      if (project.settings.keyHigh <= project.settings.keyLow)
        project.settings.keyHigh = Math.min(255, project.settings.keyLow + 1);
      // 改底色时，把「还是默认句式」的提示词一起换过去；用户手改过一个字都不动。
      if (before.keyColor !== project.settings.keyColor)
        applyKeyColorToPrompts(project.prompts, project.settings.keyColor);
      const differs = (fields) => fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(project.settings[field]));
      if (differs(["workingLongEdge", "cropInset"])) {
        // 抽帧参数变了：raw.bin 已经作废，必须重抽，不能只重新合成。
        for (const key of DIRECTION_KEYS) {
          const node = project.frames[key];
          if (node?.raw !== undefined)
            node.stale = true;
        }
      }
      // 转圈模式的工作尺寸/裁剪同理：候选帧是在旧参数下抽的，八个方向图也得跟着重切。
      if (differs(["workingLongEdge", "cropInset", "turnFrameCount"]) && project.turn?.frames?.raw !== undefined) {
        project.turn.frames.stale = true;
        return { compose: differs(COMPOSE_SETTINGS), returnTurn: true };
      }
      return { compose: differs(COMPOSE_SETTINGS), returnTurn: false };
    });
    // 改行序、格子尺寸、抠像参数……都会让已经生成的整图失效。这里自动重跑一次
    // 合成，否则整图/预览会和设置对不上（按新行号去切旧图 → 取到错误的方向）。
    if (changed.compose === true) {
      const fresh = await readProject(projectId);
      const hasFrames = fresh !== undefined && DIRECTION_KEYS.some((key) => fresh.frames[key]?.raw !== undefined);
      if (hasFrames)
        startCompose(projectId);
    }
    // 转圈候选帧的参数变了就自动重抽：ffmpeg 在本机跑、不花钱，重抽比等用户
    // 自己发现「轴上的圆圈对不上画面了」要省事得多。
    if (changed.returnTurn === true) {
      const fresh = await readProject(projectId);
      if (fresh?.turn?.video?.file !== undefined)
        startTurnFrames(projectId, fresh.settings.turnFrameCount);
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
      if (job === undefined) throw new Error(`任务不存在：${id}`);
      job.reviewMode = reviewMode;
      await imagegen.writeImageJob(job);
      return { ok: true, id, module, reviewMode };
    }
    if (module === "sequence") {
      const job = await seqgen.readSequenceJob(id);
      if (job === undefined) throw new Error(`任务不存在：${id}`);
      job.reviewMode = reviewMode;
      await seqgen.writeSequenceJob(job);
      return { ok: true, id, module, reviewMode };
    }
    // 骨骼动画：模块四的 RigJob 也有 reviewMode 字段，但早期版本的这里与 wire 的
    // module 枚举都漏了 rig —— 于是「固定流程第 0 步必须问清审核模式」这条规则对
    // 骨骼动画根本落不了地（走到这里会抛「未知模块：rig」）。
    if (module === "rig") {
      const job = await riggen.readRigJob(id);
      if (job === undefined) throw new Error(`任务不存在：${id}`);
      job.reviewMode = reviewMode;
      await riggen.writeRigJob(job);
      return { ok: true, id, module, reviewMode };
    }
    // 45° 地图编辑器（模块五 · iso）。与模块六同一套「固定流程第 0 步问审核模式」。
    if (module === "iso") {
      await isogen.patchIsoProject(id, (project) => {
        project.reviewMode = reviewMode;
      });
      return { ok: true, id, module, reviewMode };
    }
    // 地图编辑器（模块六）。**别重犯 rig / tile 那两个漏**：wire 的 module 枚举
    // 与这里必须成对加，否则「固定流程第 0 步必须问清审核模式」对 map 落不了地。
    if (module === "map") {
      // 同样走带写队列的 `patchMapProject`：地图文档的防抖落盘也在同一条队列上。
      await mapgen.patchMapProject(id, (project) => {
        project.reviewMode = reviewMode;
        appendJobLog(project.logs, "info", `审核模式：${reviewMode === "manual" ? "每一步人工审核" : "agent 自动审核"}`);
      });
      return { ok: true, id, module, reviewMode };
    }
    // 音乐生成编辑（模块七）。**别重犯 rig / tile / map 那三个漏**：wire 的
    // module 枚举、tools 的模块表与这里必须成对加。
    if (module === "music") {
      await musicgen.patchMusicJob(id, (job) => {
        job.reviewMode = reviewMode;
        musicgen.musicLog(job, "info", `审核模式：${reviewMode === "manual" ? "每一步人工审核" : "agent 自动审核"}`);
      });
      return { ok: true, id, module, reviewMode };
    }
    // 音效生成（模块八）。同样：wire 的 module 枚举、tools 的模块表与这里必须成对加。
    if (module === "sfx") {
      await sfxgen.patchSfxJob(id, (job) => {
        job.reviewMode = reviewMode;
        sfxgen.sfxLog(job, "info", `审核模式：${reviewMode === "manual" ? "每一步人工审核" : "agent 自动审核"}`);
      });
      return { ok: true, id, module, reviewMode };
    }
    throw new Error(`未知模块：${module}`);
  }

  // ── 45° 地图编辑器（模块五 · iso）──────────────────────────────────────
  async listIsoProjects() {
    return { projects: await isogen.listIsoProjects() };
  }
  async createIsoProject(payload: any) {
    const input = asRecord(payload);
    const project = await isogen.createIsoProject(asString(input.name, "未命名地图"), {
      cell: input.cell,
      cols: typeof input.cols === "number" ? input.cols : undefined,
      rows: typeof input.rows === "number" ? input.rows : undefined,
      wrap: typeof input.wrap === "boolean" ? input.wrap : undefined
    });
    return isogen.isoView(project);
  }
  async getIsoProject(payload: any) {
    const project = await isogen.readIsoProject(asString(asRecord(payload).projectId));
    if (project === undefined) throw new Error("项目不存在");
    return isogen.isoView(project);
  }
  async saveIsoProject(payload: any) {
    const input = asRecord(payload);
    return isogen.saveIsoProject(asString(input.projectId), {
      name: typeof input.name === "string" ? input.name : undefined,
      wrap: typeof input.wrap === "boolean" ? input.wrap : undefined
    });
  }
  async deleteIsoProject(payload: any) {
    const id = asString(asRecord(payload).projectId);
    await isogen.deleteIsoProject(id);
    return { ok: true };
  }
  async importIsoTileset(payload: any) {
    const input = asRecord(payload);
    const data = asString(input.path) !== "" ? await readImageBase64FromPath(asString(input.path)) : asString(input.data);
    if (data === "") throw new Error("importIsoTileset 需要 data（base64）或 path（本机绝对路径）。");
    const result = await isogen.importIsoTileset(asString(input.projectId), asString(input.name), data, {
      kind: input.kind,
      sourceCell: input.sourceCell as any,
      animRows: input.animRows,
      frames: input.frames,
      fps: input.fps,
      loop: input.loop,
      clarity: input.clarity,
      footprint: input.footprint,
      anchor: input.anchor,
      objectScale: input.objectScale,
      pass: input.pass,
      keyGreen: input.keyGreen,
      keyColor: typeof input.keyColor === "string" && input.keyColor.trim() !== "" ? input.keyColor : (await loadConfig()).keyColor
    });
    const project = await isogen.readIsoProject(asString(input.projectId));
    const revisions = await isogen.tilesetRevisions(asString(input.projectId));
    return { tilesets: result.tilesets.map((tileset) => isogen.isoTilesetBrief(tileset, revisions.get(tileset.id), project?.tilesets)), warnings: result.warnings };
  }
  async importIsoSampleTileset(payload: any) {
    const result = await isogen.importIsoSampleTileset(asString(asRecord(payload).projectId));
    const project = await isogen.readIsoProject(asString(asRecord(payload).projectId));
    const revisions = await isogen.tilesetRevisions(asString(asRecord(payload).projectId));
    return { tilesets: result.tilesets.map((tileset) => isogen.isoTilesetBrief(tileset, revisions.get(tileset.id), project?.tilesets)), warnings: result.warnings };
  }
  async composeIsoAsset(payload: any) {
    const input = asRecord(payload);
    const config = await loadConfig();
    return isogen.composeIsoAsset({
      projectId: asString(input.projectId),
      name: asString(input.name),
      files: Array.isArray(input.files) ? input.files.map((file: unknown) => asString(file)) : [],
      kind: input.kind as any,
      footprint: input.footprint as any,
      keyGreen: input.keyGreen === false ? false : true,
      keyColor: typeof input.keyColor === "string" && input.keyColor.trim() !== "" ? input.keyColor : config.keyColor
    });
  }
  async saveIsoTileset(payload: any) {
    const input = asRecord(payload);
    const result = await isogen.saveIsoTileset(asString(input.projectId), asString(input.tilesetId), {
      name: typeof input.name === "string" ? input.name : undefined,
      fps: input.fps === null ? null : typeof input.fps === "number" ? input.fps : undefined,
      loop: input.loop
    });
    return { tileset: isogen.isoTilesetBrief(result.tileset), warnings: result.warnings };
  }
  async removeIsoTileset(payload: any) {
    const input = asRecord(payload);
    const result = await isogen.removeIsoTileset(asString(input.projectId), asString(input.tilesetId));
    return { ok: true, ...result };
  }
  async saveIsoDoc(payload: any) {
    const input = asRecord(payload);
    const result = await isogen.saveIsoDoc(asString(input.projectId), {
      name: typeof input.name === "string" ? input.name : undefined,
      cols: typeof input.cols === "number" ? input.cols : undefined,
      rows: typeof input.rows === "number" ? input.rows : undefined,
      layers: Array.isArray(input.layers) ? (input.layers as any[]) : undefined,
      addLayer: input.addLayer as any,
      removeLayerId: typeof input.removeLayerId === "string" ? input.removeLayerId : undefined,
      moveLayer: input.moveLayer as any,
      clearLayerId: typeof input.clearLayerId === "string" ? input.clearLayerId : undefined
    });
    return result;
  }
  async applyIsoOps(payload: any) {
    const input = asRecord(payload);
    return isogen.applyIsoOps(asString(input.projectId), Array.isArray(input.ops) ? (input.ops as any[]) : [], {
      stroke: typeof input.stroke === "string" ? input.stroke : undefined,
      have: Array.isArray(input.have) ? (input.have as string[]) : undefined,
      dryRun: input.dryRun === true,
      ifRevision: typeof input.ifRevision === "string" ? input.ifRevision : undefined
    });
  }
  async isoUndo(payload: any) {
    const input = asRecord(payload);
    return isogen.isoUndo(asString(input.projectId), Array.isArray(input.have) ? (input.have as string[]) : []);
  }
  async isoRedo(payload: any) {
    const input = asRecord(payload);
    return isogen.isoRedo(asString(input.projectId), Array.isArray(input.have) ? (input.have as string[]) : []);
  }
  async isoPlan(payload: any) {
    const input = asRecord(payload);
    return isogen.isoPlan(asString(input.projectId), {
      view: input.view as any,
      have: Array.isArray(input.have) ? (input.have as string[]) : undefined,
      layerIds: Array.isArray(input.layerIds) ? (input.layerIds as number[]) : undefined,
      pending: Array.isArray(input.pending) ? (input.pending as any[]) : undefined,
      pass: input.pass === true
    });
  }
  async isoInspect(payload: any) {
    const input = asRecord(payload);
    return isogen.isoInspect(asString(input.projectId), {
      region: input.region as any,
      layerIds: Array.isArray(input.layerIds) ? input.layerIds.map((entry: unknown) => String(entry)) : undefined,
      include: Array.isArray(input.include) ? input.include.map((entry: unknown) => String(entry)) : undefined,
      format: input.format === "text" || input.format === "json" || input.format === "both" ? input.format : undefined,
      maxCells: typeof input.maxCells === "number" ? input.maxCells : undefined,
      maxItems: typeof input.maxItems === "number" ? input.maxItems : undefined
    });
  }
  async isoRender(payload: any) {
    const input = asRecord(payload);
    return isogen.runIsoRender(asString(input.projectId), {
      region: input.region as any,
      scale: typeof input.scale === "number" ? input.scale : undefined,
      layerIds: Array.isArray(input.layerIds) ? input.layerIds.map((entry: unknown) => String(entry)) : undefined,
      frame: typeof input.frame === "number" ? input.frame : undefined,
      background: input.background as any,
      overlay: input.overlay as any,
      maxPixels: typeof input.maxPixels === "number" ? input.maxPixels : undefined,
      name: typeof input.name === "string" ? input.name : undefined
    });
  }
  async runIsoGenerate(payload: any) {
    const input = asRecord(payload);
    const kind = input.kind === "maze" || input.kind === "continent" ? input.kind : "random";
    return isogen.runIsoGenerate(asString(input.projectId), {
      kind,
      tiles: Array.isArray(input.tiles) ? (input.tiles as number[]) : undefined,
      seed: typeof input.seed === "number" ? input.seed : undefined,
      layerId: typeof input.layerId === "string" ? input.layerId : undefined
    });
  }
  async runIsoPreview(payload: any) {
    return isogen.runIsoPreview(asString(asRecord(payload).projectId));
  }
  async runIsoExport(payload: any) {
    const input = asRecord(payload);
    return isogen.runIsoExport(asString(input.projectId), {
      scale: typeof input.scale === "number" ? input.scale : undefined,
      formats: input.formats as any
    });
  }
  async cancelIsoJob(payload: any) {
    isogen.cancelIsoJob(asString(asRecord(payload).projectId));
    return { ok: true };
  }
  async setIsoApproved(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    const approved = input.approved === true;
    const stage = typeof input.stage === "string" ? input.stage : undefined;
    await isogen.patchIsoProject(id, (project) => {
      const stages = stage === undefined ? isogen.ISO_STAGES : [stage];
      for (const key of stages) {
        if (key !== "assets" && key !== "paint" && key !== "export") continue;
        project.stages[key] = { ...project.stages[key], approved, approvedAt: approved ? new Date().toISOString() : undefined };
      }
    });
    return { ok: true };
  }
  async revealIsoProject(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    const project = await isogen.readIsoProject(id);
    if (project === undefined) throw new Error(`项目不存在：${id}`);
    const target = input.target === "export" ? "export" : "project";
    const dir = await isogen.isoRevealDir(id, target);
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try {
      spawn(command, [dir], { detached: true, stdio: "ignore" }).unref();
    } catch (error) {
      throw new Error(`无法打开目录：${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: true, dir, fallback: target === "export" && dir === isogen.isoProjectDir(id) ? true : undefined };
  }

  // ── 地图编辑器（模块六，单项目 = 单张地图）──────────────────────────────
  async listMapProjects() {
    return { projects: await mapgen.listMapProjects() };
  }
  async createMapProject(payload: any) {
    const input = asRecord(payload);
    const project = await mapgen.createMapProject(asString(input.name, "未命名地图"), {
      grid: input.grid,
      cols: typeof input.cols === "number" ? input.cols : undefined,
      rows: typeof input.rows === "number" ? input.rows : undefined
    });
    return mapgen.mapView(project);
  }
  async getMapProject(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    const project = await mapgen.readMapProject(id);
    if (project === undefined) throw new Error(`项目不存在：${id}`);
    // `input.mapId` 只是旧深链接的兼容位：单项目 = 单张地图，它没有意义，忽略。
    return mapgen.mapView(project);
  }
  async saveMapProject(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const next = await mapgen.patchMapProject(id, (project) => {
      if (name !== "") project.name = name;
      return project;
    });
    return mapgen.mapView(next);
  }
  async deleteMapProject(payload: any) {
    const id = asString(asRecord(payload).projectId);
    await mapgen.deleteMapProject(id);
    return { ok: true };
  }
  async importMapTileset(payload: any) {
    const input = asRecord(payload);
    const data = asString(input.path) !== "" ? await readImageBase64FromPath(asString(input.path)) : asString(input.data);
    if (data === "") throw new Error("importMapTileset 需要 data（base64）或 path（本机绝对路径）。");
    const result = await mapgen.importMapTileset(asString(input.projectId), asString(input.name), data, {
      cell: input.cell,
      shape: input.shape,
      animRows: input.animRows,
      // 素材自己的播放速度：0.5~30 帧/秒；留空 = 跟全局（校验在 mapgen.parseAssetFps 里）。
      fps: input.fps,
      // 把大图缩到格子时的清晰度与倍数（校验在 mapgen.parseClarity / parseAssetScale 里）。
      clarity: input.clarity,
      scale: input.scale,
      // 会动的素材怎么循环（校验在 mapgen.parseAssetLoop 里）。
      loop: input.loop,
      // 整图规格（给了它就是整图；校验在 mapgen.parseStampSpec 里）。
      stamp: input.stamp,
      // 整图：导入时抠背景（手动那条路；AI 那条在 composeMapAsset 里已经抠过）。
      stampKey: input.stampKey,
      keyColor: typeof input.keyColor === "string" && input.keyColor.trim() !== "" ? input.keyColor : (await loadConfig()).keyColor
    });
    // `rev` 不在 project.json 里（派生数据），要在回给界面时现取 —— 少了它重烘后界面会拿旧缓存图。
    const revisions = await mapgen.tilesetRevisions(asString(input.projectId));
    return {
      tilesets: result.tilesets.map((tileset) => ({ ...mapTilesetBrief(tileset), rev: revisions.get(tileset.id) })),
      warnings: result.warnings
    };
  }
  /** 内置素材：本机现算，零成本（4 张自动连接图 + 1 张道具图）。 */
  async importSampleTileset(payload: any) {
    const result = await mapgen.importSampleTileset(asString(asRecord(payload).projectId));
    return { tilesets: result.tilesets.map(mapTilesetBrief), warnings: result.warnings };
  }
  /**
   * 整理 AI 生成的那几张图 → 一张落在 `ai/` 的待确认素材图。
   *
   * `shape`（普通 / 整格 / 拼块）是**生图前就定好的计划**：宿主按它把图规整成地图
   * 编辑器要的几何。只整理、不导入 —— 素材属性在新增那一刻定死，所以交给用户在
   * 「新增素材」窗口里确认一次（界面按返回的 openUrl 把图预选好、用法也预选好）。
   */
  async composeMapAsset(payload: any) {
    const input = asRecord(payload);
    const files = Array.isArray(input.files) ? input.files.map((file: unknown) => asString(file)) : [];
    const config = await loadConfig();
    return mapgen.composeMapAsset({
      projectId: asString(input.projectId),
      name: asString(input.name),
      files,
      shape: input.shape,
      cell: input.cell,
      animRows: input.animRows === true ? true : input.animRows === false ? false : undefined,
      // 整图：占几格（校验在 mapgen.parseStampSpec 里；不给就按 3×3 常见尺寸？不 —— 明确报错）。
      stampCols: input.stampCols,
      stampRows: input.stampRows,
      keyColor: typeof input.keyColor === "string" && input.keyColor.trim() !== "" ? input.keyColor : config.keyColor
    });
  }
  async recomposeMapTileset(payload: any) {
    const input = asRecord(payload);
    return mapgen.recomposeMapTileset(asString(input.projectId), asString(input.tilesetId), {
      files: Array.isArray(input.files) ? input.files.map((file: unknown) => String(file)) : undefined,
      clarity: input.clarity
    });
  }
  async saveMapTileset(payload: any) {
    const input = asRecord(payload);
    const result = await mapgen.saveMapTileset(asString(input.projectId), asString(input.tilesetId), {
      name: typeof input.name === "string" ? input.name : undefined,
      cell: input.cell === undefined ? undefined : { width: Number(asRecord(input.cell).width), height: Number(asRecord(input.cell).height) },
      shape: mapgen.parseTilesetShape(input.shape),
      animRows: typeof input.animRows === "boolean" ? input.animRows : undefined,
      // `null` = 清掉自己的速度（跟全局）；`undefined` = 这次不动它。
      fps: input.fps === undefined ? undefined : input.fps === null ? null : Number(input.fps),
      loop: input.loop,
      // 仅整图：逐格通行区域（长度 / 取值由 mapgen 校验，这里只透传）。
      stampPass: Array.isArray(input.stampPass) ? input.stampPass : undefined
    });
    return { tileset: mapTilesetBrief(result.tileset), warnings: result.warnings };
  }
  async removeMapTileset(payload: any) {
    const input = asRecord(payload);
    const result = await mapgen.removeMapTileset(asString(input.projectId), asString(input.tilesetId));
    return { ok: true, ...result };
  }
  async saveMapDoc(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    const result = await mapgen.saveMapDocStructure(id, {
      name: typeof input.name === "string" ? input.name : undefined,
      cols: typeof input.cols === "number" ? input.cols : undefined,
      rows: typeof input.rows === "number" ? input.rows : undefined,
      layers: Array.isArray(input.layers) ? (input.layers as Array<{ id: string; name?: string }>) : undefined,
      addLayer: input.addLayer === undefined ? undefined : { name: typeof asRecord(input.addLayer).name === "string" ? (asRecord(input.addLayer).name as string) : undefined },
      removeLayerId: typeof input.removeLayerId === "string" ? input.removeLayerId : undefined,
      moveLayer: input.moveLayer === undefined ? undefined : { id: asString(asRecord(input.moveLayer).id), toIndex: Number(asRecord(input.moveLayer).toIndex) },
      clearLayerId: typeof input.clearLayerId === "string" ? input.clearLayerId : undefined,
      wrap: typeof input.wrap === "boolean" ? input.wrap : undefined
    });
    // 结构变了（尺寸 / 图层 / 环绕）→ 界面要重算画布与计划，把最新视图一起回给它。
    const project = await mapgen.readMapProject(id);
    return {
      doc: { id: result.doc.id, name: result.doc.name, cols: result.doc.cols, rows: result.doc.rows, layers: result.doc.layers },
      dropped: result.dropped,
      warnings: result.warnings,
      view: project === undefined ? undefined : await mapgen.mapView(project)
    };
  }
  async applyMapOps(payload: any) {
    const input = asRecord(payload);
    return mapgen.applyMapOps(asString(input.projectId), Array.isArray(input.ops) ? (input.ops as unknown[]) : [], {
      stroke: typeof input.stroke === "string" && input.stroke !== "" ? input.stroke : undefined,
      have: mapHave(input.have),
      dryRun: input.dryRun === true,
      ifRevision: typeof input.ifRevision === "string" ? input.ifRevision : undefined
    });
  }
  async mapUndo(payload: any) {
    const input = asRecord(payload);
    return mapgen.undoMap(asString(input.projectId), mapHave(input.have));
  }
  async mapRedo(payload: any) {
    const input = asRecord(payload);
    return mapgen.redoMap(asString(input.projectId), mapHave(input.have));
  }
  async mapPlan(payload: any) {
    const input = asRecord(payload);
    const view = asRecord(input.view);
    return mapgen.mapPlan(asString(input.projectId), {
      view: { x: Number(view.x) || 0, y: Number(view.y) || 0, width: Number(view.width) || 0, height: Number(view.height) || 0 },
      have: mapHave(input.have),
      layerIds: Array.isArray(input.layerIds) ? input.layerIds.map((entry: unknown) => Number(entry)) : undefined,
      pending: Array.isArray(input.pending) ? input.pending : undefined,
      pass: input.pass === true
    });
  }
  async mapInspect(payload: any) {
    const input = asRecord(payload);
    return mapgen.mapInspect(asString(input.projectId), {
      region: input.region as any,
      layerIds: Array.isArray(input.layerIds) ? input.layerIds.map((entry: unknown) => String(entry)) : undefined,
      include: Array.isArray(input.include) ? input.include.map((entry: unknown) => String(entry)) : undefined,
      format: input.format === "text" || input.format === "json" || input.format === "both" ? input.format : undefined,
      maxCells: typeof input.maxCells === "number" ? input.maxCells : undefined,
      maxItems: typeof input.maxItems === "number" ? input.maxItems : undefined
    });
  }
  async mapRender(payload: any) {
    const input = asRecord(payload);
    return mapgen.runMapRender(asString(input.projectId), {
      region: input.region as any,
      scale: typeof input.scale === "number" ? input.scale : undefined,
      layerIds: Array.isArray(input.layerIds) ? input.layerIds.map((entry: unknown) => String(entry)) : undefined,
      frame: typeof input.frame === "number" ? input.frame : undefined,
      background: input.background as any,
      overlay: input.overlay as any,
      maxPixels: typeof input.maxPixels === "number" ? input.maxPixels : undefined,
      name: typeof input.name === "string" ? input.name : undefined
    });
  }
  /** 一键生成：整层一次提交（一次撤销就能回去），同种子逐字节可复现。 */
  async runMapGenerate(payload: any) {
    const input = asRecord(payload);
    const kind = asString(input.kind, "random");
    if (kind !== "random" && kind !== "maze" && kind !== "continent") throw new Error(`未知生成算法：${kind}（可选 random / maze / continent）`);
    return mapgen.runMapGenerate(asString(input.projectId), {
      kind,
      tiles: Array.isArray(input.tiles) ? input.tiles.map((entry: unknown) => Number(entry)) : undefined,
      seed: typeof input.seed === "number" ? input.seed : undefined,
      layerId: typeof input.layerId === "string" && input.layerId !== "" ? input.layerId : undefined
    });
  }
  async runMapPreview(payload: any) {
    return mapgen.runPreviewStage(asString(asRecord(payload).projectId));
  }
  async runMapExport(payload: any) {
    const input = asRecord(payload);
    return mapgen.runExportStage(asString(input.projectId), {
      scale: typeof input.scale === "number" ? input.scale : undefined,
      formats: input.formats === undefined ? undefined : input.formats
    });
  }
  async cancelMapJob(payload: any) {
    mapgen.cancelMapJob(asString(asRecord(payload).projectId));
    return { ok: true };
  }
  async setMapApproved(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    const stage = asString(input.stage);
    const approved = input.approved === true;
    await mapgen.patchMapProject(id, (project) => {
      const stages = stage === "" ? mapgen.MAP_STAGES : [stage];
      for (const key of stages) {
        if (!(mapgen.MAP_STAGES as readonly string[]).includes(key)) throw new Error(`未知阶段：${key}`);
        const current = project.stages[key as mapgen.MapStage];
        project.stages[key as mapgen.MapStage] = { ...current, approved, approvedAt: approved ? new Date().toISOString() : undefined };
      }
      appendJobLog(project.logs, "info", `${approved ? "通过" : "取消通过"}：${stage === "" ? "全部阶段" : stage}`);
    });
    return { ok: true, stage: stage === "" ? null : stage, approved };
  }
  async revealMapProject(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.projectId);
    /**
     * `target: "export"` = 打开**导出目录**（界面上的「打开导出目录」按钮）；
     * 其余（含省略）= 项目目录。两者都不是随便拼路径 —— 见 `mapgen.mapRevealDir`：
     * 它按与导出同一处口径算目录名，还没导出过就退回项目目录并用 `fallback` 说明。
     */
    const { dir, fallback } = await mapgen.mapRevealDir(id, asString(input.target));
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try {
      spawn(command, [dir], { detached: true, stdio: "ignore" }).unref();
    } catch (error) {
      throw new Error(`无法打开目录：${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: true, dir, fallback };
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
    const submittable = pending.filter(
      (key) => regenerate || project.videos[key]?.status !== "ready"
    );
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
  async prepareFramePick(payload) {
    const input = asRecord(payload);
    const count = input.count === undefined || input.count === null ? undefined : clampInt(input.count, 32, TURN_FRAME_COUNT_MIN, TURN_FRAME_COUNT_MAX);
    return startFramePick(asString(input.projectId), asString(input.key), count);
  }
  async setFramePick(payload) {
    const input = asRecord(payload);
    return setFramePick(asString(input.projectId), asString(input.key), Number(input.slot), Number(input.index));
  }
  async setFramePicks(payload) {
    const input = asRecord(payload);
    const picks = Array.isArray(input.picks) ? input.picks.map((value) => Number(value)) : [];
    return setFramePicks(asString(input.projectId), asString(input.key), picks);
  }
  async resetFramePicks(payload) {
    const input = asRecord(payload);
    return resetFramePicks(asString(input.projectId), asString(input.key));
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
  // ── 阶段①的另一种生成方式：转圈截帧 ────────────────────────────────────
  /**
   * 切换「八方向绿幕图」的生成方式：`turn`（转圈截帧，默认）/ `direct`（逐方向生图）。
   * 只切换做法，**不删任何产物**——另一条路重跑一次就换过来了。
   */
  async setImageMode(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const mode = asString(input.mode);
    if (mode !== "turn" && mode !== "direct")
      throw new Error(`未知生成方式：${mode}`);
    const project = await readProject(projectId);
    if (project === undefined)
      throw new Error(`项目不存在：${projectId}`);
    await setImageMode(projectId, mode);
    return { ok: true, mode };
  }
  /** 生成转圈视频（**花钱**：一次 MiniMax 调用）。整圈只有这一段视频。 */
  async runTurnVideo(payload) {
    const projectId = asString(asRecord(payload).projectId);
    const project = await readProject(projectId);
    if (project === undefined)
      throw new Error(`项目不存在：${projectId}`);
    if (project.source === null && project.images?.front?.file === undefined)
      throw new Error("还没有源图，请先上传角色设定图");
    const running = project.turn?.video?.status === "running";
    if (running)
      throw new Error("转圈视频正在生成中，请等它跑完（重复提交会覆盖正在跑的任务）");
    return startTurnVideo(projectId);
  }
  /** 抽取转圈候选帧（本机 ffmpeg，不花钱），并按当前截帧位置切出八张方向图。 */
  async runTurnFrames(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const project = await readProject(projectId);
    if (project === undefined)
      throw new Error(`项目不存在：${projectId}`);
    if (project.turn?.video?.file === undefined)
      throw new Error("还没有转圈视频，请先生成转圈视频");
    const count = input.count === undefined ? undefined : clampInt(input.count, project.settings.turnFrameCount, TURN_FRAME_COUNT_MIN, TURN_FRAME_COUNT_MAX);
    return startTurnFrames(projectId, count);
  }
  /**
   * 改一个方向的截帧位置（时间轴上的圆圈被拖动 / 键盘微调时调用）。
   * 只重切这一张图，其余方向不动；这个方向的行走视频与序列帧会被作废。
   */
  async setTurnPick(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const key = asString(input.key);
    if (directionOf(key) === undefined)
      throw new Error(`未知方向：${key}`);
    const index = Number(input.index);
    if (!Number.isFinite(index))
      throw new Error("截帧位置必须是数字");
    return setTurnPick(projectId, key, index);
  }
  /** 重新铺一遍八个截帧位置（`direction` 不给就用当前转圈方向）。 */
  async resetTurnPicks(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const direction = input.direction === "ccw" ? "ccw" : input.direction === "cw" ? "cw" : undefined;
    const project = await readProject(projectId);
    if (project === undefined)
      throw new Error(`项目不存在：${projectId}`);
    await resetTurnPicks(projectId, direction);
    return { ok: true, direction: direction ?? project.turn?.direction ?? TURN_DIRECTION_DEFAULT };
  }
  /**
   * 一次写多个截帧位置。看完整圈条带再整份写回，比逐个方向猜要靠谱——
   * 「转反了」这种问题只有对着条带才看得出来。
   */
  async setTurnPicks(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const raw = asRecord(input.picks);
    const picks: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      // 未知方向要**明确报错**，不能被过滤成「没有要改的方向」——那会让调用方
      // 以为是自己漏传了位置，而不是方向名写错了。
      if (directionOf(key) === undefined)
        throw new Error(`未知方向：${key}`);
      picks[key] = clampInt(value, 0, 0, TURN_FRAME_COUNT_MAX - 1);
    }
    return setTurnPicks(projectId, picks);
  }
  /** 只重切指定方向（候选帧与位置都没变，但想强制重新生成那几张图）。 */
  async cutTurnFrames(payload) {
    const input = asRecord(payload);
    const projectId = asString(input.projectId);
    const keys = Array.isArray(input.keys)
      ? input.keys.filter((key) => directionOf(key) !== undefined)
      : undefined;
    const project = await readProject(projectId);
    if (project === undefined)
      throw new Error(`项目不存在：${projectId}`);
    if (project.turn?.frames?.raw === undefined)
      throw new Error("还没有候选帧，请先抽取转圈候选帧");
    await applyTurnPicks(projectId, keys);
    return { ok: true };
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    /**
     * `dir` 是**本机绝对目录**：对话里的 agent 要把生成结果交给别的模块
     * （例如 `composeMapAsset` 整理地图素材），而 `assetBase` 是给浏览器用的 URL。
     * 产物绝对路径 = `dir + "/" + item.file`（`out/img-00.png`）。
     */
    return { ...job, dir: imagegen.imageJobDir(jobId), assetBase: assetBasePath(`${ROUTE_PREFIX}/image-assets/${jobId}/`) };
  }

  async deleteImageJob(payload) {
    await imagegen.deleteImageJob(asString(asRecord(payload).jobId));
    return { ok: true };
  }

  async saveImageJob(payload) {
    const input = asRecord(payload);
    const jobId = asString(input.jobId);
    const job = await imagegen.readImageJob(jobId);
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    if (typeof input.name === "string" && input.name.trim() !== "") job.name = input.name.trim().slice(0, 80);
    if (typeof input.prompt === "string") job.prompt = input.prompt;
    if (typeof input.suffix === "string") job.suffix = input.suffix;
    if (input.settings !== undefined) {
      const raw = asRecord(input.settings);
      const current = await loadConfig();
      // 生图模型是全局设置（设置 → 游戏素材大师 → 生图后端），任务里不保留可覆盖的副本。
      job.settings.model = imageModelOf(current);
      /**
       * 尺寸来源：默认跟随全局；用户显式选「自定义」后，本任务的 size 才保留。
       *
       * 兼容老客户端 / 对话工具面：只传 `size` 不传 `sizeMode` 时，如果它和当前
       * 全局尺寸不同，就视为「这个任务要自定义」，避免「传了 size 却被静默忽略」。
       */
      const globalSize = imageSizeOf(current);
      const requested = typeof raw.size === "string" ? raw.size.trim() : "";
      let mode: "global" | "custom" =
        raw.sizeMode === "custom" ? "custom" : raw.sizeMode === "global" ? "global" : job.settings.sizeMode === "custom" ? "custom" : "global";
      if (raw.sizeMode === undefined && requested !== "" && requested !== globalSize) mode = "custom";
      job.settings.sizeMode = mode;
      job.settings.size = mode === "custom"
        ? requested !== "" ? requested : job.settings.size || globalSize
        : globalSize;
      job.settings.count = clampInt(raw.count, job.settings.count, 1, 8);
      job.settings.watermark = raw.watermark === true;
    }
    if (input.keying !== undefined) applyKeying(job.keying, asRecord(input.keying));
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
      if (index !== undefined && touched === 0) throw new Error(`没有第 ${index} 张产物`);
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    if (job.prompt.trim() === "") throw new Error("提示词为空，请先填写");
    const count = clampInt(input.count, job.settings.count, 1, 8);
    if (count !== job.settings.count) {
      job.settings.count = count;
      await imagegen.writeImageJob(job);
    }
    let started = 0;
    for (let i = 0; i < count; i++) {
      if (kickImageItem(jobId, i)) started++;
    }
    if (started === 0) throw new Error("这些图片已经在生成中，请等它们跑完");
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    /**
     * `dir` 与本机绝对路径的用法同 `getImageJob`：抽帧产物的绝对路径 =
     * `dir + "/" + file`，其中 `file` 取 `frames.files` 里那串相对路径。
     */
    return {
      ...job,
      dir: seqgen.sequenceJobDir(jobId),
      tasks: seqgen.listSequenceTasks(jobId),
      assetBase: assetBasePath(`${ROUTE_PREFIX}/sequence-assets/${jobId}/`)
    };
  }

  async deleteSequenceJob(payload) {
    await seqgen.deleteSequenceJob(asString(asRecord(payload).jobId));
    return { ok: true };
  }

  async saveSequenceJob(payload) {
    const input = asRecord(payload);
    const jobId = asString(input.jobId);
    const job = await seqgen.readSequenceJob(jobId);
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    if (typeof input.name === "string" && input.name.trim() !== "") job.name = input.name.trim().slice(0, 80);
    if (input.mode === "frames" || input.mode === "reference") job.mode = input.mode;
    if (typeof input.prompt === "string") job.prompt = input.prompt;
    if (typeof input.suffix === "string") job.suffix = input.suffix;
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
        if (job.frames.raw !== undefined) job.frames.stale = true;
      }
    }
    if (input.keying !== undefined) applyKeying(job.keying, asRecord(input.keying));
    // 验收打标：不带 step 就是三步全打，带 step 只改那一步。与界面的「通过」共用同一份数据。
    if (typeof input.approved === "boolean") {
      const step = typeof input.step === "string" ? input.step : undefined;
      if (step === undefined) {
        job.video.approved = input.approved;
        job.frames.approved = input.approved;
        job.sheet.approved = input.approved;
      } else {
        if (step !== "video" && step !== "frames" && step !== "sheet") throw new Error(`未知步骤：${step}`);
        job[step].approved = input.approved;
      }
    }
    await seqgen.writeSequenceJob(job);
    return { ok: true };
  }

  async uploadSequenceRef(payload) {
    const input = asRecord(payload);
    await seqgen.uploadSequenceRef(
      asString(input.jobId),
      asString(input.kind, "referenceImage") as seqgen.SequenceRefKind,
      asString(input.name, "file"),
      asString(input.data)
    );
    return { ok: true };
  }

  async removeSequenceRef(payload) {
    const input = asRecord(payload);
    await seqgen.removeSequenceRef(
      asString(input.jobId),
      asString(input.kind, "referenceImage") as seqgen.SequenceRefKind,
      typeof input.file === "string" ? input.file : undefined
    );
    return { ok: true };
  }

  async runSequenceVideo(payload) {
    const jobId = asString(asRecord(payload).jobId);
    const job = await seqgen.readSequenceJob(jobId);
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    if (job.video.file === undefined) throw new Error("还没有可用视频，请先生成视频");
    const count = input.count === undefined ? undefined : clampInt(input.count, job.settings.frameCount, 1, 64);
    return seqgen.startSequenceFrames(jobId, count);
  }

  async keySequenceFrames(payload) {
    const jobId = asString(asRecord(payload).jobId);
    const job = await seqgen.readSequenceJob(jobId);
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    if (job.frames.raw === undefined) throw new Error("还没有抽过帧，请先抽帧");
    return seqgen.startSequenceKey(jobId);
  }

  async composeSequence(payload) {
    const jobId = asString(asRecord(payload).jobId);
    const job = await seqgen.readSequenceJob(jobId);
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
    if (job.frames.raw === undefined) throw new Error("还没有抽过帧，请先抽帧");
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
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
    if (job === undefined) throw new Error(`任务不存在：${jobId}`);
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
    if (input.settings !== undefined) await riggen.saveRigSettings(jobId, asRecord(input.settings));
    if (typeof input.approved === "boolean") {
      const stage = typeof input.stage === "string" ? (input.stage as riggen.RigStageKey) : undefined;
      if (stage === undefined) {
        await riggen.setRigStageApproved(jobId, "parts", input.approved);
        await riggen.setRigStageApproved(jobId, "layout", input.approved);
        await riggen.setRigStageApproved(jobId, "rig", input.approved);
        await riggen.setRigStageApproved(jobId, "atlas", input.approved);
      } else if (stage === "parts" && typeof input.part === "string") {
        await riggen.setRigPartApproved(jobId, input.part, input.approved);
      } else {
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
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
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
    const result = await riggen.saveRigLayoutItems(
      asString(input.jobId),
      items.map((entry: any) => ({
        name: asString(entry?.name),
        x: typeof entry?.x === "number" ? entry.x : undefined,
        y: typeof entry?.y === "number" ? entry.y : undefined,
        width: typeof entry?.width === "number" ? entry.width : undefined,
        height: typeof entry?.height === "number" ? entry.height : undefined,
        rotation: typeof entry?.rotation === "number" ? entry.rotation : undefined,
        z: typeof entry?.z === "number" ? entry.z : undefined,
        placed: typeof entry?.placed === "boolean" ? entry.placed : undefined
      }))
    );
    return { ok: true, ...result };
  }

  async setRigLayoutHints(payload) {
    const input = asRecord(payload);
    const raw = asRecord(input.hints);
    const hints: Record<string, any> = {};
    for (const [name, value] of Object.entries(raw)) hints[name] = value === null ? null : value;
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
    const bones = rawBones.map((item: any) => {
      const record = asRecord(item);
      const patch: { name: string; x?: number; y?: number; rotation?: number } = { name: asString(record.name) };
      if (typeof record.x === "number") patch.x = record.x;
      if (typeof record.y === "number") patch.y = record.y;
      if (typeof record.rotation === "number") patch.rotation = record.rotation;
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
    const names = Array.isArray(input.names) ? input.names.filter((name: unknown) => typeof name === "string") : undefined;
    return { ok: true, ...(await riggen.resetRigBoneOffsets(asString(input.jobId), names)) };
  }

  /** 动画参数：`amplitude`（统一缩放幅度）与 `duration`（循环时长）。 */
  async setRigAnimationSettings(payload) {
    const input = asRecord(payload);
    const raw = Array.isArray(input.animations) ? input.animations : [];
    const patches = raw.map((item: any) => {
      const record = asRecord(item);
      const patch: { id: string; duration?: number; amplitude?: number } = { id: asString(record.id) };
      if (typeof record.duration === "number") patch.duration = record.duration;
      if (typeof record.amplitude === "number") patch.amplitude = record.amplitude;
      return patch;
    });
    const result = await riggen.setRigAnimationSettings(asString(input.jobId), patches, {
      by: input.by === "ai" ? "ai" : "human"
    });
    return { ok: true, ...result };
  }

  async resetRigAnimationSettings(payload) {
    const input = asRecord(payload);
    const ids = Array.isArray(input.ids) ? input.ids.filter((id: unknown) => typeof id === "string") : undefined;
    return { ok: true, ...(await riggen.resetRigAnimationSettings(asString(input.jobId), ids)) };
  }

  /** 取一台动画的可编辑关键帧数据（时间轴编辑器用）。 */
  async getRigAnimation(payload) {
    const input = asRecord(payload);
    return { ok: true, ...(await riggen.getRigAnimation(asString(input.jobId), asString(input.id))) };
  }

  /**
   * 整份写回一台动画。
   *
   * `animation` 缺省时是**实例化**：用当前参数把预设烘成显式关键帧，
   * 之后这台动画就以数据为准——参数旋钮不再影响它（刻意如此，否则
   * 手调过的帧会被下一次调参悄悄改掉）。
   */
  async saveRigAnimation(payload) {
    const input = asRecord(payload);
    return {
      ok: true,
      ...(await riggen.saveRigAnimation(asString(input.jobId), {
        id: asString(input.id),
        animation: input.animation
      }))
    };
  }

  /** 还原一台动画到预设。 */
  async resetRigAnimation(payload) {
    const input = asRecord(payload);
    return { ok: true, ...(await riggen.resetRigAnimation(asString(input.jobId), asString(input.id))) };
  }

  /**
   * 重跑拆件质检。
   *
   * 分割后会自动跑一次（那一次要解码全部部件 PNG，只在拆完时做）；这里是手动入口，
   * 用于「改了语义/隐藏了部件之后重新评估」，以及让 agent 把看图得到的
   * `expectedParts`（参考图里大致有几个独立部位）写进去。
   */
  async runRigQa(payload) {
    const input = asRecord(payload);
    const expected = typeof input.expectedParts === "number" ? input.expectedParts : undefined;
    return { ok: true, ...(await riggen.runRigQa(asString(input.jobId), expected)) };
  }

  /**
   * 写入 / 覆盖 IK 约束（M5）。
   *
   * 目标骨不存在时宿主会自动补一根可拖的点，所以这里只要求 `bone` 与 `name`。
   */
  async setRigConstraints(payload) {
    const input = asRecord(payload);
    const raw = Array.isArray(input.constraints) ? input.constraints : [];
    const patches = raw.map((item: any) => {
      const record = asRecord(item);
      const patch: any = { name: asString(record.name), bone: asString(record.bone) };
      if (typeof record.target === "string") patch.target = record.target;
      if (typeof record.chain === "number") patch.chain = record.chain;
      if (typeof record.bendPositive === "boolean") patch.bendPositive = record.bendPositive;
      if (typeof record.weight === "number") patch.weight = record.weight;
      return patch;
    });
    const result = await riggen.setRigConstraints(asString(input.jobId), patches, {
      by: input.by === "ai" ? "ai" : "human"
    });
    return { ok: true, ...result };
  }

  async resetRigConstraints(payload) {
    const input = asRecord(payload);
    const names = Array.isArray(input.names) ? input.names.filter((name: unknown) => typeof name === "string") : undefined;
    return { ok: true, ...(await riggen.resetRigConstraints(asString(input.jobId), names)) };
  }

  /**
   * 蒙皮网格与 FFD 变形（M5）。
   *
   * 网格是**确定性重算**的（规则三角化），只传密度；`deform` 是波形参数，
   * 导出时会按每个动画的时长采样成 deform/ffd 时间轴。
   */
  async setRigMesh(payload) {
    const input = asRecord(payload);
    const raw = Array.isArray(input.meshes) ? input.meshes : [];
    const patches = raw.map((item: any) => {
      const record = asRecord(item);
      const patch: any = { name: asString(record.name) };
      if (typeof record.cols === "number") patch.cols = record.cols;
      if (typeof record.rows === "number") patch.rows = record.rows;
      if (record.deform === null) patch.deform = null;
      else if (record.deform !== undefined) {
        const deform = asRecord(record.deform);
        const parsed: any = {};
        if (typeof deform.amplitude === "number") parsed.amplitude = deform.amplitude;
        if (typeof deform.cycles === "number") parsed.cycles = deform.cycles;
        if (typeof deform.direction === "number") parsed.direction = deform.direction;
        if (deform.anchor === "top" || deform.anchor === "bottom" || deform.anchor === "none") parsed.anchor = deform.anchor;
        if (typeof deform.duration === "number") parsed.duration = deform.duration;
        patch.deform = parsed;
      }
      return patch;
    });
    const result = await riggen.setRigMesh(asString(input.jobId), patches, {
      by: input.by === "ai" ? "ai" : "human"
    });
    return { ok: true, ...result };
  }

  /**
   * Path 约束（M5）。`points` 是扁平的 `[x0,y0,x1,y1,…]`（参考图像素）。
   *
   * 路径点与骨链放在同一条记录里：它们**只能一起改**——换一条骨链而留着旧路径的间距，
   * 结果一定是错的。
   */
  async setRigPath(payload) {
    const input = asRecord(payload);
    const raw = Array.isArray(input.paths) ? input.paths : [];
    const patches = raw.map((item: any) => {
      const record = asRecord(item);
      const patch: any = { name: asString(record.name) };
      if (Array.isArray(record.points)) patch.points = record.points.filter((n: unknown) => typeof n === "number");
      if (typeof record.closed === "boolean") patch.closed = record.closed;
      if (Array.isArray(record.bones)) patch.bones = record.bones.filter((n: unknown) => typeof n === "string");
      if (typeof record.spacing === "number") patch.spacing = record.spacing;
      if (typeof record.translateMix === "number") patch.translateMix = record.translateMix;
      if (typeof record.rotateMix === "number") patch.rotateMix = record.rotateMix;
      return patch;
    });
    const result = await riggen.setRigPath(asString(input.jobId), patches, {
      by: input.by === "ai" ? "ai" : "human"
    });
    return { ok: true, ...result };
  }

  async resetRigPath(payload) {
    const input = asRecord(payload);
    const names = Array.isArray(input.names) ? input.names.filter((name: unknown) => typeof name === "string") : undefined;
    return { ok: true, ...(await riggen.resetRigPath(asString(input.jobId), names)) };
  }

  async resetRigMesh(payload) {
    const input = asRecord(payload);
    const names = Array.isArray(input.names) ? input.names.filter((name: unknown) => typeof name === "string") : undefined;
    return { ok: true, ...(await riggen.resetRigMesh(asString(input.jobId), names)) };
  }

  /**
   * 换色（本地计算，免费）。
   *
   * 目标二选一：点名 `names`，或按语义 `tag` 批量。落成一个**新版本**，
   * 所以不满意随时用 `setRigTextureVersion` 切回去。
   */
  async tintRigParts(payload) {
    const input = asRecord(payload);
    const names = Array.isArray(input.names) ? input.names.filter((name: unknown) => typeof name === "string") : undefined;
    const raw = asRecord(input.tint);
    const tint: Record<string, unknown> = {};
    for (const key of ["hue", "saturation", "lightness", "brightness", "contrast"]) {
      if (typeof raw[key] === "number") tint[key] = raw[key];
    }
    if (Array.isArray(raw.rgb) && raw.rgb.length === 3) {
      tint.rgb = raw.rgb.map((value: unknown) => Number(value));
    }
    return {
      ok: true,
      ...(await riggen.tintRigParts(
        asString(input.jobId),
        { names, tag: typeof input.tag === "string" ? input.tag : undefined },
        tint,
        { by: input.by === "ai" ? "ai" : "human", note: typeof input.note === "string" ? input.note : undefined }
      ))
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

  /** AI 逐部件重绘（花钱）。生图要几十秒，所以走后台任务 + `game_material({action:'wait'})`。 */
  async runRigRedraw(payload) {
    const input = asRecord(payload);
    return riggen.startRigRedraw(asString(input.jobId), asString(input.name), asString(input.prompt), {
      erode: typeof input.erode === "number" ? input.erode : undefined
    });
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
    const parts = rawParts.map((item: any) => {
      const record = asRecord(item);
      const patch: any = { name: asString(record.name) };
      if (typeof record.role === "string") patch.role = record.role;
      if (record.parent === null) patch.parent = null;
      else if (typeof record.parent === "string") patch.parent = record.parent;
      if (Array.isArray(record.proximal) && record.proximal.length === 2) patch.proximal = [Number(record.proximal[0]), Number(record.proximal[1])];
      if (Array.isArray(record.distal) && record.distal.length === 2) patch.distal = [Number(record.distal[0]), Number(record.distal[1])];
      if (Array.isArray(record.tags)) patch.tags = record.tags.filter((tag: unknown) => typeof tag === "string");
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

  // ── 音乐生成编辑（模块七）──────────────────────────────────────────────
  //
  // 这一组方法全部只碰 `music-jobs/`；生成/工具类任务由 musicgen 的后台任务表
  // 推进，界面与对话都通过 `getMusicJob` / `refreshMusicJob` 看结果。
  async getMusicGuide(payload: any) {
    const input = asRecord(payload);
    return musicGuidePayload(typeof input.lang === "string" ? input.lang : undefined);
  }

  async getMusicScoreGuide(payload: any) {
    const input = asRecord(payload);
    return musicScoreGuidePayload(typeof input.lang === "string" ? input.lang : undefined);
  }

  /** 谱曲依赖自检：强制重新探测（不生成、不计费）。 */
  async testMusicScore() {
    const config = await loadConfig();
    return detectScoreDeps(config, { force: true });
  }

  async saveMusicScorePlan(payload: any) {
    const input = asRecord(payload);
    return musicgen.saveMusicScorePlan(asString(input.jobId), input.plan);
  }

  async runMusicScore(payload: any) {
    const input = asRecord(payload);
    return musicgen.runMusicScore(asString(input.jobId), {
      title: typeof input.title === "string" ? input.title : undefined,
      plan: input.plan,
      script: asString(input.script),
      basedOn: typeof input.basedOn === "string" ? input.basedOn : undefined,
      label: typeof input.label === "string" ? input.label : undefined
    });
  }

  async submitMusicScoreToSuno(payload: any) {
    const input = asRecord(payload);
    return musicgen.submitMusicScoreToSuno(asString(input.jobId), {
      scoreId: typeof input.scoreId === "string" ? input.scoreId : undefined,
      confirm: input.confirm === true,
      model: typeof input.model === "string" ? input.model : undefined,
      params: input.params === undefined || input.params === null ? undefined : asRecord(input.params),
      regenerate: input.regenerate === true,
      copyrightAudio: input.copyrightAudio === true,
      audioWeight: typeof input.audioWeight === "number" ? input.audioWeight : undefined
    });
  }

  async listMusicJobs() {
    return { jobs: await musicgen.listMusicJobs() };
  }

  async createMusicJob(payload: any) {
    const input = asRecord(payload);
    const job = await musicgen.createMusicJob({
      name: typeof input.name === "string" ? input.name : undefined,
      source: input.source,
      settings: input.settings,
      reviewMode: input.reviewMode === "manual" ? "manual" : input.reviewMode === "auto" ? "auto" : undefined,
      workflow: input.workflow === "compose" ? "compose" : "generate"
    });
    return musicgen.musicSnapshot(job, originForLinks());
  }

  async getMusicJob(payload: any) {
    const input = asRecord(payload);
    const job = await musicgen.readMusicJob(asString(input.jobId));
    if (job === undefined) throw new Error(`音乐任务不存在：${asString(input.jobId)}`);
    return musicgen.musicSnapshot(job, originForLinks());
  }

  async saveMusicJob(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.jobId);
    const job = await musicgen.patchMusicJob(id, (current) => {
      if (typeof input.name === "string" && input.name.trim() !== "") current.name = input.name.trim().slice(0, 80);
      if (input.source !== undefined && input.source !== null) {
        current.source = musicgen.normalizeMusicSource({ ...current.source, ...asRecord(input.source) });
      }
      if (input.settings !== undefined && input.settings !== null) {
        current.settings = musicgen.normalizeMusicSettings({ ...current.settings, ...asRecord(input.settings) }, current.source);
      }
      if (input.reviewMode === "manual" || input.reviewMode === "auto") current.reviewMode = input.reviewMode;
      musicgen.musicLog(current, "info", "任务参数已更新");
      return current;
    });
    return musicgen.musicSnapshot(job, originForLinks());
  }

  async deleteMusicJob(payload: any) {
    const id = asString(asRecord(payload).jobId);
    await musicgen.deleteMusicJob(id);
    return { ok: true, id };
  }

  async setMusicApproved(payload: any) {
    const input = asRecord(payload);
    const id = asString(input.jobId);
    if (typeof input.approved !== "boolean") throw new Error("approved 必须是布尔值");
    const stage = typeof input.stage === "string" ? input.stage : undefined;
    if (stage !== undefined && !(musicgen.MUSIC_STAGES as readonly string[]).includes(stage)) {
      throw new Error(`未知阶段：${stage}（可选：${musicgen.MUSIC_STAGES.join(" / ")}）`);
    }
    const job = await musicgen.patchMusicJob(id, (current) => {
      if (typeof input.scoreId === "string" && input.scoreId !== "") {
        const composition = current.compositions.find((entry) => entry.id === input.scoreId);
        if (composition === undefined) throw new Error(`谱曲版本不存在：${input.scoreId}`);
        composition.approved = input.approved;
      } else if (typeof input.versionId === "string" && input.versionId !== "") {
        const version = current.versions.find((entry) => entry.id === input.versionId);
        if (version === undefined) throw new Error(`版本不存在：${input.versionId}`);
        (version as any).approved = input.approved;
      } else if (typeof input.songId === "string" && input.songId !== "") {
        const song = current.songs.find((entry) => entry.id === input.songId);
        if (song === undefined) throw new Error(`歌曲不存在：${input.songId}`);
        song.approved = input.approved;
      } else if (stage !== undefined) {
        (current.stages as any)[stage] = { ...(current.stages as any)[stage], approved: input.approved };
      } else {
        for (const song of current.songs) song.approved = input.approved;
        for (const composition of current.compositions) composition.approved = input.approved;
        for (const key of musicgen.MUSIC_STAGES) (current.stages as any)[key] = { ...(current.stages as any)[key], approved: input.approved };
      }
      musicgen.musicLog(current, "info", `验收标记：${input.approved ? "通过" : "取消通过"}`);
      return current;
    });
    return musicgen.musicSnapshot(job, originForLinks());
  }

  async revealMusicJob(payload: any) {
    const id = asString(asRecord(payload).jobId);
    const job = await musicgen.readMusicJob(id);
    if (job === undefined) throw new Error(`音乐任务不存在：${id}`);
    const dir = musicgen.musicJobDir(id);
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try {
      spawn(command, [dir], { detached: true, stdio: "ignore" }).unref();
    } catch (error) {
      throw new Error(`无法打开目录：${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: true, dir };
  }

  async runMusicGeneration(payload: any) {
    const input = asRecord(payload);
    return musicgen.startMusicGeneration(asString(input.jobId), {
      engine: input.engine,
      mode: input.mode,
      model: typeof input.model === "string" ? input.model : undefined,
      params: asRecord(input.params),
      regenerate: input.regenerate === true,
      by: "ai"
    });
  }

  async cancelMusicGeneration(payload: any) {
    const id = asString(asRecord(payload).jobId);
    const canceled = musicgen.cancelMusicGeneration(id);
    return {
      ok: true,
      canceled,
      message: canceled
        ? "已停止本地轮询。已经提交给平台的生成仍会继续并计费；不要为了「确认」再提交一次。"
        : "当前没有可取消的生成任务。"
    };
  }

  async refreshMusicJob(payload: any) {
    return musicgen.refreshMusicJob(asString(asRecord(payload).jobId));
  }

  async getMusicWav(payload: any) {
    const input = asRecord(payload);
    return musicgen.getMusicWav(asString(input.jobId), asString(input.songId));
  }

  async getMusicLrc(payload: any) {
    const input = asRecord(payload);
    return musicgen.getMusicLrc(
      asString(input.jobId),
      Array.isArray(input.songIds) ? input.songIds.map((id: unknown) => String(id)) : undefined
    );
  }

  async listMusicHistory(payload: any) {
    const input = asRecord(payload);
    return musicgen.listMusicHistory({
      page: typeof input.page === "number" ? input.page : undefined,
      size: typeof input.size === "number" ? input.size : undefined,
      filters: Array.isArray(input.filters) ? input.filters.map((entry: unknown) => String(entry)) : undefined
    });
  }

  async listMusicStemInstruments() {
    return musicgen.listMusicStemInstruments();
  }

  async runMusicTool(payload: any) {
    const input = asRecord(payload);
    return musicgen.runMusicTool(asString(input.jobId), asString(input.kind), asRecord(input.params));
  }

  async musicPeaks(payload: any) {
    const input = asRecord(payload);
    return musicgen.musicPeaks(
      asString(input.jobId),
      {
        songId: typeof input.songId === "string" ? input.songId : undefined,
        versionId: typeof input.versionId === "string" ? input.versionId : undefined,
        scoreId: typeof input.scoreId === "string" ? input.scoreId : undefined,
        buckets: typeof input.buckets === "number" ? input.buckets : undefined
      },
      originForLinks()
    );
  }

  async renderMusicEdit(payload: any) {
    const input = asRecord(payload);
    return musicgen.renderMusicEdit(asString(input.jobId), {
      songId: typeof input.songId === "string" ? input.songId : undefined,
      versionId: typeof input.versionId === "string" ? input.versionId : undefined,
      ops: asRecord(input.ops),
      label: typeof input.label === "string" ? input.label : undefined,
      preview: input.preview === true,
      by: input.by === "ai" ? "ai" : "human",
      force: input.force === true
    });
  }

  async saveMusicVersion(payload: any) {
    const input = asRecord(payload);
    return musicgen.saveMusicVersion(asString(input.jobId), asString(input.versionId), typeof input.label === "string" ? input.label : undefined);
  }

  async deleteMusicVersion(payload: any) {
    const input = asRecord(payload);
    await musicgen.deleteMusicVersion(asString(input.jobId), asString(input.versionId));
    return { ok: true };
  }

  async exportMusic(payload: any) {
    const input = asRecord(payload);
    return musicgen.exportMusic(
      asString(input.jobId),
      {
        songId: typeof input.songId === "string" ? input.songId : undefined,
        versionId: typeof input.versionId === "string" ? input.versionId : undefined,
        scoreId: typeof input.scoreId === "string" ? input.scoreId : undefined,
        format: typeof input.format === "string" ? input.format : undefined,
        name: typeof input.name === "string" ? input.name : undefined,
        zip: input.zip === true
      },
      { origin: originForLinks() }
    );
  }

  // ── 音效生成（模块八，火山引擎 Seed-Audio）────────────────────────────
  //
  // 这一组只碰 `sfx-jobs/`。生成是同步 HTTP，但由 sfxgen 的后台任务表承载，
  // 界面与对话都通过 `getSfxJob` 看状态。

  async listSfxJobs() {
    return { jobs: await sfxgen.listSfxJobs() };
  }

  async createSfxJob(payload: any) {
    const input = asRecord(payload);
    const job = await sfxgen.createSfxJob({
      name: typeof input.name === "string" ? input.name : undefined,
      prompt: asString(input.prompt),
      settings: input.settings,
      reviewMode: input.reviewMode === "manual" ? "manual" : input.reviewMode === "auto" ? "auto" : undefined
    });
    return sfxgen.sfxSnapshot(job, originForLinks());
  }

  async getSfxJob(payload: any) {
    const id = asString(asRecord(payload).jobId);
    const job = await sfxgen.readSfxJob(id);
    if (job === undefined) throw new Error(`音效任务不存在：${id}`);
    return sfxgen.sfxSnapshot(job, originForLinks());
  }

  async saveSfxJob(payload: any) {
    const input = asRecord(payload);
    return sfxgen.saveSfxJob(asString(input.jobId), {
      name: typeof input.name === "string" ? input.name : undefined,
      prompt: typeof input.prompt === "string" ? input.prompt : undefined,
      settings: input.settings,
      reviewMode: input.reviewMode === "manual" ? "manual" : input.reviewMode === "auto" ? "auto" : undefined
    });
  }

  async deleteSfxJob(payload: any) {
    const id = asString(asRecord(payload).jobId);
    await sfxgen.deleteSfxJob(id);
    return { ok: true };
  }

  async uploadSfxRef(payload: any) {
    const input = asRecord(payload);
    return sfxgen.uploadSfxRef(
      asString(input.jobId),
      input.kind === "audio" ? "audio" : "image",
      typeof input.name === "string" ? input.name : undefined,
      asString(input.data)
    );
  }

  async removeSfxRef(payload: any) {
    const input = asRecord(payload);
    return sfxgen.removeSfxRef(
      asString(input.jobId),
      input.kind === "audio" ? "audio" : "image",
      typeof input.file === "string" ? input.file : undefined
    );
  }

  async runSfxGeneration(payload: any) {
    return sfxgen.startSfxGeneration(asString(asRecord(payload).jobId));
  }

  async cancelSfxGeneration(payload: any) {
    const id = asString(asRecord(payload).jobId);
    const canceled = await sfxgen.cancelSfxGeneration(id);
    return {
      ok: true,
      canceled,
      message: canceled
        ? "已取消本地请求。远端可能仍会完成并计费；不要为了「确认」再提交一次。"
        : "当前没有可取消的生成任务。"
    };
  }

  async setSfxApproved(payload: any) {
    const input = asRecord(payload);
    const stage = input.stage === "generate" || input.stage === "export" ? input.stage : undefined;
    return sfxgen.setSfxApproved(asString(input.jobId), stage, input.approved === true);
  }

  async revealSfxJob(payload: any) {
    const id = asString(asRecord(payload).jobId);
    const job = await sfxgen.readSfxJob(id);
    if (job === undefined) throw new Error(`音效任务不存在：${id}`);
    const dir = sfxgen.sfxJobDir(id);
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try {
      spawn(command, [dir], { detached: true, stdio: "ignore" }).unref();
    } catch (error) {
      throw new Error(`无法打开目录：${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: true, dir };
  }

  async exportSfx(payload: any) {
    const input = asRecord(payload);
    return sfxgen.exportSfx(asString(input.jobId), {
      takeId: typeof input.takeId === "string" ? input.takeId : undefined,
      zip: input.zip === true
    });
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
function applyKeying(target, raw): void {
  if (typeof raw.keyColor === "string") target.keyColor = normalizeKeyColor(raw.keyColor, target.keyColor || DEFAULT_KEY_COLOR);
  target.keyLow = clampInt(raw.keyLow, target.keyLow, 0, 255);
  target.keyHigh = clampInt(raw.keyHigh, target.keyHigh, 1, 255);
  if (target.keyHigh <= target.keyLow) target.keyHigh = Math.min(255, target.keyLow + 1);
  target.despill = clampFloat(raw.despill, target.despill, 0, 1);
  target.bgTolerance = clampInt(raw.bgTolerance, target.bgTolerance, 0, 160);
  target.edgeShrink = clampInt(raw.edgeShrink, target.edgeShrink, 0, 8);
  if (typeof raw.enabled === "boolean") target.enabled = raw.enabled;
}

/**
 * 图片模块的运行表：一张图一个槽位。
 * 同一张图重复点「生成」会白花一次钱，所以这里和八方向模块一样做拒绝。
 */
const imageTasks = new Map<string, Set<string>>();

function startedImageTask(jobId: string, key: string): boolean {
  return imageTasks.get(jobId)?.has(key) === true;
}

function trackImageTask(jobId: string, key: string, run: () => Promise<unknown>): boolean {
  if (startedImageTask(jobId, key)) return false;
  const set = imageTasks.get(jobId) ?? new Set<string>();
  imageTasks.set(jobId, set);
  set.add(key);
  void run()
    .catch(() => undefined)
    .finally(() => {
      set.delete(key);
      if (set.size === 0) imageTasks.delete(jobId);
    });
  return true;
}

function kickImageItem(jobId: string, index: number): boolean {
  return trackImageTask(jobId, `image:${index}`, () => imagegen.generateImageItem(jobId, index));
}

function kickImageKey(jobId: string): boolean {
  return trackImageTask(jobId, "image:key", () => imagegen.rekeyImageJob(jobId));
}

function disposeImageTasks(): void {
  imageTasks.clear();
}

/**
 * 素材的紧凑摘要（网关回给界面 / 工具面用）。
 *
 * 不回**整张 `tiles` 表**：一张大素材图能切出上千个小格，每次导入都把它们发一遍
 * 没有意义（界面要的是几何 + 调色板，调色板在 `mapView.tilesets[].palette` 里）。
 */
function mapTilesetBrief(tileset: {
  id: string;
  name: string;
  file: string;
  imageWidth: number;
  imageHeight: number;
  cell: { width: number; height: number };
  shape: string;
  animRows: boolean;
  variants: number;
  /** 会动的素材怎么循环（正放 / 倒放 / 来回）。 */
  loop?: string;
  /** 仅整图：占几格 / 几帧 / 每格通行区域（界面据此把笔刷变成 N×M、右键转 90°）。 */
  stamp?: { cols: number; rows: number; frames: number; pass?: readonly number[] };
  /** 素材图版本号（文件 mtime）：界面拼 URL 时带 `?v=`，重烘之后才会重新拉图。 */
  rev?: number;
  /** 导入时用的清晰度（图像已烘进去，这里只作显示 / 排查）。 */
  clarity?: string;
  /** 素材自己的播放速度（帧/秒）；省略 = 跟「设置 → 动画速度」走。 */
  fps?: number;
  /** 内置素材：界面上要标「自带」，也不允许改属性。 */
  builtin?: boolean;
  tiles: readonly unknown[];
}): Record<string, unknown> {
  return {
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
    stamp: tileset.stamp,
    rev: tileset.rev,
    clarity: tileset.clarity,
    fps: tileset.fps,
    builtin: tileset.builtin === true ? true : undefined,
    tileCount: tileset.tiles.length
  };
}

/** 客户端报上来的 chunk key 列表收口（不是数组就是「没报」）。 */
function mapHave(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((entry: unknown) => String(entry)) : undefined;
}

// ── 静态资源路由 ────────────────────────────────────────────────────────

/** 各模块允许通过 HTTP 路由读取的子目录白名单。 */
// `turn/` 是转圈截帧的候选帧与缩略条带：轴上那八个圆圈是对着条带拖的，
// 少了这条白名单，整个时间轴会 403（界面看着只是「图裂了」）。
const SERVABLE_DIRS = new Set(["source", "images", "videos", "frames", "keyed", "preview", "out", "turn"]);
const SERVABLE_IMAGE_DIRS = new Set(["refs", "out", "keyed"]);
const SERVABLE_SEQUENCE_DIRS = new Set(["refs", "video-refs", "videos", "frames", "keyed", "out"]);
/** 骨骼动画：源图、拆件摊平图、部件、装配结果、骨骼与图集。 */
// `export/` 是后加的第二条导出路径（DragonBones 5.5 的 `_ske.json`）。
// 白名单只比对**第一段**路径，所以 `export/dragonbones/xxx.json` 加一条 `export` 就够。
const SERVABLE_RIG_DIRS = new Set(["source", "sheet", "parts", "layout", "rig", "atlas", "export"]);
/**
 * 地图编辑器（模块六）：素材原图、验收预览图、导出包、AI 素材暂存区。
 *
 * **唯一真源在 `mapgen.SERVABLE_MAP_DIRS`**（建项目时的目录清单读的也是它）——
 * 两处各写一份的话，漏掉的那条只会以「图裂了 / 403」的形式出现，不报错。
 *
 * ⚠️ 另一半仍要同步：`AssetScope` 类型、`resolveAssetTarget` 的分支、`SCOPES`
 * 数组（那三处是 **scope** 级；`ai/` 是子目录级，只比对第一段路径，加一行就够）。
 *
 * 单项目 = 单张地图之后 `maps/` 目录不存在了（地图就是项目根下的 `map.json`，
 * 不通过资源路由读）。
 */
const SERVABLE_MAP_DIRS = mapgen.SERVABLE_MAP_DIRS;

/** 音乐生成编辑（模块七）：原曲、版本、波形缓存、工具产物、导出。 */
const SERVABLE_MUSIC_DIRS = musicgen.SERVABLE_MUSIC_DIRS;

/** 音效生成（模块八）：参考素材、每次生成的音频、导出。 */
const SERVABLE_SFX_DIRS = sfxgen.SERVABLE_SFX_DIRS;

type AssetScope = "assets" | "image-assets" | "sequence-assets" | "rig-assets" | "iso-assets" | "map-assets" | "music-assets" | "sfx-assets";

interface AssetTarget {
  file: string;
  dirs: Set<string>;
}

function resolveAssetTarget(scope: AssetScope, id: string, relative: string): AssetTarget | undefined {
  if (scope === "assets") {
    if (!PROJECT_ID_PATTERN.test(id)) return undefined;
    return { file: assetPath(id, relative), dirs: SERVABLE_DIRS };
  }
  if (scope === "image-assets") {
    if (!imagegen.isValidImageJobId(id)) return undefined;
    return { file: imagegen.imageAssetPath(id, relative), dirs: SERVABLE_IMAGE_DIRS };
  }
  if (scope === "rig-assets") {
    if (!riggen.isValidRigJobId(id)) return undefined;
    return { file: riggen.rigAssetPath(id, relative), dirs: SERVABLE_RIG_DIRS };
  }
  if (scope === "iso-assets") {
    if (!isogen.isValidIsoProjectId(id)) return undefined;
    return { file: isogen.isoAssetPath(id, relative), dirs: isogen.SERVABLE_ISO_DIRS };
  }
  if (scope === "map-assets") {
    if (!mapgen.isValidMapProjectId(id)) return undefined;
    return { file: mapgen.mapAssetPath(id, relative), dirs: SERVABLE_MAP_DIRS };
  }
  if (scope === "music-assets") {
    if (!musicgen.isValidMusicJobId(id)) return undefined;
    return { file: musicgen.musicAssetPath(id, relative), dirs: SERVABLE_MUSIC_DIRS };
  }
  if (scope === "sfx-assets") {
    if (!sfxgen.isValidSfxJobId(id)) return undefined;
    return { file: sfxgen.sfxAssetPath(id, relative), dirs: SERVABLE_SFX_DIRS };
  }
  if (!seqgen.isValidSequenceJobId(id)) return undefined;
  return { file: seqgen.sequenceAssetPath(id, relative), dirs: SERVABLE_SEQUENCE_DIRS };
}

function sendText(res, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

/**
 * 把各模块的产物路径映射到磁盘文件：
 *   /dsh-game-material-master/assets/<项目 id>/<相对路径>           八方向图
 *   /dsh-game-material-master/image-assets/<任务 id>/<相对路径>      图片生成
 *   /dsh-game-material-master/sequence-assets/<任务 id>/<相对路径>   序列帧生成
 *   /dsh-game-material-master/rig-assets/<任务 id>/<相对路径>        骨骼动画生成
 *   /dsh-game-material-master/iso-assets/<项目 id>/<相对路径>        45°地图编辑器
 *   /dsh-game-material-master/map-assets/<项目 id>/<相对路径>        地图编辑器
 *   /dsh-game-material-master/music-assets/<任务 id>/<相对路径>      音乐生成编辑
 *
 * 支持 Range：没有它浏览器里的 <video> 就不能拖动进度条，验收视频时会很难受。
 */
async function handleAsset(req, res): Promise<void> {
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

  const scope = segments[0] as AssetScope;
  // ⚠️ 这是**运行时**白名单，必须与 `AssetScope` 类型和 `resolveAssetTarget` 的分支
  // 三处同步。只改类型不改这里，TypeScript 一句话都不会说 —— `scope` 是断言出来的，
  // 而漏掉的那个 scope 会在这里直接掉进 404（界面表现只是「图裂了」）。
  // 实测：`iso-assets` / `tile-assets` 这类 scope 都漏过一轮，素材全 404。
  const SCOPES: readonly string[] = ["assets", "image-assets", "sequence-assets", "rig-assets", "iso-assets", "map-assets", "music-assets", "sfx-assets"];
  if (!SCOPES.includes(scope)) {
    sendText(res, 404, "Not Found");
    return;
  }
  const id = segments[1];
  const relative = segments.slice(2).join("/");
  if (relative.includes("..")) {
    sendText(res, 400, "Bad Request");
    return;
  }

  let target: AssetTarget | undefined;
  try {
    target = resolveAssetTarget(scope, id, relative);
  } catch {
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
  } catch {
    sendText(res, 404, "Not Found");
    return;
  }
  if (!info.isFile()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const type = MIME_TYPES[extname(target.file).toLowerCase()] ?? "application/octet-stream";
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": type,
    ETag: etag,
    "Last-Modified": new Date(info.mtimeMs).toUTCString(),
    // 产物是不可变的（每次重跑都会换 mtime → 换 ETag），所以可以放心长缓存。
    "Cache-Control": "private, max-age=300",
    "Accept-Ranges": "bytes"
  };
  /**
   * `?download=1`：给音乐模块的导出链接用，强制浏览器存盘而不是在线播放。
   * 文件名只用磁盘上的 basename（不接受 URL 里的文件名），中文走 RFC 5987。
   */
  if (url.searchParams.get("download") === "1") {
    const name = basename(target.file);
    const ascii = name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
    baseHeaders["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    baseHeaders["Cache-Control"] = "no-store";
  }

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
  // 插件被重载时，模块缓存会把上一次的 disposed 标记原样留下来，于是所有生成类调用都
  // 静默变成「任务已在进行中」——每次 apply 都要把三个后台任务表复位。
  activatePipeline();
  seqgen.activateSequence();
  riggen.activateRig();
  musicgen.activateMusic();
  sfxgen.activateSfx();

  // 旧版本的数据目录叫 8dir-sprites，插件改名后搬一次，已有项目无缝接上。
  void migrateLegacyDataRoot()
    .then((moved) => {
      if (moved) process.stderr.write("[game-material-master] 已把旧数据目录 8dir-sprites 迁移到 game-material-master\n");
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
    const disposers = registerStudioTools(
      { tools: ctx.get("tools"), systemPrompt: ctx.get("systemPrompt") },
      gateway
    );
    return () => {
      for (const dispose of disposers) dispose();
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
  // 音乐任务（模块七）：把上次没跑完的生成/工具任务接上（不重新提交，只继续查询/下载）。
  void musicgen.resumeMusicJobs().catch(() => undefined);
  // 音效任务（模块八）：同步接口没有远端 taskId 可续查，残留的 running 标失败。
  void sfxgen.resumeSfxJobs().catch(() => undefined);
  ctx.effect(() => () => {
    disposePipeline();
    seqgen.disposeSequence();
    riggen.disposeRig();
    musicgen.disposeMusic();
    sfxgen.disposeSfx();
  }, "dsh-game-material-master: pipeline cleanup");
}
