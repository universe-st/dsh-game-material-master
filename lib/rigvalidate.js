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
function report(errors, warnings) {
    const ok = errors.length === 0;
    const summary = (ok ? "校验通过" : `校验失败：${errors.length} 处错误`) +
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
export function validateSpineWire(spine) {
    const errors = [];
    const warnings = [];
    const animations = spine?.animations;
    if (animations === null || typeof animations !== "object") {
        return report(errors, warnings);
    }
    for (const [animationName, animation] of Object.entries(animations)) {
        const boneTracks = animation?.bones;
        if (boneTracks === null || typeof boneTracks !== "object")
            continue;
        for (const [boneName, timelines] of Object.entries(boneTracks)) {
            if (timelines === null || typeof timelines !== "object")
                continue;
            for (const [kind, frames] of Object.entries(timelines)) {
                if (!Array.isArray(frames))
                    continue;
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
                    if (frame === null || typeof frame !== "object")
                        continue;
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
                    if (isLast || frame.curve === undefined)
                        continue;
                    // `stepped` 是合法值。
                    if (frame.curve === "stepped")
                        continue;
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
                    if (typeof start !== "number" || typeof end !== "number")
                        continue;
                    for (const [offsetLabel, cx] of [
                        ["cx1", frame.curve[0]],
                        ["cx2", frame.curve[2]]
                    ]) {
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
export function validateAnimationLoops(spine) {
    const errors = [];
    const warnings = [];
    const loopIds = new Set(RIG_ANIMATIONS.filter((item) => item.loop).map((item) => item.id));
    const animations = spine?.animations;
    if (animations === null || typeof animations !== "object")
        return report(errors, warnings);
    for (const [animationName, animation] of Object.entries(animations)) {
        if (!loopIds.has(animationName))
            continue;
        const boneTracks = animation?.bones;
        if (boneTracks === null || typeof boneTracks !== "object")
            continue;
        for (const [boneName, timelines] of Object.entries(boneTracks)) {
            if (timelines === null || typeof timelines !== "object")
                continue;
            for (const [kind, frames] of Object.entries(timelines)) {
                if (!Array.isArray(frames) || frames.length < 2)
                    continue;
                const where = `${animationName}/${boneName}/${kind}`;
                const first = frames[0];
                const last = frames[frames.length - 1];
                for (const property of TIMELINE_VALUE_KEYS[kind] ?? []) {
                    const a = first?.[property];
                    const b = last?.[property];
                    if (typeof a !== "number" || typeof b !== "number")
                        continue;
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
const TIMELINE_VALUE_KEYS = {
    rotate: ["value"],
    translate: ["x", "y"],
    scale: ["x", "y"],
    shear: ["x", "y"]
};
function isPow2(value) {
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
export function validateAtlas(pages, options = {}) {
    const errors = [];
    const warnings = [];
    const maxSize = options.maxSize ?? 4096;
    if (pages.length === 0) {
        errors.push({ level: "error", code: "atlas-empty", where: "", message: "图集没有任何页" });
        return report(errors, warnings);
    }
    const seen = new Map();
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
            }
            else {
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
export function validateSkeletonAtlasMatch(spine, pages) {
    const errors = [];
    const warnings = [];
    const regions = new Set();
    for (const page of pages)
        for (const item of page.placements)
            regions.add(item.name);
    const attachments = spine?.skins?.[0]?.attachments;
    if (attachments === null || typeof attachments !== "object") {
        return report(errors, warnings);
    }
    for (const [slotName, byName] of Object.entries(attachments)) {
        if (byName === null || typeof byName !== "object")
            continue;
        for (const attachmentName of Object.keys(byName)) {
            if (regions.has(attachmentName))
                continue;
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
