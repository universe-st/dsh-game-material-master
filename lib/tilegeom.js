/**
 * 地图地块模块的**几何内核**。
 *
 * 纯计算、不碰网络、不碰磁盘 —— 唯一有真实算法复杂度的部分，可以脱离 DSH 单测。
 * 与研究期验证过的 Python 实现逐函数对应（`research/tile-isometric/tools/`），
 * TS 版必须跑出同样的数字，见 `scripts/verify-tile.mjs`。
 *
 * ## 三条不可动摇的原则（来自调研报告，违规会静默出错）
 *
 * 1. **几何量必须从图里量，不允许硬编码任何尺寸。**
 *    研究期把一个 2048 的模板图压到 1536 之后，写死的「宽 1884 / 高 942 / 中心 1024」
 *    全部失效，地块被裁出透明缺口、拼图能看见网格线，**而且不报任何错**。
 * 2. **规整（量 → 对齐 → 裁）不可跳过。** 模型即使走模板填充仍有 0.2%~0.6% 漂移，
 *    位置也不固定；只有模板不规整，拼图就会错位。
 * 3. **不允许用 AI 生成的菱形当模板。** 自由生成达标率 0%（比例 1.03~1.92）。
 *
 * ## 抠底那一套为什么长这样（白边的根因）
 *
 * 一张 2048² 的树缩到 40px 宽，一个输出像素要平均 37×37=1369 个源像素。
 * 边缘那一格里大部分是「半覆盖的抗锯齿像素」，颜色**已经在白底上合成过**，天生偏亮。
 * 如果这时用硬阈值定 alpha（`α≥0.5 → 1`），就得到「完全不透明 + 偏亮颜色」的像素 ——
 * 一圈肉眼可见的白描边。实测一张 64×96 的地块里有 184 个这样的像素。
 *
 * 正确做法（本文件 `matteForeground`）：
 *   ① 软 alpha，且**必须带死区**（纯白底图的压缩噪声 dist≈2~10，
 *      无死区会把整张底判成 α≈0.03 的「前景」，白边反而更严重）；
 *   ② 颜色只取「够实」的像素（α ≥ 0.75），其余用最近可信邻居填充；
 *   ③ 颜色与 alpha **分开**缩放。
 * 实测白边像素 184 → 0，alpha 档位 2 → 115~208，剪影面积不变。
 */
import { borderColor, foregroundMask, maskBounds, maskCount } from "./bitmap.js";
/** 目标菱形的固定尺寸：宽 2 份、高 1 份（严格的 2:1 等距）。 */
export const DIAMOND_RATIO = 2;
/**
 * 裁切遮罩在数学菱形之外的外推量（归一化距离）。
 *
 * ⚠️ 这是「从哪儿开始淡出」的起点，**必须 ≈ 1**（菱形边界）。
 * 写成 0.04 之类的「小余量」会得到灾难性结果：等于把整个菱形内部都当成边界外，
 * 只剩中心极窄一条不透明（实测 64×96 只活下来 4 个像素）。
 *
 * 为什么不能就用严格的 1：2:1 菱形在上下尖端每行只有 0~1 个像素，
 * 像素中心几乎不会正好落在边界线上，用 `d <= 1` 当遮罩会把尖端整行切掉 ——
 * 实测少 16~41 个像素，重新测量时比例变成 1.9375（真值 2.0）。
 *
 * 所以让判定起点略微外推：菱形主体 100% 不透明，再往外 1px 线性淡出。
 * 掩码比数学菱形大不到 1px，肉眼不可见，但尖端能保住。
 */
export const DIAMOND_MASK_SLACK = 1.0;
/**
 * 规整时把目标菱形放大的**比例**（相对于单元格菱形的半宽/半高）。
 *
 * ## 为什么需要它（拼缝白线的真正原因）
 *
 * 源图里菱形的边是**抗锯齿**的：从实心到全透明只有约 3 个源像素。
 * 而源图 2048、单元格只有 64 宽 —— 缩放系数约 0.03，也就是**每个输出像素
 * 要平均约 30×60 个源像素**。在菱形边界上，采样核一半在菱形内、一半在外，
 * 于是边界像素的 alpha 只到 ~213，往外一圈掉到 42。
 *
 * 后果：单元格菱形的整条边都是半透明的，相邻两块拼起来两边都半透明，
 * 背景从缝里透出来 —— 地图上出现一圈白线（实测就是这个问题）。
 *
 * 修法：**取到源菱形内侧一点**。把目标菱形放大 12%，单元格边界对应的源坐标
 * 就落到源菱形内部约 12% 半宽处 —— 那里采样核完全在实心区，alpha 是 255。
 * 再让掩盖把菱形之外切掉，于是「边界不透明 + 不带出体外像素」同时成立。
 *
 * ⚠️ 必须是**比例**而不是固定像素数。曾经写成「多取 6px」，
 * 在 32×48 的单元格上等于放大 37%，把地块横向拉伸了 27%（x/y 缩放比失衡）。
 * 比例则天然按两个方向等比放大，不会变形 —— `verify-tile.mjs` 的 P1a 钉这条。
 */
export const OVERSCAN_RATIO = 0.12;
export const DEFAULT_SETTINGS = { cellWidth: 64, cellHeight: 96 };
/** 菱形高 = 单元格宽 / 2（2:1 等距）。**与 cellHeight 无关**。 */
export function diamondHeight(s) {
    return s.cellWidth / DIAMOND_RATIO;
}
/** 菱形在单元格里的中心 y：上下各留同样多的余量给装饰。 */
export function diamondCenterY(s) {
    return s.cellHeight / 2;
}
/** 独立装饰的底部锚点：地面上「站得住」的高度（详见 research 报告 §8.3）。 */
export function decorAnchorY(s) {
    // 菱形下顶点 y = cy + dh/2；菱形中轴处的地面线比下顶点高 dh/4（2:1 菱形的几何性质）；
    // 再扣 2px 抗锯齿与实测误差。64×96 → 48 + 16 − 8 − 2 = 54。
    return Math.round(diamondCenterY(s) + diamondHeight(s) / 2 - diamondHeight(s) / 4 - 2);
}
export function assertSettings(s) {
    if (!Number.isInteger(s.cellWidth) || s.cellWidth < 16 || s.cellWidth > 512) {
        throw new Error(`单元格宽必须是 16~512 的整数，收到 ${s.cellWidth}`);
    }
    if (!Number.isInteger(s.cellHeight) || s.cellHeight < 32 || s.cellHeight > 768) {
        throw new Error(`单元格高必须是 32~768 的整数，收到 ${s.cellHeight}`);
    }
    if (s.cellWidth % 4 !== 0) {
        throw new Error(`单元格宽必须能被 4 整除（菱形半宽要落在整数格上），收到 ${s.cellWidth}`);
    }
    if (s.cellHeight <= diamondHeight(s)) {
        throw new Error(`单元格高（${s.cellHeight}）必须大于菱形高（${diamondHeight(s)}），否则没有空间放高出地面的装饰`);
    }
}
// ── 菱形遮罩 ──────────────────────────────────────────────────────────────
/**
 * 目标菱形（单元格坐标系）的四顶点。
 *
 * 64×96 时：上 (32,32) 右 (64,48) 下 (32,64) 左 (0,48)。
 */
export function diamondPoints(s) {
    const cx = s.cellWidth / 2;
    const cy = diamondCenterY(s);
    const hw = s.cellWidth / 2;
    const hh = diamondHeight(s) / 2;
    return { top: [cx, cy - hh], right: [cx + hw, cy], bottom: [cx, cy + hh], left: [cx - hw, cy] };
}
/**
 * 菱形软遮罩。`|dx|/hw + |dy|/hh <= 1` 处为 255，边界带 `feather` 像素羽化。
 *
 * 返回 0~255 的单通道。羽化是为了避免硬边在缩放后出现台阶。
 */
export function diamondAlpha(s, feather = 0.7) {
    const { cellWidth: w, cellHeight: h } = s;
    const cx = w / 2;
    const cy = diamondCenterY(s);
    const hw = w / 2;
    const hh = diamondHeight(s) / 2;
    const out = new Uint8Array(w * h);
    const ramp = Math.max(1e-6, feather / hh);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.abs(x + 0.5 - cx) / hw + Math.abs(y + 0.5 - cy) / hh;
            const a = Math.max(0, Math.min(1, (1 - d) / ramp + 0.5));
            out[y * w + x] = Math.round(a * 255);
        }
    }
    return out;
}
/**
 * 点是否落在数学菱形内（规整裁切用；不做羽化）。
 *
 * ⚠️ 直接用这个布尔值当 alpha 遮罩会**切掉菱形边缘那一圈像素**：
 * 2:1 菱形的边界是一条 26.565° 的斜线，像素中心几乎不会正好落在线上，
 * 于是「<= 1」的行会整体少一个像素 —— 实测 64×96 的菱形会少 16~41 个像素、
 * 重新测量时比例变成 31/16 = 1.9375（真值 2.0）。
 *
 * 正确做法见 `regularizeToCell`：用**带 1px 羽化的软遮罩**，
 * 边界像素给半透明而不是直接判 0。
 */
export function insideDiamond(s, x, y) {
    const cx = s.cellWidth / 2;
    const cy = diamondCenterY(s);
    return (Math.abs(x + 0.5 - cx) / (s.cellWidth / 2) + Math.abs(y + 0.5 - cy) / (diamondHeight(s) / 2) <= 1);
}
/**
 * 菱形软遮罩的**归一化距离**：<= 1 在菱形内，越接近 1 越靠边。
 *
 * 用来做「带羽化的裁切」：`alpha = clamp((1 + halfFeather - d) / feather)`。
 */
export function diamondDistance(s, x, y) {
    const cx = s.cellWidth / 2;
    const cy = diamondCenterY(s);
    return (Math.abs(x + 0.5 - cx) / (s.cellWidth / 2) + Math.abs(y + 0.5 - cy) / (diamondHeight(s) / 2));
}
/**
 * 按等距网格排布 cols×rows 个菱形的模板。
 *
 * 位置公式（与研究期 `mk-templates2.py` 一致）：
 *   格子 (r, c) 的菱形中心 = 画布中心 + ((c−r)·tw/2, (c+r)·th/2) − 包围盒中心偏移
 * 相邻格正好边对边贴合，所以 2×2 拼出来是一整块大菱形。
 */
export function renderTemplate(options = {}) {
    const size = options.size ?? 2048;
    const cols = options.cols ?? 1;
    const rows = options.rows ?? 1;
    const margin = options.margin ?? 0.92;
    const color = options.color ?? [255, 0, 255];
    const ss = Math.max(1, Math.floor(options.supersample ?? 4));
    // 包围盒（以 tw 为单位）：宽 = (cols+rows)/2 · tw，高 = (cols+rows)/4 · tw
    const span = (cols + rows) / 2;
    const twUnit = Math.min(size * margin / span, size * margin / (span / 2));
    // 中心：所有菱形中心的平均（用包围盒中心校正，避免 (0,0) 起点带来的偏移）
    const cxUnit = ((0 - 0) + (cols - 1 - (rows - 1))) / 4 * twUnit;
    const cyUnit = ((0 + 0) + (cols - 1 + rows - 1)) / 4 * (twUnit / 2);
    const S = size * ss;
    const rgba = Buffer.alloc(S * S * 4);
    const tw = twUnit * ss;
    const th = (twUnit / 2) * ss;
    const diamonds = [];
    const fillDiamond = (cxSS, cySS, mark) => {
        // ⚠️ 坐标系统一：`tw` / `th` 是**超采样画布**上的尺寸（上面已经乘过 ss），
        // 所以半径直接用 `tw/2`，不要再乘 ss —— 乘两次会得到 4 倍宽的菱形
        //（表现是模板比例 2.03、只占画布 23%），而且不报任何错。自检 G1 钉这条。
        const hw = tw / 2;
        const hh = th / 2;
        const y0 = Math.max(0, Math.floor(cySS - hh));
        const y1 = Math.min(S - 1, Math.ceil(cySS + hh));
        for (let y = y0; y <= y1; y++) {
            const dy = Math.abs(y + 0.5 - cySS) / hh;
            if (dy > 1)
                continue;
            const half = hw * (1 - dy);
            const x0 = Math.max(0, Math.ceil(cxSS - half));
            const x1 = Math.min(S - 1, Math.floor(cxSS + half));
            for (let x = x0; x <= x1; x++) {
                const i = (y * S + x) * 4;
                rgba[i] = color[0];
                rgba[i + 1] = color[1];
                rgba[i + 2] = color[2];
                rgba[i + 3] = 255;
            }
        }
        if (mark)
            diamonds.push({ cx: cxSS / ss, cy: cySS / ss, width: tw / ss, height: th / ss });
        // 注意：这四个字段都要换算回降采样后的坐标。漏掉任何一个，
        // 下游拿到的包围盒就是错的 —— 表现是仿射缩放算错、地块被裁出缺口，且不报错。
    };
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cx = (size / 2 + ((c - r) * twUnit) / 2 - cxUnit) * ss;
            const cy = (size / 2 + ((c + r) * (twUnit / 2)) / 2 - cyUnit) * ss;
            fillDiamond(cx, cy, true);
        }
    }
    // 2×2 地基：洋红外框（整个网格的等距外轮廓）+ 红色分格线（每个子菱形的对角线）。
    // 分格线是给模型看的 —— 让它理解「这是 4 格」，而不是「一整块地面」。
    // 实测：不给分格线时模型会把 4 格画成一整块地基（比例 1.27）。
    if (options.grid === true) {
        const outline = [255, 0, 255];
        const divider = [255, 60, 60];
        // 网格整体是一个大菱形：宽 = (cols+rows)/2 · tw，高 = 宽/2
        const bigW = ((cols + rows) / 2) * twUnit * ss;
        const bigH = bigW / 2;
        const bigCx = (size / 2) * ss;
        const bigCy = (size / 2) * ss;
        const width = Math.max(2, Math.round(bigW * 0.004));
        const corners = [
            [bigCx, bigCy - bigH / 2],
            [bigCx + bigW / 2, bigCy],
            [bigCx, bigCy + bigH / 2],
            [bigCx - bigW / 2, bigCy]
        ];
        for (let i = 0; i < 4; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % 4];
            for (let k = 0; k < width; k++) {
                line(rgba, S, a[0], a[1] + k, b[0], b[1] + k, outline, ss);
            }
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = (size / 2 + ((c - r) * twUnit) / 2 - cxUnit) * ss;
                const cy = (size / 2 + ((c + r) * (twUnit / 2)) / 2 - cyUnit) * ss;
                line(rgba, S, cx, cy - th / 2, cx, cy + th / 2, divider, ss);
                line(rgba, S, cx - tw / 2, cy, cx + tw / 2, cy, divider, ss);
            }
        }
    }
    const bitmap = downsample({ width: S, height: S, rgba }, size, size, ss);
    // `diamonds[]` 在 fillDiamond 里**已经**换算成降采样坐标了（cx/ss、width/ss），
    // 这里不能再除一次 —— 除两次会得到「缩小 4 倍」的包围盒：菱形只剩画布 23%、
    // 中心落在 (64,64) 而不是画布中心，而且不报任何错。自检 G1 钉这条。
    return { bitmap, bounds: boundsOfDiamonds(diamonds, size), diamonds };
}
/**
 * 建筑模板：**地基范围 + 立体容积**。
 *
 * 为什么不能用 `renderTemplate({grid:true})` 那份：那份是一整块实心洋红菱形，
 * 模型会把它理解成「把这块地面填满」—— 实测「中世纪石屋」生成出来是一张
 * **平铺的菱形石板地面**（`ratioMeasured` 2.26），完全没有墙和屋顶。
 * 提示词里写「往上长高 1.4 倍」也没用：参考图里根本没有「上」的空间，
 * 整张图从上到下都是那块菱形。
 *
 * 这份模板改成：
 *   · 洋红**轮廓**画出 4 格地基（不是实心填充）—— 明确「底面在哪」；
 *   · 中间铺一层浅灰地面，让模型知道这里是地不是墙；
 *   · 从地基四个角往**上**拉出等距立方体的线框 —— 明确「能长多高、往哪长」。
 *
 * 输出画布就是「2×2 格块」的形状（宽 4·halfW、高 3·halfH + 高度），
 * 与 `regularizeBuilding` 的落位尺寸一一对应。
 */
/**
 * 底面各格在模板里的**菱形中心**（逻辑单位，未乘缩放系数）。
 *
 * ★ 以 `tilemap.shapeBaseOffset` 的**同一个点**为原点 —— 即
 * 「各格菱形中心相对**锚点格中心**的偏移」，也就是
 * `dx = ((min(c−r) + max(c−r))/2)·cellWidth/2`、
 * `dy = ((min(c+r) + max(c+r))/2)·cellWidth/4`。
 * 最终整块会平移到 `(cx, baseCy)`。
 *
 * ⚠️ **不能用「各格中心的包围盒中点」当原点**：两者对非对称形状**不是同一个点**。
 * 实测 `3×1`（格子 `(0,0)(0,1)(0,2)`）：
 *   · 拼图口径（`shapeBaseOffset`）→ 底心相对锚点 `dx = +32`
 *   · 包围盒中点口径 → `dx = 0`
 * 于是模板把 `3×1` 画在了与 `2×2` **完全相同**的位置上（两者半宽半高都是
 * 64×32），两张模板**逐字节相同** —— 用户报的「3×1 模板和 2×2 没区别」。
 * 统一到拼图口径之后，`3×1` 的底面会在模板里**偏右半格**，一眼能看出不同。
 *
 * 为什么按「一格一个菱形」而不是「一个大包围菱形」：
 * L 形、T 形这类**非矩形**占地，用一个包围菱形画出来模型会以为整块都是地基，
 * 于是把凹口也填成地面。逐格画才能把「哪些格是地基」讲清楚。
 */
export function buildingBaseCells(settings, shape) {
    if (shape.length === 0)
        return [{ cx: 0, cy: 0 }];
    const stepX = settings.cellWidth / 2;
    const stepY = settings.cellWidth / 4;
    // 锚点格中心 → 底面中心的偏移（与 tilemap.shapeBaseOffset 同式）
    let minDR = Infinity, maxDR = -Infinity, minDC = Infinity, maxDC = -Infinity;
    for (const [r, c] of shape) {
        if (r < minDR)
            minDR = r;
        if (r > maxDR)
            maxDR = r;
        if (c < minDC)
            minDC = c;
        if (c > maxDC)
            maxDC = c;
    }
    const baseX = ((minDC - minDR) + (maxDC - maxDR)) / 2;
    const baseY = ((minDC + minDR) + (maxDC + maxDR)) / 2;
    return shape.map(([r, c]) => ({
        cx: ((c - r) - baseX) * stepX,
        cy: ((c + r) - baseY) * stepY
    }));
}
export function renderBuildingTemplate(options) {
    const settings = options.settings;
    const cols = options.cols ?? 2;
    const rows = options.rows ?? 2;
    const heightRatio = options.heightRatio ?? 1.5;
    const ss = Math.max(1, Math.floor(options.supersample ?? 2));
    // 形状是三处口径的**唯一真源**：包围菱形（宽高）、逐格底面、线框。
    const shape = options.shape ?? rectShapeLocal(cols, rows);
    const T = buildingTemplateLayout(settings, { cols, rows, shape, heightRatio, pad: options.pad ?? 8 });
    const { halfW, halfH, boxH, pad } = T;
    const W = T.width;
    const H = T.height;
    // 长边缩放到目标尺寸（短边等比），保证模板足够大给模型细节
    const target = options.size ?? 2048;
    const scale = target / Math.max(W, H);
    const outW = Math.max(64, Math.round(W * scale));
    const outH = Math.max(64, Math.round(H * scale));
    const S = { w: outW * ss, h: outH * ss };
    const rgba = Buffer.alloc(S.w * S.h * 4);
    const k = scale * ss; // 逻辑单位 → 超采样像素
    const cx = (pad + halfW) * k;
    const baseCy = T.baseCenterY * k; // 底面（包围菱形中心）
    const magenta = [255, 0, 255];
    const ground = [238, 238, 234];
    const wire = [120, 190, 255];
    const lw = Math.max(2, Math.round(halfW * k * 0.006));
    const fillTri = (pts, color) => {
        let minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
            minY = Math.min(minY, p[1]);
            maxY = Math.max(maxY, p[1]);
        }
        for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(S.h - 1, Math.ceil(maxY)); y++) {
            const xs = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
                    xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
                }
            }
            xs.sort((p, q) => p - q);
            for (let i = 0; i + 1 < xs.length; i += 2) {
                const x0 = Math.max(0, Math.ceil(xs[i]));
                const x1 = Math.min(S.w - 1, Math.floor(xs[i + 1]));
                for (let x = x0; x <= x1; x++) {
                    const idx = (y * S.w + x) * 4;
                    rgba[idx] = color[0];
                    rgba[idx + 1] = color[1];
                    rgba[idx + 2] = color[2];
                    rgba[idx + 3] = 255;
                }
            }
        }
    };
    // 地基：底面 + 洋红轮廓。
    //
    // **实心矩形走老路径**（一个大包围菱形），非矩形才逐格画。
    //
    // 为什么矩形不逐格：老的 2×2 模板就是这一张大菱形，实测效果没问题；
    // 改成逐格会**少一圈外轮廓、多一道内部网格线**，与老图不一致 ——
    // 老项目里已经渲染好的 `grid2x2.png` 就得全部重跑。保持逐字节一致更划算。
    //
    // 非矩形必须逐格：画包围大菱形等于告诉模型「凹口也是地基」，
    // 它会把凹口填成地面 —— L 形就没意义了。
    const baseCells = buildingBaseCells(settings, shape);
    const cellHalfW = (settings.cellWidth / 4) * k; // 单格菱形半宽
    const cellHalfH = cellHalfW / 2;
    const bTop = [cx, baseCy - halfH * k];
    const bRight = [cx + halfW * k, baseCy];
    const bBottom = [cx, baseCy + halfH * k];
    const bLeft = [cx - halfW * k, baseCy];
    const isRect = rectOfShapeLocal(shape) !== undefined;
    if (isRect) {
        // 老路径：一张大菱形，填灰 + 洋红轮廓
        const quad = [bTop, bRight, bBottom, bLeft];
        fillTri(quad, ground);
        for (let i = 0; i < 4; i++) {
            const a = quad[i];
            const b = quad[(i + 1) % 4];
            for (let t = -lw; t <= lw; t++)
                line(rgba, S.w, a[0], a[1] + t, b[0], b[1] + t, magenta, ss);
        }
    }
    else {
        // 非矩形：**逐格**画（每格浅灰 + 洋红），凹口自然留空。
        for (const cell of baseCells) {
            const bx = cx + cell.cx * k;
            const by = baseCy + cell.cy * k;
            const cTop = [bx, by - cellHalfH];
            const cRight = [bx + cellHalfW, by];
            const cBottom = [bx, by + cellHalfH];
            const cLeft = [bx - cellHalfW, by];
            const quad = [cTop, cRight, cBottom, cLeft];
            // 矩形已经用大菱形铺过灰底了，逐格只需要**分格线**，不必再填一遍 ——
            // 填了会在底面里叠出一圈比底面更亮的格子，看着像浮着几个小菱形。
            if (!isRect)
                fillTri(quad, ground);
            for (let i = 0; i < 4; i++) {
                const a = quad[i];
                const b = quad[(i + 1) % 4];
                for (let t = -lw; t <= lw; t++)
                    line(rgba, S.w, a[0], a[1] + t, b[0], b[1] + t, magenta, ss);
            }
        }
    }
    // ★ 多格形状再画出**逐格分隔线**。
    //
    // ⚠️ 为什么非画不可（真机踩过）：等距投影下 `3×1` 与 `2×2` 的底面
    // **占用完全相同的菱形**（半宽半高都是 64×32，只是内部切法不同）——
    // 实测两张模板**逐像素完全一样**，用户报的「3×1 模板和 2×2 没区别」
    // 不是错觉，是渲染结果真的相同。轮廓一样的时候，
    // 「一共几格、怎么排」只能靠**分格线**表达。
    //
    // 单格不画（没有内部分隔）。用稍暗的洋红，免得与底面外轮廓糊成一片。
    if (shape.length > 1) {
        const divider = [190, 0, 190];
        for (const cell of baseCells) {
            const bx = cx + cell.cx * k;
            const by = baseCy + cell.cy * k;
            const quad = [
                [bx, by - cellHalfH],
                [bx + cellHalfW, by],
                [bx, by + cellHalfH],
                [bx - cellHalfW, by]
            ];
            for (let i = 0; i < 4; i++) {
                const a = quad[i];
                const b = quad[(i + 1) % 4];
                for (let t = -lw; t <= lw; t++)
                    line(rgba, S.w, a[0], a[1] + t, b[0], b[1] + t, divider, ss);
            }
        }
    }
    // 立方体线框：**包围菱形**的四个顶点往上拉，顶面再画一个同样的轮廓。
    // 高度是整体概念，逐格画会变成一排小盒子。
    const top = bTop;
    const right = bRight;
    const bottom = bBottom;
    const left = bLeft;
    // 立方体线框：四个角往上拉，顶面再画一个同样的菱形轮廓
    const lift = (p) => [p[0], p[1] - boxH * k];
    const corners = [top, right, bottom, left];
    for (const p of corners) {
        const q = lift(p);
        for (let t = -lw; t <= lw; t++)
            line(rgba, S.w, p[0] + t, p[1], q[0] + t, q[1], wire, ss);
    }
    const lifted = corners.map(lift);
    for (let i = 0; i < 4; i++) {
        const a = lifted[i];
        const b = lifted[(i + 1) % 4];
        for (let t = -lw; t <= lw; t++)
            line(rgba, S.w, a[0], a[1] + t, b[0], b[1] + t, wire, ss);
    }
    // 只把「底面各格」登记为几何基准 —— 建筑的高度是自由的，不参与规整
    const diamonds = baseCells.map((cell) => ({
        cx: (cx + cell.cx * k) / ss,
        cy: (baseCy + cell.cy * k) / ss,
        width: ((settings.cellWidth / 2) * k) / ss,
        height: ((settings.cellWidth / 4) * k) / ss
    }));
    const bitmap = downsample({ width: S.w, height: S.h, rgba }, outW, outH, ss);
    return {
        bitmap,
        bounds: { left: 0, top: 0, right: outW - 1, bottom: outH - 1 },
        diamonds
    };
}
/** 从菱形列表算包围盒（并夹到画布内）。 */
function boundsOfDiamonds(diamonds, size) {
    let left = size;
    let top = size;
    let right = -1;
    let bottom = -1;
    for (const d of diamonds) {
        // 用「比边界内缩一点」的实测口径，与 Python 版 template_diamond 一致
        left = Math.min(left, Math.round(d.cx - d.width / 2));
        right = Math.max(right, Math.round(d.cx + d.width / 2) - 1);
        top = Math.min(top, Math.round(d.cy - d.height / 2));
        bottom = Math.max(bottom, Math.round(d.cy + d.height / 2) - 1);
    }
    return {
        left: Math.max(0, left),
        top: Math.max(0, top),
        right: Math.min(size - 1, right),
        bottom: Math.min(size - 1, bottom)
    };
}
function line(rgba, S, x0, y0, x1, y1, color, ss = 1) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(x0 + (x1 - x0) * t);
        const y = Math.round(y0 + (y1 - y0) * t);
        for (let dy = 0; dy < ss; dy++) {
            for (let dx = 0; dx < ss; dx++) {
                const px = x + dx;
                const py = y + dy;
                if (px < 0 || py < 0 || px >= S || py >= S)
                    continue;
                const i2 = (py * S + px) * 4;
                rgba[i2] = color[0];
                rgba[i2 + 1] = color[1];
                rgba[i2 + 2] = color[2];
                rgba[i2 + 3] = 255;
            }
        }
    }
}
/**
 * 超采样降采样（box filter）。
 *
 * `preserveAlpha` 为真时按 premultiplied 处理：先把 RGB 乘上 alpha 再平均，
 * 最后除回去。这是「不感知 alpha 的缩放会留白边」的正确解法之一 ——
 * 透明像素的颜色不该参与平均。
 */
export function downsample(src, width, height, factor, preserveAlpha = true) {
    if (factor <= 1)
        return src;
    const out = Buffer.alloc(width * height * 4);
    const area = factor * factor;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let dy = 0; dy < factor; dy++) {
                const sy = y * factor + dy;
                if (sy >= src.height)
                    continue;
                for (let dx = 0; dx < factor; dx++) {
                    const sx = x * factor + dx;
                    if (sx >= src.width)
                        continue;
                    const i = (sy * src.width + sx) * 4;
                    const av = src.rgba[i + 3];
                    if (preserveAlpha) {
                        const w = av / 255;
                        r += src.rgba[i] * w;
                        g += src.rgba[i + 1] * w;
                        b += src.rgba[i + 2] * w;
                        a += av;
                    }
                    else {
                        r += src.rgba[i];
                        g += src.rgba[i + 1];
                        b += src.rgba[i + 2];
                        a += av;
                    }
                }
            }
            const aAvg = a / area;
            const o = (y * width + x) * 4;
            if (preserveAlpha && aAvg > 0) {
                const sumAlpha = a / 255;
                out[o] = Math.max(0, Math.min(255, Math.round(r / Math.max(1e-6, sumAlpha))));
                out[o + 1] = Math.max(0, Math.min(255, Math.round(g / Math.max(1e-6, sumAlpha))));
                out[o + 2] = Math.max(0, Math.min(255, Math.round(b / Math.max(1e-6, sumAlpha))));
            }
            else {
                out[o] = Math.round(r / area);
                out[o + 1] = Math.round(g / area);
                out[o + 2] = Math.round(b / area);
            }
            out[o + 3] = Math.round(aAvg);
        }
    }
    return { width, height, rgba: out };
}
/** 把位图整体放大 scale 倍（最近邻，像素画保持硬边）。 */
export function upscale(src, scale) {
    if (scale <= 1)
        return src;
    const width = src.width * scale;
    const height = src.height * scale;
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = Math.floor(y / scale);
        for (let x = 0; x < width; x++) {
            const sx = Math.floor(x / scale);
            const i = (sy * src.width + sx) * 4;
            const o = (y * width + x) * 4;
            out[o] = src.rgba[i];
            out[o + 1] = src.rgba[i + 1];
            out[o + 2] = src.rgba[i + 2];
            out[o + 3] = src.rgba[i + 3];
        }
    }
    return { width, height, rgba: out };
}
// ── 抠底 / 颜色凝固 ───────────────────────────────────────────────────────
/** 软 alpha 的默认参数（死区 + 满值点）。 */
export const MATTE_LO = 40;
export const MATTE_HI = 190;
/**
 * 把「已抠过底」或「还没抠底」的位图统一成（可信前景色 + 软 alpha）。
 *
 * 返回两个缓冲区：`rgb`（3 通道，已凝固）与 `alpha`（单通道 0~255）。
 * 分开返回是刻意的 —— 下游要**分开缩放**它们，见 `resizeRgbAlpha`。
 */
export function matteForeground(src, options = {}) {
    const lo = options.lo ?? MATTE_LO;
    const hi = options.hi ?? MATTE_HI;
    const trust = options.trust ?? 0.75;
    const rings = options.rings ?? 4;
    const { width, height, rgba } = src;
    const n = width * height;
    const alpha = Buffer.alloc(n);
    const rgb = Buffer.alloc(n * 3);
    // ① 软 alpha：带 alpha 就信它；否则从「离背景色的距离」映射（**必须带死区**）
    let useOwnAlpha = false;
    for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] < 249) {
            useOwnAlpha = true;
            break;
        }
    }
    if (useOwnAlpha) {
        for (let i = 0, p = 3; i < n; i++, p += 4)
            alpha[i] = rgba[p];
    }
    else {
        const bg = borderColor(src);
        const span = Math.max(1e-6, hi - lo);
        for (let i = 0, p = 0; i < n; i++, p += 4) {
            const d = Math.abs(rgba[p] - bg[0]) + Math.abs(rgba[p + 1] - bg[1]) + Math.abs(rgba[p + 2] - bg[2]);
            alpha[i] = Math.round(Math.max(0, Math.min(1, (d - lo) / span)) * 255);
        }
    }
    // ② 可信像素的颜色原样留下，其余位置先占位（下一步填充）
    const isTrust = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        if (alpha[i] / 255 >= trust) {
            isTrust[i] = 1;
            rgb[i * 3] = rgba[p];
            rgb[i * 3 + 1] = rgba[p + 1];
            rgb[i * 3 + 2] = rgba[p + 2];
        }
    }
    // 一个可信像素都没有：说明这张图整幅都在死区里（纯白底 / 只有压缩噪声）。
    // **不在这里抛错** —— 「图里到底有没有主体」是调用方的事，它手里才有业务语义。
    // 这里只保证「alpha 全 0 + 颜色为 0」这种可判定的结果。
    if (maskCount(isTrust) === 0)
        return { rgb, alpha, width, height };
    // ③ 颜色凝固：把可信颜色往外扩 rings 圈（BFS），让后续重采样吃不到背景色
    solidify(rgb, isTrust, width, height, rings);
    return { rgb, alpha, width, height };
}
/**
 * 把 `rgb` 在 `seed` 之外的区域用最近 seed 的颜色填充（8 邻域 BFS，扩 `rings` 圈）。
 */
export function solidify(rgb, seed, width, height, rings) {
    const known = Uint8Array.from(seed);
    let frontier = [];
    for (let i = 0; i < known.length; i++)
        if (known[i] === 1)
            frontier.push(i);
    for (let step = 0; step < rings && frontier.length > 0; step++) {
        const next = [];
        for (const index of frontier) {
            const x = index % width;
            const y = (index - x) / width;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                        continue;
                    const ni = ny * width + nx;
                    if (known[ni] === 1)
                        continue;
                    rgb[ni * 3] = rgb[index * 3];
                    rgb[ni * 3 + 1] = rgb[index * 3 + 1];
                    rgb[ni * 3 + 2] = rgb[index * 3 + 2];
                    known[ni] = 1;
                    next.push(ni);
                }
            }
        }
        frontier = next;
    }
}
/**
 * 颜色与 alpha **分开**缩放。
 *
 * 这是「白边」修复里最容易漏的一步：颜色经过 `solidify` 之后已经与背景无关，
 * 随便怎么重采样都不会吃到白；alpha 单独用高质量滤波才保得住模型的抗锯齿。
 * 把两者混在一起做一次 RGBA 缩放，边缘那些「半透明的浅色」就会被平均成
 * 「不透明的浅色」—— 那就是白描边。
 */
export function resizeRgbAlpha(rgb, alpha, width, height, newWidth, newHeight) {
    const rgbImg = { width, height, rgba: Buffer.alloc(width * height * 4) };
    for (let i = 0; i < width * height; i++) {
        rgbImg.rgba[i * 4] = rgb[i * 3];
        rgbImg.rgba[i * 4 + 1] = rgb[i * 3 + 1];
        rgbImg.rgba[i * 4 + 2] = rgb[i * 3 + 2];
        rgbImg.rgba[i * 4 + 3] = 255;
    }
    const alphaImg = { width, height, rgba: Buffer.alloc(width * height * 4) };
    for (let i = 0; i < width * height; i++) {
        alphaImg.rgba[i * 4] = alpha[i];
        alphaImg.rgba[i * 4 + 1] = alpha[i];
        alphaImg.rgba[i * 4 + 2] = alpha[i];
        alphaImg.rgba[i * 4 + 3] = 255;
    }
    const rgbSmall = bilinearResize(rgbImg, newWidth, newHeight);
    const alphaSmall = bilinearResize(alphaImg, newWidth, newHeight);
    const out = Buffer.alloc(newWidth * newHeight * 4);
    for (let i = 0; i < newWidth * newHeight; i++) {
        out[i * 4] = rgbSmall.rgba[i * 4];
        out[i * 4 + 1] = rgbSmall.rgba[i * 4 + 1];
        out[i * 4 + 2] = rgbSmall.rgba[i * 4 + 2];
        out[i * 4 + 3] = alphaSmall.rgba[i * 4];
    }
    return { width: newWidth, height: newHeight, rgba: out };
}
/**
 * 双线性重采样（RGB 分量按 premultiplied 处理，避免透明像素的颜色渗入）。
 *
 * 不走 ffmpeg：这条路径在测量循环里会被调用很多次，进程开销比算法本身还大。
 */
export function bilinearResize(src, newWidth, newHeight) {
    const out = Buffer.alloc(newWidth * newHeight * 4);
    const sx = src.width / newWidth;
    const sy = src.height / newHeight;
    for (let y = 0; y < newHeight; y++) {
        const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(src.height - 1, y0 + 1);
        const wy = fy - y0;
        for (let x = 0; x < newWidth; x++) {
            const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
            const x0 = Math.floor(fx);
            const x1 = Math.min(src.width - 1, x0 + 1);
            const wx = fx - x0;
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (const [px, py, weight] of [
                [x0, y0, (1 - wx) * (1 - wy)],
                [x1, y0, wx * (1 - wy)],
                [x0, y1, (1 - wx) * wy],
                [x1, y1, wx * wy]
            ]) {
                const i = (py * src.width + px) * 4;
                const av = src.rgba[i + 3] / 255;
                r += src.rgba[i] * av * weight;
                g += src.rgba[i + 1] * av * weight;
                b += src.rgba[i + 2] * av * weight;
                a += av * weight;
            }
            const o = (y * newWidth + x) * 4;
            if (a > 1e-6) {
                out[o] = Math.max(0, Math.min(255, Math.round(r / a)));
                out[o + 1] = Math.max(0, Math.min(255, Math.round(g / a)));
                out[o + 2] = Math.max(0, Math.min(255, Math.round(b / a)));
            }
            out[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
        }
    }
    return { width: newWidth, height: newHeight, rgba: out };
}
/**
 * 把 `src` 仿射映射成一张 `outW×outH` 的图。
 *
 * 参数按「源图里的平行四边形 → 目标图的整个画布」给：
 * `map` 描述目标像素 (X, Y) 对应的源坐标 (x, y)：
 *   x = a·X + b·Y + c
 *   y = d·X + e·Y + f
 */
export function affineTransform(src, outW, outH, map) {
    const out = Buffer.alloc(outW * outH * 4);
    for (let Y = 0; Y < outH; Y++) {
        for (let X = 0; X < outW; X++) {
            const x = map.a * X + map.b * Y + map.c;
            const y = map.d * X + map.e * Y + map.f;
            const o = (Y * outW + X) * 4;
            sampleBilinear(src, x, y, out, o);
        }
    }
    return { width: outW, height: outH, rgba: out };
}
function sampleBilinear(src, x, y, out, o) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const wx = x - x0;
    const wy = y - y0;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (const [px, py, weight] of [
        [x0, y0, (1 - wx) * (1 - wy)],
        [x0 + 1, y0, wx * (1 - wy)],
        [x0, y0 + 1, (1 - wx) * wy],
        [x0 + 1, y0 + 1, wx * wy]
    ]) {
        if (px < 0 || py < 0 || px >= src.width || py >= src.height || weight === 0)
            continue;
        const i = (py * src.width + px) * 4;
        const av = src.rgba[i + 3] / 255;
        r += src.rgba[i] * av * weight;
        g += src.rgba[i + 1] * av * weight;
        b += src.rgba[i + 2] * av * weight;
        a += av * weight;
    }
    if (a > 1e-6) {
        out[o] = Math.max(0, Math.min(255, Math.round(r / a)));
        out[o + 1] = Math.max(0, Math.min(255, Math.round(g / a)));
        out[o + 2] = Math.max(0, Math.min(255, Math.round(b / a)));
    }
    else {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
    }
    out[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
}
/** 最小二乘拟合 y → x，返回 (k, c) 使 x ≈ k·y + c。 */
function fitLine(ys, xs) {
    const n = ys.length;
    let sy = 0;
    let sx = 0;
    let syy = 0;
    let syx = 0;
    for (let i = 0; i < n; i++) {
        sy += ys[i];
        sx += xs[i];
        syy += ys[i] * ys[i];
        syx += ys[i] * xs[i];
    }
    const denom = n * syy - sy * sy;
    if (Math.abs(denom) < 1e-9)
        return { k: 1, c: 0 };
    const k = (n * syx - sy * sx) / denom;
    const c = (sx - k * sy) / n;
    return { k, c };
}
/** 稳健拟合：最小二乘 + 按残差裁剪，迭代 4 次。 */
function robustFit(ys, xs) {
    let keep = xs.map(() => true);
    let k = 0;
    let c = 0;
    for (let iter = 0; iter < 4; iter++) {
        const ky = ys.filter((_, i) => keep[i]);
        const kx = xs.filter((_, i) => keep[i]);
        if (ky.length < 8)
            break;
        const fit = fitLine(ky, kx);
        k = fit.k;
        c = fit.c;
        const residuals = ys.map((y, i) => Math.abs(xs[i] - (k * y + c)));
        const active = residuals.filter((_, i) => keep[i]).sort((a, b) => a - b);
        const p80 = active[Math.min(active.length - 1, Math.floor(active.length * 0.8))];
        const limit = Math.max(2, p80);
        const next = residuals.map((r) => r <= limit);
        if (next.every((v, i) => v === keep[i]))
            break;
        keep = next;
    }
    let residual = 0;
    for (let i = 0; i < ys.length; i++) {
        if (!keep[i])
            continue;
        residual = Math.max(residual, Math.abs(xs[i] - (k * ys[i] + c)));
    }
    return { k, c, residual };
}
/**
 * 量出「地面菱形」的几何。
 *
 * 只量**下半部分**的两条下边：装饰（树、建筑）在菱形上方，会把上半部分的
 * 边界拟合彻底污染。
 *
 * ## 为什么下顶点要「实测」而不是取两条边的交点
 *
 * 直觉做法是拟合左右两条下边、求交点当下顶点。实测**不可靠**：
 * 靠近下顶点的几行只有几个像素宽，斜率在那里最陡，会把拟合线拉偏，
 * 交点落到真正的顶点**下方**。合成图上实测 halfHeight = 121（真值 102），
 * 比例算成 1.678 —— 而图本身是标准的 2:1。
 *
 * 所以：斜率只用来**评估质量**（残差），顶点位置一律从掩码实测。
 */
export function measureGroundDiamond(src) {
    const fg = foregroundMask(src);
    const bounds = maskBounds(fg, src.width, src.height);
    if (bounds === undefined)
        throw new Error("图里找不到地块（前景为空）");
    const height = bounds.bottom - bounds.top + 1;
    // ① 左右边界：只用「有足够宽度」的行去拟合斜率（评估质量用）
    const yStart = bounds.top + Math.floor(height * 0.5);
    const leftY = [];
    const leftX = [];
    const rightY = [];
    const rightX = [];
    for (let y = yStart; y <= bounds.bottom; y++) {
        let min = -1;
        let max = -1;
        const row = y * src.width;
        for (let x = bounds.left; x <= bounds.right; x++) {
            if (fg[row + x] === 0)
                continue;
            if (min < 0)
                min = x;
            max = x;
        }
        if (min < 0 || max - min < 8)
            continue;
        leftY.push(y);
        leftX.push(min);
        rightY.push(y);
        rightX.push(max);
    }
    if (leftX.length < 12)
        throw new Error("下半部分前景太少，量不到地面边");
    const fl = robustFit(leftY, leftX);
    const fr = robustFit(rightY, rightX);
    if (Math.abs(fl.k - fr.k) < 1e-6)
        throw new Error("左右边平行，拟合失败");
    // ② 顶点实测：掩码自身的最下 / 最左 / 最右像素
    let bottomRow = -1;
    for (let y = bounds.bottom; y >= bounds.top; y--) {
        const row = y * src.width;
        for (let x = bounds.left; x <= bounds.right; x++) {
            if (fg[row + x] === 1) {
                bottomRow = y;
                break;
            }
        }
        if (bottomRow >= 0)
            break;
    }
    if (bottomRow < 0)
        throw new Error("量不到菱形下顶点");
    // 下顶点的 y 取「最后一行 + 1」—— 菱形是闭合图形，下顶点落在最后一行的下沿
    const bottomY = bottomRow + 1;
    let bottomMinX = bounds.right;
    let bottomMaxX = bounds.left;
    {
        const row = bottomRow * src.width;
        for (let x = bounds.left; x <= bounds.right; x++) {
            if (fg[row + x] === 0)
                continue;
            if (x < bottomMinX)
                bottomMinX = x;
            if (x > bottomMaxX)
                bottomMaxX = x;
        }
    }
    const bottomX = (bottomMinX + bottomMaxX + 1) / 2;
    // ③ 左右顶点：下半部分 x 的极值
    let leftIndex = 0;
    for (let i = 1; i < leftX.length; i++)
        if (leftX[i] < leftX[leftIndex])
            leftIndex = i;
    let rightIndex = 0;
    for (let i = 1; i < rightX.length; i++)
        if (rightX[i] > rightX[rightIndex])
            rightIndex = i;
    const halfWidth = bottomX - leftX[leftIndex];
    const halfHeight = bottomY - leftY[leftIndex];
    if (!(halfWidth > 0) || !(halfHeight > 0))
        throw new Error("量到的菱形尺寸不合法");
    return {
        halfWidth,
        halfHeight,
        bottomX,
        bottomY,
        leftX: leftX[leftIndex],
        rightX: rightX[rightIndex],
        residual: Math.max(fl.residual, fr.residual),
        ratio: halfWidth / halfHeight
    };
}
/**
 * 规整成标准单元格。
 *
 * 1. 把实测菱形仿射映射到目标菱形（上 (32,32) 右 (64,48) 下 (32,64) 左 (0,48)）；
 * 2. 按**数学菱形**裁 alpha（菱形外一律 0）；
 * 3. 剔洋红残留。
 *
 * ## 为什么要 `overscanRatio`（默认 12%）
 *
 * 源图里菱形的边是**抗锯齿**的，从实心到全透明只有约 3 个源像素。
 * 而源图 2048、单元格只有 64 宽 —— 缩放系数约 0.03，即**每个输出像素平均
 * 30×60 个源像素**。在菱形边界上采样核一半在内一半在外，边界像素的 alpha
 * 只到 ~213，再往外一圈掉到 42。
 *
 * 后果：单元格菱形的**整条边**都是半透明的；相邻两块拼起来两边都半透明，
 * 背景从缝里透出来 —— 地图上出现一圈白线。
 *
 * 修法不是「把半透明变不透明」（那会把锯齿变成硬边、白边又回来了），
 * 而是**往源菱形内侧取一点**：把目标菱形按比例放大 12%，单元格边界对应的
 * 源坐标就落在实心区里，采样核完全在内部，alpha 是 255。
 * 再让遮罩把菱形之外切掉 —— 于是「边界不透明」与「不带出体外像素」同时成立。
 */
export function regularizeToCell(src, settings, measure, mode, fallbackReason, overscanRatio = OVERSCAN_RATIO) {
    assertSettings(settings);
    const target = diamondPoints(settings);
    const targetCx = (target.left[0] + target.right[0]) / 2;
    const targetCy = diamondCenterY(settings);
    const targetHalfW = (target.right[0] - target.left[0]) / 2;
    const targetHalfH = (target.bottom[1] - target.top[1]) / 2;
    let centerX;
    let centerY;
    let halfWidth;
    let halfHeight;
    if (mode === "measured") {
        const m = measure;
        centerX = (m.leftX + m.rightX) / 2;
        centerY = m.bottomY - m.halfHeight;
        halfWidth = m.halfWidth;
        halfHeight = m.halfHeight;
    }
    else {
        const t = measure;
        centerX = t.centerX;
        centerY = t.centerY;
        halfWidth = t.halfWidth;
        halfHeight = t.halfHeight;
    }
    // 目标菱形按**比例**放大，让单元格边界对应的源坐标落在源菱形内侧。
    // 两个方向各自按自己的半宽/半高取同样的比例，所以缩放比永远相等（不变形）。
    const growW = Math.max(0, overscanRatio) * targetHalfW;
    const growH = Math.max(0, overscanRatio) * targetHalfH;
    const sx = (targetHalfW + growW) / halfWidth;
    const sy = (targetHalfH + growH) / halfHeight;
    const bitmap = affineTransform(src, settings.cellWidth, settings.cellHeight, {
        // 以目标菱形中心为基准缩放：srcX = centerX + (x - targetCx) / sx
        a: 1 / sx,
        b: 0,
        c: centerX - targetCx / sx,
        d: 0,
        e: 1 / sy,
        f: centerY - targetCy / sy
    });
    // 按数学菱形裁 alpha + 剔洋红残留。
    //
    // 边界的处理是**正确性**问题，不是美观问题：
    //   2:1 菱形在上下两个尖端处每行只有 0~1 个像素，像素中心几乎不会正好落在
    //   边界线上。用严格的「d <= 1」当遮罩，尖端那几行会被整行切掉 ——
    //   实测 64×96 的菱形少 16~41 个像素，重新测量时比例变成 1.9375（真值 2.0）。
    //
    // 所以判定边界外推 `DIAMOND_MASK_SLACK`：菱形主体 100% 不透明，
    // 再往外 `DIAMOND_MASK_FEATHER` 的距离内线性淡出。掩码比数学菱形略大一点点，
    // 肉眼不可见（不到 1px），但尖端不会再被切掉。
    let purged = 0;
    // 羽化宽度 = 1.5 像素，换算成归一化距离（半高 hh 对应归一化距离 1）
    const feather = 1.5 / (diamondHeight(settings) / 2);
    for (let y = 0; y < settings.cellHeight; y++) {
        for (let x = 0; x < settings.cellWidth; x++) {
            const i = (y * settings.cellWidth + x) * 4;
            const d = diamondDistance(settings, x, y);
            const edge = d <= DIAMOND_MASK_SLACK
                ? 1
                : Math.max(0, 1 - (d - DIAMOND_MASK_SLACK) / feather);
            const magenta = Math.abs(bitmap.rgba[i] - 255) + Math.abs(bitmap.rgba[i + 1]) + Math.abs(bitmap.rgba[i + 2] - 255) < 60;
            if (magenta || edge <= 0) {
                if (magenta && bitmap.rgba[i + 3] > 0)
                    purged++;
                bitmap.rgba[i + 3] = 0;
                continue;
            }
            bitmap.rgba[i + 3] = Math.round(Math.min(bitmap.rgba[i + 3], edge * 255));
        }
    }
    const report = { mode, scale: [Number(sx.toFixed(4)), Number(sy.toFixed(4))], magentaPurged: purged };
    if (mode === "measured") {
        const m = measure;
        report.ratioMeasured = Number(m.ratio.toFixed(4));
        report.edgeResidual = Number(m.residual.toFixed(2));
        report.halfWidth = Number(m.halfWidth.toFixed(1));
        report.halfHeight = Number(m.halfHeight.toFixed(1));
    }
    if (fallbackReason !== undefined)
        report.fallbackReason = fallbackReason;
    return { bitmap, report };
}
/**
 * 判断「测量是否可信」。
 *
 * 两种已知的不可信情形（都实测过）：
 *   · 前景占比 > 0.75 —— 没抠出背景（草地颜色和背景太接近时会这样，拟合出的斜率毫无意义）；
 *   · 半高 > 图高 40% —— 量到了装饰而不是地面。
 */
export function measurementLooksSane(src, measure) {
    const fg = foregroundMask(src);
    const frac = maskCount(fg) / (src.width * src.height);
    if (frac > 0.75)
        return `前景占比 ${frac.toFixed(2)}（没抠出背景）`;
    if (measure.halfHeight > src.height * 0.4)
        return `实测半高 ${measure.halfHeight.toFixed(0)} 超过图高的 40%（量到装饰了）`;
    if (measure.ratio < 1.2 || measure.ratio > 3.5)
        return `实测比例 ${measure.ratio.toFixed(3)} 明显不是 2:1`;
    if (measure.residual > src.width * 0.08)
        return `边缘拟合残差 ${measure.residual.toFixed(0)} 过大`;
    return undefined;
}
/**
 * 把「独立装饰贴图」（一棵树、一块巨石）规整成单元格大小的透明图。
 *
 * 缩放策略：宽度归一化到 `cellWidth × 5/8`，再用「锚点以上的可用空间」压高度。
 * 统一宽度的目的是**统一世界尺度** —— 否则会出现一棵树巨大、一棵很小，
 * 树干粗细也不一致。
 *
 * 摆放：水平居中；底部锚在 `decorAnchorY()`（地面上「站得住」的高度，
 * 不是菱形中心、也不是菱形下顶点 —— 那两个都实测过，前者树浮空、后者树干
 * 插到地块前沿之外）。
 */
/**
 * 建筑模板的**逻辑尺寸**（不含超采样）。
 *
 * `renderBuildingTemplate` 与 `regularizeBuilding` 必须用同一套数 ——
 * 两边各写一份就会错位，而且只表现为「建筑在地图上偏移」，不报错。
 */
export function buildingTemplateLayout(settings, options = {}) {
    const cols = options.cols ?? 2;
    const rows = options.rows ?? 2;
    const heightRatio = options.heightRatio ?? 1.5;
    const pad = options.pad ?? 8;
    // 包围菱形半宽由**形状**决定。
    // ⚠️ 注意这里用的是「x 极差 + 一格」，对**实心矩形**等价于老公式
    // `(cols+rows)/2` —— 所以 2×2 的模板与老版本逐字节一致。
    // 顺带一个反直觉但正确的事实：`3×1` 与 `2×2` 的等距底面**本来就是同一个菱形**
    // （`(3+1)/2 = (2+2)/2`），所以两者的模板应该一样，不用去区分。
    const halfW = options.shape === undefined
        ? (settings.cellWidth / 2) * ((cols + rows) / 2)
        : shapeHalfWidthLocal(options.shape, settings.cellWidth);
    const halfH = halfW / 2;
    const boxH = (settings.cellWidth / 2) * heightRatio;
    return {
        halfW, halfH, boxH, pad,
        width: halfW * 2 + pad * 2,
        height: halfH * 2 + boxH + pad * 2,
        baseCenterY: pad + halfH + boxH
    };
}
/**
 * 形状的包围菱形半宽（与 `tilegen.shapeHalfWidth`、`tilemap.shapeDiamondHalf`
 * **同一条公式**）。
 *
 * ```
 * 半宽 = ((max x − min x)·cellWidth/2 + cellWidth) / 2      // x = c − r
 * ```
 *
 * ⚠️ 这里留一份本地实现是为了**不引入反向依赖**（`tilegen` 已经 import 了
 * `tilegeom`）。三处一致性由 `verify-tile.mjs` 的对照断言钉住。
 *
 * ⚠️ **不能用「列数 + 行数」那一类**（如 `cellWidth·(Δdc + Δdr + 2)/4`）：
 * 它对**实心矩形**恰好等价（矩形里 `x` 的极差正好等于 `Δdc + Δdr`），
 * 但形状一旦**沿对角线走**（L 形、T 形…），`x = c − r` 会把两项**抵消**，
 * 真实极差**小于**行列之和。实测 L 形（2×2 缺一格）：老公式给 64，
 * 真实只要 32 —— 于是蓝色立方体线框比洋红底面宽一倍多
 * （实测底面/线框宽比 **0.373**，矩形是 0.991），模型看到一个过大的空框。
 *
 * ⚠️ 也**不能**按「格心 + 半格」取 `max(|x| + q)`：那会把**垂直方向邻居**
 * 的贡献再算一遍（十字会得到 48，而地图与拼图都按 32 走）——
 * 模板就和实际摆放口径不一致了。
 *
 * 矩形下本式等价于 `(cols+rows)/2`，所以 2×2 模板逐字节不变。
 */
export function shapeHalfWidthLocal(shape, cellWidth) {
    if (shape.length === 0)
        return cellWidth / 2;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const [r, c] of shape) {
        const x = c - r;
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
    }
    return ((maxX - minX) * (cellWidth / 2) + cellWidth) / 2;
}
/** 由「列 × 行」造形状（本地版，避免 tilegeom → tilegen 的反向依赖）。 */
export function rectShapeLocal(cols, rows) {
    const shape = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++)
            shape.push([r, c]);
    }
    return shape;
}
/** 形状是否恰好是**实心矩形**（是的话返回 [列, 行]，否则 undefined）。 */
export function rectOfShapeLocal(shape) {
    if (shape.length === 0)
        return undefined;
    let maxR = 0;
    let maxC = 0;
    for (const [r, c] of shape) {
        if (r > maxR)
            maxR = r;
        if (c > maxC)
            maxC = c;
    }
    const cols = maxC + 1;
    const rows = maxR + 1;
    return shape.length === cols * rows ? [cols, rows] : undefined;
}
/**
 * 量出建筑在原图里的**底面**。
 *
 * 建筑不能像地形那样靠「拟合一个 2:1 菱形」定位 —— 它的轮廓是自由的
 * （有屋顶、有山墙），拟合出来的形状没有意义。这里改用「抠底 + 包围盒」：
 *   · 抠出前景（白底 → 透明）；
 *   · 底面正前方的尖角 = 包围盒下边缘；
 *   · 底面中心 x = 包围盒中心 x。
 *
 * 实测确认：等距建筑从这个视角看，最左/最右点就是底面的左右角，
 * 所以包围盒的宽 ≈ 底面宽度、水平中心 ≈ 底面中心。
 */
export function measureBuilding(src) {
    const fg = foregroundMask(src);
    const bounds = maskBounds(fg, src.width, src.height);
    if (bounds === undefined)
        throw new Error("图里没有找到建筑（整幅都是背景）");
    if (maskCount(fg) < 200)
        throw new Error("建筑前景太少（可能是一张空白图）");
    const halfWidth = (bounds.right - bounds.left + 1) / 2;
    // 底面菱形高 = 宽 / 2（严格 2:1 等距），所以半高 = 半宽 / 2
    const halfHeight = halfWidth / 2;
    return {
        centerX: (bounds.left + bounds.right + 1) / 2,
        // 包围盒下边缘 = 底面前尖角 = 菱形下顶点
        centerY: bounds.bottom + 1 - halfHeight,
        halfWidth,
        halfHeight,
        bounds
    };
}
/**
 * 把生成的建筑放进「2×2 格块」的贴图里。
 *
 * 与地形的 `regularizeToCell` 有本质区别：
 *   · 地形是**一整块地面**，规整到 1 格 64×96 就完了；
 *   · 建筑是**立体的**，砖块只有底面占 2×2 格，墙和屋顶要往上长。
 *     把整张建筑塞进 1 格 64×96（原来的做法）会把它压扁成一张平铺地板
 *     —— 实测「中世纪石屋」就是这么变成菱形石板的。
 *
 * 摆放：抠底 → 量底面 → **等比**缩放让底面宽度等于目标底面宽 → 底面中心对准目标位置。
 * 高度由实际量到的建筑形状决定（不是硬编码 2 格高）。
 */
export function regularizeBuilding(src, settings, options = {}) {
    assertSettings(settings);
    const cols = options.cols ?? 2;
    const rows = options.rows ?? 2;
    const measure = measureBuilding(src);
    const { rgb, alpha } = matteForeground(src);
    // 底面宽度 = 包围菱形宽：矩形是 `cellWidth·(cols+rows)/2`，
    // 通用形状按格子集合算（L 形和同样跨度的矩形不一样宽，别混用）。
    const targetFootW = options.shape === undefined
        ? settings.cellWidth * ((cols + rows) / 2)
        : shapeHalfWidthLocal(options.shape, settings.cellWidth) * 2;
    const k = targetFootW / (measure.halfWidth * 2);
    // 成品宽度 = 底面宽度（量到的包围盒宽就是底面宽）。
    // ⚠️ 不能直接把「整幅缩放后的宽度」当成品宽度再横向居中 —— 那样会把底面推偏，
    // 实测建筑会横着超出格块、压到旁边的格子上。
    const outW = Math.round(targetFootW);
    const outBaseCx = outW / 2;
    const outBaseCy = Math.round(measure.centerY * k);
    const outH = Math.max(outBaseCy + Math.round(measure.halfHeight * k) + 2, Math.round(src.height * k));
    // 用 RGB + alpha 直接做仿射采样：源是「RGB + 独立 alpha」两张平面
    const srcRgba = Buffer.alloc(src.width * src.height * 4);
    for (let i = 0; i < src.width * src.height; i++) {
        srcRgba[i * 4] = rgb[i * 3];
        srcRgba[i * 4 + 1] = rgb[i * 3 + 1];
        srcRgba[i * 4 + 2] = rgb[i * 3 + 2];
        srcRgba[i * 4 + 3] = alpha[i];
    }
    const bitmap = affineTransform({ width: src.width, height: src.height, rgba: srcRgba }, outW, outH, 
    // srcX = measure.centerX + (x − outBaseCx) / k
    { a: 1 / k, b: 0, c: measure.centerX - outBaseCx / k, d: 0, e: 1 / k, f: 0 });
    return {
        // `baseFraction` 让拼图知道底面在贴图里的位置（建筑贴图高度不是固定值，不能猜）
        bitmap: Object.assign(bitmap, { baseFraction: outBaseCy / outH }),
        report: {
            mode: options.mode ?? "measured",
            scale: [Number(k.toFixed(4)), Number(k.toFixed(4))],
            magentaPurged: 0,
            halfWidth: Number(measure.halfWidth.toFixed(1)),
            halfHeight: Number(measure.halfHeight.toFixed(1)),
            srcBounds: [measure.bounds.left, measure.bounds.top, measure.bounds.right, measure.bounds.bottom]
        }
    };
}
export function regularizeDecorSprite(src, settings, options = {}) {
    assertSettings(settings);
    const useMatte = options.matte !== false;
    const fg = foregroundMask(src);
    const bounds = maskBounds(fg, src.width, src.height);
    if (bounds === undefined)
        throw new Error("图里没有找到装饰");
    if (maskCount(fg) < 50)
        throw new Error("装饰前景太少（可能是一张空白图）");
    const cropW = bounds.right - bounds.left + 1;
    const cropH = bounds.bottom - bounds.top + 1;
    const anchorY = decorAnchorY(settings);
    const targetW = settings.cellWidth * (5 / 8);
    const k = Math.min(targetW / cropW, anchorY / cropH);
    const cellW = Math.max(1, Math.round(cropW * k));
    const cellH = Math.max(1, Math.round(cropH * k));
    let crop;
    if (useMatte) {
        const { rgb, alpha } = matteForeground(src);
        const rgbCrop = Buffer.alloc(cropW * cropH * 3);
        const alphaCrop = Buffer.alloc(cropW * cropH);
        for (let y = 0; y < cropH; y++) {
            for (let x = 0; x < cropW; x++) {
                const si = (y + bounds.top) * src.width + (x + bounds.left);
                rgbCrop[(y * cropW + x) * 3] = rgb[si * 3];
                rgbCrop[(y * cropW + x) * 3 + 1] = rgb[si * 3 + 1];
                rgbCrop[(y * cropW + x) * 3 + 2] = rgb[si * 3 + 2];
                alphaCrop[y * cropW + x] = alpha[si];
            }
        }
        crop = resizeRgbAlpha(rgbCrop, alphaCrop, cropW, cropH, cellW, cellH);
    }
    else {
        // 旧路线（只用于对照实验）：硬阈值抠底，RGB 原样留着 —— 会留白边
        const bg = borderColor(src);
        const tmp = Buffer.alloc(cropW * cropH * 4);
        for (let y = 0; y < cropH; y++) {
            for (let x = 0; x < cropW; x++) {
                const si = ((y + bounds.top) * src.width + (x + bounds.left)) * 4;
                const o = (y * cropW + x) * 4;
                tmp[o] = src.rgba[si];
                tmp[o + 1] = src.rgba[si + 1];
                tmp[o + 2] = src.rgba[si + 2];
                const d = Math.abs(src.rgba[si] - bg[0]) + Math.abs(src.rgba[si + 1] - bg[1]) + Math.abs(src.rgba[si + 2] - bg[2]);
                tmp[o + 3] = d <= 66 ? 0 : 255;
            }
        }
        crop = bilinearResize({ width: cropW, height: cropH, rgba: tmp }, cellW, cellH);
    }
    const out = Buffer.alloc(settings.cellWidth * settings.cellHeight * 4);
    const left = Math.round(settings.cellWidth / 2 - cellW / 2);
    const top = anchorY - cellH;
    for (let y = 0; y < cellH; y++) {
        const ty = top + y;
        if (ty < 0 || ty >= settings.cellHeight)
            continue;
        for (let x = 0; x < cellW; x++) {
            const tx = left + x;
            if (tx < 0 || tx >= settings.cellWidth)
                continue;
            const si = (y * cellW + x) * 4;
            const o = (ty * settings.cellWidth + tx) * 4;
            out[o] = crop.rgba[si];
            out[o + 1] = crop.rgba[si + 1];
            out[o + 2] = crop.rgba[si + 2];
            out[o + 3] = crop.rgba[si + 3];
        }
    }
    return {
        bitmap: { width: settings.cellWidth, height: settings.cellHeight, rgba: out },
        report: {
            mode: "sprite",
            srcBounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
            srcSize: [cropW, cropH],
            scale: Number(k.toFixed(4)),
            cellSize: [cellW, cellH],
            placedAt: [left, top],
            anchorY
        }
    };
}
