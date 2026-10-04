/**
 * 地图地块模块的**拼图**：把单元格地块按等距网格铺成一张地图。
 *
 * ## 坐标系统（最容易写错的一处）
 *
 * ```
 * 单元格：cellWidth × cellHeight（默认 64×96）
 * 菱形：  宽 = cellWidth，高 = cellWidth / 2（2:1 等距）
 * 步进：  stepX = cellWidth / 2
 *         stepY = 菱形高 / 2 = cellWidth / 4     ← 来自菱形高，**不是 cellHeight**
 * ```
 *
 * 写成 `stepY = cellHeight / 4` 会得到 24（正确是 16），整张图就裂了。
 * 研究期第一次拼图正是把「贴图尺寸」当成了「网格步进」，整张图裂成白格。
 *
 * ## 绘制顺序即遮挡顺序
 *
 * 按 `(r + c)` 升序绘制。前面一行的地块天然会盖住后面那格装饰的下半部 ——
 * 这正是等距游戏想要的效果，**不需要**额外的 z 排序逻辑。
 */
import { diamondHeight } from "./tilegeom.js";
export function emptyMapState(rows = 14, cols = 14, fill = "grass", seed = 20261004) {
    return {
        rows,
        cols,
        seed,
        cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill)),
        decor: {},
        buildings: []
    };
}
/**
 * 确定性 PRNG（mulberry32）。
 *
 * **不能用 `Math.random`** —— 验收标准要求「同种子 + 同布局 → 逐像素一致」，
 * 而 `Math.random` 会让每次铺图都不同，用户也就无法复现一张满意的地图。
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function tileLayout(settings, rows, cols, scale = 1) {
    const stepX = (settings.cellWidth / 2) * scale;
    // stepY 来自**菱形高**（= cellWidth/2）的一半，不是 cellHeight/4。
    // 写成 cellHeight/4 会得到 24（正确 16），整张图就裂了。
    const stepY = (diamondHeight(settings) / 2) * scale;
    const cellW = settings.cellWidth * scale;
    const cellH = settings.cellHeight * scale;
    return {
        stepX,
        stepY,
        originX: (rows - 1) * stepX,
        // 最上面那格的上方留一个单元格高，给高出地面的装饰留空间
        originY: cellH,
        canvasW: Math.ceil((cols + rows) * stepX + cellW),
        canvasH: Math.ceil((rows + cols) * stepY + cellH * 2)
    };
}
/** 第 (r, c) 格贴图的左上角像素位置。 */
export function tileOriginAt(layout, r, c) {
    return {
        x: Math.round(layout.originX + (c - r) * layout.stepX),
        y: Math.round(layout.originY + (c + r) * layout.stepY)
    };
}
/**
 * 在画布上填一个**实心菱形**（用于建筑底面的地面垫底）。
 *
 * 为什么需要：建筑贴图只覆盖它自己那块形状，底面菱形的四个角是透明的，
 * 而它占掉的 2×2 格已经被清空（否则同一个精灵会被当 1 格地面再画 4 遍）。
 * 不垫底的话地图上会露出一块**透明洞**（实测建筑脚下是白色菱形缺口）。
 */
function fillDiamondSolid(dst, dstW, dstH, cx, cy, halfW, halfH, color, alpha) {
    const y0 = Math.max(0, Math.floor(cy - halfH));
    const y1 = Math.min(dstH - 1, Math.ceil(cy + halfH));
    for (let y = y0; y <= y1; y++) {
        const dy = Math.abs(y + 0.5 - cy) / halfH;
        if (dy > 1)
            continue;
        const half = halfW * (1 - dy);
        const x0 = Math.max(0, Math.ceil(cx - half));
        const x1 = Math.min(dstW - 1, Math.floor(cx + half));
        for (let x = x0; x <= x1; x++) {
            const o = (y * dstW + x) * 4;
            const a = alpha / 255;
            dst[o] = Math.round(color[0] * a + dst[o] * (1 - a));
            dst[o + 1] = Math.round(color[1] * a + dst[o + 1] * (1 - a));
            dst[o + 2] = Math.round(color[2] * a + dst[o + 2] * (1 - a));
            dst[o + 3] = Math.max(dst[o + 3], alpha);
        }
    }
}
/** 一张贴图里不透明像素的平均颜色（用作垫底色）。 */
function averageColor(src) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < src.width * src.height; i++) {
        const o = i * 4;
        if (src.rgba[o + 3] < 200)
            continue;
        r += src.rgba[o];
        g += src.rgba[o + 1];
        b += src.rgba[o + 2];
        n++;
    }
    if (n === 0)
        return [0, 0, 0];
    return [r / n, g / n, b / n];
}
export function assembleMap(lookup, state, options) {
    const { settings } = options;
    if (state.rows < 1 || state.cols < 1)
        throw new Error("地图至少要有 1 行 1 列");
    if (state.rows > 64 || state.cols > 64)
        throw new Error(`地图最大 64×64，收到 ${state.cols}×${state.rows}`);
    const layout = tileLayout(settings, state.rows, state.cols);
    const { stepX, stepY, canvasW, canvasH } = layout;
    const cellW = settings.cellWidth;
    const cellH = settings.cellHeight;
    // 画布尺寸守卫：不守卫的话 64×64 会尝试分配几百 MB 然后 OOM
    if (canvasW * canvasH > 64 * 1024 * 1024) {
        throw new Error(`地图画布过大（${canvasW}×${canvasH}）`);
    }
    const bg = options.background ?? [0, 0, 0, 0];
    const out = Buffer.alloc(canvasW * canvasH * 4);
    for (let i = 0; i < canvasW * canvasH; i++) {
        out[i * 4] = bg[0];
        out[i * 4 + 1] = bg[1];
        out[i * 4 + 2] = bg[2];
        out[i * 4 + 3] = bg[3];
    }
    const at = (r, c) => tileOriginAt(layout, r, c);
    // 建筑底面原来是哪种地面 —— 用来给它垫底（见 fillDiamondSolid 的注释）
    const groundByBuilding = new Map();
    for (const entry of state.buildingGround ?? []) {
        groundByBuilding.set(`${entry[0]},${entry[1]}`, { key: entry[4], fw: entry[2], fh: entry[3] });
    }
    const rng = mulberry32(state.seed);
    const decorAt = new Map();
    for (const [key, name] of Object.entries(state.decor))
        decorAt.set(key, [...(decorAt.get(key) ?? []), name]);
    // 按 (r+c) 升序：远的先画，近的盖住远的
    const order = [];
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++)
            order.push({ r, c, key: r + c });
    }
    order.sort((a, b) => (a.key - b.key) || (a.r - b.r));
    for (const { r, c } of order) {
        const family = state.cells[r]?.[c] ?? "";
        if (family !== "") {
            const candidates = (options.families[family] ?? [family]).filter((k) => lookup.has(k));
            if (candidates.length > 0) {
                const pick = candidates[Math.floor(rng() * candidates.length)];
                const cell = lookup.get(pick);
                const { x, y } = at(r, c);
                blit(out, canvasW, canvasH, cell, x, y);
            }
        }
        // 装饰插在「自己那格之后、下一格之前」：前排地块会自然盖住它的下半部
        for (const name of decorAt.get(`${r},${c}`) ?? []) {
            const sprite = lookup.get(name);
            if (sprite === undefined)
                continue;
            const { x, y } = at(r, c);
            blit(out, canvasW, canvasH, sprite, x, y);
        }
    }
    // 跨格建筑：贴图是「底面格块宽度、往上长高」的立体图。
    //
    // 摆放口径：底面菱形中心要对到锚点格的**几何中心**，也就是世界坐标
    // `(originX + (c−r)·stepX + cellWidth/2, originY + (c+r)·stepY + cellHeight/2)`。
    // 上半部分自然溢出到上面那些格子上，配合 (r+c) 递增的绘制顺序形成正确遮挡。
    //
    // ⚠️ 贴图**不是** 2 格高：它是按底面宽度等比缩放的，高度由模板宽高比决定，
    // 所以底面在贴图里的位置要按 `baseFraction` 取，不能想当然用「贴图中心」。
    for (const [r, c, name] of state.buildings) {
        const sprite = lookup.get(name);
        if (sprite === undefined)
            continue;
        const at2 = at(r, c);
        // 先给底面垫一块实心地面菱形，避免建筑脚下露出透明洞。
        //
        // ⚠️ 菱形的尺寸要按**占格**算：`(fw+fh)/2 · cellWidth/2` 宽、
        // 其一半为高（菱形高 = 宽/2）。曾经想当然写成 `cellW × cellH/2`，
        // 结果垫底高度是正确值的 3 倍、横向又不够，洞照样露出来。
        const groundInfo = groundByBuilding.get(`${r},${c}`);
        const ground = groundInfo === undefined ? undefined : lookup.get(groundInfo.key);
        if (groundInfo !== undefined && ground !== undefined) {
            const footHalfW = ((groundInfo.fw + groundInfo.fh) / 2) * (cellW / 2);
            const footHalfH = footHalfW / 2;
            fillDiamondSolid(out, canvasW, canvasH, at2.x + cellW / 2, at2.y + cellH / 2, footHalfW, footHalfH, averageColor(ground), 255);
        }
        const baseY = typeof sprite.baseFraction === "number"
            ? sprite.baseFraction * sprite.height
            : sprite.height - cellH / 2;
        const x = Math.round(at2.x + cellW / 2 - sprite.width / 2);
        const y = Math.round(at2.y + cellH / 2 - baseY);
        blit(out, canvasW, canvasH, sprite, x, y);
    }
    return { width: canvasW, height: canvasH, rgba: out };
}
/** 把 `src` 以 source-over 混合到 `dst` 的 (dx, dy)。 */
function blit(dst, dstW, dstH, src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= dstH)
            continue;
        for (let x = 0; x < src.width; x++) {
            const tx = dx + x;
            if (tx < 0 || tx >= dstW)
                continue;
            const si = (y * src.width + x) * 4;
            const sa = src.rgba[si + 3];
            if (sa === 0)
                continue;
            const di = (ty * dstW + tx) * 4;
            if (sa === 255) {
                dst[di] = src.rgba[si];
                dst[di + 1] = src.rgba[si + 1];
                dst[di + 2] = src.rgba[si + 2];
                dst[di + 3] = 255;
                continue;
            }
            const a = sa / 255;
            const inv = 1 - a;
            const da = dst[di + 3] / 255;
            const outA = a + da * inv;
            if (outA <= 0)
                continue;
            dst[di] = Math.round((src.rgba[si] * a + dst[di] * da * inv) / outA);
            dst[di + 1] = Math.round((src.rgba[si + 1] * a + dst[di + 1] * da * inv) / outA);
            dst[di + 2] = Math.round((src.rgba[si + 2] * a + dst[di + 2] * da * inv) / outA);
            dst[di + 3] = Math.round(outA * 255);
        }
    }
}
/** 裁掉四周全透明的边（地图留白太多时用）。返回裁掉的偏移，调用方要拿它对齐叠层。 */
export function trimTransparent(src, alphaThreshold = 8) {
    let left = src.width;
    let top = src.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
            if (src.rgba[(y * src.width + x) * 4 + 3] < alphaThreshold)
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
    if (right < 0) {
        return Object.assign(src, { left: 0, top: 0 });
    }
    const w = right - left + 1;
    const h = bottom - top + 1;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        src.rgba.copy(rgba, y * w * 4, ((y + top) * src.width + left) * 4, ((y + top) * src.width + left + w) * 4);
    }
    // ⚠️ `left/top` 要带出去：成品是裁过的，而界面叠可点格子时用的是**未裁**坐标。
    // 少了这两个值，叠层整体偏移（实测：地图看着对、但点到的格子全错一格）。
    return Object.assign({ width: w, height: h, rgba }, { left, top });
}
/**
 * 统计一张地图里「完全透明的洞」的像素数 —— 验收断言 S1 用它。
 *
 * 判据是**内部**透明：先把外部背景连通的透明区域排除，剩下的就是洞。
 * 直接数 `alpha === 0` 会把外部背景也算进去，永远不为 0。
 */
export function countInteriorHoles(src) {
    const total = src.width * src.height;
    const outside = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const push = (index) => {
        if (outside[index] === 0 && src.rgba[index * 4 + 3] < 8) {
            outside[index] = 1;
            queue[tail++] = index;
        }
    };
    for (let x = 0; x < src.width; x++) {
        push(x);
        push((src.height - 1) * src.width + x);
    }
    for (let y = 0; y < src.height; y++) {
        push(y * src.width);
        push(y * src.width + src.width - 1);
    }
    while (head < tail) {
        const index = queue[head++];
        const x = index % src.width;
        const y = (index - x) / src.width;
        if (x > 0)
            push(index - 1);
        if (x < src.width - 1)
            push(index + 1);
        if (y > 0)
            push(index - src.width);
        if (y < src.height - 1)
            push(index + src.width);
    }
    let holes = 0;
    for (let i = 0; i < total; i++) {
        if (outside[i] === 0 && src.rgba[i * 4 + 3] < 8)
            holes++;
    }
    return holes;
}
