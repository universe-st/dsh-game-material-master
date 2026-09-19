/**
 * 绿幕抠像与整图合成。
 *
 * 抠像有两条判据，先空间、后颜色：
 *
 * 1. **边界洪水填充**（主判据）。从画面四边出发，只沿着「与相邻已判定背景
 *    像素颜色接近」的方向生长。它跟随的是**局部连续性**而不是某个固定颜色，
 *    所以绿幕、黄幕、甚至平缓渐变的背景都能整片吃掉，并在角色轮廓的突变处
 *    停下。这一步是必需的：图生视频模型经常会把纯色背景重新打光成渐变，
 *    只认绿色的做法在那些帧上会整片失效。
 *
 * 2. **绿色优势值** `g - max(r, b)`（辅助判据）。只作用在未被判定为背景的
 *    像素上，用来清理角色轮廓残留的绿色边缘，并提供去绿溢出。
 *
 * 合成则是「统一裁剪 + 区域重采样 + 像素量化」：先在所有帧上求 alpha 包围盒
 * 的并集，全部帧共用同一个框——这样各方向的缩放一致、脚底也对齐在同一条
 * 基线上；再按盒式平均重采样到目标尺寸，最后量化成 pixelSize 的方块。
 */
import { encodePng } from "./png.js";
export const DEFAULT_KEY_OPTIONS = {
    keyLow: 14,
    keyHigh: 80,
    despill: 0.65,
    edgeShrink: 0,
    bgTolerance: 40
};
/** 两个像素的 RGB 欧氏距离。 */
function colorDistance(rgba, a, b) {
    const dr = rgba[a] - rgba[b];
    const dg = rgba[a + 1] - rgba[b + 1];
    const db = rgba[a + 2] - rgba[b + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
/** 背景调色板的量化格：每通道 16 档。 */
const PALETTE_GRID = 16;
const PALETTE_CELL = 256 / PALETTE_GRID;
/**
 * 用四边像素建一个「背景色查找格」。
 *
 * 为什么需要它：只用「和相邻像素颜色接近」来生长，会顺着抗锯齿的软边缘
 * 一路渗进角色——绿幕到白色围裙的过渡如果跨了 3~4 个像素，每一步的差值都
 * 小于局部容差，填充就穿过去了。加上这条全局约束后，像素还必须「本身就像
 * 背景色」才可能被判为背景，软边缘自然被挡住。
 *
 * 采样点覆盖整圈边界，所以平缓渐变的背景也能被完整覆盖。
 */
function buildBackgroundPalette(rgba, width, height, globalTolerance) {
    const grid = new Uint8Array(PALETTE_GRID * PALETTE_GRID * PALETTE_GRID);
    const seen = new Uint8Array(PALETTE_GRID * PALETTE_GRID * PALETTE_GRID);
    // 量化误差最多 8*sqrt(3) ≈ 14，补进半径里，避免刚好卡在格边界的颜色被漏掉。
    const limit = globalTolerance + 14;
    const limitSq = limit * limit;
    const radius = Math.max(1, Math.ceil(limit / PALETTE_CELL));
    const mark = (index) => {
        const r = Math.min(PALETTE_GRID - 1, rgba[index] >> 4);
        const g = Math.min(PALETTE_GRID - 1, rgba[index + 1] >> 4);
        const b = Math.min(PALETTE_GRID - 1, rgba[index + 2] >> 4);
        const key = (r * PALETTE_GRID + g) * PALETTE_GRID + b;
        if (seen[key] === 1)
            return;
        seen[key] = 1;
        // 必须按**球体**标记，不能只按格坐标的范围扫一圈：
        // 那会标出一个立方体，角落到中心的距离可达 limit*sqrt(3)，
        // 于是离背景很远的角色颜色也会被误判成背景色。
        for (let dr = -radius; dr <= radius; dr++) {
            const nr = r + dr;
            if (nr < 0 || nr >= PALETTE_GRID)
                continue;
            for (let dg = -radius; dg <= radius; dg++) {
                const ng = g + dg;
                if (ng < 0 || ng >= PALETTE_GRID)
                    continue;
                for (let db = -radius; db <= radius; db++) {
                    const nb = b + db;
                    if (nb < 0 || nb >= PALETTE_GRID)
                        continue;
                    const distSq = (dr * PALETTE_CELL) ** 2 + (dg * PALETTE_CELL) ** 2 + (db * PALETTE_CELL) ** 2;
                    if (distSq > limitSq)
                        continue;
                    grid[(nr * PALETTE_GRID + ng) * PALETTE_GRID + nb] = 1;
                }
            }
        }
    };
    // 步长控制采样量：长边最多取 128 个点，够覆盖渐变又不至于拖慢。
    const stepX = Math.max(1, Math.floor(width / 128));
    const stepY = Math.max(1, Math.floor(height / 128));
    for (let x = 0; x < width; x += stepX) {
        mark(x * 4);
        mark(((height - 1) * width + x) * 4);
    }
    for (let y = 0; y < height; y += stepY) {
        mark(y * width * 4);
        mark((y * width + width - 1) * 4);
    }
    return grid;
}
function paletteHas(grid, rgba, index) {
    const r = Math.min(PALETTE_GRID - 1, rgba[index] >> 4);
    const g = Math.min(PALETTE_GRID - 1, rgba[index + 1] >> 4);
    const b = Math.min(PALETTE_GRID - 1, rgba[index + 2] >> 4);
    return grid[(r * PALETTE_GRID + g) * PALETTE_GRID + b] === 1;
}
/**
 * 从四边洪水填充出背景掩码：**必须同时满足**「颜色像背景（全局调色板）」
 * 和「与相邻的已判定背景像素颜色接近（局部连续性）」。
 *
 * 全局约束挡住软边缘渗透，局部约束则让填充能跟随调色板覆盖不到的渐变。
 * 返回 1 = 背景，0 = 前景。
 */
export function segmentBackground(rgba, width, height, globalTolerance, localTolerance) {
    // 局部容差故意收得很紧：它只用来跨过背景自身的细微噪声与编码块边界。
    // 背景的**大范围变化**（渐变、被重新打光）由全局调色板负责——边界采样本来就
    // 覆盖了整圈颜色，局部判据不需要承担这件事。
    //
    // 收得紧是必须的：填充一旦放宽就会顺着抗锯齿的软边缘渗进角色体内，把整个
    // 身体判成背景。实测真实素材（H3 输出）在 64 帧上的表现——12/14 全部正常，
    // 16 开始穿透，18 以上整片失效。
    //
    // 12 不会因为噪声而漏抠：4 邻域填充可以从别的方向绕开孤立的噪声像素，
    // 只有**连续成片**的强边缘（也就是角色轮廓）才能挡住它。
    const local = Math.max(1, Math.round(localTolerance ?? 12));
    const palette = buildBackgroundPalette(rgba, width, height, globalTolerance);
    const total = width * height;
    const background = new Uint8Array(total);
    const stack = new Int32Array(total);
    let top = 0;
    // 种子必须自己就"像背景"，否则贴边裁切的角色会被整片误删。
    const push = (index) => {
        if (background[index] === 1)
            return;
        if (!paletteHas(palette, rgba, index * 4))
            return;
        background[index] = 1;
        stack[top++] = index;
    };
    for (let x = 0; x < width; x++) {
        push(x);
        push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        push(y * width);
        push(y * width + width - 1);
    }
    while (top > 0) {
        const index = stack[--top];
        const current = index * 4;
        const x = index % width;
        const y = (index - x) / width;
        const visit = (n) => {
            if (background[n] === 1)
                return;
            if (!paletteHas(palette, rgba, n * 4))
                return;
            if (colorDistance(rgba, current, n * 4) > local)
                return;
            background[n] = 1;
            stack[top++] = n;
        };
        if (x > 0)
            visit(index - 1);
        if (x < width - 1)
            visit(index + 1);
        if (y > 0)
            visit(index - width);
        if (y < height - 1)
            visit(index + width);
    }
    return background;
}
/** 没启用空间分割时，用颜色判据粗略估一个背景占比，供界面判断可信度。 */
function countGreenBackground(rgba, high) {
    let count = 0;
    for (let p = 0; p < rgba.length; p += 4) {
        if (rgba[p + 1] - Math.max(rgba[p], rgba[p + 2]) >= high)
            count++;
    }
    return count;
}
/**
 * 抠掉背景，返回新的 RGBA 缓冲区与诊断信息。
 * 输入输出都是 `width * height * 4` 字节、非预乘 alpha。
 */
export function keyGreen(rgba, width, height, options) {
    const low = Math.max(0, Math.min(255, options.keyLow));
    const high = Math.max(low + 1, Math.min(255, options.keyHigh));
    const span = high - low;
    const despill = Math.max(0, Math.min(1, options.despill));
    const tolerance = Math.max(0, options.bgTolerance ?? 0);
    const pixels = width * height;
    // 空间分割只在结果合理时采用：几乎全是背景说明画面里没有主体，
    // 几乎没有背景说明四边就是角色本身（贴边裁切）。两种都不可信。
    let background;
    let backgroundCount = 0;
    if (tolerance > 0) {
        const candidate = segmentBackground(rgba, width, height, tolerance);
        let count = 0;
        for (let i = 0; i < pixels; i++)
            count += candidate[i];
        const fraction = count / pixels;
        if (fraction > 0.12 && fraction < 0.985) {
            background = candidate;
            backgroundCount = count;
        }
    }
    const out = Buffer.alloc(rgba.length);
    for (let i = 0; i < pixels; i++) {
        const p = i * 4;
        const r = rgba[p];
        const g = rgba[p + 1];
        const b = rgba[p + 2];
        const srcAlpha = rgba[p + 3];
        const other = r > b ? r : b;
        const greenness = g - other;
        let alpha = 1;
        if (greenness >= high)
            alpha = 0;
        else if (greenness > low)
            alpha = 1 - (greenness - low) / span;
        alpha *= srcAlpha / 255;
        // 空间上确认为背景的像素直接全透明；颜色判据只负责前景里的绿色残余。
        if (background !== undefined && background[i] === 1)
            alpha = 0;
        let outG = g;
        if (despill > 0 && g > other) {
            const weight = despill * (1 - alpha);
            if (weight > 0)
                outG = Math.round(g - (g - other) * weight);
        }
        out[p] = r;
        out[p + 1] = outG;
        out[p + 2] = b;
        out[p + 3] = Math.round(alpha * 255);
    }
    if (options.edgeShrink > 0)
        shrinkAlpha(out, width, height, Math.min(8, Math.round(options.edgeShrink)));
    return {
        rgba: out,
        backgroundFraction: background !== undefined ? backgroundCount / pixels : countGreenBackground(rgba, high) / pixels,
        usedSegmentation: background !== undefined
    };
}
/** 对 alpha 通道做可分离的最小值滤波，等价于把前景边界向内收缩 n 像素。 */
function shrinkAlpha(rgba, width, height, radius) {
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++)
        alpha[i] = rgba[i * 4 + 3];
    const horizontal = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let min = 255;
            const from = Math.max(0, x - radius);
            const to = Math.min(width - 1, x + radius);
            for (let k = from; k <= to; k++) {
                const v = alpha[row + k];
                if (v < min)
                    min = v;
            }
            horizontal[row + x] = min;
        }
    }
    for (let y = 0; y < height; y++) {
        const from = Math.max(0, y - radius);
        const to = Math.min(height - 1, y + radius);
        for (let x = 0; x < width; x++) {
            let min = 255;
            for (let k = from; k <= to; k++) {
                const v = horizontal[k * width + x];
                if (v < min)
                    min = v;
            }
            rgba[(y * width + x) * 4 + 3] = min;
        }
    }
}
/** 所有帧 alpha 包围盒的并集。 */
export function unionBoundingBox(rows, threshold = 8) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const row of rows) {
        for (const frame of row.frames) {
            if (frame.length < row.width * row.height * 4)
                continue;
            for (let y = 0; y < row.height; y++) {
                const rowStart = y * row.width * 4;
                for (let x = 0; x < row.width; x++) {
                    if (frame[rowStart + x * 4 + 3] <= threshold)
                        continue;
                    if (x < minX)
                        minX = x;
                    if (x > maxX)
                        maxX = x;
                    if (y < minY)
                        minY = y;
                    if (y > maxY)
                        maxY = y;
                }
            }
        }
    }
    if (minX === Infinity)
        return { x: 0, y: 0, width: 0, height: 0, empty: true };
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, empty: false };
}
/**
 * 把一块的源区域做盒式平均（按 alpha 预乘，避免背景色渗进边缘），
 * 再填满输出里对应的整块。
 */
function blitBlock(out, outWidth, outHeight, destX, destY, destW, destH, frame, frameWidth, frameHeight, srcX, srcY, srcW, srcH) {
    const x0 = Math.max(0, destX);
    const y0 = Math.max(0, destY);
    const x1 = Math.min(outWidth, destX + destW);
    const y1 = Math.min(outHeight, destY + destH);
    if (x1 <= x0 || y1 <= y0)
        return;
    const sx0 = Math.max(0, Math.floor(srcX));
    const sy0 = Math.max(0, Math.floor(srcY));
    const sx1 = Math.min(frameWidth, Math.ceil(srcX + srcW));
    const sy1 = Math.min(frameHeight, Math.ceil(srcY + srcH));
    if (sx1 <= sx0 || sy1 <= sy0)
        return;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;
    let count = 0;
    for (let y = sy0; y < sy1; y++) {
        let index = (y * frameWidth + sx0) * 4;
        for (let x = sx0; x < sx1; x++, index += 4) {
            const a = frame[index + 3];
            sumR += frame[index] * a;
            sumG += frame[index + 1] * a;
            sumB += frame[index + 2] * a;
            sumA += a;
            count++;
        }
    }
    if (count === 0 || sumA === 0)
        return;
    const r = Math.round(sumR / sumA);
    const g = Math.round(sumG / sumA);
    const b = Math.round(sumB / sumA);
    const a = Math.round(sumA / count);
    for (let y = y0; y < y1; y++) {
        let index = (y * outWidth + x0) * 4;
        for (let x = x0; x < x1; x++, index += 4) {
            out[index] = r;
            out[index + 1] = g;
            out[index + 2] = b;
            out[index + 3] = a;
        }
    }
}
/**
 * 把每个方向的 N 帧拼成一张整图：**行 = 方向，列 = 帧**。
 * 缺帧的格子留空（全透明），方便肉眼看出是哪一步没跑出来。
 */
export function composeSheet(rows, options) {
    const columns = Math.max(1, options.frameCount);
    const rowCount = Math.max(1, rows.length);
    const cellWidth = options.cellWidth;
    const cellHeight = options.cellHeight;
    const width = cellWidth * columns;
    const height = cellHeight * rowCount;
    const rgba = Buffer.alloc(width * height * 4);
    const pixelSize = Math.max(1, Math.round(options.pixelSize));
    const first = rows.find((row) => row.frames.length > 0);
    const frameWidth = first?.width ?? cellWidth;
    const frameHeight = first?.height ?? cellHeight;
    const bbox = options.autoCrop
        ? unionBoundingBox(rows)
        : { x: 0, y: 0, width: frameWidth, height: frameHeight, empty: false };
    const emptyContent = { x: 0, y: 0, width: 0, height: 0, scaleX: 0, scaleY: 0 };
    if (bbox.empty || bbox.width <= 0 || bbox.height <= 0) {
        return { rgba, width, height, columns, rows: rowCount, bbox, content: emptyContent };
    }
    const bottomMargin = Math.max(0, Math.min(cellHeight - 1, Math.round(options.bottomMargin)));
    let scaleX;
    let scaleY;
    if (options.fitMode === "stretch") {
        scaleX = cellWidth / bbox.width;
        scaleY = (cellHeight - bottomMargin) / bbox.height;
    }
    else {
        const fill = Math.max(0.1, Math.min(1, options.fillRatio));
        const scale = Math.min((cellWidth * fill) / bbox.width, ((cellHeight - bottomMargin) * fill) / bbox.height);
        scaleX = scale;
        scaleY = scale;
    }
    const contentW = Math.min(cellWidth, Math.max(1, Math.round(bbox.width * scaleX)));
    const contentH = Math.min(cellHeight - bottomMargin, Math.max(1, Math.round(bbox.height * scaleY)));
    const offsetX = Math.round((cellWidth - contentW) / 2);
    // 贴底放置：脚底落在同一条基线上，上下起伏才不会看起来在飘。
    const offsetY = Math.max(0, cellHeight - bottomMargin - contentH);
    const blocksX = Math.ceil(cellWidth / pixelSize);
    const blocksY = Math.ceil(cellHeight / pixelSize);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        for (let col = 0; col < columns; col++) {
            const frame = row.frames[col];
            if (frame === undefined || frame.length < frameWidth * frameHeight * 4)
                continue;
            const cellOriginX = col * cellWidth;
            const cellOriginY = rowIndex * cellHeight;
            // by/bx 是「相对内容左上角」的块序号，所以块在格子里的绝对位置是
            // offsetY + by*pixelSize；relY 就是它相对内容原点的偏移。
            for (let by = 0; by < blocksY; by++) {
                const relY = by * pixelSize;
                if (relY >= contentH)
                    break;
                const destY = offsetY + relY;
                for (let bx = 0; bx < blocksX; bx++) {
                    const relX = bx * pixelSize;
                    if (relX >= contentW)
                        break;
                    const destX = offsetX + relX;
                    // 只重采样落在内容区内的那一部分（块可能被内容边界截断）
                    const clipLeft = Math.max(0, destX);
                    const clipTop = Math.max(0, destY);
                    const clipRight = Math.min(cellWidth, destX + pixelSize);
                    const clipBottom = Math.min(cellHeight, destY + pixelSize);
                    if (clipRight <= clipLeft || clipBottom <= clipTop)
                        continue;
                    if (clipRight <= offsetX || clipLeft >= offsetX + contentW)
                        continue;
                    if (clipBottom <= offsetY || clipTop >= offsetY + contentH)
                        continue;
                    blitBlock(rgba, width, height, cellOriginX + clipLeft, cellOriginY + clipTop, clipRight - clipLeft, clipBottom - clipTop, frame, frameWidth, frameHeight, bbox.x + (clipLeft - offsetX) / scaleX, bbox.y + (clipTop - offsetY) / scaleY, (clipRight - clipLeft) / scaleX, (clipBottom - clipTop) / scaleY);
                }
            }
        }
    }
    return {
        rgba,
        width,
        height,
        columns,
        rows: rowCount,
        bbox,
        content: { x: offsetX, y: offsetY, width: contentW, height: contentH, scaleX, scaleY }
    };
}
/** 把一串同尺寸帧横向拼成一条预览带（只给界面看）。 */
export function makeStrip(frames, cellWidth, cellHeight) {
    const width = cellWidth * frames.length;
    const rgba = Buffer.alloc(width * cellHeight * 4);
    const cellBytes = cellWidth * cellHeight * 4;
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (frame.length < cellBytes)
            continue;
        for (let y = 0; y < cellHeight; y++) {
            const srcStart = y * cellWidth * 4;
            const destStart = (y * width + i * cellWidth) * 4;
            frame.copy(rgba, destStart, srcStart, srcStart + cellWidth * 4);
        }
    }
    return encodePng(rgba, width, cellHeight);
}
/** 抠完一帧后直接编码成 PNG。 */
export function keyedPng(rgba, width, height) {
    return encodePng(rgba, width, height);
}
