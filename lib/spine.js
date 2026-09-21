/**
 * Spine 4.2 骨骼与动画（纯计算层，不碰文件系统）。
 *
 * 这一层是参考项目 [spine-animation-ai](https://github.com/GenielabsOpenSource/spine-animation-ai)
 * 的 `build_spine_json.py` 与 `references/spine-json-spec.md` 的 TypeScript 移植，做了三件事：
 *
 *   ① **从拆件结果自动推导骨骼层级**。参考项目要求调用方（Claude）手工给出
 *      bones / attachments，我们这里由「左侧拆件 + 右上装配定位」的结果直接算出来，
 *      用户在界面上只做验收和微调。
 *   ② **生成 Spine 4.2 wire format**。参考项目花了很长篇幅讲清楚 3.8 时代的
 *      简写（`angle` + 归一化 bezier）和 4.x 的区别，这里原样保留那套转换逻辑，
 *      因为它正是「生成的 JSON 导进 Spine 后一动不动 / 第一帧就消失」的根因。
 *   ③ **动画预设**。idle / walk / run / wave / jump / attack 六个预设按 12 原则
 *      编排（大骨骼幅度大、相关骨骼错开相位形成跟随），同样照搬参考项目。
 *
 * 坐标系约定（与参考项目示例 `examples/sombrero/skeleton.json` 一致）：
 *   - Spine 是 Y 向上，图片是 Y 向下，因此 `worldY = canvasHeight - pixelY`。
 *   - 骨骼 x 以画布水平中心为 0，y 以画布底边为 0。
 *   - 骨骼的 `x` / `y` 是**相对父骨骼原点、并在父骨骼局部坐标系里**的位移
 *     （spine-core 的 `Bone.updateWorldTransform` 会先用父骨骼的旋转去转它）。
 *   - 挂点的 `x` / `y` 是**图片中心相对骨骼原点、在骨骼局部坐标系里**的位移，
 *     `rotation` 是挂点自身的局部旋转。见 `references/spine-json-spec.md` 与
 *     参考项目 demo 渲染器的 `translate(att.x, att.y); drawImage(img, -w/2, -h/2)`。
 */
import { createHash } from "node:crypto";
import { buildRigMesh, buildWaveDeform } from "./rigmesh.js";
import { pathSegmentLengths } from "./rigpath.js";
// ── 拆件槽位定义 ────────────────────────────────────────────────────────
/**
 * 默认拆件网格：4 列 × 4 行 = 16 个标准人形部件，按阅读顺序排列。
 *
 * 之所以规定网格而不是「随便摊开」：生图模型只是把部件画出来，它不会告诉我们
 * 哪一块是头。固定网格让「第几个格子 = 哪个部件」成为确定事实，
 * 这样分割出来的每一块天然带语义名，骨骼层级和动画预设才能自动套上去。
 */
export const RIG_GRID_COLUMNS = 4;
export const RIG_GRID_ROWS = 4;
const P_TOP = [0.5, 0];
const P_BOTTOM = [0.5, 1];
/** 逐个写清楚，是因为层级、锚点和中文名三者互相耦合，用表驱动最容易核对。 */
export const RIG_SLOTS = [
    { name: "head", label: "头部", en: "head (face, hair and headwear)", parent: "neck", proximal: P_BOTTOM, distal: P_TOP },
    { name: "neck", label: "脖子", en: "neck", parent: "torso", proximal: P_BOTTOM, distal: P_TOP },
    { name: "torso", label: "躯干", en: "torso (chest and waist, with the upper garment)", parent: "hip", proximal: P_BOTTOM, distal: P_TOP },
    { name: "hip", label: "胯部", en: "hip / pelvis (the pelvis area with whatever garment covers it)", parent: undefined, proximal: P_BOTTOM, distal: P_TOP },
    { name: "left-upper-arm", label: "左上臂", en: "left upper arm (shoulder to elbow)", parent: "torso", proximal: P_TOP, distal: P_BOTTOM },
    { name: "left-lower-arm", label: "左小臂", en: "left forearm (elbow to wrist)", parent: "left-upper-arm", proximal: P_TOP, distal: P_BOTTOM },
    { name: "right-upper-arm", label: "右上臂", en: "right upper arm (shoulder to elbow)", parent: "torso", proximal: P_TOP, distal: P_BOTTOM },
    { name: "right-lower-arm", label: "右小臂", en: "right forearm (elbow to wrist)", parent: "right-upper-arm", proximal: P_TOP, distal: P_BOTTOM },
    { name: "left-hand", label: "左手", en: "left hand (open hand with fingers)", parent: "left-lower-arm", proximal: P_TOP, distal: P_BOTTOM },
    { name: "right-hand", label: "右手", en: "right hand (open hand with fingers)", parent: "right-lower-arm", proximal: P_TOP, distal: P_BOTTOM },
    { name: "left-upper-leg", label: "左大腿", en: "left thigh (hip to knee)", parent: "hip", proximal: P_TOP, distal: P_BOTTOM },
    { name: "right-upper-leg", label: "右大腿", en: "right thigh (hip to knee)", parent: "hip", proximal: P_TOP, distal: P_BOTTOM },
    { name: "left-lower-leg", label: "左小腿", en: "left lower leg (knee to ankle)", parent: "left-upper-leg", proximal: P_TOP, distal: P_BOTTOM },
    { name: "right-lower-leg", label: "右小腿", en: "right lower leg (knee to ankle)", parent: "right-upper-leg", proximal: P_TOP, distal: P_BOTTOM },
    { name: "left-foot", label: "左脚", en: "left foot and shoe", parent: "left-lower-leg", proximal: P_TOP, distal: P_BOTTOM },
    { name: "right-foot", label: "右脚", en: "right foot and shoe", parent: "right-lower-leg", proximal: P_TOP, distal: P_BOTTOM }
];
const SLOT_BY_NAME = new Map(RIG_SLOTS.map((slot) => [slot.name, slot]));
export function rigSlotOf(name) {
    return SLOT_BY_NAME.get(name);
}
/**
 * 人形默认绘制顺序（从最后面到最前面）。
 *
 * 为什么用固定层级而不是完全依赖遮挡投票：投票要在「已经摆好」的部件之间
 * 比较像素，而自动装配本身有误差；摆错了再去投票，得到的是错的层级，接着又
 * 用错的层级去纠正位置，误差会自己咬住自己。人形骨架的层叠关系是稳定的常识，
 * 拿它当基准更可靠。遮挡投票的结果仍然算出来，作为**建议**暴露给界面。
 */
export const DEFAULT_DRAW_ORDER = [
    "left-upper-arm",
    "right-upper-arm",
    "left-lower-arm",
    "right-lower-arm",
    "left-hand",
    "right-hand",
    "left-upper-leg",
    "right-upper-leg",
    "left-lower-leg",
    "right-lower-leg",
    "left-foot",
    "right-foot",
    "hip",
    "torso",
    "neck",
    "head"
];
/** 语义排序值；表外的部件一律排在最后面（作为附加装饰画在最底层更安全）。 */
export function drawRankOf(name) {
    const index = DEFAULT_DRAW_ORDER.indexOf(name);
    return index === -1 ? -1 : index;
}
export function defaultPartNames() {
    return RIG_SLOTS.map((slot) => slot.name);
}
export function partLabel(name) {
    return SLOT_BY_NAME.get(name)?.label ?? name;
}
/**
 * 任意部件名的语义父骨骼。
 *
 * 默认网格之外的部件（用户自己命名的「披风」「法杖」……）也要能挂进骨架：
 * 先按关键词猜一个合理宿主，猜不到就挂到躯干上——总比散落一地强。
 */
export function parentBoneOf(name) {
    const known = SLOT_BY_NAME.get(name);
    if (known !== undefined)
        return known.parent;
    const lower = name.toLowerCase();
    const has = (...keys) => keys.some((key) => lower.includes(key));
    const side = has("left", "左") ? "left" : has("right", "右") ? "right" : "";
    if (has("hair", "hat", "cap", "helmet", "horn", "ear", "eye", "face", "发", "帽", "盔", "角"))
        return "head";
    if (has("beard", "scarf", "cape", "wing", "back", "披风", "翅膀", "背包"))
        return "torso";
    if (has("weapon", "sword", "blade", "shield", "staff", "gun", "刀", "剑", "盾", "杖"))
        return side === "" ? "torso" : `${side}-hand`;
    if (has("arm", "hand", "臂", "手"))
        return side === "" ? "torso" : `${side}-upper-arm`;
    if (has("leg", "foot", "feet", "thigh", "shin", "腿", "脚", "足"))
        return side === "" ? "hip" : `${side}-upper-leg`;
    if (has("tail", "skirt", "belt", "hip", "pelvis", "腰", "裙", "尾"))
        return "hip";
    return "torso";
}
/** 默认网格之外部件的锚点规则：整体朝上，绕包围盒底边中点旋转。 */
export function anchorsOf(name) {
    const known = SLOT_BY_NAME.get(name);
    if (known !== undefined)
        return { proximal: known.proximal, distal: known.distal };
    return { proximal: P_BOTTOM, distal: P_TOP };
}
export const RIG_ANIMATIONS = [
    { id: "idle", label: "待机", duration: 1.6, loop: true, summary: "呼吸起伏 + 躯干/头部反向轻摆，首尾闭合可循环" },
    { id: "walk", label: "行走", duration: 0.8, loop: true, summary: "手臂与腿反向摆动，胯部上下颠簸" },
    { id: "run", label: "奔跑", duration: 0.5, loop: true, summary: "行走的夸张版 + 前倾 + 更大的弹跳" },
    { id: "wave", label: "挥手", duration: 1.2, loop: true, summary: "抬起右臂，小臂来回摆动" },
    { id: "jump", label: "跳跃", duration: 1.0, loop: true, summary: "下蹲蓄力 → 起跳 → 滞空 → 落地缓冲" },
    { id: "attack", label: "攻击", duration: 0.6, loop: true, summary: "抬手蓄力 → 挥砍 → 收势跟随" }
];
const ANIMATION_IDS = new Set(RIG_ANIMATIONS.map((item) => item.id));
const ANIMATION_BY_ID = new Map(RIG_ANIMATIONS.map((item) => [item.id, item]));
export function animationPresetOf(id) {
    return ANIMATION_BY_ID.get(id);
}
export function isAnimationId(value) {
    return typeof value === "string" && ANIMATION_IDS.has(value);
}
export function defaultAnimationIds() {
    return ["idle", "walk", "run", "wave", "jump", "attack"];
}
/** 参数范围：挡住「amplitude 填 1000」这类会让插件生成一坨垃圾的输入。 */
export const ANIMATION_AMPLITUDE_RANGE = [0.1, 4];
export const ANIMATION_DURATION_RANGE = [0.1, 10];
/** 归一化一份动画参数：非法值丢弃、超范围夹紧、全默认的条目删掉。 */
export function normalizeAnimationSetting(value) {
    const record = value !== null && typeof value === "object" ? value : {};
    const out = {};
    const duration = Number(record.duration);
    if (Number.isFinite(duration) && duration > 0) {
        out.duration = Number(Math.min(ANIMATION_DURATION_RANGE[1], Math.max(ANIMATION_DURATION_RANGE[0], duration)).toFixed(3));
    }
    const amplitude = Number(record.amplitude);
    if (Number.isFinite(amplitude) && amplitude > 0) {
        out.amplitude = Number(Math.min(ANIMATION_AMPLITUDE_RANGE[1], Math.max(ANIMATION_AMPLITUDE_RANGE[0], amplitude)).toFixed(3));
    }
    return Object.keys(out).length === 0 ? undefined : out;
}
/**
 * 归一化**并按预设默认值剪枝**。
 *
 * 与骨骼偏移不同，动画参数的默认值不是 0：幅度默认 1、时长默认是该预设自己的
 * `duration`。所以「改回默认」不能靠「值为零」判断，必须拿预设的原始值比。
 * 剪掉之后，「这条参数有没有被人动过」就是一个存在性判断，而不是数值比较——
 * 界面上的「—」与 JSON diff 都干净。
 */
export function pruneAnimationSetting(id, value) {
    const normalized = normalizeAnimationSetting(value);
    if (normalized === undefined)
        return undefined;
    const preset = ANIMATION_BY_ID.get(id);
    const out = {};
    if (normalized.amplitude !== undefined && Math.abs(normalized.amplitude - 1) > 1e-6)
        out.amplitude = normalized.amplitude;
    if (normalized.duration !== undefined && preset !== undefined && Math.abs(normalized.duration - preset.duration) > 1e-3) {
        out.duration = normalized.duration;
    }
    return Object.keys(out).length === 0 ? undefined : out;
}
export function normalizeAnimationSettings(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const out = {};
    for (const [id, setting] of Object.entries(value)) {
        if (!ANIMATION_IDS.has(id))
            continue;
        const normalized = pruneAnimationSetting(id, setting);
        if (normalized !== undefined)
            out[id] = normalized;
    }
    return Object.keys(out).length === 0 ? undefined : out;
}
// 缓动曲线（归一化控制点，与参考项目一致）。
const EASE = [0.25, 0, 0.75, 1];
const EASE_IN = [0.42, 0, 1, 1];
const EASE_OUT = [0, 0, 0.58, 1];
const EASE_FAST = [0.4, 0, 0.2, 1];
function kf(time, angle, x, y, curve = EASE) {
    const frame = { time: round(time, 4) };
    if (angle !== undefined)
        frame.angle = round(angle, 2);
    if (x !== undefined)
        frame.x = round(x, 2);
    if (y !== undefined)
        frame.y = round(y, 2);
    if (curve)
        frame.curve = curve;
    return frame;
}
function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
/**
 * 挂点：有网格就出 `mesh`，否则出 `region`。
 *
 * **网格顶点用「部件中心为原点」的坐标**，与 region attachment 的 `-w/2, -h/2` 同一套系——
 * 这样运行时两种附件共用同一条变换链（骨骼世界矩阵 → 挂点 x/y/rotation → 顶点），
 * 不必为 mesh 另写一套定位逻辑。`buildRigMesh` 那边用的是「左上角为原点」，
 * 转换就发生在这里，且只发生一次。
 *
 * 暂时**不写 `weights`**：那是 LBS（多骨骼线性混合蒙皮），格式在两条导出路径里都绕
 * （Spine 的加权顶点是 `[骨骼数, (索引, x, y, 权重)…]` 的交错数组），而它解决的问题是
 * 「一块贴图被多根骨骼共同拉扯」——FFD 时间轴已经把「裙摆上缘不动、下缘甩出去」这件事
 * 做到了，先把能验证的那条链路走通。`RigMesh` 已经产出权重，接进导出是独立的一步。
 */
/** 每个变形循环采样几个关键帧。6 段对「裙摆左右摆」这种低频运动足够。 */
export const ANIMATION_DEFORM_SAMPLES = 6;
/** 取部件的网格（没有就返回 undefined）。网格是确定性重算的，不落盘。 */
function meshGridOf(spec, part) {
    if (spec === undefined || part === undefined)
        return undefined;
    const width = Math.max(1, part.width);
    const height = Math.max(1, part.height);
    return {
        mesh: buildRigMesh({ width, height, cols: spec.cols, rows: spec.rows, bones: [], x: part.x, y: part.y }),
        width,
        height
    };
}
function meshAttachmentOf(name, part, attachment, spec) {
    if (spec === undefined)
        return attachment;
    const grid = meshGridOf(spec, part);
    if (grid === undefined)
        return attachment;
    const vertices = [];
    for (let i = 0; i < grid.mesh.vertices.length; i += 2) {
        vertices.push(round(grid.mesh.vertices[i] - part.width / 2, 3), round(grid.mesh.vertices[i + 1] - part.height / 2, 3));
    }
    return {
        ...attachment,
        type: "mesh",
        // `path` 指向图集里的区域名：mesh 与 region 取的是同一张图，只是画法不同。
        path: name,
        uvs: grid.mesh.uvs,
        triangles: grid.mesh.triangles,
        vertices,
        // Spine 用它做编辑器里的凸包显示；给顶点数即可（规则网格的凸包就是外圈）。
        hull: (grid.mesh.cols + 1) * 2 + (grid.mesh.rows - 1) * 2
    };
}
/** 宽容取数：非数字/NaN 一律回落到 `fallback`（约束参数来自界面与对话，不能假设它干净）。 */
function num(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
;
function has(bones, ...names) {
    return names.some((name) => bones.has(name));
}
function genIdle(B) {
    const bones = {};
    const D = 1.6;
    const sway = [
        ["torso", 1.5, 0.5],
        ["neck", 1.0, 0.55],
        ["head", -2.0, 0.6]
    ];
    for (const [name, amp, phase] of sway) {
        if (!B.has(name))
            continue;
        bones[name] = { rotate: [kf(0, 0, undefined, undefined, null), kf(D * phase, amp), kf(D, 0)] };
    }
    if (B.has("torso")) {
        bones.torso = bones.torso ?? {};
        bones.torso.translate = [kf(0, undefined, 0, 0, null), kf(D * 0.5, undefined, 0, 1.5), kf(D, undefined, 0, 0)];
    }
    for (const side of ["left", "right"]) {
        const s = side === "left" ? 1 : -1;
        const parts = [
            [`${side}-upper-arm`, s * 1.5, 0.5],
            [`${side}-lower-arm`, s * 1.0, 0.55]
        ];
        for (const [part, amp, phase] of parts) {
            if (!B.has(part))
                continue;
            bones[part] = { rotate: [kf(0, 0, undefined, undefined, null), kf(D * phase, amp), kf(D, 0)] };
        }
    }
    return bones;
}
function genWalk(B) {
    const bones = {};
    const D = 0.8;
    const Q = D / 4;
    const segments = (values) => values.map((value, index) => kf(index * Q, value, undefined, undefined, index === 0 ? null : EASE));
    if (B.has("hip")) {
        bones.hip = {
            translate: [
                kf(0, undefined, 0, 0, null),
                kf(Q, undefined, 0, 3),
                kf(Q * 2, undefined, 0, 0),
                kf(Q * 3, undefined, 0, 3),
                kf(D, undefined, 0, 0)
            ],
            rotate: segments([0, -2, 0, 2, 0])
        };
    }
    if (B.has("torso"))
        bones.torso = { rotate: segments([0, 3, 0, -3, 0]) };
    if (B.has("head"))
        bones.head = { rotate: segments([0, -1.5, 0, 1.5, 0]) };
    for (const [side, shift] of [["left", 0], ["right", 0.5]]) {
        const upper = `${side}-upper-leg`;
        const lower = `${side}-lower-leg`;
        if (B.has(upper)) {
            const a = shift === 0 ? -25 : 25;
            bones[upper] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, 0), kf(Q * 2, -a), kf(Q * 3, 0), kf(D, a)] };
        }
        if (B.has(lower)) {
            const a = shift === 0 ? 5 : 35;
            const b = shift === 0 ? 35 : 5;
            bones[lower] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, 35), kf(Q * 2, b), kf(Q * 3, 5), kf(D, a)] };
        }
    }
    for (const [side, shift] of [["left", 0.5], ["right", 0]]) {
        const upper = `${side}-upper-arm`;
        const lower = `${side}-lower-arm`;
        if (B.has(upper)) {
            const a = shift === 0 ? -20 : 20;
            bones[upper] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, 0), kf(Q * 2, -a), kf(Q * 3, 0), kf(D, a)] };
        }
        if (B.has(lower)) {
            const a = shift === 0 ? -10 : -30;
            const b = shift === 0 ? -30 : -10;
            bones[lower] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, -20), kf(Q * 2, b), kf(Q * 3, -20), kf(D, a)] };
        }
    }
    return bones;
}
function genRun(B) {
    const bones = {};
    const D = 0.5;
    const Q = D / 4;
    if (B.has("hip")) {
        bones.hip = {
            translate: [
                kf(0, undefined, 0, 0, null),
                kf(Q, undefined, 0, 6),
                kf(Q * 2, undefined, 0, -2),
                kf(Q * 3, undefined, 0, 6),
                kf(D, undefined, 0, 0)
            ],
            rotate: [kf(0, 0, undefined, undefined, null), kf(Q, -3), kf(Q * 2, 0), kf(Q * 3, 3), kf(D, 0)]
        };
    }
    if (B.has("torso")) {
        // 常驻前倾：起止值不再是 0，循环时依然首尾相接。
        bones.torso = { rotate: [kf(0, 8, undefined, undefined, null), kf(Q, 12), kf(Q * 2, 8), kf(Q * 3, 12), kf(D, 8)] };
    }
    if (B.has("head")) {
        bones.head = { rotate: [kf(0, -6, undefined, undefined, null), kf(Q, -8), kf(Q * 2, -6), kf(Q * 3, -8), kf(D, -6)] };
    }
    for (const [side, ph] of [["left", 0], ["right", 0.5]]) {
        const upper = `${side}-upper-leg`;
        const lower = `${side}-lower-leg`;
        if (B.has(upper)) {
            const a = ph === 0 ? -35 : 40;
            bones[upper] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, 0), kf(Q * 2, -a), kf(Q * 3, 0), kf(D, a)] };
        }
        if (B.has(lower)) {
            const a = ph === 0 ? 10 : 50;
            const b = ph === 0 ? 50 : 10;
            bones[lower] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, 50), kf(Q * 2, b), kf(Q * 3, 10), kf(D, a)] };
        }
    }
    for (const [side, ph] of [["left", 0.5], ["right", 0]]) {
        const upper = `${side}-upper-arm`;
        const lower = `${side}-lower-arm`;
        if (B.has(upper)) {
            const a = ph === 0 ? -30 : 30;
            bones[upper] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, 0), kf(Q * 2, -a), kf(Q * 3, 0), kf(D, a)] };
        }
        if (B.has(lower)) {
            const a = ph === 0 ? -20 : -50;
            const b = ph === 0 ? -50 : -20;
            bones[lower] = { rotate: [kf(0, a, undefined, undefined, null), kf(Q, -35), kf(Q * 2, b), kf(Q * 3, -35), kf(D, a)] };
        }
    }
    return bones;
}
function genWave(B) {
    const bones = {};
    const D = 1.2;
    if (B.has("right-upper-arm")) {
        bones["right-upper-arm"] = {
            rotate: [kf(0, 0, undefined, undefined, null), kf(0.2, -130, undefined, undefined, EASE_OUT), kf(D - 0.2, -130, undefined, undefined, null), kf(D, 0, undefined, undefined, EASE_IN)]
        };
    }
    if (B.has("right-lower-arm")) {
        bones["right-lower-arm"] = {
            rotate: [kf(0, 0, undefined, undefined, null), kf(0.2, -30, undefined, undefined, EASE_OUT), kf(0.4, 20), kf(0.6, -20), kf(0.8, 20), kf(1.0, -20), kf(D, 0, undefined, undefined, EASE_IN)]
        };
    }
    if (B.has("torso")) {
        bones.torso = { rotate: [kf(0, 0, undefined, undefined, null), kf(0.2, -3), kf(D - 0.2, -3, undefined, undefined, null), kf(D, 0)] };
    }
    if (B.has("head")) {
        bones.head = { rotate: [kf(0, 0, undefined, undefined, null), kf(0.3, 5), kf(D - 0.2, 5, undefined, undefined, null), kf(D, 0)] };
    }
    return bones;
}
function genJump(B) {
    const bones = {};
    const D = 1.0;
    if (B.has("hip")) {
        bones.hip = {
            translate: [
                kf(0, undefined, 0, 0, null),
                kf(0.15, undefined, 0, -20, EASE_IN),
                kf(0.35, undefined, 0, 70, EASE_OUT),
                kf(0.55, undefined, 0, 65, null),
                kf(0.8, undefined, 0, -10, EASE_IN),
                kf(D, undefined, 0, 0, EASE_OUT)
            ]
        };
    }
    if (B.has("torso")) {
        bones.torso = {
            rotate: [kf(0, 0, undefined, undefined, null), kf(0.15, 8, undefined, undefined, EASE_IN), kf(0.35, -5, undefined, undefined, EASE_OUT), kf(0.8, 5, undefined, undefined, EASE_IN), kf(D, 0, undefined, undefined, EASE_OUT)]
        };
    }
    if (B.has("head")) {
        bones.head = { rotate: [kf(0, 0, undefined, undefined, null), kf(0.15, 5), kf(0.35, -8), kf(0.8, 3), kf(D, 0)] };
    }
    for (const side of ["left", "right"]) {
        const s = side === "left" ? 1 : -1;
        const arm = `${side}-upper-arm`;
        const upper = `${side}-upper-leg`;
        const lower = `${side}-lower-leg`;
        if (B.has(arm)) {
            bones[arm] = {
                rotate: [kf(0, 0, undefined, undefined, null), kf(0.15, s * 10), kf(0.35, s * -50, undefined, undefined, EASE_OUT), kf(0.8, s * 8, undefined, undefined, EASE_IN), kf(D, 0)]
            };
        }
        if (B.has(upper)) {
            bones[upper] = { rotate: [kf(0, 0, undefined, undefined, null), kf(0.15, 20), kf(0.35, -15), kf(0.55, 10), kf(0.8, 15), kf(D, 0)] };
        }
        if (B.has(lower)) {
            bones[lower] = { rotate: [kf(0, 0, undefined, undefined, null), kf(0.15, -30), kf(0.35, 10), kf(0.55, -15), kf(0.8, -20), kf(D, 0)] };
        }
    }
    return bones;
}
function genAttack(B) {
    const bones = {};
    const D = 0.6;
    if (B.has("right-upper-arm")) {
        bones["right-upper-arm"] = {
            rotate: [kf(0, 0, undefined, undefined, null), kf(0.1, 40, undefined, undefined, EASE_IN), kf(0.25, -80, undefined, undefined, EASE_FAST), kf(0.4, -60, undefined, undefined, null), kf(D, 0, undefined, undefined, EASE_OUT)]
        };
    }
    if (B.has("right-lower-arm")) {
        bones["right-lower-arm"] = {
            rotate: [kf(0, 0, undefined, undefined, null), kf(0.1, -40, undefined, undefined, EASE_IN), kf(0.25, 10, undefined, undefined, EASE_FAST), kf(0.4, -5, undefined, undefined, null), kf(D, 0, undefined, undefined, EASE_OUT)]
        };
    }
    if (B.has("torso")) {
        bones.torso = {
            rotate: [kf(0, 0, undefined, undefined, null), kf(0.1, -8, undefined, undefined, EASE_IN), kf(0.25, 12, undefined, undefined, EASE_FAST), kf(0.4, 5, undefined, undefined, null), kf(D, 0, undefined, undefined, EASE_OUT)]
        };
    }
    if (B.has("hip")) {
        bones.hip = {
            translate: [kf(0, undefined, 0, 0, null), kf(0.1, undefined, -5, -5, EASE_IN), kf(0.25, undefined, 10, 2, EASE_FAST), kf(D, undefined, 0, 0, EASE_OUT)]
        };
    }
    return bones;
}
const PRESETS = {
    idle: genIdle,
    walk: genWalk,
    run: genRun,
    wave: genWave,
    jump: genJump,
    attack: genAttack
};
// ── Spine 4.2 wire format 转换 ──────────────────────────────────────────
/**
 * 时间轴类型 → 它驱动的属性名与默认值。
 * 属性个数决定 bezier 要写 4 个数（单属性）还是 8 个（双属性）。
 */
const TIMELINE_PROPERTIES = {
    rotate: [["value", 0]],
    translate: [["x", 0], ["y", 0]],
    scale: [["x", 1], ["y", 1]],
    shear: [["x", 0], ["y", 0]]
};
/**
 * 一条时间轴驱动几个属性。
 *
 * 这个数字直接决定 bezier 控制点该写 4 个还是 8 个——写错了运行时就会越界读
 * `undefined`，NaN 顺着骨骼变换扩散，整只骨架渲染一帧后消失（见 `convertTimeline`
 * 的注释）。所以它必须能被导出前的校验器读到，而不是只活在 `spine.ts` 里。
 */
export function timelinePropertyCount(kind) {
    return TIMELINE_PROPERTIES[kind]?.length ?? 0;
}
/**
 * 把一条时间轴就地改写成 Spine 4.2 wire format。三个坑（照搬参考项目的注释）：
 *
 * 1. 旋转值写在 `value` 下，不是 `angle`——4.x 运行时遇到 `angle` 会当成 0，骨骼不动。
 * 2. bezier 是**每个被动画属性一份**，不是每个关键帧一份。`rotate` 一份 4 个数，
 *    `translate` 两份共 8 个；只给 4 个，运行时读过数组末尾得到 undefined，
 *    NaN 顺着骨骼变换扩散，骨架渲染一帧后整体消失。
 * 3. 控制点是**绝对量**（和 time / value 同单位），不是 0~1 的归一化比例。
 *    归一化会让手柄落到自己所在区间之外，插值变成突跳而不是缓动。
 *
 * 另外：某个关键帧的 curve 描述的是**从它开始**的那一段，所以归一化 curve 要
 * 整体前移一帧——生成器把它挂在第 i 帧上，实际描述的是 i-1 → i。
 */
function convertTimeline(kind, frames) {
    const properties = TIMELINE_PROPERTIES[kind];
    if (properties === undefined || frames.length < 2)
        return;
    if (kind === "rotate") {
        for (const frame of frames) {
            if (frame.angle !== undefined) {
                frame.value = frame.angle;
                delete frame.angle;
            }
        }
    }
    const authored = frames.map((frame) => {
        const curve = frame.curve ?? null;
        delete frame.curve;
        return curve;
    });
    for (let i = 0; i < frames.length - 1; i++) {
        const curve = authored[i + 1];
        if (curve === null || curve === undefined)
            continue;
        if (curve === "stepped") {
            frames[i].curve = "stepped";
            continue;
        }
        if (!Array.isArray(curve) || curve.length < 4)
            continue;
        const [cx1, cy1, cx2, cy2] = curve;
        const time1 = frames[i].time;
        const time2 = frames[i + 1].time;
        const span = time2 - time1;
        const absolute = [];
        for (const [name, fallback] of properties) {
            const value1 = frames[i][name] ?? fallback;
            const value2 = frames[i + 1][name] ?? fallback;
            const delta = value2 - value1;
            absolute.push(round(time1 + span * cx1, 6), round(value1 + delta * cy1, 6), round(time1 + span * cx2, 6), round(value1 + delta * cy2, 6));
        }
        frames[i].curve = absolute;
    }
}
function toSpine42(animations) {
    for (const animation of Object.values(animations)) {
        const bones = animation?.bones;
        if (bones === null || typeof bones !== "object")
            continue;
        for (const timelines of Object.values(bones)) {
            for (const [kind, frames] of Object.entries(timelines)) {
                if (Array.isArray(frames))
                    convertTimeline(kind, frames);
            }
        }
    }
}
/**
 * 把参数作用在**简写**上（`toSpine42` 之前）。
 *
 * 顺序很关键：简写的 curve 是归一化控制点，时间与数值一起缩放之后，由
 * `convertTimeline` 绝对化出来的控制点仍落在正确的段内。若反过来先绝对化再缩放，
 * 控制点会跑到所属区间之外，运动就变成突跳。
 */
function applyAnimationSetting(bones, preset, setting) {
    if (setting === undefined)
        return;
    const amplitude = setting.amplitude ?? 1;
    const scale = setting.duration !== undefined && preset.duration > 0 ? setting.duration / preset.duration : 1;
    if (amplitude === 1 && scale === 1)
        return;
    for (const timelines of Object.values(bones)) {
        for (const [kind, frames] of Object.entries(timelines)) {
            if (!Array.isArray(frames))
                continue;
            for (const frame of frames) {
                if (typeof frame.time === "number")
                    frame.time = round(frame.time * scale, 4);
                if (kind === "rotate" && typeof frame.angle === "number")
                    frame.angle = round(frame.angle * amplitude, 2);
                if (kind === "translate") {
                    if (typeof frame.x === "number")
                        frame.x = round(frame.x * amplitude, 2);
                    if (typeof frame.y === "number")
                        frame.y = round(frame.y * amplitude, 2);
                }
                if (kind === "scale") {
                    // 缩放是**相对 1** 的量：0.9 的挤压在 amplitude=2 时应该变成 0.8。
                    if (typeof frame.x === "number")
                        frame.x = round(1 + (frame.x - 1) * amplitude, 4);
                    if (typeof frame.y === "number")
                        frame.y = round(1 + (frame.y - 1) * amplitude, 4);
                }
            }
        }
    }
}
/**
 * 生成全部预设动画的**简写**形式。
 *
 * 简写 = `{time: 秒, angle/x/y, curve: 0~1 归一化控制点 | "stepped" | null}`。
 * 它是两条导出路径（Spine 4.2 / DragonBones 5.5）**共同的输入**：Spine 的
 * `curve` 是绝对量、DragonBones 的是 0~1 归一化，两者必须各自编码一次——
 * 早先只有 `buildAnimations` 一条路（末尾顺手 `toSpine42` 就地改写），
 * 拿它去喂 DragonBones 就会把绝对量当成归一化值写出去。
 */
export function buildAnimationShorthands(boneNames, ids, settings = {}) {
    const set = new Set(boneNames);
    const animations = {};
    for (const id of ids) {
        const generator = PRESETS[id];
        const preset = ANIMATION_BY_ID.get(id);
        if (generator === undefined || preset === undefined)
            continue;
        const setting = settings[id];
        const bones = generator(set);
        if (Object.keys(bones).length === 0)
            continue;
        applyAnimationSetting(bones, preset, setting);
        animations[id] = { bones };
    }
    return animations;
}
/** 生成全部预设动画（Spine 4.2 wire format）。传入的 `boneNames` 决定哪些骨骼会被写到。 */
export function buildAnimations(boneNames, ids, settings = {}) {
    const animations = buildAnimationShorthands(boneNames, ids, settings);
    toSpine42(animations);
    return animations;
}
/** 实际生效的时长（预设时长被参数覆盖时以参数为准）。 */
export function animationDurationOf(id, settings = {}) {
    const preset = ANIMATION_BY_ID.get(id);
    return settings[id]?.duration ?? preset?.duration ?? 0;
}
/**
 * 从预设**实例化**一份可编辑的动画。
 *
 * 时间轴编辑器第一次碰到某台动画时用它当初始值——「编辑」这个动作的本质是
 * 「把参数化的预设固化成一份显式的关键帧数据，从此以数据为准」。参数
 * （`animationSettings` 的时长 / 幅度）在这里已经被烘进关键帧，之后再改参数
 * 不会影响这份数据，这是刻意的：否则「手调过的帧」会被下一次调参悄悄改掉。
 */
export function instantiateAnimation(id, boneNames, settings = {}) {
    const preset = ANIMATION_BY_ID.get(id);
    if (preset === undefined)
        return undefined;
    const shorthand = buildAnimationShorthands(boneNames, [id], settings)[id];
    if (shorthand === undefined)
        return undefined;
    // 末帧永远不带 curve：Spine 的 curve 描述的是「以本帧为起点」的下一段，末帧没有下一段，
    // 写了也永远不会被读到（方案附录 A 第 4 条）。预设生成器给每帧都挂了默认缓动，
    // 这里清掉——编辑器里的数据不该有「永远不会生效的字段」，用户会以为自己改到了什么。
    for (const kinds of Object.values(shorthand.bones)) {
        for (const frames of Object.values(kinds)) {
            if (Array.isArray(frames) && frames.length > 0)
                frames[frames.length - 1].curve = null;
        }
    }
    return {
        duration: animationDurationOf(id, settings),
        loop: preset.loop,
        bones: shorthand.bones,
        source: "preset"
    };
}
/** 一条时间轴在简写里驱动哪些字段（用于校验与界面）。 */
export function timelineValueKeys(kind) {
    return (TIMELINE_PROPERTIES[kind] ?? []).map(([name]) => name);
}
/** 简写时间轴里的「旋转」字段名是 `angle`（`toSpine42` 之后才改名 `value`）。 */
export function keyframeValueKeys(kind) {
    if (kind === "rotate")
        return ["angle"];
    return timelineValueKeys(kind);
}
/** 沿父级往上取链上的骨骼名，**从根到末端**。末端骨自己也算。 */
export function ikChainOf(boneParent, bone, chain) {
    const out = [bone];
    let cursor = boneParent.get(bone);
    for (let i = 0; i < chain && cursor !== undefined; i++) {
        out.unshift(cursor);
        cursor = boneParent.get(cursor);
    }
    return out;
}
/** 图片像素坐标 → Spine 世界坐标（Y 翻转、水平以画布中心为 0）。 */
function toWorld(px, py, canvasWidth, canvasHeight) {
    return { x: px - canvasWidth / 2, y: canvasHeight - py };
}
function deg(rad) {
    return (rad * 180) / Math.PI;
}
function normalizeAngle(value) {
    let angle = value % 360;
    if (angle > 180)
        angle -= 360;
    if (angle <= -180)
        angle += 360;
    return round(angle, 4);
}
/**
 * 核心：把「每个部件的像素框 + 层级」变成一份可动画的骨架。
 *
 * 对每个部件：
 *   1. 取近端/远端锚点，得到世界坐标下的骨骼原点与朝向（Spine 的 0° 指向 +Y，
 *      所以朝向向量 (dx,dy) 对应 `atan2(-dx, dy)`）。
 *   2. 骨骼 x/y 换算到**父骨骼的局部坐标系**里（spine-core 会先转父骨骼再平移）。
 *   3. 挂点用「图片中心 − 骨骼原点」再逆旋转到骨骼局部系，并用 `rotation`
 *      补偿骨骼朝向——这样**初始姿态和装配结果逐像素一致**，而动画一开始，
 *      部件就绕着正确的那节骨头转。
 */
export function buildSkeleton(options) {
    const warnings = [];
    const visible = options.parts.filter((part) => part.hidden !== true);
    const byName = new Map(visible.map((part) => [part.name, part]));
    // 只需要「这个部件在哪个骨骼上」——骨骼名与部件名一一对应，少一层心智负担。
    const boneNames = new Set(visible.map((part) => part.name));
    boneNames.add("root");
    /**
     * 只解析「语义 → 关键词」这一层父级，**不管成环**。成环在下面的拓扑排序里统一断。
     *
     * 为什么要拆开：早先 `resolveParent(name, seen)` 把「按名字找父级」和
     * 「按当前祖先栈断环」揉在一个函数里，然后被**调用了两次**——拓扑排序时传的是
     * 祖先栈，写骨骼字段时传的是空集。两次结果可以不同，于是「排序用的父级」和
     * 「写进产物的父级」对不上，真的产出了 `hip ← torso` 且 `torso ← hip` 的**互环**
     * （Spine 里没人发现，是 DragonBones 那边的拓扑序校验拦下来的）。
     */
    const rawParentOf = (name) => {
        // ① 语义层显式指定的父级优先。它可能指向一个被隐藏/未生成的部件——
        //    那种情况下不能让骨架断链，所以继续走 ②。
        const explicit = byName.get(name)?.parent;
        if (explicit !== undefined && explicit !== name && boneNames.has(explicit))
            return explicit;
        // ② 按名字关键词沿语义链往上找第一个真实存在的骨骼。
        //    加 guard 是因为 `parentBoneOf` 的关键词规则本身可能成环
        //    （例如某个名字同时命中两组关键词），无界循环会让整个推导卡死。
        const guard = new Set();
        let cursor = parentBoneOf(name);
        while (cursor !== undefined && !guard.has(cursor)) {
            guard.add(cursor);
            if (cursor !== name && boneNames.has(cursor))
                return cursor;
            const next = parentBoneOf(cursor);
            if (next === cursor)
                break;
            cursor = next;
        }
        return undefined;
    };
    /**
     * 兜底宿主：优先躯干，其次胯部。
     *
     * **只服务默认网格之外的部件**。已知槽位走到这里只有一个可能——它的
     * `parent` 就是 `undefined`，也就是 `hip`（胯部）本身：它是身体根，
     * 兜底把它挂到躯干上会立刻造出 `hip ↔ torso` 的互环
     * （躯干的父级按名字规则正是胯部）。这个互环在 v1 一直存在，
     * 只是因为两边都没做拓扑序校验而没人发现。
     */
    const fallbackHostOf = (name) => {
        if (name === "root")
            return undefined;
        if (SLOT_BY_NAME.has(name))
            return undefined;
        if (byName.has("torso"))
            return "torso";
        if (byName.has("hip"))
            return "hip";
        return undefined;
    };
    // 拓扑排序：父骨骼永远排在子骨骼前面。
    //
    // 父级**只解析一次**并存进 `resolvedParent`，排序与骨骼字段共用同一份——
    // 这样「排序里的父子关系」与「产物里的父子关系」不可能再分叉。
    const resolvedParent = new Map();
    const ordered = [];
    const visited = new Set();
    const visit = (name, stack) => {
        if (visited.has(name) || stack.has(name))
            return;
        stack.add(name);
        if (name !== "root") {
            let parent = rawParentOf(name);
            // 语义链可能绕回自己（例如「胯部」的父级按语义也算胯部），必须在这里断开，
            // 否则骨骼表里会出现自环，渲染时无限递归。
            if (parent === name)
                parent = undefined;
            if (parent !== undefined && stack.has(parent)) {
                warnings.push(`骨骼 ${name} 的父级 ${parent} 与祖先成环，这条边已断开`);
                parent = undefined;
            }
            if (parent === undefined)
                parent = fallbackHostOf(name);
            // 兜底宿主自己也可能正在栈上（torso 与 hip 互相指认时就是这么来的）——
            // 早先这里没有第二道检查，于是「挂到 torso」把刚断开的环**又接了回来**。
            if (parent !== undefined && stack.has(parent)) {
                warnings.push(`骨骼 ${name} 的兜底宿主 ${parent} 也在环上，改挂到 root`);
                parent = undefined;
            }
            resolvedParent.set(name, parent);
            if (parent !== undefined)
                visit(parent, stack);
        }
        else {
            resolvedParent.set("root", undefined);
        }
        stack.delete(name);
        visited.add(name);
        ordered.push(name);
    };
    for (const name of visible.map((part) => part.name))
        visit(name, new Set());
    const world = new Map();
    world.set("root", { x: 0, y: 0, rotation: 0 });
    const bones = [{ name: "root", x: 0, y: 0, rotation: 0, length: 0 }];
    const attachments = {};
    const slots = [];
    const sorted = [...visible].sort((a, b) => a.z - b.z);
    /**
     * 每个部件的近端锚点世界坐标（骨骼原点）。
     *
     * 预先算一遍，是因为**骨骼方向要指向子部件的近端**——那需要父骨骼在处理时就能
     * 拿到子部件的近端坐标，而拓扑序里子部件排在后面。
     */
    const proxWorldOf = new Map();
    for (const name of ordered) {
        if (name === "root")
            continue;
        const part = byName.get(name);
        if (part === undefined)
            continue;
        const anchors = anchorsOf(name);
        const proximal = part.proximal ?? anchors.proximal;
        proxWorldOf.set(name, toWorld(part.x + proximal[0] * part.width, part.y + proximal[1] * part.height, options.canvasWidth, options.canvasHeight));
    }
    /**
     * 父 → 子。
     *
     * 用来把骨骼**末端指到子骨骼的起点**上。这是「骨骼首尾相接」的来源：
     * 早先每根骨的方向都取「自己部件的近端 → 远端」（固定的上中 → 下中），于是
     * 斜着摆的部件（举起的手臂）会解出两条**互相错开**的骨骼——实测上臂到前臂的
     * 骨骼原点只差 41.5px，而上臂骨骼长 85px。视觉上拼图是对的，但动画时部件
     * 绕的旋转中心不在关节上。
     */
    const childrenOf = new Map();
    for (const [child, parent] of resolvedParent) {
        if (parent === undefined || child === "root")
            continue;
        const list = childrenOf.get(parent) ?? [];
        list.push(child);
        childrenOf.set(parent, list);
    }
    for (const list of childrenOf.values())
        list.sort();
    for (const name of ordered) {
        if (name === "root")
            continue;
        const part = byName.get(name);
        if (part === undefined)
            continue;
        // 锚点：语义层给了就用它（人在界面上拖过、或 AI 判断过），没给才回落到
        // 角色的默认锚点。这是「初始姿态逐像素还原」的前提下唯一允许改动的输入。
        const fallbackAnchors = anchorsOf(name);
        const proximal = part.proximal ?? fallbackAnchors.proximal;
        const distal = part.distal ?? fallbackAnchors.distal;
        const proxPx = part.x + proximal[0] * part.width;
        const proxPy = part.y + proximal[1] * part.height;
        const distPx = part.x + distal[0] * part.width;
        const distPy = part.y + distal[1] * part.height;
        const centerPx = part.x + part.width / 2;
        const centerPy = part.y + part.height / 2;
        const prox = toWorld(proxPx, proxPy, options.canvasWidth, options.canvasHeight);
        const ownDist = toWorld(distPx, distPy, options.canvasWidth, options.canvasHeight);
        const center = toWorld(centerPx, centerPy, options.canvasWidth, options.canvasHeight);
        // 骨骼末端优先指到**子部件的近端**——「首尾相接」就是这么来的。
        // 没有子部件（叶子骨，例如头、手、脚）才退回自己部件的远端。
        //
        // 只影响朝向与长度：位置（`prox`）与挂点都照旧，所以初始姿态一格不动。
        const childName = (childrenOf.get(name) ?? [])[0];
        const childProx = childName === undefined ? undefined : proxWorldOf.get(childName);
        const dist = childProx !== undefined && Math.hypot(childProx.x - prox.x, childProx.y - prox.y) >= 1 ? childProx : ownDist;
        const dirX = dist.x - prox.x;
        const dirY = dist.y - prox.y;
        const length = Math.hypot(dirX, dirY) || Math.max(1, Math.max(part.width, part.height));
        const worldRot = deg(Math.atan2(-dirX, dirY));
        const parentName = resolvedParent.get(name);
        const parentWorld = world.get(parentName ?? "root") ?? world.get("root");
        // 位移先逆旋转到父骨骼局部系，再作为骨骼 x/y。
        const deltaX = prox.x - parentWorld.x;
        const deltaY = prox.y - parentWorld.y;
        const pRad = (parentWorld.rotation * Math.PI) / 180;
        const cosP = Math.cos(-pRad);
        const sinP = Math.sin(-pRad);
        const localX = deltaX * cosP - deltaY * sinP;
        const localY = deltaX * sinP + deltaY * cosP;
        // ── 三通道：local = origin ⊕ offset（动画由时间轴另行叠加）──────────
        //
        // 注意 `world` 里存的仍然是 **origin**（不含 offset）：
        // 子骨骼的局部坐标要相对父骨骼的**绑定姿势**去算，这样运行时父骨骼一旦带上
        // offset，子骨骼会跟着一起动（转躯干时头/手臂跟着转）——这才是「手工调骨骼」
        // 期望的手感。若把 offset 也并进 world，子骨骼会被抵消掉、不跟随。
        const originRotation = normalizeAngle(worldRot - (parentName === undefined ? 0 : parentWorld.rotation));
        const boneOffset = part.offset ?? {};
        bones.push({
            name,
            parent: parentName,
            x: round(localX + (boneOffset.x ?? 0), 4),
            y: round(localY + (boneOffset.y ?? 0), 4),
            rotation: normalizeAngle(originRotation + (boneOffset.rotation ?? 0)),
            length: round(length, 4)
        });
        world.set(name, { x: prox.x, y: prox.y, rotation: worldRot });
        // 挂点：图片中心相对骨骼原点，逆旋转到骨骼局部系。
        const offX = center.x - prox.x;
        const offY = center.y - prox.y;
        const bRad = (worldRot * Math.PI) / 180;
        const cosB = Math.cos(-bRad);
        const sinB = Math.sin(-bRad);
        attachments[name] = {
            [name]: meshAttachmentOf(name, part, {
                x: round(offX * cosB - offY * sinB, 4),
                y: round(offX * sinB + offY * cosB, 4),
                // 挂点自身旋转 = 抵消骨骼朝向（让初始姿态正立）+ 手动装配里拧的角度。
                rotation: normalizeAngle(-worldRot + (part.rotation ?? 0)),
                width: round(part.width, 4),
                height: round(part.height, 4)
            }, options.meshes?.[name])
        };
        slots.push({ name, bone: name, attachment: name });
    }
    // slots 的顺序即绘制顺序：越靠前画得越早（越靠后）。按 z 升序排。
    slots.sort((a, b) => {
        const za = visible.find((part) => part.name === a.name)?.z ?? 0;
        const zb = visible.find((part) => part.name === b.name)?.z ?? 0;
        return za - zb;
    });
    const orderedBoneNames = bones.map((bone) => bone.name);
    const settings = options.animationSettings ?? {};
    // 简写留一份给 DragonBones：它的 curve 是 0~1 归一化，而 `toSpine42` 会就地把
    // curve 绝对化，走过一遍就拿不回来了。
    const animationsRaw = buildAnimationShorthands(orderedBoneNames, options.animationIds, settings);
    // 手工/AI 编辑过的动画在这里**顶掉**预设实例（而不是在转换之后再塞进去）。
    //
    // 早先的写法是先 `buildAnimations`（内部已 `toSpine42`）再赋值 customAnimations、
    // 最后又调一次 `toSpine42`——那一遍会把**已经绝对化**的预设 curve 当归一化值
    // 再绝对化一次（`time1 + span × 已绝对值`），运动直接算飞。合并必须发生在
    // 简写层，转换只做一次。
    if (options.customAnimations !== undefined) {
        for (const [key, value] of Object.entries(options.customAnimations)) {
            if (value === null || value === undefined)
                continue;
            animationsRaw[key] = value;
        }
    }
    const animations = JSON.parse(JSON.stringify(animationsRaw));
    toSpine42(animations);
    // ── FFD 变形时间轴（M5 的 L3）───────────────────────────────────────
    //
    // 把波形**采样**成有限个关键帧再导出：两条导出路径的 deform/ffd 都是关键帧列表，
    // 而波形是连续的。采样点数取 6（每周期 6 段），对「裙摆左右摆」这个低频运动足够，
    // 也不会让 JSON 膨胀——顶点数是 49，每帧 98 个数字，6 帧约 600 个。
    //
    // 采样时间对齐到**每个动画自己的时长**：这样每个动画的 deform 都首尾闭合，
    // 切成任何一台动画看，裙摆都不会在接缝处跳一下。
    for (const [id, animation] of Object.entries(animations)) {
        const duration = animationDurationOf(id, options.animationSettings ?? {});
        for (const [name, deform] of Object.entries(options.deforms ?? {})) {
            const grid = meshGridOf(options.meshes?.[name], byName.get(name));
            if (grid === undefined || deform === null || deform === undefined)
                continue;
            const frames = [];
            for (let i = 0; i <= ANIMATION_DEFORM_SAMPLES; i++) {
                const at = (i / ANIMATION_DEFORM_SAMPLES) * duration;
                const { offsets } = buildWaveDeform({
                    mesh: grid.mesh,
                    width: grid.width,
                    height: grid.height,
                    phase: at / Math.max(0.01, deform.duration),
                    amplitude: deform.amplitude,
                    cycles: deform.cycles,
                    direction: deform.direction,
                    anchor: deform.anchor
                });
                frames.push({ time: round(at, 4), offset: 0, vertices: offsets });
            }
            animation.deform = animation.deform ?? {};
            animation.deform[name] = { default: frames };
        }
    }
    if (Object.keys(animations).length === 0) {
        warnings.push("没有生成任何动画：所选预设依赖的骨骼名在本次拆件里都不存在");
    }
    const hash = createHash("md5")
        .update(JSON.stringify({ w: options.canvasWidth, h: options.canvasHeight, parts: visible.map((p) => [p.name, p.x, p.y, p.width, p.height]) }))
        .digest("hex")
        .slice(0, 20);
    // ── IK 约束 ──────────────────────────────────────────────────────────
    //
    // 目标骨不在骨架里就补一根：它只是一个**可拖的点**，不带贴图、不参与绘制。
    // 位置取链末端当前的世界坐标，于是「刚加上约束时姿态不变」——用户看到的是
    // 一个可以直接拖的目标点，而不是先跳一下。
    const ik = [];
    const boneParent = new Map(bones.map((bone) => [bone.name, bone.parent]));
    for (const constraint of options.constraints ?? []) {
        if (constraint === null || typeof constraint !== "object")
            continue;
        if (constraint.type !== undefined && constraint.type !== "ik")
            continue;
        const chainLength = Math.max(1, Math.min(8, Math.round(num(constraint.chain, 1))));
        const chain = ikChainOf(boneParent, constraint.bone, chainLength);
        if (chain.length < 2) {
            warnings.push(`IK「${constraint.name}」的链端骨骼不存在或没有父级：${constraint.bone}`);
            continue;
        }
        if (chain[chain.length - 1] !== constraint.bone) {
            warnings.push(`IK「${constraint.name}」的链端骨骼不是 ${constraint.bone}`);
            continue;
        }
        // 链上每根骨都必须有长度，否则余弦定理无从下手（长度 0 的骨在几何上是退化的）。
        const lengths = chain.map((name) => bones.find((bone) => bone.name === name)?.length ?? 0);
        if (lengths.some((value) => value <= 0.01)) {
            warnings.push(`IK「${constraint.name}」的链上有长度为 0 的骨骼（${chain.filter((name, index) => lengths[index] <= 0.01).join("、")}），已跳过`);
            continue;
        }
        const targetName = typeof constraint.target === "string" && constraint.target !== "" ? constraint.target : `${constraint.name}-target`;
        if (!boneNames.has(targetName)) {
            // 目标点落在链末端的**骨尖**上（原点沿自身朝向再走一个 length，和预览器的画法一致）：
            // 加上约束的那一刻姿态不变，用户看到的是一个可以直接拖的点，而不是先跳一下。
            const tip = bones.find((bone) => bone.name === constraint.bone);
            const origin = world.get(constraint.bone) ?? { x: tip.x, y: tip.y, rotation: 0 };
            const dirRad = (origin.rotation * Math.PI) / 180;
            const tipWorldX = origin.x - Math.sin(dirRad) * tip.length;
            const tipWorldY = origin.y + Math.cos(dirRad) * tip.length;
            bones.splice(bones.findIndex((bone) => bone.name === constraint.bone) + 1, 0, { name: targetName, x: round(tipWorldX, 4), y: round(tipWorldY, 4), rotation: 0, length: 0 });
            boneNames.add(targetName);
            boneParent.set(targetName, undefined);
        }
        ik.push({
            name: constraint.name,
            // Spine 4.2：`bones` 是链上的骨骼，**包含末端**、顺序从根到末端
            // （官方示例 `["front-upper-arm","front-lower-arm"]`）。
            // DragonBones 那边要的是「末端骨 + chain 长度」，导出时从这份反推。
            bones: chain,
            target: targetName,
            mix: Math.max(0, Math.min(1, num(constraint.weight, 1))),
            bendPositive: constraint.bendPositive !== false,
            compress: false,
            stretch: false,
            uniform: false,
            // 我们自己的字段：DragonBones 导出要用，Spine 侧会忽略。
            chain: chainLength,
            order: ik.length
        });
    }
    // ── Path 约束 ────────────────────────────────────────────────────────
    //
    // Spine 的 path 约束要求目标是一个**带 PathAttachment 的槽位**，所以这里顺手建一个
    // 无贴图的槽挂在 `root` 上：路径是全局的（当前设计里它不跟随骨骼）。
    // 槽位没有贴图，渲染器取不到 image 就会跳过，不影响绘制顺序。
    const pathConstraints = [];
    for (const [name, entry] of Object.entries(options.paths ?? {})) {
        const chain = (entry.bones ?? []).filter((bone) => boneNames.has(bone));
        if (chain.length === 0) {
            warnings.push(`Path「${name}」没有可用的骨骼链，已跳过`);
            continue;
        }
        if (entry.points.length < 4) {
            warnings.push(`Path「${name}」点数不足，已跳过`);
            continue;
        }
        const spec = { points: entry.points, closed: entry.closed === true };
        const lengths = pathSegmentLengths(spec);
        // 路径点转成**骨骼世界坐标**：槽挂在 root（世界原点），所以 attachment 的顶点
        // 直接用世界坐标即可，不必再相对某根骨骼做一次逆变换。
        const vertices = [];
        for (let i = 0; i + 1 < entry.points.length; i += 2) {
            const world = toWorld(entry.points[i], entry.points[i + 1], options.canvasWidth, options.canvasHeight);
            vertices.push(round(world.x, 3), round(world.y, 3));
        }
        const slotName = `path:${name}`;
        slots.push({ name: slotName, bone: "root", attachment: name });
        attachments[slotName] = {
            [name]: {
                type: "path",
                vertices,
                lengths,
                closed: spec.closed === true,
                // 恒定速度：让沿路径的采样按**弧长**而不是按段索引走，与预览器的算法一致。
                constantSpeed: true
            }
        };
        pathConstraints.push({
            name,
            order: pathConstraints.length,
            bones: chain,
            target: "root",
            // spacing > 0 是「固定间距」，否则「均匀铺满整条路径」。
            positionMode: entry.spacing > 0 ? "fixed" : "percent",
            spacingMode: "length",
            rotateMode: "tangent",
            rotation: 0,
            translateMix: Math.max(0, Math.min(1, num(entry.translateMix, 1))),
            rotateMix: Math.max(0, Math.min(1, num(entry.rotateMix, 1)))
        });
    }
    const spine = {
        skeleton: {
            hash,
            spine: "4.2.0",
            x: -Math.round(options.canvasWidth / 2),
            y: 0,
            width: Math.round(options.canvasWidth),
            height: Math.round(options.canvasHeight),
            images: "./images/"
        },
        bones,
        slots,
        ik: ik.length === 0 ? undefined : ik,
        path: pathConstraints.length === 0 ? undefined : pathConstraints,
        skins: [{ name: "default", attachments }],
        animations
    };
    return { spine, bones, warnings, animationsRaw };
}
function nextPow2(value) {
    let v = Math.max(1, Math.ceil(value)) - 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    return Math.max(v + 1, 1);
}
/**
 * 行式装箱（参考项目 `make_atlas.py` 的同款策略）。
 *
 * 这里不追求最优 packing：部件数量在十几个量级，行式装箱已经足够紧凑，
 * 而且**结果可复现**——同样的输入永远得到同样的 atlas 坐标，
 * 用户重跑不会因为坐标漂移而误以为「产物变了」。
 *
 * 相对参考项目修掉两个缺陷：
 *   ① **超宽件**：它的换行判断只在 `rx + w + padding > atlasW` 时换行，
 *      却从不检查「一件本身就比页宽还宽」，于是 `paste` 静默裁掉超出部分，
 *      `.atlas` 里仍写完整 `size` → 引擎里画出错位图。
 *      这里把页宽的初值取成 `max(面积估算, 最宽件 + 2×padding)`。
 *   ② **无分页**：装不下时按 `maxSize` 开新页，而不是无限长高或静默裁切。
 */
export function packAtlas(sizes, options = {}) {
    const padding = Math.max(0, Math.round(options.padding ?? 2));
    const maxSize = Math.max(16, Math.round(options.maxSize ?? 4096));
    const baseName = options.pageName ?? "skeleton.png";
    /** 首页用原名；第二页起在扩展名前插序号。 */
    const pageNameOf = (index) => {
        if (index === 0)
            return baseName;
        const dot = baseName.lastIndexOf(".");
        return dot === -1 ? `${baseName}${index + 1}` : `${baseName.slice(0, dot)}${index + 1}${baseName.slice(dot)}`;
    };
    if (sizes.length === 0)
        return { pages: [] };
    const totalArea = sizes.reduce((sum, item) => sum + item.width * item.height, 0);
    const widest = Math.max(...sizes.map((item) => item.width + padding * 2));
    let pageWidth = nextPow2(Math.max(Math.sqrt(totalArea) * 1.3, widest));
    // 页宽被 maxSize 夹住时，比 maxSize 还宽的件就真的放不下了——这一条由
    // `validateAtlas` 报出来，这里不静默裁切。
    if (pageWidth > maxSize)
        pageWidth = maxSize;
    const sorted = [...sizes].sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
    const pages = [];
    let current = {
        width: pageWidth,
        height: 0,
        placements: [],
        cursorX: padding,
        cursorY: padding,
        rowHeight: 0,
        maxWidth: 0
    };
    const flush = () => {
        if (current.placements.length === 0)
            return;
        pages.push({
            name: pageNameOf(pages.length),
            width: nextPow2(Math.min(Math.max(current.maxWidth, pageWidth), maxSize)),
            height: nextPow2(current.cursorY + current.rowHeight + padding),
            placements: current.placements
        });
    };
    for (const item of sorted) {
        if (current.cursorX + item.width + padding > pageWidth) {
            current.cursorX = padding;
            current.cursorY += current.rowHeight + padding;
            current.rowHeight = 0;
        }
        // 换行之后仍然超出本页高度上限 → 开新页。
        if (current.cursorY + item.height + padding > maxSize) {
            flush();
            current = { width: pageWidth, height: 0, placements: [], cursorX: padding, cursorY: padding, rowHeight: 0, maxWidth: 0 };
        }
        current.placements.push({
            name: item.name,
            x: current.cursorX,
            y: current.cursorY,
            width: item.width,
            height: item.height,
            origWidth: item.origWidth,
            origHeight: item.origHeight,
            offsetX: item.offsetX,
            offsetY: item.offsetY
        });
        current.maxWidth = Math.max(current.maxWidth, current.cursorX + item.width + padding);
        current.rowHeight = Math.max(current.rowHeight, item.height);
        current.cursorX += item.width + padding;
    }
    flush();
    return { pages };
}
/**
 * 生成 Spine `.atlas` 文本（与参考项目 `make_atlas.py` 输出格式一致）。
 *
 * 与参考项目的差别：`orig` / `offset` 写**真实值**。它恒写 `orig == size` 且
 * `offset: 0, 0`，等于永远不裁透明边、也永远不记录裁剪偏移；一旦源图有透明边，
 * 整张图（含空白）都会被塞进图集，白白撑大体积。
 */
export function buildAtlasText(pages) {
    const lines = [];
    for (const page of pages) {
        lines.push(page.name, `size: ${page.width},${page.height}`, "format: RGBA8888", "filter: Linear,Linear", "repeat: none");
        for (const item of page.placements) {
            const origWidth = item.origWidth ?? item.width;
            const origHeight = item.origHeight ?? item.height;
            lines.push(item.name, "  rotate: false", `  xy: ${item.x}, ${item.y}`, `  size: ${item.width}, ${item.height}`, `  orig: ${origWidth}, ${origHeight}`, `  offset: ${item.offsetX ?? 0}, ${item.offsetY ?? 0}`, "  index: -1");
        }
    }
    return `${lines.join("\n")}\n`;
}
export const SPINE_VERSION = "4.2.0";
