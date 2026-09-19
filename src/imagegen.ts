/**
 * 图片生成模块。
 *
 * 用火山方舟的 Seedream 系列按提示词生成图片，可选带参考图；生成后可以直接
 * 走一遍绿幕抠像导出透明 PNG。也支持把**已有的**图片传进来只做抠像——
 * 这样它同时也是一个通用的绿幕抠像工具。
 *
 * 目录结构：
 *   <DSH_HOME>/game-material-master/image-jobs/<任务 id>/
 *     job.json
 *     refs/    上传的参考图
 *     out/     生成的（或用户上传的）原图
 *     keyed/   抠完背景的透明 PNG
 */

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { imageJobsRoot, loadConfig } from "./config.js";
import { generateImage } from "./ark.js";
import { decodeToRgba, mimeOf, toDataUri } from "./media.js";
import { keyGreen } from "./chroma.js";
import { encodePng } from "./png.js";
import { appendJobLog, messageOf, readJson, writeJsonAtomic, type JobLogEntry } from "./jsonio.js";

export type ItemStatus = "empty" | "running" | "ready" | "error";

export interface ImageItem {
  index: number;
  status: ItemStatus;
  /** 原图（相对任务目录），可能是生成的，也可能是用户上传的。 */
  file?: string;
  /** 抠像结果。 */
  keyedFile?: string;
  /** 判定为背景的像素占比，用来判断抠像是否可信。 */
  backgroundFraction?: number;
  source: "generated" | "uploaded";
  error?: string;
  updatedAt?: number;
}

export interface KeyingSettings {
  enabled: boolean;
  keyLow: number;
  keyHigh: number;
  despill: number;
  bgTolerance: number;
  edgeShrink: number;
}

export interface ImageJob {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  prompt: string;
  /** 统一附加提示词：非空时接在主提示词后面。 */
  suffix: string;
  refs: Array<{ file: string; name: string }>;
  settings: {
    model: string;
    size: string;
    count: number;
    watermark: boolean;
  };
  keying: KeyingSettings;
  items: ImageItem[];
  log: JobLogEntry[];
}

export interface ImageJobSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  total: number;
  ready: number;
  keyed: number;
}

const JOB_ID_PATTERN = /^i[a-z0-9]{4,40}$/;

export function imageJobDir(id: string): string {
  return join(imageJobsRoot(), id);
}

function jobFile(id: string): string {
  return join(imageJobDir(id), "job.json");
}

/** 任务内相对路径 → 绝对路径，并挡住目录穿越。 */
export function imageAssetPath(id: string, relative: string): string {
  const base = resolve(imageJobDir(id));
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`非法的任务内路径：${relative}`);
  return target;
}

export function isValidImageJobId(id: string): boolean {
  return JOB_ID_PATTERN.test(id);
}

export async function ensureImageJobLayout(id: string): Promise<void> {
  for (const sub of ["refs", "out", "keyed"]) await mkdir(join(imageJobDir(id), sub), { recursive: true });
}

export async function createImageJob(name: string): Promise<ImageJob> {
  const config = await loadConfig();
  const id = `i${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const now = Date.now();
  const job: ImageJob = {
    id,
    name: name.trim() === "" ? "未命名图片任务" : name.trim().slice(0, 80),
    createdAt: now,
    updatedAt: now,
    prompt: "",
    suffix: "",
    refs: [],
    settings: {
      model: config.arkModel,
      size: config.arkSize,
      count: 1,
      watermark: config.arkWatermark
    },
    keying: {
      enabled: false,
      keyLow: config.keyLow,
      keyHigh: config.keyHigh,
      despill: config.despill,
      bgTolerance: config.bgTolerance,
      edgeShrink: config.edgeShrink
    },
    items: [],
    log: []
  };
  await ensureImageJobLayout(id);
  await writeJsonAtomic(jobFile(id), job);
  return job;
}

export async function readImageJob(id: string): Promise<ImageJob | undefined> {
  if (!isValidImageJobId(id)) return undefined;
  const raw = await readJson<ImageJob>(jobFile(id));
  if (raw === undefined) return undefined;
  return normalizeImageJob(raw);
}

export async function writeImageJob(job: ImageJob): Promise<void> {
  job.updatedAt = Date.now();
  await writeJsonAtomic(jobFile(job.id), job);
}

export async function listImageJobs(): Promise<ImageJobSummary[]> {
  const { readdir } = await import("node:fs/promises");
  let entries: string[] = [];
  try {
    const dirents = await readdir(imageJobsRoot(), { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory() && isValidImageJobId(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  const out: ImageJobSummary[] = [];
  for (const id of entries) {
    const job = await readImageJob(id);
    if (job === undefined) continue;
    out.push(summarizeImageJob(job));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function summarizeImageJob(job: ImageJob): ImageJobSummary {
  return {
    id: job.id,
    name: job.name,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    total: job.items.length,
    ready: job.items.filter((item) => item.status === "ready").length,
    keyed: job.items.filter((item) => item.keyedFile !== undefined).length
  };
}

export async function deleteImageJob(id: string): Promise<void> {
  await rm(imageJobDir(id), { recursive: true, force: true });
}

function normalizeImageJob(raw: any): ImageJob {
  const items: ImageItem[] = Array.isArray(raw?.items)
    ? raw.items.map((item: any, index: number) => ({
        index: Number.isFinite(item?.index) ? item.index : index,
        status: (item?.status ?? "empty") as ItemStatus,
        file: typeof item?.file === "string" ? item.file : undefined,
        keyedFile: typeof item?.keyedFile === "string" ? item.keyedFile : undefined,
        backgroundFraction: typeof item?.backgroundFraction === "number" ? item.backgroundFraction : undefined,
        source: item?.source === "uploaded" ? "uploaded" : "generated",
        error: typeof item?.error === "string" ? item.error : undefined,
        updatedAt: typeof item?.updatedAt === "number" ? item.updatedAt : undefined
      }))
    : [];
  return {
    id: String(raw?.id ?? ""),
    name: typeof raw?.name === "string" && raw.name.trim() !== "" ? raw.name : "未命名图片任务",
    createdAt: Number(raw?.createdAt) || Date.now(),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
    prompt: typeof raw?.prompt === "string" ? raw.prompt : "",
    suffix: typeof raw?.promptSuffix === "string" ? raw.promptSuffix : typeof raw?.suffix === "string" ? raw.suffix : "",
    refs: Array.isArray(raw?.refs)
      ? raw.refs.filter((r: any) => typeof r?.file === "string").map((r: any) => ({ file: r.file, name: String(r.name ?? basename(r.file)) }))
      : [],
    settings: {
      model: typeof raw?.settings?.model === "string" ? raw.settings.model : "",
      size: typeof raw?.settings?.size === "string" ? raw.settings.size : "2K",
      count: Math.min(8, Math.max(1, Number(raw?.settings?.count) || 1)),
      watermark: raw?.settings?.watermark === true
    },
    keying: {
      enabled: raw?.keying?.enabled === true,
      keyLow: num(raw?.keying?.keyLow, 14),
      keyHigh: num(raw?.keying?.keyHigh, 80),
      despill: num(raw?.keying?.despill, 0.65),
      bgTolerance: num(raw?.keying?.bgTolerance, 90),
      edgeShrink: num(raw?.keying?.edgeShrink, 0)
    },
    items,
    log: Array.isArray(raw?.log) ? raw.log.slice(-200) : []
  };
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

/** 从 base64 头部嗅探图片类型。 */
export function sniffImage(base64: string): { ext: string; mime: string } | undefined {
  let head: Buffer;
  try {
    head = Buffer.from(base64.slice(0, 64), "base64");
  } catch {
    return undefined;
  }
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50) return { ext: "png", mime: "image/png" };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8) return { ext: "jpg", mime: "image/jpeg" };
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  if (head.length >= 2 && head.toString("ascii", 0, 2) === "BM") return { ext: "bmp", mime: "image/bmp" };
  return undefined;
}

export function safeName(input: string): string {
  const base = basename(input).replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_");
  return base === "" ? "file" : base.slice(0, 120);
}

export function buildPrompt(job: ImageJob): string {
  const base = job.prompt.trim();
  const suffix = job.suffix.trim();
  if (base === "") return "";
  return suffix === "" ? base : `${base}\n${suffix}`;
}

/** 生成一张图（内部一次调用）。 */
export async function generateImageItem(jobId: string, index: number): Promise<void> {
  const job = await readImageJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const config = await loadConfig();
  const prompt = buildPrompt(job);
  if (prompt === "") throw new Error("提示词为空，请先填写");
  if (config.arkApiKey.trim() === "") throw new Error("尚未配置火山方舟 API Key");

  const item: ImageItem = job.items[index] ?? { index, status: "empty", source: "generated" };
  job.items[index] = { ...item, status: "running", error: undefined };
  appendJobLog(job.log, "info", `开始生成第 ${index + 1} 张`);
  await writeImageJob(job);

  try {
    const refs = await Promise.all(job.refs.map((ref) => toDataUri(imageAssetPath(jobId, ref.file), mimeOf(ref.file))));
    const result = await generateImage({
      baseUrl: config.arkBaseUrl,
      apiKey: config.arkApiKey,
      model: job.settings.model || config.arkModel,
      prompt,
      images: refs,
      size: job.settings.size || config.arkSize,
      watermark: job.settings.watermark,
      timeoutMs: config.arkTimeoutMs
    });

    const relative = `out/img-${String(index).padStart(2, "0")}.${result.ext}`;
    await writeFile(imageAssetPath(jobId, relative), result.bytes);

    const fresh = await readImageJob(jobId);
    if (fresh === undefined) return;
    const next = fresh.items[index] ?? { index, status: "empty" as ItemStatus, source: "generated" as const };
    next.status = "ready";
    next.file = relative;
    next.source = "generated";
    next.error = undefined;
    next.updatedAt = Date.now();
    next.keyedFile = undefined;
    next.backgroundFraction = undefined;
    fresh.items[index] = next;
    appendJobLog(fresh.log, "info", `第 ${index + 1} 张生成完成（${(result.bytes.length / 1024).toFixed(0)} KB）`);

    if (fresh.keying.enabled) await keyItem(fresh, index);
    await writeImageJob(fresh);
  } catch (error) {
    const fresh = await readImageJob(jobId);
    if (fresh === undefined) return;
    const target = fresh.items[index] ?? { index, status: "empty" as ItemStatus, source: "generated" as const };
    target.status = "error";
    target.error = messageOf(error);
    target.updatedAt = Date.now();
    fresh.items[index] = target;
    appendJobLog(fresh.log, "error", `第 ${index + 1} 张生成失败：${target.error}`);
    await writeImageJob(fresh);
    throw error;
  }
}

/** 对某一张跑绿幕抠像并写出透明 PNG。就地修改传入的 job（不落盘）。 */
export async function keyItem(job: ImageJob, index: number): Promise<void> {
  const item = job.items[index];
  if (item?.file === undefined) return;
  const decoded = await decodeToRgba(imageAssetPath(job.id, item.file), 2048);
  const result = keyGreen(decoded.rgba, decoded.width, decoded.height, {
    keyLow: job.keying.keyLow,
    keyHigh: job.keying.keyHigh,
    despill: job.keying.despill,
    edgeShrink: job.keying.edgeShrink,
    bgTolerance: job.keying.bgTolerance
  });
  const relative = `keyed/img-${String(index).padStart(2, "0")}.png`;
  await writeFile(imageAssetPath(job.id, relative), encodePng(result.rgba, decoded.width, decoded.height));
  item.keyedFile = relative;
  item.backgroundFraction = result.backgroundFraction;
}

/** 重新对全部已生成的图跑一遍抠像（改参数后调用）。 */
export async function rekeyImageJob(jobId: string): Promise<ImageJob> {
  const job = await readImageJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  let count = 0;
  for (let i = 0; i < job.items.length; i++) {
    if (job.items[i]?.file === undefined) continue;
    try {
      await keyItem(job, i);
      count++;
    } catch (error) {
      job.items[i].error = messageOf(error);
      appendJobLog(job.log, "error", `第 ${i + 1} 张抠像失败：${job.items[i].error}`);
    }
  }
  appendJobLog(job.log, "info", `抠像完成：${count} 张（背景占比可在每张下方查看）`);
  await writeImageJob(job);
  return job;
}

/** 上传一张已有图片作为生成结果（用于只做抠像的场景）。 */
export async function addImageToJob(jobId: string, name: string, base64: string): Promise<ImageItem> {
  const job = await readImageJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const sniffed = sniffImage(base64);
  if (sniffed === undefined) throw new Error("无法识别的图片格式（支持 PNG / JPEG / WebP / BMP）");
  const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (bytes.length === 0) throw new Error("图片数据为空");
  if (bytes.length > 30 * 1024 * 1024) throw new Error("图片超过 30 MB");

  const index = job.items.length;
  const relative = `out/upload-${String(index).padStart(2, "0")}.${sniffed.ext}`;
  await mkdir(join(imageJobDir(jobId), "out"), { recursive: true });
  await writeFile(imageAssetPath(jobId, relative), bytes);

  const item: ImageItem = { index, status: "ready", file: relative, source: "uploaded", updatedAt: Date.now() };
  job.items.push(item);
  appendJobLog(job.log, "info", `已上传图片：${safeName(name)}`);
  if (job.keying.enabled) {
    try {
      await keyItem(job, index);
    } catch (error) {
      appendJobLog(job.log, "error", `上传图片抠像失败：${messageOf(error)}`);
    }
  }
  await writeImageJob(job);
  return job.items[index];
}

/** 上传参考图。 */
export async function addImageRef(jobId: string, name: string, base64: string): Promise<void> {
  const job = await readImageJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const sniffed = sniffImage(base64);
  if (sniffed === undefined) throw new Error("无法识别的图片格式（支持 PNG / JPEG / WebP / BMP）");
  if (job.refs.length >= 10) throw new Error("参考图最多 10 张");

  const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (bytes.length === 0) throw new Error("图片数据为空");
  const stem = safeName(name).replace(/\.[^.]+$/, "") || "ref";
  const relative = `refs/${stem}-${randomUUID().slice(0, 4)}.${sniffed.ext}`;
  await mkdir(join(imageJobDir(jobId), "refs"), { recursive: true });
  await writeFile(imageAssetPath(jobId, relative), bytes);

  job.refs.push({ file: relative, name: safeName(name) });
  appendJobLog(job.log, "info", `已添加参考图：${safeName(name)}`);
  await writeImageJob(job);
}

export async function removeImageRef(jobId: string, file: string): Promise<void> {
  const job = await readImageJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  job.refs = job.refs.filter((ref) => ref.file !== file);
  await writeImageJob(job);
}

export async function removeImageItem(jobId: string, index: number): Promise<void> {
  const job = await readImageJob(jobId);
  if (job === undefined) throw new Error(`任务不存在：${jobId}`);
  const item = job.items[index];
  if (item?.file !== undefined) await rm(imageAssetPath(jobId, item.file), { force: true }).catch(() => undefined);
  if (item?.keyedFile !== undefined) await rm(imageAssetPath(jobId, item.keyedFile), { force: true }).catch(() => undefined);
  job.items.splice(index, 1);
  job.items.forEach((entry, i) => {
    entry.index = i;
  });
  await writeImageJob(job);
}

/** 任务目录是否真实存在。 */
export async function imageJobExists(id: string): Promise<boolean> {
  try {
    return (await stat(imageJobDir(id))).isDirectory();
  } catch {
    return false;
  }
}

export { readFile };
