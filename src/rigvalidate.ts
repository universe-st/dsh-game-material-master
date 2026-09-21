/**
 * 骨骼动画产品的**导出前校验**（纯计算，不碰文件系统）。
 *
 * 为什么要有这一层：Spine 4.2 的 wire format 有四个「写错了不报错、只是坏掉」的
 * 陷阱（见 `spine.ts` 的 `convertTimeline` 注释），而图集的错误同样是静默的
 * （区域越界会被 `paste` 悄悄裁掉、`.atlas` 里却仍写完整尺寸）。
 * 这类问题在插件里一路绿灯，一直到**引擎里打开才发现**——那时候排查成本极高。
 *
 * 所以：**产物写盘之前先校验，error 直接让这一步失败**，并且把「哪里错、为什么」
 * 写进任务日志和界面。宁可生成失败，也不要交出一份看起来正常、实际在引擎里坏掉的资源。
 *
 * 判定分两级：
 *   - **error**：产物一定是坏的（引擎会画错 / 崩 / 不显示）→ 拒绝导出；
 *   - **warning**：能跑但可疑（多余区域、页尺寸不是 2 的幂）→ 照常导出，但要说出来。
 */

import { RIG_ANIMATIONS, timelinePropertyCount } from "./spine.js";

export interface ValidationIssue {
  level: "error" | "warning";
  /** 机器可读的问题码，便于测试与界面按类别聚合。 */
  code: string;
  /** 出问题的位置（动画名 / 骨骼名 / 区域名）。 */
  where: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** 一行中文摘要，直接进任务日志。 */
  summary: string;
}

function report(errors: ValidationIssue[], warnings: ValidationIssue[]): ValidationReport {
  const ok = errors.length === 0;
  const summary =
    (ok ? "校验通过" : `校验失败：${errors.length} 处错误`) +
    (warnings.length > 0 ? `，另有 ${warnings.length} 条提示` : "");
  return { ok, errors, warnings, summary };
}

/** 控制点允许的浮点误差（源码里按 6 位小数 round 过，这里留一点余量）。 */
const TIME_TOLERANCE = 1e-3;

/**
 * Spine 4.2 wire format 的四条地雷校验。
 *
 * 参考项目 `spine-animation-ai` 把仓库里同时躺着**对**与**错**的两份 4.2 样例
 * （`examples/sombrero/skeleton.json` 用 `angle` + 4 个数的 translate curve；
 * `examples/sombrero/sombrero.json` 用 `value` + 8 个数），却没有任何测试去断言
 * 它们的差别。这里的每一条都对应一个**具体的坏结果**：
 *
 *   1. `angle` 而不是 `value` → 4.x 运行时把旋转读成 0，**什么都不转**；
 *   2. bezier 长度不等于「属性数 × 4」→ 越界读 undefined → NaN 扩散 →
 *      **渲染一帧后整只骨架消失**；
 *   3. 控制点不是绝对量 → 手柄落到自己所在区间之外 → 运动**突跳**而不是缓动；
 *   4. 末帧带 curve → 归属前移一帧之后，末帧那个 curve 永远不会被读到
 *      （多半是手写/拼接时漏删的残留，属于「写了但没生效」的隐性错误）。
 */
export function validateSpineWire(spine: any): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // ⓪ 骨骼必须拓扑序（父级排在自己前面），且不能成环。
  //
  // 这一条是**真的漏过**：语义层被手工改成 `hip.parent = torso` 而 `torso.parent = hip`
  // 时，旧的父级解析函数在「断环」之后又兜底挂回 torso，于是产物里 `hip ← torso`
  // 与 `torso ← hip` 同时存在。Spine 那边一路绿灯，是在 DragonBones 的拓扑序校验
  // 里才暴露出来的——同一个 `RigDocument` 的两种写法，校验器不能只拦一边。
  {
    const bones: any[] = Array.isArray(spine?.bones) ? spine.bones : [];
    const seen = new Set<string>();
    for (const bone of bones) {
      const name = bone?.name;
      if (typeof name !== "string" || name === "") continue;
      if (bone.parent !== undefined && !seen.has(bone.parent)) {
        errors.push({
          level: "error",
          code: "bone-not-topological",
          where: `bones/${name}`,
          message: `父级「${bone.parent}」不存在或排在自己之后（骨骼表必须拓扑序，否则成环的骨架谁先谁后都不对）`
        });
      }
      seen.add(name);
    }
  }

  const animations = spine?.animations;
  if (animations === null || typeof animations !== "object") {
    return report(errors, warnings);
  }

  for (const [animationName, animation] of Object.entries<any>(animations)) {
    const boneTracks = animation?.bones;
    if (boneTracks === null || typeof boneTracks !== "object") continue;

    for (const [boneName, timelines] of Object.entries<any>(boneTracks)) {
      if (timelines === null || typeof timelines !== "object") continue;
      for (const [kind, frames] of Object.entries<any>(timelines)) {
        if (!Array.isArray(frames)) continue;
        const where = `${animationName}/${boneName}/${kind}`;
        const properties = timelinePropertyCount(kind);

        if (frames.length === 0) {
          warnings.push({ level: "warning", code: "empty-timeline", where, message: "时间轴没有任何关键帧" });
          continue;
        }

        // ① 旋转必须写在 value 下。
        if (kind === "rotate") {
          for (const [index, frame] of frames.entries()) {
            if (frame !== null && typeof frame === "object" && "angle" in frame) {
              errors.push({
                level: "error",
                code: "rotate-angle",
                where: `${where}[${index}]`,
                message: "旋转写在 `angle` 下——4.x 运行时会读成 0，骨骼不会转（必须用 `value`）"
              });
            }
          }
        }

        // 时间必须单调递增，否则后面的区间判断没有意义。
        for (let i = 1; i < frames.length; i++) {
          if (!(frames[i].time > frames[i - 1].time)) {
            errors.push({
              level: "error",
              code: "time-order",
              where: `${where}[${i}]`,
              message: `关键帧时间必须严格递增：${frames[i - 1].time} → ${frames[i].time}`
            });
          }
        }

        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          if (frame === null || typeof frame !== "object") continue;
          const isLast = i === frames.length - 1;

          // ④ 末帧不该带 curve。
          if (isLast && frame.curve !== undefined) {
            errors.push({
              level: "error",
              code: "curve-on-last-frame",
              where: `${where}[${i}]`,
              message: "最后一个关键帧不该携带 `curve`：curve 描述的是「从本帧开始」的那一段，末帧没有下一段"
            });
          }
          if (isLast || frame.curve === undefined) continue;

          // `stepped` 是合法值。
          if (frame.curve === "stepped") continue;
          if (!Array.isArray(frame.curve)) {
            errors.push({
              level: "error",
              code: "curve-shape",
              where: `${where}[${i}]`,
              message: `curve 必须是数组或 "stepped"，实际是 ${typeof frame.curve}`
            });
            continue;
          }

          // ② bezier 每个**被动画属性**一份：rotate 4 个，translate/scale/shear 8 个。
          const expected = properties * 4;
          if (properties > 0 && frame.curve.length !== expected) {
            errors.push({
              level: "error",
              code: "curve-length",
              where: `${where}[${i}]`,
              message: `curve 有 ${frame.curve.length} 个数，${kind} 驱动 ${properties} 个属性、需要 ${expected} 个` +
                (properties === 2 && frame.curve.length === 4
                  ? "——只给 4 个会让运行时越界读 undefined，NaN 扩散后骨架渲染一帧就消失"
                  : "")
            });
            continue;
          }

          // ③ 控制点是绝对量（时间/值空间），必须落在本段之内。
          const start = frames[i].time;
          const end = frames[i + 1]?.time;
          if (typeof start !== "number" || typeof end !== "number") continue;
          for (const [offsetLabel, cx] of [
            ["cx1", frame.curve[0]],
            ["cx2", frame.curve[2]]
          ] as Array<[string, number]>) {
            if (typeof cx !== "number" || !Number.isFinite(cx)) {
              errors.push({ level: "error", code: "curve-nan", where: `${where}[${i}]`, message: `${offsetLabel} 不是有限数` });
              continue;
            }
            if (cx < start - TIME_TOLERANCE || cx > end + TIME_TOLERANCE) {
              errors.push({
                level: "error",
                code: "curve-not-absolute",
                where: `${where}[${i}]`,
                message: `${offsetLabel}=${cx} 落在本段 [${start}, ${end}] 之外——控制点是绝对量（时间/值空间），不是 0..1 归一化比例`
              });
            }
          }
        }
      }
    }
  }

  return report(errors, warnings);
}

// ── 循环接缝 ────────────────────────────────────────────────────────────

/** 数值比较的容差：预设的数值都按 2 位小数 round 过，这里留一点余量。 */
const VALUE_TOLERANCE = 0.05;

/**
 * 循环接缝校验：**首尾闭合的动作，每条轨道的第一帧与最后一帧必须相等**。
 *
 * 参考项目只在 prose 里写了「All loops must return to starting values」
 * （`SKILL.md:1944`），脚本**完全不校验**——于是一个不闭合的循环在引擎里的表现是
 * 「每次循环突然跳一下」，而排查的时候没人会想到去看首末帧。
 *
 * 这是纯本地、免费、可断言的检查，正好适合放在导出前。
 */
export function validateAnimationLoops(spine: any): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const loopIds = new Set(RIG_ANIMATIONS.filter((item) => item.loop).map((item) => item.id));
  const animations = spine?.animations;
  if (animations === null || typeof animations !== "object") return report(errors, warnings);

  for (const [animationName, animation] of Object.entries<any>(animations)) {
    if (!loopIds.has(animationName)) continue;
    const boneTracks = animation?.bones;
    if (boneTracks === null || typeof boneTracks !== "object") continue;

    for (const [boneName, timelines] of Object.entries<any>(boneTracks)) {
      if (timelines === null || typeof timelines !== "object") continue;
      for (const [kind, frames] of Object.entries<any>(timelines)) {
        if (!Array.isArray(frames) || frames.length < 2) continue;
        const where = `${animationName}/${boneName}/${kind}`;
        const first = frames[0];
        const last = frames[frames.length - 1];
        for (const property of TIMELINE_VALUE_KEYS[kind] ?? []) {
          const a = first?.[property];
          const b = last?.[property];
          if (typeof a !== "number" || typeof b !== "number") continue;
          if (Math.abs(a - b) > VALUE_TOLERANCE) {
            errors.push({
              level: "error",
              code: "loop-not-closed",
              where,
              message: `循环首尾不闭合：${property} 从 ${a} 开始、到 ${b} 结束（差 ${(b - a).toFixed(3)}）——` +
                "每次循环会在接缝处跳一下"
            });
          }
        }
      }
    }
  }

  return report(errors, warnings);
}

/** 每种时间轴在帧上驱动哪些数值字段。 */
const TIMELINE_VALUE_KEYS: Record<string, string[]> = {
  rotate: ["value"],
  translate: ["x", "y"],
  scale: ["x", "y"],
  shear: ["x", "y"]
};

// ── 图集 ────────────────────────────────────────────────────────────────
export interface AtlasPageLike {
  name: string;
  width: number;
  height: number;
  placements: Array<{
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    origWidth?: number;
    origHeight?: number;
    offsetX?: number;
    offsetY?: number;
  }>;
}

export interface AtlasValidationOptions {
  /** 期望出现在图集里的区域名（= 参与导出的部件名）。 */
  expected?: string[];
  /** 单页最大边长，默认 4096。 */
  maxSize?: number;
}

function isPow2(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/**
 * 图集校验。
 *
 * 参考项目在这些地方**只打 WARNING 或者什么都不做**：
 *   - `generate_spine_player.py` 找不到图集图片只 WARNING，用户只能去浏览器
 *     console 里看白屏原因；
 *   - `make_atlas.py` 对超宽件没有扩宽分支，`Image.paste` 静默裁切，而
 *     `.atlas` 里仍写完整的 `size` → 引擎里画出错位图。
 *
 * 这里一律升级成 **error**：图集与骨架对不上，产物就是废的。
 */
export function validateAtlas(pages: AtlasPageLike[], options: AtlasValidationOptions = {}): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const maxSize = options.maxSize ?? 4096;

  if (pages.length === 0) {
    errors.push({ level: "error", code: "atlas-empty", where: "", message: "图集没有任何页" });
    return report(errors, warnings);
  }

  const seen = new Map<string, string>();
  for (const page of pages) {
    if (page.width <= 0 || page.height <= 0) {
      errors.push({ level: "error", code: "page-size", where: page.name, message: `页尺寸非法：${page.width}×${page.height}` });
      continue;
    }
    if (page.width > maxSize || page.height > maxSize) {
      errors.push({ level: "error", code: "page-too-big", where: page.name, message: `页尺寸 ${page.width}×${page.height} 超过上限 ${maxSize}` });
    }
    if (!isPow2(page.width) || !isPow2(page.height)) {
      warnings.push({ level: "warning", code: "page-not-pow2", where: page.name, message: `页尺寸 ${page.width}×${page.height} 不是 2 的幂，部分引擎会拒绝` });
    }
    if (page.placements.length === 0) {
      warnings.push({ level: "warning", code: "page-empty", where: page.name, message: "这一页没有任何区域" });
    }

    for (const item of page.placements) {
      const where = item.name;
      if (seen.has(item.name)) {
        errors.push({ level: "error", code: "region-duplicate", where, message: `区域名重复（已在 ${seen.get(item.name)} 出现过）` });
      } else {
        seen.set(item.name, page.name);
      }
      if (item.width <= 0 || item.height <= 0) {
        errors.push({ level: "error", code: "region-size", where, message: `区域尺寸非法：${item.width}×${item.height}` });
        continue;
      }
      // 越界：参考项目会静默裁切，这里必须拦住。
      if (item.x < 0 || item.y < 0 || item.x + item.width > page.width || item.y + item.height > page.height) {
        errors.push({
          level: "error",
          code: "region-out-of-bounds",
          where,
          message: `区域 [${item.x},${item.y}] ${item.width}×${item.height} 超出页 ${page.width}×${page.height}`
        });
      }
      const origWidth = item.origWidth ?? item.width;
      const origHeight = item.origHeight ?? item.height;
      if (origWidth < item.width || origHeight < item.height) {
        errors.push({
          level: "error",
          code: "orig-smaller-than-size",
          where,
          message: `orig ${origWidth}×${origHeight} 小于 size ${item.width}×${item.height}——裁剪后的区域不可能比原图大`
        });
      }
      const offsetX = item.offsetX ?? 0;
      const offsetY = item.offsetY ?? 0;
      if (offsetX + item.width > origWidth || offsetY + item.height > origHeight) {
        errors.push({
          level: "error",
          code: "offset-out-of-orig",
          where,
          message: `offset (${offsetX},${offsetY}) + size ${item.width}×${item.height} 超出 orig ${origWidth}×${origHeight}`
        });
      }
    }
  }

  if (options.expected !== undefined) {
    const expected = new Set(options.expected);
    const missing = [...expected].filter((name) => !seen.has(name));
    const extra = [...seen.keys()].filter((name) => !expected.has(name));
    if (missing.length > 0) {
      errors.push({
        level: "error",
        code: "region-missing",
        where: missing.slice(0, 6).join("、"),
        message: `${missing.length} 个部件在图集里没有区域：${missing.slice(0, 8).join("、")}`
      });
    }
    if (extra.length > 0) {
      warnings.push({
        level: "warning",
        code: "region-extra",
        where: extra.slice(0, 6).join("、"),
        message: `图集里有 ${extra.length} 个不属于任何部件的区域：${extra.slice(0, 8).join("、")}`
      });
    }
  }

  return report(errors, warnings);
}

/**
 * 骨架 ↔ 图集的一致性：每个 slot 引用的 attachment 名都必须能在图集里找到。
 *
 * 这两边是分别生成的，一旦对不上，运行时的表现是「整个部件不显示」——
 * 而不是报错。参考项目在这里只打 WARNING（`find_atlas_images`），
 * 用户只能去浏览器 console 里找原因。
 */
export function validateSkeletonAtlasMatch(spine: any, pages: AtlasPageLike[]): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const regions = new Set<string>();
  for (const page of pages) for (const item of page.placements) regions.add(item.name);

  const attachments = spine?.skins?.[0]?.attachments;
  if (attachments === null || typeof attachments !== "object") {
    return report(errors, warnings);
  }

  for (const [slotName, byName] of Object.entries<any>(attachments)) {
    if (byName === null || typeof byName !== "object") continue;
    for (const attachmentName of Object.keys(byName)) {
      if (regions.has(attachmentName)) continue;
      errors.push({
        level: "error",
        code: "attachment-missing-region",
        where: `${slotName}/${attachmentName}`,
        message: `挂点在图集里找不到同名区域「${attachmentName}」，运行时会整个部件不显示`
      });
    }
  }

  return report(errors, warnings);
}

/** DragonBones 解析器认识的数据版本（`ObjectDataParser.parseDragonBonesData` 的白名单）。 */
const DRAGONBONES_VERSIONS = new Set(["2.3", "3.0", "4.0", "4.5", "5.0", "5.5", "5.6"]);

/**
 * DragonBones 5.5 导出物的校验。
 *
 * 与 Spine 那边同样的理由：下面每一条都对应一个**静默坏掉**的结果，
 * 在插件里看不出来，到了引擎里才发现——
 *
 *   1. `version` 不在白名单 → `parseDragonBonesData` 直接 `return null`，
 *      整个骨架加载不出来（而且只打一句 console.assert）；
 *   2. 补间帧既没有 `tweenEasing` 也没有 `curve` → 按**阶跃**解释，
 *      动画一跳一跳（`tweenEasing` 缺省是 `-2` 而不是 `0`）；
 *   3. `curve` 长度不是 `3n+1`（紧凑）或 `3n+2`（显式）→ 解析器越界读
 *      `undefined`，NaN 顺着采样扩散；
 *   4. 中间帧 `duration` 为 0 → `_parseTimeline` 里 `frameCount === 0`
 *      同样走阶跃分支（末帧的 `duration` 本来就被忽略，不在此列）；
 *   5. 骨骼父级缺失 / 出现在子级之后 → 骨骼取不到父级矩阵；
 *   6. 槽位或动画引用了不存在的骨骼 → 该槽位被静默丢弃。
 */
export function validateDragonBones(skeleton: any): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (skeleton === null || typeof skeleton !== "object") {
    errors.push({ level: "error", code: "db-empty", where: "skeleton", message: "DragonBones 骨架为空" });
    return report(errors, warnings);
  }

  const version = skeleton.version;
  if (typeof version !== "string" || !DRAGONBONES_VERSIONS.has(version)) {
    errors.push({
      level: "error",
      code: "db-version",
      where: "version",
      message: `version=${JSON.stringify(version)} 不在 DragonBones 白名单里，运行时会把整份数据判为不支持并返回 null`
    });
  }

  const frameRate = skeleton.frameRate;
  if (typeof frameRate !== "number" || !(frameRate > 0)) {
    errors.push({ level: "error", code: "db-frame-rate", where: "frameRate", message: `frameRate 必须是正数，当前 ${JSON.stringify(frameRate)}` });
  }

  const armatures = Array.isArray(skeleton.armature) ? skeleton.armature : [];
  if (armatures.length === 0) {
    errors.push({ level: "error", code: "db-no-armature", where: "armature", message: "没有任何 armature" });
    return report(errors, warnings);
  }

  for (const armature of armatures) {
    const where0 = `armature/${armature?.name ?? "?"}`;
    const bones: any[] = Array.isArray(armature?.bone) ? armature.bone : [];
    const slots: any[] = Array.isArray(armature?.slot) ? armature.slot : [];
    const boneNames = new Set<string>();
    const slotNames = new Set<string>();

    // 骨骼：拓扑序（父级必须先出现）。解析器其实允许后补，但依赖它会让
    // 「父级拼错名字」变成静默失败，索性在这里要求严格。
    for (const bone of bones) {
      const name = bone?.name;
      if (typeof name !== "string" || name === "") {
        errors.push({ level: "error", code: "db-bone-name", where: where0, message: "存在没有名字的骨骼" });
        continue;
      }
      if (boneNames.has(name)) {
        errors.push({ level: "error", code: "db-bone-dup", where: `${where0}/${name}`, message: `骨骼名重复：${name}` });
      }
      if (bone.parent !== undefined) {
        if (!boneNames.has(bone.parent)) {
          errors.push({
            level: "error",
            code: "db-bone-parent",
            where: `${where0}/${name}`,
            message: `父级「${bone.parent}」不存在或出现在子级之后，骨骼取不到父级矩阵`
          });
        }
      }
      const transform = bone.transform;
      if (transform === null || typeof transform !== "object") {
        errors.push({ level: "error", code: "db-bone-transform", where: `${where0}/${name}`, message: "骨骼缺少 transform" });
      } else if (Math.abs(numOr(transform.skX, 0) - numOr(transform.skY, 0)) > 1e-6) {
        // 允许（解析器支持双角度），但我们自己从不生成——出现即说明有人手改了。
        warnings.push({
          level: "warning",
          code: "db-bone-skew",
          where: `${where0}/${name}`,
          message: `skX(${transform.skX}) 与 skY(${transform.skY}) 不等，会引入斜切`
        });
      }
      boneNames.add(name);
    }

    // 槽位：数组序即 zOrder。
    for (const slot of slots) {
      const name = slot?.name;
      if (typeof name !== "string" || name === "") {
        errors.push({ level: "error", code: "db-slot-name", where: where0, message: "存在没有名字的槽位" });
        continue;
      }
      if (!boneNames.has(slot.parent)) {
        errors.push({
          level: "error",
          code: "db-slot-parent",
          where: `${where0}/${name}`,
          message: `槽位挂在骨骼「${slot.parent}」上，但这根骨骼不存在（运行时该槽位会被丢掉）`
        });
      }
      slotNames.add(name);
    }

    // 皮肤：槽位名要在 armature 里存在，图片挂点要有名字。
    for (const skin of Array.isArray(armature?.skin) ? armature.skin : []) {
      for (const skinSlot of Array.isArray(skin?.slot) ? skin.slot : []) {
        const name = skinSlot?.name;
        if (!slotNames.has(name)) {
          errors.push({
            level: "error",
            code: "db-skin-slot",
            where: `${where0}/${skin?.name ?? "default"}/${name}`,
            message: `皮肤引用了不存在的槽位「${name}」`
          });
        }
        const displays = Array.isArray(skinSlot?.display) ? skinSlot.display : [];
        if (displays.length === 0) {
          warnings.push({ level: "warning", code: "db-skin-empty", where: `${where0}/${name}`, message: "槽位没有任何 display，运行时会不显示" });
        }
        for (const display of displays) {
          if (display?.type !== undefined && display.type !== "image") continue;
          if (typeof display?.path !== "string" || display.path === "") {
            errors.push({
              level: "error",
              code: "db-display-path",
              where: `${where0}/${name}`,
              message: "图片挂点缺少 path，运行时按名字去图集里取不到贴图"
            });
          }
          const pivot = display?.pivot;
          if (pivot === undefined || typeof pivot?.x !== "number" || typeof pivot?.y !== "number") {
            errors.push({
              level: "error",
              code: "db-display-pivot",
              where: `${where0}/${name}`,
              message: "图片挂点缺少 pivot（缺省 0.5/0.5 虽然能跑，但裁剪过的部件会偏）"
            });
          }
        }
      }
    }

    // 动画：时长是**帧数**；补间帧必须显式声明缓动；持续 0 的中间帧会变阶跃。
    for (const animation of Array.isArray(armature?.animation) ? armature.animation : []) {
      const animWhere = `${where0}/animation/${animation?.name ?? "?"}`;
      const duration = animation?.duration;
      if (typeof duration !== "number" || !Number.isInteger(duration) || duration <= 0) {
        errors.push({
          level: "error",
          code: "db-duration",
          where: animWhere,
          message: `duration 必须是正整数帧数（Spine 那边是秒，这里是帧），当前 ${JSON.stringify(duration)}`
        });
      }
      for (const timeline of Array.isArray(animation?.bone) ? animation.bone : []) {
        const boneName = timeline?.name;
        if (!boneNames.has(boneName)) {
          errors.push({
            level: "error",
            code: "db-anim-bone",
            where: `${animWhere}/${boneName}`,
            message: `动画引用了不存在的骨骼「${boneName}」`
          });
        }
        for (const [key, kind] of [
          ["rotateFrame", "rotate"],
          ["translateFrame", "translate"],
          ["scaleFrame", "scale"]
        ] as Array<[string, string]>) {
          const frames = timeline?.[key];
          if (frames === undefined) continue;
          if (!Array.isArray(frames) || frames.length === 0) {
            errors.push({ level: "error", code: "db-frames-empty", where: `${animWhere}/${boneName}/${kind}`, message: "帧数组为空" });
            continue;
          }
          for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const frameWhere = `${animWhere}/${boneName}/${kind}[${i}]`;
            const isLast = i === frames.length - 1;
            const frameDuration = numOr(frame?.duration, -1);
            if (!Number.isInteger(frameDuration) || frameDuration < 0) {
              errors.push({ level: "error", code: "db-frame-duration", where: frameWhere, message: `duration 必须是非负整数帧数，当前 ${JSON.stringify(frame?.duration)}` });
            } else if (!isLast && frameDuration === 0) {
              errors.push({
                level: "error",
                code: "db-frame-step",
                where: frameWhere,
                message: "中间帧的 duration 为 0 会被解析成阶跃（末帧的 duration 本来就被忽略，只有中间帧要求 ≥ 1）"
              });
            }
            if (isLast) continue;
            if (frame?.curve === undefined && frame?.tweenEasing === undefined) {
              errors.push({
                level: "error",
                code: "db-frame-easing",
                where: frameWhere,
                message: "补间帧既没有 tweenEasing 也没有 curve；缺省是 -2（阶跃），动画会一跳一跳"
              });
              continue;
            }
            if (frame.curve !== undefined) {
              const length = Array.isArray(frame.curve) ? frame.curve.length : -1;
              if (length < 0 || (length % 3 !== 1 && length % 3 !== 2)) {
                errors.push({
                  level: "error",
                  code: "db-curve-length",
                  where: frameWhere,
                  message: `curve 长度 ${length} 非法：紧凑式要 3n+1、显式锚点式要 3n+2，否则解析器越界读到 undefined`
                });
              }
            }
          }
          // 帧位置要严格递增（前 n-1 帧的 duration 之和 == animation.duration）。
          let total = 0;
          for (let i = 0; i < frames.length - 1; i++) total += numOr(frames[i]?.duration, 0);
          if (typeof duration === "number" && total !== duration) {
            warnings.push({
              level: "warning",
              code: "db-frame-span",
              where: `${animWhere}/${boneName}/${kind}`,
              message: `关键帧总长 ${total} 帧与动画时长 ${duration} 帧不一致`
            });
          }
        }
      }
    }
  }

  return report(errors, warnings);
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * `_tex.json` 的校验：区域必须落在图集内，`frame*` 要么一起给、要么都不给。
 *
 * `frameX/frameY/frameWidth/frameHeight` 是「原图（未裁剪）尺寸 + 裁剪偏移」，
 * 运行时用 `pivot.x * frameWidth + frameX` 算挂点位置（`Slot.ts:427-433`）。
 * 只给一半的话，挂点会按「没裁过」算，裁掉透明边的部件整体偏掉。
 */
export function validateDragonBonesTexture(texture: any): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const width = numOr(texture?.width, 0);
  const height = numOr(texture?.height, 0);
  if (!(width > 0) || !(height > 0)) {
    errors.push({ level: "error", code: "db-tex-size", where: "texture", message: `图集尺寸非法：${width}×${height}` });
    return report(errors, warnings);
  }
  if (typeof texture?.imagePath !== "string" || texture.imagePath === "") {
    errors.push({ level: "error", code: "db-tex-image", where: "texture", message: "缺少 imagePath，运行时找不到 png" });
  }

  const subTextures = texture?.SubTexture;
  if (!Array.isArray(subTextures) || subTextures.length === 0) {
    errors.push({ level: "error", code: "db-tex-empty", where: "SubTexture", message: "SubTexture 为空" });
    return report(errors, warnings);
  }

  const seen = new Set<string>();
  for (const item of subTextures) {
    const where = String(item?.name ?? "?");
    if (typeof item?.name !== "string" || item.name === "") {
      errors.push({ level: "error", code: "db-tex-name", where: "SubTexture", message: "存在没有名字的区域" });
      continue;
    }
    if (seen.has(item.name)) {
      errors.push({ level: "error", code: "db-tex-dup", where, message: "区域名重复" });
    }
    seen.add(item.name);

    const x = numOr(item.x, 0);
    const y = numOr(item.y, 0);
    const w = numOr(item.width, 0);
    const h = numOr(item.height, 0);
    if (!(w > 0) || !(h > 0)) {
      errors.push({ level: "error", code: "db-tex-region", where, message: `区域尺寸非法：${w}×${h}` });
    } else if (x < 0 || y < 0 || x + w > width || y + h > height) {
      errors.push({
        level: "error",
        code: "db-tex-outside",
        where,
        message: `区域 ${x},${y} ${w}×${h} 超出图集 ${width}×${height}`
      });
    }

    const frameKeys = ["frameX", "frameY", "frameWidth", "frameHeight"];
    const given = frameKeys.filter((key) => item[key] !== undefined);
    if (given.length !== 0 && given.length !== 4) {
      errors.push({
        level: "error",
        code: "db-tex-frame",
        where,
        message: `裁剪信息要给全（${frameKeys.join("/")}），当前只给了 ${given.join("、")}——挂点会按「没裁过」算，部件整体偏掉`
      });
    } else if (given.length === 4) {
      const frameWidth = numOr(item.frameWidth, 0);
      const frameHeight = numOr(item.frameHeight, 0);
      if (frameWidth < w || frameHeight < h) {
        errors.push({
          level: "error",
          code: "db-tex-frame-size",
          where,
          message: `frameWidth/frameHeight（${frameWidth}×${frameHeight}）不能小于区域尺寸（${w}×${h}）`
        });
      }
    }
  }

  return report(errors, warnings);
}
