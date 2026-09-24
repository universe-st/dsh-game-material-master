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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig, type Config } from "./config.js";
import {
  DEFAULT_TURN_PROMPT,
  DIRECTIONS,
  DIRECTION_KEYS,
  TURN_DIRECTION_DEFAULT,
  TURN_FRAME_COUNT_MAX,
  TURN_FRAME_COUNT_MIN,
  directionOf,
  turnOrder,
  type TurnDirection
} from "./directions.js";
import { generateImage } from "./ark.js";
import { downloadVideo, queryVideo, retrieveFile, submitVideo } from "./minimax.js";
import { extractFrames, mimeOf, toDataUri, toJpegDataUri } from "./media.js";
import { composeSheet, keyGreen, type SheetRow } from "./chroma.js";
import { encodePng } from "./png.js";
import {
  assetPath,
  freshPicks,
  log,
  patchProject,
  readProject,
  referenceFiles,
  type Project,
  type ProjectSettings
} from "./store.js";

/** 生图的依赖分层：同一层内可并发，层与层之间必须按序。 */
const IMAGE_STAGES: string[][] = [
  ["front"],
  ["back"],
  ["downLeft", "downRight"],
  ["upLeft", "upRight"],
  ["left", "right"]
];

export interface JobInfo {
  key: string;
  label: string;
  startedAt: number;
  /**
   * 这个任务还要负责哪些方向（界面据此盖住「还没轮到 / 产物还没出来」的那些）。
   *
   * 为什么必须由宿主公布：`runFrames` / `runVideos` / `runImages` 都是 kick 型调用，
   * 一提交就返回 `{started: true}`，真正的活是一个方向一个方向做的，宿主把节点写成
   * running 也是一个个来的。浏览器半区那张本地 pending 表只多留 700ms，盖不住
   * 「还没轮到」的那段空窗期——实测表现就是点「提取全部序列帧」后八个方向先转圈，
   * 紧接着变回「尚未抽帧」，过一阵才陆续出结果。
   *
   * 方向做完了就从列表里摘掉（见 `dropJobTarget`），不能一直挂着：摘晚了会把
   * 已经出好的产物一直盖着。
   */
  targets?: string[];
}

const jobs = new Map<string, Map<string, JobInfo>>();
const pollers = new Map<string, ReturnType<typeof setInterval>>();
let disposed = false;

export function disposePipeline(): void {
  disposed = true;
  for (const timer of pollers.values()) clearInterval(timer);
  pollers.clear();
  jobs.clear();
}

export function listJobs(projectId: string): JobInfo[] {
  return [...(jobs.get(projectId)?.values() ?? [])];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function arkRequest(config: Config) {
  return {
    baseUrl: config.arkBaseUrl,
    apiKey: config.arkApiKey,
    model: config.arkModel,
    timeoutMs: config.arkTimeoutMs
  };
}

function miniMaxRequest(config: Config) {
  return {
    baseUrl: config.minimaxBaseUrl,
    apiKey: config.minimaxApiKey,
    model: config.minimaxModel,
    timeoutMs: config.minimaxTimeoutMs
  };
}

/** 把一个后台任务登记进运行表并立刻返回；重复的 taskKey 会被拒绝。 */
function kick(projectId: string, taskKey: string, label: string, fn: () => Promise<void>): boolean {
  if (disposed) return false;
  const map = jobs.get(projectId) ?? new Map<string, JobInfo>();
  jobs.set(projectId, map);
  if (map.has(taskKey)) return false;
  map.set(taskKey, { key: taskKey, label, startedAt: Date.now() });
  void (async () => {
    try {
      await fn();
    } catch (error) {
      await patchProject(projectId, (project) => {
        log(project, "error", `${label}失败：${messageOf(error)}`);
      }).catch(() => undefined);
    } finally {
      map.delete(taskKey);
      if (map.size === 0) jobs.delete(projectId);
    }
  })();
  return true;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length || disposed) return;
        await fn(items[index], index);
      }
    })
  );
}

/**
 * 公布 / 更新一个后台任务覆盖的方向。
 *
 * 在 kick 的回调**第一个 await 之前**调用，远程调用返回时列表已经就绪——
 * 界面第一次轮询就能看到，不会出现「本地 pending 撤了、宿主列表还没写」的空窗。
 */
function setJobTargets(projectId: string, taskKey: string, targets: string[]): void {
  const info = jobs.get(projectId)?.get(taskKey);
  if (info !== undefined) info.targets = [...targets];
}

/** 某个方向的产物已经可见，从任务的覆盖面里摘掉，界面不再盖着它。 */
function dropJobTarget(projectId: string, taskKey: string, key: string): void {
  const info = jobs.get(projectId)?.get(taskKey);
  if (info === undefined || info.targets === undefined) return;
  info.targets = info.targets.filter((item) => item !== key);
}

// ── 阶段 1：八方向绿幕图 ──────────────────────────────────────────────────

export interface StartImageOptions {
  prompt?: string;
}

export function startImage(projectId: string, key: string, options: StartImageOptions = {}): { started: boolean; reason?: string } {
  const direction = directionOf(key);
  if (direction === undefined) return { started: false, reason: `未知方向：${key}` };
  if (jobs.get(projectId)?.has(`image:${key}`) === true) return { started: false, reason: "该方向正在生成中" };

  const started = kick(projectId, `image:${key}`, `生成「${direction.label}」`, () => generateOne(projectId, key, options.prompt));
  return started ? { started: true } : { started: false, reason: "任务已在进行中" };
}

async function generateOne(projectId: string, key: string, promptOverride?: string): Promise<void> {
  const direction = directionOf(key);
  if (direction === undefined) throw new Error(`未知方向：${key}`);

  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  const config = await loadConfig();

  const basePrompt = (promptOverride ?? project.prompts.images[key] ?? "").trim();
  if (basePrompt === "") throw new Error("提示词为空，请先填写生图提示词");
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
  } catch (error) {
    const message = messageOf(error);
    await patchProject(projectId, (current) => {
      current.images[key] = { ...current.images[key], status: "error", error: message };
      log(current, "error", `「${direction.label}」生成失败：${message}`);
    });
    throw error;
  }
}

function markDependentsStale(project: Project, changed: string): void {
  for (const direction of DIRECTIONS) {
    if (!direction.refs.includes(changed)) continue;
    const node = project.images[direction.key];
    if (node?.status === "ready") node.stale = true;
  }
}

/** 按依赖顺序把八张图全部生成一遍（用户已手工通过的图会被跳过）。 */
export function startAllImages(projectId: string, force = false): { started: boolean; reason?: string } {
  const started = kick(projectId, "images:all", "批量生成八方向图", async () => {
    // 一开工先把八个方向都盖住（与「刚点下去」时本地 pending 表的表现一致），
    // 等这一批到底要重做哪些方向算出来再收窄——生图要跑好几分钟，
    // 已经通过验收、这次不会重做的方向不能一直盖着。
    setJobTargets(projectId, "images:all", DIRECTION_KEYS);
    const plan: string[][] = [];
    for (const stage of IMAGE_STAGES) {
      const project = await readProject(projectId);
      if (project === undefined) throw new Error(`项目不存在：${projectId}`);
      plan.push(
        stage.filter((key) => {
          const node = project.images[key];
          const fresh = node?.status === "ready" && node.stale !== true;
          return force || !(fresh && node.approved);
        })
      );
    }
    // 收窄到这一批真要做的方向：还没轮到的也要盖住，跳过的一个都不多盖。
    setJobTargets(projectId, "images:all", plan.flat());
    const config = await loadConfig();
    for (const todo of plan) {
      if (disposed) return;
      // 出图落地后逐个摘掉：成功是露出新图，失败是露出错误。
      await mapLimit(todo, config.concurrency, async (key) => {
        try {
          await generateOne(projectId, key, undefined);
        } catch {
          // generateOne 已经把错误写进节点状态，这里继续推进其余方向。
        } finally {
          dropJobTarget(projectId, "images:all", key);
        }
      });
    }
  });
  return started ? { started: true } : { started: false, reason: "批量生成已在进行中" };
}

// ── 阶段 1b：转圈截帧（八方向绿幕图的默认生成方式）──────────────────────
//
// 一次生成、多次截取：整圈只有一段视频，八个方向是它时间轴上的八个截帧位置。
// 好处是八个方向天生一致（同一个角色、同一段光线、同一套画风），
// 代价是分辨率取决于视频、以及「转速是否真的均匀」——所以位置必须可拖。

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 转圈视频的首帧。
 *
 * 优先用已经有的正面绿幕图，没有就退回源图：源图不一定是绿幕，但提示词里
 * 已经明确要求「纯色绿幕 #00FF00」，模型会照着重画背景。把实际用的那张记进
 * `turn.video.firstFrame`，排查「第一帧就不是正面」时才有据可依。
 */
function turnFirstFrame(project: Project): { file: string; label: string } | undefined {
  const front = project.images["front"]?.file;
  if (front !== undefined) return { file: front, label: "正面绿幕图" };
  if (project.source !== null) return { file: project.source.file, label: "源图" };
  return undefined;
}

export function startTurnVideo(projectId: string): { started: boolean; reason?: string } {
  if (jobs.get(projectId)?.has("turn:video") === true) return { started: false, reason: "转圈视频正在生成中" };
  const started = kick(projectId, "turn:video", "生成转圈视频", () => submitTurnVideo(projectId));
  return started ? { started: true } : { started: false, reason: "任务已在进行中" };
}

async function submitTurnVideo(projectId: string): Promise<void> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  const config = await loadConfig();
  if (config.minimaxApiKey.trim() === "") throw new Error("尚未配置 MiniMax API Key");

  const first = turnFirstFrame(project);
  if (first === undefined) throw new Error("还没有源图，无法生成转圈视频");

  const base = (project.prompts.turn ?? DEFAULT_TURN_PROMPT).trim();
  if (base === "") throw new Error("提示词为空，请先填写转圈视频提示词");
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
    if (current.turn.frames.frames.length > 0) current.turn.frames.stale = true;
    log(current, "info", `开始生成转圈视频（首帧：${first.label}）`);
  });

  const startedAt = Date.now();
  try {
    const jpegRel = "videos/turn-first-frame.jpg";
    const dataUri = await toJpegDataUri(assetPath(projectId, first.file), assetPath(projectId, jpegRel));
    const taskId = await submitVideo({
      ...miniMaxRequest(config),
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
        taskId,
        remoteStatus: "已提交",
        elapsedMs: Date.now() - startedAt,
        updatedAt: Date.now()
      };
      log(current, "info", `转圈视频任务已提交（${taskId}）`);
    });
    ensurePoller(projectId);
  } catch (error) {
    const message = messageOf(error);
    await patchProject(projectId, (current) => {
      current.turn.video = { ...current.turn.video, status: "error", error: message, remoteStatus: "提交失败", updatedAt: Date.now() };
      log(current, "error", `转圈视频提交失败：${message}`);
    });
    throw error;
  }
}

/** 轮询一次转圈视频任务（由 ensurePoller 的定时器驱动）。 */
async function pollTurnVideoOnce(projectId: string, config: Config): Promise<void> {
  const project = await readProject(projectId);
  if (project === undefined) return;
  const taskId = project.turn?.video?.taskId;
  if (project.turn?.video?.status !== "running" || taskId === undefined) return;

  const request = miniMaxRequest(config);
  try {
    const query = await queryVideo({ ...request, taskId });
    if (query.status === "failed") {
      const reason = query.error ?? "MiniMax 报告该任务失败";
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

    const url =
      query.videoUrl ??
      (query.fileId !== undefined ? await retrieveFile({ ...request, fileId: query.fileId }) : undefined);
    if (url === undefined) throw new Error("任务已成功，但响应里既没有视频地址也没有 file_id");

    const bytes = await downloadVideo(url, config.minimaxTimeoutMs);
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
  } catch (error) {
    // 单次轮询失败不等于任务失败（网络抖动很常见），保留 running 让下一轮重试。
    await patchProject(projectId, (current) => {
      const node = current.turn?.video;
      if (node !== undefined) node.remoteStatus = `查询异常：${messageOf(error)}`;
    });
  }
}

export function startTurnFrames(projectId: string, count?: number): { started: boolean; reason?: string } {
  if (jobs.get(projectId)?.has("turn:frames") === true) return { started: false, reason: "抽帧已在进行中" };
  const started = kick(projectId, "turn:frames", "抽取转圈候选帧", async () => {
    // 第一个 await 之前公布覆盖面：抽完候选帧才会逐个切出八张方向图，
    // 那段空窗里八个格子全靠这张表盖着（与批量抽帧同一套约定）。
    setJobTargets(projectId, "turn:frames", DIRECTION_KEYS);
    await extractTurnFrames(projectId, count);
  });
  return started ? { started: true } : { started: false, reason: "任务已在进行中" };
}

/**
 * 候选帧数变了之后，把用户拖过的位置按比例换算过去。
 *
 * 直接保留下标是不行的：32 帧里的第 17 帧和 64 帧里的第 17 帧朝向完全不同，
 * 相当于把用户调好的八个位置整体打乱。按比例缩放至少保持「相对位置」不变。
 */
function rescalePicks(picks: Record<string, number>, from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  const ratio = from > 0 ? to / from : 1;
  for (const key of DIRECTION_KEYS) {
    out[key] = clampInt((picks[key] ?? 0) * ratio, 0, Math.max(0, to - 1));
  }
  return out;
}

async function extractTurnFrames(projectId: string, count?: number): Promise<void> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  if (project.turn?.video?.file === undefined) throw new Error("还没有转圈视频，请先生成转圈视频");

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

    const files: string[] = [];
    const times: number[] = [];
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
    const picks =
      previous.rawFrameCount !== undefined && previous.rawFrameCount > 0
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
      log(
        current,
        "info",
        `候选帧抽取完成：${files.length} 张 / ${extracted.width}×${extracted.height} / 视频时长 ${extracted.duration.toFixed(2)} 秒`
      );
    });

    await applyTurnPicks(projectId);
  } catch (error) {
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
export async function applyTurnPicks(projectId: string, keys?: string[]): Promise<void> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  const node = project.turn?.frames;
  if (node?.raw === undefined || node.rawWidth === undefined || node.rawWidth <= 0) {
    throw new Error("还没有候选帧，请先抽取转圈候选帧");
  }
  const width = node.rawWidth;
  const height = node.rawHeight;
  const raw = await readFile(assetPath(projectId, node.raw));
  const frameBytes = width * height * 4;
  const total = Math.max(0, Math.floor(raw.length / frameBytes));
  if (total === 0) throw new Error("候选帧缓存是空的，请重新抽取候选帧");

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
export async function setTurnPick(projectId: string, key: string, index: number): Promise<{ index: number; changed: boolean }> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  if (directionOf(key) === undefined) throw new Error(`未知方向：${key}`);
  const total = project.turn?.frames?.frames?.length ?? 0;
  const next = clampInt(index, 0, Math.max(0, total - 1));
  const currentPick = project.turn?.frames?.picks?.[key];
  const unchanged = currentPick === next && project.images[key]?.file !== undefined;

  await patchProject(projectId, (current) => {
    current.turn.frames.picks = { ...current.turn.frames.picks, [key]: next };
  });
  // 位置没变、图也已经在，就别白重切一遍——更要紧的是**不要**因此把下游作废。
  if (!unchanged) await applyTurnPicks(projectId, [key]);
  return { index: next, changed: !unchanged };
}

/** 重新铺一遍八个位置（用一个转圈方向的默认等分位置）。 */
export async function resetTurnPicks(projectId: string, direction?: TurnDirection): Promise<void> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  const round: TurnDirection = direction ?? project.turn?.direction ?? TURN_DIRECTION_DEFAULT;
  const count = project.turn?.frames?.frames?.length || project.settings.turnFrameCount;
  await patchProject(projectId, (current) => {
    current.turn.direction = round;
    current.turn.frames.picks = freshPicks(count, round);
    log(
      current,
      "info",
      `八个截帧位置已重置为${round === "ccw" ? "逆时针" : "顺时针"}的默认等分位置（依次：${turnOrder(round)
        .map((key) => directionOf(key)?.label ?? key)
        .join(" → ")}）`
    );
  });
  if ((project.turn?.frames?.raw ?? undefined) !== undefined) await applyTurnPicks(projectId);
}

/**
 * 一次写多个截帧位置（agent 看完条带后整份写回，与 `setRigLayoutHints` 同一角色）。
 *
 * 只看单张方向图判断不了「是不是转反了」——必须对着整圈条带看。所以这条路的
 * 正确用法是：`read_image` 看 `turn.stripUrl` → 判断八个朝向各落在第几帧 →
 * 一次写回，而不是逐个点方向图去猜。
 */
export async function setTurnPicks(projectId: string, picks: Record<string, number>): Promise<{ picks: Record<string, number> }> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  const total = project.turn?.frames?.frames?.length ?? 0;
  const next: Record<string, number> = { ...(project.turn?.frames?.picks ?? {}) };
  const keys: string[] = [];
  for (const [key, value] of Object.entries(picks)) {
    if (directionOf(key) === undefined) throw new Error(`未知方向：${key}`);
    if (!Number.isFinite(Number(value))) throw new Error(`${key} 的截帧位置必须是数字`);
    next[key] = clampInt(Number(value), 0, Math.max(0, total - 1));
    keys.push(key);
  }
  if (keys.length === 0) throw new Error("没有要改的方向");
  await patchProject(projectId, (current) => {
    current.turn.frames.picks = next;
  });
  if (total > 0) await applyTurnPicks(projectId, keys);
  return { picks: next };
}

/** 切换阶段①的生成方式。只换「怎么产出八张图」，产物一律不动。 */
export async function setImageMode(projectId: string, mode: "turn" | "direct"): Promise<void> {
  await patchProject(projectId, (project) => {
    if (project.imageMode === mode) return;
    project.imageMode = mode;
    log(project, "info", mode === "turn" ? "阶段①改用「转圈截帧」" : "阶段①改用「逐方向生图」");
  });
}

// ── 阶段 2：八段视频 ──────────────────────────────────────────────────────

export function startVideos(projectId: string, keys?: string[]): { started: boolean; reason?: string } {
  const started = kick(projectId, "videos:submit", "提交视频任务", async () => {
    // 第一个 await 之前就把覆盖面公布出去：远程调用返回时界面已经能靠它
    // 盖住「还没轮到」的方向，不必等本地 pending 表那 700ms 的缓冲。
    setJobTargets(projectId, "videos:submit", keys ?? DIRECTION_KEYS);
    const project = await readProject(projectId);
    if (project === undefined) throw new Error(`项目不存在：${projectId}`);
    const config = await loadConfig();
    if (config.minimaxApiKey.trim() === "") throw new Error("尚未配置 MiniMax API Key");

    const targets = (keys ?? DIRECTION_KEYS).filter((key) => {
      const image = project.images[key];
      const video = project.videos[key];
      if (image?.file === undefined) return false;
      if (video?.status === "ready") return false;
      // 已经在跑的任务绝不能重复提交：覆盖掉 taskId 会让前一个任务变成
      // 无人认领的孤儿，钱照花、结果拿不到。
      if (video?.status === "running" && typeof video.taskId === "string") return false;
      return true;
    });
    // 收窄成真正要提交的那几个：被跳过（已经完成）的方向不该被盖上遮罩。
    setJobTargets(projectId, "videos:submit", targets);
    if (targets.length === 0) {
      const already = (keys ?? DIRECTION_KEYS).filter((key) => project.videos[key]?.status === "running");
      throw new Error(
        already.length > 0
          ? `这些方向已经在生成中，请等它们跑完：${already.join("、")}`
          : "没有可提交的方向：请先生成绿幕图，或先清掉已完成的视频"
      );
    }

    await mapLimit(targets, config.concurrency, async (key) => {
      const label = directionOf(key)?.label ?? key;
      const fresh = await readProject(projectId);
      if (fresh === undefined) return;
      const image = fresh.images[key];
      if (image?.file === undefined) return;

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
      } catch (error) {
        const message = messageOf(error);
        await patchProject(projectId, (current) => {
          current.videos[key] = { ...current.videos[key], status: "error", error: message, remoteStatus: "提交失败", updatedAt: Date.now() };
          log(current, "error", `「${label}」视频提交失败：${message}`);
        });
      } finally {
        // 提交这一步结束（成功进 running、失败进 error）就摘掉：
        // 之后的进度由节点自己的 running 状态负责，不该再靠这张覆盖面。
        dropJobTarget(projectId, "videos:submit", key);
      }
    });

    ensurePoller(projectId);
  });
  return started ? { started: true } : { started: false, reason: "视频任务提交已在进行中" };
}

export function ensurePoller(projectId: string): void {
  if (pollers.has(projectId)) return;
  const timer = setInterval(() => {
    void pollVideosOnce(projectId).catch(() => undefined);
  }, 15000);
  timer.unref?.();
  pollers.set(projectId, timer);
  // 立刻跑一次，避免用户等满一个轮询周期。
  void pollVideosOnce(projectId).catch(() => undefined);
}

export function stopPoller(projectId: string): void {
  const timer = pollers.get(projectId);
  if (timer !== undefined) clearInterval(timer);
  pollers.delete(projectId);
}

/** 手动触发一次轮询（界面上的「刷新」按钮）。 */
export async function pollVideosOnce(projectId: string): Promise<void> {
  if (disposed) return;
  const project = await readProject(projectId);
  if (project === undefined) {
    stopPoller(projectId);
    return;
  }
  const config = await loadConfig();
  const pending = DIRECTION_KEYS.filter(
    (key) => project.videos[key]?.status === "running" && typeof project.videos[key]?.taskId === "string"
  );
  // 转圈视频走同一个轮询器：它和八段行走视频是同一类任务（同一个模型、同一套
  // query/download），单独再起一个定时器只多一份「谁负责停」的账。
  const turnPending = project.turn?.video?.status === "running" && typeof project.turn?.video?.taskId === "string";
  if (pending.length === 0 && !turnPending) {
    stopPoller(projectId);
    return;
  }

  await Promise.all(
    pending.map(async (key) => {
      const label = directionOf(key)?.label ?? key;
      const taskId = project.videos[key].taskId as string;
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
        const url =
          query.videoUrl ??
          (query.fileId !== undefined ? await retrieveFile({ ...miniMaxRequest(config), fileId: query.fileId }) : undefined);
        if (url === undefined) throw new Error("任务已成功，但响应里既没有视频地址也没有 file_id");

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
      } catch (error) {
        const message = messageOf(error);
        // 单次轮询失败不等于任务失败——网络抖动很常见，保留 running 让下一轮重试。
        await patchProject(projectId, (current) => {
          const node = current.videos[key];
          if (node !== undefined) node.remoteStatus = `查询异常：${message}`;
        });
      }
    })
  );

  if (turnPending) {
    await pollTurnVideoOnce(projectId, config).catch(() => undefined);
  }

  const after = await readProject(projectId);
  if (
    after !== undefined &&
    !DIRECTION_KEYS.some((key) => after.videos[key]?.status === "running") &&
    after.turn?.video?.status !== "running"
  ) {
    stopPoller(projectId);
  }
}

// ── 阶段 3：抽帧 ─────────────────────────────────────────────────────────

/**
 * 抽取序列帧。`keys` 是要抽的方向；省略则按「有视频的方向」全抽。
 * 调用方（`runFrames`）已经把没有视频的方向滤掉了，这里再滤一次兜底。
 */
export function startExtract(projectId: string, keys?: string[]): { started: boolean; reason?: string } {
  const started = kick(projectId, "frames:extract", "抽取序列帧", async () => {
    const scope = keys ?? DIRECTION_KEYS;
    // 第一个 await 之前就公布覆盖面，理由同 startVideos：抽帧是「一次两个方向」
    // 慢慢做的，还没轮到的方向必须靠这张表盖着，否则界面会闪回「尚未抽帧」。
    setJobTargets(projectId, "frames:extract", scope);
    const project = await readProject(projectId);
    if (project === undefined) throw new Error(`项目不存在：${projectId}`);
    const config = await loadConfig();
    const targets = scope.filter((key) => project.videos[key]?.file !== undefined);
    // 没有视频的方向不会产出任何东西，必须从覆盖面里去掉——留着它们会一直转圈。
    setJobTargets(projectId, "frames:extract", targets);
    if (targets.length === 0) throw new Error("还没有可抽帧的视频");

    await mapLimit(targets, Math.min(2, config.concurrency), async (key) => {
      const label = directionOf(key)?.label ?? key;
      const fresh = await readProject(projectId);
      if (fresh === undefined) return;
      const video = fresh.videos[key];
      if (video?.file === undefined) return;

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

        const framePaths: string[] = [];
        for (let i = 0; i < extracted.frames.length; i++) {
          const suffix = String(i).padStart(2, "0");
          const greenRelative = `frames/${key}/f${suffix}.png`;
          await writeFile(
            assetPath(projectId, greenRelative),
            encodePng(extracted.frames[i], extracted.width, extracted.height)
          );
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
          log(
            current,
            "info",
            `「${label}」抽帧完成：${framePaths.length} 帧 / ${extracted.width}×${extracted.height} / 视频时长 ${extracted.duration.toFixed(2)} 秒`
          );
        });
      } catch (error) {
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
export function startRekey(projectId: string): { started: boolean; reason?: string } {
  const started = kick(projectId, "sheet:key", "重新抠像", async () => {
    await renderSheet(projectId, { requireFrames: true });
  });
  return started ? { started: true } : { started: false, reason: "抠像任务已在进行中" };
}

export function startCompose(projectId: string): { started: boolean; reason?: string } {
  const started = kick(projectId, "sheet:compose", "合成整图", async () => {
    await renderSheet(projectId, { requireFrames: true });
  });
  return started ? { started: true } : { started: false, reason: "合成任务已在进行中" };
}

export interface RenderOptions {
  /** 一组帧都没有时直接报错（手动点「合成」时的期望），而不是产出空图。 */
  requireFrames?: boolean;
}

/**
 * 抠像 + 合成。`startExtract` / `startRekey` / `startCompose` 都走这一条路径，
 * 保证「界面看到的预览」和「最终整图」永远出自同一套参数。
 *
 * 关键点：所有方向共用**一个**裁剪框（各帧 alpha 包围盒的并集）与缩放比例，
 * 否则每个方向角色大小不一、脚底高低不齐，整图就没法当精灵图用。
 */
async function renderSheet(projectId: string, options: RenderOptions = {}): Promise<void> {
  const project = await readProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
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
    const rows: SheetRow[] = [];
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
      if (node?.rawWidth !== undefined && node.rawWidth > 0) working = { width: node.rawWidth, height: node.rawHeight };
    }

    for (const key of order) {
      const node = project.frames[key];
      const row: SheetRow = { key, frames: [], width: working.width, height: working.height };
      if (node?.raw !== undefined && node.rawWidth !== undefined && node.rawWidth > 0) {
        const width = node.rawWidth;
        const height = node.rawHeight;
        const raw = await readFile(assetPath(projectId, node.raw));
        const frameBytes = width * height * 4;
        const count = Math.max(0, Math.floor(raw.length / frameBytes));
        const keyedPaths: string[] = [];
        const keyedBuffers: Buffer[] = [];

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
      if (options.requireFrames === true) throw new Error("还没有抽过帧，请先在第 3 步抽取序列帧");
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
      const droppedNote =
        borderSamplesDropped > 0
          ? `；边框采样 ${borderSamples} 个里排除了 ${borderSamplesDropped} 个不属于背景主色的点（通常是角色贴到了画面边缘，已自动排除）`
          : "";
      log(
        current,
        "info",
        `整图合成完成：${sheet.width}×${sheet.height}（${sheet.columns} 列 × ${sheet.rows} 行，裁剪框 ${sheet.bbox.width}×${sheet.bbox.height}，背景占比 ${backgroundFraction === undefined ? "?" : (backgroundFraction * 100).toFixed(1)}%${droppedNote}）`
      );
    });
  } catch (error) {
    const message = messageOf(error);
    await patchProject(projectId, (current) => {
      current.sheet = { ...current.sheet, status: "error", error: message };
      log(current, "error", `整图合成失败：${message}`);
    });
    throw error;
  }
}

export async function clearVideos(projectId: string, keys?: string[]): Promise<void> {
  const targets = keys ?? DIRECTION_KEYS;
  await patchProject(projectId, (project) => {
    for (const key of targets) {
      project.videos[key] = { status: "empty", approved: false };
      project.frames[key] = { status: "empty", frames: [], keyed: [], approved: false };
    }
    project.sheet = { status: "empty", approved: false };
  });
}
