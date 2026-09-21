/**
 * 拆件质检（纯计算，不碰文件系统、不联网）。
 *
 * 为什么需要它：拆件是整条链路里**唯一花钱、又最难验证**的一步。它出问题的方式
 * 全都不是"报错"，而是"看起来生成了 16 个部件"——
 *
 *   · 同一个部位被画进多个网格格子（实测：4 段"大腿→膝盖"、4 只鞋袜脚、3 条整袖）；
 *   · 网格位置决定部件名，模型却按自己的理解画（实测：第 2 格叫"胯部"画的是裙子、
 *     第 9 格叫"脖子"画的是大腿）。名字错了，靠名字推出来的骨架从第一根骨头起就是错的；
 *   · 部件是重新绘制的，与参考图像素不像，模板匹配只能挑一个"不那么错"的位置，
 *     相似度 0.08~0.5 却仍然报"已定位"。
 *
 * 这三种在插件里一路绿灯，要等用户看见"头长在脚上"才发现。所以在这里把它们变成
 * **明确的、可读的结论**：重复件点名、拆件可信度打分、并给出三条具体建议。
 *
 * 判定分两级，与 `rigvalidate.ts` 一致：error = 这批拆件不可信（该重跑或该改语义），
 * warning = 能跑但值得看一眼。
 */

import type { Rgba } from "./rigpose.js";

export interface QaIssue {
  level: "error" | "warning";
  code: string;
  /** 涉及的部件名（重复件检测会是多个）。 */
  parts: string[];
  message: string;
  /** 给用户/agent 的下一步动作。 */
  suggestion?: string;
}

export interface QaDuplicateGroup {
  parts: string[];
  /** 组内**同向**轮廓重合的最低值（越高越确定是同一块）。 */
  minOverlap: number;
  /**
   * 组内互为镜像时的轮廓重合。
   *
   * 这是「重复件」与「左右件」的分水岭，实测差距很大：
   *   · 同一块重画两遍 → 同向 0.90~0.98，镜像只有 0.15~0.75（形状不对称）；
   *   · 左右各一（真·镜像件）→ 同向 0.66~0.76，镜像 0.93~0.96。
   * 所以并组只并**同向**的，镜像对天然不会被并进来。
   */
  mirroredOverlap: number;
  /**
   * true = 组内**也**互为镜像（形状本身接近对称）。
   *
   * 这种情况单看轮廓无法区分「同一块重画」与「左右各一」，所以降级成提示让人确认，
   * 而不是直接让人删掉一块——删错了就是整条胳膊没了。
   */
  symmetric: boolean;
  width: number;
  height: number;
}

export interface QaReport {
  ok: boolean;
  /** 0~1：越高越可信。综合重复率、相似度、部件数是否合理。 */
  score: number;
  issues: QaIssue[];
  duplicates: QaDuplicateGroup[];
  /** 参与检查的部件数（不含隐藏）。 */
  checked: number;
  summary: string;
}

/** 轮廓比较用的归一化网格边长。64 足够区分"大腿"和"鞋"，又不至于被抗锯齿噪声影响。 */
const PROFILE_SIZE = 64;
/** 内容包围盒的宽高比差异超过这个比例就不算同一块（避免把"细长腿"和"方裙子"判成一对）。 */
const ASPECT_TOLERANCE = 0.18;
/** 轮廓 IoU 超过它 = 疑似同一部位画了多遍。实测重复件能到 0.9+，正常不同部件 < 0.6。 */
export const DUPLICATE_IOU = 0.86;

/** 一份用于质检的部件：名字 + 像素（已经解码、裁到内容边界）。 */
export interface QaPart {
  name: string;
  rgba: Rgba;
  hidden?: boolean;
}

/**
 * 把部件压成一张**归一化轮廓位图**：裁到内容包围盒 → 缩放到 64×64 → 取 alpha 二值。
 *
 * 只比轮廓不比颜色：这次踩的坑里，重复件是"同一部位重画一遍"，颜色深浅会有出入，
 * 但形状几乎一致。比颜色会把它们判成不同件，反而漏掉。
 */
export function partProfile(
  part: QaPart,
  bounds?: { x: number; y: number; width: number; height: number },
  mirror = false
): Uint8Array | undefined {
  const box = bounds ?? contentBounds(part.rgba);
  if (box === undefined || box.width <= 0 || box.height <= 0) return undefined;
  const profile = new Uint8Array(PROFILE_SIZE * PROFILE_SIZE);
  for (let y = 0; y < PROFILE_SIZE; y++) {
    for (let x = 0; x < PROFILE_SIZE; x++) {
      // 最近邻采样：轮廓是二值的，插值只会糊掉边界。
      const sx = box.x + Math.min(box.width - 1, Math.floor(((x + 0.5) * box.width) / PROFILE_SIZE));
      const sy = box.y + Math.min(box.height - 1, Math.floor(((y + 0.5) * box.height) / PROFILE_SIZE));
      const alpha = part.rgba.data[(sy * part.rgba.width + sx) * 4 + 3];
      // `mirror` 时水平翻转：用来判「左右件」还是「同一块重画」，见 `findDuplicateParts`。
      const target = mirror ? y * PROFILE_SIZE + (PROFILE_SIZE - 1 - x) : y * PROFILE_SIZE + x;
      profile[target] = alpha > 128 ? 1 : 0;
    }
  }
  return profile;
}

/** 内容（非透明）包围盒。 */
export function contentBounds(src: Rgba, threshold = 8): { x: number; y: number; width: number; height: number } | undefined {
  let minX = src.width;
  let minY = src.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.data[(y * src.width + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return undefined;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 两张轮廓位图的交并比。 */
export function profileOverlap(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === 1 || y === 1) union++;
    if (x === 1 && y === 1) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

/**
 * 找出"同一部位画了多遍"的部件组。
 *
 * 用并查集把两两判定连成组：实测里 4 段大腿的相似度是链式的（相邻两块最像、
 * 首尾略差），两两阈值判定会把它切成 2+2，而用户看到的是"一块部位出现了 4 次"。
 */
export function findDuplicateParts(parts: QaPart[]): QaDuplicateGroup[] {
  const visible = parts.filter((part) => part.hidden !== true);
  const records = visible.map((part) => {
    const bounds = contentBounds(part.rgba);
    return {
      name: part.name,
      bounds,
      profile: partProfile(part, bounds),
      mirrored: partProfile(part, bounds, true),
      aspect: bounds === undefined ? 1 : bounds.width / bounds.height
    };
  });
  const usable = records.filter((record) => record.profile !== undefined && record.bounds !== undefined);

  const parent = new Map<string, string>();
  const find = (name: string): string => {
    let root = name;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const record of usable) parent.set(record.name, record.name);

  const pairwise: Array<{ a: string; b: string; score: number; mirrored: number }> = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      // 宽高比差太多就不可能同源，先过掉——省下大量无关比较，也避免把
      // 「细长腿」和「方头」在高 IoU 下误判成一类（归一化会抹掉长宽差异）。
      const ratio = a.aspect / b.aspect;
      if (ratio < 1 - ASPECT_TOLERANCE || ratio > 1 + ASPECT_TOLERANCE) continue;
      const score = profileOverlap(a.profile as Uint8Array, b.profile as Uint8Array);
      const mirrored = profileOverlap(a.profile as Uint8Array, b.mirrored as Uint8Array);
      // **只并同向的**。左右件（互为镜像）的同向重合实测只有 0.66~0.76，
      // 天然进不了这个阈值；万一某块形状本身接近对称，两个值会一起高，
      // 那就按 `symmetric` 降级成提示，不让人直接删。
      if (score < DUPLICATE_IOU) continue;
      union(a.name, b.name);
      pairwise.push({ a: a.name, b: b.name, score, mirrored });
    }
  }

  const groups = new Map<string, string[]>();
  for (const record of usable) {
    const root = find(record.name);
    const list = groups.get(root) ?? [];
    list.push(record.name);
    groups.set(root, list);
  }

  const out: QaDuplicateGroup[] = [];
  for (const names of groups.values()) {
    if (names.length < 2) continue;
    const related = pairwise.filter((pair) => names.includes(pair.a) && names.includes(pair.b));
    const first = usable.find((record) => record.name === names[0])!;
    const minOverlap = Math.min(...related.map((pair) => pair.score));
    const mirroredOverlap = Math.max(...related.map((pair) => pair.mirrored));
    out.push({
      parts: names.slice().sort(),
      minOverlap: Number(minOverlap.toFixed(3)),
      mirroredOverlap: Number(mirroredOverlap.toFixed(3)),
      // 镜像重合也逼近同向重合 = 这块形状本身接近对称，单看轮廓分不出
      // 「同一块重画」和「左右各一」。
      symmetric: mirroredOverlap >= minOverlap - 0.05,
      width: first.bounds?.width ?? 0,
      height: first.bounds?.height ?? 0
    });
  }
  out.sort((a, b) => b.parts.length - a.parts.length || a.parts[0].localeCompare(b.parts[0]));
  return out;
}

/** 装配质量：每个部件匹配到参考图时的相似度。 */
export interface QaMatchScore {
  name: string;
  score?: number;
  matched?: boolean;
}

export interface QaOptions {
  /** 部件像素（给了就算重复件）。 */
  parts?: QaPart[];
  /**
   * 已经算好的重复件分组。
   *
   * 重复件检测要解码全部部件 PNG，而装配阶段每拖一次都会跑一遍质检——
   * 那里只有名字和相似度，没有像素。所以允许把上一轮算好的结果传进来复用，
   * 而不是每轮重新解一遍盘。
   */
  duplicates?: QaDuplicateGroup[];
  /** 装配结果（不给就跳过相似度评估）。 */
  matches?: QaMatchScore[];
  /** 参与检查的部件数（没给 parts 时用它）。 */
  partCount?: number;
  /**
   * 参考图里**大致**能拆出多少个独立部位。
   *
   * 没法自动算准（需要视觉理解），所以由调用方给：界面上是"用户/agent 目测"，
   * 对话里是 agent 看图后填。给不出就不做这项判断——宁可不报，也不要瞎报。
   */
  expectedParts?: number;
}

/** 低于这个相似度就是"低置信度硬凑"（正常匹配应 > 0.6）。 */
export const LOW_SCORE = 0.5;
/** 低于这个相似度基本等于随机（实测错误位置常落在 0.08~0.3）。 */
export const GARBAGE_SCORE = 0.3;

/**
 * 综合体检。三件事各自独立判：
 *   1. 重复件（几何，需要像素）；
 *   2. 装配相似度（需要装配结果）；
 *   3. 部件数是否明显多于参考图可见部位数（需要 `expectedParts`）。
 *
 * 分数只用来给一个粗略的"要不要信这批拆件"的直觉，**判据永远是 issues**。
 */
export function assessParts(options: QaOptions): QaReport {
  const issues: QaIssue[] = [];
  const parts = (options.parts ?? []).filter((part) => part.hidden !== true);
  const duplicates = options.duplicates ?? (parts.length > 0 ? findDuplicateParts(parts) : []);
  const partCount = parts.length > 0 ? parts.length : (options.partCount ?? 0);

  if (duplicates.length > 0) {
    const confirmed = duplicates.filter((group) => !group.symmetric);
    const uncertain = duplicates.filter((group) => group.symmetric);
    if (confirmed.length > 0) {
      const total = confirmed.reduce((sum, group) => sum + group.parts.length, 0);
      issues.push({
        level: "error",
        code: "duplicate-parts",
        parts: confirmed.flatMap((group) => group.parts),
        message:
          `有 ${confirmed.length} 组部件**朝向相同、轮廓几乎重合**（共 ${total} 块），基本可以确定是同一个部位被画了多遍：` +
          confirmed.map((group) => `${group.parts.join(" / ")}（同向重合 ${group.minOverlap}，镜像只有 ${group.mirroredOverlap}）`).join("；") +
          "。拆件模型在多个网格格子里重复画了同一块内容，多出来的部件会被硬塞进不相干的骨骼位。",
        suggestion:
          "每组保留 1 块、隐藏其余（卡片上有「隐藏」）。注意判据：**同向**重合才是重复；" +
          "如果两块互为镜像（同向 0.66~0.76、镜像 0.93+），那是左右各一，两块都要留"
      });
    }
    if (uncertain.length > 0) {
      issues.push({
        level: "warning",
        code: "duplicate-uncertain",
        parts: uncertain.flatMap((group) => group.parts),
        message:
          `有 ${uncertain.length} 组部件轮廓高度重合、但**互为镜像的程度也一样高**（形状本身接近对称），` +
          `无法从轮廓判断是「同一块重画」还是「左右各一」：` +
          uncertain.map((group) => `${group.parts.join(" / ")}（同向 ${group.minOverlap} / 镜像 ${group.mirroredOverlap}）`).join("；"),
        suggestion: "用 read_image 看一眼这几块的方向，再决定留几块——判错了会缺一整条肢体"
      });
    }
  }

  const matches = (options.matches ?? []).filter((item) => item.matched !== false && typeof item.score === "number");
  if (matches.length > 0) {
    const scores = matches.map((item) => item.score as number);
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const low = matches.filter((item) => (item.score as number) < LOW_SCORE);
    const garbage = matches.filter((item) => (item.score as number) < GARBAGE_SCORE);
    if (mean < LOW_SCORE) {
      issues.push({
        level: "error",
        code: "layout-low-confidence",
        parts: low.map((item) => item.name),
        message:
          `装配平均相似度只有 ${mean.toFixed(3)}（正常应 > ${LOW_SCORE}），${low.length}/${matches.length} 个部件低于阈值` +
          (garbage.length > 0 ? `，其中 ${garbage.length} 个低于 ${GARBAGE_SCORE}（基本等于随机）` : "") +
          "。这通常意味着拆件图里的部件与参考图**长得不像**（部件是重新绘制的服装裁片，或角色被换过），" +
          "自动定位的结果不可信——「已定位 N/M」这个数字本身不会告诉你这件事。",
        suggestion:
          "用 read_image 看参考图与 parts-montage.png，判断每块部件在参考图的哪个位置，用 " +
          "`setRigLayoutHints` 写下大致像素框再重跑 `runRigLayout`；被遮挡、参考图里没有对应像素的部位（例如裙下的整段大腿）直接给最终位置，不要指望模板匹配"
      });
    } else if (low.length > 0) {
      issues.push({
        level: "warning",
        code: "layout-some-low",
        parts: low.map((item) => item.name),
        message: `有 ${low.length}/${matches.length} 个部件相似度低于 ${LOW_SCORE}（平均 ${mean.toFixed(3)}），这几件建议人工核对：${low.map((item) => item.name).join("、")}`,
        suggestion: "在装配台上拖动核对，或对有疑问的那几件用 `setRigLayoutHints` 给区域框后单件重跑 `runRigLayout({names:[…]})`"
      });
    }
  }

  if (typeof options.expectedParts === "number" && options.expectedParts > 0 && partCount > options.expectedParts) {
    issues.push({
      level: "error",
      code: "too-many-parts",
      parts: [],
      message:
        `拆出 ${partCount} 个部件，但参考图里大致只能看到 ${options.expectedParts} 个独立部位——` +
        "多出来的部分多半是重复件，或者把同一个部位切成了几块。",
      suggestion: "对照 parts-montage.png 逐块确认，隐藏重复件；或在拆件提示词里把每个网格格子该画什么写清楚"
    });
  }

  const errors = issues.filter((issue) => issue.level === "error");
  // 分数：重复件与"部件数偏多"是硬伤，各自压掉一截；相似度按均值线性给分。
  let score = 1;
  score -= Math.min(0.5, duplicates.filter((group) => !group.symmetric).length * 0.2 + duplicates.filter((group) => group.symmetric).length * 0.05);
  if (errors.some((issue) => issue.code === "too-many-parts")) score -= 0.25;
  if (matches.length > 0) {
    const mean = matches.reduce((sum, item) => sum + (item.score as number), 0) / matches.length;
    score = Math.min(score, Math.max(0, (mean - GARBAGE_SCORE) / (1 - GARBAGE_SCORE)));
  }
  score = Number(Math.max(0, Math.min(1, score)).toFixed(2));

  const summary =
    errors.length === 0
      ? `拆件质检通过（可信度 ${Math.round(score * 100)}%）` +
        (issues.length > 0 ? `，另有 ${issues.length} 条提示` : "")
      : `拆件质检不通过（可信度 ${Math.round(score * 100)}%）：${errors.map((issue) => issue.code).join("、")}`;

  return { ok: errors.length === 0, score, issues, duplicates, checked: partCount, summary };
}
