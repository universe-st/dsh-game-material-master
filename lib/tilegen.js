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
import { messageOf, readJson, writeJsonAtomic, appendJobLog, sweepTempFiles } from "./jsonio.js";
import { DEFAULT_SETTINGS, assertSettings, decorAnchorY, diamondHeight, measureGroundDiamond, measurementLooksSane, regularizeBuilding, regularizeDecorSprite, regularizeToCell, renderBuildingTemplate, renderTemplate, upscale } from "./tilegeom.js";
import { assembleMap, emptyMapState, pickVariantIndex, trimTransparent } from "./tilemap.js";
import { decodeFile, encodeBitmap, sniffImageExt } from "./tilemedia.js";
export const TILE_STAGES = ["template", "generate", "review", "map", "export"];
// ── 默认地块清单 ──────────────────────────────────────────────────────────
/** 两类默认文案（中 / 英）。改一份必须改另一份（AGENTS.md 的硬约束）。 */
const STYLE_ZH = "像素画风的干净色块，色彩明快饱和，无噪点。";
const STYLE_EN = "Clean pixel-art color blocks, bright saturated colors, no noise.";
const ITEMS_ZH = [
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
const ITEMS_EN = [
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
export function defaultTileStyle(lang) {
    return lang === "en" ? STYLE_EN : STYLE_ZH;
}
/** 按界面语言取默认地块清单。 */
export function defaultTileItems(lang) {
    const seeds = lang === "en" ? ITEMS_EN : ITEMS_ZH;
    return seeds.map((seed) => ({ ...seed, footprint: [...seed.footprint], variants: [] }));
}
// ── 磁盘路径 ──────────────────────────────────────────────────────────────
export function tileProjectDir(id) {
    return join(tileJobsRoot(), id);
}
export function tileProjectFile(id) {
    return join(tileProjectDir(id), "project.json");
}
/** 项目内的相对路径 → 绝对路径（挡住目录穿越）。 */
export function tileAssetPath(id, relative) {
    const base = tileProjectDir(id);
    const target = join(base, relative);
    if (!target.startsWith(base))
        throw new Error(`非法的项目内路径：${relative}`);
    return target;
}
export function isValidTileProjectId(id) {
    return /^t[a-z0-9]{4,40}$/.test(id);
}
/** 模板与产物的子目录白名单（静态资源路由用）。 */
export const SERVABLE_TILE_DIRS = new Set(["template", "raw", "cell", "decor", "map", "export"]);
// ── 读 / 写 ───────────────────────────────────────────────────────────────
function freshStages() {
    return {
        template: { status: "idle" },
        generate: { status: "idle" },
        review: { status: "idle" },
        map: { status: "idle" },
        export: { status: "idle" }
    };
}
export async function createTileProject(name, options = {}) {
    const settings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
    assertSettings(settings);
    const id = `t${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = {
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
export async function readTileProject(id, lang) {
    const raw = await readJson(tileProjectFile(id));
    if (raw === undefined || typeof raw !== "object")
        return undefined;
    // 顺手清掉写失败留下的 `project.json.<uuid>.tmp`（进程被杀时来不及自己删）。
    // 不 await：它是清理工作，不该拖慢读项目。
    void sweepTempFiles(tileProjectDir(id));
    // 兼容性：老项目缺字段时补默认值，而不是让界面崩在 `undefined.x` 上
    const project = {
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
export async function writeTileProject(project) {
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(tileProjectFile(project.id), project);
}
/**
 * 每个项目一条写队列。
 *
 * ⚠️ 少了它，「读 → 改 → 写」会互相踩：后台作业的 `report()` 每次写一次
 * project.json，用户这时点「保存布局」也在写同一个文件，两个 rename 撞在一起
 * 就报 `EPERM`（Windows），而且**用户那边表现为「保存总是失败」**。
 * 更糟的是丢更新：A 读、B 读、A 写、B 写 —— A 的改动被 B 覆盖掉。
 *
 * 用 promise 链把同一个项目的写入串起来：后来的等前面的写完再读。
 * 不同项目互不影响（各排各的队）。
 */
const projectWriteQueue = new Map();
function enqueueProjectWrite(id, task) {
    const previous = projectWriteQueue.get(id) ?? Promise.resolve();
    // 前一个失败也要继续（用 catch 把错误吞在链上，真正结果由本次的 promise 给出）
    const next = previous.catch(() => undefined).then(task);
    projectWriteQueue.set(id, next.catch(() => undefined));
    return next;
}
/** 读 → 改 → 写。同一个项目的多次调用会被串行化（见 enqueueProjectWrite）。 */
export async function patchTileProject(id, mutator) {
    return enqueueProjectWrite(id, async () => {
        const project = await readTileProject(id);
        if (project === undefined)
            throw new Error(`项目不存在：${id}`);
        const result = mutator(project);
        await writeTileProject(project);
        return result;
    });
}
export async function deleteTileProject(id) {
    await rm(tileProjectDir(id), { recursive: true, force: true });
}
export function summarizeTileProject(project) {
    let generated = 0;
    let expected = 0;
    let approved = 0;
    for (const item of project.items) {
        expected += Math.max(1, item.variantCount);
        for (const variant of item.variants) {
            if (variant.cell !== undefined)
                generated++;
            if (variant.approved === true)
                approved++;
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
export async function listTileProjects() {
    const dirents = await readdir(tileJobsRoot(), { withFileTypes: true }).catch(() => []);
    const out = [];
    for (const dirent of dirents) {
        if (!dirent.isDirectory())
            continue;
        const project = await readTileProject(dirent.name);
        if (project !== undefined)
            out.push(summarizeTileProject(project));
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
export const DECOR_PREFIX = "画一个斜45度等轴测（isometric）视角的游戏装饰物贴图，正交投影，观察者从画面下方看。" +
    "正方形画布，装饰物居中，纯白色背景，画面里只有这一个东西：";
export const BUILDING_PREFIX = [
    "参考图是一张斜45度等轴测（isometric）的建筑施工参考图。",
    "图中：浅灰色的菱形是建筑的**地基**，洋红色线是地基的边界，",
    "蓝色的线框是从地基四个角**垂直向上**拉出来的立方体，表示这栋建筑可以占据的空间。",
    "请画一栋**立体的建筑**：",
    "· 底面（建筑与地面的接触面）必须与浅灰色菱形地基完全重合，四个角对准洋红线，不要超出也不要缩小；",
    "· 墙体从底面**垂直向上**立起来，屋顶盖在最上面，整体高度填满蓝色立方体线框（约为地基菱形高度的 1.5 倍）；",
    "· 能看见屋顶的两个斜面和朝向观众的两面墙 —— 这是等轴测视角，不是俯视图；",
    "· 绝对不要把地基菱形涂成一块平铺的地面或地砖 —— 建筑要**有高度、有墙、有屋顶**。"
].join("\n");
/** 组装一个地块的提示词。 */
export function buildTilePrompt(item, style) {
    const tail = style.trim() === "" ? "" : ` ${style.trim()}`;
    if (item.kind === "decor" || item.mode === "plain") {
        return `${DECOR_PREFIX}${item.content}${tail}`;
    }
    if (item.mode === "grid2x2" || item.kind === "building") {
        return [
            BUILDING_PREFIX,
            item.content,
            "再次强调：底面 = 浅灰菱形地基，建筑往上长高，不要把它画成平铺的地面。",
            "请把参考图里的洋红线、蓝线、浅灰地基**全部覆盖掉**，成品里不要保留任何参考线条。",
            "线框之外的区域完全透明。",
            "像素画风，色彩明快饱和，干净色块，无文字、无数字、无边框、无投影。"
        ].join("\n");
    }
    return `${TERRAIN_PREFIX}\n\n内容：${item.content}${tail}`;
}
const jobs = new Map();
const cancelled = new Set();
export function currentTileJob(projectId) {
    return jobs.get(projectId);
}
export function cancelTileJob(projectId) {
    cancelled.add(projectId);
}
/**
 * 有没有任务在跑。
 *
 * 判据是 `running !== null` —— 作业跑完之后记录**保留**（界面要用 `done` / `error`
 * 显示最终状态），所以不能按「表里有没有记录」来判断在跑。
 */
export function tileBusy(projectId) {
    const job = jobs.get(projectId);
    return job !== undefined && job.running !== null;
}
// ── ① 模板（本地，免费）────────────────────────────────────────────────────
export async function runTemplateStage(projectId) {
    if (tileBusy(projectId))
        return { started: false, reason: "已有任务在跑" };
    const project = await readTileProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    assertSettings(project.settings);
    void background(projectId, "template", ["cell", "grid2x2"], async (job, report) => {
        const dir = tileProjectDir(projectId);
        await mkdir(join(dir, "template"), { recursive: true });
        // 单格模板
        const single = renderTemplate({ size: 2048, cols: 1, rows: 1 });
        await writeFile(join(dir, "template", "cell.png"), encodeBitmap(single.bitmap));
        job.done.push("cell");
        await report();
        // 2×2 建筑模板：洋红**轮廓**画底面 + 蓝色线框画「能长多高」。
        // 不能用那份实心洋红菱形 —— 模型会把它当「把这块地填满」，
        // 实测生成出来是一张平铺的菱形石板地面（没有墙和屋顶）。
        const grid = renderBuildingTemplate({ settings: project.settings, size: 2048 });
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
export async function runGenerateStage(projectId, options = {}) {
    if (tileBusy(projectId))
        return { started: false, reason: "已有任务在跑" };
    const project = await readTileProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const config = await loadConfig();
    if (config.arkApiKey.trim() === "")
        throw new Error("尚未配置火山方舟 API Key（设置 → 游戏素材大师）");
    const selected = options.key !== undefined
        ? project.items.filter((item) => item.key === options.key)
        : options.keys !== undefined && options.keys.length > 0
            ? project.items.filter((item) => options.keys.includes(item.key))
            : project.items;
    if (selected.length === 0)
        throw new Error("没有匹配的地块条目");
    const targets = [];
    for (const item of selected) {
        if (options.key !== undefined && options.variant !== undefined) {
            targets.push(`${item.key}#v${options.variant + 1}`);
        }
        else {
            const count = Math.max(1, item.variantCount);
            for (let i = 0; i < count; i++)
                targets.push(`${item.key}#v${i + 1}`);
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
            if (cancelled.has(projectId))
                break;
            const [key, variantTag] = target.split("#");
            const variantIndex = Number.parseInt(variantTag.replace("v", ""), 10) - 1;
            const item = project.items.find((entry) => entry.key === key);
            if (item === undefined)
                continue;
            job.running = target;
            await report();
            try {
                const outcome = await generateOne(project, item, variantIndex, {
                    templateCell, templateGrid, dir,
                    retried: options.retried === true
                });
                await patchTileProject(projectId, (fresh) => {
                    const freshItem = fresh.items.find((entry) => entry.key === key);
                    if (freshItem === undefined)
                        return;
                    freshItem.variants[variantIndex] = outcome;
                    freshItem.approved = undefined;
                    appendJobLog(fresh.logs, outcome.error === undefined ? "info" : "error", outcome.error === undefined
                        ? `生成 ${item.label} 第 ${variantIndex + 1} 张`
                        : `${item.label} 第 ${variantIndex + 1} 张失败：${outcome.error}`);
                });
            }
            catch (error) {
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
            const allDone = fresh.items.every((item) => item.variants.length >= item.variantCount && item.variants.every((v) => v.cell !== undefined));
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
async function generateOne(project, item, variantIndex, ctx) {
    const config = await loadConfig();
    const images = [];
    if (item.mode === "template")
        images.push(await dataUri(ctx.templateCell));
    if (item.mode === "grid2x2")
        images.push(await dataUri(ctx.templateGrid));
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
    const variant = { index: variantIndex, raw: rawRelative };
    if (item.kind === "decor" || item.mode === "plain") {
        const { bitmap, report } = regularizeDecorSprite(decoded, project.settings);
        const cellRelative = `decor/${item.key}.v${variantIndex + 1}.png`;
        await writeFile(tileAssetPath(project.id, cellRelative), encodeBitmap(bitmap));
        variant.cell = cellRelative;
        variant.report = { mode: "sprite", scale: [report.scale, report.scale], retried: ctx.retried };
        return variant;
    }
    // 建筑：底面占 2×2 格、往上长高 —— 用专门的落位算法，不能走地形的「压进 1 格」
    if (item.kind === "building" || item.mode === "grid2x2") {
        const { bitmap, report } = regularizeBuilding(decoded, project.settings, {
            cols: item.footprint[0],
            rows: item.footprint[1],
            mode: "measured"
        });
        const cellRelative = `cell/${item.key}.v${variantIndex + 1}.png`;
        await writeFile(tileAssetPath(project.id, cellRelative), encodeBitmap(bitmap));
        variant.cell = cellRelative;
        // ⚠️ `baseFraction` 必须写进 variant —— 拼图阶段是**从磁盘重新读**贴图的，
        // 那时候 `bitmap` 上挂的属性已经没了。少了它拼图会退化成「靠贴图底边猜」，
        // 建筑就会整体错位（实测偏了一大截）。
        variant.report = { ...report, baseFraction: bitmap.baseFraction, retried: ctx.retried };
        return variant;
    }
    // 地形：测量 → 规整（不可信就回退模板几何）
    const templateFile = ctx.templateCell;
    const templateGeom = await templateGeometry(templateFile);
    let measure;
    let fallback;
    /** 实测比例（即便不可信也记下来）—— 用来诊断「是不是模型把菱形画歪了」。 */
    let measuredRatio;
    try {
        const candidate = measureGroundDiamond(decoded);
        measuredRatio = candidate.ratio;
        const reason = measurementLooksSane(decoded, candidate);
        if (reason === undefined)
            measure = candidate;
        else
            fallback = reason;
    }
    catch (error) {
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
            ? `模型没有画出 2:1 的等距菱形（实测 ${measuredRatio.toFixed(3)}），已按模板几何回退。请换用 Seedream 5.0 系列模型（4.0 会把菱形画成近正方形），或在「设置 → 游戏素材大师」里改模型后重跑这一张。`
            : fallback;
    const cellRelative = `cell/${item.key}.v${variantIndex + 1}.png`;
    await writeFile(tileAssetPath(project.id, cellRelative), encodeBitmap(bitmap));
    variant.cell = cellRelative;
    variant.report = { ...report, ratioMeasured: report.ratioMeasured ?? measuredRatio, fallbackReason: hint, retried: ctx.retried };
    return variant;
}
/** 从模板图里量出菱形几何（**不硬编码尺寸**）。 */
async function templateGeometry(file) {
    const bitmap = await decodeFile(file);
    // 模板是不透明的洋红菱形 + 透明背景 → 前景就是菱形本身
    let left = bitmap.width;
    let top = bitmap.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
            if (bitmap.rgba[(y * bitmap.width + x) * 4 + 3] < 128)
                continue;
            if (x < left)
                left = x;
            if (x > right)
                right = x;
            if (y < top)
                top = y;
            if (y > bottom)
                bottom = y;
        }
    }
    if (right < 0)
        throw new Error(`模板 ${basename(file)} 里没有找到菱形`);
    return {
        centerX: (left + right + 1) / 2,
        centerY: (top + bottom + 1) / 2,
        halfWidth: (right - left + 1) / 2,
        halfHeight: (bottom - top + 1) / 2
    };
}
async function dataUri(file) {
    const bytes = await readFile(file);
    const ext = sniffImageExt(bytes);
    const mime = ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${bytes.toString("base64")}`;
}
export async function runMapStage(projectId, options = {}) {
    if (tileBusy(projectId))
        return { started: false, reason: "已有任务在跑" };
    const project = await readTileProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    const lookup = new Map();
    const families = {};
    /** 每个**格子键**（`cells` 里写的那个）有哪些可用变体。 */
    const byCellKey = {};
    for (const item of project.items) {
        const candidates = [];
        for (const variant of item.variants) {
            if (variant.cell === undefined)
                continue;
            const bitmap = await decodeFile(tileAssetPath(projectId, variant.cell));
            // 建筑贴图的底面位置是**量出来的**，存在 report 里。这里把磁盘读回来的
            // 位图重新挂上它，拼图才知道该对齐哪里（见 generateOne 里的注释）。
            if (typeof variant.report?.baseFraction === "number") {
                bitmap.baseFraction = variant.report.baseFraction;
            }
            lookup.set(`${item.key}#${variant.index}`, bitmap);
            candidates.push(`${item.key}#${variant.index}`);
        }
        if (candidates.length > 0) {
            families[item.family] = [...(families[item.family] ?? []), ...candidates];
            byCellKey[item.key] = [...(byCellKey[item.key] ?? []), ...candidates];
        }
    }
    if (lookup.size === 0)
        throw new Error("还没有已通过的地块，请先在第 ③ 步生成并验收");
    const rows = clampInt(options.rows ?? project.map.rows, project.map.rows, 1, 64);
    const cols = clampInt(options.cols ?? project.map.cols, project.map.cols, 1, 64);
    const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : project.map.seed;
    const fill = options.fill ?? "grass";
    // 显式要的 fill 必须先校验存在：现在有「沿用已存布局」这条路径，
    // 光靠后面按 cells 校验会漏掉「fill 本身就不存在」的情况
    //（那种情况下用户以为会铺满 fill，实际铺的是旧布局）。
    if (options.fill !== undefined && (families[options.fill] ?? []).length === 0) {
        throw new Error(`没有可用的地块类别「${options.fill}」。可选：${Object.keys(families).filter((k) => families[k].length > 0).join("、")}`);
    }
    /**
     * 要铺的那份状态。
     *
     * ⚠️ **必须优先沿用项目里存着的布局**（那是用户在「手动编辑布局」里一格一格涂出来的）。
     * 之前只要传了任意一个覆盖参数（界面永远会传 `decorDensity`）就走
     * `emptyMapState(rows, cols, fill)` —— **整份手改布局被丢掉**，重新铺出一张
     * 纯 fill 的规则地图，而且不报任何错。
     *
     * ⚠️ 但 `hasSaved` 不能只看「网格非空」：新建项目的 `emptyMapState(14,14,"")`
     * 就是一张 14×14 的**空字符串**网格，那也是「非空」。把它当成有布局，
     * 就会去渲染一张 14×14 的空地图 —— 画布按 14×14 撑到 896×768、
     * 实际一个像素都没画（实测：第一次铺图得到 896×768 的全透明图，
     * 而 `map.pixel` 还是 (0,0)，界面的可点格子与预览图完全对不上）。
     * 判据必须是「**至少有一格填了东西**」。
     */
    const saved = project.map.cells;
    const hasSaved = Array.isArray(saved) && saved.some((row) => Array.isArray(row) && row.some((cell) => cell !== "" && cell !== undefined));
    const state = hasSaved
        ? { ...project.map, rows, cols, seed, cells: resizeCells(saved, rows, cols, fill) }
        : emptyMapState(rows, cols, fill, seed);
    // 先定下「到底铺哪张图」：装饰与建筑都在这步决定（含它们占掉的格子）。
    // 建筑会把占格的键**清空**，所以预校验必须查**这份**状态 —— 查原始 state
    // 会看到建筑键（如 `building`）而去 `byCellKey` 里找它，但建筑根本没有
    // 「按类别铺的地块」，于是误报「这些地块还没有已生成的图：building」。
    // 实测：布局里放一栋建筑就再也拼不出图。
    //
    // 垫底用的地面：优先取布局里第一个真的存在的地面地块，退化到任意地形地块。
    //
    // ⚠️ 这里要的是**变体名**（`grass#0`）而不是地块键（`grass`）——
    // `lookup` / `families` 里的键都是 `key#vN`。传裸键进去 `lookup.get()` 会是
    // undefined，垫底静默不画（实测建筑脚下还是一块透明洞），而且不报任何错。
    const groundItemKey = (byCellKey[fill] ?? []).length > 0
        ? fill
        : (Object.keys(byCellKey).find((k) => project.items.find((it) => it.key === k)?.kind === "terrain") ?? "");
    const groundKey = groundItemKey === "" ? "" : (byCellKey[groundItemKey] ?? [])[0] ?? "";
    // 还要把**地块键**也传进去：`cells` 里混进装饰/建筑键时要按它补默认地面
    const decorated = decorateState(state, families, options.decorDensity ?? 0, project.items, groundKey, options.reroll === true, groundItemKey);
    // 预校验：地图里引用的**格子键**必须真的有已生成的变体。
    //
    // ⚠️ 这里必须查 `byCellKey` 而不是 `families`。`families` 是按**类别**聚合的，
    // 而 `cells` 里存的是**地块键** —— 两者只在这两套名字恰好相同时才一样。
    // 实测踩过：`dirt2` 的类别是 `dirt`，查 `families["dirt2"]` 得 undefined，
    // 于是「拼成地图」直接报「这些类别还没有已生成的地块：dirt2」，
    // 而 `dirt2` 明明已经生成好了 —— 整个第 ④ 步直接不可用。
    const missing = new Set();
    for (const row of decorated.cells) {
        for (const key of row) {
            if (key === "" || key === undefined)
                continue;
            if ((byCellKey[key] ?? []).length === 0)
                missing.add(key);
        }
    }
    if (missing.size > 0) {
        const available = Object.keys(byCellKey).join("、");
        throw new Error(`这些地块还没有已生成的图：${[...missing].join("、")}。请先在第 ③ 步生成，或把它换成已有的地块（${available}）。`);
    }
    void background(projectId, "map", ["map"], async (job, report) => {
        const dir = tileProjectDir(projectId);
        await mkdir(join(dir, "map"), { recursive: true });
        job.running = "map";
        await report();
        const assembled = assembleMap(lookup, decorated, {
            settings: project.settings,
            // ⚠️ 这里必须传 `byCellKey`（**地块键** → 变体名），不是 `families`（**类别** → 变体名）。
            //
            // `state.cells` 里存的是地块键（`rock2`），而 `assembleMap` 拿它直接查
            // `options.families[键]`。传按类别聚合的那份时，凡是「地块键 ≠ 类别名」的
            // 都会查不到、**整格静默跳过**，地图上留下一个个透明菱形洞。
            // 实测：`rock2` 的类别是 `rock`，于是 6 个 rock2 格全是洞 ——
            // 而预校验查的是 `byCellKey`、判定「有图」，所以**不报任何错**。
            families: byCellKey,
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
            fresh.map = {
                ...decorated,
                png: "map/map.png",
                json: "map/map.json",
                // 记下成品的像素信息：界面叠可点格子时要用 left/top 对齐裁剪后的画布
                pixel: {
                    width: big.width,
                    height: big.height,
                    left: trimmed.left * 2,
                    top: trimmed.top * 2,
                    scale: 2
                }
            };
            fresh.stages.map = { status: "done", at: new Date().toISOString() };
            invalidateFrom(fresh, "export");
            appendJobLog(fresh.logs, "info", `已拼图：${decorated.cols}×${decorated.rows}（本地计算，免费）`);
        });
    });
    return { started: true };
}
/**
 * 把存下来的布局裁剪 / 扩展到目标行列。
 *
 * 扩出来的格子用 `fill` 铺（用户改大行列时不会得到一片空格），
 * 裁掉的部分直接丢。这样做是为了「改行 / 列」不要连带丢掉整份手改布局。
 */
function resizeCells(cells, rows, cols, fill) {
    const out = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            row.push(cells[r]?.[c] ?? fill);
        }
        out.push(row);
    }
    return out;
}
/** 从 `families`（类别 → 变体名）里挑一个「像地面」的类别当兜底：优先 grass。 */
function groundFillKey(families) {
    const keys = Object.keys(families).filter((k) => (families[k] ?? []).length > 0);
    if (keys.length === 0)
        return "";
    return keys.find((k) => k === "grass") ?? keys[0];
}
/**
 * 按装饰密度随机撒装饰、放置建筑 —— 用确定性 PRNG，保证同种子可复现。
 *
 * ⚠️ **已经存下来的布局是唯一真源，不能每次拼图都重随一遍。**
 * 以前这里无条件重撒装饰：同种子确实逐像素一致，但只要换个种子就整张变样，
 * 而且用户「开始编辑布局」时拿到的又是另一套 —— 看起来像在编辑别的图。
 * 现在只有「还没有装饰记录」或显式要求 `reroll` 时才撒。
 *
 * **建筑**：布局里写了某个建筑地块的键（例如 `building`）时，就把它的
 * 占格（如 2×2）铺在那个位置，并登记进 `out.buildings` 让拼图把立体贴图画上去。
 * 以前这里只撒装饰、从不放建筑 —— `buildings` 永远是空的，所以**建筑根本不会出现在地图上**。
 */
function decorateState(state, families, density, items = [], groundKey = "", 
/** 重撒装饰（用户点了「换个种子重铺」）。默认沿用存下来的布局。 */
reroll = false, 
/** 默认地面的**地块键**（`grass`）—— 补「cells 里混进装饰/建筑键」那些格子用。 */
groundItemKey = "") {
    const out = {
        ...state,
        cells: state.cells.map((row) => [...row]),
        decor: { ...state.decor },
        buildings: []
    };
    // ── 建筑：按布局里出现的键放置 ──────────────────────────────────────────
    const buildingByKey = new Map(items.filter((it) => it.kind === "building" || it.mode === "grid2x2").map((it) => [it.key, it]));
    /** 被建筑占掉的格子（不再撒装饰）。 */
    const occupied = new Set();
    /**
     * 放置一栋建筑。
     *
     * ⚠️ 放完必须把占格的键**清空** —— 留着的话 `assembleMap` 会把这些格子当成
     * 「地面地块」，再拿同一个建筑贴图当 1 格地面画 4 次，地图上多出一大块残影。
     *
     * ⚠️ 清空之后**布局里就再也看不到这栋楼了**（键没了）。所以 `buildings` 与
     * `buildingGround` 必须作为「已放置」的记录一起存回去，重跑时先沿用它们；
     * 只看 `cells` 的话，第二次拼图时建筑的键已经被自己清掉了 —— 楼会凭空消失。
     *
     * `ground` 存的是**变体名**（`grass#0`）—— `lookup` 的键就是这个形状。
     */
    const place = (r, c, item, fw, fh, ground) => {
        const name = (families[item.family] ?? [])[0];
        if (name === undefined)
            return;
        // 同一个位置别放两次
        if (out.buildings.some((b) => b[0] === r && b[1] === c))
            return;
        out.buildings.push([r, c, name]);
        (out.buildingGround ??= []).push([r, c, fw, fh, ground]);
        for (let dr = 0; dr < fh; dr++) {
            for (let dc = 0; dc < fw; dc++) {
                occupied.add(`${r + dr},${c + dc}`);
                out.cells[r + dr][c + dc] = "";
            }
        }
    };
    /** 把存下来的垫底键规整成变体名；规整不出来就退回 `groundKey`（调用方已解析好）。 */
    const asVariantName = (ground) => {
        if (ground === "")
            return groundKey;
        if (ground.includes("#"))
            return ground;
        return (families[ground] ?? [])[0] ?? groundKey;
    };
    // 1) 沿用上一轮已经放好的建筑（它们的键已经从 cells 里清掉了）
    //    先照抄记录，再由下面的 place() 去重
    const carried = (state.buildingGround ?? []).slice();
    const carriedBuildings = (state.buildings ?? []).slice();
    out.buildings = [];
    out.buildingGround = [];
    for (const [r, c, name] of carriedBuildings) {
        const entry = carried.find((g) => g[0] === r && g[1] === c);
        if (entry === undefined)
            continue;
        const item = items.find((it) => it.kind === "building" && (families[it.family] ?? [])[0] === name)
            ?? items.find((it) => it.kind === "building");
        if (item === undefined)
            continue;
        place(r, c, item, entry[2], entry[3], asVariantName(entry[4]));
    }
    // 2) 再从布局里找新放置的建筑（键还在 cells 里的那些）
    for (let r = 0; r < out.rows; r++) {
        for (let c = 0; c < out.cols; c++) {
            const key = out.cells[r]?.[c];
            if (key === undefined || key === "")
                continue;
            const item = buildingByKey.get(key);
            if (item === undefined)
                continue;
            const [fw, fh] = item.footprint;
            // 占格必须完整落在图内
            if (r + fh > out.rows || c + fw > out.cols)
                continue;
            // 底下的格子引用同一个键时说明这是同一栋楼（避免重复放置）
            let sameBuilding = true;
            for (let dr = 0; dr < fh; dr++) {
                for (let dc = 0; dc < fw; dc++) {
                    if (out.cells[r + dr]?.[c + dc] !== key) {
                        sameBuilding = false;
                        break;
                    }
                }
                if (!sameBuilding)
                    break;
            }
            if (!sameBuilding)
                continue;
            place(r, c, item, fw, fh, groundKey);
        }
    }
    /**
     * ★ `cells` 里可能是**装饰或建筑的键**（用户早年用手涂的方式写进去的，
     * 那时的编辑器只有单层布局）。这些格子必须补上默认地面。
     *
     * 不补的话 `assembleMap` 会拿这个键去查地面变体、查不到就整格跳过 ——
     * 地图上留下一个个**透明菱形洞**（实测：一个 13 个 tree 格的项目就是 13 个白洞）。
     * 界面预览已经按同样口径处理了，这里补齐两边才一致。
     *
     * 顺带：**装饰键要就地升格成真正的装饰**。用户手涂一棵树时想看到的是「草地上
     * 有棵树」，只把键换成草地会把树**弄丢**（实测修复后白洞没了、树也没了）。
     *
     * ⚠️ 必须放在**建筑放置之后**：建筑也是靠 `cells` 里的键识别的，
     * 先跑这一段会把 `building` 键换成草地，建筑就再也放不出来了（实测踩过）。
     */
    {
        // ⚠️ 填回去的是**地块键**（`grass`），不是变体名（`grass#0`）。
        // `cells` 存的一直是地块键，变体由 `families` 再展开一层；
        // 传变体名进去会被预校验判成「还没有已生成的图」（实测就是这么炸的）。
        const fillKey = groundItemKey !== "" ? groundItemKey : groundFillKey(families);
        const byKey = new Map(items.map((it) => [it.key, it]));
        if (fillKey !== "") {
            for (let r = 0; r < out.rows; r++) {
                for (let c = 0; c < out.cols; c++) {
                    const key = out.cells[r]?.[c];
                    // 建筑占格已经被 place() 清空了，这里只处理「还留着非地面键」的格子
                    if (key === undefined || key === "")
                        continue;
                    const item = byKey.get(key);
                    if (item !== undefined && item.kind === "terrain")
                        continue; // 本来就是地面
                    // 装饰键 → 升格成装饰层的一条记录（贴图取该类别第一个变体）
                    if (item !== undefined && item.kind === "decor") {
                        const name = (families[item.family] ?? [])[0];
                        const pos = `${r},${c}`;
                        if (name !== undefined && out.decor[pos] === undefined)
                            out.decor[pos] = name;
                    }
                    out.cells[r][c] = fillKey;
                }
            }
        }
    }
    if (density <= 0)
        return out;
    const decorKeys = Object.keys(families).filter((key) => key === "tree" || key === "boulder");
    if (decorKeys.length === 0)
        return out;
    // ⚠️ 已经有装饰记录了就不再重撒 —— 那份记录是用户看到、也可能手工改过的布局。
    // 无条件重撒会让「换个种子」把整张图连同建筑位置一起打乱，
    // 也会让「开始编辑布局」拿到的和刚才看到的不是同一张。
    if (reroll !== true && Object.keys(out.decor).length > 0)
        return out;
    out.decor = {};
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
            if (occupied.has(`${r},${c}`))
                continue;
            if (rand() > density)
                continue;
            const family = decorKeys[Math.floor(rand() * decorKeys.length)];
            const candidates = families[family] ?? [];
            if (candidates.length === 0)
                continue;
            out.decor[`${r},${c}`] = candidates[Math.floor(rand() * candidates.length)];
        }
    }
    return out;
}
// ── ⑤ 导出（本地，免费）──────────────────────────────────────────────────
export async function runExportStage(projectId) {
    if (tileBusy(projectId))
        return { started: false, reason: "已有任务在跑" };
    const project = await readTileProject(projectId);
    if (project === undefined)
        throw new Error(`项目不存在：${projectId}`);
    if (project.map.png === undefined)
        throw new Error("还没拼图，请先在第 ④ 步拼一张地图");
    void background(projectId, "export", ["tiles"], async (job, report) => {
        const dir = tileProjectDir(projectId);
        await mkdir(join(dir, "export", "tiles"), { recursive: true });
        for (const item of project.items) {
            for (const variant of item.variants) {
                if (variant.cell === undefined)
                    continue;
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
export function invalidateFrom(project, from) {
    const order = TILE_STAGES;
    const start = order.indexOf(from);
    if (start < 0)
        return;
    for (let i = start; i < order.length; i++) {
        const stage = order[i];
        project.stages[stage] = { status: "idle" };
        if (stage === "generate") {
            // ⚠️ 这一步是**全量销毁**：清空所有地块的变体（那是花了钱的）。
            // 所以调用方必须只在「提示词真的变了」时才走到这里 —— 见 `invalidateItems`。
            invalidateItems(project);
        }
        if (stage === "map") {
            // ⚠️ **只清产物，不清几何。**
            //
            // `pixel` 记的是成品画布尺寸与裁剪偏移，界面靠它把叠层对齐到预览图。
            // 以前这里把它一起抹掉，于是保存布局之后界面拿不到偏移、退回「未裁画布」
            // 的估算尺寸 —— 画布从 900 高变成 1600 高，`fit` 缩放跟着变，
            // 整张图**看起来被抬高/缩小了**（真机反馈：「保存时地块整体抬高」）。
            // 布局一改，尺寸与偏移并不会变，所以留着一份没有坏处。
            project.map = { ...project.map, png: undefined, json: undefined };
        }
    }
}
/**
 * 只作废「某一组地块」的产物。
 *
 * 与 `invalidateFrom(project, "generate")` 的区别：后者会把**所有**地块的变体
 * 清空（那是花钱生成的）。用户只改了一个地块的描述、甚至只改了个标签，
 * 都不该把别的地块一起废掉。
 *
 * `keys` 为空 / 省略时退化成全量作废（与 invalidateFrom 一致）。
 */
export function invalidateItems(project, keys) {
    const targets = keys === undefined || keys.length === 0 ? undefined : new Set(keys);
    for (const item of project.items) {
        if (targets !== undefined && !targets.has(item.key))
            continue;
        item.variants = [];
        item.approved = undefined;
    }
    project.stages.generate = { status: "idle" };
    project.stages.review = { status: "idle" };
    invalidateFrom(project, "map");
}
// ── 作业执行器 ────────────────────────────────────────────────────────────
/**
 * 跑一个后台作业。
 *
 * `targets` 是硬要求：界面遮罩按它盖住**还没轮到**的项。不盖遮罩时界面看着
 * 完全正常，只是「点了没反应」，用户会反复点 —— 而每次点击都真实计费。
 */
async function background(projectId, kind, targets, run, after) {
    const job = {
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
        if (after !== undefined)
            await after();
        await patchTileProject(projectId, (fresh) => {
            if (fresh.stages[kind].status === "running") {
                fresh.stages[kind] = { status: "done", at: new Date().toISOString() };
            }
        });
    }
    catch (error) {
        job.error = messageOf(error);
        job.running = null;
        await patchTileProject(projectId, (fresh) => {
            fresh.stages[kind] = { status: "error", error: job.error, at: new Date().toISOString() };
            appendJobLog(fresh.logs, "error", `${kind} 阶段失败：${job.error}`);
        }).catch(() => undefined);
    }
    finally {
        cancelled.delete(projectId);
    }
}
function clampInt(value, fallback, min, max) {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
export function tileView(project) {
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
        progress: tileProgress(project),
        // 界面「手动编辑布局」要用的即时预览素材：每个地块有哪些变体贴图。
        // 不给的话界面只能画出空的菱形格子 —— 用户看不见自己涂的是什么，
        // 得先「保存布局 → 铺成地图」才能看到效果，那就谈不上预览了。
        preview: tilePreview(project)
    };
}
export function tilePreview(project) {
    const cells = {};
    const kinds = {};
    const footprints = {};
    /** 地块键 → `key#index` → 该变体的贴图路径与底面比例。 */
    const byVariant = new Map();
    for (const item of project.items) {
        const urls = [];
        for (const variant of item.variants) {
            if (variant.cell === undefined)
                continue;
            urls.push(variant.cell);
            byVariant.set(`${item.key}#${variant.index}`, {
                cell: variant.cell,
                baseFraction: typeof variant.report?.baseFraction === "number" ? variant.report.baseFraction : 0.5
            });
        }
        if (urls.length > 0)
            cells[item.key] = urls;
        kinds[item.key] = item.kind;
        footprints[item.key] = [item.footprint[0], item.footprint[1]];
    }
    const rows = project.map.rows;
    const cols = project.map.cols;
    const seed = project.map.seed;
    // 地面：每格挑一个变体 —— **必须与宿主 `assembleMap` 用同一个函数**，
    // 否则预览和成品会挑到不同的变体（用了不同公式，同种子也会错开）。
    const ground = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            const key = project.map.cells?.[r]?.[c] ?? "";
            const list = cells[key];
            row.push(list === undefined || list.length === 0 ? -1 : pickVariantIndex(seed, r, c, list.length));
        }
        ground.push(row);
    }
    /**
     * 把「地块键」或「贴图路径」都解析成 `{ cell, baseFraction, index }`。
     *
     * 两种写法都要认：界面回传的是**键**，而早期存下来的数据里可能是**路径**。
     * 只认一种，另一种会被静默跳过 —— 装饰/建筑直接消失，且不报任何错。
     */
    const resolveArt = (value) => {
        if (value === "")
            return null;
        const direct = byVariant.get(value);
        if (direct !== undefined) {
            const hash = value.indexOf("#");
            const index = hash < 0 ? 0 : Number.parseInt(value.slice(hash + 1), 10);
            return { cell: direct.cell, baseFraction: direct.baseFraction, index: Number.isFinite(index) ? index : 0 };
        }
        if (cells[value] !== undefined && cells[value].length > 0) {
            return { cell: cells[value][0], baseFraction: 0.5, index: 0 };
        }
        for (const list of Object.values(cells)) {
            if (list.includes(value))
                return { cell: value, baseFraction: 0.5, index: 0 };
        }
        return null;
    };
    // 装饰：成品里存的 `"r,c" -> key#index`（早期可能是贴图路径）
    const decor = {};
    for (const [pos, name] of Object.entries(project.map.decor ?? {})) {
        const found = resolveArt(name);
        if (found === null)
            continue;
        decor[pos] = [found.index, found.cell];
    }
    // 建筑：锚点 + 占格 + 贴图（界面要按 2×2 摆，不能只画一格）
    const buildings = [];
    for (const [r, c, name] of project.map.buildings ?? []) {
        const found = resolveArt(name);
        if (found === null)
            continue;
        const entry = (project.map.buildingGround ?? []).find((g) => g[0] === r && g[1] === c);
        buildings.push({
            r, c,
            fw: entry?.[2] ?? 2,
            fh: entry?.[3] ?? 2,
            index: found.index,
            cell: found.cell,
            baseFraction: found.baseFraction
        });
    }
    const groundName = (project.map.buildingGround ?? [])[0]?.[4];
    const groundUnder = groundName === undefined ? null : (byVariant.get(groundName)?.cell ?? null);
    return {
        cells,
        kinds,
        footprints,
        cellWidth: project.settings.cellWidth,
        cellHeight: project.settings.cellHeight,
        seed,
        ground,
        decor,
        buildings,
        groundUnder
    };
}
/** 生成 / 期望 / 已验收三件套（界面与工具共用一份算法）。 */
export function tileProgress(project) {
    let generated = 0;
    let expected = 0;
    let approved = 0;
    for (const item of project.items) {
        expected += Math.max(1, item.variantCount);
        for (const variant of item.variants) {
            if (variant.cell !== undefined)
                generated++;
            if (variant.approved === true)
                approved++;
        }
    }
    return { generated, expected, approved };
}
/** 装饰锚点（界面显示用）。 */
export function tileAnchorY(project) {
    return decorAnchorY(project.settings);
}
/**
 * 给**对话工具**用的快照：产物一律是绝对 URL（会直接贴给用户点）。
 *
 * 与 `tileView` 的区别：`tileView` 给界面用相对路径（界面自己拼 origin），
 * 这里给模型用绝对 URL。两者都只带「判断所需的最小字段」，不是整个 project.json。
 */
export function tileSnapshot(project, origin) {
    const assetBase = `${origin}/dsh-game-material-master/tile-assets/${project.id}/`;
    const url = (relative) => typeof relative === "string" && relative !== "" ? `${assetBase}${relative}` : undefined;
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
export function tileDiamondHeight(project) {
    return diamondHeight(project.settings);
}
export { ArkError };
