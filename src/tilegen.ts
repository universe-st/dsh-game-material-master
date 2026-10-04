/**
 * 地图地块生成（模块五）· 数据层与流水线。
 *
 * 五个阶段：
 *   ① template  生成模板   本地 · 免费
 *   ② generate  生成地块   真实计费（每类 × 变体一次 Seedream 调用）
 *   ③ review    逐项验收   免费
 *   ④ map       拼成地图   本地 · 免费 · 可反复
 *   ⑤ export    导出       本地 · 免费
 *
 * ## 磁盘布局
 *
 * ```
 * $DSH_HOME/game-material-master/tile-jobs/<projectId>/
 *   project.json          唯一状态文件
 *   template/             洋红菱形模板 + 2×2 地基网格
 *   raw/                  原始生成结果（**保留**）
 *   cell/                 规整后的单元格地块
 *   decor/                独立装饰图层
 *   map/                  map.png + map.json
 *   export/               导出包
 * ```
 *
 * **为什么 raw/ 要保留**：规整参数（单元格尺寸等）改了以后可以零成本重跑规整，
 * 不必重新花钱生成。这是本模块最实用的一条降本设计。
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { generateImage, ArkError } from "./ark.js";
import { loadConfig, tileJobsRoot } from "./config.js";
import { messageOf, readJson, writeJsonAtomic, appendJobLog, type JobLogEntry } from "./jsonio.js";
import {
  DEFAULT_SETTINGS,
  assertSettings,
  decorAnchorY,
  diamondHeight,
  measureGroundDiamond,
  measurementLooksSane,
  regularizeDecorSprite,
  regularizeToCell,
  renderTemplate,
  upscale,
  type GroundMeasure,
  type TileGeomReport,
  type TileSettings
} from "./tilegeom.js";
import { assembleMap, emptyMapState, trimTransparent, type TileMapState } from "./tilemap.js";
import { decodeFile, encodeBitmap, sniffImageExt, type Bitmap } from "./tilemedia.js";

export type TileStage = "template" | "generate" | "review" | "map" | "export";
export const TILE_STAGES: TileStage[] = ["template", "generate", "review", "map", "export"];

export type TileItemKind = "terrain" | "decor" | "building";
/** 生成方式：模板填充 / 白底单图 / 2×2 地基网格。 */
export type TileItemMode = "template" | "plain" | "grid2x2";

/** 规整报告（界面用它算状态角标，回归测试用它做断言）。 */
export type TileGeomReportView = TileGeomReport & {
  /** 这一张是不是自动重跑过一次。 */
  retried?: boolean;
};

export interface TileVariant {
  index: number;
  /** 项目内的相对路径。 */
  raw?: string;
  cell?: string;
  report?: TileGeomReportView;
  approved?: boolean;
  error?: string;
}

export interface TileItem {
  key: string;
  label: string;
  kind: TileItemKind;
  /** 同类变体分组：铺图时按这个分组随机抽。 */
  family: string;
  /** 占格 [列, 行]。地形与装饰是 [1,1]，建筑是 [2,2]。 */
  footprint: [number, number];
  /** AI 只描述「菱形里面是什么」。不描述形状 / 角度 / 透视。 */
  content: string;
  mode: TileItemMode;
  variantCount: number;
  variants: TileVariant[];
  approved?: boolean;
}

export interface TileStageState {
  status: "idle" | "running" | "done" | "error";
  error?: string;
  at?: string;
}

export interface TileProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** 统一画风描述：追加到每个地块的内容描述之后。改它 = 改整套画风。 */
  style: string;
  settings: TileSettings;
  items: TileItem[];
  map: TileMapState;
  reviewMode?: "auto" | "manual";
  stages: Record<TileStage, TileStageState>;
  logs: JobLogEntry[];
}

// ── 默认地块清单 ──────────────────────────────────────────────────────────

/** 两类默认文案（中 / 英）。改一份必须改另一份（AGENTS.md 的硬约束）。 */
const STYLE_ZH = "像素画风的干净色块，色彩明快饱和，无噪点。";
const STYLE_EN = "Clean pixel-art color blocks, bright saturated colors, no noise.";

interface TileItemSeed {
  key: string;
  label: string;
  kind: TileItemKind;
  family: string;
  footprint: [number, number];
  content: string;
  mode: TileItemMode;
  variantCount: number;
}

const ITEMS_ZH: TileItemSeed[] = [
  { key: "grass", label: "草地", kind: "terrain", family: "grass", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "鲜绿色的短草地。均匀细密的草叶纹理，深浅绿色随机交错的斑块，整体明亮清新。" },
  { key: "grass2", label: "草地（野趣）", kind: "terrain", family: "grass", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "鲜绿色草地，草叶稍长、夹杂少量浅黄绿色的干草与零星小白花，自然野趣。" },
  { key: "dirt", label: "土地", kind: "terrain", family: "dirt", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "棕褐色的翻耕土地。细碎的土块与深浅不一的泥土颗粒，夹杂少量灰色小石子，温暖的土地色调。" },
  { key: "dirt2", label: "土地（湿润）", kind: "terrain", family: "dirt", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "棕褐色土地。颜色更深、更湿润，有明显的小土垄与几颗小石子。" },
  { key: "rock", label: "石块", kind: "terrain", family: "rock", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "灰白色的岩石地面。大小不一的灰色石块、碎石与浅色裂隙拼在一起，表面接近平坦只有很轻微的体积感，石块严格限制在菱形内部。" },
  { key: "rock2", label: "石块（巨石）", kind: "terrain", family: "rock", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "灰白色岩石地面。以一块较大的灰色巨石为主体，周围散落几块小碎石，石块严格限制在菱形内部。" },
  { key: "bush", label: "灌木", kind: "terrain", family: "bush", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "草地加灌木。地面是鲜绿色短草地；菱形中央偏后长着一丛圆润茂密的深绿色灌木，灌木高度约为菱形高度的二分之一，灌木底部落在菱形内部。" },
  { key: "bush2", label: "灌木（矮丛）", kind: "terrain", family: "bush", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "草地加灌木。地面是鲜绿色短草地；菱形右前方长着一丛矮胖圆润的深绿色灌木，灌木高度约为菱形高度的三分之一。" },
  { key: "bush3", label: "灌木（浆果）", kind: "terrain", family: "bush", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "草地加灌木。地面是鲜绿色短草地；菱形中央有一丛深绿色灌木，灌木上有少量浅绿色高光与几个红色小浆果。" },
  { key: "tree", label: "阔叶树", kind: "decor", family: "tree", footprint: [1, 1], variantCount: 2, mode: "plain",
    content: "一棵枝繁叶茂的阔叶树：棕色树干从底部直立向上，顶端是一整团圆润茂密的深绿色树冠，树冠比树干宽得多；能看到树冠的底面。" },
  { key: "tree2", label: "阔叶树（蓬松）", kind: "decor", family: "tree", footprint: [1, 1], variantCount: 1, mode: "plain",
    content: "一棵高大的阔叶树：粗短的棕色树干，顶部是蓬松的深绿色树冠，树冠由几团绿色圆球堆成，能看到树冠底面。" },
  { key: "tree3", label: "松树", kind: "decor", family: "tree", footprint: [1, 1], variantCount: 1, mode: "plain",
    content: "一棵松树：细直的棕色树干，上面是上尖下宽的深绿色圆锥形针叶树冠。" },
  { key: "boulder", label: "巨石", kind: "decor", family: "boulder", footprint: [1, 1], variantCount: 1, mode: "plain",
    content: "一块灰色的巨石，表面有棱角和轻微明暗，底部略平，落在画面中央。" },
  { key: "building", label: "中世纪石屋", kind: "building", family: "building", footprint: [2, 2], variantCount: 1, mode: "grid2x2",
    content: "一座中世纪风格的石头房屋：灰白色石墙、深蓝灰色石板尖顶屋顶、正面一扇木门和两扇小窗、墙角有深色木结构装饰。" }
];

const ITEMS_EN: TileItemSeed[] = [
  { key: "grass", label: "Grass", kind: "terrain", family: "grass", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "Bright green short grass. Even, fine grass-blade texture with randomly interleaved patches of light and dark green, fresh and bright overall." },
  { key: "grass2", label: "Grass (wild)", kind: "terrain", family: "grass", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "Bright green grass with slightly longer blades, a few pale yellow-green dry strands and scattered tiny white flowers." },
  { key: "dirt", label: "Dirt", kind: "terrain", family: "dirt", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "Brown tilled soil. Small clods and grains of earth in varying shades, with a few small grey pebbles; warm earthy tone." },
  { key: "dirt2", label: "Dirt (damp)", kind: "terrain", family: "dirt", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "Brown soil, darker and damper, with visible small ridges and a few pebbles." },
  { key: "rock", label: "Rock", kind: "terrain", family: "rock", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "Off-white rock ground. Grey stones and gravel of various sizes with pale cracks between them, nearly flat with only the slightest sense of volume; stones strictly inside the diamond." },
  { key: "rock2", label: "Rock (boulder)", kind: "terrain", family: "rock", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "Off-white rock ground dominated by one large grey boulder with a few small stones scattered around it; stones strictly inside the diamond." },
  { key: "bush", label: "Bush", kind: "terrain", family: "bush", footprint: [1, 1], variantCount: 2, mode: "template",
    content: "Grass with a bush. Ground is bright green short grass; a rounded dense dark-green bush grows slightly behind the centre of the diamond, about half the diamond's height, with its base inside the diamond." },
  { key: "bush2", label: "Bush (low)", kind: "terrain", family: "bush", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "Grass with a bush. Ground is bright green short grass; a squat rounded dark-green bush sits toward the front-right of the diamond, about a third of its height." },
  { key: "bush3", label: "Bush (berries)", kind: "terrain", family: "bush", footprint: [1, 1], variantCount: 1, mode: "template",
    content: "Grass with a bush. Ground is bright green short grass; a dark-green bush in the centre carries a few pale-green highlights and small red berries." },
  { key: "tree", label: "Broadleaf tree", kind: "decor", family: "tree", footprint: [1, 1], variantCount: 2, mode: "plain",
    content: "A leafy broadleaf tree: a brown trunk rising straight from the base, topped by one rounded dense dark-green crown much wider than the trunk; the underside of the crown is visible." },
  { key: "tree2", label: "Broadleaf tree (fluffy)", kind: "decor", family: "tree", footprint: [1, 1], variantCount: 1, mode: "plain",
    content: "A tall broadleaf tree: a short thick brown trunk with a fluffy dark-green crown built from several rounded clumps; the underside of the crown is visible." },
  { key: "tree3", label: "Pine", kind: "decor", family: "tree", footprint: [1, 1], variantCount: 1, mode: "plain",
    content: "A pine tree: a thin straight brown trunk with a dark-green conical crown, narrow at the top and wide at the bottom." },
  { key: "boulder", label: "Boulder", kind: "decor", family: "boulder", footprint: [1, 1], variantCount: 1, mode: "plain",
    content: "A large grey boulder with faceted surfaces and subtle shading, slightly flat at the bottom, resting in the centre of the frame." },
  { key: "building", label: "Medieval stone house", kind: "building", family: "building", footprint: [2, 2], variantCount: 1, mode: "grid2x2",
    content: "A medieval style stone house: off-white stone walls, a dark blue-grey slate pitched roof, a wooden door and two small windows on the front, dark timber framing at the corners." }
];

/** 按界面语言取默认画风描述。 */
export function defaultTileStyle(lang?: string): string {
  return lang === "en" ? STYLE_EN : STYLE_ZH;
}

/** 按界面语言取默认地块清单。 */
export function defaultTileItems(lang?: string): TileItem[] {
  const seeds = lang === "en" ? ITEMS_EN : ITEMS_ZH;
  return seeds.map((seed) => ({ ...seed, footprint: [...seed.footprint] as [number, number], variants: [] }));
}

// ── 磁盘路径 ──────────────────────────────────────────────────────────────

export function tileProjectDir(id: string): string {
  return join(tileJobsRoot(), id);
}

export function tileProjectFile(id: string): string {
  return join(tileProjectDir(id), "project.json");
}

/** 项目内的相对路径 → 绝对路径（挡住目录穿越）。 */
export function tileAssetPath(id: string, relative: string): string {
  const base = tileProjectDir(id);
  const target = join(base, relative);
  if (!target.startsWith(base)) throw new Error(`非法的项目内路径：${relative}`);
  return target;
}

export function isValidTileProjectId(id: string): boolean {
  return /^t[a-z0-9]{4,40}$/.test(id);
}

/** 模板与产物的子目录白名单（静态资源路由用）。 */
export const SERVABLE_TILE_DIRS = new Set(["template", "raw", "cell", "decor", "map", "export"]);

// ── 读 / 写 ───────────────────────────────────────────────────────────────

function freshStages(): Record<TileStage, TileStageState> {
  return {
    template: { status: "idle" },
    generate: { status: "idle" },
    review: { status: "idle" },
    map: { status: "idle" },
    export: { status: "idle" }
  };
}

export async function createTileProject(name: string, options: {
  style?: string; settings?: Partial<TileSettings>; lang?: string;
} = {}): Promise<TileProject> {
  const settings: TileSettings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
  assertSettings(settings);
  const id = `t${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const project: TileProject = {
    id,
    name: name.trim() === "" ? "未命名地图" : name.trim(),
    createdAt: now,
    updatedAt: now,
    style: options.style ?? defaultTileStyle(options.lang),
    settings,
    items: defaultTileItems(options.lang),
    map: emptyMapState(14, 14, ""),
    stages: freshStages(),
    logs: []
  };
  await mkdir(tileProjectDir(id), { recursive: true });
  for (const sub of ["template", "raw", "cell", "decor", "map", "export"]) {
    await mkdir(join(tileProjectDir(id), sub), { recursive: true });
  }
  appendJobLog(project.logs, "info", `新建地图地块项目：${project.name}`);
  await writeJsonAtomic(tileProjectFile(id), project);
  return project;
}

export async function readTileProject(id: string, lang?: string): Promise<TileProject | undefined> {
  const raw = await readJson<TileProject>(tileProjectFile(id));
  if (raw === undefined || typeof raw !== "object") return undefined;
  // 兼容性：老项目缺字段时补默认值，而不是让界面崩在 `undefined.x` 上
  const project: TileProject = {
    ...raw,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    items: Array.isArray(raw.items) ? raw.items : defaultTileItems(lang),
    map: raw.map ?? emptyMapState(14, 14, ""),
    stages: { ...freshStages(), ...(raw.stages ?? {}) },
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    style: typeof raw.style === "string" && raw.style !== "" ? raw.style : defaultTileStyle(lang)
  };
  return project;
}

export async function writeTileProject(project: TileProject): Promise<void> {
  project.updatedAt = new Date().toISOString();
  await writeJsonAtomic(tileProjectFile(project.id), project);
}

/** 读 → 改 → 写（与 store.ts 的 patchProject 同构）。 */
export async function patchTileProject<T>(id: string, mutator: (project: TileProject) => T): Promise<T> {
  const project = await readTileProject(id);
  if (project === undefined) throw new Error(`项目不存在：${id}`);
  const result = mutator(project);
  await writeTileProject(project);
  return result;
}

export async function deleteTileProject(id: string): Promise<void> {
  await rm(tileProjectDir(id), { recursive: true, force: true });
}

export interface TileProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  itemCount: number;
  generatedCount: number;
  expectedCount: number;
  approvedCount: number;
  mapReady: boolean;
}

export function summarizeTileProject(project: TileProject): TileProjectSummary {
  let generated = 0;
  let expected = 0;
  let approved = 0;
  for (const item of project.items) {
    expected += Math.max(1, item.variantCount);
    for (const variant of item.variants) {
      if (variant.cell !== undefined) generated++;
      if (variant.approved === true) approved++;
    }
  }
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    itemCount: project.items.length,
    generatedCount: generated,
    expectedCount: expected,
    approvedCount: approved,
    mapReady: project.map.png !== undefined
  };
}

export async function listTileProjects(): Promise<TileProjectSummary[]> {
  const dirents = await readdir(tileJobsRoot(), { withFileTypes: true }).catch(() => []);
  const out: TileProjectSummary[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const project = await readTileProject(dirent.name);
    if (project !== undefined) out.push(summarizeTileProject(project));
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

// ── 提示词 ────────────────────────────────────────────────────────────────

/**
 * 地形地块的固定前缀：**不许用户删，只能在其后追加**。
 *
 * 这套措辞是研究期反复调出来的，实测「模板填充」的菱形比例达标率 100%；
 * 换成自由生成的提示词会掉到 0%（见研究报告第三章）。
 */
export const TERRAIN_PREFIX = [
  "参考图里那个洋红色菱形就是地块的确切形状与位置。请只把菱形内部填成下面的内容。",
  "硬性要求：菱形的四个顶点、四条边、大小、位置必须与参考图完全一致；",
  "不要改变或描画轮廓，不要加边框、描边、外发光、阴影、厚度、侧面墙、立体底座，",
  "不要旋转、不要缩放、不要裁切、不要把菱形画成方块。",
  "菱形之外的区域必须保持完全透明，不要出现任何其他元素、文字、数字、标记、水印。",
  "输出正方形画布，画面里只有一个菱形。"
].join("\n");

/**
 * 独立装饰的前缀。
 *
 * 关键差异：**背景要「纯白色」而不是请求透明**。
 * `background:"transparent"` 在火山方舟上要求「必须带且只带一张输入图」，
 * 纯文生图传它会直接 400；而白底反而更好抠（边框众数色一定就是背景色）。
 */
export const DECOR_PREFIX =
  "画一个斜45度等轴测（isometric）视角的游戏装饰物贴图，正交投影，观察者从画面下方看。" +
  "正方形画布，装饰物居中，纯白色背景，画面里只有这一个东西：";

export const BUILDING_PREFIX = [
  "参考图里由洋红色外框圈出的等距菱形区域，是一栋大型建筑占用的 2x2 共 4 格地块。",
  "请在这个范围内画一栋建筑。"
].join("\n");

/** 组装一个地块的提示词。 */
export function buildTilePrompt(item: TileItem, style: string): string {
  const tail = style.trim() === "" ? "" : ` ${style.trim()}`;
  if (item.kind === "decor" || item.mode === "plain") {
    return `${DECOR_PREFIX}${item.content}${tail}`;
  }
  if (item.mode === "grid2x2" || item.kind === "building") {
    return [
      BUILDING_PREFIX,
      item.content,
      "视角是斜45度等轴测俯视（观察者从画面下方看），能看到屋顶的两个斜面和朝向观众的两面墙。",
      "建筑的底面必须与参考图里的菱形地面完全贴合，底面的四个角不要超出洋红色外框，也不要小于外框；",
      "建筑可以往画面上方长高，高度约为外框菱形高度的 1.4 倍。",
      "请把参考图里的洋红色外框与红色网格线完全去掉，不要保留任何参考线条。外框之外完全透明。",
      "像素画风，色彩明快饱和，干净色块，无文字、无数字、无边框、无阴影。"
    ].join("\n");
  }
  return `${TERRAIN_PREFIX}\n\n内容：${item.content}${tail}`;
}

// ── 作业 ──────────────────────────────────────────────────────────────────

export interface TileJob {
  projectId: string;
  kind: "template" | "generate" | "map" | "export";
  /** 本次作业覆盖的目标集合 —— 界面遮罩必须按它盖住**还没轮到**的项。 */
  targets: string[];
  done: string[];
  running: string | null;
  startedAt: number;
  error?: string;
}

const jobs = new Map<string, TileJob>();
const cancelled = new Set<string>();

export function currentTileJob(projectId: string): TileJob | undefined {
  return jobs.get(projectId);
}

export function cancelTileJob(projectId: string): void {
  cancelled.add(projectId);
}

/**
 * 有没有任务在跑。
 *
 * 判据是 `running !== null` —— 作业跑完之后记录**保留**（界面要用 `done` / `error`
 * 显示最终状态），所以不能按「表里有没有记录」来判断在跑。
 */
export function tileBusy(projectId: string): boolean {
  const job = jobs.get(projectId);
  return job !== undefined && job.running !== null;
}

// ── ① 模板（本地，免费）────────────────────────────────────────────────────

export async function runTemplateStage(projectId: string): Promise<{ started: boolean; reason?: string }> {
  if (tileBusy(projectId)) return { started: false, reason: "已有任务在跑" };
  const project = await readTileProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  assertSettings(project.settings);
  void background(projectId, "template", ["cell", "grid2x2"], async (job, report) => {
    const dir = tileProjectDir(projectId);
    await mkdir(join(dir, "template"), { recursive: true });
    // 单格模板
    const single = renderTemplate({ size: 2048, cols: 1, rows: 1 });
    await writeFile(join(dir, "template", "cell.png"), encodeBitmap(single.bitmap));
    job.done.push("cell");
    await report();
    // 2×2 地基网格（给大型建筑用）
    const grid = renderTemplate({ size: 2048, cols: 2, rows: 2, grid: true });
    await writeFile(join(dir, "template", "grid2x2.png"), encodeBitmap(grid.bitmap));
    job.done.push("grid2x2");
    await report();
  }, async () => {
    await patchTileProject(projectId, (fresh) => {
      // 模板几何变了，下游全部作废；② 要重新花钱
      invalidateFrom(fresh, "generate");
      appendJobLog(fresh.logs, "info", "已生成模板（本地计算，免费）。几何变化会让下游作废。");
    });
  });
  return { started: true };
}

// ── ② 生成（★计费）────────────────────────────────────────────────────────

export interface GenerateOptions {
  keys?: string[];
  /** 只重跑某一个变体。 */
  key?: string;
  variant?: number;
  /** 已自动重跑过一次（防递归）。 */
  retried?: boolean;
}

export async function runGenerateStage(projectId: string, options: GenerateOptions = {}): Promise<{ started: boolean; reason?: string }> {
  if (tileBusy(projectId)) return { started: false, reason: "已有任务在跑" };
  const project = await readTileProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  const config = await loadConfig();
  if (config.arkApiKey.trim() === "") throw new Error("尚未配置火山方舟 API Key（设置 → 游戏素材大师）");

  const selected = options.key !== undefined
    ? project.items.filter((item) => item.key === options.key)
    : options.keys !== undefined && options.keys.length > 0
      ? project.items.filter((item) => options.keys!.includes(item.key))
      : project.items;
  if (selected.length === 0) throw new Error("没有匹配的地块条目");

  const targets: string[] = [];
  for (const item of selected) {
    if (options.key !== undefined && options.variant !== undefined) {
      targets.push(`${item.key}#v${options.variant + 1}`);
    } else {
      const count = Math.max(1, item.variantCount);
      for (let i = 0; i < count; i++) targets.push(`${item.key}#v${i + 1}`);
    }
  }

  void background(projectId, "generate", targets, async (job, report) => {
    const dir = tileProjectDir(projectId);
    await mkdir(join(dir, "raw"), { recursive: true });
    await mkdir(join(dir, "cell"), { recursive: true });
    await mkdir(join(dir, "decor"), { recursive: true });
    const templateCell = join(dir, "template", "cell.png");
    const templateGrid = join(dir, "template", "grid2x2.png");

    for (const target of targets) {
      if (cancelled.has(projectId)) break;
      const [key, variantTag] = target.split("#");
      const variantIndex = Number.parseInt(variantTag.replace("v", ""), 10) - 1;
      const item = project.items.find((entry) => entry.key === key);
      if (item === undefined) continue;
      job.running = target;
      await report();
      try {
        const outcome = await generateOne(project, item, variantIndex, {
          templateCell, templateGrid, dir,
          retried: options.retried === true
        });
        await patchTileProject(projectId, (fresh) => {
          const freshItem = fresh.items.find((entry) => entry.key === key);
          if (freshItem === undefined) return;
          freshItem.variants[variantIndex] = outcome;
          freshItem.approved = undefined;
          appendJobLog(fresh.logs, outcome.error === undefined ? "info" : "error",
            outcome.error === undefined
              ? `生成 ${item.label} 第 ${variantIndex + 1} 张`
              : `${item.label} 第 ${variantIndex + 1} 张失败：${outcome.error}`);
        });
      } catch (error) {
        const message = messageOf(error);
        await patchTileProject(projectId, (fresh) => {
          const freshItem = fresh.items.find((entry) => entry.key === key);
          if (freshItem !== undefined) {
            freshItem.variants[variantIndex] = { index: variantIndex, error: message };
          }
          appendJobLog(fresh.logs, "error", `${item.label} 第 ${variantIndex + 1} 张失败：${message}`);
        });
      }
      job.done.push(target);
      await report();
    }
    job.running = null;
  }, async () => {
    await patchTileProject(projectId, (fresh) => {
      const allDone = fresh.items.every((item) =>
        item.variants.length >= item.variantCount && item.variants.every((v) => v.cell !== undefined));
      fresh.stages.generate = { status: allDone ? "done" : "idle", at: new Date().toISOString() };
      fresh.stages.review = { status: "idle" };
      invalidateFrom(fresh, "map");
    });
  });
  return { started: true };
}

/**
 * 生成一个变体：调 Ark → 规整 → 写盘。
 *
 * 规整失败（测量不可信）时回退到模板几何，并在报告里标注原因 ——
 * 界面据此提示「请目视确认」，而不是静默给一个错的几何。
 */
async function generateOne(
  project: TileProject,
  item: TileItem,
  variantIndex: number,
  ctx: { templateCell: string; templateGrid: string; dir: string; retried: boolean }
): Promise<TileVariant> {
  const config = await loadConfig();
  const images: string[] = [];
  if (item.mode === "template") images.push(await dataUri(ctx.templateCell));
  if (item.mode === "grid2x2") images.push(await dataUri(ctx.templateGrid));

  const prompt = buildTilePrompt(item, project.style);
  const result = await generateImage({
    baseUrl: config.arkBaseUrl,
    apiKey: config.arkApiKey,
    model: config.arkModel,
    prompt,
    images,
    size: config.arkSize,
    watermark: config.arkWatermark,
    timeoutMs: config.arkTimeoutMs
  });

  const ext = sniffImageExt(result.bytes);
  // ⚠️ 存进 project.json 的相对路径一律用 `/`，**不能用 `join()`**。
  // `join` 在 Windows 上给的是 `cell\grass.v1.png`，而这个字符串会被直接拼进
  // 资源路由的 URL（`${assetBase}${relative}`）—— 浏览器把反斜杠宽容地当分隔符，
  // 所以本地看着正常，但在 POSIX 上文件名/URL 都对不上。
  // 写盘用绝对路径（join(dir, …)）不受影响。
  const rawRelative = `raw/${item.key}.v${variantIndex + 1}.${ext}`;
  await writeFile(tileAssetPath(project.id, rawRelative), result.bytes);

  const decoded = await decodeFile(tileAssetPath(project.id, rawRelative));
  const variant: TileVariant = { index: variantIndex, raw: rawRelative };

  if (item.kind === "decor" || item.mode === "plain") {
    const { bitmap, report } = regularizeDecorSprite(decoded, project.settings);
    const cellRelative = `decor/${item.key}.v${variantIndex + 1}.png`;
    await writeFile(tileAssetPath(project.id, cellRelative), encodeBitmap(bitmap));
    variant.cell = cellRelative;
    variant.report = { mode: "sprite", scale: [report.scale, report.scale], retried: ctx.retried };
    return variant;
  }

  // 地形 / 建筑：测量 → 规整（不可信就回退模板几何）
  const templateFile = item.mode === "grid2x2" ? ctx.templateGrid : ctx.templateCell;
  const templateGeom = await templateGeometry(templateFile);
  let measure: GroundMeasure | undefined;
  let fallback: string | undefined;
  /** 实测比例（即便不可信也记下来）—— 用来诊断「是不是模型把菱形画歪了」。 */
  let measuredRatio: number | undefined;
  try {
    const candidate = measureGroundDiamond(decoded);
    measuredRatio = candidate.ratio;
    const reason = measurementLooksSane(decoded, candidate);
    if (reason === undefined) measure = candidate;
    else fallback = reason;
  } catch (error) {
    fallback = messageOf(error);
  }

  const { bitmap, report } = measure !== undefined
    ? regularizeToCell(decoded, project.settings, measure, "measured")
    : regularizeToCell(decoded, project.settings, templateGeom, "template", fallback);

  // 模型把菱形画变形时，给一条**可操作**的提示，而不是只丢一句测量失败。
  // 实测 `doubao-seedream-4-0-*` 会把 2:1 菱形画成近正方形（比例 ≈ 1.06），
  // 而且只输出 JPEG；换 5.0 系列立刻恢复（≈ 1.99）。这是这个模块最常踩的坑。
  const offRatio = measuredRatio !== undefined && Math.abs(measuredRatio - 2) > 0.1;
  const hint = fallback === undefined ? undefined
    : offRatio
      ? `模型没有画出 2:1 的等距菱形（实测 ${measuredRatio!.toFixed(3)}），已按模板几何回退。请换用 Seedream 5.0 系列模型（4.0 会把菱形画成近正方形），或在「设置 → 游戏素材大师」里改模型后重跑这一张。`
      : fallback;

  const cellRelative = `cell/${item.key}.v${variantIndex + 1}.png`;
  await writeFile(tileAssetPath(project.id, cellRelative), encodeBitmap(bitmap));
  variant.cell = cellRelative;
  variant.report = { ...report, ratioMeasured: report.ratioMeasured ?? measuredRatio, fallbackReason: hint, retried: ctx.retried };
  return variant;
}

/** 从模板图里量出菱形几何（**不硬编码尺寸**）。 */
async function templateGeometry(file: string): Promise<{ centerX: number; centerY: number; halfWidth: number; halfHeight: number }> {
  const bitmap = await decodeFile(file);
  // 模板是不透明的洋红菱形 + 透明背景 → 前景就是菱形本身
  let left = bitmap.width;
  let top = bitmap.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.rgba[(y * bitmap.width + x) * 4 + 3] < 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error(`模板 ${basename(file)} 里没有找到菱形`);
  return {
    centerX: (left + right + 1) / 2,
    centerY: (top + bottom + 1) / 2,
    halfWidth: (right - left + 1) / 2,
    halfHeight: (bottom - top + 1) / 2
  };
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(file);
  const ext = sniffImageExt(bytes);
  const mime = ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

// ── ④ 拼图（本地，免费）──────────────────────────────────────────────────

export interface MapOptions {
  rows?: number;
  cols?: number;
  seed?: number;
  fill?: string;
  /** 装饰密度 0~1（按比例随机撒装饰）。 */
  decorDensity?: number;
  background?: [number, number, number, number];
}

export async function runMapStage(projectId: string, options: MapOptions = {}): Promise<{ started: boolean; reason?: string }> {
  if (tileBusy(projectId)) return { started: false, reason: "已有任务在跑" };
  const project = await readTileProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);

  const lookup = new Map<string, Bitmap>();
  const families: Record<string, string[]> = {};
  for (const item of project.items) {
    const candidates: string[] = [];
    for (const variant of item.variants) {
      if (variant.cell === undefined) continue;
      const bitmap = await decodeFile(tileAssetPath(projectId, variant.cell));
      lookup.set(`${item.key}#${variant.index}`, bitmap);
      candidates.push(`${item.key}#${variant.index}`);
    }
    if (candidates.length > 0) families[item.family] = [...(families[item.family] ?? []), ...candidates];
  }
  if (lookup.size === 0) throw new Error("还没有已通过的地块，请先在第 ③ 步生成并验收");

  const rows = clampInt(options.rows ?? project.map.rows, project.map.rows, 1, 64);
  const cols = clampInt(options.cols ?? project.map.cols, project.map.cols, 1, 64);
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed as number) : project.map.seed;
  const fill = options.fill ?? "grass";

  // 要先定下「到底铺哪张图」，才能校验它引用的类别 —— 校验的是**即将组装的那份**状态，
  // 而不是 project.json 里存的那份（两者在「传了 fill/rows 覆盖参数」时并不相同）。
  const state: TileMapState = options.rows !== undefined || options.cols !== undefined ||
      options.seed !== undefined || options.fill !== undefined
    ? emptyMapState(rows, cols, fill, seed)
    : { ...project.map, rows, cols, seed };

  // 预校验：地图里引用的类别必须真的有已生成的变体。
  // 不校验的话会静默产出一张**缺了那些格子**的图，用户只看到「怎么空了」。
  const missing = new Set<string>();
  for (const row of state.cells) {
    for (const key of row) {
      if (key === "" || key === undefined) continue;
      if ((families[key] ?? []).length === 0) missing.add(key);
    }
  }
  if (missing.size > 0) {
    throw new Error(`这些类别还没有已生成的地块：${[...missing].join("、")}。请先在第 ③ 步生成并验收，或把它换成已有的类别。`);
  }

  void background(projectId, "map", ["map"], async (job, report) => {
    const dir = tileProjectDir(projectId);
    await mkdir(join(dir, "map"), { recursive: true });

    // 先算出每格用哪个变体（写进 map.json，供界面与导出复用）
    const decorated = decorateState(state, families, options.decorDensity ?? 0);
    job.running = "map";
    await report();

    const assembled = assembleMap(lookup, decorated, {
      settings: project.settings,
      families,
      background: options.background ?? [0, 0, 0, 0]
    });
    const trimmed = trimTransparent(assembled);
    // 交付尺寸放大 2 倍（最近邻，保持像素画硬边）
    const big = upscale(trimmed, 2);
    await writeFile(join(dir, "map", "map.png"), encodeBitmap(big));
    await writeFile(join(dir, "map", "map.json"), JSON.stringify({
      rows: decorated.rows,
      cols: decorated.cols,
      seed: decorated.seed,
      cells: decorated.cells,
      decor: decorated.decor,
      buildings: decorated.buildings,
      settings: project.settings,
      families
    }, null, 2));

    job.done.push("map");
    job.running = null;
    await report();
    await patchTileProject(projectId, (fresh) => {
      fresh.map = { ...decorated, png: "map/map.png", json: "map/map.json" };
      fresh.stages.map = { status: "done", at: new Date().toISOString() };
      invalidateFrom(fresh, "export");
      appendJobLog(fresh.logs, "info", `已拼图：${decorated.cols}×${decorated.rows}（本地计算，免费）`);
    });
  });
  return { started: true };
}

/** 按装饰密度随机撒装饰、放置建筑 —— 用确定性 PRNG，保证同种子可复现。 */
function decorateState(state: TileMapState, families: Record<string, string[]>, density: number): TileMapState {
  const out: TileMapState = {
    ...state,
    cells: state.cells.map((row) => [...row]),
    decor: { ...state.decor },
    buildings: [...state.buildings]
  };
  if (density <= 0) return out;
  const decorKeys = Object.keys(families).filter((key) => key === "tree" || key === "boulder");
  if (decorKeys.length === 0) return out;
  // mulberry32 的种子：只用 state.seed，保证「同种子 + 同布局 = 逐像素一致」
  let a = (state.seed ^ 0x9e3779b9) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let r = 0; r < out.rows; r++) {
    for (let c = 0; c < out.cols; c++) {
      if (rand() > density) continue;
      const family = decorKeys[Math.floor(rand() * decorKeys.length)];
      const candidates = families[family] ?? [];
      if (candidates.length === 0) continue;
      out.decor[`${r},${c}`] = candidates[Math.floor(rand() * candidates.length)];
    }
  }
  return out;
}

// ── ⑤ 导出（本地，免费）──────────────────────────────────────────────────

export async function runExportStage(projectId: string): Promise<{ started: boolean; reason?: string }> {
  if (tileBusy(projectId)) return { started: false, reason: "已有任务在跑" };
  const project = await readTileProject(projectId);
  if (project === undefined) throw new Error(`项目不存在：${projectId}`);
  if (project.map.png === undefined) throw new Error("还没拼图，请先在第 ④ 步拼一张地图");

  void background(projectId, "export", ["tiles"], async (job, report) => {
    const dir = tileProjectDir(projectId);
    await mkdir(join(dir, "export", "tiles"), { recursive: true });
    for (const item of project.items) {
      for (const variant of item.variants) {
        if (variant.cell === undefined) continue;
        const bytes = await readFile(tileAssetPath(projectId, variant.cell));
        await writeFile(join(dir, "export", "tiles", `${item.key}.v${variant.index + 1}.png`), bytes);
      }
    }
    const mapBytes = await readFile(tileAssetPath(projectId, project.map.png));
    await writeFile(join(dir, "export", "map.png"), mapBytes);
    if (project.map.json !== undefined) {
      const jsonBytes = await readFile(tileAssetPath(projectId, project.map.json));
      await writeFile(join(dir, "export", "map.json"), jsonBytes);
    }
    job.done.push("tiles");
    job.running = null;
    await report();
    await patchTileProject(projectId, (fresh) => {
      fresh.stages.export = { status: "done", at: new Date().toISOString() };
      appendJobLog(fresh.logs, "info", "已导出地块包与地图（本地计算，免费）");
    });
  });
  return { started: true };
}

// ── 阶段失效传播 ──────────────────────────────────────────────────────────

/**
 * 从某个阶段开始把下游全部作废（含它自己）。
 *
 * 注意 `generate` 一旦作废，重新跑要**真实计费** —— 所以「改画风」「改内容描述」
 * 「重新生成模板」都会走到这里，界面上必须二次确认。
 */
export function invalidateFrom(project: TileProject, from: TileStage): void {
  const order = TILE_STAGES;
  const start = order.indexOf(from);
  if (start < 0) return;
  for (let i = start; i < order.length; i++) {
    const stage = order[i];
    project.stages[stage] = { status: "idle" };
    if (stage === "generate") {
      for (const item of project.items) {
        item.variants = [];
        item.approved = undefined;
      }
    }
    if (stage === "map") {
      project.map = { ...project.map, png: undefined, json: undefined };
    }
  }
}

// ── 作业执行器 ────────────────────────────────────────────────────────────

/**
 * 跑一个后台作业。
 *
 * `targets` 是硬要求：界面遮罩按它盖住**还没轮到**的项。不盖遮罩时界面看着
 * 完全正常，只是「点了没反应」，用户会反复点 —— 而每次点击都真实计费。
 */
async function background(
  projectId: string,
  kind: TileJob["kind"],
  targets: string[],
  run: (job: TileJob, report: () => Promise<void>) => Promise<void>,
  after?: () => Promise<void>
): Promise<void> {
  const job: TileJob = {
    projectId,
    kind,
    targets,
    done: [],
    running: targets[0] ?? null,
    startedAt: Date.now()
  };
  jobs.set(projectId, job);
  cancelled.delete(projectId);
  const report = async () => {
    await patchTileProject(projectId, (fresh) => {
      fresh.stages[kind === "generate" ? "generate" : kind] = {
        status: "running",
        at: new Date().toISOString()
      };
    }).catch(() => undefined);
  };
  try {
    await run(job, report);
    job.running = null;
    if (after !== undefined) await after();
    await patchTileProject(projectId, (fresh) => {
      if (fresh.stages[kind].status === "running") {
        fresh.stages[kind] = { status: "done", at: new Date().toISOString() };
      }
    });
  } catch (error) {
    job.error = messageOf(error);
    job.running = null;
    await patchTileProject(projectId, (fresh) => {
      fresh.stages[kind] = { status: "error", error: job.error, at: new Date().toISOString() };
      appendJobLog(fresh.logs, "error", `${kind} 阶段失败：${job.error}`);
    }).catch(() => undefined);
  } finally {
    cancelled.delete(projectId);
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ── 供界面 / 工具用的视图 ─────────────────────────────────────────────────

export interface TileProjectView extends TileProject {
  job: TileJob | undefined;
  /**
   * 产物 URL 的基址（以 `/` 结尾，界面拼 `${assetBase}${relative}?v=…`）。
   *
   * - 给**界面**用时是相对路径（`/dsh-game-material-master/…`），浏览器自己知道 origin；
   * - 给**对话工具**用时是绝对 URL（见 `tileSnapshot`），因为模型要直接贴给用户点。
   */
  assetBase: string;
  /** 进度汇总。界面头部显示「已生成 n / m，已验收 k」。 */
  progress: { generated: number; expected: number; approved: number };
}

export function tileView(project: TileProject): TileProjectView {
  // ⚠️ `progress` 与 `map.png` 都是**宿主算给界面看的派生字段**，必须在这里显式给出。
  // 踩过两次：
  //   · 界面读 `project.progress` → undefined，头部永远显示「已生成 0 / 0」
  //   · 界面读 `project.map.ready` → 宿主从来没算过这个字段（只有 `png`），
  //     于是**拼好的地图永远不显示**，界面一直停在「还没有拼图」
  // 客户端读的键必须在这里算出来；verify-tile-client.mjs 现在会断言这一点。
  return {
    ...project,
    job: jobs.get(project.id),
    assetBase: `/dsh-game-material-master/tile-assets/${project.id}/`,
    progress: tileProgress(project)
  };
}

/** 生成 / 期望 / 已验收三件套（界面与工具共用一份算法）。 */
export function tileProgress(project: TileProject): { generated: number; expected: number; approved: number } {
  let generated = 0;
  let expected = 0;
  let approved = 0;
  for (const item of project.items) {
    expected += Math.max(1, item.variantCount);
    for (const variant of item.variants) {
      if (variant.cell !== undefined) generated++;
      if (variant.approved === true) approved++;
    }
  }
  return { generated, expected, approved };
}

/** 装饰锚点（界面显示用）。 */
export function tileAnchorY(project: TileProject): number {
  return decorAnchorY(project.settings);
}

/**
 * 给**对话工具**用的快照：产物一律是绝对 URL（会直接贴给用户点）。
 *
 * 与 `tileView` 的区别：`tileView` 给界面用相对路径（界面自己拼 origin），
 * 这里给模型用绝对 URL。两者都只带「判断所需的最小字段」，不是整个 project.json。
 */
export function tileSnapshot(project: TileProject, origin: string) {
  const assetBase = `${origin}/dsh-game-material-master/tile-assets/${project.id}/`;
  const url = (relative: string | undefined): string | undefined =>
    typeof relative === "string" && relative !== "" ? `${assetBase}${relative}` : undefined;
  const items = project.items.map((item) => ({
    key: item.key,
    label: item.label,
    kind: item.kind,
    approved: item.approved === true,
    expected: Math.max(1, item.variantCount),
    variants: item.variants.map((variant) => ({
      index: variant.index,
      file: variant.cell,
      url: url(variant.cell),
      approved: variant.approved === true,
      /** 实测菱形比例（理想 2.0）；1.98~2.02 视为正常。 */
      ratio: variant.report?.ratioMeasured,
      /** 规整方式：measured = 量测成功；template = 测量失败退回模板几何。 */
      geomMode: variant.report?.mode,
      fallbackReason: variant.report?.fallbackReason,
      error: variant.error
    }))
  }));
  const total = items.reduce((sum, item) => sum + item.variants.filter((v) => v.file !== undefined).length, 0);
  const expected = items.reduce((sum, item) => sum + item.expected, 0);
  const approved = items.reduce((sum, item) => sum + item.variants.filter((v) => v.approved).length, 0);
  return {
    id: project.id,
    name: project.name,
    /** 界面 / 模型拼产物 URL 用。工具侧产物已经是绝对 URL，这里给基址留一份兜底。 */
    assetBase,
    style: project.style,
    settings: project.settings,
    reviewMode: project.reviewMode,
    stages: project.stages,
    job: jobs.get(project.id),
    progress: { generated: total, expected, approved },
    items,
    map: {
      rows: project.map.rows,
      cols: project.map.cols,
      seed: project.map.seed,
      ready: project.map.png !== undefined,
      file: project.map.png,
      url: url(project.map.png),
      json: project.map.json,
      buildings: project.map.buildings.length,
      decor: Object.keys(project.map.decor).length
    },
    logs: project.logs.slice(-20)
  };
}

/** 菱形高（界面显示用）。 */
export function tileDiamondHeight(project: TileProject): number {
  return diamondHeight(project.settings);
}

export { ArkError };
