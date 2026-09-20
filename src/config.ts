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
import { capabilityOf, normalizeDuration, normalizeResolution, rootOf } from "./minimax.js";

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

export interface Config {
  /** 火山方舟（Ark）API Key。 */
  arkApiKey: string;
  arkBaseUrl: string;
  /** 生图模型 ID，也支持推理接入点 ID（ep-xxxx）。 */
  arkModel: string;
  /** `2K` / `1K` / `4K`，或显式 `宽x高`。 */
  arkSize: string;
  arkWatermark: boolean;
  /** 请求超时（毫秒）。 */
  arkTimeoutMs: number;

  /** MiniMax API Key。 */
  minimaxApiKey: string;
  /**
   * **主机根地址**（不含 /v1、/v2）。CN 平台是 https://api.minimax.cn，
   * 优云智算（MiniMax H3）是 https://cp.compshare.cn（路径自动多一层 /minimax）。
   */
  minimaxBaseUrl: string;
  /** 图生视频模型：MiniMax-H3 / H3-Max 走 v2 协议，Hailuo / I2V 走 v1。 */
  minimaxModel: string;
  /** 时长（秒）。官方 H3 为 4~15（优云智算版放宽到 4~30），Hailuo 只能是 6 或 10。 */
  minimaxDuration: number;
  /** `480P` / `768P` / `1080P` / `2K`，实际有效档位取决于模型。 */
  minimaxResolution: string;
  minimaxPromptOptimizer: boolean;
  minimaxTimeoutMs: number;

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

  /** 抠绿阈值：绿色优势值低于 keyLow 视为前景，高于 keyHigh 视为背景。 */
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

  /** 并发请求数（生图 / 视频 / 抽帧各自受限）。 */
  concurrency: number;
}

export const DEFAULT_CONFIG: Config = {
  arkApiKey: "",
  arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  arkModel: "doubao-seedream-4-0-250828",
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

  keyLow: 14,
  keyHigh: 80,
  despill: 0.65,
  bgTolerance: 90,
  edgeShrink: 0,

  rowOrder: [...DEFAULT_ROW_ORDER],
  rowOrderVersion: ROW_ORDER_VERSION,
  concurrency: 3
};

export const ARK_MODEL_PRESETS = [
  { id: "doubao-seedream-4-0-250828", label: "Seedream 4.0（通用、支持图组）" },
  { id: "doubao-seedream-4-5-251128", label: "Seedream 4.5" },
  { id: "doubao-seedream-5-0-260128", label: "Seedream 5.0 Lite（支持 PNG 输出）" },
  { id: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro（单图质量最好）" }
];

export const MINIMAX_HOST_PRESETS = [
  { id: "https://api.minimaxi.com", label: "国际站 api.minimaxi.com" },
  { id: "https://api.minimax.cn", label: "国内站 api.minimax.cn" },
  { id: "https://cp.compshare.cn", label: "优云智算 cp.compshare.cn（MiniMax H3）" }
];

export const MINIMAX_MODEL_PRESETS = [
  { id: "MiniMax-H3", label: "MiniMax-H3（v2 · 768P/2K · 4~15 秒，推荐）" },
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

  // 视频参数都跟着模型走：换到 H3 之后旧的 `1080P` / `6 秒` 未必合法。
  // 分辨率/时长同时受主机影响（优云智算的 H3 支持 1080P、4~30 秒）。
  const minimaxModel = asString(raw.minimaxModel, DEFAULT_CONFIG.minimaxModel);
  const minimaxBaseUrl = rootOf(asString(raw.minimaxBaseUrl, DEFAULT_CONFIG.minimaxBaseUrl)) || DEFAULT_CONFIG.minimaxBaseUrl;
  const minimaxDuration = normalizeDuration(minimaxModel, raw.minimaxDuration ?? DEFAULT_CONFIG.minimaxDuration, minimaxBaseUrl);
  const minimaxResolution = normalizeResolution(minimaxModel, raw.minimaxResolution ?? DEFAULT_CONFIG.minimaxResolution, minimaxBaseUrl);

  return {
    arkApiKey: asString(raw.arkApiKey, DEFAULT_CONFIG.arkApiKey),
    arkBaseUrl: asString(raw.arkBaseUrl, DEFAULT_CONFIG.arkBaseUrl).replace(/\/+$/, ""),
    arkModel: asString(raw.arkModel, DEFAULT_CONFIG.arkModel),
    arkSize: asString(raw.arkSize, DEFAULT_CONFIG.arkSize),
    arkWatermark: asBool(raw.arkWatermark, DEFAULT_CONFIG.arkWatermark),
    arkTimeoutMs: asInt(raw.arkTimeoutMs, DEFAULT_CONFIG.arkTimeoutMs, 10000, 900000),

    minimaxApiKey: asString(raw.minimaxApiKey, DEFAULT_CONFIG.minimaxApiKey),
    minimaxBaseUrl,
    minimaxModel,
    minimaxDuration,
    minimaxResolution,
    minimaxPromptOptimizer: asBool(raw.minimaxPromptOptimizer, DEFAULT_CONFIG.minimaxPromptOptimizer),
    minimaxTimeoutMs: asInt(raw.minimaxTimeoutMs, DEFAULT_CONFIG.minimaxTimeoutMs, 10000, 900000),

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

    keyLow,
    keyHigh,
    despill: asNumber(raw.despill, DEFAULT_CONFIG.despill, 0, 1),
    bgTolerance: asInt(raw.bgTolerance, DEFAULT_CONFIG.bgTolerance, 0, 160),
    edgeShrink: asInt(raw.edgeShrink, DEFAULT_CONFIG.edgeShrink, 0, 8),

    rowOrder,
    rowOrderVersion: ROW_ORDER_VERSION,
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
    cache = { ...DEFAULT_CONFIG, rowOrder: [...DEFAULT_ROW_ORDER] };
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
export interface ConfigView extends Omit<Config, "arkApiKey" | "minimaxApiKey"> {
  arkApiKeySet: boolean;
  arkApiKeyHint: string;
  minimaxApiKeySet: boolean;
  minimaxApiKeyHint: string;
}

export function maskConfig(config: Config): ConfigView {
  const { arkApiKey, minimaxApiKey, ...rest } = config;
  return {
    ...rest,
    rowOrder: [...config.rowOrder],
    arkApiKeySet: arkApiKey.trim() !== "",
    arkApiKeyHint: hintOf(arkApiKey),
    minimaxApiKeySet: minimaxApiKey.trim() !== "",
    minimaxApiKeyHint: hintOf(minimaxApiKey)
  };
}

function hintOf(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") return "";
  if (trimmed.length <= 8) return "已配置";
  return `…${trimmed.slice(-4)}`;
}
