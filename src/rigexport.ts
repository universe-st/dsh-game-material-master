/**
 * 导出器：DragonBones 5.5（`_ske.json` + `_tex.json`）。
 *
 * 为什么要有第二条导出路径：Spine 只覆盖「Spine 运行时」这一半生态，
 * 而 2D 骨骼在国内更多项目用的是 DragonBones（Cocos / Egret / Laya 都自带）。
 * 同一个 `RigDocument` 导出两种格式，成本主要在**两边的语义差分**上——
 * 下面三条是照着 DragonBonesJS 的解析器逐行核对出来的，写错了都是静默坏掉：
 *
 * 1. **`tweenEasing` 缺省 = 阶跃**（`ObjectDataParser._parseTweenFrame`：
 *    缺省 `-2` = `TweenType.None`）。所以每个补间帧都必须**显式**写 `tweenEasing: 0`
 *    （或真实缓动值），否则动画会一跳一跳。
 * 2. **`curve` 是 0~1 归一化**的，而 Spine 4.2 是**绝对量**（时间 / 数值同单位）。
 *    同一份简写动画的两条导出路径必须用**不同的**编码器——这条是 §7.3 里点名
 *    最容易搞错的一处。紧凑式要求长度 `% 3 === 1`（如 4：首锚 `(0,0)`、末锚 `(1,1)` 省略）。
 * 3. **`duration` 单位不同**：Spine 是秒，DragonBones 是**帧数**。
 *
 * 另外两条不在方案里、但决定「画出来对不对」的差分，也在这里定死：
 *
 * - **图片挂点的位置信息不在 attachment 上，而在 `pivot` + `frame*` 上**。
 *   渲染时 `_pivotX = pivot.x * frameWidth + frameX`，图片左上角画在 `-pivot`
 *   处（`dragonBones/armature/Slot.ts:409-461`）。所以「图片中心落在骨骼原点」
 *   这件事要靠 `pivot = 0.5/0.5` + `frameX = 裁剪偏移` 一起凑出来，裁剪过的部件
 *   少给 `frame*` 就会整体偏掉。
 * - **坐标系是 y 向下**（`DragonBones.yDown` 默认 `true`），与我们的图像坐标一致，
 *   旋转角不需要取反。
 */

import type { AtlasPage } from "./spine.js";
import { animationPresetOf } from "./spine.js";

export const DRAGONBONES_VERSION = "5.5";
export const DRAGONBONES_COMPATIBLE_VERSION = "5.5";
/**
 * 与 `spine.ts` 的动画预设时长单位（秒）换算用。
 *
 * 方案建议固定 30：它是 2D 骨骼的常用帧率，且我们的关键帧时间都是 0.05s 的整数倍，
 * 乘 30 之后基本上都落在整数帧上，不会因为取整把循环时长改掉。
 */
export const DRAGONBONES_FRAME_RATE = 30;

/** `-2` = `TweenType.None`（阶跃）。 */
export const TWEEN_STEPPED = -2;
/** `0` = `TweenType.Line`（线性）。 */
export const TWEEN_LINEAR = 0;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 把简写的归一化控制点编成 DragonBones 的 `curve`。
 *
 * 简写里一条 curve 就是 4 个数 `[cx1, cy1, cx2, cy2]`（首尾锚点隐含为
 * `(0,0)` 与 `(1,1)`），长度 `4 % 3 === 1` —— 正好是解析器的**紧凑式**，
 * 直接原样写即可。**不能**照搬 Spine 那条路：那边会先乘上时间跨度与数值差，
 * 写出去就是绝对量，DragonBones 按 0~1 解释会得到完全不同的曲线。
 */
export function encodeDragonBonesCurve(control: number[]): number[] | undefined {
  if (control.length < 4) return undefined;
  if (control.length % 3 !== 1) return undefined;
  return control.map((value) => round(value, 4));
}

/** 简写时间轴类型 → DragonBones 的帧数组字段名与取值方式。 */
const TIMELINE_KINDS: Record<string, { frameKey: string; valueOf: (frame: any) => Record<string, number> }> = {
  rotate: {
    frameKey: "rotateFrame",
    valueOf: (frame) => ({ rotate: round(num(frame.angle, 0), 4) })
  },
  translate: {
    frameKey: "translateFrame",
    valueOf: (frame) => ({ x: round(num(frame.x, 0), 4), y: round(num(frame.y, 0), 4) })
  },
  scale: {
    frameKey: "scaleFrame",
    valueOf: (frame) => ({ x: round(num(frame.x, 1), 4), y: round(num(frame.y, 1), 4) })
  }
};

/**
 * 一条简写时间轴 → DragonBones 帧数组。
 *
 * 两处必须小心：
 * - **缓动挂在段起点上**。简写把 curve 挂在**段终点**那一帧（见 `spine.ts` 的
 *   `convertTimeline` 注释），而 DragonBones 的 `tweenEasing` / `curve` 描述的是
 *   **从本帧开始**的那一段，所以要整体前移一帧取。
 * - **最后一帧的 `duration` 被解析器忽略**（`_parseTimeline` 用
 *   `frameCount - frameStart` 兜底），而**中间帧 `duration: 0` 会被当成阶跃**
 *   （`frameCount > 0` 才走补间分支）。所以中间帧至少要 1 帧，校验器盯着这条。
 */
export function buildDragonBonesTimeline(kind: string, frames: any[], frameRate: number): any[] {
  const spec = TIMELINE_KINDS[kind];
  if (spec === undefined) return [];
  const positions = frames.map((frame) => Math.round(num(frame.time, 0) * frameRate));
  const out: any[] = [];
  for (let i = 0; i < frames.length; i++) {
    const isLast = i === frames.length - 1;
    const duration = isLast ? 0 : positions[i + 1] - positions[i];
    const entry: any = { duration, ...spec.valueOf(frames[i]) };
    if (!isLast) {
      const authored = frames[i + 1]?.curve;
      const curve = Array.isArray(authored) ? encodeDragonBonesCurve(authored) : undefined;
      if (curve !== undefined) {
        entry.curve = curve;
      } else if (authored === "stepped") {
        entry.tweenEasing = TWEEN_STEPPED;
      } else {
        // 缺省是阶跃，线性必须显式写出来。
        entry.tweenEasing = TWEEN_LINEAR;
      }
    }
    out.push(entry);
  }
  return out;
}

export interface DragonBonesSkeletonOptions {
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  /** `buildSkeleton` 的产物（Spine 4.2 JSON）：骨骼 / 槽位 / 挂点都从它读。 */
  spine: any;
  /** `buildAnimationShorthands` 的产物（**简写**，curve 是 0~1）。 */
  animations: Record<string, any>;
  frameRate?: number;
}

/**
 * 生成 DragonBones 的 `_ske.json`。
 *
 * 骨骼与挂点直接由 Spine 那份派生：两者在「骨骼层级 + 局部平移/旋转」上是同构的，
 * 差分只在字段名与坐标落点（见文件头注释）。图片一律走 `pivot = 0.5/0.5` +
 * `transform.x/y = attachment 的挂点位置`，这样「图片中心落在挂点上」的语义两边一致。
 */
export function buildDragonBonesSkeleton(options: DragonBonesSkeletonOptions): any {
  const frameRate = options.frameRate ?? DRAGONBONES_FRAME_RATE;
  const spine = options.spine;
  const bones: any[] = (spine?.bones ?? []).map((bone: any) => {
    const rotation = round(num(bone.rotation, 0), 4);
    return {
      name: bone.name,
      ...(bone.parent === undefined ? {} : { parent: bone.parent }),
      length: round(num(bone.length, 0), 4),
      transform: {
        x: round(num(bone.x, 0), 4),
        y: round(num(bone.y, 0), 4),
        // `skX === skY` 时 `skew === 0`；故意不引入双角度，见方案 §7.3。
        skX: rotation,
        skY: rotation,
        scX: 1,
        scY: 1
      },
      inheritTranslation: true,
      inheritRotation: true,
      inheritScale: true,
      inheritReflection: true
    };
  });

  const slots: any[] = (spine?.slots ?? []).map((slot: any) => ({
    name: slot.name,
    parent: slot.bone,
    displayIndex: 0
  }));

  const attachments: Record<string, any> = spine?.skins?.[0]?.attachments ?? {};
  const skinSlots: any[] = (spine?.slots ?? []).map((slot: any) => {
    const attachment = attachments[slot.name]?.[slot.attachment] ?? {};
    const rotation = round(num(attachment.rotation, 0), 4);
    // 有网格的部件出 `mesh`，其余出 `image`。
    // 顶点沿用骨架里的坐标（部件中心为原点），两条导出路径共用同一份——
    // 各自重算一次网格迟早会因为参数不同而错位，而错位的表现是「贴图按错误的拓扑贴」。
    const isMesh = attachment.type === "mesh" && Array.isArray(attachment.vertices);
    // `path` 附件也不是贴图：它是一串顶点 + 闭合标记，给 Path 约束当轨道用。
    const isPath = attachment.type === "path";
    return {
      name: slot.name,
      display: [
        {
          type: isMesh ? "mesh" : isPath ? "path" : "image",
          name: slot.attachment,
          // 图集里的区域名就是部件名，`path` 与之一致才能取到贴图。
          path: slot.attachment,
          ...(isMesh
            ? {
                vertices: attachment.vertices,
                uvs: attachment.uvs,
                triangles: attachment.triangles,
                width: round(num(attachment.width, 0), 4),
                height: round(num(attachment.height, 0), 4)
              }
            : {}),
          ...(isPath
            ? {
                vertices: attachment.vertices,
                closed: attachment.closed === true
              }
            : {}),
          pivot: { x: 0.5, y: 0.5 },
          transform: {
            x: round(num(attachment.x, 0), 4),
            y: round(num(attachment.y, 0), 4),
            skX: rotation,
            skY: rotation,
            scX: 1,
            scY: 1
          }
        }
      ]
    };
  });

  // ── IK 约束 ──────────────────────────────────────────────────────────
  //
  // Spine 的写法是 `bones: [从根到末端的骨骼名]`；DragonBones 要的是
  // `bone`（链末端）+ `chain`（再往上几根）。两者是同一件事的两种编码，
  // 转换时**末尾那根就是末端**，`chain` 要减一（不含末端自己）。
  const ik: any[] = [];
  for (const constraint of Array.isArray(spine?.ik) ? spine.ik : []) {
    const chain: string[] = Array.isArray(constraint?.bones) ? constraint.bones.filter((name: unknown) => typeof name === "string") : [];
    if (chain.length === 0) continue;
    ik.push({
      name: String(constraint.name ?? `ik-${ik.length}`),
      bone: chain[chain.length - 1],
      target: String(constraint.target ?? ""),
      // 我们的 `chain` 字段是「链长」（两骨 = 1）；Spine 那边写的是骨骼数组长度，
      // 所以这里优先用显式字段，缺了才从数组长度反推。
      chain: Math.max(1, num(constraint.chain, chain.length - 1)),
      bendPositive: constraint.bendPositive !== false,
      weight: Math.max(0, Math.min(1, num(constraint.mix, 1))),
      scale: false
    });
  }

  // ── Path 约束 ────────────────────────────────────────────────────────
  //
  // Spine 用的是字符串枚举，DragonBones 用数字：不转的话运行时会把
  // `"percent"` 当成 0（fixed），于是「均匀铺满」悄悄变成「只铺开头一段」。
  const PATH_POSITION_MODE: Record<string, number> = { fixed: 0, percent: 1 };
  const PATH_SPACING_MODE: Record<string, number> = { length: 0, fixed: 1, percent: 2, proportional: 3 };
  const PATH_ROTATE_MODE: Record<string, number> = { tangent: 0, chain: 1, chainScale: 2 };
  const pathConstraints: any[] = [];
  for (const constraint of Array.isArray(spine?.path) ? spine.path : []) {
    const chain: string[] = Array.isArray(constraint?.bones) ? constraint.bones.filter((name: unknown) => typeof name === "string") : [];
    if (chain.length === 0) continue;
    pathConstraints.push({
      name: String(constraint.name ?? `path-${pathConstraints.length}`),
      // DragonBones 用「链的**第一根**骨 + 目标骨骼」，与 Spine 的「整条数组」不同。
      bone: chain[0],
      target: String(constraint.target ?? "root"),
      positionMode: PATH_POSITION_MODE[String(constraint.positionMode ?? "percent")] ?? 1,
      spacingMode: PATH_SPACING_MODE[String(constraint.spacingMode ?? "length")] ?? 0,
      rotateMode: PATH_ROTATE_MODE[String(constraint.rotateMode ?? "tangent")] ?? 0,
      rotation: num(constraint.rotation, 0),
      translateMix: Math.max(0, Math.min(1, num(constraint.translateMix, 1))),
      rotateMix: Math.max(0, Math.min(1, num(constraint.rotateMix, 1)))
    });
  }

  const animation: any[] = [];  for (const [id, value] of Object.entries(options.animations ?? {})) {
    const timelines = (value as any)?.bones;
    if (timelines === null || typeof timelines !== "object") continue;
    const boneTimelines: any[] = [];
    for (const [boneName, kinds] of Object.entries<any>(timelines)) {
      const entry: any = { name: boneName };
      let any = false;
      for (const [kind, frames] of Object.entries<any>(kinds)) {
        const spec = TIMELINE_KINDS[kind];
        if (spec === undefined || !Array.isArray(frames) || frames.length === 0) continue;
        entry[spec.frameKey] = buildDragonBonesTimeline(kind, frames, frameRate);
        any = true;
      }
      if (any) boneTimelines.push(entry);
    }
    if (boneTimelines.length === 0) continue;
    const preset = animationPresetOf(id);
    // 手工动画自带 duration / loop；预设实例只有 bones，回落到预设时长。
    const explicit = num((value as any)?.duration, 0);
    const seconds = explicit > 0 ? explicit : durationSecondsOf(value, preset?.duration ?? 1);
    const loop = typeof (value as any)?.loop === "boolean" ? (value as any).loop : preset?.loop !== false;
    // FFD 变形：Spine 的 `deform`（按秒）转成 DragonBones 的 `ffd`（按帧）。
    //
    // 顺序必须与骨架里 mesh 的 `vertices` 完全一致——两边都是同一份规则网格算出来的，
    // 一旦这里改了顶点的排列或数量，位移就会对到别的顶点上，表现是「裙摆乱扭」而不是报错。
    const ffd: any[] = [];
    const spineDeform = spine?.animations?.[id]?.deform;
    if (spineDeform !== null && typeof spineDeform === "object") {
      for (const [slotName, bySkin] of Object.entries<any>(spineDeform)) {
        const frames: any[] = Array.isArray(bySkin?.default) ? bySkin.default : [];
        if (frames.length === 0) continue;
        ffd.push({
          name: slotName,
          skin: "default",
          slot: slotName,
          frame: frames.map((frame: any, index: number) => ({
            // 末帧的 duration 被解析器忽略（与骨骼时间轴同一条规则）。
            duration: index === frames.length - 1 ? 0 : Math.max(1, Math.round(((frames[index + 1].time ?? 0) - (frame.time ?? 0)) * frameRate)),
            offset: num(frame.offset, 0),
            vertices: Array.isArray(frame.vertices) ? frame.vertices.map((n: unknown) => num(n, 0)) : []
          }))
        });
      }
    }
    animation.push({
      duration: Math.max(1, Math.round(seconds * frameRate)),
      name: id,
      // 0 = 无限循环。六个预设都是首尾闭合的（`validateAnimationLoops` 盯着）。
      playTimes: loop ? 0 : 1,
      bone: boneTimelines,
      ...(ffd.length === 0 ? {} : { ffd })
    });
  }

  const width = Math.round(options.canvasWidth);
  const height = Math.round(options.canvasHeight);
  return {
    frameRate,
    name: options.name,
    version: DRAGONBONES_VERSION,
    compatibleVersion: DRAGONBONES_COMPATIBLE_VERSION,
    armature: [
      {
        type: "Armature",
        frameRate,
        name: options.name,
        aabb: { x: 0, y: 0, width, height },
        // 画布原点按 Spine 那边的习惯放在水平中线，y 从 0 起（y 向下）。
        canvas: { x: -width / 2, y: 0, width, height },
        bone: bones,
        slot: slots,
        ...(ik.length === 0 ? {} : { ik }),
        ...(pathConstraints.length === 0 ? {} : { path: pathConstraints }),
        skin: [{ name: "default", slot: skinSlots }],
        animation,
        defaultActions: []
      }
    ]
  };
}

/** 动画时长：优先取时间轴里最晚的一帧，取不到才回落到预设时长。 */
function durationSecondsOf(timelines: any, fallback: number): number {
  let max = 0;
  for (const kinds of Object.values<any>(timelines?.bones ?? {})) {
    for (const frames of Object.values<any>(kinds)) {
      if (!Array.isArray(frames)) continue;
      for (const frame of frames) {
        const time = num(frame?.time, 0);
        if (time > max) max = time;
      }
    }
  }
  return max > 0 ? max : fallback;
}

export interface DragonBonesTextureOptions {
  /** `imagePath`：DragonBones 运行时按它找 png，用**相对当前目录**的文件名。 */
  imagePath: string;
  name: string;
}

/**
 * 一页图集 → 一个 `_tex.json`。
 *
 * `frameX/frameY/frameWidth/frameHeight` 是**裁剪信息**，必须一起给：
 * 运行时用 `pivot.x * frameWidth + frameX` 算挂点（`Slot.ts:427-433`），
 * 少了 `frame*` 就会按「没裁过」算，裁掉透明边的部件会整体偏掉。
 * 我们图集的 `offsetX = -bounds.x`（裁剪框左上角取负），与 DragonBones
 * 的 `frameX` 约定相同，直接照搬。
 */
export function buildDragonBonesTexture(page: AtlasPage, options: DragonBonesTextureOptions): any {
  return {
    name: options.name,
    imagePath: options.imagePath,
    width: page.width,
    height: page.height,
    // 1 = 不额外缩放（导出物与图集同尺寸）。
    scale: 1,
    SubTexture: page.placements.map((item) => {
      const entry: any = {
        name: item.name,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotated: false
      };
      const origWidth = item.origWidth ?? item.width;
      const origHeight = item.origHeight ?? item.height;
      if (origWidth !== item.width || origHeight !== item.height) {
        entry.frameX = item.offsetX ?? 0;
        entry.frameY = item.offsetY ?? 0;
        entry.frameWidth = origWidth;
        entry.frameHeight = origHeight;
      }
      return entry;
    })
  };
}
