/**
 * 骨骼动画的「看图」层：拆件分割、装配定位、遮挡排序、合成与图集。
 *
 * 参考项目用 Python + OpenCV 做这几件事（SIFT+RANSAC 定位、连通域分割、
 * 遮挡投票排 z 序）。本插件不引任何原生依赖，所以这里用纯 TypeScript 重做，
 * 并且刻意选择**不依赖 SIFT** 的路线：
 *
 *   - 定位主力是「多尺度掩码模板匹配 + 金字塔由粗到细搜索」。参考项目里
 *     它本来是 SIFT 失败时的兜底（`template_match_fallback`，用 alpha 掩码
 *     的归一化相关 + 前景惩罚），但在**生图模型重新绘制过的**部件上，
 *     它比稀疏特征匹配更稳：色块、线条、渐变都能提供相关性，不需要角点。
 *   - 打分用零均值归一化互相关（ZNCC），天然免疫整体明暗差异。
 *   - 排序仍按参考项目的思路做**逐对遮挡投票**：重叠区域里，谁的像素更接近
 *     参考图，谁就压在别人上面。
 *
 * 所有函数都是纯函数（输入 RGBA Buffer，输出 RGBA Buffer / 数字），
 * 不碰文件系统，方便脚本直接做验证。
 */
/** 这些参数是否等价于「什么都不做」——用来跳过整趟像素循环。 */
export function isIdentityTint(options) {
    const close = (value, target) => Math.abs((value ?? target) - target) < 1e-6;
    const [r, g, b] = options.rgb ?? [0, 0, 0];
    return (close(options.hue, 0) &&
        close(options.saturation, 1) &&
        close(options.lightness, 0) &&
        close(options.brightness, 0) &&
        close(options.contrast, 1) &&
        Math.abs(r) < 1e-6 &&
        Math.abs(g) < 1e-6 &&
        Math.abs(b) < 1e-6);
}
function clamp255(value) {
    return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}
/** RGB(0~1) → HSL(0~1)。 */
function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g)
        h = ((b - r) / d + 2) / 6;
    else
        h = ((r - g) / d + 4) / 6;
    return [h, s, l];
}
function hue2rgb(p, q, t) {
    let value = t;
    if (value < 0)
        value += 1;
    if (value > 1)
        value -= 1;
    if (value < 1 / 6)
        return p + (q - p) * 6 * value;
    if (value < 1 / 2)
        return q;
    if (value < 2 / 3)
        return p + (q - p) * (2 / 3 - value) * 6;
    return p;
}
/** HSL(0~1) → RGB(0~1)。 */
function hslToRgb(h, s, l) {
    if (s === 0)
        return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
/**
 * 对一个部件贴图换色，返回**新图**（不改原图）。
 *
 * 全透明的像素直接跳过：换色不该把「没有像素」变成「有一点像素」，
 * 而且边缘像素的 RGB 在透明处往往是无意义的残留值，动它反而会污染抗锯齿。
 *
 * 顺序与参考项目一致：先 HSL（色相/饱和/明度），再 RGB 域的对比度/亮度/RGB 平衡。
 * 注意这是**逐像素循环**——部件尺寸在几百像素量级（几十万像素），
 * 单张几十毫秒；这也是为什么换色走「生成一个新版本」而不是每次渲染时实时算。
 */
export function tintRgba(src, options) {
    const out = Buffer.from(src.data);
    if (isIdentityTint(options))
        return { data: out, width: src.width, height: src.height };
    const hueShift = (options.hue ?? 0) / 360;
    const satMul = options.saturation ?? 1;
    const lightAdd = options.lightness ?? 0;
    const brightness = options.brightness ?? 0;
    const contrast = options.contrast ?? 1;
    const [balanceR, balanceG, balanceB] = options.rgb ?? [0, 0, 0];
    for (let i = 0; i < src.width * src.height; i++) {
        const at = i * 4;
        if (src.data[at + 3] === 0)
            continue;
        let [h, s, l] = rgbToHsl(src.data[at] / 255, src.data[at + 1] / 255, src.data[at + 2] / 255);
        h = (h + hueShift + 1) % 1;
        s = Math.min(1, Math.max(0, s * satMul));
        l = Math.min(1, Math.max(0, l + lightAdd));
        let [r, g, b] = hslToRgb(h, s, l);
        // 对比度绕 0.5 缩放，再叠亮度与 RGB 平衡。
        r = (r - 0.5) * contrast + 0.5 + brightness + balanceR;
        g = (g - 0.5) * contrast + 0.5 + brightness + balanceG;
        b = (b - 0.5) * contrast + 0.5 + brightness + balanceB;
        out[at] = clamp255(r * 255);
        out[at + 1] = clamp255(g * 255);
        out[at + 2] = clamp255(b * 255);
        // alpha 原样保留：换色不改变轮廓。
    }
    return { data: out, width: src.width, height: src.height };
}
// ── 基础像素操作 ────────────────────────────────────────────────────────
export function createRgba(width, height, fill = [0, 0, 0, 0]) {
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        data[i * 4] = fill[0];
        data[i * 4 + 1] = fill[1];
        data[i * 4 + 2] = fill[2];
        data[i * 4 + 3] = fill[3];
    }
    return { data, width, height };
}
/** 双线性缩放 RGBA（alpha 用最近邻阈值化，避免半透明边缘糊成毛边）。 */
export function resizeRgba(src, width, height) {
    const dw = Math.max(1, Math.round(width));
    const dh = Math.max(1, Math.round(height));
    if (dw === src.width && dh === src.height)
        return { data: Buffer.from(src.data), width: dw, height: dh };
    const out = Buffer.alloc(dw * dh * 4);
    const xRatio = src.width / dw;
    const yRatio = src.height / dh;
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(src.height - 1, (y + 0.5) * yRatio - 0.5);
        const y0 = Math.max(0, Math.floor(sy));
        const y1 = Math.min(src.height - 1, y0 + 1);
        const wy = sy - y0;
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(src.width - 1, (x + 0.5) * xRatio - 0.5);
            const x0 = Math.max(0, Math.floor(sx));
            const x1 = Math.min(src.width - 1, x0 + 1);
            const wx = sx - x0;
            const idx = (y * dw + x) * 4;
            for (let c = 0; c < 3; c++) {
                const p00 = src.data[(y0 * src.width + x0) * 4 + c];
                const p10 = src.data[(y0 * src.width + x1) * 4 + c];
                const p01 = src.data[(y1 * src.width + x0) * 4 + c];
                const p11 = src.data[(y1 * src.width + x1) * 4 + c];
                const top = p00 + (p10 - p00) * wx;
                const bottom = p01 + (p11 - p01) * wx;
                out[idx + c] = Math.max(0, Math.min(255, Math.round(top + (bottom - top) * wy)));
            }
            // alpha：取最近邻，保住硬边
            const nearest = (Math.min(src.height - 1, Math.round(sy)) * src.width + Math.min(src.width - 1, Math.round(sx))) * 4;
            out[idx + 3] = src.data[nearest + 3];
        }
    }
    return { data: out, width: dw, height: dh };
}
/** 绕中心旋转 RGBA，输出尺寸自动扩到旋转后的包围盒。 */
export function rotateRgba(src, degrees) {
    if (Math.abs(degrees) < 0.01)
        return { data: Buffer.from(src.data), width: src.width, height: src.height };
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const outW = Math.max(1, Math.ceil(Math.abs(src.width * cos) + Math.abs(src.height * sin)));
    const outH = Math.max(1, Math.ceil(Math.abs(src.width * sin) + Math.abs(src.height * cos)));
    const out = Buffer.alloc(outW * outH * 4);
    const cx = src.width / 2;
    const cy = src.height / 2;
    const ocx = outW / 2;
    const ocy = outH / 2;
    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            const dx = x + 0.5 - ocx;
            const dy = y + 0.5 - ocy;
            const sx = Math.round(cx + dx * cos + dy * sin - 0.5);
            const sy = Math.round(cy - dx * sin + dy * cos - 0.5);
            const idx = (y * outW + x) * 4;
            if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height)
                continue;
            const sIdx = (sy * src.width + sx) * 4;
            out[idx] = src.data[sIdx];
            out[idx + 1] = src.data[sIdx + 1];
            out[idx + 2] = src.data[sIdx + 2];
            out[idx + 3] = src.data[sIdx + 3];
        }
    }
    return { data: out, width: outW, height: outH };
}
/** alpha > threshold 的包围盒；全透明时返回 undefined。 */
export function alphaBounds(src, threshold = 8) {
    let minX = src.width;
    let minY = src.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
            if (src.data[(y * src.width + x) * 4 + 3] <= threshold)
                continue;
            if (x < minX)
                minX = x;
            if (y < minY)
                minY = y;
            if (x > maxX)
                maxX = x;
            if (y > maxY)
                maxY = y;
        }
    }
    if (maxX < 0)
        return undefined;
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
/** 裁掉全透明边（让每个部件的坐标都从自己的左上角量起）。 */
export function trimRgba(src) {
    const box = alphaBounds(src);
    if (box === undefined)
        return { data: Buffer.from(src.data), width: src.width, height: src.height };
    if (box.x === 0 && box.y === 0 && box.width === src.width && box.height === src.height) {
        return { data: Buffer.from(src.data), width: src.width, height: src.height };
    }
    const out = Buffer.alloc(box.width * box.height * 4);
    for (let y = 0; y < box.height; y++) {
        src.data.copy(out, y * box.width * 4, ((box.y + y) * src.width + box.x) * 4, ((box.y + y) * src.width + box.x + box.width) * 4);
    }
    return { data: out, width: box.width, height: box.height };
}
/** 把 src 以 source-over 合成到 dst 的 (x, y) 处。 */
export function blitRgba(dst, src, x, y) {
    const dx = Math.round(x);
    const dy = Math.round(y);
    for (let sy = 0; sy < src.height; sy++) {
        const ty = dy + sy;
        if (ty < 0 || ty >= dst.height)
            continue;
        for (let sx = 0; sx < src.width; sx++) {
            const tx = dx + sx;
            if (tx < 0 || tx >= dst.width)
                continue;
            const sIdx = (sy * src.width + sx) * 4;
            const alpha = src.data[sIdx + 3] / 255;
            if (alpha <= 0)
                continue;
            const dIdx = (ty * dst.width + tx) * 4;
            for (let c = 0; c < 3; c++) {
                dst.data[dIdx + c] = Math.round(src.data[sIdx + c] * alpha + dst.data[dIdx + c] * (1 - alpha));
            }
            dst.data[dIdx + 3] = Math.max(dst.data[dIdx + 3], src.data[sIdx + 3]);
        }
    }
}
export function toGrayMask(src, alphaThreshold = 128) {
    const total = src.width * src.height;
    const gray = new Float32Array(total);
    const red = new Float32Array(total);
    const green = new Float32Array(total);
    const blue = new Float32Array(total);
    const mask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const r = src.data[i * 4];
        const g = src.data[i * 4 + 1];
        const b = src.data[i * 4 + 2];
        const a = src.data[i * 4 + 3];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        red[i] = r;
        green[i] = g;
        blue[i] = b;
        mask[i] = a > alphaThreshold ? 1 : 0;
    }
    return { gray, r: red, g: green, b: blue, mask, width: src.width, height: src.height };
}
export function resizeGrayMask(src, width, height) {
    const dw = Math.max(1, Math.round(width));
    const dh = Math.max(1, Math.round(height));
    const gray = new Float32Array(dw * dh);
    const red = new Float32Array(dw * dh);
    const green = new Float32Array(dw * dh);
    const blue = new Float32Array(dw * dh);
    const mask = new Uint8Array(dw * dh);
    const xRatio = src.width / dw;
    const yRatio = src.height / dh;
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(src.height - 1, (y + 0.5) * yRatio - 0.5);
        const y0 = Math.max(0, Math.floor(sy));
        const y1 = Math.min(src.height - 1, y0 + 1);
        const wy = sy - y0;
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(src.width - 1, (x + 0.5) * xRatio - 0.5);
            const x0 = Math.max(0, Math.floor(sx));
            const x1 = Math.min(src.width - 1, x0 + 1);
            const wx = sx - x0;
            const sample = (channel) => {
                const c00 = channel[y0 * src.width + x0];
                const c10 = channel[y0 * src.width + x1];
                const c01 = channel[y1 * src.width + x0];
                const c11 = channel[y1 * src.width + x1];
                const topValue = c00 + (c10 - c00) * wx;
                const bottomValue = c01 + (c11 - c01) * wx;
                return topValue + (bottomValue - topValue) * wy;
            };
            gray[y * dw + x] = sample(src.gray);
            red[y * dw + x] = sample(src.r);
            green[y * dw + x] = sample(src.g);
            blue[y * dw + x] = sample(src.b);
            // 掩码按覆盖率取：缩得太小时别把细部件抹掉。
            const cov = src.mask[y0 * src.width + x0] +
                src.mask[y0 * src.width + x1] +
                src.mask[y1 * src.width + x0] +
                src.mask[y1 * src.width + x1];
            mask[y * dw + x] = cov >= 2 ? 1 : 0;
        }
    }
    return { gray, r: red, g: green, b: blue, mask, width: dw, height: dh };
}
export function rotateGrayMask(src, degrees) {
    if (Math.abs(degrees) < 0.01)
        return src;
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const outW = Math.max(1, Math.ceil(Math.abs(src.width * cos) + Math.abs(src.height * sin)));
    const outH = Math.max(1, Math.ceil(Math.abs(src.width * sin) + Math.abs(src.height * cos)));
    const gray = new Float32Array(outW * outH);
    const red = new Float32Array(outW * outH);
    const green = new Float32Array(outW * outH);
    const blue = new Float32Array(outW * outH);
    const mask = new Uint8Array(outW * outH);
    const cx = src.width / 2;
    const cy = src.height / 2;
    const ocx = outW / 2;
    const ocy = outH / 2;
    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            const dx = x + 0.5 - ocx;
            const dy = y + 0.5 - ocy;
            const sx = Math.round(cx + dx * cos + dy * sin - 0.5);
            const sy = Math.round(cy - dx * sin + dy * cos - 0.5);
            if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height)
                continue;
            const sIdx = sy * src.width + sx;
            gray[y * outW + x] = src.gray[sIdx];
            red[y * outW + x] = src.r[sIdx];
            green[y * outW + x] = src.g[sIdx];
            blue[y * outW + x] = src.b[sIdx];
            mask[y * outW + x] = src.mask[sIdx];
        }
    }
    return { gray, r: red, g: green, b: blue, mask, width: outW, height: outH };
}
/** 取图像四角的中位数颜色作为底色估计——比「假设是白色」可靠。 */
export function detectBackground(src) {
    const samples = [
        [0, 0],
        [src.width - 1, 0],
        [0, src.height - 1],
        [src.width - 1, src.height - 1],
        [Math.floor(src.width / 2), 0],
        [Math.floor(src.width / 2), src.height - 1]
    ];
    const channels = [[], [], []];
    for (const [x, y] of samples) {
        const idx = (y * src.width + x) * 4;
        for (let c = 0; c < 3; c++)
            channels[c].push(src.data[idx + c]);
    }
    return channels.map((list) => {
        list.sort((a, b) => a - b);
        return list[Math.floor(list.length / 2)];
    });
}
export function segmentComponents(atlas, options) {
    return segmentWithLabels(atlas, options).components;
}
/**
 * 部件裁剪块里的软 alpha（每个像素 0-255）。
 *
 * **不能拿「离底色多远」直接当 alpha。** 这个映射对「浅色角色 + 白底」是灾难性的：
 * 实测一张真实立绘里白色长袜的填充色是 `rgb(247,227,221)`，与白底 `rgb(252,252,254)`
 * 只差 42，于是整条腿——**不只是边缘**——被判成 ~45% 透明，显示出来就是「不该半透明的
 * 地方全是半透明」，而且填充越浅越透明，在美术上完全说不通。同一张图里手是 33%、
 * 小腿是 64% 的内部像素都这样，只有深色描边（距离 440+）才能拿到不透明。
 *
 * 正确做法是把「形状」和「过渡」拆开：
 *
 * 1. **形状**由硬掩码决定（颜色距离 > 容差），并且把**完全封闭**的孔洞补上——
 *    浅色高光一旦落进容差内，会在部件中间咬出一个透明的洞，那比白斑更糟。
 * 2. **过渡**只发生在轮廓最外圈 `RIM_PX` 个像素里；内部一律不透明，**与颜色无关**。
 *    颜色距离只用来决定这一圈有多软（就是设置里的「边缘羽化」）。
 *
 * 距离用 3-4 chamfer 近似欧氏距离，比棋盘距离圆，代价仍是两遍线性扫描。
 */
const RIM_PX = 2;
function componentAlpha(data, sheetWidth, x1, y1, cw, ch, background, tolerance, feather) {
    const total = cw * ch;
    const [br, bg, bb] = background;
    const solid = new Uint8Array(total);
    const colorDistance = new Float32Array(total);
    const alpha = new Uint8Array(total);
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const i = y * cw + x;
            const srcIdx = ((y1 + y) * sheetWidth + x1 + x) * 4;
            const dr = data[srcIdx] - br;
            const dg = data[srcIdx + 1] - bg;
            const db = data[srcIdx + 2] - bb;
            const distance = Math.sqrt(dr * dr + dg * dg + db * db);
            colorDistance[i] = distance;
            solid[i] = distance > tolerance && data[srcIdx + 3] > 8 ? 1 : 0;
        }
    }
    // 「外部」= 能从裁剪块边界一路走到的地方（4 邻域，避免从对角缝里漏出去）。
    // 没被淹到的空格就是被部件完全包住的孔洞——对着一张「白底 + 描边」的拆件图，
    // 那种地方按定义属于部件内部，补成不透明。
    const outside = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const seed = (i) => {
        if (solid[i] === 0 && outside[i] === 0) {
            outside[i] = 1;
            queue[tail++] = i;
        }
    };
    for (let x = 0; x < cw; x++) {
        seed(x);
        seed((ch - 1) * cw + x);
    }
    for (let y = 0; y < ch; y++) {
        seed(y * cw);
        seed(y * cw + cw - 1);
    }
    while (head < tail) {
        const i = queue[head++];
        const x = i % cw;
        const y = (i - x) / cw;
        if (x > 0)
            seed(i - 1);
        if (x < cw - 1)
            seed(i + 1);
        if (y > 0)
            seed(i - cw);
        if (y < ch - 1)
            seed(i + cw);
    }
    // 到「外部」的像素距离（3-4 chamfer，单位是 1/3 像素）。
    const FAR = (cw + ch) * 4;
    const dt = new Int32Array(total);
    for (let i = 0; i < total; i++)
        dt[i] = outside[i] === 1 ? 0 : FAR;
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const i = y * cw + x;
            if (dt[i] === 0)
                continue;
            let best = dt[i];
            if (x > 0)
                best = Math.min(best, dt[i - 1] + 3);
            if (y > 0)
                best = Math.min(best, dt[i - cw] + 3);
            if (x > 0 && y > 0)
                best = Math.min(best, dt[i - cw - 1] + 4);
            if (x < cw - 1 && y > 0)
                best = Math.min(best, dt[i - cw + 1] + 4);
            dt[i] = best;
        }
    }
    for (let y = ch - 1; y >= 0; y--) {
        for (let x = cw - 1; x >= 0; x--) {
            const i = y * cw + x;
            if (dt[i] === 0)
                continue;
            let best = dt[i];
            if (x < cw - 1)
                best = Math.min(best, dt[i + 1] + 3);
            if (y < ch - 1)
                best = Math.min(best, dt[i + cw] + 3);
            if (x < cw - 1 && y < ch - 1)
                best = Math.min(best, dt[i + cw + 1] + 4);
            if (x > 0 && y < ch - 1)
                best = Math.min(best, dt[i + cw - 1] + 4);
            dt[i] = best;
        }
    }
    const rim3 = RIM_PX * 3;
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const i = y * cw + x;
            if (outside[i] === 1)
                continue;
            let cover = 1;
            if (dt[i] <= rim3) {
                // 最外圈：颜色距离只在这里起作用，给抗锯齿边缘留一点软过渡。
                const ramp = Math.max(0, Math.min(1, (colorDistance[i] - tolerance) / feather));
                cover = Math.max(ramp, dt[i] / (rim3 + 3));
            }
            const srcIdx = ((y1 + y) * sheetWidth + x1 + x) * 4;
            alpha[i] = Math.round(Math.max(0, Math.min(1, cover)) * data[srcIdx + 3]);
        }
    }
    return alpha;
}
export function segmentWithLabels(atlas, options) {
    const { width, height, data } = atlas;
    const total = width * height;
    const labels = new Int32Array(total).fill(-1);
    const isForeground = new Uint8Array(total);
    const [br, bg, bb] = options.background;
    const tol2 = options.tolerance * options.tolerance;
    for (let i = 0; i < total; i++) {
        const idx = i * 4;
        if (data[idx + 3] <= 8)
            continue;
        const dr = data[idx] - br;
        const dg = data[idx + 1] - bg;
        const db = data[idx + 2] - bb;
        if (dr * dr + dg * dg + db * db > tol2)
            isForeground[i] = 1;
    }
    const components = [];
    const stack = new Int32Array(total);
    let label = 0;
    for (let start = 0; start < total; start++) {
        if (isForeground[start] !== 1 || labels[start] !== -1)
            continue;
        let top = 0;
        stack[top++] = start;
        labels[start] = label;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        let area = 0;
        let sumX = 0;
        let sumY = 0;
        while (top > 0) {
            const index = stack[--top];
            const x = index % width;
            const y = (index - x) / width;
            area++;
            sumX += x;
            sumY += y;
            if (x < minX)
                minX = x;
            if (y < minY)
                minY = y;
            if (x > maxX)
                maxX = x;
            if (y > maxY)
                maxY = y;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                        continue;
                    const nIdx = ny * width + nx;
                    if (isForeground[nIdx] !== 1 || labels[nIdx] !== -1)
                        continue;
                    labels[nIdx] = label;
                    stack[top++] = nIdx;
                }
            }
        }
        components.push({ minX, minY, maxX, maxY, area, sumX, sumY, label });
        label++;
    }
    const result = [];
    const feather = Math.max(1, options.feather);
    for (const component of components) {
        if (component.area < options.minArea)
            continue;
        const x1 = Math.max(0, component.minX - options.padding);
        const y1 = Math.max(0, component.minY - options.padding);
        const x2 = Math.min(width, component.maxX + 1 + options.padding);
        const y2 = Math.min(height, component.maxY + 1 + options.padding);
        const cw = x2 - x1;
        const ch = y2 - y1;
        const out = Buffer.alloc(cw * ch * 4);
        const alpha = componentAlpha(atlas.data, width, x1, y1, cw, ch, [br, bg, bb], options.tolerance, feather);
        for (let i = 0; i < cw * ch; i++) {
            if (alpha[i] === 0)
                continue;
            const srcIdx = (((y1 + Math.floor(i / cw)) * width) + x1 + (i % cw)) * 4;
            out[i * 4] = atlas.data[srcIdx];
            out[i * 4 + 1] = atlas.data[srcIdx + 1];
            out[i * 4 + 2] = atlas.data[srcIdx + 2];
            out[i * 4 + 3] = alpha[i];
        }
        result.push({
            x: x1,
            y: y1,
            width: cw,
            height: ch,
            area: component.area,
            centroidX: Math.round(component.sumX / component.area),
            centroidY: Math.round(component.sumY / component.area),
            pieces: 1,
            rgba: { data: out, width: cw, height: ch },
            label: component.label
        });
    }
    return { components: result, labels, width, height };
}
/** 判定参考图里哪些像素属于角色（alpha 不透明 + 离底色足够远）。 */
export function referenceForeground(reference, tolerance = 40) {
    const background = detectBackground(reference);
    const out = new Uint8Array(reference.width * reference.height);
    const tol2 = tolerance * tolerance;
    for (let i = 0; i < out.length; i++) {
        const idx = i * 4;
        if (reference.data[idx + 3] <= 8)
            continue;
        const dr = reference.data[idx] - background[0];
        const dg = reference.data[idx + 1] - background[1];
        const db = reference.data[idx + 2] - background[2];
        if (dr * dr + dg * dg + db * db > tol2)
            out[i] = 1;
    }
    return out;
}
export function buildReferencePyramid(reference, longEdge, foregroundTolerance = 40) {
    const longest = Math.max(reference.width, reference.height);
    const full = toGrayMask(reference, 128);
    const foreground = referenceForeground(reference, foregroundTolerance);
    const edges = [];
    let edge = 96;
    while (edge < Math.min(longest, longEdge)) {
        edges.push(edge);
        edge *= 2;
    }
    edges.push(Math.min(longest, longEdge));
    const levels = edges.map((size) => {
        const w = Math.max(8, Math.round(reference.width * (size / longest)));
        const h = Math.max(8, Math.round(reference.height * (size / longest)));
        const gray = resizeGrayMask(full, w, h);
        const fg = new Uint8Array(w * h);
        let foregroundCount = 0;
        for (let y = 0; y < h; y++) {
            const sy0 = Math.min(reference.height - 1, Math.floor(y * (reference.height / h)));
            const sy1 = Math.min(reference.height - 1, Math.floor((y + 1) * (reference.height / h)) - 1);
            for (let x = 0; x < w; x++) {
                const sx0 = Math.min(reference.width - 1, Math.floor(x * (reference.width / w)));
                const sx1 = Math.min(reference.width - 1, Math.floor((x + 1) * (reference.width / w)) - 1);
                // 用 3 个采样点做多数表决，避免降采样把细部件整片抹掉。
                let votes = 0;
                if (foreground[sy0 * reference.width + sx0])
                    votes++;
                if (foreground[Math.max(sy0, sy1) * reference.width + sx1])
                    votes++;
                if (foreground[sy0 * reference.width + sx1])
                    votes++;
                if (votes >= 2) {
                    fg[y * w + x] = 1;
                    foregroundCount++;
                }
            }
        }
        return { edge: size, factor: w / reference.width, gray, foreground: fg, foregroundCount };
    });
    return { full, foreground, width: reference.width, height: reference.height, levels };
}
function prepareTemplate(tpl) {
    let count = 0;
    for (let i = 0; i < tpl.mask.length; i++)
        if (tpl.mask[i] === 1)
            count++;
    if (count < 12)
        return undefined;
    const dx = new Int32Array(count);
    const dy = new Int32Array(count);
    let at = 0;
    for (let i = 0; i < tpl.mask.length; i++) {
        if (tpl.mask[i] !== 1)
            continue;
        const x = i % tpl.width;
        dx[at] = x;
        dy[at] = (i - x) / tpl.width;
        at++;
    }
    return { gray: tpl, dx, dy, count };
}
/** 相关性为负、或有效像素太少时的哨兵值，任何情况下都不会被选为最优。 */
const INVALID_SCORE = -1;
/**
 * 零均值归一化互相关（ZNCC），只在参考图前景上统计。
 *
 * ZNCC 天然免疫整体明暗差异，对「生图模型重新打过光」的部件更宽容。
 * 返回的 `coverage` 是模板落在角色身上的比例——它是「放大」的天然惩罚：
 * 模板一旦越出角色轮廓，多出来的像素不计入统计，coverage 直接掉下来。
 */
/** 模板的平均颜色（与摆放位置无关，建模板时算一次）。 */
function templateMeanColor(tpl) {
    const { dx, dy, count, gray } = tpl;
    const tw = gray.width;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < count; i++) {
        const idx = dy[i] * tw + dx[i];
        r += gray.r[idx];
        g += gray.g[idx];
        b += gray.b[idx];
    }
    const n = Math.max(1, count);
    return [r / n, g / n, b / n];
}
function znccAt(ref, fg, tpl, ox, oy, ignored) {
    const { dx, dy, count, gray } = tpl;
    const rw = ref.width;
    const rh = ref.height;
    const rg = ref.gray;
    const tw = gray.width;
    let n = 0;
    let sumT = 0;
    let sumR = 0;
    let sumTT = 0;
    let sumRR = 0;
    let sumTR = 0;
    let sumRefR = 0;
    let sumRefG = 0;
    let sumRefB = 0;
    // `ignored` 里的像素既不计入统计、也不计入覆盖率的分母：
    // 它们是被前面部件挡住的地方，本来就看不到，拿它当「没匹配上」来扣分
    // 会逼着模板沿着可见区域缩小、平移。
    let considered = count;
    for (let i = 0; i < count; i++) {
        const rx = ox + dx[i];
        if (rx < 0 || rx >= rw)
            continue;
        const ry = oy + dy[i];
        if (ry < 0 || ry >= rh)
            continue;
        const rIdx = ry * rw + rx;
        if (ignored !== undefined && ignored[rIdx] === 1) {
            considered--;
            continue;
        }
        if (fg[rIdx] === 0)
            continue;
        const t = gray.gray[dy[i] * tw + dx[i]];
        const r = rg[rIdx];
        n++;
        sumT += t;
        sumR += r;
        sumTT += t * t;
        sumRR += r * r;
        sumTR += t * r;
        sumRefR += ref.r[rIdx];
        sumRefG += ref.g[rIdx];
        sumRefB += ref.b[rIdx];
    }
    const coverage = n / Math.max(1, considered);
    // 被挡掉太多时这个位置没有意义：把一块部件按到「几乎全在自己被遮住的区域」里，
    // 剩下的十几个像素照样能凑出很高的相关系数（实测会让大腿跑到躯干上）。
    // 留 30% 的可比较面积作为下限，既挡掉这种退化解，又允许真的被挡住大半的部件
    // （比如帽子下面的头）用可见的那部分去定位。
    if (considered < Math.max(12, count * 0.3))
        return { score: INVALID_SCORE, coverage };
    if (n < 12)
        return { score: INVALID_SCORE, coverage };
    const meanT = sumT / n;
    const meanR = sumR / n;
    const cov = sumTR / n - meanT * meanR;
    const varT = sumTT / n - meanT * meanT;
    const varR = sumRR / n - meanR * meanR;
    const denom = Math.sqrt(Math.max(0, varT) * Math.max(0, varR));
    if (denom < 1e-6)
        return { score: INVALID_SCORE, coverage };
    return { score: cov / denom, coverage };
}
/**
 * 候选排序分。
 *
 * `score × (0.3 + 0.7 × coverage)` 负责压住**放大**：越出角色的模板覆盖率高不了。
 * 后面的尺寸奖励负责压住**缩小**：一块小色斑贴在角色内部任意位置都能拿高分，
 * 而相关系数本身对「只解释了一小块证据」毫无意见。奖励项按覆盖率开方并饱和，
 * 所以不会反过来无脑鼓励放大——真放大过头时，乘以前面那一项会把它拉回来。
 */
function rankOf(hit, maskCount, foregroundArea, weight) {
    // 注意：这个分数必须**逐级可比**——精细级别要能用它和粗级别的结果竞争，
    // 否则一旦某级的 bonus 少算一点，粗级别的结果就永远无法被改进，
    // 表现是「所有部件都停在粗级别那档的分辨率上」。bonus 里用的是
    // 「模板掩码 / 该级前景面积」这个比值，它在各档之间是近似不变量。
    const base = hit.score * (0.3 + 0.7 * hit.coverage);
    // 权重必须足够大才能压住「缩小」这条捷径：部件缩得越小，模板越能整块塞进
    // 目标的内部区域，越不需要和轮廓对齐，相关系数反而越高。缩小同时也会让
    // 「模板掩码 / 前景面积」变小，这一项就是把这个被偷走的证据补回来。
    const evidence = Math.sqrt(Math.min(1, maskCount / Math.max(64, foregroundArea)));
    return base + weight * evidence;
}
/** 把一张完整分辨率的布尔掩码降采样到某一档。 */
function downsampleMask(source, sourceWidth, sourceHeight, width, height) {
    const out = new Uint8Array(width * height);
    const hit = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * (sourceHeight / height)));
        for (let x = 0; x < width; x++) {
            const sx = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * (sourceWidth / width)));
            if (source[sy * sourceWidth + sx] === 1)
                hit[y * width + x] = 1;
        }
    }
    // 3x3 膨胀：遮挡边界往往只差一两个像素，边缘上残留的过渡像素会把
    // 「被挡住」的区域变成细碎的坏证据。
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (hit[y * width + x] !== 1)
                continue;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height)
                    continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= width)
                        continue;
                    out[ny * width + nx] = 1;
                }
            }
        }
    }
    return out;
}
/** 生成半平面掩码：`keepRight` 为 true 时标记右半边（供「忽略」使用）。 */
export function halfPlaneMask(width, height, threshold, keepRight) {
    const out = new Uint8Array(width * height);
    const from = Math.max(0, Math.min(width, Math.floor(threshold)));
    for (let y = 0; y < height; y++) {
        if (keepRight)
            out.fill(1, y * width + from, y * width + width);
        else
            out.fill(1, y * width, y * width + from);
    }
    return out;
}
/** 由若干矩形生成一张完整分辨率的「已被占用」掩码。 */
export function boxMask(width, height, boxes, padding = 0) {
    const out = new Uint8Array(width * height);
    for (const box of boxes) {
        const x1 = Math.max(0, Math.floor(box.x - padding));
        const y1 = Math.max(0, Math.floor(box.y - padding));
        const x2 = Math.min(width, Math.ceil(box.x + box.width + padding));
        const y2 = Math.min(height, Math.ceil(box.y + box.height + padding));
        for (let y = y1; y < y2; y++) {
            out.fill(1, y * width + x1, y * width + x2);
        }
    }
    return out;
}
function searchAtLevel(ref, fg, foregroundArea, tpl, stride, window, floorRank, minCoverage, evidenceWeight, ignored) {
    const rw = ref.width;
    const rh = ref.height;
    const x0 = window === undefined ? 1 - tpl.gray.width : Math.max(1 - tpl.gray.width, window.x0);
    const y0 = window === undefined ? 1 - tpl.gray.height : Math.max(1 - tpl.gray.height, window.y0);
    const x1 = window === undefined ? rw - 1 : Math.min(window.x1, rw - 1);
    const y1 = window === undefined ? rh - 1 : Math.min(window.y1, rh - 1);
    let best;
    let bestRank = floorRank;
    for (let oy = y0; oy <= y1; oy += stride) {
        for (let ox = x0; ox <= x1; ox += stride) {
            const hit = znccAt(ref, fg, tpl, ox, oy, ignored);
            if (hit.score <= 0)
                continue;
            // 覆盖率门槛在搜索里就卡掉：只压住角色 4% 的一小条模板，相关系数
            // 照样能接近 1（那十几个像素恰好同色），但它根本没有解释这块部件。
            if (hit.coverage < minCoverage)
                continue;
            const rank = rankOf(hit, tpl.count, foregroundArea, evidenceWeight);
            if (rank > bestRank) {
                bestRank = rank;
                best = { x: ox, y: oy, score: hit.score, coverage: hit.coverage, rank };
            }
        }
    }
    return best;
}
/**
 * 由几何关系估一个「全局缩放」先验。
 *
 * 设拆件图相对参考图的缩放为 k（拆件图里量到的尺寸 = k × 参考图里的尺寸）：
 *    Σ(拆件图部件面积) ≈ k² × Σ(部件在参考图里的面积) ≈ k² × 1.3 × 角色轮廓面积
 * 其中 1.3 是「部件之间原本互相重叠」的经验系数。这里返回的是**匹配用的
 * 缩放 1/k**，也就是「把拆件图的像素换算成参考图像素」的乘数。有了它，搜索
 * 阶梯只需要覆盖 1/k 的 ±45%，不必再从 0.06 一路盲扫到 1.9。
 *
 * 这一步既是**精度**也是**速度**的关键：盲扫的阶梯要么太稀（整个跳过真值，
 * 相关系数再也补不回来），要么太密（十几倍的无用搜索）。
 */
export function estimateScaleHint(reference, parts, overlapFactor = 1.3) {
    const foreground = referenceForeground(reference, 40);
    let foregroundArea = 0;
    for (let i = 0; i < foreground.length; i++)
        if (foreground[i] === 1)
            foregroundArea++;
    let partArea = 0;
    for (const part of parts) {
        let opaque = 0;
        for (let i = 0; i < part.width * part.height; i++)
            if (part.data[i * 4 + 3] > 128)
                opaque++;
        partArea += opaque;
    }
    if (foregroundArea < 64 || partArea < 64)
        return 1;
    // 返回的是**匹配用的缩放**（拆件图 → 参考图），所以取倒数。
    const hint = Math.sqrt((overlapFactor * foregroundArea) / partArea);
    if (!Number.isFinite(hint))
        return 1;
    return Math.min(12, Math.max(0.05, hint));
}
/**
 * 围绕先验缩放的搜索阶梯：9 档、相邻比约 1.11，覆盖 0.65k ~ 1.47k。
 *
 * 相邻比不能太粗——真值 0.71 落在 0.61 和 0.75 之间时，两级都差 6% 以上，
 * 相关系数虽然还高，但还原出来的部件尺寸会明显偏；末级再做 ±10% 的微调补回来。
 */
export function scaleLadderAround(hint) {
    // 带宽 ±50%：先验只能保证「数量级对」，具体倍率取决于拆件图里各部件的
    // 相对尺寸是否忠实——实测同一批素材会差到 30% 以上（先验按「部件面积之和
    // ≈ 1.3 × 角色轮廓面积」估，而不同画风下这个重叠系数在 1.2~2.8 之间浮动）。
    // 带宽太窄会直接错过真值；太宽又会让「缩小」那条捷径抬头，所以配合
    // 覆盖率门槛与证据项一起用（见 rankOf）。
    // 带宽 ±20%：全局缩放现在是**用图像证据量出来的**（`chooseGlobalScale`），
    // 实测误差在 20% 以内，所以带宽不用再放宽到 ±50%；带宽越宽，每个部件沿着
    // 「缩小」那条捷径漂移的空间就越大。
    const factors = [0.82, 0.9, 1, 1.1, 1.2];
    return factors.map((factor) => Number((hint * factor).toFixed(5))).filter((value) => value > 0.003);
}
/** 先验完全不可信时的宽阶梯（兜底重试用）。 */
export function wideScaleLadder() {
    const factors = [0.35, 0.45, 0.58, 0.75, 0.97, 1.25, 1.6, 2.05, 2.6];
    return factors.map((factor) => Number(factor.toFixed(5)));
}
/** 没有任何先验时的兜底阶梯（脚本或人工调用时会用到）。 */
function defaultScales() {
    return scaleLadderAround(1);
}
/** 部件在某一档分辨率下的搜索步长：部件越大步子越大（大部件每一步都贵）。 */
function strideAt(part, scale, levelFactor) {
    const size = Math.min(part.width, part.height) * scale * levelFactor;
    return Math.max(1, Math.min(6, Math.floor(size / 6)));
}
/**
 * 把部件匹配进参考图金字塔。
 *
 * 由粗到细，但**只在最粗的一档搜「尺度 × 旋转 × 位置」**：
 *  - 第 0 档：全图扫描，决定尺度与旋转的初值；
 *  - 中间档：冻结尺度与旋转，只在上一级最优点附近的窗口里精修位置；
 *  - 最后一档：位置 + 3 个尺度微调。
 *
 * 之所以这样切：中间档如果把 5 个尺度 × 3 个旋转全搜一遍，代价是 15 倍，
 * 而收益接近零——尺度的大头已经在第 0 档定下来了，后面只需要位置精度。
 */
export function matchPartInPyramid(pyramid, part, options = {}) {
    const scales = options.scales ?? defaultScales();
    const rotations = options.rotations ?? [-10, 0, 10];
    const minCoverage = options.minCoverage ?? 0.5;
    const evidenceWeight = options.evidenceWeight ?? 0.35;
    const scalePrior = options.scalePrior;
    const scalePriorWeight = options.scalePriorWeight ?? 0.15;
    const bounds = options.bounds;
    const partBase = toGrayMask(part, 128);
    const lastLevel = pyramid.levels.length - 1;
    const ignoreCache = new Map();
    const ignoreAt = (level) => {
        if (options.ignoreFull === undefined)
            return undefined;
        const cached = ignoreCache.get(level.gray.width);
        if (cached !== undefined)
            return cached;
        const scaled = downsampleMask(options.ignoreFull, pyramid.width, pyramid.height, level.gray.width, level.gray.height);
        ignoreCache.set(level.gray.width, scaled);
        return scaled;
    };
    let bestScale = scales[0];
    let bestRotation = 0;
    let bestRank = -Infinity;
    let bestHit;
    for (let level = 0; level <= lastLevel; level++) {
        const { gray: ref, foreground, foregroundCount, factor } = pyramid.levels[level];
        const isCoarse = level === 0;
        const isLast = level === lastLevel && !isCoarse;
        const prevStride = level === 0 ? 1 : strideAt(part, bestScale, pyramid.levels[level - 1].factor);
        const floorRank = isCoarse ? 0 : Math.max(0, bestRank - 0.25);
        const scaleCandidates = isCoarse
            ? scales
            : isLast
                ? [0.9, 0.95, 1, 1.05, 1.1].map((factor) => bestScale * factor)
                : [bestScale];
        const rotationCandidates = isCoarse
            ? rotations
            : isLast
                ? [bestRotation - 5, bestRotation, bestRotation + 5]
                : [bestRotation];
        for (const rotation of rotationCandidates) {
            const rotated = rotateGrayMask(partBase, rotation);
            for (const scale of scaleCandidates) {
                const tw = rotated.width * scale * factor;
                const th = rotated.height * scale * factor;
                if (tw < 3 || th < 3)
                    continue;
                if (tw > ref.width * 0.98 || th > ref.height * 0.98)
                    continue;
                const prepared = prepareTemplate(resizeGrayMask(rotated, tw, th));
                if (prepared === undefined)
                    continue;
                const stride = isCoarse ? strideAt(part, scale, factor) : 1;
                let window;
                if (bounds !== undefined) {
                    // bounds 约束的是**模板中心**，而搜索枚举的是左上角，所以两边各减去半个模板。
                    const halfW = prepared.gray.width / 2;
                    const halfH = prepared.gray.height / 2;
                    window = {
                        x0: Math.round(bounds.x0 * factor - halfW),
                        y0: Math.round(bounds.y0 * factor - halfH),
                        x1: Math.round(bounds.x1 * factor - halfW),
                        y1: Math.round(bounds.y1 * factor - halfH)
                    };
                }
                if (!isCoarse && bestHit !== undefined) {
                    const prevFactor = pyramid.levels[level - 1].factor;
                    const ratio = factor / prevFactor;
                    const prevW = Math.max(3, part.width * bestScale * prevFactor);
                    const prevH = Math.max(3, part.height * bestScale * prevFactor);
                    const centerX = (bestHit.x + prevW / 2) * ratio;
                    const centerY = (bestHit.y + prevH / 2) * ratio;
                    const pad = Math.max(prevStride * 3 + 3, 5);
                    const refined = {
                        x0: Math.round(centerX - prepared.gray.width / 2) - pad,
                        y0: Math.round(centerY - prepared.gray.height / 2) - pad,
                        x1: Math.round(centerX - prepared.gray.width / 2) + pad,
                        y1: Math.round(centerY - prepared.gray.height / 2) + pad
                    };
                    // 精修窗口必须与先验框取**交集**：否则某一级的粗定位一旦飘出先验区域，
                    // 后面几级会沿着错误的中心一路精修下去，先验就白给了。
                    window =
                        window === undefined
                            ? refined
                            : {
                                x0: Math.max(window.x0, refined.x0),
                                y0: Math.max(window.y0, refined.y0),
                                x1: Math.min(window.x1, refined.x1),
                                y1: Math.min(window.y1, refined.y1)
                            };
                }
                const hit = searchAtLevel(ref, foreground, foregroundCount, prepared, stride, window, floorRank, minCoverage, evidenceWeight, ignoreAt(pyramid.levels[level]));
                if (hit === undefined)
                    continue;
                const priorPenalty = scalePrior === undefined || scalePrior <= 0 ? 0 : scalePriorWeight * Math.abs(Math.log(scale / scalePrior));
                if (hit.rank - priorPenalty > bestRank) {
                    bestRank = hit.rank - priorPenalty;
                    bestScale = scale;
                    bestRotation = rotation;
                    bestHit = { x: hit.x, y: hit.y, score: hit.score, coverage: hit.coverage, level };
                    options.onLevel?.({
                        level,
                        edge: ref.width,
                        scale,
                        rotation,
                        score: hit.score,
                        coverage: hit.coverage,
                        rank: hit.rank,
                        x: hit.x,
                        y: hit.y
                    });
                }
            }
        }
    }
    if (bestHit === undefined || bestHit.score <= 0.05)
        return undefined;
    // 收尾：拿最终选中的尺度/旋转，在**最后一档**做一次不设分数门槛的位置精修。
    // 前面几档的改进受 rank 门槛约束，`bestHit` 可能仍停留在粗级别的坐标系里；
    // 直接按最后一档的比例去换算会得到一个完全错误的坐标（粗级别 1px ≈ 末级
    // 7px，差一级就差出几十像素）。所以这里强制把位置落到末级精度上。
    const last = pyramid.levels[lastLevel];
    const finalBase = rotateGrayMask(partBase, bestRotation);
    const finalPrepared = prepareTemplate(resizeGrayMask(finalBase, Math.max(3, part.width * bestScale * last.factor), Math.max(3, part.height * bestScale * last.factor)));
    if (finalPrepared === undefined)
        return undefined;
    const ratio = last.factor / pyramid.levels[0].factor;
    const seedLevel = bestHit.level;
    const seedFactor = pyramid.levels[seedLevel].factor;
    const seedRatio = last.factor / seedFactor;
    void ratio;
    const centerX = (bestHit.x + (part.width * bestScale * seedFactor) / 2) * seedRatio;
    const centerY = (bestHit.y + (part.height * bestScale * seedFactor) / 2) * seedRatio;
    const pad = Math.max(4, Math.ceil(part.width * bestScale * last.factor * 0.06));
    const window = {
        x0: Math.round(centerX - finalPrepared.gray.width / 2) - pad,
        y0: Math.round(centerY - finalPrepared.gray.height / 2) - pad,
        x1: Math.round(centerX - finalPrepared.gray.width / 2) + pad,
        y1: Math.round(centerY - finalPrepared.gray.height / 2) + pad
    };
    const ignored = ignoreAt(last);
    const seedX = Math.round(centerX - finalPrepared.gray.width / 2);
    const seedY = Math.round(centerY - finalPrepared.gray.height / 2);
    const seedHit = znccAt(last.gray, last.foreground, finalPrepared, seedX, seedY, ignored);
    const refined = searchAtLevel(last.gray, last.foreground, last.foregroundCount, finalPrepared, 1, window, -Infinity, 0, evidenceWeight, ignored);
    // 精修必须是**改进**，不能更差：窗口里可能存在分数更低的杂散位置，
    // 如果无条件采用精修结果，最后会返回一个比粗级别还糟的摆放（实测表现为
    // 分数掉到 0 附近、部件尺寸也完全不对）。
    const chosen = refined !== undefined && refined.score > seedHit.score
        ? refined
        : { x: seedX, y: seedY, score: seedHit.score, coverage: seedHit.coverage };
    if (chosen.score <= 0.05)
        return undefined;
    if (chosen.coverage < minCoverage)
        return undefined;
    return {
        x: Math.round(chosen.x / last.factor),
        y: Math.round(chosen.y / last.factor),
        width: Math.round(part.width * bestScale),
        height: Math.round(part.height * bestScale),
        scale: Number(bestScale.toFixed(4)),
        rotation: Number(bestRotation.toFixed(2)),
        score: Number(chosen.score.toFixed(4)),
        coverage: Number(chosen.coverage.toFixed(4)),
        method: "template"
    };
}
/** 便捷入口：单次调用时自己建金字塔（测试与脚本用；批量请复用 `matchPartInPyramid`）。 */
export function matchPart(reference, part, options = {}) {
    const pyramid = buildReferencePyramid(reference, options.longEdge ?? 448, options.foregroundTolerance ?? 40);
    return matchPartInPyramid(pyramid, part, options);
}
/**
 * 逐对遮挡投票定绘制顺序（参考项目 `compute_z_order` 的同款思路）。
 *
 * 对每一对重叠的部件，在重叠区域里采样：参考图上这一像素的颜色更像 A 还是
 * 更像 B？更像谁，谁就压在另一个上面。把每对的胜负累成「深度分」再排序，
 * 比拓扑排序更抗噪——个别误判不会把整条顺序掀翻。
 */
export function computeZOrder(reference, parts, scaleTo = 256) {
    const names = parts.map((part) => part.name);
    const depth = {};
    for (const name of names)
        depth[name] = 0;
    const pairs = [];
    const factor = Math.max(reference.width, reference.height) > scaleTo ? scaleTo / Math.max(reference.width, reference.height) : 1;
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
            const a = parts[i];
            const b = parts[j];
            const ox1 = Math.max(a.x, b.x);
            const oy1 = Math.max(a.y, b.y);
            const ox2 = Math.min(a.x + a.width, b.x + b.width);
            const oy2 = Math.min(a.y + a.height, b.y + b.height);
            if (ox1 >= ox2 || oy1 >= oy2)
                continue;
            const step = Math.max(1, Math.round(Math.sqrt(((ox2 - ox1) * (oy2 - oy1)) / 400)));
            let aWins = 0;
            let bWins = 0;
            let total = 0;
            for (let sy = oy1; sy < oy2; sy += step) {
                for (let sx = ox1; sx < ox2; sx += step) {
                    const rx = Math.round(sx * factor);
                    const ry = Math.round(sy * factor);
                    if (rx < 0 || ry < 0 || rx >= reference.width || ry >= reference.height)
                        continue;
                    const rIdx = (ry * reference.width + rx) * 4;
                    if (reference.data[rIdx + 3] < 128)
                        continue;
                    const ax = sx - a.x;
                    const ay = sy - a.y;
                    const bx = sx - b.x;
                    const by = sy - b.y;
                    if (ax < 0 || ay < 0 || ax >= a.rgba.width || ay >= a.rgba.height)
                        continue;
                    if (bx < 0 || by < 0 || bx >= b.rgba.width || by >= b.rgba.height)
                        continue;
                    const aIdx = (ay * a.rgba.width + ax) * 4;
                    const bIdx = (by * b.rgba.width + bx) * 4;
                    if (a.rgba.data[aIdx + 3] < 128 || b.rgba.data[bIdx + 3] < 128)
                        continue;
                    const da = colorDistanceAt(reference.data, rIdx, a.rgba.data, aIdx);
                    const db = colorDistanceAt(reference.data, rIdx, b.rgba.data, bIdx);
                    total++;
                    if (da < db - 5)
                        aWins++;
                    else if (db < da - 5)
                        bWins++;
                }
            }
            if (total <= 5)
                continue;
            if (aWins > bWins * 1.2) {
                depth[b.name] -= aWins;
                depth[a.name] += aWins;
                pairs.push({ over: a.name, under: b.name, votes: aWins, total });
            }
            else if (bWins > aWins * 1.2) {
                depth[a.name] -= bWins;
                depth[b.name] += bWins;
                pairs.push({ over: b.name, under: a.name, votes: bWins, total });
            }
        }
    }
    const order = [...names].sort((x, y) => depth[x] - depth[y] || x.localeCompare(y));
    order.forEach((name, index) => {
        depth[name] = index;
    });
    return { order, depth, pairs };
}
function colorDistanceAt(a, aIdx, b, bIdx) {
    const dr = a[aIdx] - b[bIdx];
    const dg = a[aIdx + 1] - b[bIdx + 1];
    const db = a[aIdx + 2] - b[bIdx + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
/** 按 z 序把部件合成到一张白底（或透明底）画布上。 */
export function compositeParts(width, height, parts, background = [255, 255, 255, 255]) {
    const canvas = createRgba(width, height, background);
    for (const part of parts)
        blitRgba(canvas, part.rgba, part.x, part.y);
    return canvas;
}
/** 把两张同样高度的图左右拼起来，方便一眼对比「参考图 vs 装配结果」。 */
export function sideBySide(left, right, gap = 12, background = [32, 32, 40, 255]) {
    const height = Math.max(left.height, right.height);
    const width = left.width + right.width + gap;
    const canvas = createRgba(width, height, background);
    blitRgba(canvas, left, 0, Math.floor((height - left.height) / 2));
    blitRgba(canvas, right, left.width + gap, Math.floor((height - right.height) / 2));
    return canvas;
}
/**
 * 用**图像证据**（而不是几何公式）选一个全局缩放。
 *
 * 为什么不能只靠 `estimateScaleHint`：那个公式假设「Σ部件面积 ≈ 1.3 × 角色轮廓
 * 面积」，而实测这个重叠系数在不同画风之间能从 1.2 飘到 19——鲸鱼女仆那张图
 * 有裙子、围裙、头发、尾巴层层叠叠，系数约 19，先验直接估出 0.64（真值约 0.34），
 * 于是一整套定位全错。
 *
 * 这里换成直接量：
 *   - 对每个候选缩放，在**最粗的一档**给每个部件找最优位置（只看位置，很便宜）；
 *   - 统计两件事：各部件相似度的均值，以及**这些部件合起来盖住了角色轮廓的多大比例**。
 * 覆盖率是关键：缩放太小的时候每个部件自己都很像（缩进内部当然像），但合起来
 * 只盖住角色的一小块，覆盖率会掉下来；缩放太大部件会越出轮廓，覆盖率门槛直接
 * 把它们挡掉。两项相加的峰值就落在真值附近，而且与画风无关。
 */
export function chooseGlobalScale(pyramid, parts, options = {}) {
    const candidates = options.candidates ?? (() => {
        const out = [];
        for (let i = 0; i < 12; i++)
            out.push(Number((0.06 * (2.0 / 0.06) ** (i / 11)).toFixed(4)));
        return out;
    })();
    const evidenceWeight = options.evidenceWeight ?? 0.35;
    const minCoverage = options.minCoverage ?? 0.5;
    // 覆盖率只是**次要**信号：角色占满画面时，缩放越大掩码盖住的角色像素越多，
    // 覆盖率会单调上涨（实测 1.45 倍时仍能到 0.93），权重给大了峰值就会被推到
    // 明显偏大的尺度上。主信号用「各部件相似度的均值」——它的峰值实测落在真值
    // 附近，覆盖率只用来在分数接近时偏向「更完整地铺满角色」的那个。
    const coverageWeight = options.coverageWeight ?? 0.15;
    const level = pyramid.levels[0];
    const prepared = parts.map((part) => toGrayMask(part, 128));
    const foregroundArea = Math.max(1, level.foregroundCount);
    const probes = [];
    let best;
    const probeScale = (target, source, scale, config) => {
        const level = target.levels[0];
        let sum = 0;
        let counted = 0;
        const covered = new Uint8Array(level.gray.width * level.gray.height);
        for (const base of source) {
            const tw = base.width * scale * level.factor;
            const th = base.height * scale * level.factor;
            if (tw < 3 || th < 3 || tw > level.gray.width * 0.98 || th > level.gray.height * 0.98) {
                counted++;
                continue;
            }
            const tpl = prepareTemplate(resizeGrayMask(base, tw, th));
            counted++;
            if (tpl === undefined)
                continue;
            const stride = Math.max(1, Math.min(4, Math.floor(Math.min(tpl.gray.width, tpl.gray.height) / 6)));
            const hit = searchAtLevel(level.gray, level.foreground, config.foregroundArea, tpl, stride, undefined, 0, config.minCoverage, config.evidenceWeight);
            if (hit === undefined)
                continue;
            sum += hit.score;
            // 覆盖率按**模板掩码**累计，不能按包围盒：包围盒随缩放单调变大，
            // 覆盖率也会跟着单调涨，峰值永远落在最大的那个候选上。用掩码时，
            // 放大过头会让掩码越出角色轮廓、per-part 覆盖率掉到门槛以下被直接丢弃，
            // 于是覆盖率曲线先升后降，峰值才落在真值附近。
            for (let k = 0; k < tpl.count; k++) {
                const rx = hit.x + tpl.dx[k];
                if (rx < 0 || rx >= level.gray.width)
                    continue;
                const ry = hit.y + tpl.dy[k];
                if (ry < 0 || ry >= level.gray.height)
                    continue;
                const idx = ry * level.gray.width + rx;
                if (level.foreground[idx] === 1)
                    covered[idx] = 1;
            }
        }
        let coveredCount = 0;
        for (let i = 0; i < covered.length; i++)
            if (covered[i] === 1)
                coveredCount++;
        return {
            scale,
            meanScore: Number((sum / Math.max(1, counted)).toFixed(4)),
            coverage: Number((coveredCount / config.foregroundArea).toFixed(4))
        };
    };
    for (const scale of candidates) {
        const probe = probeScale(pyramid, prepared, scale, { evidenceWeight, minCoverage, foregroundArea });
        probes.push(probe);
        const total = probe.meanScore + coverageWeight * probe.coverage;
        if (best === undefined || total > best.total)
            best = { scale: probe.scale, meanScore: probe.meanScore, coverage: probe.coverage, total };
    }
    if (best === undefined)
        return { scale: 1, meanScore: 0, coverage: 0, probes };
    // 第二轮：在第一轮最优值的**相邻两个候选之间**再插 4 个点。第一轮是 12 个
    // 跨 33 倍的候选（相邻比 1.34），直接用它当缩放会有 ±15% 的量化误差——
    // 对小腿/脚这类小部件就是「明显偏小」。第二轮把误差压到 ±3% 以内，代价只是
    // 4 次探测。
    const sorted = [...candidates].sort((a, b) => a - b);
    const index = sorted.indexOf(best.scale);
    if (index >= 0) {
        const lo = sorted[Math.max(0, index - 1)];
        const hi = sorted[Math.min(sorted.length - 1, index + 1)];
        if (hi > lo) {
            for (let i = 1; i <= 4; i++) {
                const scale = Number((lo + ((hi - lo) * i) / 5).toFixed(4));
                if (candidates.includes(scale) || scale === best.scale)
                    continue;
                const probe = probeScale(pyramid, prepared, scale, { evidenceWeight, minCoverage, foregroundArea });
                probes.push(probe);
                const total = probe.meanScore + coverageWeight * probe.coverage;
                if (total > best.total)
                    best = { scale, meanScore: probe.meanScore, coverage: probe.coverage, total };
            }
        }
    }
    return { scale: best.scale, meanScore: Number(best.meanScore.toFixed(4)), coverage: Number(best.coverage.toFixed(4)), probes };
}
/** 在完整分辨率上评估一个已有摆放的得分（不搜索，只打分）。 */
export function scorePlacement(reference, part, placement, foregroundTolerance = 40, ignored) {
    const gray = toGrayMask(reference, 128);
    const foreground = referenceForeground(reference, foregroundTolerance);
    const prepared = prepareTemplate(resizeGrayMask(rotateGrayMask(toGrayMask(part, 128), placement.rotation), Math.max(3, placement.width), Math.max(3, placement.height)));
    if (prepared === undefined)
        return undefined;
    return znccAt(gray, foreground, prepared, Math.round(placement.x), Math.round(placement.y), ignored);
}
function overlapRatio(a, b) {
    const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const inter = ox * oy;
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    return smaller <= 0 ? 0 : inter / smaller;
}
/** 把若干矩形涂成底色，得到一份「这些地方已经有人占了」的参考图。 */
function blankRegions(reference, boxes, tolerance) {
    const copy = { data: Buffer.from(reference.data), width: reference.width, height: reference.height };
    const background = detectBackground(reference);
    for (const box of boxes) {
        const x1 = Math.max(0, Math.round(box.x - tolerance));
        const y1 = Math.max(0, Math.round(box.y - tolerance));
        const x2 = Math.min(reference.width, Math.round(box.x + box.width + tolerance));
        const y2 = Math.min(reference.height, Math.round(box.y + box.height + tolerance));
        for (let y = y1; y < y2; y++) {
            for (let x = x1; x < x2; x++) {
                const idx = (y * reference.width + x) * 4;
                copy.data[idx] = background[0];
                copy.data[idx + 1] = background[1];
                copy.data[idx + 2] = background[2];
            }
        }
    }
    return copy;
}
/**
 * 一次求解全部部件的装配位置。
 *
 * 三件事按顺序做：
 *   ① 用几何先验定出缩放阶梯（见 `estimateScaleHint`），逐个匹配；
 *   ② 失败的部件用宽阶梯兜底再试一次——先验虽然通常很准，但拆件图被生图模型
 *      画得比例失调时也会失手，兜底比直接报失败好；
 *   ③ **冲突消解**：左右对称的部件（比如两条大腿）颜色形状几乎一样，
 *      纯靠外观匹配会把它们都放到同一侧。这里按得分从高到低逐个确认，后确认的
 *      部件如果和已确认的区域重叠超过一半，就把那块地方「涂掉」重新匹配一次，
 *      逼它去找另一个候选位置。
 */
export function solveLayout(reference, parts, options = {}) {
    const longEdge = options.longEdge ?? 448;
    const foregroundTolerance = options.foregroundTolerance ?? 40;
    const evidenceWeight = options.evidenceWeight ?? 0.35;
    const minCoverage = options.minCoverage ?? 0.5;
    const pyramid = buildReferencePyramid(reference, longEdge, foregroundTolerance);
    // 先按图像证据选全局缩放，几何公式只作为兜底：公式里的「重叠系数」随画风
    // 能从 1.2 飘到 19，靠它定阶梯中心会把整批部件都定错。
    const chosen = chooseGlobalScale(pyramid, parts.map((part) => part.rgba));
    // 只在「连一个像样的候选都没有」时才回退到几何公式。覆盖率不能作为否决条件：
    // 角色只占画面一小部分时，正确尺度下的覆盖率本来就不高（实测 0.29）。
    const hint = chosen.meanScore >= 0.2 ? chosen.scale : estimateScaleHint(reference, parts.map((part) => part.rgba));
    const narrow = scaleLadderAround(hint);
    const wide = wideScaleLadder();
    const placements = {};
    const failed = [];
    const attempts = new Map();
    const hints = options.hints ?? {};
    const hintMargin = options.hintMargin ?? 0.35;
    // 先验隐含的缩放：拿「先验框尺寸 / 部件像素尺寸」的中位数当全局倍率。
    // 这比面积公式与覆盖率探测都直接——它就是「模型说这块该多大」。
    const hintedScales = [];
    for (const part of parts) {
        const hintBox = hints[part.name];
        if (hintBox === undefined || hintBox.width <= 0 || hintBox.height <= 0)
            continue;
        hintedScales.push(hintBox.width / part.rgba.width, hintBox.height / part.rgba.height);
    }
    const hintedScale = hintedScales.length >= 2 ? hintedScales.slice().sort((a, b) => a - b)[Math.floor(hintedScales.length / 2)] : undefined;
    /**
     * 某个部件的搜索框。**每一处重新匹配都要带上它**——先验只约束「初次匹配」
     * 是不够的：后面的冲突消解 / 遮挡修正 / 镜像消解都会重新搜一次位置，漏掉任何
     * 一处，那一处就能把部件挪到先验框外面去（实测 16 个先验里 13 个最终出框）。
     */
    const boundsOf = (name) => {
        const box = hints[name];
        if (box === undefined)
            return undefined;
        return {
            x0: box.x - box.width * hintMargin,
            y0: box.y - box.height * hintMargin,
            x1: box.x + box.width * (1 + hintMargin),
            y1: box.y + box.height * (1 + hintMargin)
        };
    };
    for (const part of parts) {
        const hintBox = hints[part.name];
        const bounds = boundsOf(part.name);
        // 有先验时把缩放阶梯收窄到先验倍率附近（模型给的尺寸本来就比我们的估计准），
        // 没有先验才回到全局阶梯。
        const ownScale = hintBox === undefined ? undefined : (hintBox.width / part.rgba.width + hintBox.height / part.rgba.height) / 2;
        const ladder = ownScale !== undefined && ownScale > 0.004 ? scaleLadderAround(ownScale).slice(1, 4) : narrow;
        let result = matchPartInPyramid(pyramid, part.rgba, {
            scales: ladder,
            evidenceWeight,
            minCoverage,
            scalePrior: ownScale ?? hintedScale ?? hint,
            bounds
        });
        let tries = 1;
        let retried = false;
        if (result === undefined) {
            // 兜底：先验可能被「拆件图比例失调」带偏，换成宽阶梯再找一次。
            //
            // 但门槛必须**显著更高**：宽阶梯横跨 7 倍尺度，在低细节（平涂）美术上
            // 几乎总能找到一个「看起来还行」的错误位置，分数还不低。实测把阈值放到
            // 0.62 之后，这类假阳性被挡掉了，真正比例失调的部件仍然能找到。
            const retry = matchPartInPyramid(pyramid, part.rgba, {
                scales: wide,
                evidenceWeight,
                minCoverage: Math.max(0.5, minCoverage),
                scalePrior: hintedScale ?? hint,
                // 兜底重试也**不能放开先验框**：放开了就等于回到全图盲搜，
                // 而那正是我们要修的东西。只在框内放宽缩放。
                bounds
            });
            if (retry !== undefined && retry.score >= 0.62)
                result = retry;
            tries = 2;
            retried = true;
        }
        attempts.set(part.name, tries);
        options.onPart?.(part.name, { result, attempts: tries, retried });
        if (result === undefined) {
            failed.push(part.name);
            continue;
        }
        placements[part.name] = result;
    }
    // ③ 冲突消解：按得分从高到低确认，重叠过多的后到者被要求换位置。
    const resolved = [];
    const ranked = Object.entries(placements).sort((a, b) => b[1].score - a[1].score);
    const accepted = [];
    for (const [name, box] of ranked) {
        const clash = accepted.find((item) => overlapRatio(item.box, box) > 0.55);
        if (clash === undefined) {
            accepted.push({ name, box });
            continue;
        }
        const part = parts.find((item) => item.name === name);
        if (part === undefined)
            continue;
        const blanked = blankRegions(reference, [clash.box], Math.max(6, Math.round(Math.max(clash.box.width, clash.box.height) * 0.05)));
        const second = matchPartInPyramid(buildReferencePyramid(blanked, longEdge, foregroundTolerance), part.rgba, {
            scales: narrow,
            evidenceWeight,
            minCoverage: Math.max(0.4, minCoverage - 0.1),
            scalePrior: hint,
            bounds: boundsOf(name)
        });
        // 冲突就是硬证据：两块部件都指向同一处，最多只有一个是对的。
        // 所以这里不要求「新位置得分更高」，只要新位置本身站得住就采纳。
        if (second !== undefined && second.score >= Math.max(0.4, box.score - 0.25)) {
            placements[name] = second;
            accepted.push({ name, box: second });
            resolved.push(name);
        }
        else {
            // 换不成更好的位置就保留原样：宁可让用户看到重叠，也不要悄悄挪到错误的地方。
            accepted.push({ name, box });
        }
    }
    // ④ 遮挡感知再匹配。
    //
    // 每个部件只应该用「没被前面部件挡住」的像素来定位。不做这一步时，匹配会自动
    // 缩到可见区域：躯干被头挡住顶部就整体下移十几像素，大腿被躯干挡住上半就整体
    // 下移——这是自动装配里最大的一类系统误差，而且它是**系统性**的，用户逐个微调
    // 也很烦。这里用第一遍得到的 z 序，把「挡在它前面的部件」先从参考图里涂掉，
    // 再重新匹配一次；只有得分确实变好才采纳。
    const placedForOrder = [];
    for (const [name, box] of Object.entries(placements)) {
        const part = parts.find((item) => item.name === name);
        if (part === undefined)
            continue;
        placedForOrder.push({
            name,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            rgba: resizeRgba(part.rgba, Math.max(1, box.width), Math.max(1, box.height))
        });
    }
    const moved = [];
    const drawOrder = options.drawOrder ?? [];
    if (placedForOrder.length >= 2 && drawOrder.length > 0) {
        const rank = new Map(drawOrder.map((name, index) => [name, index]));
        for (const name of drawOrder) {
            const current = placements[name];
            const part = parts.find((item) => item.name === name);
            if (current === undefined || part === undefined)
                continue;
            const front = placedForOrder.filter((item) => (rank.get(item.name) ?? -1) > (rank.get(name) ?? -1));
            if (front.length === 0)
                continue;
            const tolerance = Math.max(4, Math.round(Math.max(current.width, current.height) * 0.04));
            const ignore = boxMask(reference.width, reference.height, front, tolerance);
            const before = scorePlacement(reference, part.rgba, current, foregroundTolerance, ignore);
            const candidate = matchPartInPyramid(pyramid, part.rgba, {
                scales: [current.scale * 0.9, current.scale * 0.95, current.scale, current.scale * 1.05, current.scale * 1.1],
                rotations: [-5, 0, 5].map((delta) => current.rotation + delta),
                evidenceWeight,
                minCoverage: Math.max(0.3, minCoverage - 0.2),
                ignoreFull: ignore,
                scalePrior: hint,
                // 遮挡修正同样不能越出先验框：它只该在框内挪一点，而不是重新做一次全局搜索。
                bounds: boundsOf(name)
            });
            if (candidate === undefined || before === undefined)
                continue;
            // 两边都在「涂掉前面部件」的参考图上比，才是公平比较。
            // 门槛放得比较保守（+0.08）：这一步是**修正**而不是重新搜索，
            // 证据不足时宁可保留原样让用户自己拖，也好过悄悄挪到另一个错位置。
            if (candidate.score > before.score + 0.03) {
                placements[name] = candidate;
                moved.push(name);
            }
        }
    }
    // ⑤ 消除「镜像部件挤在同一侧」。
    //
    // 两条大腿、两只手这类左右对称的部件，在 ZNCC 眼里几乎可以互换——相关系数
    // 本来就减掉了均值，纯色平涂的左右肢连明暗差都吃不到。结果是两块都被放在
    // 同一侧，另一侧空着，必然丢一块。
    //
    // 这里用一条**与左右命名约定无关**的几何约束来拆：同一组镜像部件里，得分低的
    // 那一块必须落到角色中线的另一侧去。注意「哪个名字对应画面哪一侧」在整个插件
    // 里都不需要知道，只需要它们分居两侧。
    const characterBox = alphaBounds(reference) ?? { x: 0, y: 0, width: reference.width, height: reference.height };
    const centerX = characterBox.x + characterBox.width / 2;
    const mirroredPairs = [];
    const names = Object.keys(placements);
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            const a = names[i];
            const b = names[j];
            const swap = a.startsWith("left-") && b.startsWith("right-") ? a.slice(5) === b.slice(6) : false;
            if (!swap)
                continue;
            // 挤在一起要拆开；分居两侧但可能「左右弄反」也要复查。
            mirroredPairs.push([a, b]);
        }
    }
    for (const [a, b] of mirroredPairs) {
        const partA = parts.find((item) => item.name === a);
        const partB = parts.find((item) => item.name === b);
        if (partA === undefined || partB === undefined)
            continue;
        const centreOf = (box) => box.x + box.width / 2;
        if (Math.sign(centreOf(placements[a]) - centerX) !== Math.sign(centreOf(placements[b]) - centerX)) {
            // 已经分居两侧了，但「哪块在哪一侧」还要定一下：外观几乎一样时，逐个
            // 打分才是唯一有信息量的比较。这是一次 2×2 指派，把两种配对的总分一比。
            const scoreAt = (part, box) => scorePlacement(reference, part, box, foregroundTolerance)?.score ?? 0;
            const keep = scoreAt(partA.rgba, placements[a]) + scoreAt(partB.rgba, placements[b]);
            const swap = scoreAt(partA.rgba, placements[b]) + scoreAt(partB.rgba, placements[a]);
            if (swap > keep + 0.02) {
                const boxA = placements[a];
                placements[a] = placements[b];
                placements[b] = boxA;
                if (!resolved.includes(a))
                    resolved.push(a);
                if (!resolved.includes(b))
                    resolved.push(b);
            }
            continue;
        }
        // 两块都在同一侧：把输的那块沿中线镜像过去。
        const scoreA = scorePlacement(reference, partA.rgba, placements[a], foregroundTolerance)?.score ?? 0;
        const scoreB = scorePlacement(reference, partB.rgba, placements[b], foregroundTolerance)?.score ?? 0;
        const loser = scoreA >= scoreB ? b : a;
        const loserPart = loser === a ? partA : partB;
        const occupied = centreOf(placements[loser]) >= centerX;
        // 把「目前那一侧」整片忽略掉，逼它去另一侧找位置。
        const ignore = halfPlaneMask(reference.width, reference.height, centerX, occupied);
        // 首选做法：把落单的那块**沿角色中线镜像**过去。
        // 对称角色的左右肢本来就该关于中线互为镜像，这个位移是确定的、可复现的，
        // 比「再搜一次」稳得多（再搜一次往往会落到躯干之类的错误位置）。
        const box = placements[loser];
        const mirrored = { ...box, x: Math.round(2 * centerX - (box.x + box.width)) };
        const mirroredFree = mirrored.x >= -box.width * 0.5 &&
            !Object.entries(placements).some(([other, otherBox]) => other !== loser && overlapRatio(otherBox, mirrored) > 0.5);
        if (mirroredFree) {
            placements[loser] = mirrored;
            if (!resolved.includes(loser))
                resolved.push(loser);
            continue;
        }
        // 兜底：镜像位置被占用时，才回到「把这一侧整片忽略再搜一次」。
        const alternative = matchPartInPyramid(pyramid, loserPart.rgba, {
            scales: narrow,
            evidenceWeight,
            minCoverage: Math.max(0.35, minCoverage - 0.15),
            ignoreFull: ignore,
            scalePrior: hint,
            bounds: boundsOf(loser)
        });
        if (alternative === undefined || alternative.score < 0.45)
            continue;
        if (Math.sign(alternative.x + alternative.width / 2 - centerX) === Math.sign(centreOf(placements[loser]) - centerX))
            continue;
        placements[loser] = alternative;
        if (!resolved.includes(loser))
            resolved.push(loser);
    }
    return { hint, scaleProbes: chosen.probes, hintedCount: Object.keys(hints).filter((name) => parts.some((part) => part.name === name)).length, placements, failed, resolved, moved };
}
/**
 * 按**真实像素邻近距离**把连通域分组，而不是按包围盒。
 *
 * 为什么不能用包围盒：头发那块连通域的包围盒横跨了大半张图，和领子、上衣的包围盒
 * 天然重叠，按包围盒一判就是「相邻」，再经过单链传递（A~B、B~C ⇒ A~C）整张图会被
 * 串成一块——实测把角色串成了一个 1937×1156 的「头」。
 *
 * 这里改成从每个连通域的**边界像素**向外搜 `gap` 像素，只有真的找到另一块的像素才
 * 合并；只扫边界像素（而不是全部前景像素），代价从 O(面积×gap²) 降到 O(周长×gap²)。
 */
export function groupComponentsByProximity(labels, width, height, gap) {
    const parent = new Int32Array(0);
    const ids = new Set();
    for (let i = 0; i < labels.length; i++)
        if (labels[i] >= 0)
            ids.add(labels[i]);
    const maxLabel = ids.size === 0 ? 0 : Math.max(...ids) + 1;
    const find = (map, index) => (map[index] === index ? index : (map[index] = find(map, map[index])));
    const roots = new Int32Array(maxLabel);
    for (let i = 0; i < maxLabel; i++)
        roots[i] = i;
    const union = (a, b) => {
        const ra = find(roots, a);
        const rb = find(roots, b);
        if (ra !== rb)
            roots[rb] = ra;
    };
    const offset = Math.max(1, Math.round(gap));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const label = labels[index];
            if (label < 0)
                continue;
            // 只处理边界像素：右/下邻居已经属于别块，或者自己是前景而邻居是背景。
            const right = x + 1 < width ? labels[index + 1] : -1;
            const down = y + 1 < height ? labels[index + width] : -1;
            if (right >= 0 && right !== label)
                union(label, right);
            if (down >= 0 && down !== label)
                union(label, down);
            if (right >= 0 && down >= 0)
                continue;
            // 边界像素才向外找：跳过中间的空隙，仍能认出「差一点点就接上」的两块。
            for (let dy = -offset; dy <= offset; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height)
                    continue;
                for (let dx = -offset; dx <= offset; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= width)
                        continue;
                    const other = labels[ny * width + nx];
                    if (other >= 0 && other !== label)
                        union(label, other);
                }
            }
        }
    }
    const out = new Array(maxLabel).fill(-1);
    for (const id of ids)
        out[id] = find(roots, id);
    return out;
}
