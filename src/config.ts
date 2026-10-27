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
import {
  SFX_DEFAULT_BASE_URL,
  SFX_DEFAULT_FORMAT,
  SFX_DEFAULT_MODEL,
  SFX_DEFAULT_SAMPLE_RATE,
  sfxFormatOrDefault,
  sfxSampleRateOrDefault,
  type SfxFormat
} from "./sfxapi.js";

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
export function isLegacyRowOrder(order: unknown): boolean {
  return (
    Array.isArray(order) &&
    order.length === LEGACY_ROW_ORDER.length &&
    order.every((key, index) => key === LEGACY_ROW_ORDER[index])
  );
}
import { COMP_SHARE_MODEL_ID, normalizeDuration, normalizeResolution, rootOf } from "./minimax.js";
import { DEFAULT_COMFY_WORKFLOW_TEXT, normalizeComfyBaseUrl, normalizeComfyCookies } from "./comfy.js";

export function dshHome(): string {
  const raw = process.env.DSH_HOME?.trim();
  return raw && raw !== "" ? raw : join(homedir(), ".dsh");
}

export function dataRoot(): string {
  return join(dshHome(), "game-material-master");
}

export function configPath(): string {
  return join(dataRoot(), "config.json");
}

/** 八方向图模块的项目根。 */
export function projectsRoot(): string {
  return join(dataRoot(), "projects");
}

/** 图片生成模块的任务根。 */
export function imageJobsRoot(): string {
  return join(dataRoot(), "image-jobs");
}

/** 序列帧生成模块的任务根。 */
export function sequenceJobsRoot(): string {
  return join(dataRoot(), "sequence-jobs");
}

/** 骨骼动画生成模块的任务根。 */
export function rigJobsRoot(): string {
  return join(dataRoot(), "rig-jobs");
}

/** 地图地块生成模块的项目根。 */
export function tileJobsRoot(): string {
  return join(dataRoot(), "tile-jobs");
}

/** 音乐生成编辑模块（模块七）的任务根。 */
export function musicJobsRoot(): string {
  return join(dataRoot(), "music-jobs");
}

/** 音效生成模块（模块八）的任务根。 */
export function sfxJobsRoot(): string {
  return join(dataRoot(), "sfx-jobs");
}

/**
 * 旧版本把数据放在 `8dir-sprites/`。第一次以新名字启动时整体搬过去，
 * 让已有项目和配置无缝接上——只搬一次，之后两个目录互不影响。
 */
export async function migrateLegacyDataRoot(): Promise<boolean> {
  const legacy = join(dshHome(), "8dir-sprites");
  const current = dataRoot();
  try {
    await stat(legacy);
  } catch {
    return false;
  }
  try {
    await stat(current);
    return false; // 新目录已存在，不动
  } catch {
    /* 新目录不存在，执行迁移 */
  }
  try {
    await rename(legacy, current);
    return true;
  } catch {
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
export const IMAGE_PROVIDERS = ["ark", "custom", "toapis"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

/** 自定义生图服务的协议。 */
export const CUSTOM_PROTOCOLS = ["openai", "comfyui", "sdwebui"] as const;
export type CustomProtocol = (typeof CUSTOM_PROTOCOLS)[number];

/**
 * 各协议的默认地址。
 *
 * 设置页在**协议切换**时会拿它做「原来那个地址还是默认值吗」的判断，
 * 是就顺手换成新协议的默认地址（和 MiniMax 切「优云智算版」同一套做法）——
 * 手动改过地址的用户不会被覆盖。
 */
export const CUSTOM_PROTOCOL_DEFAULTS: Record<CustomProtocol, { baseUrl: string; label: string; hint: string }> = {
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

export interface Config {
  toapisBaseUrl: string;
  toapisApiKey: string;
  toapisImageModel: string;
  toapisImageSize: string;
  toapisImageQuality: string;
  toapisImageBackground: "auto" | "transparent" | "opaque";
  toapisVideo: boolean;
  toapisVideoModel: string;
  toapisVideoDuration: number;
  toapisVideoResolution: string;
  toapisVideoAspectRatio: string;
  toapisTimeoutMs: number;

  /**
   * 生图后端：`ark`（默认）或 `custom`。
   *
   * ⚠️ 这个开关只影响**生图**。图生视频仍然只走 MiniMax。
   */
  imageProvider: ImageProvider;
  /** 自定义后端协议。 */
  customProtocol: CustomProtocol;
  customBaseUrl: string;
  customApiKey: string;
  /** 自定义后端的模型名（SD WebUI 忽略它，模型由服务端自身决定）。 */
  customModel: string;
  /** 输出尺寸。OpenAI / ComfyUI 用 `宽x高` 或 `1K`/`2K`/`4K`；SD WebUI 只认 `宽x高`。 */
  customSize: string;
  /** 负面提示词（SD WebUI 直传；ComfyUI 走 `{{negative_prompt}}` 占位符）。 */
  customNegativePrompt: string;
  /** 采样步数（ComfyUI 走 `{{steps}}`）。 */
  customSteps: number;
  /** CFG / 提示词引导强度（ComfyUI 走 `{{cfg}}`）。 */
  customCfgScale: number;
  /** 采样器名（SD WebUI 直传；ComfyUI 走 `{{sampler}}`）。 */
  customSampler: string;
  /**
   * 图生图重绘强度 0~1（SD WebUI 的 `denoising_strength`，ComfyUI 走 `{{denoising}}`）。
   * 越低越贴参考图、越高越听提示词。
   */
  customDenoising: number;
  /** 随机种子；`-1` = 每次都随机。 */
  customSeed: number;
  /**
   * ComfyUI 的工作流（**API 格式**的 JSON 文本，`POST /prompt` 里那个 `prompt` 字段）。
   *
   * 支持占位符，宿主会**按 JSON 类型**替换（不是字符串拼 JSON）：
   * `{{prompt}}` / `{{negative_prompt}}` / `{{width}}` / `{{height}}` / `{{seed}}` /
   * `{{steps}}` / `{{cfg}}` / `{{sampler}}` / `{{denoising}}` / `{{model}}` / `{{image}}`。
   * 一个占位符都不写时，就原样跑用户保存的工作流（合法用法：固定工作流）。
   */
  customWorkflow: string;
  /**
   * 自定义后端的请求超时（毫秒）。
   *
   * 默认给到 5 分钟：本地跑一张 SD 图经常要一两分钟，云端 3 分钟的超时在这里是常态失败。
   */
  customTimeoutMs: number;

  /** 火山方舟（Ark）API Key。 */
  arkApiKey: string;
  arkBaseUrl: string;
  /** 生图模型 ID，也支持推理接入点 ID（ep-xxxx）。 */
  arkModel: string;
  /**
   * **部件重绘**单独用的模型 ID；空串 = 跟随 `arkModel`（默认）。
   *
   * 拆件与重绘对模型的要求本来就不同（一个是「按提示词画一整张摊平图」，
   * 一个是「原地改这一小块、保持轮廓」），分开设置留出了切换空间。
   * 默认跟随主模型——没有证据表明某个模型在这个任务上系统性更好。
   */
  arkRedrawModel: string;
  /** `2K` / `1K` / `4K`，或显式 `宽x高`。 */
  arkSize: string;
  arkWatermark: boolean;
  /** 请求超时（毫秒）。 */
  arkTimeoutMs: number;

  /** MiniMax API Key。 */
  minimaxApiKey: string;
  /**
   * **主机根地址**（不含 /v1、/v2）。CN 平台是 https://api.minimax.cn。
   * 选「优云智算版 H3」时该值被忽略，插件固定走 https://cp.compshare.cn。
   */
  minimaxBaseUrl: string;
  /**
   * 图生视频模型：MiniMax-H3 / H3-Max 走 v2 协议，Hailuo / I2V 走 v1；
   * 「优云智算版 H3」是独立选项，走优云智算网关（多一层 /minimax 路径）。
   */
  minimaxModel: string;
  /** 时长（秒）。官方 H3 为 4~15（优云智算版放宽到 4~30），Hailuo 只能是 6 或 10。 */
  minimaxDuration: number;
  /** `480P` / `768P` / `1080P` / `2K`，实际有效档位取决于模型。 */
  minimaxResolution: string;
  minimaxPromptOptimizer: boolean;
  minimaxTimeoutMs: number;

  /**
   * **视频改用本机 ComfyUI 生成**（免费、纯本地；默认关）。
   *
   * 打开后，转圈视频 / 八方向视频 / 序列帧视频都提交给本机 ComfyUI，生图仍然
   * 走火山方舟 Seedream（ComfyUI 侧只接管视频这条链路）。提示词、首帧图、
   * 尺寸、时长、种子会被**注入**到 `comfyWorkflow` 的对应输入里：先自动探测
   * （按输入名），探测不准时用下面的 Target 手工指定。
   */
  comfyVideo: boolean;
  comfyBaseUrl: string;
  /**
   * 访问 ComfyUI 时附带的 `Cookie` 头（反代鉴权用）；空 = 不带。
   *
   * 和 API Key 同一档待遇：落盘明文，但**从不回传浏览器**——配置视图里只有
   * `comfyCookiesSet` / `comfyCookiesHint`，界面留空即「不修改」。
   */
  comfyCookies: string;
  /**
   * API 格式的工作流 JSON 文本。
   *
   * ⚠️ 必须是 ComfyUI 的 **API 格式**（`{节点id: {class_type, inputs}}`），
   * 不是界面里「导出」得到的带 nodes / links 数组的那种。
   */
  comfyWorkflow: string;
  /** 注入点覆盖，形如 `1.text`；空 = 自动探测。 */
  comfyPromptTarget: string;
  comfyFirstFrameTarget: string;
  /** 0 = 用工作流里自带的尺寸 / 时长。 */
  comfyWidth: number;
  comfyHeight: number;
  comfySeconds: number;
  /** 0 = 每次提交都注入随机种子（避开 ComfyUI 的结果缓存）。 */
  comfySeed: number;
  comfyTimeoutMs: number;

  /** 最终整图单格宽高（像素）。 */
  cellWidth: number;
  cellHeight: number;
  /** 每个视频平均提取多少帧。 */
  frameCount: number;
  /** 角色在单格内的缩放方式。 */
  fitMode: "contain" | "stretch";
  /**
   * 抽帧的工作尺寸（长边像素）。合成时的自动裁剪与缩放都在这个分辨率上做，
   * 所以它决定了角色的实际清晰度上限。
   */
  workingLongEdge: number;
  /**
   * 像素块边长（输出像素）。0/1 = 关闭像素化。
   * 合成时每一块单独做盒式平均再填满整块，得到真正的硬边方块——
   * 这是确定性的后处理，不依赖生图或视频模型「愿意画像素画」。
   */
  pixelSize: number;
  /** 自动裁剪到角色包围盒（所有帧共用同一个框），让角色填满格子。 */
  autoCrop: boolean;
  /** 自动裁剪后角色占格子的比例 0.5~1。 */
  fillRatio: number;
  /** 角色在格子底部的留白像素（脚底对齐基线）。 */
  bottomMargin: number;
  /** 提取帧时先裁剪掉的边缘比例（0~0.2），用于去掉视频边缘噪点。 */
  cropInset: number;

  /** 抠像底色（`#RRGGBB`，默认纯绿 #00FF00）。角色穿绿衣服时改成蓝 / 品红等。 */
  keyColor: string;
  /** 抠像阈值：绿色优势值（或与 keyColor 的 RGB 距离）低于 keyLow 视为前景，高于 keyHigh 视为背景。 */
  keyLow: number;
  keyHigh: number;
  /** 去绿溢出强度 0~1。 */
  despill: number;
  /**
   * 背景洪水填充的颜色容差（0~120）。0 = 只按绿色判据抠像。
   * 图生视频经常把纯色背景重新打光成渐变，只认绿色会在那些帧上整片失效。
   */
  bgTolerance: number;
  /** 前景边缘收缩（像素），用于去掉残留绿边。 */
  edgeShrink: number;

  /** 整图行序。 */
  rowOrder: string[];
  rowOrderVersion: number;

  /**
   * **音乐生成编辑（模块七）**。
   *
   * 目前只接谱乐 AI（`puyue`）。`musicApiKey` 与其它凭据同一档：落盘明文，
   * 但**从不回传浏览器**（配置视图里只有 `musicApiKeySet` / hint）。
   */
  musicProvider: "puyue";
  musicApiKey: string;
  /** 谱乐 AI Open API 根地址（不含 `/v1`；用户填了会自动剥掉）。 */
  musicBaseUrl: string;
  /** 默认音乐模型（新建任务 / 未指定时的兜底；任务里可覆盖）。 */
  musicModel: string;
  /** 单次 HTTP 请求超时（毫秒）。 */
  musicTimeoutMs: number;
  /** 一次生成从提交到「不再等待」的总时长（毫秒）。 */
  musicPollTimeoutMs: number;
  /**
   * **谱曲模式（本地 MIDI）**的依赖路径。空串 = 自动探测。
   *
   * - `musicPythonPath`：能 `import scoremill` 的 Python 解释器（venv 里的也行）。
   * - `musicFluidsynthPath`：FluidSynth 可执行文件；找不到就用内置简易音源。
   * - `musicSoundfontPath`：.sf2 音源；找不到同样退回内置音源。
   */
  musicPythonPath: string;
  musicFluidsynthPath: string;
  musicSoundfontPath: string;

  /**
   * **音效生成（模块八，火山引擎 Seed-Audio）**。
   *
   * `sfxApiKey` 与其它凭据同一档：落盘明文，但**从不回传浏览器**。
   * 注意它是**语音控制台**的 API Key（请求头 `X-Api-Key`），不是火山方舟的
   * `ARK_API_KEY`——两者不能混用。
   */
  sfxProvider: "volcengine";
  sfxApiKey: string;
  /** 语音服务根地址（不含 `/api/v3/tts/create`）。 */
  sfxBaseUrl: string;
  /** 默认模型；短名 `seed-audio-1.0`，不是方舟的 `doubao-seed-audio-1-0`。 */
  sfxModel: string;
  sfxFormat: SfxFormat;
  sfxSampleRate: number;
  sfxTimeoutMs: number;

  /**
   * **被隐藏的功能模块**（`links.ts` 的 `STUDIO_MODULES` 子集）。
   *
   * 「隐藏」是**双向**的：界面上不再出现这个模块的页签与入口，对话工具面也
   * 拒绝对它的任何调用（`game_material({action:'call'})` / `status` / `review` … 一律报错）。
   * 只挡界面不挡工具等于没挡——模型照样能调 `runIsoGenerate` 等本地方法。
   *
   * 空数组（默认）= 八个模块全部可见。全隐藏是允许的：面板会显示一句空态。
   */
  hiddenModules: string[];

  /** 并发请求数（生图 / 视频 / 抽帧各自受限）。 */
  concurrency: number;
}

export const DEFAULT_CONFIG: Config = {
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
  sfxFormat: SFX_DEFAULT_FORMAT as SfxFormat,
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

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return fallback;
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
export function normalizeHiddenModules(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const wanted = new Set(value.filter((key): key is string => typeof key === "string"));
  return STUDIO_MODULES.filter((key) => wanted.has(key));
}

/** 把任意读入的 JSON 收敛成一份合法配置，缺项一律回落默认值。 */
export function normalizeConfig(input: unknown): Config {
  const raw = (input ?? {}) as Record<string, unknown>;
  const rowOrderRaw = Array.isArray(raw.rowOrder) ? raw.rowOrder.filter((k): k is string => typeof k === "string") : [];
  // 一次性迁移：只有「没有版本号」的旧配置才会被迁到罗盘顺序。
  const needsOrderMigration = raw.rowOrderVersion === undefined && isLegacyRowOrder(rowOrderRaw);
  const rowOrder =
    rowOrderRaw.length === 0 || needsOrderMigration ? [...DEFAULT_ROW_ORDER] : rowOrderRaw;
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
    toapisVideoAspectRatio: ["16:9","9:16","1:1","4:3","3:4","21:9"].includes(asString(raw.toapisVideoAspectRatio, "16:9")) ? asString(raw.toapisVideoAspectRatio, "16:9") : "16:9",
    toapisTimeoutMs: asInt(raw.toapisTimeoutMs, DEFAULT_CONFIG.toapisTimeoutMs, 10000, 3600000),
    imageProvider: raw.imageProvider === "toapis" ? "toapis" : raw.imageProvider === "custom" ? "custom" : "ark",
    customProtocol: (CUSTOM_PROTOCOLS as readonly string[]).includes(String(raw.customProtocol))
      ? (raw.customProtocol as CustomProtocol)
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

let cache: Config | undefined;

export async function loadConfig(): Promise<Config> {
  if (cache !== undefined) return cache;
  try {
    const text = await readFile(configPath(), "utf8");
    cache = normalizeConfig(JSON.parse(text));
  } catch {
    cache = { ...DEFAULT_CONFIG, rowOrder: [...DEFAULT_ROW_ORDER], hiddenModules: [] };
  }
  return cache;
}

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
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

/** 回传给浏览器的脱敏视图：只说明 key 是否已配置，以及尾部 4 位。 */
export interface ConfigView extends Omit<Config, "toapisApiKey" | "arkApiKey" | "minimaxApiKey" | "customApiKey" | "comfyCookies" | "musicApiKey" | "sfxApiKey"> {
  toapisApiKeySet: boolean;
  toapisApiKeyHint: string;
  arkApiKeySet: boolean;
  arkApiKeyHint: string;
  minimaxApiKeySet: boolean;
  minimaxApiKeyHint: string;
  customApiKeySet: boolean;
  customApiKeyHint: string;
  comfyCookiesSet: boolean;
  comfyCookiesHint: string;
  musicApiKeySet: boolean;
  musicApiKeyHint: string;
  sfxApiKeySet: boolean;
  sfxApiKeyHint: string;
}

export function maskConfig(config: Config): ConfigView {
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

function hintOf(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") return "";
  if (trimmed.length <= 8) return "已配置";
  return `…${trimmed.slice(-4)}`;
}
