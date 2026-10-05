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
/**
 * 按「位置 + 种子」**确定性地**挑一个变体。
 *
 * 为什么必须确定性（而不是随机）：
 *   · 界面要在**不花钱、不跑拼图**的前提下先预览出来，它得自己挑变体；
 *   · 宿主若用 `Math.random()`，预览与成品就永远对不上 ——
 *     用户看到「预览和出图不一样」，会以为编辑的不是刚才那张。
 *
 * 位置相关的整数哈希，两边各算一次必然相同。种子参与运算，
 * 所以「换个种子重铺」仍然能换出一张不一样的图。
 */
export function pickVariantIndex(seed, r, c, count) {
    if (count <= 1)
        return 0;
    const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
    let h = (s ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (r + 0x85ebca6b), 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ (c + 0x27d4eb2f), 0x165667b1) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h % count;
}
/**
 * 从一个 `buildingGround` 条目取**形状**。
 *
 * 优先第 5 位的新格式；没有就按第 2/3 位的包围矩形还原（老数据）。
 * 这样拼图、包围盒、界面三处读的是同一个形状。
 */
export function shapeOfEntry(entry) {
    if (entry === undefined)
        return [[0, 0]];
    const shape = entry[5];
    if (Array.isArray(shape) && shape.length > 0)
        return shape;
    const cols = Math.max(1, entry[2] ?? 1);
    const rows = Math.max(1, entry[3] ?? 1);
    const out = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            out.push([r, c]);
    return out;
}
/**
 * 形状的包围菱形**半宽/半高**（与 `tilegeom.shapeHalfWidthLocal` 同一条公式）。
 *
 * 每格相对锚点的水平偏移是 `(dc − dr)·cellWidth/4`，所以跨度由 `(dc−dr)` 的极差决定。
 * ⚠️ 别用 `(fw+fh)/2` —— 那**只对实心矩形**成立，L 形会算出两倍宽。
 */
export function shapeDiamondHalf(shape, cellWidth) {
    if (shape.length === 0)
        return { halfW: cellWidth / 2, halfH: cellWidth / 4 };
    // 用**实际 x/y 偏移**算极差，别用「列数 + 行数」——
    // 那个指数和会把同一个方向的跨度算两遍（L 形会算成 64 而不是 48）。
    let minX = Infinity, maxX = -Infinity;
    for (const [r, c] of shape) {
        const x = c - r;
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
    }
    const halfW = ((maxX - minX) * (cellWidth / 2) + cellWidth) / 2;
    return { halfW, halfH: halfW / 2 };
}
/**
 * 形状的底面中心相对**锚点格中心**的偏移（1× 像素）。
 *
 * 定义：占格各格**菱形中心**的**包围盒中点**。
 *
 * ## 坐标变换（这里踩过好几次，务必看清）
 *
 * 格 `(r,c)` 相对锚点的等距偏移是
 * `x = (c − r)·stepX`、`y = (c + r)·stepY`，其中
 * `stepX = cellWidth/2`、`stepY = cellWidth/4`。
 * 所以 x 取极差、y 取极差，各自**再除以 2**：
 *
 * ```
 * dx = (max(c−r) + min(c−r))/2 · stepX
 * dy = (max(c+r) + min(c+r))/2 · stepY
 * ```
 *
 * 实心矩形 `fw×fh` 化简后正好是 `dx = (fw−1)·stepX/2`、`dy = (fh−1)·stepY/2`，
 * 也就是老代码的 `((fw−1)·cellW/2)/2`、`((fh−1)·cellW/4)/2` —— **逐字一致**
 * （注意 dy 的括号因子是 `cellW/4 = stepY`，写成 `cellW/8` 就少一半）。
 *
 * ⚠️ 别用「各格中心的平均」：那对不对称形状（L 形）会偏。
 * ⚠️ 也别用「各格中心包围盒的中点」之外的自创定义 —— 它与
 * `assembleMap` 的垫底范围、`measureAssemblyBounds` 的包围盒、界面预览
 * 三处必须**同口径**，否则又是「保存后错半格」那类问题。
 */
export function shapeBaseOffset(shape, cellWidth) {
    if (shape.length === 0)
        return { dx: 0, dy: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [r, c] of shape) {
        const x = c - r;
        const y = c + r;
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
    }
    return {
        dx: ((minX + maxX) / 2) * (cellWidth / 2),
        dy: ((minY + maxY) / 2) * (cellWidth / 4)
    };
}
/** 只量几何、不画像素。 */
export function measureAssemblyBounds(lookup, state, options) {
    const { settings } = options;
    const layout = tileLayout(settings, state.rows, state.cols);
    const cellW = settings.cellWidth;
    const cellH = settings.cellHeight;
    // 地面菱形在单元格里的位置：上下各留 cellH/3 给装饰（见 tilegeom 的注释）
    const groundInset = Math.round(cellH / 3);
    const diamondH = Math.round(cellW / 2);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const put = (x, y, w, h) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0)
            return;
        if (x < left)
            left = x;
        if (y < top)
            top = y;
        if (x + w > right)
            right = x + w;
        if (y + h > bottom)
            bottom = y + h;
    };
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const origin = tileOriginAt(layout, r, c);
            const family = state.cells[r]?.[c] ?? "";
            if (family !== "") {
                // 地面：菱形那一段（水平方向按整格，菱形只占中间 cellW，差不了多少）
                const insetX = Math.round((cellW - diamondH * 2) / 2);
                put(origin.x - insetX, origin.y + groundInset, cellW, diamondH);
            }
            const decorName = state.decor[`${r},${c}`];
            if (typeof decorName === "string" && decorName !== "") {
                put(origin.x, origin.y, cellW, cellH);
            }
        }
    }
    const groundByBuilding = new Map();
    for (const entry of state.buildingGround ?? []) {
        groundByBuilding.set(`${entry[0]},${entry[1]}`, shapeOfEntry(entry));
    }
    for (const [r, c, name] of state.buildings ?? []) {
        const sprite = lookup.get(name);
        const origin = tileOriginAt(layout, r, c);
        const shape = groundByBuilding.get(`${r},${c}`) ?? [[0, 0]];
        const off = shapeBaseOffset(shape, cellW);
        const anchorCx = origin.x + cellW / 2;
        const anchorCy = origin.y + cellH / 2;
        const baseX = anchorCx + off.dx;
        const baseY = anchorCy + off.dy;
        if (sprite !== undefined) {
            const base = typeof sprite.baseFraction === "number"
                ? sprite.baseFraction * sprite.height
                : sprite.height - cellH / 2;
            put(Math.round(baseX - sprite.width / 2), Math.round(baseY - base), sprite.width, sprite.height);
        }
        // 垫底菱形（`fillDiamondSolid` 的口径）—— **逐格**，与 `assembleMap` 同口径。
        // 逐格而不是一个大菱形：非矩形形状（L 形）的大菱形会把凹口算进来
        // （包围盒反而偏大，裁剪时多留一圈白，不至于错格，但要与宿主一致）。
        const cellHalfW = cellW / 4;
        const cellHalfH = cellHalfW / 2;
        for (const [dr, dc] of shape) {
            const cx2 = anchorCx + (dc - dr) * (cellW / 4);
            const cy2 = anchorCy + (dc + dr) * (cellW / 8);
            put(Math.ceil(cx2 - cellHalfW), Math.floor(cy2 - cellHalfH), Math.floor(cx2 + cellHalfW) - Math.ceil(cx2 - cellHalfW) + 1, Math.ceil(cy2 + cellHalfH) - Math.floor(cy2 - cellHalfH) + 1);
        }
    }
    if (!Number.isFinite(left))
        return { left: 0, top: 0, width: 0, height: 0 };
    // 不做额外留白：宿主用**同一个矩形**裁剪（`cropBitmap`），
    // 所以「矩形 → map.png」是恒等映射，多留白只会平白多一圈透明边。
    const l = Math.floor(left);
    const t = Math.floor(top);
    return {
        left: l,
        top: t,
        width: Math.ceil(right) - l,
        height: Math.ceil(bottom) - t
    };
}
/**
 * 按**给定的**矩形裁剪（与 `trimTransparent` 的区别：矩形是调用方算好的）。
 *
 * 为什么不让 `trimTransparent` 自己去量：那样「裁剪矩形」就成了**不透明像素的
 * 函数**，界面算不出同一个值来（它不解码贴图）。于是宿主的 `pixel` 与界面按布局
 * 算出的偏移会各说各话 —— 真机上就是「房子上移一格 / 点到的格子和涂到的差一格」。
 *
 * 现在裁剪与上报用**同一个矩形**：界面拿 `measureAssemblyBounds` 各算一遍，
 * 必然一致。矩形超出画布的部分会被夹住，返回的 `left/top` 是**夹过之后**的真值，
 * 所以坐标换算永远成立。
 */
export function cropBitmap(src, rect) {
    const left = Math.max(0, Math.min(rect.left, Math.max(0, src.width - 1)));
    const top = Math.max(0, Math.min(rect.top, Math.max(0, src.height - 1)));
    const right = Math.max(left + 1, Math.min(rect.left + rect.width, src.width));
    const bottom = Math.max(top + 1, Math.min(rect.top + rect.height, src.height));
    const w = right - left;
    const h = bottom - top;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        src.rgba.copy(rgba, y * w * 4, ((y + top) * src.width + left) * 4, ((y + top) * src.width + left + w) * 4);
    }
    return Object.assign({ width: w, height: h, rgba }, { left, top });
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
        groundByBuilding.set(`${entry[0]},${entry[1]}`, { key: entry[4], shape: shapeOfEntry(entry) });
    }
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
                // ⚠️ 变体选择必须是**确定性**的（位置 + 种子），不能 `Math.random()`：
                // 界面要在不跑拼图的前提下先预览出来，用随机就永远对不上，
                // 用户会以为「预览的不是成品」。界面用同一个函数各算一次。
                const pick = candidates[pickVariantIndex(state.seed, r, c, candidates.length)];
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
        // 垫底按**形状**逐格画（`shapeBaseOffset` 给出包围菱形中心的偏移）。
        // 曾经想当然写成 `cellW × cellH/2`，结果垫底高度是正确值的 3 倍、横向又不够，
        // 洞照样露出来；后来说按 `(fw+fh)/2` 算 —— 那**只对实心矩形**成立，
        // L 形会算成两倍宽，凹口也被涂上。
        const groundInfo = groundByBuilding.get(`${r},${c}`);
        const ground = groundInfo === undefined ? undefined : lookup.get(groundInfo.key);
        const shape = groundInfo?.shape ?? [[0, 0]];
        // 占格菱形的中心在哪儿 —— 建筑贴图的**底面**就落在这里。
        //
        // ⚠️ 不是锚点格的几何中心！2×2 的锚点在左上那格，整个占格菱形的中心
        // 比它右移 `stepX/2`、下移 `stepY/2`。垫底画在锚点格中心的话，
        // 整个垫底会**往左上偏半格**，建筑看着像浮在半空（实测真机就是这么露馅的）。
        //
        // 形状任意时用 `shapeBaseOffset` 现算（推导见它的注释）。
        const off = shapeBaseOffset(shape, cellW);
        const anchorCx = at2.x + cellW / 2;
        const anchorCy = at2.y + cellH / 2;
        const baseX = anchorCx + off.dx;
        const baseY = anchorCy + off.dy;
        if (groundInfo !== undefined && ground !== undefined) {
            // 逐格垫底：非矩形形状（L 形）画一个大菱形会把凹口也涂上，
            // 而凹口本来该透出下面的地面。矩形是特例 —— 各格菱形拼起来
            // 正好等于那个大菱形，所以老行为不变。
            const avg = averageColor(ground);
            const cellHalfW = cellW / 4;
            const cellHalfH = cellHalfW / 2;
            for (const [dr, dc] of shape) {
                fillDiamondSolid(out, canvasW, canvasH, anchorCx + (dc - dr) * (cellW / 4), anchorCy + (dc + dr) * (cellW / 8), cellHalfW, cellHalfH, avg, 255);
            }
        }
        const base = typeof sprite.baseFraction === "number"
            ? sprite.baseFraction * sprite.height
            : sprite.height - cellH / 2;
        const x = Math.round(baseX - sprite.width / 2);
        const y = Math.round(baseY - base);
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
