/**
 * Path 约束的几何层（M5）。
 *
 * **只做弧长表这一档**，这是方案 §8.2 明确划的范围，也是三条导出路径（Spine /
 * DragonBones / 我们的预览器）都能表达的最小共同集：路径是一串折线点，
 * 骨骼沿弧长均匀（或按固定间距）铺上去，每根骨取所在位置的切线。
 *
 * 不做贝塞尔路径：Spine 的 PathAttachment 存的本来就是**采样后的折线**
 * （`vertices` + `lengths`），编辑器里的曲线在导出前也会被压平。我们直接收折线，
 * 少一层「曲线 → 折线」的采样，也就少一个「预览和导出不一样」的可能。
 *
 * 坐标系与部件一致：**参考图像素、Y 向下**。转成骨骼世界坐标由调用方负责
 * （`toWorld` 那一步），这里只做纯几何。
 */

export interface RigPath {
  /** 折线点：`[x0,y0, x1,y1, …]`。 */
  points: number[];
  /** 闭合路径会补上「最后一点 → 第一点」那一段。 */
  closed?: boolean;
}

export interface RigPathSpec {
  points: number[];
  closed: boolean;
}

/** 至少要两个点才谈得上"路径"。 */
export function normalizePath(raw: unknown): RigPathSpec | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = raw as any;
  const source = Array.isArray(value.points) ? value.points : [];
  // 扁平数组 `[x0,y0,x1,y1,…]`：**内部表示就是这个形状**（`RigPathEntry.points` 是扁平的），
  // wire 上传过来时也是最省事的一种。另外两种写法是给人手写 JSON 用的。
  if (source.length >= 4 && source.every((entry: unknown) => typeof entry === "number" && Number.isFinite(entry))) {
    return { points: source.map((n: number) => Number(n.toFixed(3))), closed: value.closed === true };
  }
  const flat: number[] = [];
  for (const entry of source) {
    // 接受 `[x,y]` 与 `{x,y}` 两种写法：前者给人看，后者给 JSON 手改时更清楚。
    if (Array.isArray(entry) && entry.length >= 2 && Number.isFinite(entry[0]) && Number.isFinite(entry[1])) {
      flat.push(Number(entry[0]), Number(entry[1]));
    } else if (entry !== null && typeof entry === "object" && Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
      flat.push(Number(entry.x), Number(entry.y));
    }
  }
  if (flat.length < 4) return undefined;
  return { points: flat.map((n) => Number(n.toFixed(3))), closed: value.closed === true };
}

/** 折线的段数（闭合时多一段）。 */
export function pathSegmentCount(path: RigPathSpec): number {
  const count = path.points.length / 2;
  return path.closed === true ? count : count - 1;
}

/** 每段的长度——**这就是 Spine 的 `PathAttachment.lengths`**。 */
export function pathSegmentLengths(path: RigPathSpec): number[] {
  const count = path.points.length / 2;
  const segments: number[] = [];
  const total = pathSegmentCount(path);
  for (let i = 0; i < total; i++) {
    const j = (i + 1) % count;
    const dx = path.points[j * 2] - path.points[i * 2];
    const dy = path.points[j * 2 + 1] - path.points[i * 2 + 1];
    segments.push(Number(Math.hypot(dx, dy).toFixed(4)));
  }
  return segments;
}

export function pathTotalLength(path: RigPathSpec, lengths?: number[]): number {
  const segments = lengths ?? pathSegmentLengths(path);
  return Number(segments.reduce((sum, value) => sum + value, 0).toFixed(4));
}

/**
 * 按**弧长**采样：给出沿路径走 `distance` 之后的位置与切线角（弧度）。
 *
 * 用弧长而不是"按段索引"是因为骨骼要**等距**铺开：段长不等时按索引分会让骨骼在
 * 长段上稀疏、短段上挤成一团。`distance` 会被夹进 `[0, 总长]`，越界不报错——
 * 调用方（排列骨链）本来就会算出越界值，那时"停在端点"才是想要的行为。
 */
export function samplePath(
  path: RigPathSpec,
  distance: number,
  lengths?: number[],
  total?: number
): { x: number; y: number; angle: number } {
  const segments = lengths ?? pathSegmentLengths(path);
  const sum = total ?? segments.reduce((acc, value) => acc + value, 0);
  const count = path.points.length / 2;
  let remaining = Math.max(0, Math.min(sum, distance));
  for (let i = 0; i < segments.length; i++) {
    const length = segments[i];
    if (remaining <= length || i === segments.length - 1) {
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
export function pathPlacements(path: RigPathSpec, count: number, spacing: number): number[] {
  if (count <= 0) return [];
  const lengths = pathSegmentLengths(path);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (count === 1) return [0];
  if (spacing > 0) {
    return Array.from({ length: count }, (_, index) => Number((index * spacing).toFixed(4)));
  }
  // 均匀铺满：从起点到终点分成 count−1 段，这样最后一根正好落在路径末端。
  const step = total / (count - 1);
  return Array.from({ length: count }, (_, index) => Number((index * step).toFixed(4)));
}

/** 路径的包围盒（给宿主渲染验收图用）。 */
export function pathBounds(path: RigPathSpec): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < path.points.length; i += 2) {
    minX = Math.min(minX, path.points[i]);
    maxX = Math.max(maxX, path.points[i]);
    minY = Math.min(minY, path.points[i + 1]);
    maxY = Math.max(maxY, path.points[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}
