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

export interface RigSlotDef {
  name: string;
  label: string;
  /** 骨骼层级里的父骨骼名；`undefined` 表示直接挂在 root 下。 */
  parent?: string;
  /** 近端锚点（相对部件包围盒的归一化坐标，x 向右、y 向下）。 */
  proximal: [number, number];
  /** 远端锚点。骨骼方向 = 近端 → 远端。 */
  distal: [number, number];
}

const P_TOP: [number, number] = [0.5, 0];
const P_BOTTOM: [number, number] = [0.5, 1];

/** 逐个写清楚，是因为层级、锚点和中文名三者互相耦合，用表驱动最容易核对。 */
export const RIG_SLOTS: RigSlotDef[] = [
  { name: "head", label: "头部", parent: "neck", proximal: P_BOTTOM, distal: P_TOP },
  { name: "neck", label: "脖子", parent: "torso", proximal: P_BOTTOM, distal: P_TOP },
  { name: "torso", label: "躯干", parent: "hip", proximal: P_BOTTOM, distal: P_TOP },
  { name: "hip", label: "胯部", parent: undefined, proximal: P_BOTTOM, distal: P_TOP },

  { name: "left-upper-arm", label: "左上臂", parent: "torso", proximal: P_TOP, distal: P_BOTTOM },
  { name: "left-lower-arm", label: "左小臂", parent: "left-upper-arm", proximal: P_TOP, distal: P_BOTTOM },
  { name: "right-upper-arm", label: "右上臂", parent: "torso", proximal: P_TOP, distal: P_BOTTOM },
  { name: "right-lower-arm", label: "右小臂", parent: "right-upper-arm", proximal: P_TOP, distal: P_BOTTOM },

  { name: "left-hand", label: "左手", parent: "left-lower-arm", proximal: P_TOP, distal: P_BOTTOM },
  { name: "right-hand", label: "右手", parent: "right-lower-arm", proximal: P_TOP, distal: P_BOTTOM },
  { name: "left-upper-leg", label: "左大腿", parent: "hip", proximal: P_TOP, distal: P_BOTTOM },
  { name: "right-upper-leg", label: "右大腿", parent: "hip", proximal: P_TOP, distal: P_BOTTOM },

  { name: "left-lower-leg", label: "左小腿", parent: "left-upper-leg", proximal: P_TOP, distal: P_BOTTOM },
  { name: "right-lower-leg", label: "右小腿", parent: "right-upper-leg", proximal: P_TOP, distal: P_BOTTOM },
  { name: "left-foot", label: "左脚", parent: "left-lower-leg", proximal: P_TOP, distal: P_BOTTOM },
  { name: "right-foot", label: "右脚", parent: "right-lower-leg", proximal: P_TOP, distal: P_BOTTOM }
];

const SLOT_BY_NAME = new Map(RIG_SLOTS.map((slot) => [slot.name, slot]));

export function rigSlotOf(name: string): RigSlotDef | undefined {
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
export const DEFAULT_DRAW_ORDER: string[] = [
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
export function drawRankOf(name: string): number {
  const index = DEFAULT_DRAW_ORDER.indexOf(name);
  return index === -1 ? -1 : index;
}

export function defaultPartNames(): string[] {
  return RIG_SLOTS.map((slot) => slot.name);
}

export function partLabel(name: string): string {
  return SLOT_BY_NAME.get(name)?.label ?? name;
}

/**
 * 任意部件名的语义父骨骼。
 *
 * 默认网格之外的部件（用户自己命名的「披风」「法杖」……）也要能挂进骨架：
 * 先按关键词猜一个合理宿主，猜不到就挂到躯干上——总比散落一地强。
 */
export function parentBoneOf(name: string): string | undefined {
  const known = SLOT_BY_NAME.get(name);
  if (known !== undefined) return known.parent;
  const lower = name.toLowerCase();
  const has = (...keys: string[]) => keys.some((key) => lower.includes(key));
  const side = has("left", "左") ? "left" : has("right", "右") ? "right" : "";
  if (has("hair", "hat", "cap", "helmet", "horn", "ear", "eye", "face", "发", "帽", "盔", "角")) return "head";
  if (has("beard", "scarf", "cape", "wing", "back", "披风", "翅膀", "背包")) return "torso";
  if (has("weapon", "sword", "blade", "shield", "staff", "gun", "刀", "剑", "盾", "杖")) return side === "" ? "torso" : `${side}-hand`;
  if (has("arm", "hand", "臂", "手")) return side === "" ? "torso" : `${side}-upper-arm`;
  if (has("leg", "foot", "feet", "thigh", "shin", "腿", "脚", "足")) return side === "" ? "hip" : `${side}-upper-leg`;
  if (has("tail", "skirt", "belt", "hip", "pelvis", "腰", "裙", "尾")) return "hip";
  return "torso";
}

/** 默认网格之外部件的锚点规则：整体朝上，绕包围盒底边中点旋转。 */
export function anchorsOf(name: string): { proximal: [number, number]; distal: [number, number] } {
  const known = SLOT_BY_NAME.get(name);
  if (known !== undefined) return { proximal: known.proximal, distal: known.distal };
  return { proximal: P_BOTTOM, distal: P_TOP };
}

// ── 动画预设 ────────────────────────────────────────────────────────────

export interface RigAnimationPreset {
  id: string;
  label: string;
  /** 循环时长（秒）。 */
  duration: number;
  /** 一句话说明这个动作在做什么，界面与验收包都用它。 */
  summary: string;
}

export const RIG_ANIMATIONS: RigAnimationPreset[] = [
  { id: "idle", label: "待机", duration: 1.6, summary: "呼吸起伏 + 躯干/头部反向轻摆，首尾闭合可循环" },
  { id: "walk", label: "行走", duration: 0.8, summary: "手臂与腿反向摆动，胯部上下颠簸" },
  { id: "run", label: "奔跑", duration: 0.5, summary: "行走的夸张版 + 前倾 + 更大的弹跳" },
  { id: "wave", label: "挥手", duration: 1.2, summary: "抬起右臂，小臂来回摆动" },
  { id: "jump", label: "跳跃", duration: 1.0, summary: "下蹲蓄力 → 起跳 → 滞空 → 落地缓冲" },
  { id: "attack", label: "攻击", duration: 0.6, summary: "抬手蓄力 → 挥砍 → 收势跟随" }
];

const ANIMATION_IDS = new Set(RIG_ANIMATIONS.map((item) => item.id));

export function isAnimationId(value: unknown): value is string {
  return typeof value === "string" && ANIMATION_IDS.has(value);
}

export function defaultAnimationIds(): string[] {
  return ["idle", "walk", "run", "wave", "jump", "attack"];
}

// 缓动曲线（归一化控制点，与参考项目一致）。
const EASE = [0.25, 0, 0.75, 1];
const EASE_IN = [0.42, 0, 1, 1];
const EASE_OUT = [0, 0, 0.58, 1];
const EASE_FAST = [0.4, 0, 0.2, 1];

type Curve = number[] | "stepped" | null;

interface AuthoredKeyframe {
  time: number;
  angle?: number;
  x?: number;
  y?: number;
  curve?: Curve;
}

function kf(time: number, angle?: number, x?: number, y?: number, curve: Curve = EASE): AuthoredKeyframe {
  const frame: AuthoredKeyframe = { time: round(time, 4) };
  if (angle !== undefined) frame.angle = round(angle, 2);
  if (x !== undefined) frame.x = round(x, 2);
  if (y !== undefined) frame.y = round(y, 2);
  if (curve) frame.curve = curve;
  return frame;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 骨骼名 → （时间轴类型 → 关键帧数组）。时间轴类型目前只有 rotate / translate。 */
type BoneTimelines = Record<string, Record<string, AuthoredKeyframe[]>>;;
type BoneSet = Set<string>;

function has(bones: BoneSet, ...names: string[]): boolean {
  return names.some((name) => bones.has(name));
}

function genIdle(B: BoneSet): BoneTimelines {
  const bones: BoneTimelines = {};
  const D = 1.6;
  const sway: Array<[string, number, number]> = [
    ["torso", 1.5, 0.5],
    ["neck", 1.0, 0.55],
    ["head", -2.0, 0.6]
  ];
  for (const [name, amp, phase] of sway) {
    if (!B.has(name)) continue;
    bones[name] = { rotate: [kf(0, 0, undefined, undefined, null), kf(D * phase, amp), kf(D, 0)] };
  }
  if (B.has("torso")) {
    bones.torso = bones.torso ?? {};
    bones.torso.translate = [kf(0, undefined, 0, 0, null), kf(D * 0.5, undefined, 0, 1.5), kf(D, undefined, 0, 0)];
  }
  for (const side of ["left", "right"]) {
    const s = side === "left" ? 1 : -1;
    const parts: Array<[string, number, number]> = [
      [`${side}-upper-arm`, s * 1.5, 0.5],
      [`${side}-lower-arm`, s * 1.0, 0.55]
    ];
    for (const [part, amp, phase] of parts) {
      if (!B.has(part)) continue;
      bones[part] = { rotate: [kf(0, 0, undefined, undefined, null), kf(D * phase, amp), kf(D, 0)] };
    }
  }
  return bones;
}

function genWalk(B: BoneSet): BoneTimelines {
  const bones: BoneTimelines = {};
  const D = 0.8;
  const Q = D / 4;
  const segments = (values: number[]) => values.map((value, index) => kf(index * Q, value, undefined, undefined, index === 0 ? null : EASE));

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
  if (B.has("torso")) bones.torso = { rotate: segments([0, 3, 0, -3, 0]) };
  if (B.has("head")) bones.head = { rotate: segments([0, -1.5, 0, 1.5, 0]) };

  for (const [side, shift] of [["left", 0], ["right", 0.5]] as Array<[string, number]>) {
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

  for (const [side, shift] of [["left", 0.5], ["right", 0]] as Array<[string, number]>) {
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

function genRun(B: BoneSet): BoneTimelines {
  const bones: BoneTimelines = {};
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

  for (const [side, ph] of [["left", 0], ["right", 0.5]] as Array<[string, number]>) {
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

  for (const [side, ph] of [["left", 0.5], ["right", 0]] as Array<[string, number]>) {
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

function genWave(B: BoneSet): BoneTimelines {
  const bones: BoneTimelines = {};
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

function genJump(B: BoneSet): BoneTimelines {
  const bones: BoneTimelines = {};
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

function genAttack(B: BoneSet): BoneTimelines {
  const bones: BoneTimelines = {};
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

const PRESETS: Record<string, (bones: BoneSet) => BoneTimelines> = {
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
const TIMELINE_PROPERTIES: Record<string, Array<[string, number]>> = {
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
export function timelinePropertyCount(kind: string): number {
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
function convertTimeline(kind: string, frames: any[]): void {
  const properties = TIMELINE_PROPERTIES[kind];
  if (properties === undefined || frames.length < 2) return;

  if (kind === "rotate") {
    for (const frame of frames) {
      if (frame.angle !== undefined) {
        frame.value = frame.angle;
        delete frame.angle;
      }
    }
  }

  const authored: Curve[] = frames.map((frame) => {
    const curve = frame.curve ?? null;
    delete frame.curve;
    return curve as Curve;
  });

  for (let i = 0; i < frames.length - 1; i++) {
    const curve = authored[i + 1];
    if (curve === null || curve === undefined) continue;
    if (curve === "stepped") {
      frames[i].curve = "stepped";
      continue;
    }
    if (!Array.isArray(curve) || curve.length < 4) continue;

    const [cx1, cy1, cx2, cy2] = curve;
    const time1 = frames[i].time;
    const time2 = frames[i + 1].time;
    const span = time2 - time1;
    const absolute: number[] = [];
    for (const [name, fallback] of properties) {
      const value1 = frames[i][name] ?? fallback;
      const value2 = frames[i + 1][name] ?? fallback;
      const delta = value2 - value1;
      absolute.push(
        round(time1 + span * cx1, 6),
        round(value1 + delta * cy1, 6),
        round(time1 + span * cx2, 6),
        round(value1 + delta * cy2, 6)
      );
    }
    frames[i].curve = absolute;
  }
}

function toSpine42(animations: Record<string, any>): void {
  for (const animation of Object.values(animations)) {
    const bones = animation?.bones;
    if (bones === null || typeof bones !== "object") continue;
    for (const timelines of Object.values<any>(bones)) {
      for (const [kind, frames] of Object.entries<any>(timelines)) {
        if (Array.isArray(frames)) convertTimeline(kind, frames);
      }
    }
  }
}

/** 生成全部预设动画。传入的 `boneNames` 决定哪些骨骼会被写到。 */
export function buildAnimations(boneNames: string[], ids: string[]): Record<string, any> {
  const set = new Set(boneNames);
  const animations: Record<string, any> = {};
  for (const id of ids) {
    const generator = PRESETS[id];
    if (generator === undefined) continue;
    const bones = generator(set);
    if (Object.keys(bones).length > 0) animations[id] = { bones };
  }
  toSpine42(animations);
  return animations;
}

// ── 从装配结果构建骨架 ──────────────────────────────────────────────────

export interface RigPlacedPart {
  name: string;
  /** 相对任务目录的图片路径。 */
  file: string;
  /** 在参考画布上的像素位置（左上角，Y 向下）。 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 相对原始 PNG 的缩放。 */
  scale: number;
  /** 旋转（度）。 */
  rotation: number;
  /** 绘制顺序，0 = 最靠后。 */
  z: number;
  score?: number;
  method?: string;
  manual?: boolean;
  hidden?: boolean;
  /**
   * 语义层给出的父部件名（`rigsemantics.ts`）。给了就用它，没给才回落到
   * 按名字关键词猜——这是「语义显式化」在骨骼推导上的落点：
   * 用户/AI 改一次 `parent`，骨架立刻跟着变，不必去调名字。
   */
  parent?: string;
  /** 语义层给出的锚点（归一化到部件包围盒，y 向下）。 */
  proximal?: [number, number];
  distal?: [number, number];
  /**
   * **手工偏移**（三通道模型的中间那一层）。
   *
   * DragonBones 的 `Bone.offsetMode = Additive` 把局部姿势拆成三段相加：
   *   `local = origin ⊕ offset ⊕ animationPose`
   * 我们这里没有独立的 animationPose（动画直接写时间轴），但把 `origin` 与
   * `offset` 分开同样有意义：
   *   - `origin` 由装配/语义**算出来**，每次重跑都会被重算；
   *   - `offset` 由**人**给出，任何自动重跑都不会碰它。
   * 于是「AI 重新推一遍骨骼」与「人手调过的偏置」不再互相覆盖——
   * 这正是 reskin-app 那套「两套变换语义冲突、拖好的位置导出后全丢」的反面。
   *
   * 目前只支持**平移与旋转**：Spine 的 bone setup 可以带 scale，但预览播放器
   * 的骨骼世界变换还没传播缩放，加上去会变成「导出有效、预览看不到」的假象。
   * 宁可先不给，也不要给一个只在导出处生效的开关。
   */
  offset?: { x?: number; y?: number; rotation?: number };
}

export interface BuildSkeletonOptions {
  name?: string;
  canvasWidth: number;
  canvasHeight: number;
  parts: RigPlacedPart[];
  animationIds: string[];
  customAnimations?: Record<string, any>;
}

interface Bone {
  name: string;
  parent?: string;
  x: number;
  y: number;
  rotation: number;
  length: number;
}

interface WorldPoint {
  x: number;
  y: number;
  rotation: number;
}

/** 图片像素坐标 → Spine 世界坐标（Y 翻转、水平以画布中心为 0）。 */
function toWorld(px: number, py: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
  return { x: px - canvasWidth / 2, y: canvasHeight - py };
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeAngle(value: number): number {
  let angle = value % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
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
export function buildSkeleton(options: BuildSkeletonOptions): { spine: any; bones: Bone[]; warnings: string[] } {
  const warnings: string[] = [];
  const visible = options.parts.filter((part) => part.hidden !== true);
  const byName = new Map(visible.map((part) => [part.name, part]));

  // 只需要「这个部件在哪个骨骼上」——骨骼名与部件名一一对应，少一层心智负担。
  const boneNames = new Set(visible.map((part) => part.name));
  boneNames.add("root");

  /** 解析父骨骼：显式语义优先，其次按名字关键词猜；不存在或成环时退回到 torso / hip / root。 */
  const resolveParent = (name: string, seen: Set<string>): string | undefined => {
    // ① 语义层显式指定的父级优先。它可能指向一个被隐藏/未生成的部件——
    //    那种情况下不能让骨架断链，所以继续走 ②。
    const explicit = byName.get(name)?.parent;
    let parent: string | undefined =
      explicit !== undefined && explicit !== name && boneNames.has(explicit) ? explicit : undefined;

    // ② 按名字关键词沿语义链往上找第一个真实存在的骨骼。
    //    加 guard 是因为 `parentBoneOf` 的关键词规则本身可能成环
    //    （例如某个名字同时命中两组关键词），无界循环会让整个推导卡死。
    if (parent === undefined) {
      const guard = new Set<string>();
      let cursor = parentBoneOf(name);
      while (cursor !== undefined && !guard.has(cursor)) {
        guard.add(cursor);
        if (cursor !== name && boneNames.has(cursor)) {
          parent = cursor;
          break;
        }
        const next = parentBoneOf(cursor);
        if (next === cursor) break;
        cursor = next;
      }
    }

    // 语义链可能绕回自己（例如「胯部」的父级按语义也算胯部），必须在这里断开，
    // 否则骨骼表里会出现 parent == name 的自环，渲染时无限递归。
    if (parent === name) parent = undefined;
    if (parent !== undefined && seen.has(parent)) {
      warnings.push(`骨骼 ${name} 的父级形成了环，已改挂到 root`);
      parent = undefined;
    }
    if (parent === undefined && name !== "root") {
      // 兜底宿主：优先躯干，其次胯部；都不能用（自己就是它）时才挂到 root。
      if (byName.has("torso") && name !== "torso") parent = "torso";
      else if (byName.has("hip") && name !== "hip") parent = "hip";
    }
    return parent;
  };

  // 拓扑排序：父骨骼永远排在子骨骼前面。
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string, stack: Set<string>): void => {
    if (visited.has(name)) return;
    if (stack.has(name)) return;
    stack.add(name);
    if (name !== "root") {
      const parent = resolveParent(name, stack);
      if (parent !== undefined) visit(parent, stack);
    }
    stack.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of visible.map((part) => part.name)) visit(name, new Set());

  const world = new Map<string, WorldPoint>();
  world.set("root", { x: 0, y: 0, rotation: 0 });

  const bones: Bone[] = [{ name: "root", x: 0, y: 0, rotation: 0, length: 0 }];
  const attachments: Record<string, Record<string, any>> = {};
  const slots: Array<{ name: string; bone: string; attachment: string }> = [];

  const sorted = [...visible].sort((a, b) => a.z - b.z);

  for (const name of ordered) {
    if (name === "root") continue;
    const part = byName.get(name);
    if (part === undefined) continue;

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
    const dist = toWorld(distPx, distPy, options.canvasWidth, options.canvasHeight);
    const center = toWorld(centerPx, centerPy, options.canvasWidth, options.canvasHeight);

    const dirX = dist.x - prox.x;
    const dirY = dist.y - prox.y;
    const length = Math.hypot(dirX, dirY) || Math.max(1, Math.max(part.width, part.height));
    const worldRot = deg(Math.atan2(-dirX, dirY));

    const parentName = resolveParent(name, new Set());
    const parentWorld = world.get(parentName ?? "root") ?? world.get("root")!;

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
      [name]: {
        x: round(offX * cosB - offY * sinB, 4),
        y: round(offX * sinB + offY * cosB, 4),
        // 挂点自身旋转 = 抵消骨骼朝向（让初始姿态正立）+ 手动装配里拧的角度。
        rotation: normalizeAngle(-worldRot + (part.rotation ?? 0)),
        width: round(part.width, 4),
        height: round(part.height, 4)
      }
    };
    slots.push({ name, bone: name, attachment: name });
  }

  // slots 的顺序即绘制顺序：越靠前画得越早（越靠后）。按 z 升序排。
  slots.sort((a, b) => {
    const za = visible.find((part) => part.name === a.name)?.z ?? 0;
    const zb = visible.find((part) => part.name === b.name)?.z ?? 0;
    return za - zb;
  });

  const animations = buildAnimations(
    bones.map((bone) => bone.name),
    options.animationIds
  );
  if (options.customAnimations !== undefined) {
    for (const [key, value] of Object.entries(options.customAnimations)) animations[key] = value;
    toSpine42(animations);
  }
  if (Object.keys(animations).length === 0) {
    warnings.push("没有生成任何动画：所选预设依赖的骨骼名在本次拆件里都不存在");
  }

  const hash = createHash("md5")
    .update(JSON.stringify({ w: options.canvasWidth, h: options.canvasHeight, parts: visible.map((p) => [p.name, p.x, p.y, p.width, p.height]) }))
    .digest("hex")
    .slice(0, 20);

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
    skins: [{ name: "default", attachments }],
    animations
  };

  return { spine, bones, warnings };
}

// ── 图集 ────────────────────────────────────────────────────────────────

export interface AtlasPlacement {
  name: string;
  x: number;
  y: number;
  /** 在图集里实际占用的尺寸（**裁剪后**的尺寸）。 */
  width: number;
  height: number;
  /**
   * 未裁剪的原始尺寸。Spine 用 `orig` 确定渲染尺寸、用 `offset` 把裁剪后的
   * 区域摆回原位——所以「图集里放的是裁掉透明边的小图」不等于「部件变小了」。
   *
   * 缺省等于 `width`/`height`（未裁剪）。
   */
  origWidth?: number;
  origHeight?: number;
  /** 裁剪偏移，通常是负数（Spine 的 `offset:` 语义）。缺省 `0, 0`。 */
  offsetX?: number;
  offsetY?: number;
}

export interface AtlasPage {
  /** 页面图片名（写进 `.atlas` 的第一行）。 */
  name: string;
  width: number;
  height: number;
  placements: AtlasPlacement[];
}

export interface AtlasPageInput {
  name: string;
  width: number;
  height: number;
  origWidth?: number;
  origHeight?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface AtlasPackResult {
  /**
   * 图集页。绝大多数情况下只有一页；单页装不下（超过 `maxSize`）时才分页——
   * 参考项目的打包器**没有分页**，超过上限会静默裁切，`.atlas` 里却仍写完整尺寸，
   * 到引擎里就是错位的图。
   */
  pages: AtlasPage[];
}

export interface AtlasPackOptions {
  padding?: number;
  /** 单页最大边长（2 的幂）。超过就分页。默认 4096。 */
  maxSize?: number;
  /**
   * 第一页的图片文件名；多页时第二页起是 `xxx2.png`、`xxx3.png`。
   *
   * 由打包器统一命名，而不是留给调用方在外面补——页名写进 `.atlas` 的第一行，
   * 和磁盘上的文件名必须严格一致，漏了就是「整张图找不到」。
   */
  pageName?: string;
}

function nextPow2(value: number): number {
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
export function packAtlas(sizes: AtlasPageInput[], options: AtlasPackOptions = {}): AtlasPackResult {
  const padding = Math.max(0, Math.round(options.padding ?? 2));
  const maxSize = Math.max(16, Math.round(options.maxSize ?? 4096));
  const baseName = options.pageName ?? "skeleton.png";
  /** 首页用原名；第二页起在扩展名前插序号。 */
  const pageNameOf = (index: number): string => {
    if (index === 0) return baseName;
    const dot = baseName.lastIndexOf(".");
    return dot === -1 ? `${baseName}${index + 1}` : `${baseName.slice(0, dot)}${index + 1}${baseName.slice(dot)}`;
  };
  if (sizes.length === 0) return { pages: [] };

  const totalArea = sizes.reduce((sum, item) => sum + item.width * item.height, 0);
  const widest = Math.max(...sizes.map((item) => item.width + padding * 2));
  let pageWidth = nextPow2(Math.max(Math.sqrt(totalArea) * 1.3, widest));
  // 页宽被 maxSize 夹住时，比 maxSize 还宽的件就真的放不下了——这一条由
  // `validateAtlas` 报出来，这里不静默裁切。
  if (pageWidth > maxSize) pageWidth = maxSize;

  const sorted = [...sizes].sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  const pages: AtlasPage[] = [];
  let current: { width: number; height: number; placements: AtlasPlacement[]; cursorX: number; cursorY: number; rowHeight: number; maxWidth: number } = {
    width: pageWidth,
    height: 0,
    placements: [],
    cursorX: padding,
    cursorY: padding,
    rowHeight: 0,
    maxWidth: 0
  };

  const flush = (): void => {
    if (current.placements.length === 0) return;
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
export function buildAtlasText(pages: AtlasPage[]): string {
  const lines: string[] = [];
  for (const page of pages) {
    lines.push(page.name, `size: ${page.width},${page.height}`, "format: RGBA8888", "filter: Linear,Linear", "repeat: none");
    for (const item of page.placements) {
      const origWidth = item.origWidth ?? item.width;
      const origHeight = item.origHeight ?? item.height;
      lines.push(
        item.name,
        "  rotate: false",
        `  xy: ${item.x}, ${item.y}`,
        `  size: ${item.width}, ${item.height}`,
        `  orig: ${origWidth}, ${origHeight}`,
        `  offset: ${item.offsetX ?? 0}, ${item.offsetY ?? 0}`,
        "  index: -1"
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export const SPINE_VERSION = "4.2.0";
