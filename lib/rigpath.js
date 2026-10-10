/**
 * Path 约束的几何层（M5）。
 *
 * **只做弧长表这一档**，这是方案 §8.2 明确划的范围，也是三条导出路径（Spine /
 * DragonBones / 我们的预览器）都能表达的最小共同集：路径是一串折线点，
 * 骨骼沿弧长均匀（或按固定间距）铺上去，每根骨取所在位置的切线。
 *
 * 编辑数据保留折线；Spine 的 PathAttachment 实际存三次贝塞尔控制点，
 * 导出时把每条直线段编码为两个共线控制点，形状与弧长不变。
 *
 * 坐标系与部件一致：**参考图像素、Y 向下**。转成骨骼世界坐标由调用方负责
 * （`toWorld` 那一步），这里只做纯几何。
 */
/** 至少要两个点才谈得上"路径"。 */
export function normalizePath(raw) {
    if (raw === null || typeof raw !== "object")
        return undefined;
    const value = raw;
    const source = Array.isArray(value.points) ? value.points : [];
    // 扁平数组 `[x0,y0,x1,y1,…]`：**内部表示就是这个形状**（`RigPathEntry.points` 是扁平的），
    // wire 上传过来时也是最省事的一种。另外两种写法是给人手写 JSON 用的。
    if (source.length >= 4 && source.length % 2 === 0 && source.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
        return { points: source.map((n) => Number(n.toFixed(3))), closed: value.closed === true };
    }
    const flat = [];
    for (const entry of source) {
        // 接受 `[x,y]` 与 `{x,y}` 两种写法：前者给人看，后者给 JSON 手改时更清楚。
        if (Array.isArray(entry) && entry.length >= 2 && Number.isFinite(entry[0]) && Number.isFinite(entry[1])) {
            flat.push(Number(entry[0]), Number(entry[1]));
        }
        else if (entry !== null && typeof entry === "object" && Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
            flat.push(Number(entry.x), Number(entry.y));
        }
    }
    if (flat.length < 4)
        return undefined;
    return { points: flat.map((n) => Number(n.toFixed(3))), closed: value.closed === true };
}
/** 折线的段数（闭合时多一段）。 */
export function pathSegmentCount(path) {
    const count = path.points.length / 2;
    return path.closed === true ? count : count - 1;
}
/** 每段的长度；Spine 导出另行编成累计弧长表。 */
export function pathSegmentLengths(path) {
    const count = path.points.length / 2;
    const segments = [];
    const total = pathSegmentCount(path);
    for (let i = 0; i < total; i++) {
        const j = (i + 1) % count;
        const dx = path.points[j * 2] - path.points[i * 2];
        const dy = path.points[j * 2 + 1] - path.points[i * 2 + 1];
        segments.push(Number(Math.hypot(dx, dy).toFixed(4)));
    }
    return segments;
}
export function pathTotalLength(path, lengths) {
    const segments = lengths ?? pathSegmentLengths(path);
    return Number(segments.reduce((sum, value) => sum + value, 0).toFixed(4));
}
/** 折线 → Spine 三次曲线顶点。输入已是槽位局部坐标（Y 向上）。 */
export function spinePathGeometry(path) {
    const points = [];
    for (let i = 0; i + 1 < path.points.length; i += 2) {
        if (points.length > 0 && Math.hypot(path.points[i] - points[points.length - 2], path.points[i + 1] - points[points.length - 1]) <= 1e-6)
            continue;
        points.push(path.points[i], path.points[i + 1]);
    }
    if (path.closed && points.length > 4 && Math.hypot(points[0] - points[points.length - 2], points[1] - points[points.length - 1]) <= 1e-6)
        points.splice(-2);
    const count = points.length / 2;
    const segments = path.closed ? count : count - 1;
    // 每段 [起点, 1/3 控制点, 2/3 控制点, 终点]，相邻段共用端点。
    const curve = [points[0], points[1]];
    const lengths = [];
    let total = 0;
    for (let i = 0; i < segments; i++) {
        const j = (i + 1) % count;
        const x = points[i * 2], y = points[i * 2 + 1];
        const dx = points[j * 2] - x, dy = points[j * 2 + 1] - y;
        curve.push(x + dx / 3, y + dy / 3, x + dx * 2 / 3, y + dy * 2 / 3, points[j * 2], points[j * 2 + 1]);
        total += Math.hypot(dx, dy);
        lengths.push(Number(total.toFixed(4)));
    }
    // 开放路径的首尾额外控制点不参与曲线；闭合路径把末段第二控制点放在首位。
    const vertices = path.closed
        ? [...curve.slice(-4, -2), ...curve.slice(0, -4)]
        : [points[0], points[1], ...curve, points[points.length - 2], points[points.length - 1]];
    if (!path.closed)
        lengths.push(Number(total.toFixed(4)));
    return { vertices: vertices.map((n) => Number(n.toFixed(6))), vertexCount: vertices.length / 2, lengths };
}
/**
 * 按**弧长**采样：给出沿路径走 `distance` 之后的位置与切线角（弧度）。
 *
 * 用弧长而不是"按段索引"让骨骼等距。与 Spine 一致：闭合路径按总长循环，
 * 开放路径越界时沿首/末段切线外推，固定间距不会在端点挤成一团。
 */
export function samplePath(path, distance, lengths, total) {
    const segments = lengths ?? pathSegmentLengths(path);
    const sum = total ?? segments.reduce((acc, value) => acc + value, 0);
    const count = path.points.length / 2;
    if (sum <= 1e-6)
        return { x: path.points[0], y: path.points[1], angle: 0 };
    let remaining = path.closed ? ((distance % sum) + sum) % sum : distance;
    let lastSegment = segments.length - 1;
    while (lastSegment >= 0 && segments[lastSegment] <= 1e-6)
        lastSegment--;
    for (let i = 0; i < segments.length; i++) {
        const length = segments[i];
        if (length <= 1e-6)
            continue;
        if (remaining <= length || i === lastSegment) {
            const t = length > 1e-9 ? remaining / length : 0;
            const j = (i + 1) % count;
            const x0 = path.points[i * 2];
            const y0 = path.points[i * 2 + 1];
            const x1 = path.points[j * 2];
            const y1 = path.points[j * 2 + 1];
            return {
                x: Number((x0 + (x1 - x0) * t).toFixed(4)),
                y: Number((y0 + (y1 - y0) * t).toFixed(4)),
                angle: Math.atan2(y1 - y0, x1 - x0)
            };
        }
        remaining -= length;
    }
    const last = path.points.length - 2;
    return { x: path.points[last], y: path.points[last + 1], angle: 0 };
}
/**
 * 把 `count` 根骨沿路径铺开，返回每根的弧长位置。
 *
 * `spacing` 是**相邻两根骨之间的距离**（参考图像素）。传 0 或负数表示"均匀铺满整条
 * 路径"——那是 `positionMode: percent` 的语义；给了正值就是固定间距，骨骼可能只覆盖
 * 路径的一段，剩下的空着。
 */
export function pathPlacements(path, count, spacing) {
    if (count <= 0)
        return [];
    const lengths = pathSegmentLengths(path);
    const total = lengths.reduce((sum, value) => sum + value, 0);
    if (count === 1)
        return [0];
    if (spacing > 0) {
        return Array.from({ length: count }, (_, index) => Number((index * spacing).toFixed(4)));
    }
    // 均匀铺满：从起点到终点分成 count−1 段，这样最后一根正好落在路径末端。
    const step = total / (count - 1);
    return Array.from({ length: count }, (_, index) => Number((index * step).toFixed(4)));
}
/** 路径的包围盒（给宿主渲染验收图用）。 */
export function pathBounds(path) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < path.points.length; i += 2) {
        minX = Math.min(minX, path.points[i]);
        maxX = Math.max(maxX, path.points[i]);
        minY = Math.min(minY, path.points[i + 1]);
        maxY = Math.max(maxY, path.points[i + 1]);
    }
    return { minX, minY, maxX, maxY };
}
