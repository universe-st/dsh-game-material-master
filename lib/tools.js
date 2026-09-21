/**
 * 游戏素材大师 —— 对话调用面（模型工具）。
 *
 * 目标：**插件里的每个功能都能通过对话调用**，多步流程（八方向图这种）
 * 让 agent 自己推进 / 等待 / 审查，也可以每一步停下来交给人验收。
 *
 * 工具分工：
 *
 * | 工具 | 作用 |
 * |---|---|
 * | `game_material_call` | 万能通道：45 个远程方法逐个可调，覆盖全部功能 |
 * | `game_material_status` | 读一眼当前进度（项目 / 任务 / 阶段 / 是否有任务在跑） |
 * | `game_material_wait` | 阻塞等待到「没有任务在跑」或超时，回来就是可审查状态 |
 * | `game_material_review` | 出一个**验收包**：每个产物的绝对 URL、状态、通过标记、深链接 |
 * | `game_material_approve` | 打「通过 / 取消通过」（八方向图按阶段+方位，图片按张，序列帧按步骤） |
 *
 * 几个刻意的设计：
 *
 * - **不新增业务逻辑**：工具只是 `GameStudioGateway` 上已有方法的编排层，
 *   避免同一件事有两份实现（界面走远程服务，模型走工具，底层同一份代码）。
 * - **结果里永远带 `openUrl`**：模型把这条链接贴给用户，用户点一下就把
 *   Web GUI 切到插件对应页面验收。见 src/links.ts。
 * - **不重复提交**：生成类调用照旧由宿主半区拦重复提交，工具层不再拦一次
 *   （两层拦截会让报错信息变得莫名其妙）。
 */
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DIRECTION_KEYS, directionOf } from "./directions.js";
import { listJobs } from "./pipeline.js";
import { listProjects, readProject } from "./store.js";
import { listImageJobs, readImageJob, sniffImage } from "./imagegen.js";
import { listSequenceJobs, readSequenceJob, listSequenceTasks } from "./seqgen.js";
import { listRigJobs, readRigJob, rigSnapshot } from "./riggen.js";
import { TOOL_METHODS } from "./wire.js";
import { PANEL_KEY, buildOpenLink, originForLinks } from "./links.js";
/** 三个模块的 key 与界面里的模块 key 完全一致。 */
const MODULES = ["sprite", "image", "sequence", "rig"];
/** 工具名统一前缀，避免和别家插件撞名。 */
const PREFIX = "game_material_";
/** 远程资源路由前缀，与 index.ts 的 ROUTE_PREFIX 一致。 */
const ROUTE_PREFIX = "/dsh-game-material-master";
/** 输出 schema：工具返回值是不定形的 JSON，这里只约束到「对象」。 */
const OBJECT_SCHEMA = { type: "object", additionalProperties: true };
const textBlocks = (text) => [{ type: "text", text }];
const asRecord = (value) => value !== null && typeof value === "object" ? value : {};
const asString = (value, fallback = "") => (typeof value === "string" ? value : fallback);
const clampInt = (value, fallback, min, max) => {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
};
function moduleOf(value) {
    return typeof value === "string" && MODULES.includes(value) ? value : undefined;
}
/** 任务 id 前缀决定它属于哪个模块（p… / i… / s… / r…）。 */
export function moduleForId(id) {
    if (/^p[a-z0-9]+$/.test(id))
        return "sprite";
    if (/^i[a-z0-9]+$/.test(id))
        return "image";
    if (/^s[a-z0-9]+$/.test(id))
        return "sequence";
    if (/^r[a-z0-9]+$/.test(id))
        return "rig";
    return undefined;
}
/** 产物相对路径 → 浏览器可直接打开的绝对 URL。 */
function assetUrl(assetBase, relative) {
    if (typeof relative !== "string" || relative === "")
        return undefined;
    return `${originForLinks()}${assetBase}${relative}`;
}
function cellsOf(nodes, assetBase, pick) {
    return DIRECTION_KEYS.map((key) => {
        const node = nodes?.[key] ?? {};
        const picked = pick(node);
        return {
            direction: key,
            label: directionOf(key)?.label ?? key,
            status: String(node.status ?? "empty"),
            approved: node.approved === true,
            stale: node.stale === true,
            file: picked.file,
            url: picked.url ?? assetUrl(assetBase, picked.file),
            ...(picked.extra ?? {}),
            ...(typeof node.error === "string" && node.error !== "" ? { error: node.error } : {})
        };
    });
}
function spriteSnapshot(project) {
    const assetBase = `${ROUTE_PREFIX}/assets/${project.id}/`;
    // 「还有没有活在跑」= 节点状态 + 宿主的后台任务表。只看节点不行：批量任务是
    // 一个方向一个方向开工的（抽帧并发只有 2），任务刚登记时八个方向可能都还不是
    // running，只看节点会让 game_material_wait 立刻返回 settled=true，
    // 而那时候一个产物都没出来。
    const busy = DIRECTION_KEYS.some((key) => project.images?.[key]?.status === "running" ||
        project.videos?.[key]?.status === "running" ||
        project.frames?.[key]?.status === "running") || project.sheet?.status === "running" || listJobs(project.id).length > 0;
    const count = (cells, status) => cells.filter((cell) => cell.status === status).length;
    const approved = (cells) => cells.filter((cell) => cell.approved).length;
    const images = cellsOf(project.images, assetBase, (node) => ({ file: node.file }));
    const videos = cellsOf(project.videos, assetBase, (node) => ({ file: node.file }));
    const frames = cellsOf(project.frames, assetBase, (node) => ({ file: node.strip, extra: { frameCount: node.frames?.length ?? 0 } }));
    const sheetCell = [
        {
            direction: "sheet",
            label: "整图",
            status: String(project.sheet?.status ?? "empty"),
            approved: project.sheet?.approved === true,
            stale: false,
            file: project.sheet?.file,
            url: assetUrl(assetBase, project.sheet?.file),
            ...(typeof project.sheet?.error === "string" && project.sheet.error !== "" ? { error: project.sheet.error } : {})
        }
    ];
    return {
        module: "sprite",
        id: project.id,
        name: project.name,
        sourceFile: project.source?.file ?? null,
        reviewMode: project.reviewMode ?? null,
        busy,
        stages: [
            { stage: "images", title: "① 八方向绿幕图", ready: count(images, "ready"), running: count(images, "running"), error: count(images, "error"), approved: approved(images), total: 8, cells: images },
            { stage: "videos", title: "② 行走动作视频", ready: count(videos, "ready"), running: count(videos, "running"), error: count(videos, "error"), approved: approved(videos), total: 8, cells: videos },
            { stage: "frames", title: "③ 提取序列帧", ready: count(frames, "ready"), running: count(frames, "running"), error: count(frames, "error"), approved: approved(frames), total: 8, cells: frames },
            { stage: "sheet", title: "④ 抠绿幕合成整图", ready: sheetCell[0].status === "ready" ? 1 : 0, running: sheetCell[0].status === "running" ? 1 : 0, error: sheetCell[0].status === "error" ? 1 : 0, approved: sheetCell[0].approved ? 1 : 0, total: 1, cells: sheetCell }
        ],
        settings: {
            cellWidth: project.settings?.cellWidth,
            cellHeight: project.settings?.cellHeight,
            frameCount: project.settings?.frameCount,
            pixelSize: project.settings?.pixelSize,
            rowOrder: project.settings?.rowOrder
        },
        prompts: {
            video: project.prompts?.video,
            suffix: project.prompts?.suffix ?? "",
            images: project.prompts?.images
        },
        runningTasks: listJobs(project.id),
        logTail: Array.isArray(project.log) ? project.log.slice(-6).map((entry) => `${entry.level}: ${entry.message}`) : []
    };
}
function imageSnapshot(job) {
    const assetBase = `${ROUTE_PREFIX}/image-assets/${job.id}/`;
    const items = (job.items ?? []).map((item) => ({
        index: item.index,
        status: item.status,
        approved: item.approved === true,
        source: item.source,
        file: item.file,
        url: assetUrl(assetBase, item.file),
        keyedFile: item.keyedFile,
        keyedUrl: assetUrl(assetBase, item.keyedFile),
        backgroundFraction: item.backgroundFraction,
        ...(typeof item.error === "string" && item.error !== "" ? { error: item.error } : {})
    }));
    return {
        module: "image",
        id: job.id,
        name: job.name,
        reviewMode: job.reviewMode ?? null,
        busy: items.some((item) => item.status === "running"),
        prompt: job.prompt,
        suffix: job.suffix,
        refs: (job.refs ?? []).map((ref) => ref.file),
        settings: job.settings,
        keying: job.keying,
        items,
        review: {
            ready: items.filter((item) => item.status === "ready").length,
            approved: items.filter((item) => item.approved).length,
            error: items.filter((item) => item.status === "error").length
        }
    };
}
function sequenceSnapshot(job) {
    const assetBase = `${ROUTE_PREFIX}/sequence-assets/${job.id}/`;
    const steps = [
        { step: "video", title: "① 生成视频", status: job.video?.status, approved: job.video?.approved === true, url: assetUrl(assetBase, job.video?.file), error: job.video?.error },
        { step: "frames", title: "② 抽帧 + 抠像", status: job.frames?.status, approved: job.frames?.approved === true, files: (job.frames?.files ?? []).map((file) => assetUrl(assetBase, file)), keyed: (job.frames?.keyed ?? []).map((file) => assetUrl(assetBase, file)), stale: job.frames?.stale === true, error: job.frames?.error },
        { step: "sheet", title: "③ 横向合成条图", status: job.sheet?.status, approved: job.sheet?.approved === true, url: assetUrl(assetBase, job.sheet?.file), error: job.sheet?.error }
    ];
    return {
        module: "sequence",
        id: job.id,
        name: job.name,
        mode: job.mode,
        reviewMode: job.reviewMode ?? null,
        prompt: job.prompt,
        suffix: job.suffix,
        refs: {
            firstFrame: job.refs?.firstFrame?.file ?? null,
            lastFrame: job.refs?.lastFrame?.file ?? null,
            referenceImages: (job.refs?.referenceImages ?? []).length,
            referenceVideos: (job.refs?.referenceVideos ?? []).length
        },
        busy: steps.some((step) => step.status === "running"),
        settings: job.settings,
        keying: job.keying,
        steps,
        runningTasks: listSequenceTasks(job.id)
    };
}
/** 读一个目标（项目 / 图片任务 / 序列帧任务 / 骨骼动画任务）的快照。 */
async function snapshotOf(module, id) {
    if (module === "sprite") {
        const project = await readProject(id);
        if (project === undefined)
            throw new Error(`找不到八方向图项目：${id}`);
        return spriteSnapshot(project);
    }
    if (module === "image") {
        const job = await readImageJob(id);
        if (job === undefined)
            throw new Error(`找不到图片任务：${id}`);
        return imageSnapshot(job);
    }
    if (module === "sequence") {
        const job = await readSequenceJob(id);
        if (job === undefined)
            throw new Error(`找不到序列帧任务：${id}`);
        return sequenceSnapshot(job);
    }
    const job = await readRigJob(id);
    if (job === undefined)
        throw new Error(`找不到骨骼动画任务：${id}`);
    // 工具侧要的是**绝对** URL（会直接贴给用户点），所以带上已上报的 origin。
    return rigSnapshot(job, originForLinks());
}
/** 猜一个目标属于哪个模块：显式声明优先，其次按 id 前缀。 */
function resolveTarget(module, id) {
    const declared = moduleOf(module);
    if (declared !== undefined)
        return declared;
    const guessed = moduleForId(id);
    if (guessed === undefined)
        throw new Error(`无法判断 "${id}" 属于哪个模块，请显式给 module`);
    return guessed;
}
/** 目标 → 深链接意图。 */
function intentOf(module, id, extra = {}) {
    if (module === "sprite")
        return { module, projectId: id, ...extra };
    return { module, jobId: id, ...extra };
}
/** 结果里统一带上的「打开界面」信息。 */
function openInfo(intent, hint) {
    return { panel: PANEL_KEY, openUrl: buildOpenLink(intent), openHint: hint };
}
/**
 * 从一次远程调用的入参里推断该打开哪个界面。
 * 推断不出来（例如 listProjects）就不给链接，免得把用户带到一个空页面上。
 */
function intentFromCall(method, payload) {
    const projectId = asString(payload.projectId);
    const jobId = asString(payload.jobId);
    const stage = typeof payload.stage === "string" ? payload.stage : undefined;
    if (projectId !== "")
        return { module: "sprite", projectId, stage };
    if (jobId !== "") {
        const module = moduleForId(jobId);
        return module === undefined ? undefined : { module, jobId };
    }
    if (method.startsWith("listRigJob") || method.startsWith("createRigJob"))
        return { module: "rig" };
    if (method.startsWith("listImageJob") || method.startsWith("createImageJob"))
        return { module: "image" };
    if (method.startsWith("listSequenceJob") || method.startsWith("createSequenceJob"))
        return { module: "sequence" };
    if (method.startsWith("listProject") || method.startsWith("createProject"))
        return { module: "sprite" };
    return undefined;
}
// ── 工具注册 ────────────────────────────────────────────────────────────
/** `game_material_call` 的描述：把 45 个方法的用途与入参写清楚。 */
const CALL_DESCRIPTION = [
    "调用「游戏素材大师」插件的任意远程方法——插件界面上的每个功能都能在这里调用。",
    "配置：getConfig() / saveConfig(payload: 任意配置字段，如 arkApiKey、arkModel、minimaxModel、cellWidth…) / testArk() / testMinimax()",
    "八方向图：listProjects() / createProject({name}) / getProject({projectId}) / deleteProject({projectId}) / renameProject({projectId,name}) /",
    "  uploadSource({projectId,name,data:base64}) / savePrompts({projectId,images?,video?,videoPerDirection?,suffix?,resetImagesToDefault?,resetVideoToDefault?}) /",
    "  saveSettings({projectId,settings}) / setApproved({projectId,stage:images|videos|frames|sheet,key?,approved}) / revealProject({projectId}) /",
    "  runImage({projectId,key,prompt?}) / runImages({projectId,force?}) / runVideos({projectId,keys?,regenerate?}) / pollVideos({projectId}) /",
    "  clearVideos({projectId,keys?}) / runFrames({projectId,keys?}) / rekey({projectId}) / compose({projectId})",
    "图片生成：listImageJobs() / createImageJob({name}) / getImageJob({jobId}) / deleteImageJob({jobId}) /",
    "  saveImageJob({jobId,name?,prompt?,suffix?,settings?,keying?,approved?,index?}) / uploadImageRef({jobId,name,data}) / removeImageRef({jobId,file}) /",
    "  addImageItem({jobId,name,data}) / removeImageItem({jobId,index}) / runImageJob({jobId,count?}) / keyImageJob({jobId})",
    "序列帧：listSequenceJobs() / createSequenceJob({name}) / getSequenceJob({jobId}) / deleteSequenceJob({jobId}) /",
    "  saveSequenceJob({jobId,name?,mode?,prompt?,suffix?,settings?,keying?,approved?,step?}) / uploadSequenceRef({jobId,kind:firstFrame|lastFrame|referenceImage|referenceVideo,name,data}) /",
    "  removeSequenceRef({jobId,kind,file?}) / runSequenceVideo({jobId}) / pollSequenceVideo({jobId}) / clearSequenceVideo({jobId}) /",
    "  runSequenceFrames({jobId,count?}) / keySequenceFrames({jobId}) / composeSequence({jobId})",
    "骨骼动画生成：listRigJobs() / createRigJob({name}) / getRigJob({jobId}) / deleteRigJob({jobId}) /",
    "  saveRigJob({jobId,name?,sheetPrompt?,suffix?,resetSheetPrompt?,settings?,approved?,stage?parts|layout|rig|atlas,part?}) /",
    "  uploadRigSource({jobId,name,data:角色整图}) / uploadRigPart({jobId,name:部件名,data:部件PNG}) / removeRigPart({jobId,name}) /",
    "  setRigPartVisibility({jobId,name,hidden}) / saveRigLayoutItem({jobId,name,x?,y?,width?,height?,rotation?,z?}) /",
    "  setRigSemantics({jobId,parts:[{name,role?,parent?,proximal?,distal?,tags?}]})【语义：这块是什么、挂在谁身上、骨骼从哪端伸到哪端】/",
    "  setRigBoneOffsets({jobId,bones:[{name,x?,y?,rotation?}]}) / resetRigBoneOffsets({jobId,names?})【手工骨骼偏移，重跑骨骼不会覆盖它】/",
    "  setRigAnimationSettings({jobId,animations:[{id,duration?,amplitude?}]}) / resetRigAnimationSettings({jobId,ids?})【动画参数】/",
    "  runRigSheet({jobId})【花钱：一次 Seedream 调用，把角色拆成部件摊平图】/ runRigSegment({jobId})【本地分割，免费】/",
    "  runRigLayout({jobId,names?})【本地装配定位，免费；只给 names 就只重跑那几个部件】/",
    "  runRigBones({jobId})【本地生成骨架与动画】/ runRigAtlas({jobId})【本地打包图集】",
    "  ★ 自动摆位不准时用 setRigLayoutHints：先 read_image 看 getRigJob 返回的 partsMontagePath（部件按 partsOrder 顺序排列）",
    "说明：key 是方向英文字面量（front/back/downLeft/downRight/upLeft/upRight/left/right）；data 是原始文件字节的 base64（不带 data: 前缀）；",
    "生成类方法立刻返回 {started:true}，接着用 game_material_wait 等它跑完，再用 game_material_review 拿验收包。",
    "调用结果里若带 openUrl，请把它作为 Markdown 链接贴给用户，用户点击即切换到插件对应页面。"
].join("\n");
/**
 * 注册对话调用面。
 *
 * @param host - 可选服务（tools / systemPrompt）
 * @param gateway - 已经注册成 typert 远程服务的网关实例，工具直接复用它的方法
 * @returns 每个贡献的 disposer 列表（按注册顺序）
 */
export function registerStudioTools(host, gateway) {
    const disposers = [];
    const tools = host.tools;
    /** 统一的注册包装：把 output schema 与 render 固定下来。 */
    const register = (definition) => {
        if (tools === undefined)
            return;
        disposers.push(tools.register(definition));
    };
    if (tools !== undefined) {
        register({
            name: `${PREFIX}call`,
            description: CALL_DESCRIPTION,
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    method: { type: "string", enum: TOOL_METHODS.map((entry) => entry.method), description: "要调用的远程方法名。" },
                    payload: { type: "object", additionalProperties: true, description: "方法入参对象；无参方法可省略。" }
                },
                required: ["method"]
            },
            output: {
                schema: OBJECT_SCHEMA,
                render: (_args, value) => textBlocks(renderCallResult(value))
            },
            async execute(args) {
                const method = asString(args?.method);
                const spec = TOOL_METHODS.find((entry) => entry.method === method);
                if (spec === undefined)
                    throw new Error(`未知方法：${method}`);
                const payload = args?.payload === undefined ? undefined : asRecord(args.payload);
                if (spec.payload && payload === undefined)
                    throw new Error(`${method} 需要一个 payload 对象`);
                if (!spec.payload && payload !== undefined && Object.keys(payload).length > 0) {
                    throw new Error(`${method} 不接受 payload`);
                }
                const fn = gateway[method];
                if (typeof fn !== "function")
                    throw new Error(`方法未实现：${method}`);
                let value;
                try {
                    value = payload === undefined ? await fn.call(gateway) : await fn.call(gateway, payload);
                }
                catch (error) {
                    throw new Error(`${method} 调用失败：${error instanceof Error ? error.message : String(error)}`);
                }
                const result = { method, ok: true, value: value ?? null };
                const intent = intentFromCall(method, payload ?? {});
                if (intent !== undefined)
                    Object.assign(result, openInfo(intent, "点开可以看到这一步的实际产物并打「通过」"));
                return result;
            }
        });
        register({
            name: `${PREFIX}status`,
            description: [
                "看一眼「游戏素材大师」的当前进度。",
                "不给 id 时列出全部项目 / 图片任务 / 序列帧任务；给了 id 就返回该目标的阶段进度、每个产物的状态与绝对 URL、是否有任务在跑。",
                "任何时候想确认「现在该做哪一步」都先调它。返回值里的 openUrl 请以 Markdown 链接贴给用户。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "目标所属模块；给了 id 时可省略，宿主按 id 前缀判断。" },
                    id: { type: "string", description: "项目 id（p…）/ 图片任务 id（i…）/ 序列帧任务 id（s…）。" }
                }
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderStatus(value)) },
            async execute(args) {
                const id = asString(args?.id);
                if (id === "") {
                    const [projects, images, sequences, rigs] = await Promise.all([listProjects(), listImageJobs(), listSequenceJobs(), listRigJobs()]);
                    return {
                        module: moduleOf(args?.module) ?? null,
                        projects,
                        imageJobs: images,
                        sequenceJobs: sequences,
                        rigJobs: rigs,
                        links: {
                            sprite: buildOpenLink({ module: "sprite" }),
                            image: buildOpenLink({ module: "image" }),
                            sequence: buildOpenLink({ module: "sequence" }),
                            rig: buildOpenLink({ module: "rig" })
                        },
                        hint: "用 game_material_status({module,id}) 看某个目标的细节；八方向图的四步是 images → videos → frames → sheet。"
                    };
                }
                const module = resolveTarget(args?.module, id);
                const snapshot = await snapshotOf(module, id);
                const stage = typeof args?.stage === "string" ? args.stage : undefined;
                return { ...snapshot, ...openInfo(intentOf(module, id, { stage }), "点开可以看到产物并打「通过」") };
            }
        });
        register({
            name: `${PREFIX}intake`,
            description: [
                "【固定流程第 0 步】用户一说要用「游戏素材大师」的某个功能，先调它，再动手。",
                "返回三样东西：① `blockers` —— 必须先解决的阻塞（例如还没配 API Key）；② `questions` —— 用户还没告知的关键参数，逐条问；",
                "③ `reviewModeQuestion` —— 必须问清楚「自动审核结果」还是「每一步人工审核」。",
                "在 `questions` 与 `reviewModeQuestion` 都得到用户答复之前，**不要**调用任何生成类 / 删除类方法。",
                "用户答复后：用 `game_material_reviewMode` 把审核模式记下来，用 `game_material_call` 把参数写进目标，再开始生成。",
                "已经明确告知过的参数不用重复问——只问这个工具列出来的、且用户确实没说的。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "用户想用的是哪个模块。" },
                    id: { type: "string", description: "已有目标的 id（想在它基础上继续时给）。" },
                    told: {
                        type: "array",
                        items: { type: "string" },
                        description: "用户已经明确告知过的参数名（如 prompt、count、mode、direction），这些不再重复问。"
                    }
                },
                required: ["module"]
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderIntake(value)) },
            async execute(args) {
                const module = moduleOf(args?.module);
                if (module === undefined)
                    throw new Error(`未知模块：${String(args?.module)}`);
                const id = asString(args?.id);
                const told = new Set(Array.isArray(args?.told) ? args.told.map((entry) => String(entry)) : []);
                const config = await gateway.getConfig();
                // 已有目标时先读它的真实状态：源图 / 提示词 / 素材已经在的项目里就不再问一遍。
                const target = id === "" ? undefined : await snapshotOf(module, id);
                return intakeFor(module, id, told, config, target);
            }
        });
        register({
            name: `${PREFIX}upload`,
            description: [
                "把本机文件上传进「游戏素材大师」——界面上那些「上传」框的对话等价物。",
                "参数 `path` 是文件的绝对路径或相对当前工作目录的路径，宿主自己读盘，**不要把 base64 贴进来**。",
                "kind 取值：sprite=source（源设定图）；image=ref（参考图，最多 10 张）| item（直接加一张图，只做抠像用）；",
                "sequence=firstFrame | lastFrame | referenceImage | referenceVideo；rig=source（角色整图）| part（单个部件 PNG，文件名即部件名）。",
                "限制：图片 ≤30MB，参考视频 ≤40MB（平台请求体上限 64MB），图片类型按文件头嗅探。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "目标所属模块。" },
                    id: { type: "string", description: "项目 id（p…）或任务 id（i… / s…）。" },
                    kind: { type: "string", enum: ["source", "ref", "item", "firstFrame", "lastFrame", "referenceImage", "referenceVideo", "part"], description: "上传到哪个槽位。" },
                    path: { type: "string", description: "本机文件路径。" },
                    name: { type: "string", description: "可选：展示用的文件名。" }
                },
                required: ["module", "id", "kind", "path"]
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderUpload(value)) },
            async execute(args) {
                const module = moduleOf(args?.module);
                if (module === undefined)
                    throw new Error(`未知模块：${String(args?.module)}`);
                const id = asString(args?.id);
                const kind = asString(args?.kind);
                const path = asString(args?.path);
                if (path === "")
                    throw new Error("path 不能为空");
                return uploadFromPath(gateway, module, id, kind, path, asString(args?.name) || undefined);
            }
        });
        register({
            name: `${PREFIX}reviewMode`,
            description: [
                "记录用户选的审核模式（固定流程必问项之一）：`auto` = agent 自己审完结果就往下走；`manual` = 每一步产出后停下来等用户打「通过」。",
                "记在目标自己身上，之后每一轮都按它走，不必再问。重复调用即改选。",
                "用户明确说「自动跑完就行」→ auto；说「每步我看一下 / 我要审核」→ manual。用户没表态就不要猜，先问。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "目标所属模块。" },
                    id: { type: "string", description: "项目 id（p…）或任务 id（i… / s…）。" },
                    reviewMode: { type: "string", enum: ["auto", "manual"], description: "审核模式。" }
                },
                required: ["module", "id", "reviewMode"]
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderReviewMode(value)) },
            async execute(args) {
                const module = moduleOf(args?.module);
                if (module === undefined)
                    throw new Error(`未知模块：${String(args?.module)}`);
                const result = await gateway.setReviewMode({
                    module,
                    id: asString(args?.id),
                    reviewMode: asString(args?.reviewMode)
                });
                return { ...result, ...openInfo(intentOf(module, asString(args?.id)), "点开看验收结果") };
            }
        });
        register({
            name: `${PREFIX}wait`,
            description: [
                "等待某个目标跑完当前这一步。",
                "每 1.5 秒读一次状态，直到「没有任务在跑」或超时；返回等待结束时的完整状态（含 openUrl 与验收信息）。",
                "生成类调用（runImages / runVideos / runFrames / compose / runImageJob / runSequenceVideo …）之后紧接着调它，",
                "拿到 settled=true 再判断下一步。超时不算失败——超时后可以再调一次，或先把 openUrl 贴给用户。",
                "注意：等待期间不要同时提交同一个目标的新任务，重复提交会被宿主拒绝。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "目标所属模块；可省略，按 id 前缀判断。" },
                    id: { type: "string", description: "项目 id（p…）/ 图片任务 id（i…）/ 序列帧任务 id（s…）。" },
                    timeoutSeconds: { type: "integer", description: "最长等待秒数，默认 120，上限 900。超时后返回当前状态。" }
                },
                required: ["id"]
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderWait(value)) },
            async execute(args, exec) {
                const id = asString(args?.id);
                if (id === "")
                    throw new Error("id 不能为空");
                const module = resolveTarget(args?.module, id);
                const timeoutMs = clampInt(args?.timeoutSeconds, 120, 1, 900) * 1000;
                const startedAt = Date.now();
                let snapshot = await snapshotOf(module, id);
                while (snapshot.busy === true && Date.now() - startedAt < timeoutMs) {
                    exec?.signal?.throwIfAborted?.();
                    await sleep(1500, exec?.signal);
                    snapshot = await snapshotOf(module, id);
                }
                const settled = snapshot.busy !== true;
                return {
                    settled,
                    timedOut: !settled,
                    elapsedMs: Date.now() - startedAt,
                    ...snapshot,
                    ...openInfo(intentOf(module, id), "点开可以看到产物并打「通过」")
                };
            }
        });
        register({
            name: `${PREFIX}review`,
            description: [
                "出验收包：把某一步的每个产物连成可直接打开的绝对 URL，附状态、通过标记与报错，再给出建议的下一步。",
                "用户说「我看看」「验收一下」时用它，然后把 openUrl 以 Markdown 链接贴给用户，用户点击即切到插件对应页面。",
                "用自己的判断验收时：逐项看 status 与 error，全部 ready 才继续下一步；有 error 就按 hint 里的方法重跑那一步。",
                "阶段约定：八方向图 stage=images|videos|frames|sheet；骨骼动画 stage=parts|layout|rig|atlas；图片/序列帧任务只看某一个产物时用 index / step 过滤。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "目标所属模块；可省略，按 id 前缀判断。" },
                    id: { type: "string", description: "项目 id（p…）/ 图片任务 id（i…）/ 序列帧任务 id（s…）。" },
                    stage: { type: "string", enum: ["images", "videos", "frames", "sheet", "parts", "layout", "rig", "atlas"], description: "八方向图 / 骨骼动画专用：只看某一个阶段。" },
                    direction: { type: "string", description: "八方向图专用：只看某一个方位（front/back/…）。" },
                    index: { type: "integer", description: "图片任务专用：只看第几张（从 0 开始）。" },
                    step: { type: "string", enum: ["video", "frames", "sheet"], description: "序列帧任务专用：只看某一步。" }
                },
                required: ["id"]
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderReview(value)) },
            async execute(args) {
                const id = asString(args?.id);
                if (id === "")
                    throw new Error("id 不能为空");
                const module = resolveTarget(args?.module, id);
                const snapshot = await snapshotOf(module, id);
                const stage = typeof args?.stage === "string" ? args.stage : undefined;
                const direction = typeof args?.direction === "string" ? args.direction : undefined;
                const index = args?.index === undefined ? undefined : clampInt(args.index, 0, 0, 99);
                const step = typeof args?.step === "string" ? args.step : undefined;
                const packet = {
                    module,
                    id,
                    name: snapshot.name,
                    busy: snapshot.busy === true,
                    ...openInfo(intentOf(module, id, { stage, direction }), "点开直接看产物并打「通过」")
                };
                if (module === "sprite") {
                    const stages = snapshot.stages.filter((entry) => stage === undefined || entry.stage === stage);
                    if (stages.length === 0)
                        throw new Error(`未知阶段：${stage}`);
                    packet.stages = stages.map((entry) => ({
                        ...entry,
                        cells: entry.cells.filter((cell) => direction === undefined || cell.direction === direction)
                    }));
                    packet.nextActions = spriteNextActions(snapshot, stage, direction);
                }
                else if (module === "image") {
                    const items = snapshot.items.filter((item) => index === undefined || item.index === index);
                    if (items.length === 0)
                        throw new Error(index === undefined ? "这个任务还没有产物" : `没有第 ${index} 张`);
                    packet.items = items;
                    packet.nextActions = imageNextActions(snapshot);
                }
                else if (module === "sequence") {
                    const steps = snapshot.steps.filter((entry) => step === undefined || entry.step === step);
                    if (steps.length === 0)
                        throw new Error(`未知步骤：${step}`);
                    packet.steps = steps;
                    packet.nextActions = sequenceNextActions(snapshot);
                }
                else {
                    const stages = snapshot.stages.filter((entry) => stage === undefined || entry.stage === stage);
                    if (stages.length === 0)
                        throw new Error(`未知阶段：${stage}`);
                    packet.stages = stages;
                    packet.parts = snapshot.parts.filter((part) => stage !== "layout" || part.status === "ready");
                    packet.review = snapshot.review;
                    packet.nextActions = rigNextActions(snapshot, stage);
                }
                return packet;
            }
        });
        register({
            name: `${PREFIX}approve`,
            description: [
                "给某一步的产物打「通过」或取消通过（等价于界面上的验收按钮）。",
                "只有在用户明确说「这步可以」「通过」时才自动调用；用户要求逐步确认时，先贴 openUrl 停下来等回复。",
                "八方向图：module=sprite，id=项目 id，stage=images|videos|frames|sheet，key 可只对某个方位生效（省略即整阶段）。",
                "图片任务：module=image，id=任务 id，index 可只对某一张生效（省略即全任务）。",
                "序列帧：module=sequence，id=任务 id，step=video|frames|sheet（省略即全部三步）。",
                "骨骼动画：module=rig，id=任务 id，stage=parts|layout|rig|atlas（省略即四个阶段全打）；stage=parts 时可再带 part 只对某个部件生效。"
            ].join("\n"),
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    module: { type: "string", enum: [...MODULES], description: "目标所属模块；可省略，按 id 前缀判断。" },
                    id: { type: "string", description: "项目 / 任务 id。" },
                    stage: { type: "string", enum: ["images", "videos", "frames", "sheet"], description: "八方向图：阶段。" },
                    key: { type: "string", description: "八方向图：只对某个方位生效（front/back/…）。" },
                    index: { type: "integer", description: "图片任务：只对某一张生效。" },
                    step: { type: "string", enum: ["video", "frames", "sheet"], description: "序列帧：只对某一步生效。" },
                    part: { type: "string", description: "骨骼动画：stage=parts 时只对某个部件生效。" },
                    approved: { type: "boolean", description: "true = 通过，false = 取消通过。" }
                },
                required: ["id", "approved"]
            },
            output: { schema: OBJECT_SCHEMA, render: (_args, value) => textBlocks(renderApprove(value)) },
            async execute(args) {
                const id = asString(args?.id);
                if (id === "")
                    throw new Error("id 不能为空");
                if (typeof args?.approved !== "boolean")
                    throw new Error("approved 必须是布尔值");
                const module = resolveTarget(args?.module, id);
                const approved = args.approved === true;
                if (module === "sprite") {
                    const stage = asString(args?.stage, "images");
                    if (!["images", "videos", "frames", "sheet"].includes(stage))
                        throw new Error(`未知阶段：${stage}`);
                    const key = asString(args?.key) || undefined;
                    if (key !== undefined && directionOf(key) === undefined)
                        throw new Error(`未知方位：${key}`);
                    await gateway.setApproved({ projectId: id, stage, key, approved });
                    return { module, id, stage, key: key ?? null, approved, ...openInfo({ module, projectId: id, stage }, "点开看验收结果") };
                }
                if (module === "image") {
                    const job = await readImageJob(id);
                    if (job === undefined)
                        throw new Error(`找不到图片任务：${id}`);
                    const index = args?.index === undefined ? undefined : clampInt(args.index, 0, 0, 99);
                    const targets = (job.items ?? []).filter((item) => index === undefined || item.index === index);
                    if (targets.length === 0)
                        throw new Error(index === undefined ? "这个任务还没有产物" : `没有第 ${index} 张`);
                    // 走 saveImageJob 而不是直接写文件：生图模型是全局设置，保存时由宿主对齐当前模型。
                    await gateway.saveImageJob(index === undefined ? { jobId: id, approved } : { jobId: id, approved, index });
                    return { module, id, index: index ?? null, approved, count: targets.length, ...openInfo({ module: "image", jobId: id }, "点开看验收结果") };
                }
                if (module === "sequence") {
                    const job = await readSequenceJob(id);
                    if (job === undefined)
                        throw new Error(`找不到序列帧任务：${id}`);
                    const step = asString(args?.step) || undefined;
                    if (step !== undefined && !["video", "frames", "sheet"].includes(step))
                        throw new Error(`未知步骤：${step}`);
                    await gateway.saveSequenceJob(step === undefined ? { jobId: id, approved } : { jobId: id, approved, step });
                    return { module, id, step: step ?? null, approved, ...openInfo({ module: "sequence", jobId: id }, "点开看验收结果") };
                }
                const rigJob = await readRigJob(id);
                if (rigJob === undefined)
                    throw new Error(`找不到骨骼动画任务：${id}`);
                const rigStage = asString(args?.stage) || undefined;
                if (rigStage !== undefined && !["parts", "layout", "rig", "atlas"].includes(rigStage))
                    throw new Error(`未知阶段：${rigStage}`);
                const part = asString(args?.part) || undefined;
                await gateway.saveRigJob(rigStage === "parts" && part !== undefined ? { jobId: id, approved, stage: "parts", part } : rigStage === undefined ? { jobId: id, approved } : { jobId: id, approved, stage: rigStage });
                return { module, id, stage: rigStage ?? null, part: part ?? null, approved, ...openInfo({ module: "rig", jobId: id, stage: rigStage }, "点开看验收结果") };
            }
        });
    }
    const systemPrompt = host.systemPrompt;
    if (systemPrompt !== undefined) {
        disposers.push(systemPrompt.section({
            name: "game-material-master",
            order: 8600,
            text: PROMPT_SECTION
        }));
    }
    return disposers;
}
const PROMPT_SECTION = [
    "## 游戏素材大师（game-material-master）",
    "本机已挂载「游戏素材大师」插件：八方向图生成 / 图片生成 / 序列帧生成 / 骨骼动画生成四个模块，界面在侧栏「游戏素材大师」面板。",
    "工具：`game_material_intake`（固定流程第 0 步）、`game_material_call`（万能通道，插件全部方法）、`game_material_upload`（按路径上传素材）、",
    "`game_material_reviewMode`、`game_material_status`、`game_material_wait`、`game_material_review`、`game_material_approve`。",
    "一律走这些工具，不要用 bash/shell 直接改 `<DSH_HOME>/game-material-master/` 下的 JSON——那会绕过宿主的复用与校验。",
    "",
    "### 固定流程（必须按这个顺序走）",
    "第 0 步 · 先问，再动手：用户一说要用某个功能，**先调用 `game_material_intake`**，把它返回的 `questions` 逐条问清楚，",
    "并且**必须问同一个问题**：「结果要自动审核，还是每一步人工审核？」——两者合并成一次提问，不要挤牙膏式地一问一停。",
    "在关键参数与审核模式都拿到答复之前，**不要调用任何生成类 / 删除类方法**。",
    "用户已经明确告知过的参数不必重复问；答复用 `game_material_call` 写进目标，审核模式用 `game_material_reviewMode` 记下来。",
    "第 1 步 · 逐阶段推进：八方向图是 images → videos → frames → sheet；图片生成是 prompt → runImageJob → keyImageJob；",
    "序列帧是 video → frames → sheet；骨骼动画是 parts → layout → rig → atlas。每次提交类调用之后**立刻** `game_material_wait`。",
    "骨骼动画只有第 ① 步（runRigSheet）花钱，②③④ 都是本地计算，重跑不额外计费；装配失败时用 runRigLayout({jobId, names:[…]}) 只重跑那几个部件。",
    "",
    "### 骨骼动画的自动摆位不准时：给「视觉先验」（重要）",
    "第 ② 步的自动定位是**纯几何匹配**，对「模型重画过的部件」（裙摆、袖子这类服装裁片）会失手：",
    "它在错误位置也可能拿到不低的分数。这时**你（agent）就是那个视觉模型**，去做一次语义对应：",
    "  1. read_image 看 `getRigJob` 返回的 `sourcePath`（角色参考图）与 `partsMontagePath`（全部部件的蒙太奇图，",
    "     按 `partsOrder` 的先后从左上到右下排列，每格一个部件，带格线可以数格子）；",
    "  2. 逐个判断「这块部件在参考图的哪个位置」，给出**大致**的像素框（不需要精确，区域对就行）；",
    "  3. game_material_call({method:'setRigLayoutHints', payload:{jobId, hints:{部件名:{x,y,width,height}}}})",
    "     然后 runRigLayout({jobId}) 重新装配。",
    "实测效果：一张真实立绘从「头被摆到脚下面、16 个部件只有 3 个落在正确区域」变成「结构正确、13/16 落在指定区域」。",
    "先验框给大一点没关系（搜索区域会自动向外放宽 35%），但**别给错区域**——给错了它就会老老实实往错的地方搜。",
    "",
    "### 骨骼动画的三层修改：语义 / 骨骼偏移 / 动画参数（都是本地免费，且互不覆盖）",
    "这三层是**分开存的**，所以你重跑任何一步都不会抹掉另一层的人工改动。优先用它们，",
    "而不是让用户重新生成整条链路：",
    "  1. **语义** `setRigSemantics({jobId, parts:[{name, role?, parent?, proximal?, distal?, tags?}]})`",
    "     —— 决定「这块是什么、挂在谁身上、骨骼从部件的哪一端伸到哪一端」。",
    "     `getRigJob` 返回的 `parts[].role/parent/proximal/distal` 是当前值，顶层 `semantics` 是校验结果",
    "     （`errors` 非空时写入会被拒绝并原样返回原因，据此修正后重试即可）。",
    "     **改语义只作废③骨骼与④图集，②里已经摆好的位置不受影响。**",
    "  2. **骨骼偏移** `setRigBoneOffsets({jobId, bones:[{name, x?, y?, rotation?}]})`",
    "     —— 手工微调某根骨头（位移单位是参考图像素，旋转是度）。它与「重新推骨骼」互不覆盖，",
    "     是「AI 重新想一遍、人调过的不丢」的保证；`resetRigBoneOffsets({jobId, names?})` 回到自动推的姿势。",
    "  3. **动画参数** `setRigAnimationSettings({jobId, animations:[{id, duration?, amplitude?}]})`",
    "     —— `amplitude` 统一缩放旋转与位移（动作太大/再夸张一点），`duration` 改循环秒数。",
    "     改完要 `runRigBones({jobId})` 重算。哪些动作会生成由 `saveRigJob` 的 `settings.animations` 决定。",
    "  ★ 判断依据：先 `getRigJob` 看 `rig.warnings`（几何推导的告警）、`semantics.errors/warnings`（结构问题）、",
    "  `atlas.warnings`。**构建失败时先读 `stage.error`**——导出前校验（Spine 4.2 四条地雷、循环接缝、",
    "  图集越界/缺区域）不通过会直接让那一步失败，并把具体原因写在 error 里。",
    "第 2 步 · 每步都要审：`game_material_review` 拿验收包，逐项看 status / error / 绝对 URL。",
    "第 3 步 · 按审核模式分岔：`auto` → 自己判断没问题就 `game_material_approve` 打通过并进入下一步；",
    "`manual` → 贴出 openUrl 并**停下等用户回复**，只有用户明确说「通过 / 可以」才 `game_material_approve` 并继续。",
    "失败只重跑失败的那一项（`runImage` / `runVideos({regenerate:true, keys:[…]})` / `runFrames({keys:[…]})`），不要整批重来。",
    "",
    "### 验收链接",
    "`game_material_intake` / `status` / `wait` / `review` / `upload` 等返回的 `openUrl` 是给用户点的深链接。",
    "输出时必须原样写成 Markdown 链接（例如 `[查看第 2 步验收](http://…/?dsh-gmm=1&module=sprite&project=…&stage=videos)`）；",
    "用户点击后界面会原地切到插件对应页面。不要改写成裸文本，也不要自己编 URL。",
    "`manual` 模式下每完成一步都要贴一次；`auto` 模式下至少在全部完成或需要用户决策时贴。",
    "",
    "### 计费与重复提交",
    "生图与生视频都真实计费：不要为了确认状态而重复提交同一个目标；提交类调用返回后一律先 `game_material_wait`。"
].join("\n");
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(new Error("已取消"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener?.("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("已取消"));
        };
        signal?.addEventListener?.("abort", onAbort, { once: true });
    });
}
// ── 固定流程第 0 步：问清楚再动手 ────────────────────────────────────────
//
// 用户只说「用八方向图做个角色」的时候，缺的信息其实很多：源图、统一附加
// 提示词、要不要改默认参数、以及最关键的一条——**结果谁来审核**。
// 这些一律由 `game_material_intake` 按真实状态算出来，而不是让模型凭感觉问：
// 已经配好的 / 有默认值的进 `known`，真正缺的进 `questions`，
// 必须先解决的进 `blockers`。这样「问了什么」是可复现、可测的。
const REVIEW_MODE_QUESTION = {
    id: "reviewMode",
    question: "结果要「自动审核」还是「每一步人工审核」？",
    options: [
        { value: "auto", label: "自动审核", detail: "agent 自己检查每步产出与报错，直接往下推进；只在失败或全部完成时才找你" },
        { value: "manual", label: "每一步人工审核", detail: "每步产出后 agent 把验收链接贴给你，你说「通过」它才进入下一步" }
    ],
    how: "用户答复后用 game_material_reviewMode 记下来（module + id + reviewMode）。"
};
function intakeFor(module, id, told, config, target) {
    const reviewModeQuestion = REVIEW_MODE_QUESTION;
    const blockers = [];
    const questions = [];
    const known = {};
    /** 已经存在的事实（源图 / 提示词 / 素材）就不再问，直接列进 known。 */
    const hasSource = target !== undefined && target.sourceFile !== null && target.sourceFile !== undefined;
    const hasPrompt = target !== undefined && typeof target.prompt === "string" && target.prompt.trim() !== "";
    const ask = (key, question, why, how) => {
        if (told.has(key))
            return;
        questions.push({ key, question, why, how });
    };
    if (module === "sprite" || module === "image" || module === "rig") {
        if (config?.arkApiKeySet !== true) {
            blockers.push("还没配置火山方舟 API Key（生图必需）：设置 → 游戏素材大师 → 火山方舟 API Key，配好点「测试连接」。");
        }
        known.生图模型 = config?.arkModel;
        known.出图尺寸 = config?.arkSize;
    }
    if (module === "sequence") {
        if (config?.minimaxApiKeySet !== true) {
            blockers.push("还没配置 MiniMax API Key（生视频必需）：设置 → 游戏素材大师 → MiniMax API Key，配好点「测试连接」。");
        }
        known.视频模型 = config?.minimaxModel;
        known.BaseURL = config?.minimaxBaseUrl;
    }
    if (module === "sprite") {
        known.默认单格尺寸 = `${config?.cellWidth ?? "?"}×${config?.cellHeight ?? "?"}`;
        known.默认每段抽帧数 = config?.frameCount;
        known.默认像素块 = config?.pixelSize;
        known.默认行序 = config?.rowOrder;
        known.四个阶段 = "① 八方向绿幕图 → ② 行走动作视频 → ③ 提取序列帧 → ④ 抠绿幕合成整图";
    }
    if (module === "image") {
        known.默认张数范围 = "1~8（Seedream 约 0.2 元/张）";
        known.参考图上限 = "10 张，可在提示词里写「图一」「图二」";
    }
    if (module === "sequence") {
        known.两种输入模式 = "首尾帧模式（必须给首帧图）/ 多模态参考模式（参考图 ≤9 张 + 参考视频 ≤3 段），平台规定互斥";
        known.分辨率与时长档位 = config?.minimaxCapabilities;
    }
    if (module === "rig") {
        known.四个阶段 = "① 拆件 → ② 装配定位 → ③ 骨骼与动画 → ④ 图集";
        known.只有第一步花钱 = "① 拆件是一次 Seedream 生图（约 0.2 元）；②③④ 都是本地计算，重跑不额外花钱";
        known.默认拆件网格 = `${config ? "" : ""}4 列 × 4 行 = 16 个标准人形部件（头/脖子/躯干/胯/上臂/小臂/手/大腿/小腿/脚），格子位置即部件身份`;
        known.默认动画 = "idle 待机 / walk 行走 / run 奔跑 / wave 挥手 / jump 跳跃 / attack 攻击";
    }
    if (id === "") {
        questions.push({
            key: "target",
            question: module === "sprite"
                ? "新建一个项目，还是在已有项目上继续？"
                : module === "image"
                    ? "新建一个图片任务，还是在已有任务上继续？"
                    : module === "sequence"
                        ? "新建一个序列帧任务，还是在已有任务上继续？"
                        : "新建一个骨骼动画任务，还是在已有任务上继续？",
            why: "后面的参数都挂在项目 / 任务上。",
            how: "新建：game_material_call({method:'createProject'|'createImageJob'|'createSequenceJob'|'createRigJob', payload:{name}})，返回的 id 就是后续 payload 里的 projectId / jobId。"
        });
    }
    if (module === "sprite") {
        if (hasSource)
            known.源图 = target.sourceFile;
        else {
            ask("source", "用哪张角色设定图作为源图？（PNG / JPG，≤30MB）", "八方向图从这一张出发派生其余七个方位，没有它无法开始。", "给我文件路径后我用 game_material_upload({module:'sprite', id, kind:'source', path}) 上传。");
        }
        if (target?.reviewMode)
            known.审核模式 = target.reviewMode;
        ask("suffix", "有没有跨方向都要遵守的统一要求？（例如「必须穿同一双靴子」「不要出现文字」；可留空）", "会追加到每一张生图提示词末尾，改一次八个方向全生效。", "用 game_material_call 的 savePrompts({projectId, suffix}) 保存。");
        ask("scope", "八个方向全做，还是只做指定方向？", "只做部分方向能明显省钱省时间。", "开始生成时 runImage({projectId,key}) 做单个方向，runImages({projectId}) 做全部。");
        ask("tuning", "默认参数要改吗？（单格尺寸 / 每段抽帧数 / 像素块大小 / 行序 / 并发数；不改就用默认）", "这些决定了最终精灵图的规格。", "要改就用 saveSettings({projectId, settings})。");
        ask("prompts", "每个方向的生图/视频提示词要用默认模板，还是你自己写？（默认模板已经把方位与可见部位写对了，建议先用默认）", "方位写错会导致八个方向看起来是抬头 / 低头而不是转身。", "要改就用 savePrompts。");
    }
    if (module === "image") {
        if (hasPrompt)
            known.提示词 = target.prompt;
        else
            ask("prompt", "想要什么画面？请给一句具体的中文提示词。", "生图的唯一必填项。", "saveImageJob({jobId, prompt}) 后 runImageJob({jobId, count})。");
        ask("count", "生成几张？（1~8，默认 1）", "按张计费。", "runImageJob({jobId, count})。");
        ask("refs", "要不要参考图？需要的话给我文件路径（最多 10 张）。", "带参考图时可以在提示词里写「图一」「图二」。", "game_material_upload({module:'image', id, kind:'ref', path})。");
        ask("keying", "生成后要不要自动抠绿幕导出透明 PNG？", "抠像是本地做的、不额外收费。", "saveImageJob({jobId, keying:{enabled:true}}) 再 keyImageJob({jobId})。");
    }
    if (module === "rig") {
        if (hasSource)
            known.角色参考图 = target.sourceFile;
        else {
            ask("source", "用哪张**角色整图**作为参考？（PNG / JPG，≤30MB；要能看清全身）", "拆件、装配、骨骼全都以它为基准。", "给我文件路径后我用 game_material_upload({module:'rig', id, kind:'source', path}) 上传。");
        }
        ask("partsSource", "部件从哪来：让生图模型自动拆件（默认，一次约 0.2 元），还是你自己已经有分好的部件 PNG？", "已经有部件图的话可以跳过生图，直接用 uploadRigPart 逐张传（部件名就是文件名，例如 head.png / torso.png / left-upper-leg.png）。", "自动拆件：runRigSheet({jobId})；手工上传：game_material_upload({module:'rig', id, kind:'part', path})。");
        ask("animations", "要生成哪些动画？（默认全做：待机/行走/奔跑/挥手/跳跃/攻击）", "动画是本地查表生成的，多做几个不额外花钱。", "saveRigJob({jobId, settings:{animations:[...]}})。");
        if (target?.reviewMode)
            known.审核模式 = target.reviewMode;
    }
    if (module === "sequence") {
        ask("mode", "用「首尾帧模式」还是「多模态参考模式」？（平台规定只能二选一）", "两种模式的素材要求完全不同。", "saveSequenceJob({jobId, mode:'frames'|'reference'})。");
        if (target !== undefined && (target.refs?.firstFrame !== null || target.refs?.referenceImages > 0 || target.refs?.referenceVideos > 0)) {
            known.已上传素材 = target.refs;
        }
        else {
            ask("material", "对应模式要用的素材：首尾帧模式给首帧图（尾帧可选）；参考模式给参考图（≤9 张）和/或参考视频（≤3 段，每段 2~15 秒）。", "没有素材无法提交。", "game_material_upload({module:'sequence', id, kind:'firstFrame'|'lastFrame'|'referenceImage'|'referenceVideo', path})。");
        }
        if (hasPrompt)
            known.提示词 = target.prompt;
        else
            ask("prompt", "希望这段动作是什么样的？请给一句提示词。", "视频生成的必填项。", "saveSequenceJob({jobId, prompt})。");
        ask("duration", "时长和分辨率用当前模型档位里的哪个？（不改就用默认）", "不同模型支持的档位不同。", "saveSequenceJob({jobId, settings:{duration, resolution}})。");
        ask("frames", "抽几帧、单格多大？（默认按全局配置）", "决定最终横向条图的规模。", "saveSequenceJob({jobId, settings:{frameCount, cellWidth, cellHeight}})。");
    }
    return {
        module,
        id: id === "" ? null : id,
        blockers,
        questions,
        reviewModeQuestion,
        known,
        nextStep: blockers.length > 0
            ? "先把 blockers 告诉用户并等它处理；同时把 questions 与 reviewModeQuestion 一起问掉，别分多轮挤牙膏。"
            : "把 questions 与 reviewModeQuestion 合并成一次提问（能一次问完就别拆开），等用户答复后再动手。",
        afterAnswered: "用户答复后：game_material_reviewMode 记审核模式 → game_material_call 写参数 → 开始生成 → game_material_wait。"
    };
}
// ── 上传：宿主自己读盘，模型只给路径 ────────────────────────────────────
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
/** 各模块允许的 kind，避免把「源图」传到「参考视频」这类错位。 */
const UPLOAD_KINDS = {
    sprite: ["source"],
    image: ["ref", "item"],
    sequence: ["firstFrame", "lastFrame", "referenceImage", "referenceVideo"],
    rig: ["source", "part"]
};
async function uploadFromPath(gateway, module, id, kind, path, name) {
    if (id === "")
        throw new Error("id 不能为空");
    if (!UPLOAD_KINDS[module].includes(kind)) {
        throw new Error(`${module} 不支持 kind=${kind}（可用：${UPLOAD_KINDS[module].join(" / ")}）`);
    }
    const absolute = resolve(path);
    let info;
    try {
        info = await stat(absolute);
    }
    catch {
        throw new Error(`读不到文件：${absolute}`);
    }
    if (!info.isFile())
        throw new Error(`不是文件：${absolute}`);
    const isVideo = kind === "referenceVideo";
    const limit = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (info.size > limit) {
        throw new Error(`文件 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过上限 ${(limit / 1024 / 1024).toFixed(0)}MB：${absolute}`);
    }
    const bytes = await readFile(absolute);
    const base64 = bytes.toString("base64");
    const fileName = name ?? basename(absolute);
    if (!isVideo && sniffImage(base64) === undefined) {
        throw new Error(`无法识别的图片格式（支持 PNG / JPEG / WebP / GIF / BMP）：${absolute}`);
    }
    const call = gateway;
    if (module === "sprite") {
        await call.uploadSource({ projectId: id, name: fileName, data: base64 });
    }
    else if (module === "image") {
        if (kind === "ref")
            await call.uploadImageRef({ jobId: id, name: fileName, data: base64 });
        else
            await call.addImageItem({ jobId: id, name: fileName, data: base64 });
    }
    else if (module === "rig") {
        if (kind === "part")
            await call.uploadRigPart({ jobId: id, name: fileName, data: base64 });
        else
            await call.uploadRigSource({ jobId: id, name: fileName, data: base64 });
    }
    else {
        await call.uploadSequenceRef({ jobId: id, kind, name: fileName, data: base64 });
    }
    return {
        module,
        id,
        kind,
        name: fileName,
        path: absolute,
        bytes: info.size,
        ...openInfo(module === "sprite" ? { module, projectId: id } : { module, jobId: id }, "点开确认素材已就位")
    };
}
function renderIntake(value) {
    const lines = [`【固定流程第 0 步】${value.module}${value.id === null ? "（新目标）" : ` · ${value.id}`}`];
    if (value.blockers.length > 0) {
        lines.push("必须先解决：");
        for (const blocker of value.blockers)
            lines.push(`  ✗ ${blocker}`);
    }
    lines.push("要问用户的参数：");
    if (value.questions.length === 0)
        lines.push("  （没有遗漏——用户已经说清了，可以直接动手）");
    for (const question of value.questions) {
        lines.push(`  ? [${question.key}] ${question.question}`);
        lines.push(`      ${question.why}`);
    }
    lines.push(`必须问：${value.reviewModeQuestion.question}`);
    for (const option of value.reviewModeQuestion.options)
        lines.push(`  - ${option.label}：${option.detail}`);
    const knownKeys = Object.keys(value.known ?? {});
    if (knownKeys.length > 0) {
        lines.push("已知 / 有默认值（不必问，除非用户主动要改）：");
        for (const key of knownKeys) {
            const entry = value.known[key];
            lines.push(`  · ${key}：${typeof entry === "object" ? JSON.stringify(entry) : entry}`);
        }
    }
    lines.push(value.nextStep);
    lines.push(value.afterAnswered);
    return lines.join("\n");
}
function renderUpload(value) {
    const tail = typeof value.openUrl === "string" ? `\n打开界面：[${value.openHint}](${value.openUrl})` : "";
    return `已上传 ${value.name}（${(value.bytes / 1024).toFixed(0)} KB）→ ${value.module} · ${value.id} · ${value.kind}${tail}`;
}
function renderReviewMode(value) {
    const tail = typeof value.openUrl === "string" ? `\n打开界面：[${value.openHint}](${value.openUrl})` : "";
    return `${value.id} 的审核模式已记为「${value.reviewMode === "manual" ? "每一步人工审核" : "自动审核"}」。${value.reviewMode === "manual" ? "之后每一步产出后都要贴验收链接并停下等用户说通过。" : "之后 agent 自己审完即可继续。"}${tail}`;
}
// ── 工具结果的文字渲染 ──────────────────────────────────────────────────
// 模型看到的是这段文本；链接与关键计数必须一眼可见。
function renderCallResult(value) {
    const head = `${value.method} → ok`;
    const body = JSON.stringify(value.value, null, 2);
    const clipped = body.length > 4000 ? `${body.slice(0, 4000)}\n…（已截断）` : body;
    const link = typeof value.openUrl === "string" ? `\n打开界面：[${value.openHint}](${value.openUrl})` : "";
    return `${head}\n${clipped}${link}`;
}
/**
 * 阶段一行文字。八方向图 / 图片 / 序列帧的阶段带 ready/total/running，
 * 骨骼动画的阶段只有 status——按同一套字段渲染，骨骼动画会印出一串 undefined。
 */
function renderStageLine(stage) {
    const tail = `${stage.approved === true ? " · 已通过" : ""}${stage.stale ? " · 需重做" : ""}${stage.error ? ` · ${stage.error}` : ""}`;
    if (typeof stage.ready === "number" || typeof stage.total === "number") {
        return `${stage.title}：ready ${stage.ready ?? 0}/${stage.total ?? 0}，running ${stage.running ?? 0}，error ${stage.error ?? "-"}，已通过 ${stage.approved === true}`;
    }
    return `${stage.title}：${stage.status ?? "-"}${tail}`;
}
/** 骨骼动画阶段没有「格子」，产物是每阶段固定的几个 URL。 */
function renderRigStageDetail(stage) {
    const lines = [];
    const push = (label, value) => {
        if (typeof value === "string" && value.length > 0)
            lines.push(`      ${label}：${value}`);
    };
    if (stage.stage === "parts") {
        push("拆件图", stage.url);
        if (typeof stage.partReady === "number")
            lines.push(`      可用部件：${stage.partReady}`);
    }
    else if (stage.stage === "layout") {
        push("合成图", stage.composite);
        push("并排对比图", stage.comparison);
        if (Array.isArray(stage.unmatched) && stage.unmatched.length > 0) {
            lines.push(`      没匹配上（要手工摆或给先验）：${stage.unmatched.join("、")}`);
        }
    }
    else if (stage.stage === "rig") {
        push("骨架 JSON", stage.skeleton);
        push("预览页（双击可播动画）", stage.preview);
        if (Array.isArray(stage.animations) && stage.animations.length > 0)
            lines.push(`      动画：${stage.animations.join("、")}`);
        for (const warning of stage.warnings ?? [])
            lines.push(`      ⚠ ${warning}`);
    }
    else if (stage.stage === "atlas") {
        push("图集 PNG", stage.image);
        push("图集文本", stage.text);
        if (typeof stage.width === "number" && typeof stage.height === "number")
            lines.push(`      尺寸：${stage.width}×${stage.height}`);
    }
    return lines;
}
function renderStatus(value) {
    if (Array.isArray(value.projects)) {
        const lines = [
            `项目（${value.projects.length}）：`,
            ...value.projects.map((p) => `  - ${p.id} ${p.name} — 图 ${p.imageReady}/8 · 视频 ${p.videoReady}/8 · 帧 ${p.framesReady}/8${p.sheetReady ? " · 整图✓" : ""}`),
            `图片任务（${value.imageJobs.length}）：`,
            ...value.imageJobs.map((j) => `  - ${j.id} ${j.name} — ${j.ready}/${j.total} 张（抠像 ${j.keyed}）`),
            `序列帧任务（${value.sequenceJobs.length}）：`,
            ...value.sequenceJobs.map((j) => `  - ${j.id} ${j.name} — 视频${j.videoReady ? "✓" : "✗"} 帧${j.frameReady ? "✓" : "✗"} 条图${j.sheetReady ? "✓" : "✗"}`),
            value.hint
        ];
        return lines.join("\n");
    }
    const lines = [`${value.name}（${value.id}）${value.busy ? " — ⏳ 有任务在跑" : ""}`];
    if (Array.isArray(value.stages)) {
        for (const stage of value.stages) {
            lines.push(`  ${renderStageLine(stage)}`);
            // 骨骼动画：阶段名之后直接把产物 URL 贴上，否则用户点不到东西。
            for (const detail of renderRigStageDetail(stage))
                lines.push(detail);
        }
    }
    if (Array.isArray(value.parts)) {
        const ready = value.parts.filter((part) => part.status === "ready").length;
        const placed = value.parts.filter((part) => part.placed).length;
        lines.push(`  部件 ${ready} 件可用，已放置 ${placed}`);
        const unmatched = value.parts.filter((part) => part.status === "ready" && !part.placed).map((part) => part.name);
        if (unmatched.length > 0)
            lines.push(`  没定位到的：${unmatched.join("、")}`);
    }
    if (Array.isArray(value.items))
        lines.push(`  图片 ${value.review?.ready ?? "?"} 张就绪，已通过 ${value.review?.approved ?? "?"}，失败 ${value.review?.error ?? "?"}`);
    if (Array.isArray(value.steps)) {
        for (const step of value.steps)
            lines.push(`  ${step.title}：${step.status}${step.approved ? " · 已通过" : ""}${step.error ? ` · ${step.error}` : ""}`);
    }
    if (typeof value.openUrl === "string")
        lines.push(`打开界面：[${value.openHint}](${value.openUrl})`);
    return lines.join("\n");
}
function renderWait(value) {
    const head = value.settled ? `已跑完（${(value.elapsedMs / 1000).toFixed(1)}s）` : `仍在跑（等待 ${(value.elapsedMs / 1000).toFixed(1)}s 后超时）`;
    return `${head}\n${renderStatus(value)}`;
}
function renderReview(value) {
    const lines = [`${value.name}（${value.id}）验收包${value.busy ? " — ⏳ 仍有任务在跑" : ""}`];
    if (Array.isArray(value.stages)) {
        for (const stage of value.stages) {
            lines.push(`${stage.title}${stage.stale ? " · 需重做" : ""}`);
            // 骨骼动画的阶段**没有 cells**（产物是每阶段固定的几个 URL），
            // 一律按 cells 迭代会直接把整个工具调用炸掉（stage.cells is not iterable）。
            for (const detail of renderRigStageDetail(stage))
                lines.push(detail);
            for (const cell of stage.cells ?? []) {
                lines.push(`  - ${cell.label}：${cell.status}${cell.approved ? " · 已通过" : ""}${cell.stale ? " · 需重做" : ""}${cell.error ? ` · ${cell.error}` : ""}`);
                if (typeof cell.url === "string")
                    lines.push(`      ${cell.url}`);
            }
        }
    }
    if (Array.isArray(value.items)) {
        for (const item of value.items) {
            lines.push(`  - 第 ${item.index} 张：${item.status}${item.approved ? " · 已通过" : ""}${item.error ? ` · ${item.error}` : ""}`);
            if (typeof item.url === "string")
                lines.push(`      ${item.url}`);
            if (typeof item.keyedUrl === "string")
                lines.push(`      ${item.keyedUrl}（透明 PNG）`);
        }
    }
    if (Array.isArray(value.steps)) {
        for (const step of value.steps) {
            lines.push(`  - ${step.title}：${step.status}${step.approved ? " · 已通过" : ""}${step.stale ? " · 需重做" : ""}${step.error ? ` · ${step.error}` : ""}`);
            if (typeof step.url === "string")
                lines.push(`      ${step.url}`);
            for (const url of step.keyed ?? [])
                lines.push(`      ${url}`);
        }
    }
    if (Array.isArray(value.parts)) {
        for (const part of value.parts) {
            lines.push(`  - ${part.label ?? part.name}：${part.status}${part.approved ? " · 已通过" : ""}${part.placed ? " · 已定位" : " · 未定位"}${part.hidden ? " · 已隐藏" : ""}${typeof part.score === "number" ? ` · 相似度 ${part.score}` : ""}${part.error ? ` · ${part.error}` : ""}`);
            if (typeof part.url === "string")
                lines.push(`      ${part.url}`);
        }
    }
    for (const action of value.nextActions ?? [])
        lines.push(`建议：${action}`);
    if (typeof value.openUrl === "string")
        lines.push(`打开界面验收：[${value.openHint}](${value.openUrl})`);
    return lines.join("\n");
}
function renderApprove(value) {
    const where = [value.stage, value.step, value.key, value.index === null || value.index === undefined ? undefined : `第 ${value.index} 张`]
        .filter((part) => part !== undefined && part !== null)
        .join(" / ");
    const tail = typeof value.openUrl === "string" ? `\n打开界面：[${value.openHint}](${value.openUrl})` : "";
    return `${value.id}${where === "" ? "" : ` · ${where}`} → ${value.approved ? "已标记通过" : "已取消通过"}${tail}`;
}
// ── 「下一步该做什么」的推荐 ────────────────────────────────────────────
function spriteNextActions(snapshot, stage, direction) {
    const byStage = Object.fromEntries(snapshot.stages.map((entry) => [entry.stage, entry]));
    const actions = [];
    const pick = (key) => (stage === undefined || stage === key ? byStage[key] : undefined);
    const images = pick("images");
    if (images !== undefined && images.ready < images.total) {
        actions.push(snapshot.sourceFile === null
            ? "还没有源图：先用 game_material_call({method:'uploadSource', payload:{projectId,name,data}}) 上传一张设定图"
            : `绿幕图还差 ${images.total - images.ready} 张：game_material_call({method:'runImages', payload:{projectId}}) 然后 game_material_wait`);
    }
    const videos = pick("videos");
    if (videos !== undefined && videos.ready < videos.total && (images === undefined || images.ready === images.total)) {
        actions.push(`视频还差 ${videos.total - videos.ready} 段：game_material_call({method:'runVideos', payload:{projectId}}) 然后 game_material_wait（这一步最贵，约几分钟）`);
    }
    const frames = pick("frames");
    if (frames !== undefined && frames.ready < frames.total && (videos === undefined || videos.ready === videos.total)) {
        actions.push("序列帧还没抽完：game_material_call({method:'runFrames', payload:{projectId}}) 然后 game_material_wait");
    }
    const sheet = pick("sheet");
    if (sheet !== undefined && sheet.ready < sheet.total && (frames === undefined || frames.ready === frames.total)) {
        actions.push("整图还没合成：game_material_call({method:'compose', payload:{projectId}}) 然后 game_material_wait");
    }
    const stageEntry = byStage[stage ?? ""];
    if (stageEntry !== undefined && stageEntry.error > 0) {
        actions.push(`有 ${stageEntry.error} 个产物失败：先看返回里的 error，再对失败项用 runImage / runVideos({regenerate:true, keys:[…]}) / runFrames({keys:[…]}) 重跑`);
    }
    if (direction !== undefined)
        actions.push(`只看方位 ${direction} 的重跑：game_material_call({method:'runVideos', payload:{projectId, keys:['${direction}'], regenerate:true}})`);
    if (actions.length === 0)
        actions.push("这一步已全部就绪：可以 game_material_approve 打通过，或进入下一阶段");
    return actions;
}
function imageNextActions(snapshot) {
    const actions = [];
    if (snapshot.review.ready === 0 && snapshot.review.error === 0) {
        actions.push("还没有产物：确认 prompt 非空后 game_material_call({method:'runImageJob', payload:{jobId,count}}) 然后 game_material_wait");
    }
    if (snapshot.review.error > 0)
        actions.push(`有 ${snapshot.review.error} 张失败：看 error 后调整提示词或参考图再重跑`);
    if (snapshot.keying?.enabled !== true)
        actions.push("还没开抠像：saveImageJob({jobId, keying:{enabled:true}}) 再 keyImageJob({jobId})");
    if (snapshot.review.approved === snapshot.review.ready && snapshot.review.ready > 0)
        actions.push("全部已通过：可以 game_material_call({method:'revealProject'|'getImageJob'}) 取用产物");
    return actions;
}
function rigNextActions(snapshot, stage) {
    const byStage = Object.fromEntries(snapshot.stages.map((entry) => [entry.stage, entry]));
    const actions = [];
    const pick = (key) => (stage === undefined || stage === key ? byStage[key] : undefined);
    const parts = pick("parts");
    if (parts !== undefined && parts.status !== "ready") {
        actions.push(snapshot.sourceFile === null
            ? "还没有角色参考图：先用 game_material_upload({module:'rig', id, kind:'source', path}) 上传一张全身整图"
            : "拆件还没做：game_material_call({method:'runRigSheet', payload:{jobId}})，随后立刻 game_material_wait（这一步花钱，只跑一次）");
    }
    const layout = pick("layout");
    if (layout !== undefined && parts?.status === "ready" && layout.status !== "ready") {
        actions.push("部件已就绪但还没装配：game_material_call({method:'runRigLayout', payload:{jobId}})，随后 game_material_wait（本地计算，免费）");
    }
    if (layout !== undefined && layout.status === "ready" && Object.keys(layout.hints ?? {}).length === 0) {
        actions.push("如果自动摆位的结果不对（合成图上明显错位），先 read_image 看 getRigJob 返回的 sourcePath 与 partsMontagePath，" +
            "给每个部件一个大致像素框，用 setRigLayoutHints 写回去，再 runRigLayout 重跑一遍——实测这是把真实立绘摆对的关键一步");
    }
    if (layout !== undefined && Array.isArray(layout.unmatched) && layout.unmatched.length > 0) {
        actions.push(`这些部件没匹配上：${layout.unmatched.join("、")}。可以让用户点开 openUrl 手工拖到正确位置，` +
            "也可以只重跑它们：runRigLayout({jobId, names:[…]})");
    }
    const rig = pick("rig");
    if (rig !== undefined && layout?.status === "ready" && rig.status !== "ready") {
        actions.push("装配没问题了：game_material_call({method:'runRigBones', payload:{jobId}}) 生成 skeleton.json 与动画预览（免费）");
    }
    if (rig !== undefined && Array.isArray(rig.warnings) && rig.warnings.length > 0) {
        actions.push(`骨骼构建有告警：${rig.warnings.join("；")}`);
    }
    if (rig !== undefined && rig.status === "ready") {
        // 这三层是「AI 与手工共存」的实际落地：任何一层重跑都不会抹掉另外两层的人工改动。
        const semantics = snapshot.semantics;
        if (semantics !== undefined && semantics.ok !== false && semantics.confirmed !== true && semantics.count > 0) {
            actions.push("语义还没被确认过：`getRigJob` 的 `parts[].role/parent/proximal/distal` 是按名字推断的默认值。" +
                "看一眼 partsMontagePath（蒙太奇图）就能判断有没有推断错的，用 setRigSemantics 改掉那几条——" +
                "改语义只作废骨骼与图集，②里已经摆好的位置不受影响");
        }
        const presets = Array.isArray(rig.animationPresets) ? rig.animationPresets : [];
        const untouched = presets.filter((preset) => preset.duration === preset.defaultDuration && preset.amplitude === 1);
        if (presets.length > 0 && untouched.length === presets.length) {
            actions.push("六个动作目前都是预设原值。如果角色的体型/节奏与预设不合（动作太大、循环太快），" +
                "用 setRigAnimationSettings({jobId, animations:[{id, amplitude, duration}]}) 调，再 runRigBones 重算——" +
                "幅度作用在缩放前的简写上，所以缓动不会被打乱");
        }
        // 导出前校验不通过会让那一步直接失败，原因写在 error 里。
        const broken = [pick("rig"), pick("atlas")].filter((entry) => entry !== undefined && entry.status === "error");
        if (broken.length > 0) {
            actions.push("构建失败多半是**导出前校验**拦下的（Spine 4.2 wire format / 循环接缝 / 图集越界与缺区域）。先读 error 里的具体位置再改，不要盲目重跑");
        }
    }
    const atlas = pick("atlas");
    if (atlas !== undefined && rig?.status === "ready" && atlas.status !== "ready") {
        actions.push("骨骼就绪：game_material_call({method:'runRigAtlas', payload:{jobId}}) 打包纹理图集（免费）");
    }
    const failed = Object.values(byStage).filter((entry) => entry.status === "error");
    if (failed.length > 0)
        actions.push(`有阶段失败（${failed.map((entry) => entry.stage).join("、")}）：看返回里的 error 后只重跑那一步`);
    if (actions.length === 0)
        actions.push("四个阶段都已就绪：可以 game_material_approve 打通过，或把 openUrl 贴给用户验收动画预览");
    return actions;
}
function sequenceNextActions(snapshot) {
    const byStep = Object.fromEntries(snapshot.steps.map((entry) => [entry.step, entry]));
    const actions = [];
    if (byStep.video?.status !== "ready") {
        actions.push("视频还没好：game_material_call({method:'runSequenceVideo', payload:{jobId}}) 然后 game_material_wait（先确认首帧图或参考素材已上传）");
    }
    if (byStep.video?.status === "ready" && byStep.frames?.status !== "ready") {
        actions.push("视频已就绪但还没抽帧：game_material_call({method:'runSequenceFrames', payload:{jobId,count}})");
    }
    if (byStep.frames?.status === "ready" && byStep.sheet?.status !== "ready") {
        actions.push("帧已就绪但条图还没合成：game_material_call({method:'composeSequence', payload:{jobId}})");
    }
    if (byStep.frames?.stale === true)
        actions.push("抽帧参数改过，需要重抽：saveSequenceJob 保存参数后 runSequenceFrames");
    if (actions.length === 0)
        actions.push("三步都已就绪：可以 game_material_approve 打通过，或把 openUrl 贴给用户验收");
    return actions;
}
