/**
 * 骨骼动画生成模块（第四个物料模块）。
 *
 * 把参考项目 [spine-animation-ai](https://github.com/GenielabsOpenSource/spine-animation-ai)
 * 的整条 Python 流水线搬进插件，并且**拆成可单独重跑的四个阶段**——参考项目是一条
 * 跑到底的脚本，任何一步出问题都只能从头再来；这里每一步都有自己的状态、验收打标
 * 与单独重跑入口，和八方向图模块的手感保持一致。
 *
 * ```
 * ① parts  拆件   ：生图模型把角色拆成部件 → 连通域分割 → 逐件透明 PNG
 *                   （也可以跳过生图，直接上传现成的部件 PNG）
 * ② layout 装配   ：多尺度模板匹配把每个部件摆回参考图 → 合成对比图供肉眼验收
 * ③ rig    骨骼   ：自动推骨骼层级 + 六个动画预设 → skeleton.json + 自包含预览
 * ④ atlas  图集   ：打包成 Spine 纹理图集（.png + .atlas），可直接导入引擎
 * ```
 *
 * 目录结构：
 *   <DSH_HOME>/game-material-master/rig-jobs/<任务 id>/
 *     job.json          任务状态（本文件的 RigJob）
 *     source/           用户上传的角色参考图
 *     sheet/            生图模型产出的「拆件摊平图」
 *     parts/            分割后的部件透明 PNG
 *     layout/           装配结果：layout.json / composite.png / comparison.png
 *     rig/              skeleton.json / preview.html
 *     atlas/            skeleton.png / skeleton.atlas
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig, rigJobsRoot } from "./config.js";
import { generateImage } from "./ark.js";
import { decodeToRgba, mimeOf, toDataUri } from "./media.js";
import { encodePng } from "./png.js";
import { appendJobLog, messageOf, readJson, writeJsonAtomic, type JobLogEntry } from "./jsonio.js";
import { safeName, sniffImage } from "./imagegen.js";
import {
  blitRgba,
  boxMask,
  compositeParts,
  createRgba,
  detectBackground,
  groupComponentsByProximity,
  resizeRgba,
  segmentWithLabels,
  sideBySide,
  solveLayout,
  type Rgba
} from "./rigpose.js";
import {
  DEFAULT_DRAW_ORDER,
  RIG_ANIMATIONS,
  RIG_GRID_COLUMNS,
  RIG_GRID_ROWS,
  buildAtlasText,
  buildSkeleton,
  defaultAnimationIds,
  defaultPartNames,
  drawRankOf,
  isAnimationId,
  packAtlas,
  partLabel,
  type RigPlacedPart
} from "./spine.js";
import { buildPreviewHtml } from "./rigpreview.js";
import type { NodeStatus } from "./store.js";

export type RigStageKey = "parts" | "layout" | "rig" | "atlas";

export const RIG_STAGES: Array<{ key: RigStageKey; label: string; summary: string }> = [
  { key: "parts", label: "① 拆件", summary: "把角色拆成独立部件（头/躯干/四肢），逐件透明 PNG" },
  { key: "layout", label: "② 装配", summary: "把部件摆回参考姿态，出合成对比图供肉眼验收" },
  { key: "rig", label: "③ 骨骼动画", summary: "自动推骨骼层级 + 待机/行走/奔跑/挥手/跳跃/攻击" },
  { key: "atlas", label: "④ 图集", summary: "打包 Spine 纹理图集，可直接导入引擎" }
];

export interface RigPartNode {
  name: string;
  label: string;
  status: NodeStatus;
  /** 相对任务目录的路径。 */
  file?: string;
  width?: number;
  height?: number;
  /** 在拆件摊平图里的格子坐标（诊断用）。 */
  gridX?: number;
  gridY?: number;
  opacity?: number;
  source: "generated" | "uploaded";
  approved?: boolean;
  /** 用户手动隐藏的部件（不参与装配与导出）。 */
  hidden?: boolean;
  error?: string;
  updatedAt?: number;
}

export interface RigSheetState {
  status: NodeStatus;
  file?: string;
  width?: number;
  height?: number;
  error?: string;
  approved?: boolean;
  updatedAt?: number;
}

export interface RigLayoutItem {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  z: number;
  score?: number;
  coverage?: number;
  /** 是否成功匹配到参考图；false 表示需要人工摆放。 */
  matched: boolean;
  /** 用户手工调整过。 */
  manual?: boolean;
}

/**
 * 视觉先验：由多模态模型看一眼参考图 + 拆件图之后给出的「这块大概在哪」。
 * 坐标是**参考图完整分辨率下的像素框**，不需要精确。
 */
export interface RigLayoutHint {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RigLayoutState {
  status: NodeStatus;
  approved?: boolean;
  error?: string;
  /** 部件叠在参考姿态上的合成图。 */
  composite?: string;
  /** 「参考图 | 合成图」左右对比，验收就用它。 */
  comparison?: string;
  /** 装配用的全局缩放（拆件图像素 → 参考图像素）。 */
  hint?: number;
  /** 各部件相似度的均值：低于 0.45 通常意味着拆件图与参考图不是同一个角色。 */
  meanScore?: number;
  /** 遮挡投票给出的层级建议。 */
  suggestedOrder?: string[];
  /** 因冲突/遮挡被重新定位过的部件。 */
  moved?: string[];
  resolved?: string[];
  /** 逐部件结果，键是部件名。 */
  items: Record<string, RigLayoutItem>;
  /** 视觉先验，键是部件名。装配时会优先在框内搜索。 */
  hints?: Record<string, RigLayoutHint>;
  updatedAt?: number;
}

export interface RigRigState {
  status: NodeStatus;
  approved?: boolean;
  error?: string;
  skeleton?: string;
  preview?: string;
  bones?: number;
  slots?: number;
  animations?: string[];
  warnings?: string[];
  updatedAt?: number;
}

export interface RigAtlasState {
  status: NodeStatus;
  approved?: boolean;
  error?: string;
  image?: string;
  text?: string;
  width?: number;
  height?: number;
  regions?: number;
  updatedAt?: number;
}

export interface RigJob {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source?: { file: string; name: string; width: number; height: number };
  prompts: { sheet: string; suffix: string };
  settings: {
    model: string;
    size: string;
    watermark: boolean;
    gridColumns: number;
    gridRows: number;
    /** 底色容差：与底色距离小于它的像素算背景。 */
    backgroundTolerance: number;
    feather: number;
    /** 小于该面积的连通域丢弃。 */
    minArea: number;
    partPadding: number;
    /** 匹配用的长边上限。 */
    matchLongEdge: number;
    animations: string[];
  };
  sheet: RigSheetState;
  parts: RigPartNode[];
  layout: RigLayoutState;
  rig: RigRigState;
  atlas: RigAtlasState;
  reviewMode?: "auto" | "manual";
  log: JobLogEntry[];
}

export interface RigJobSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  hasSource: boolean;
  partCount: number;
  placedCount: number;
  rigReady: boolean;
  atlasReady: boolean;
}

const JOB_ID_PATTERN = /^r[a-z0-9]{4,40}$/;

export function rigJobDir(id: string): string {
  return join(rigJobsRoot(), id);
}

function jobFile(id: string): string {
  return join(rigJobDir(id), "job.json");
}

/** 任务内相对路径 → 绝对路径，并挡住目录穿越。 */
export function rigAssetPath(id: string, relative: string): string {
  const base = resolve(rigJobDir(id));
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`非法的任务内路径：${relative}`);
  return target;
}

export function isValidRigJobId(id: string): boolean {
  return JOB_ID_PATTERN.test(id);
}

export async function ensureRigJobLayout(id: string): Promise<void> {
  for (const sub of ["source", "sheet", "parts", "layout", "rig", "atlas"]) {
    await mkdir(join(rigJobDir(id), sub), { recursive: true });
  }
}

// ── 拆件提示词 ──────────────────────────────────────────────────────────

/**
 * 拆件提示词。
 *
 * 参考项目直接把「把所有部件摊开」交给模型，然后靠连通域分割，部件叫什么全靠
 * 事后猜。这里额外要求模型**按严格网格摆放**：格子位置 = 部件身份，是确定事实，
 * 于是「头」真的是头，骨骼层级和动画预设才能自动套上去，而不必让用户手工命名
 * 十几个文件。
 */
export function buildSheetPrompt(columns: number, rows: number, names: string[]): string {
  const grid: string[] = [];
  for (let row = 0; row < rows; row++) {
    const cells: string[] = [];
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      cells.push(names[index] ?? "-");
    }
    grid.push(`row ${row + 1}: ${cells.join(" | ")}`);
  }
  return [
    "A flat 2D game sprite sheet for skeletal (Spine) cut-out animation, showing the EXACT same character as the reference image, completely taken apart into separate body parts.",
    "",
    `The image is a SQUARE canvas divided into an even ${columns} × ${rows} grid of equal cells. Each cell contains exactly ONE detached body part, centered in its cell. Cells in reading order:`,
    ...grid,
    "",
    "Hard requirements:",
    "- the canvas is square and the grid lines are perfectly even; every cell is the same size;",
    "- exactly one body part per cell, and nothing else in that cell;",
    "- every part is COMPLETELY DETACHED: upper arm and forearm and hand are three separate pieces, never joined; upper leg, lower leg and foot are three separate pieces, never joined;",
    "- no piece crosses a cell boundary, no piece touches or overlaps another piece;",
    "- generous empty white space around every piece;",
    "- parts are NOT assembled: no standing character, no connected body;",
    "- CRITICAL: identical art style, identical shading, identical face, identical colours and identical proportions as the reference image;",
    "- plain solid pure white background everywhere, flat 2D game asset, character part sheet;",
    "",
    "Negative: assembled body, connected limbs, joined arm, joined leg, overlapping parts, grid lines drawn, borders, labels, text, watermark, drop shadows, gradients, background scenery, 3D, realistic, redesigned character, different face, different colours."
  ].join("\n");
}

export function buildSheetRequest(job: RigJob): string {
  const base = job.prompts.sheet.trim() === "" ? buildSheetPrompt(job.settings.gridColumns, job.settings.gridRows, rigSlotNames(job)) : job.prompts.sheet;
  const suffix = job.prompts.suffix.trim();
  return suffix === "" ? base : `${base}\n${suffix}`;
}

/** 网格槽位名：优先用用户已经存在的部件名，否则用默认 16 件套。 */
export function rigSlotNames(job: RigJob): string[] {
  const defaults = defaultPartNames();
  const count = job.settings.gridColumns * job.settings.gridRows;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(defaults[i] ?? `slot-${i + 1}`);
  return out;
}

// ── 持久化 ──────────────────────────────────────────────────────────────

export async function createRigJob(name: string): Promise<RigJob> {
  const config = await loadConfig();
  const id = `r${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const now = Date.now();
  const job: RigJob = {
    id,
    name: name.trim() === "" ? "未命名骨骼动画任务" : name.trim().slice(0, 80),
    createdAt: now,
    updatedAt: now,
    prompts: { sheet: "", suffix: "" },
    settings: {
      model: config.arkModel,
      size: config.arkSize,
      watermark: config.arkWatermark,
      gridColumns: RIG_GRID_COLUMNS,
      gridRows: RIG_GRID_ROWS,
      backgroundTolerance: 30,
      feather: 26,
      minArea: 0,
      partPadding: 4,
      matchLongEdge: 448,
      animations: defaultAnimationIds()
    },
    sheet: { status: "empty" },
    parts: [],
    layout: { status: "empty", items: {} },
    rig: { status: "empty" },
    atlas: { status: "empty" },
    log: []
  };
  await ensureRigJobLayout(id);
  await writeJsonAtomic(jobFile(id), job);
  return job;
}

export async function readRigJob(id: string): Promise<RigJob | undefined> {
  if (!isValidRigJobId(id)) return undefined;
  const raw = await readJson<RigJob>(jobFile(id));
  if (raw === undefined) return undefined;
  return normalizeRigJob(raw);
}

export async function writeRigJob(job: RigJob): Promise<void> {
  job.updatedAt = Date.now();
  await writeJsonAtomic(jobFile(job.id), job);
}

export async function listRigJobs(): Promise<RigJobSummary[]> {
  const { readdir } = await import("node:fs/promises");
  let entries: string[] = [];
  try {
    const dirents = await readdir(rigJobsRoot(), { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory() && isValidRigJobId(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  const out: RigJobSummary[] = [];
  for (const id of entries) {
    const job = await readRigJob(id);
    if (job === undefined) continue;
    out.push(summarizeRigJob(job));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function summarizeRigJob(job: RigJob): RigJobSummary {
  return {
    id: job.id,
    name: job.name,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    hasSource: job.source !== undefined,
    partCount: job.parts.filter((part) => part.status === "ready").length,
    placedCount: Object.values(job.layout.items).filter((item) => item.matched).length,
    rigReady: job.rig.status === "ready",
    atlasReady: job.atlas.status === "ready"
  };
}

export async function deleteRigJob(id: string): Promise<void> {
  stopRigPoller(id);
  await rm(rigJobDir(id), { recursive: true, force: true });
}

export async function rigJobExists(id: string): Promise<boolean> {
  try {
    return (await stat(rigJobDir(id))).isDirectory();
  } catch {
    return false;
  }
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(num(value, fallback))));
}

function normalizeRigJob(raw: any): RigJob {
  const parts: RigPartNode[] = Array.isArray(raw?.parts)
    ? raw.parts
        .filter((part: any) => typeof part?.name === "string")
        .map((part: any) => ({
          name: String(part.name),
          label: typeof part.label === "string" ? part.label : partLabel(String(part.name)),
          status: (part.status ?? "empty") as NodeStatus,
          file: typeof part.file === "string" ? part.file : undefined,
          width: Number.isFinite(part.width) ? part.width : undefined,
          height: Number.isFinite(part.height) ? part.height : undefined,
          gridX: Number.isFinite(part.gridX) ? part.gridX : undefined,
          gridY: Number.isFinite(part.gridY) ? part.gridY : undefined,
          opacity: Number.isFinite(part.opacity) ? part.opacity : undefined,
          source: part.source === "uploaded" ? "uploaded" : "generated",
          approved: part.approved === true,
          hidden: part.hidden === true,
          error: typeof part.error === "string" ? part.error : undefined,
          updatedAt: Number.isFinite(part.updatedAt) ? part.updatedAt : undefined
        }))
    : [];

  const items: Record<string, RigLayoutItem> = {};
  const rawItems = raw?.layout?.items;
  if (rawItems !== null && typeof rawItems === "object") {
    for (const [name, value] of Object.entries<any>(rawItems)) {
      items[name] = {
        x: num(value?.x, 0),
        y: num(value?.y, 0),
        width: Math.max(1, num(value?.width, 1)),
        height: Math.max(1, num(value?.height, 1)),
        scale: num(value?.scale, 1),
        rotation: num(value?.rotation, 0),
        z: num(value?.z, 0),
        score: Number.isFinite(value?.score) ? value.score : undefined,
        coverage: Number.isFinite(value?.coverage) ? value.coverage : undefined,
        matched: value?.matched !== false,
        manual: value?.manual === true
      };
    }
  }

  const animations = Array.isArray(raw?.settings?.animations)
    ? raw.settings.animations.filter((value: unknown) => isAnimationId(value))
    : [];

  return {
    id: String(raw?.id ?? ""),
    name: typeof raw?.name === "string" && raw.name.trim() !== "" ? raw.name : "未命名骨骼动画任务",
    createdAt: num(raw?.createdAt, Date.now()),
    updatedAt: num(raw?.updatedAt, Date.now()),
    source:
      typeof raw?.source?.file === "string"
        ? {
            file: raw.source.file,
            name: String(raw.source.name ?? basename(raw.source.file)),
            width: num(raw.source.width, 0),
            height: num(raw.source.height, 0)
          }
        : undefined,
    prompts: {
      sheet: typeof raw?.prompts?.sheet === "string" ? raw.prompts.sheet : "",
      suffix: typeof raw?.prompts?.suffix === "string" ? raw.prompts.suffix : ""
    },
    settings: {
      model: typeof raw?.settings?.model === "string" ? raw.settings.model : "",
      size: typeof raw?.settings?.size === "string" ? raw.settings.size : "2K",
      watermark: raw?.settings?.watermark === true,
      gridColumns: clampInt(raw?.settings?.gridColumns, RIG_GRID_COLUMNS, 1, 8),
      gridRows: clampInt(raw?.settings?.gridRows, RIG_GRID_ROWS, 1, 8),
      backgroundTolerance: clampInt(raw?.settings?.backgroundTolerance, 30, 1, 200),
      feather: clampInt(raw?.settings?.feather, 26, 1, 200),
      minArea: clampInt(raw?.settings?.minArea, 0, 0, 100000),
      partPadding: clampInt(raw?.settings?.partPadding, 4, 0, 64),
      matchLongEdge: clampInt(raw?.settings?.matchLongEdge, 448, 128, 1024),
      animations: animations.length > 0 ? animations : defaultAnimationIds()
    },
    sheet: {
      status: (raw?.sheet?.status ?? "empty") as NodeStatus,
      file: typeof raw?.sheet?.file === "string" ? raw.sheet.file : undefined,
      width: Number.isFinite(raw?.sheet?.width) ? raw.sheet.width : undefined,
      height: Number.isFinite(raw?.sheet?.height) ? raw.sheet.height : undefined,
      error: typeof raw?.sheet?.error === "string" ? raw.sheet.error : undefined,
      approved: raw?.sheet?.approved === true,
      updatedAt: Number.isFinite(raw?.sheet?.updatedAt) ? raw.sheet.updatedAt : undefined
    },
    parts,
    layout: {
      status: (raw?.layout?.status ?? "empty") as NodeStatus,
      approved: raw?.layout?.approved === true,
      error: typeof raw?.layout?.error === "string" ? raw.layout.error : undefined,
      composite: typeof raw?.layout?.composite === "string" ? raw.layout.composite : undefined,
      comparison: typeof raw?.layout?.comparison === "string" ? raw.layout.comparison : undefined,
      hint: Number.isFinite(raw?.layout?.hint) ? raw.layout.hint : undefined,
      meanScore: Number.isFinite(raw?.layout?.meanScore) ? raw.layout.meanScore : undefined,
      suggestedOrder: Array.isArray(raw?.layout?.suggestedOrder) ? raw.layout.suggestedOrder.map(String) : undefined,
      moved: Array.isArray(raw?.layout?.moved) ? raw.layout.moved.map(String) : undefined,
      resolved: Array.isArray(raw?.layout?.resolved) ? raw.layout.resolved.map(String) : undefined,
      items,
      hints: normalizeHints(raw?.layout?.hints),
      updatedAt: Number.isFinite(raw?.layout?.updatedAt) ? raw.layout.updatedAt : undefined
    },
    rig: {
      status: (raw?.rig?.status ?? "empty") as NodeStatus,
      approved: raw?.rig?.approved === true,
      error: typeof raw?.rig?.error === "string" ? raw.rig.error : undefined,
      skeleton: typeof raw?.rig?.skeleton === "string" ? raw.rig.skeleton : undefined,
      preview: typeof raw?.rig?.preview === "string" ? raw.rig.preview : undefined,
      bones: Number.isFinite(raw?.rig?.bones) ? raw.rig.bones : undefined,
      slots: Number.isFinite(raw?.rig?.slots) ? raw.rig.slots : undefined,
      animations: Array.isArray(raw?.rig?.animations) ? raw.rig.animations.map(String) : undefined,
      warnings: Array.isArray(raw?.rig?.warnings) ? raw.rig.warnings.map(String) : undefined,
      updatedAt: Number.isFinite(raw?.rig?.updatedAt) ? raw.rig.updatedAt : undefined
    },
    atlas: {
      status: (raw?.atlas?.status ?? "empty") as NodeStatus,
      approved: raw?.atlas?.approved === true,
      error: typeof raw?.atlas?.error === "string" ? raw.atlas.error : undefined,
      image: typeof raw?.atlas?.image === "string" ? raw.atlas.image : undefined,
      text: typeof raw?.atlas?.text === "string" ? raw.atlas.text : undefined,
      width: Number.isFinite(raw?.atlas?.width) ? raw.atlas.width : undefined,
      height: Number.isFinite(raw?.atlas?.height) ? raw.atlas.height : undefined,
      regions: Number.isFinite(raw?.atlas?.regions) ? raw.atlas.regions : undefined,
      updatedAt: Number.isFinite(raw?.atlas?.updatedAt) ? raw.atlas.updatedAt : undefined
    },
    reviewMode: raw?.reviewMode === "manual" ? "manual" : raw?.reviewMode === "auto" ? "auto" : undefined,
    log: Array.isArray(raw?.log) ? raw.log.slice(-200) : []
  };
}

// ── 对外视图 ────────────────────────────────────────────────────────────

/**
 * 任务视图：界面与对话工具用的是**同一份形状**。
 *
 * 这里刻意做成「原始任务 + 算好的派生字段」的超集：
 *   - 界面需要原始字段（`settings` / `prompts` / `layout.items`）来编辑；
 *   - 对话工具需要派生字段（每个产物的绝对 URL、逐阶段状态、未命中清单）。
 * 两处各拼一份的话，字段名迟早会漂移——实测就踩过：界面按派生字段写、
 * 网关却返回原始任务，结果按钮因为读不到 `sourceUrl` 一直是灰的。
 *
 * `origin` 为空时返回**相对路径**（浏览器直接用）；工具侧传 origin，
 * 拿到的是可以直接贴给用户的绝对 URL。
 */
/**
 * 递归丢掉 `undefined` 属性。
 *
 * 工具返回值必须是**无损 JSON**：`undefined` 一旦出现在对象里，序列化时会静默
 * 丢掉那个键，宿主据此判定「结果不是无损 JSON」并直接让整个工具调用报错
 * （实测表现是 `game_material_status` / `game_material_wait` / `getRigJob`
 * 全部返回 `value is not lossless JSON`）。视图里有大量可选字段，逐个写
 * `?? null` 太容易漏，统一在出口处清一遍。
 */
function lossless<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => lossless(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = lossless(item);
    }
    return out as unknown as T;
  }
  return value;
}

export function rigSnapshot(job: RigJob, origin = "") {
  const assetBase = `${origin}/dsh-game-material-master/rig-assets/${job.id}/`;
  const url = (relative: string | undefined): string | undefined =>
    typeof relative === "string" && relative !== "" ? `${assetBase}${relative}` : undefined;
  const items = job.layout.items;

  const parts = job.parts.map((part) => {
    const item = items[part.name];
    return {
      name: part.name,
      label: part.label,
      status: part.status,
      source: part.source,
      hidden: part.hidden === true,
      approved: part.approved === true,
      width: part.width,
      height: part.height,
      opacity: part.opacity,
      gridX: part.gridX,
      gridY: part.gridY,
      file: part.file,
      url: url(part.file),
      placed: item !== undefined && item.matched === true,
      manual: item?.manual === true,
      score: item?.score,
      coverage: item?.coverage,
      error: part.error
    };
  });

  const stages = [
    {
      stage: "parts" as const,
      title: "① 拆件",
      status: job.sheet.status,
      approved: job.sheet.approved === true,
      url: url(job.sheet.file),
      file: job.sheet.file,
      error: job.sheet.error,
      partReady: parts.filter((part) => part.status === "ready").length
    },
    {
      stage: "layout" as const,
      title: "② 装配定位",
      status: job.layout.status,
      approved: job.layout.approved === true,
      composite: url(job.layout.composite),
      comparison: url(job.layout.comparison),
      hint: job.layout.hint ?? null,
      meanScore: job.layout.meanScore ?? null,
      hints: job.layout.hints ?? {},
      moved: job.layout.moved ?? [],
      resolved: job.layout.resolved ?? [],
      unmatched: parts.filter((part) => part.status === "ready" && !part.placed).map((part) => part.name),
      error: job.layout.error
    },
    {
      stage: "rig" as const,
      title: "③ 骨骼与动画",
      status: job.rig.status,
      approved: job.rig.approved === true,
      skeleton: url(job.rig.skeleton),
      preview: url(job.rig.preview),
      bones: job.rig.bones,
      slots: job.rig.slots,
      animations: job.rig.animations ?? [],
      warnings: job.rig.warnings ?? [],
      error: job.rig.error
    },
    {
      stage: "atlas" as const,
      title: "④ 图集",
      status: job.atlas.status,
      approved: job.atlas.approved === true,
      image: url(job.atlas.image),
      text: url(job.atlas.text),
      width: job.atlas.width,
      height: job.atlas.height,
      regions: job.atlas.regions,
      error: job.atlas.error
    }
  ];

  return lossless({
    module: "rig" as const,
    id: job.id,
    name: job.name,
    reviewMode: job.reviewMode ?? null,
    assetBase,
    /**
     * 任务目录的**本机绝对路径**。agent 要自己做视觉先验就得能直接看图，
     * 而 read_image 之类只能读本机路径，给它 URL 没用。
     */
    dataDir: rigJobDir(job.id),
    /** 「一眼看全部部件」的蒙太奇图（本机路径与 URL 都给）。 */
    partsMontage: job.sheet.file === undefined ? null : "sheet/parts-montage.png",
    partsMontageUrl: url("sheet/parts-montage.png"),
    partsMontagePath: join(rigJobDir(job.id), "sheet/parts-montage.png"),
    partsOrder: job.parts.map((part) => part.name),
    sourcePath: job.source === undefined ? null : join(rigJobDir(job.id), job.source.file),
    sourceFile: job.source?.file ?? null,
    sourceUrl: url(job.source?.file),
    canvas: job.source === undefined ? null : { width: job.source.width, height: job.source.height },
    prompts: { sheet: job.prompts.sheet, suffix: job.prompts.suffix },
    prompt: job.prompts.sheet,
    suffix: job.prompts.suffix,
    settings: job.settings,
    // 拆件图阶段单独给一份，界面要直接拿 url 显示原图。
    sheet: { status: job.sheet.status, approved: job.sheet.approved === true, url: url(job.sheet.file), file: job.sheet.file, error: job.sheet.error },
    layout: {
      status: job.layout.status,
      approved: job.layout.approved === true,
      error: job.layout.error,
      items,
      composite: url(job.layout.composite),
      comparison: url(job.layout.comparison),
      hint: job.layout.hint ?? null,
      meanScore: job.layout.meanScore ?? null,
      hints: job.layout.hints ?? {},
      moved: job.layout.moved ?? [],
      resolved: job.layout.resolved ?? []
    },
    rig: {
      status: job.rig.status,
      approved: job.rig.approved === true,
      error: job.rig.error,
      skeleton: url(job.rig.skeleton),
      preview: url(job.rig.preview),
      bones: job.rig.bones,
      slots: job.rig.slots,
      animations: job.rig.animations ?? [],
      warnings: job.rig.warnings ?? []
    },
    atlas: {
      status: job.atlas.status,
      approved: job.atlas.approved === true,
      error: job.atlas.error,
      image: url(job.atlas.image),
      text: url(job.atlas.text),
      url: url(job.atlas.image),
      width: job.atlas.width,
      height: job.atlas.height,
      regions: job.atlas.regions
    },
    busy: stages.some((stage) => stage.status === "running") || listRigTasks(job.id).length > 0,
    stages,
    parts,
    review: {
      parts: parts.filter((part) => part.status === "ready").length,
      approved: parts.filter((part) => part.approved).length,
      placed: parts.filter((part) => part.placed).length,
      unmatched: parts.filter((part) => part.status === "ready" && !part.placed).map((part) => part.name),
      errors: stages.filter((stage) => stage.status === "error").map((stage) => stage.stage)
    },
    runningTasks: listRigTasks(job.id),
    log: job.log
  });
}

// ── 素材上传 ────────────────────────────────────────────────────────────

export async function setRigSource(jobId: string, name: string, base64: string): Promise<{ width: number; height: number }> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const sniffed = sniffImage(clean);
  if (sniffed === undefined) throw new Error("无法识别的图片格式（支持 PNG / JPEG / WebP / BMP）");
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length === 0) throw new Error("图片数据为空");
  if (bytes.length > 30 * 1024 * 1024) throw new Error("参考图超过 30 MB，请先压缩后再上传");

  const stem = safeName(name).replace(/\.[^.]+$/, "") || "character";
  const relative = `source/${stem}.${sniffed.ext}`;
  await mkdir(join(rigJobDir(jobId), "source"), { recursive: true });
  await writeFile(rigAssetPath(jobId, relative), bytes);

  const decoded = await decodeToRgba(rigAssetPath(jobId, relative), 2048);
  job.source = { file: relative, name: safeName(name), width: decoded.width, height: decoded.height };
  appendJobLog(job.log, "info", `已上传角色参考图：${safeName(name)}（${decoded.width}×${decoded.height}）`);
  await writeRigJob(job);
  return { width: decoded.width, height: decoded.height };
}

/** 上传一张现成的部件 PNG（跳过生图拆件，直接进入装配）。 */
export async function uploadRigPart(jobId: string, name: string, base64: string): Promise<{ name: string; width: number; height: number }> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
  const sniffed = sniffImage(clean);
  if (sniffed === undefined) throw new Error("无法识别的图片格式（支持 PNG / JPEG / WebP / BMP）");
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length === 0) throw new Error("图片数据为空");
  if (bytes.length > 30 * 1024 * 1024) throw new Error("部件图超过 30 MB");

  // 用文件名（去掉扩展名）当部件名：这是用户表达「这块是什么」的唯一通道，
  // 骨骼层级完全依赖它。
  const rawName = safeName(name).replace(/\.[^.]+$/, "");
  const partName = (rawName === "" ? `part-${job.parts.length + 1}` : rawName).slice(0, 48);
  const relative = `parts/${partName}.png`;
  await mkdir(join(rigJobDir(jobId), "parts"), { recursive: true });
  await writeFile(rigAssetPath(jobId, relative), bytes);

  const decoded = await decodeToRgba(rigAssetPath(jobId, relative), 2048);
  const existing = job.parts.findIndex((part) => part.name === partName);
  const node: RigPartNode = {
    name: partName,
    label: partLabel(partName),
    status: "ready",
    file: relative,
    width: decoded.width,
    height: decoded.height,
    source: "uploaded",
    approved: false,
    updatedAt: Date.now()
  };
  if (existing >= 0) job.parts[existing] = node;
  else job.parts.push(node);
  // 部件变了，后面的阶段全部作废。
  invalidateFrom(job, "parts");
  appendJobLog(job.log, "info", `已上传部件「${partName}」（${decoded.width}×${decoded.height}）`);
  await writeRigJob(job);
  return { name: partName, width: decoded.width, height: decoded.height };
}

export async function removeRigPart(jobId: string, name: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const node = job.parts.find((part) => part.name === name);
  if (node === undefined) throw new Error(`没有这个部件：${name}`);
  job.parts = job.parts.filter((part) => part.name !== name);
  delete job.layout.items[name];
  if (node.file !== undefined) await rm(rigAssetPath(jobId, node.file), { force: true }).catch(() => undefined);
  invalidateFrom(job, "parts");
  appendJobLog(job.log, "info", `已删除部件「${name}」`);
  await writeRigJob(job);
}

/**
 * 给部件改名（拆件图没按网格摆时，用户需要手工把它命名成 head / torso / …）。
 * 名字直接决定骨骼层级与动画能否套上，所以这里是主要的人工兜底通道。
 */
export async function renameRigPart(jobId: string, from: string, to: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const node = job.parts.find((part) => part.name === from);
  if (node === undefined) throw new Error(`没有这个部件：${from}`);
  const name = to.trim().replace(/[^\w\-\u4e00-\u9fa5]/g, "-").slice(0, 48);
  if (name === "") throw new Error("部件名不能为空");
  if (job.parts.some((part) => part.name === name && part.name !== from)) throw new Error(`已经有叫「${name}」的部件了`);

  if (node.file !== undefined) {
    const target = `parts/${name}.png`;
    await rename(rigAssetPath(jobId, node.file), rigAssetPath(jobId, target)).catch(() => undefined);
    node.file = target;
  }
  if (job.layout.items[from] !== undefined) {
    job.layout.items[name] = job.layout.items[from];
    delete job.layout.items[from];
  }
  node.name = name;
  node.label = partLabel(name);
  invalidateFrom(job, "rig");
  appendJobLog(job.log, "info", `部件「${from}」已改名为「${name}」`);
  await writeRigJob(job);
}

export async function setRigPartVisibility(jobId: string, name: string, hidden: boolean): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const node = job.parts.find((part) => part.name === name);
  if (node === undefined) throw new Error(`没有这个部件：${name}`);
  node.hidden = hidden;
  invalidateFrom(job, "layout");
  await writeRigJob(job);
}

export async function setRigPartApproved(jobId: string, name: string | undefined, approved: boolean): Promise<number> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  let touched = 0;
  for (const part of job.parts) {
    if (name === undefined || part.name === name) {
      part.approved = approved;
      touched++;
    }
  }
  if (name !== undefined && touched === 0) throw new Error(`没有这个部件：${name}`);
  await writeRigJob(job);
  return touched;
}

export async function setRigStageApproved(jobId: string, stage: RigStageKey, approved: boolean): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  if (stage === "parts") {
    job.sheet.approved = approved;
    for (const part of job.parts) if (part.status === "ready") part.approved = approved;
  } else if (stage === "layout") {
    job.layout.approved = approved;
  } else if (stage === "rig") {
    job.rig.approved = approved;
  } else if (stage === "atlas") {
    job.atlas.approved = approved;
  } else {
    throw new Error(`未知阶段：${stage}`);
  }
  await writeRigJob(job);
}

export async function saveRigPrompts(jobId: string, patch: { sheet?: string; suffix?: string; resetSheet?: boolean }): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  if (typeof patch.sheet === "string") job.prompts.sheet = patch.sheet;
  if (typeof patch.suffix === "string") job.prompts.suffix = patch.suffix;
  if (patch.resetSheet === true) job.prompts.sheet = buildSheetPrompt(job.settings.gridColumns, job.settings.gridRows, rigSlotNames(job));
  await writeRigJob(job);
}

export async function saveRigSettings(jobId: string, raw: Record<string, unknown>): Promise<{ changed: boolean }> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const before = { ...job.settings };
  job.settings.gridColumns = clampInt(raw.gridColumns, job.settings.gridColumns, 1, 8);
  job.settings.gridRows = clampInt(raw.gridRows, job.settings.gridRows, 1, 8);
  job.settings.backgroundTolerance = clampInt(raw.backgroundTolerance, job.settings.backgroundTolerance, 1, 200);
  job.settings.feather = clampInt(raw.feather, job.settings.feather, 1, 200);
  job.settings.minArea = clampInt(raw.minArea, job.settings.minArea, 0, 100000);
  job.settings.partPadding = clampInt(raw.partPadding, job.settings.partPadding, 0, 64);
  job.settings.matchLongEdge = clampInt(raw.matchLongEdge, job.settings.matchLongEdge, 128, 1024);
  job.settings.size = typeof raw.size === "string" && raw.size.trim() !== "" ? raw.size : job.settings.size;
  job.settings.watermark = raw.watermark === true;
  if (Array.isArray(raw.animations)) {
    const list = raw.animations.filter((value): value is string => isAnimationId(value));
    job.settings.animations = list.length > 0 ? list : defaultAnimationIds();
  }
  // 分割参数改了，已经切出来的部件就作废；网格尺寸改了连摊平图都要重生成。
  const segmentationChanged =
    before.backgroundTolerance !== job.settings.backgroundTolerance ||
    before.feather !== job.settings.feather ||
    before.minArea !== job.settings.minArea ||
    before.partPadding !== job.settings.partPadding;
  const gridChanged = before.gridColumns !== job.settings.gridColumns || before.gridRows !== job.settings.gridRows;
  const animationsChanged = JSON.stringify(before.animations) !== JSON.stringify(job.settings.animations);
  if (gridChanged || segmentationChanged) invalidateFrom(job, "sheet");
  else if (animationsChanged) invalidateFrom(job, "rig");
  await writeRigJob(job);
  return { changed: gridChanged || segmentationChanged };
}

/**
 * 让某个阶段**之后**的所有产物失效。
 *
 * 流水线的依赖是一条直线（拆件图 → 部件 → 装配 → 骨骼 → 图集），任何上游变化都会
 * 让下游的产物对不上。这里集中处理，避免每个入口各写一遍、漏掉某一层。
 */
const STAGE_ORDER = ["sheet", "parts", "layout", "rig", "atlas"] as const;
type AnyStage = (typeof STAGE_ORDER)[number];

function invalidateFrom(job: RigJob, stage: AnyStage): void {
  const from = STAGE_ORDER.indexOf(stage);
  if (from < STAGE_ORDER.indexOf("parts")) {
    // 拆件图要重画：生图切出来的部件全部作废，用户手工上传的保留。
    job.parts = job.parts.filter((part) => part.source === "uploaded" && part.status === "ready");
    job.sheet = { ...job.sheet, approved: false };
  } else {
    for (const part of job.parts) part.approved = false;
  }
  if (from < STAGE_ORDER.indexOf("layout")) {
    job.layout = { status: "empty", items: {} };
  } else {
    job.layout.approved = false;
  }
  if (from < STAGE_ORDER.indexOf("rig")) job.rig = { status: "empty" };
  else job.rig.approved = false;
  if (from < STAGE_ORDER.indexOf("atlas")) job.atlas = { status: "empty" };
  else job.atlas.approved = false;
}

// ── 后台任务 ────────────────────────────────────────────────────────────

const running = new Map<string, Set<string>>();
const pollers = new Map<string, ReturnType<typeof setInterval>>();
let disposed = false;

export function disposeRig(): void {
  disposed = true;
  for (const timer of pollers.values()) clearInterval(timer);
  pollers.clear();
  running.clear();
}

export function listRigTasks(jobId: string): string[] {
  return [...(running.get(jobId) ?? [])];
}

function kick(jobId: string, taskKey: string, fn: () => Promise<void>): boolean {
  if (disposed) return false;
  const set = running.get(jobId) ?? new Set<string>();
  running.set(jobId, set);
  if (set.has(taskKey)) return false;
  set.add(taskKey);
  void (async () => {
    try {
      await fn();
    } catch (error) {
      const job = await readRigJob(jobId);
      if (job !== undefined) {
        appendJobLog(job.log, "error", `${taskKey} 失败：${messageOf(error)}`);
        await writeRigJob(job);
      }
    } finally {
      set.delete(taskKey);
      if (set.size === 0) running.delete(jobId);
    }
  })();
  return true;
}

function assertIdle(jobId: string, taskKey: string, what: string): void {
  if (running.get(jobId)?.has(taskKey) === true) throw new Error(`${what}已在进行中，请等它跑完`);
}

/** 生图任务要轮询，占位保持接口形状（当前只在任务内轮询，不需要外部驱动）。 */
export function stopRigPoller(jobId: string): void {
  const timer = pollers.get(jobId);
  if (timer !== undefined) clearInterval(timer);
  pollers.delete(jobId);
}

// ── 阶段①：拆件 ────────────────────────────────────────────────────────

/**
 * 用生图模型生成「拆件摊平图」。**这一步是唯一花钱的阶段**：一次 Seedream 调用。
 */
export function startSheetGeneration(jobId: string): { started: boolean; reason?: string } {
  try {
    assertIdle(jobId, "sheet", "拆件生图");
  } catch (error) {
    return { started: false, reason: messageOf(error) };
  }
  const started = kick(jobId, "sheet", () => generateSheet(jobId));
  return started ? { started: true } : { started: false, reason: "拆件生图已在进行中" };
}

export async function generateSheet(jobId: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const config = await loadConfig();
  if (config.arkApiKey.trim() === "") throw new Error("尚未配置火山方舟 API Key");
  if (job.source === undefined) throw new Error("还没有角色参考图，请先上传一张整图");

  const prompt = buildSheetRequest(job);
  job.settings.model = config.arkModel;
  job.sheet = { ...job.sheet, status: "running", error: undefined };
  appendJobLog(job.log, "info", `开始拆件生图（模型 ${config.arkModel}）`);
  await writeRigJob(job);

  try {
    const reference = await toDataUri(rigAssetPath(jobId, job.source.file), mimeOf(job.source.file));
    const result = await generateImage({
      baseUrl: config.arkBaseUrl,
      apiKey: config.arkApiKey,
      model: config.arkModel,
      prompt,
      images: [reference],
      size: job.settings.size || config.arkSize,
      watermark: job.settings.watermark,
      timeoutMs: config.arkTimeoutMs
    });
    const relative = `sheet/parts-sheet.${result.ext}`;
    await mkdir(join(rigJobDir(jobId), "sheet"), { recursive: true });
    await writeFile(rigAssetPath(jobId, relative), result.bytes);

    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.sheet = { status: "ready", file: relative, error: undefined, updatedAt: Date.now() };
    appendJobLog(fresh.log, "info", `拆件图已生成（${(result.bytes.length / 1024).toFixed(0)} KB）`);
    await writeRigJob(fresh);
  } catch (error) {
    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.sheet = { ...fresh.sheet, status: "error", error: messageOf(error), updatedAt: Date.now() };
    appendJobLog(fresh.log, "error", `拆件生图失败：${messageOf(error)}`);
    await writeRigJob(fresh);
    throw error;
  }

  // 生图成功后立刻分割，用户拿到的是一个可以直接验收的部件列表。
  await segmentSheet(jobId);
}

export function startSegmentation(jobId: string): { started: boolean; reason?: string } {
  try {
    assertIdle(jobId, "segment", "分割");
  } catch (error) {
    return { started: false, reason: messageOf(error) };
  }
  const started = kick(jobId, "segment", () => segmentSheet(jobId));
  return started ? { started: true } : { started: false, reason: "分割已在进行中" };
}

/**
 * 把摊平图切成部件。
 *
 * 分割依赖「格子 = 部件身份」这个约定：连通域按质心归到某个格子，格子名就是
 * 部件名。一个格子里出现多块时取最大的一块，其余作为 `名字-2` 之类的附加件保留
 * ——生图模型偶尔会把配饰画成独立小块，直接丢掉不如留给用户判断。
 */
export async function segmentSheet(jobId: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  if (job.sheet.file === undefined) throw new Error("还没有拆件图，请先在第 ① 步生成或上传");

  const decoded = await decodeToRgba(rigAssetPath(jobId, job.sheet.file), 2048);
  const atlas: Rgba = { data: decoded.rgba, width: decoded.width, height: decoded.height };
  const background = detectBackground(atlas);
  const columns = job.settings.gridColumns;
  const rows = job.settings.gridRows;
  const cellWidth = atlas.width / columns;
  const cellHeight = atlas.height / rows;
  const autoMinArea = Math.max(120, Math.round((atlas.width * atlas.height) / (columns * rows) * 0.004));
  const minArea = job.settings.minArea > 0 ? job.settings.minArea : autoMinArea;

  const segmented = segmentWithLabels(atlas, {
    background,
    tolerance: job.settings.backgroundTolerance,
    minArea,
    padding: job.settings.partPadding,
    feather: job.settings.feather
  });
  const components = segmented.components;
  appendJobLog(
    job.log,
    "info",
    `分割：底色 rgb(${background.join(",")})，连通域 ${components.length} 块（最小面积 ${minArea}）`
  );

  await mkdir(join(rigJobDir(jobId), "parts"), { recursive: true });
  // 先把「挨在一起的碎块」并成一个部件，再按格子命名。两步都不能省：
  //
  // ① **按包围盒邻近合并**，而不是「一格合并所有」。实测生图模型会把一件东西画成
  //    互不相连的几块（围裙的白布片、鲸鱼刺绣、裙摆高光都是独立连通域），按格子
  //    一把抓会把它们和同格的**别的**部件揉在一起——实测出现过「一只手 + 两段袖子」
  //    被并成一个部件，那种部件根本没法摆。
  // ② 命名另算（见 cellOfGroup）：溢出多半是往下的（裙摆、头发、尾巴），按面积最大
  //    归属会把整条裙子判给下面那格，于是它被命名成 right-lower-arm。
  // 合并阈值取「格子的 1.5%」，实测 4~8px：同一件东西被画成几块时（围裙的白布片、
  // 鲸鱼刺绣）它们真的挨得很近，而不同部件之间模型会留出明显空白。
  const MERGE_GAP = Math.max(3, Math.round(Math.min(cellWidth, cellHeight) * 0.015));
  const rootOf = groupComponentsByProximity(segmented.labels, segmented.width, segmented.height, MERGE_GAP);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < components.length; i++) {
    const root = rootOf[components[i].label];
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  /** 一组连通域的并集包围盒。 */
  const groupBox = (indices: number[]) => {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = 0;
    let y1 = 0;
    for (const item of indices) {
      const component = components[item];
      x0 = Math.min(x0, component.x);
      y0 = Math.min(y0, component.y);
      x1 = Math.max(x1, component.x + component.width);
      y1 = Math.max(y1, component.y + component.height);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };

  const overlapWithCell = (box: { x: number; y: number; width: number; height: number }, cell: number) => {
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    const overlapX = Math.max(0, Math.min(box.x + box.width, (column + 1) * cellWidth) - Math.max(box.x, column * cellWidth));
    const overlapY = Math.max(0, Math.min(box.y + box.height, (row + 1) * cellHeight) - Math.max(box.y, row * cellHeight));
    return overlapX * overlapY;
  };

  /**
   * 组 → 格子：在覆盖率不低于最大值一半的候选里，取**最靠上**（再最靠左）的那格。
   * 部件溢出多半往下（裙摆、头发、尾巴），取最上那格正好对上模型的意图：
   * 实测整条裙子若按面积最大归属会被判给下面那格，命名成 right-lower-arm。
   */
  const cellOfGroup = (box: { x: number; y: number; width: number; height: number }) => {
    const cells = [...Array(columns * rows).keys()].map((cell) => ({ cell, overlap: overlapWithCell(box, cell) }));
    const best = Math.max(...cells.map((item) => item.overlap));
    return cells
      .filter((item) => item.overlap >= best * 0.5)
      .sort(
        (left, right) =>
          Math.floor(left.cell / columns) - Math.floor(right.cell / columns) ||
          (left.cell % columns) - (right.cell % columns)
      )[0].cell;
  };

  // 面积大的先占格子，避免小碎块把格子抢走。
  const orderedGroups = [...groups.values()].sort(
    (left, right) =>
      right.reduce((sum, item) => sum + components[item].area, 0) - left.reduce((sum, item) => sum + components[item].area, 0)
  );

  const slotNames = rigSlotNames(job);
  /** 手工上传的部件不受网格分割影响，保留下来。 */
  const uploaded = job.parts.filter((part) => part.source === "uploaded" && part.status === "ready");
  const next: RigPartNode[] = [...uploaded];
  const claimed = new Set(uploaded.map((part) => part.name));
  const takenCells = new Set<number>();

  let mergedFragments = 0;
  let order = 0;
  for (const group of orderedGroups) {
    order++;
    const box = groupBox(group);
    let cell = cellOfGroup(box);
    if (takenCells.has(cell)) {
      const free = [...Array(columns * rows).keys()]
        .filter((candidate) => !takenCells.has(candidate))
        .sort((left, right) => overlapWithCell(box, right) - overlapWithCell(box, left) || left - right);
      cell = free[0] ?? cell;
    }
    const slot = slotNames[cell] ?? `slot-${cell + 1}`;
    const name = claimed.has(slot) ? `${slot}-${order}` : slot;
    claimed.add(name);
    takenCells.add(cell);

    const merged = mergeComponents(group.map((item) => components[item]), atlas.width, atlas.height);
    const trimmed = trimTransparent(merged);
    const relative = `parts/${name}.png`;
    await writeFile(rigAssetPath(jobId, relative), encodePng(trimmed.data, trimmed.width, trimmed.height));
    let opaque = 0;
    for (let k = 0; k < trimmed.width * trimmed.height; k++) if (trimmed.data[k * 4 + 3] > 128) opaque++;
    if (group.length > 1) mergedFragments += group.length - 1;
    next.push({
      name,
      label: partLabel(name),
      status: "ready",
      file: relative,
      width: trimmed.width,
      height: trimmed.height,
      gridX: cell % columns,
      gridY: Math.floor(cell / columns),
      opacity: Number((opaque / (trimmed.width * trimmed.height)).toFixed(3)),
      source: "generated",
      approved: false,
      updatedAt: Date.now()
    });
  }

  // 删掉旧的 slotNames/uploaded/claimed 声明（现在在上面）
  const fresh = await readRigJob(jobId);
  if (fresh === undefined) return;
  fresh.parts = next;
  fresh.layout = { status: "empty", items: {} };
  fresh.rig = { status: "empty" };
  fresh.atlas = { status: "empty" };
  // 生成部件蒙太奇：把分割出来的部件按**与 parts 数组相同的顺序**拼成一张图。
  // 这是「视觉先验」那一步的输入——多模态模型看一张图比逐个打开十几个文件省事得多，
  // 而且顺序固定，它说「第 7 格是左手」我们就能直接换算成部件名。
  const generated = next.filter((part) => part.source === "generated" && part.file !== undefined);
  if (generated.length > 0) {
    const CELL = 200;
    const COLS = Math.min(6, generated.length);
    const ROWS = Math.ceil(generated.length / COLS);
    const canvas = createRgba(CELL * COLS, CELL * ROWS, [246, 246, 249, 255]);
    for (let i = 0; i < generated.length; i++) {
      const decoded = await decodeToRgba(rigAssetPath(jobId, generated[i].file!), 1024);
      const scale = Math.min((CELL - 14) / decoded.width, (CELL - 14) / decoded.height);
      const scaled = resizeRgba(
        { data: decoded.rgba, width: decoded.width, height: decoded.height },
        Math.max(1, Math.round(decoded.width * scale)),
        Math.max(1, Math.round(decoded.height * scale))
      );
      const column = i % COLS;
      const row = Math.floor(i / COLS);
      blitRgba(
        canvas,
        scaled,
        column * CELL + Math.round((CELL - scaled.width) / 2),
        row * CELL + Math.round((CELL - scaled.height) / 2)
      );
      // 画格线，让「第几格」在图上可以直接数出来。
      for (let x = column * CELL; x < column * CELL + CELL && x < canvas.width; x++) {
        const at = (row * CELL) * canvas.width * 4 + x * 4;
        canvas.data[at] = 208;
        canvas.data[at + 1] = 208;
        canvas.data[at + 2] = 216;
      }
      for (let y = row * CELL; y < row * CELL + CELL && y < canvas.height; y++) {
        const at = (y * canvas.width + column * CELL) * 4;
        canvas.data[at] = 208;
        canvas.data[at + 1] = 208;
        canvas.data[at + 2] = 216;
      }
    }
    await mkdir(join(rigJobDir(jobId), "sheet"), { recursive: true });
    await writeFile(rigAssetPath(jobId, "sheet/parts-montage.png"), encodePng(canvas.data, canvas.width, canvas.height));
    await writeFile(
      rigAssetPath(jobId, "sheet/parts.json"),
      `${JSON.stringify({ columns: COLS, cell: CELL, order: generated.map((part) => part.name) }, null, 2)}\n`,
      "utf8"
    );
  }

  const missing = slotNames.filter((name) => !next.some((part) => part.name === name));
  appendJobLog(
    fresh.log,
    "info",
    `分割完成：${next.filter((p) => p.source === "generated").length} 个部件` +
      (missing.length > 0 ? `；这些格子没有检测到部件：${missing.join("、")}` : "") +
      (mergedFragments > 0 ? `；有 ${mergedFragments} 个碎块被并进了相邻的部件` : "")
  );
  // 生图模型不按网格摆的情况并不罕见（实测常把「上臂+小臂+手」连成一整块，
  // 或者把角色摊成两三行松散布局）。这时格子归属就没有意义了，与其让骨架
  // 挂着一堆错名字，不如明确告诉用户：重新生成，或者手工上传命名部件。
  if (missing.length >= Math.ceil(slotNames.length * 0.4)) {
    appendJobLog(
      fresh.log,
      "warn",
      `拆件图有 ${missing.length}/${slotNames.length} 个格子是空的——生图模型很可能没有按网格摆放。` +
        `建议：① 重新生成拆件图；② 或者用「部件 PNG」上传框自己传（文件名即部件名，如 head.png、torso.png）。` +
        `空着的部件会被跳过，不会进入骨架。`
    );
  }
  await writeRigJob(fresh);
}

/**
 * 把同一格里的多个连通域合并成一张部件图（各块保留自己的透明通道，按位置贴回去）。
 */
function mergeComponents(
  list: Array<{ x: number; y: number; width: number; height: number; rgba: Rgba }>,
  canvasWidth: number,
  canvasHeight: number
): Rgba {
  let minX = canvasWidth;
  let minY = canvasHeight;
  let maxX = 0;
  let maxY = 0;
  for (const item of list) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const out = createRgba(width, height);
  for (const item of list) {
    for (let y = 0; y < item.rgba.height; y++) {
      const ty = item.y - minY + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < item.rgba.width; x++) {
        const tx = item.x - minX + x;
        if (tx < 0 || tx >= width) continue;
        const src = (y * item.rgba.width + x) * 4;
        if (item.rgba.data[src + 3] === 0) continue;
        const dst = (ty * width + tx) * 4;
        out.data[dst] = item.rgba.data[src];
        out.data[dst + 1] = item.rgba.data[src + 1];
        out.data[dst + 2] = item.rgba.data[src + 2];
        out.data[dst + 3] = Math.max(out.data[dst + 3], item.rgba.data[src + 3]);
      }
    }
  }
  return out;
}

/** 去掉四周全透明边，让部件坐标都从自己的左上角量起。 */
function trimTransparent(rgba: Rgba): Rgba {
  let minX = rgba.width;
  let minY = rgba.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rgba.height; y++) {
    for (let x = 0; x < rgba.width; x++) {
      if (rgba.data[(y * rgba.width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return rgba;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    rgba.data.copy(out, y * width * 4, ((minY + y) * rgba.width + minX) * 4, ((minY + y) * rgba.width + minX + width) * 4);
  }
  return { data: out, width, height };
}

// ── 阶段②：装配定位 ────────────────────────────────────────────────────

export function startLayout(jobId: string, names?: string[]): { started: boolean; reason?: string } {
  try {
    assertIdle(jobId, "layout", "装配定位");
  } catch (error) {
    return { started: false, reason: messageOf(error) };
  }
  const started = kick(jobId, "layout", () => solveRigLayout(jobId, names));
  return started ? { started: true } : { started: false, reason: "装配定位已在进行中" };
}

/**
 * 把部件摆回参考姿态。
 *
 * `names` 为空时求解全部（并做冲突消解与遮挡修正）；只给部分名字时**只重跑这些
 * 部件**，保留其余结果——失败一两个部件时用户只需要重试那几个，不必整批重算。
 */
export async function solveRigLayout(jobId: string, names?: string[]): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  if (job.source === undefined) throw new Error("还没有角色参考图，请先上传一张整图");
  const ready = job.parts.filter((part) => part.status === "ready" && part.hidden !== true && part.file !== undefined);
  if (ready.length === 0) throw new Error("还没有可用部件，请先在第 ① 步拆件或上传部件 PNG");

  const subset = names === undefined || names.length === 0 ? undefined : ready.filter((part) => names.includes(part.name));
  if (subset !== undefined && subset.length === 0) throw new Error("指定的部件都不存在或还不可用");

  const referenceDecoded = await decodeToRgba(rigAssetPath(jobId, job.source.file), 2048);
  const reference: Rgba = { data: referenceDecoded.rgba, width: referenceDecoded.width, height: referenceDecoded.height };

  const inputs = [];
  for (const part of subset ?? ready) {
    const decoded = await decodeToRgba(rigAssetPath(jobId, part.file!), 2048);
    inputs.push({ name: part.name, rgba: { data: decoded.rgba, width: decoded.width, height: decoded.height } as Rgba });
    part.width = decoded.width;
    part.height = decoded.height;
  }

  job.layout.status = "running";
  job.layout.error = undefined;
  appendJobLog(job.log, "info", `开始装配定位：${inputs.length} 个部件${subset === undefined ? "（全量）" : "（部分重跑）"}`);
  await writeRigJob(job);

  try {
    const solved = solveLayout(reference, inputs, {
      longEdge: job.settings.matchLongEdge,
      drawOrder: subset === undefined ? DEFAULT_DRAW_ORDER : undefined,
      // 视觉先验只在**全量**装配时用：局部重跑（用户点名几个部件）时不带先验，
      // 否则「重新自动定位」会变成「又回到我上次说的那个位置」，用户没法纠正它。
      hints: subset === undefined ? job.layout.hints : undefined
    });

    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    if (subset === undefined) fresh.layout.items = {};

    for (const [name, result] of Object.entries(solved.placements)) {
      fresh.layout.items[name] = {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
        scale: result.scale,
        rotation: result.rotation,
        z: drawRankOf(name),
        score: result.score,
        coverage: result.coverage,
        matched: true,
        manual: false
      };
    }
    // 没匹配上的部件放到画布左下角的「待摆放」区，而不是 (0,0)：
    // 界面上的方块可以拖动，用户直接把它们拖到正确位置即可。
    const stagingScale = solved.hint || 0.2;
    solved.failed.forEach((name, order) => {
      if (fresh.layout.items[name] !== undefined) return;
      const node = fresh.parts.find((part) => part.name === name);
      const width = Math.max(8, Math.round((node?.width ?? 64) * stagingScale));
      const height = Math.max(8, Math.round((node?.height ?? 64) * stagingScale));
      fresh.layout.items[name] = {
        x: 6 + (order % 6) * 56,
        y: Math.max(0, referenceDecoded.height - height - 4),
        width,
        height,
        scale: stagingScale,
        rotation: 0,
        z: drawRankOf(name),
        matched: false,
        manual: false
      };
    });
    if (subset === undefined) {
      fresh.layout.hint = Number(solved.hint.toFixed(4));
      fresh.layout.moved = solved.moved;
      fresh.layout.resolved = solved.resolved;
    }
    fresh.layout.status = "ready";
    fresh.layout.approved = false;
    fresh.layout.updatedAt = Date.now();

    // 匹配质量本身就是一个**信号**：如果整批部件的相似度都很低，通常不是「参数没调好」，
    // 而是拆件图里的角色和参考图根本不是同一个（实测生图模型会把角色换成另一个：
    // 原图是穿深蓝连衣裙的女仆，拆件图给的却是白短裤 + 光腿的一具裸身）。
    // 这种情况下再怎么调匹配都是白费力气，必须直说，并给出真正能走通的两条路。
    // 结构合理性检查：这些名字本身就带着人体结构信息，装配结果必须自洽。
    // 分数高不代表摆得对——实测有一版「头」落在画面下半部分、裙摆放到了最上面，
    // 平均相似度却还有 0.48，纯靠分数根本发现不了。人形的基本约束（头在最上面、
    // 脚在最下面）是免费的强信号，违反它就直接判定自动定位不可信。
    const verticalOrderProblem = (() => {
      const centerYOf = (name: string): number | undefined => {
        const item = fresh.layout.items[name];
        if (item === undefined || item.matched !== true || partHidden(fresh, name)) return undefined;
        return item.y + item.height / 2;
      };
      const headY = centerYOf("head");
      const footY = centerYOf("left-foot") ?? centerYOf("right-foot");
      const legY = centerYOf("left-upper-leg") ?? centerYOf("right-upper-leg");
      if (headY === undefined) return undefined;
      if (footY !== undefined && headY > footY) return "「头」被摆到了「脚」的下面";
      if (legY !== undefined && headY > legY) return "「头」被摆到了「大腿」的下面";
      return undefined;
    })();

    const matchedScores = Object.values(solved.placements).map((item) => item.score);
    const meanScore = matchedScores.length > 0 ? matchedScores.reduce((sum, value) => sum + value, 0) / matchedScores.length : 0;
    fresh.layout.meanScore = Number(meanScore.toFixed(4));
    const weak = solved.failed.length > 0 ? `这些部件没匹配上，需要人工摆放：${solved.failed.join("、")}` : undefined;
    if (meanScore < 0.32 && matchedScores.length > 0) {
      // 阈值定在 0.32：实测「拆件图是同一个角色」时均值约 0.38（而且受服装
      // 裁片影响本身就不会很高），「角色被换成另一个」时约 0.28 且个别部件
      // 直接匹配不上。低于 0.32 基本可以判定是后者，再调参数没有意义。
      const hint =
        `整批部件的平均相似度只有 ${meanScore.toFixed(2)}，自动定位不可信。常见原因：` +
        `① 拆件图里的角色与参考图不是同一个（生图模型在「拆件」时换掉服装 / 发型 / 体型）；` +
        `② 部件是按「服装裁片」拆的（裙摆、袖子、领子），外观本来就只覆盖参考图的一小块。` +
        `建议：① 用「部件 PNG」上传框传自己的部件（文件名即部件名，完全绕开生图）；` +
        `② 或换更强的生图模型（设置 → 游戏素材大师 → 生图模型，实测 Seedream 5.0 Pro 明显更守角色设定）重新拆件；` +
        `③ 也可以在下面的合成图上手工拖到正确位置。`;
      appendJobLog(fresh.log, "warn", hint);
      fresh.layout.error = weak === undefined ? hint : `${weak}；另外，${hint}`;
    } else if (verticalOrderProblem !== undefined) {
      const hint =
        `自动定位结果明显不合理：${verticalOrderProblem}。这通常意味着拆件图里的部件与参考图对不上` +
        `（部件可能是重新绘制的服装裁片，或角色被换过），继续相信自动结果反而更费时间。` +
        `建议：① 直接用「部件 PNG」上传框传自己的部件（文件名即部件名）；② 在下面的合成图上手工拖到正确位置。`;
      appendJobLog(fresh.log, "warn", hint);
      fresh.layout.error = weak === undefined ? hint : `${weak}；另外，${hint}`;
    } else {
      fresh.layout.error = weak;
    }
    fresh.rig = { status: "empty" };
    fresh.atlas = { status: "empty" };
    if (solved.hintedCount !== undefined && solved.hintedCount > 0) {
      appendJobLog(fresh.log, "info", `本次装配用了 ${solved.hintedCount} 个视觉先验（限制在给定区域附近搜索）`);
    }
    appendJobLog(
      fresh.log,
      "info",
      `装配完成：命中 ${Object.keys(solved.placements).length}/${inputs.length}` +
        (solved.failed.length > 0 ? `，未命中 ${solved.failed.join("、")}` : "")
    );
    await writeRigJob(fresh);

    await renderLayoutImages(jobId);
    await writeLayoutJson(jobId);
  } catch (error) {
    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.layout.status = "error";
    fresh.layout.error = messageOf(error);
    appendJobLog(fresh.log, "error", `装配定位失败：${messageOf(error)}`);
    await writeRigJob(fresh);
    throw error;
  }
}

/** 手工调整某个部件的位置/尺寸/层级。 */
/**
 * 记录/清除视觉先验。
 *
 * 这是「自动摆位」的关键入口：先验把「全图盲搜」降级成「在指定区域里精修」。
 * 先验来自多模态模型看一眼图（对话里就是 agent 自己），所以只要求**区域大致对**，
 * 不要求精确——实测重画过的部件在错误位置也能拿到不低的分数，盲搜正是因此失手。
 */
export async function setRigLayoutHints(
  jobId: string,
  hints: Record<string, RigLayoutHint | null>
): Promise<{ count: number }> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const current = { ...(job.layout.hints ?? {}) };
  let touched = 0;
  for (const [name, hint] of Object.entries(hints)) {
    if (!job.parts.some((part) => part.name === name)) throw new Error(`没有这个部件：${name}`);
    if (hint === null) {
      delete current[name];
      touched++;
      continue;
    }
    const x = num(hint.x, NaN);
    const y = num(hint.y, NaN);
    const width = num(hint.width, NaN);
    const height = num(hint.height, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error(`「${name}」的先验框不合法：需要 x / y / width / height 四个正数`);
    }
    current[name] = { x, y, width, height };
    touched++;
  }
  job.layout.hints = Object.keys(current).length === 0 ? undefined : current;
  invalidateFrom(job, "layout");
  appendJobLog(job.log, "info", `已记录 ${touched} 个部件的视觉先验（装配时会限制在这些区域附近搜索）`);
  await writeRigJob(job);
  return { count: touched };
}

export async function saveLayoutItem(
  jobId: string,
  name: string,
  patch: { x?: number; y?: number; width?: number; height?: number; rotation?: number; z?: number }
): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const item = job.layout.items[name];
  if (item === undefined) throw new Error(`这个部件还没有摆放记录：${name}`);
  if (Number.isFinite(patch.x)) item.x = Math.round(patch.x!);
  if (Number.isFinite(patch.y)) item.y = Math.round(patch.y!);
  if (Number.isFinite(patch.width)) item.width = Math.max(1, Math.round(patch.width!));
  if (Number.isFinite(patch.height)) item.height = Math.max(1, Math.round(patch.height!));
  if (Number.isFinite(patch.rotation)) item.rotation = num(patch.rotation, item.rotation);
  if (Number.isFinite(patch.z)) item.z = Math.round(patch.z!);
  item.manual = true;
  item.matched = true;
  job.layout.approved = false;
  job.rig = { status: "empty" };
  job.atlas = { status: "empty" };
  await writeRigJob(job);
  await renderLayoutImages(jobId);
  await writeLayoutJson(jobId);
}

/** 出一张「参考图 | 合成图」对比图和一张纯合成图。 */
export async function renderLayoutImages(jobId: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  if (job.source === undefined) throw new Error("还没有角色参考图");

  const referenceDecoded = await decodeToRgba(rigAssetPath(jobId, job.source.file), 2048);
  const reference: Rgba = { data: referenceDecoded.rgba, width: referenceDecoded.width, height: referenceDecoded.height };

  const ordered = orderedItems(job);
  const placed = [];
  for (const [name, item] of ordered) {
    const part = job.parts.find((entry) => entry.name === name);
    if (part?.file === undefined) continue;
    const decoded = await decodeToRgba(rigAssetPath(jobId, part.file), 2048);
    const scaled = resizeRgba({ data: decoded.rgba, width: decoded.width, height: decoded.height }, Math.max(1, item.width), Math.max(1, item.height));
    placed.push({ name, x: item.x, y: item.y, width: item.width, height: item.height, rgba: scaled });
  }

  const composite = compositeParts(reference.width, reference.height, placed);
  const comparison = sideBySide(reference, composite);
  await mkdir(join(rigJobDir(jobId), "layout"), { recursive: true });
  await writeFile(rigAssetPath(jobId, "layout/composite.png"), encodePng(composite.data, composite.width, composite.height));
  await writeFile(rigAssetPath(jobId, "layout/comparison.png"), encodePng(comparison.data, comparison.width, comparison.height));

  const fresh = await readRigJob(jobId);
  if (fresh === undefined) return;
  fresh.layout.composite = "layout/composite.png";
  fresh.layout.comparison = "layout/comparison.png";
  await writeRigJob(fresh);
}

function normalizeHints(value: unknown): Record<string, RigLayoutHint> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const out: Record<string, RigLayoutHint> = {};
  for (const [name, raw] of Object.entries<any>(value)) {
    const x = num(raw?.x, NaN);
    const y = num(raw?.y, NaN);
    const width = num(raw?.width, NaN);
    const height = num(raw?.height, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width <= 0 || height <= 0) continue;
    out[name] = { x, y, width, height };
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** 部件是否被用户隐藏。 */
function partHidden(job: RigJob, name: string): boolean {
  return job.parts.find((part) => part.name === name)?.hidden === true;
}

/** 按绘制顺序（z 升序）列出已经摆放好的部件。 */
function orderedItems(job: RigJob): Array<[string, RigLayoutItem]> {
  return Object.entries(job.layout.items)
    .filter(([name]) => {
      const part = job.parts.find((entry) => entry.name === name);
      return part?.status === "ready" && part.hidden !== true;
    })
    .sort((a, b) => a[1].z - b[1].z || a[0].localeCompare(b[0]));
}

/** 导出 layout.json（供外部工具或人工核对）。 */
export async function writeLayoutJson(jobId: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const parts: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(job.layout.items)) {
    parts[name] = {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      scale: item.scale,
      rotation: item.rotation,
      z_index: item.z,
      score: item.score,
      coverage: item.coverage,
      matched: item.matched,
      manual: item.manual === true
    };
  }
  const payload = {
    reference_image: job.source?.file ?? null,
    canvas_width: job.source?.width ?? 0,
    canvas_height: job.source?.height ?? 0,
    hint_scale: job.layout.hint ?? null,
    z_order: orderedItems(job).map(([name]) => name),
    parts
  };
  await writeFile(rigAssetPath(jobId, "layout/layout.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

// ── 阶段③：骨骼与动画 ──────────────────────────────────────────────────

export function startRig(jobId: string): { started: boolean; reason?: string } {
  try {
    assertIdle(jobId, "rig", "骨骼构建");
  } catch (error) {
    return { started: false, reason: messageOf(error) };
  }
  const started = kick(jobId, "rig", () => buildRigOutput(jobId));
  return started ? { started: true } : { started: false, reason: "骨骼构建已在进行中" };
}

/**
 * 生成 `skeleton.json` 与自包含预览 `preview.html`。
 *
 * 这一步不调任何模型：骨骼位置/朝向由装配结果直接算出来，动画是查表生成的。
 */
export async function buildRigOutput(jobId: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  if (job.source === undefined) throw new Error("还没有角色参考图");
  const ordered = orderedItems(job);
  if (ordered.length === 0) throw new Error("还没有摆放好的部件，请先在第 ② 步装配定位");

  job.rig.status = "running";
  job.rig.error = undefined;
  await writeRigJob(job);

  try {
    const placedParts: RigPlacedPart[] = ordered.map(([name, item]) => ({
      name,
      file: job.parts.find((part) => part.name === name)?.file ?? `parts/${name}.png`,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      scale: item.scale,
      rotation: item.rotation,
      z: item.z
    }));

    const { spine, bones, warnings } = buildSkeleton({
      name: job.name,
      canvasWidth: job.source.width,
      canvasHeight: job.source.height,
      parts: placedParts,
      animationIds: job.settings.animations
    });

    await mkdir(join(rigJobDir(jobId), "rig"), { recursive: true });
    await writeFile(rigAssetPath(jobId, "rig/skeleton.json"), `${JSON.stringify(spine, null, 2)}\n`, "utf8");

    // 预览把部件图内联成 data URI：离线打开也能看，不依赖 CDN。
    const images = [];
    for (const [name] of ordered) {
      const part = job.parts.find((entry) => entry.name === name);
      if (part?.file === undefined) continue;
      const bytes = await readFile(rigAssetPath(jobId, part.file));
      images.push({ name, dataUri: `data:${mimeOf(part.file)};base64,${bytes.toString("base64")}` });
    }
    const html = buildPreviewHtml({
      title: `${job.name} · 骨骼动画预览`,
      spine,
      images,
      defaultAnimation: job.settings.animations.includes("idle") ? "idle" : job.settings.animations[0]
    });
    await writeFile(rigAssetPath(jobId, "rig/preview.html"), html, "utf8");

    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.rig = {
      status: "ready",
      approved: false,
      skeleton: "rig/skeleton.json",
      preview: "rig/preview.html",
      bones: bones.length,
      slots: spine.slots.length,
      animations: Object.keys(spine.animations),
      warnings,
      updatedAt: Date.now()
    };
    fresh.atlas = { status: "empty" };
    appendJobLog(
      fresh.log,
      "info",
      `骨骼构建完成：${bones.length} 根骨骼 / ${spine.slots.length} 个挂点 / 动画 ${Object.keys(spine.animations).join("、")}`
    );
    await writeRigJob(fresh);
  } catch (error) {
    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.rig = { ...fresh.rig, status: "error", error: messageOf(error) };
    appendJobLog(fresh.log, "error", `骨骼构建失败：${messageOf(error)}`);
    await writeRigJob(fresh);
    throw error;
  }
}

// ── 阶段④：图集 ────────────────────────────────────────────────────────

export function startAtlas(jobId: string): { started: boolean; reason?: string } {
  try {
    assertIdle(jobId, "atlas", "图集打包");
  } catch (error) {
    return { started: false, reason: messageOf(error) };
  }
  const started = kick(jobId, "atlas", () => buildAtlas(jobId));
  return started ? { started: true } : { started: false, reason: "图集打包已在进行中" };
}

/**
 * 打包 Spine 纹理图集。
 *
 * 部件按**装配后的尺寸**入图，这样 `.atlas` 里的区域尺寸和 `skeleton.json` 里
 * 挂点的 `width` / `height` 完全一致——导入 Spine 时不会出现「图对不上骨骼」。
 */
export async function buildAtlas(jobId: string): Promise<void> {
  const job = await readRigJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const ordered = orderedItems(job);
  if (ordered.length === 0) throw new Error("还没有摆放好的部件，请先在第 ② 步装配定位");

  job.atlas.status = "running";
  job.atlas.error = undefined;
  await writeRigJob(job);

  try {
    const images: Array<{ name: string; rgba: Rgba }> = [];
    for (const [name, item] of ordered) {
      const part = job.parts.find((entry) => entry.name === name);
      if (part?.file === undefined) continue;
      const decoded = await decodeToRgba(rigAssetPath(jobId, part.file), 2048);
      images.push({
        name,
        rgba: resizeRgba({ data: decoded.rgba, width: decoded.width, height: decoded.height }, Math.max(1, item.width), Math.max(1, item.height))
      });
    }
    if (images.length === 0) throw new Error("没有可打包的部件");

    const packed = packAtlas(images.map((image) => ({ name: image.name, width: image.rgba.width, height: image.rgba.height })), 2);
    const page = createRgba(packed.width, packed.height);
    for (const placement of packed.placements) {
      const image = images.find((entry) => entry.name === placement.name);
      if (image === undefined) continue;
      blitOpaque(page, image.rgba, placement.x, placement.y);
    }

    await mkdir(join(rigJobDir(jobId), "atlas"), { recursive: true });
    await writeFile(rigAssetPath(jobId, "atlas/skeleton.png"), encodePng(page.data, page.width, page.height));
    await writeFile(
      rigAssetPath(jobId, "atlas/skeleton.atlas"),
      buildAtlasText("skeleton.png", packed.width, packed.height, packed.placements),
      "utf8"
    );

    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.atlas = {
      status: "ready",
      approved: false,
      image: "atlas/skeleton.png",
      text: "atlas/skeleton.atlas",
      width: packed.width,
      height: packed.height,
      regions: packed.placements.length,
      updatedAt: Date.now()
    };
    appendJobLog(fresh.log, "info", `图集打包完成：${packed.width}×${packed.height}，${packed.placements.length} 个区域`);
    await writeRigJob(fresh);
  } catch (error) {
    const fresh = await readRigJob(jobId);
    if (fresh === undefined) return;
    fresh.atlas = { ...fresh.atlas, status: "error", error: messageOf(error) };
    appendJobLog(fresh.log, "error", `图集打包失败：${messageOf(error)}`);
    await writeRigJob(fresh);
    throw error;
  }
}

/** 图集里的区域互不重叠，直接整块覆盖写入即可（不走 source-over 混合）。 */
function blitOpaque(dst: Rgba, src: Rgba, x: number, y: number): void {
  for (let row = 0; row < src.height; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= dst.height) continue;
    src.data.copy(dst.data, (ty * dst.width + x) * 4, row * src.width * 4, (row + 1) * src.width * 4);
  }
}

export { RIG_ANIMATIONS, boxMask };
