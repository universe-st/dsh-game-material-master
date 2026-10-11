/**
 * 地图编辑器（模块六）的**网格内核**：纯函数、不碰磁盘、不碰网络。
 *
 * 支持两种视角：
 *   · `square`    正方形俯视（主流 16×16 / 32×32 tileset）
 *   · `iso2to1`   2:1 正交等距（菱形宽 = 2 × 菱形高）
 *
 * ## 为什么把它单独抽一层
 *
 * 旧模块（`tilegeom.ts` / `tilemap.ts`）的坐标口径散在三处，界面还要复刻一份，
 * 于是「保存后整体抬高」「点到的格子不是涂到的格子」反复出现。这个模块是
 * 新模块**唯一的坐标真源**：宿主渲染、导出、chunk 划分、命中测试全走这里；
 * 浏览器半区**只被允许**复刻 `pointToCell` / `cellAnchor` 两个函数
 * （`verify-map-client.mjs` 拿本文件的真实现做黄金对照钉住）。
 *
 * ## 坐标约定（关键，写错了只会静默错位）
 *
 * 等距（Tiled 同款）：
 *   菱形中心的像素坐标
 *     x = (c − r) · tileWidth/2
 *     y = (c + r) · tileHeight/2
 *   即 **r 向左下、c 向右下**各走半格。
 *
 * 格子「锚点」= 贴图锚点落地的那个像素点：
 *   · `square`   单元格底边中点
 *   · `iso2to1`  菱形**下顶点**
 * 贴图默认按「底边中点对齐锚点」摆放（`anchorX = 0.5, anchorY = 1`），
 * 与 Tiled 的等距贴图对齐方式一致；需要时可按贴图覆盖。
 *
 * ⚠️ **不要把锚点当成格子中心。** 跨格建筑曾经因为把「锚点格中心」当
 * 「占格菱形中心」，垫底整个偏半格，真机表现是「房子浮在半空」。
 * 需要中心时一律调 `cellCenter()`。
 */

export type MapGridKind = "square" | "iso2to1";

export const MAP_GRID_KINDS: readonly MapGridKind[] = ["square", "iso2to1"];

export interface MapGrid {
  kind: MapGridKind;
  /** 单元格（菱形/正方形）宽，像素。 */
  tileWidth: number;
  /** 单元格高；`iso2to1` 下必须等于 `tileWidth / 2`。 */
  tileHeight: number;
  /** 图层高度偏移 1 格等于多少像素（默认 `tileHeight / 2`）。 */
  heightStep: number;
}

export const DEFAULT_GRID: MapGrid = { kind: "square", tileWidth: 32, tileHeight: 32, heightStep: 16 };

/** 单边最大格数。超过就明确拒绝，而不是把进程 OOM 掉。 */
export const MAX_MAP_DIM = 512;
/** 单张地图最大格数（与逐边上限一致）。 */
export const MAX_MAP_CELLS = MAX_MAP_DIM * MAX_MAP_DIM;
/** 渲染计划的 chunk 边长（格）。一次笔刷最多弄脏 4 个 chunk。 */
export const MAP_CHUNK_SIZE = 32;

export function isMapGridKind(value: unknown): value is MapGridKind {
  return typeof value === "string" && (MAP_GRID_KINDS as readonly string[]).includes(value);
}

/**
 * 把任意输入收敛成一份合法网格。缺项回落默认值；**形状不合法不修**，
 * 交给 `assertGrid` 抛出可执行的原因（静默改成别的比例更难排查）。
 */
export function normalizeGrid(input: unknown): MapGrid {
  const raw = (input ?? {}) as Record<string, unknown>;
  const kind = isMapGridKind(raw.kind) ? raw.kind : DEFAULT_GRID.kind;
  const int = (value: unknown, fallback: number): number => {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };
  const tileWidth = int(raw.tileWidth, DEFAULT_GRID.tileWidth);
  const tileHeight = int(raw.tileHeight, kind === "iso2to1" ? tileWidth / 2 : DEFAULT_GRID.tileHeight);
  return {
    kind,
    tileWidth,
    tileHeight,
    heightStep: int(raw.heightStep, Math.max(1, Math.round(tileHeight / 2)))
  };
}

/** 网格是否合法；不合法抛 `Error`（文案要能直接告诉用户改成什么）。 */
export function assertGrid(grid: MapGrid): void {
  if (!isMapGridKind(grid.kind)) throw new Error(`未知网格类型：${String(grid.kind)}（可用：${MAP_GRID_KINDS.join(" / ")}）`);
  for (const [label, value] of [["瓦片宽", grid.tileWidth], ["瓦片高", grid.tileHeight]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 2048) {
      throw new Error(`${label}必须是 1~2048 的整数，收到 ${String(value)}`);
    }
  }
  if (grid.kind === "iso2to1" && grid.tileHeight * 2 !== grid.tileWidth) {
    throw new Error(
      `2:1 等距要求 瓦片宽 = 2 × 瓦片高（例如 64×32、32×16）；收到 ${grid.tileWidth}×${grid.tileHeight}。` +
        `常规等距贴图也可以改用「正方形俯视」网格。`
    );
  }
  if (!Number.isFinite(grid.heightStep)) throw new Error(`层高步长必须是数字，收到 ${String(grid.heightStep)}`);
}

export function assertMapSize(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error(`地图尺寸必须是正整数，收到 ${cols}×${rows}`);
  }
  if (cols > MAX_MAP_DIM || rows > MAX_MAP_DIM) {
    throw new Error(`地图单边最多 ${MAX_MAP_DIM} 格，收到 ${cols}×${rows}。请拆成多张地图。`);
  }
  void MAX_MAP_CELLS;
}

/** 一份地图布局：把网格与尺寸解成可用的像素常量。 */
export interface MapLayout {
  grid: MapGrid;
  cols: number;
  rows: number;
  /** 相邻格在 x / y 上的步长。 */
  stepX: number;
  stepY: number;
  /** 网格脚印（所有格子的并集）的像素尺寸。 */
  width: number;
  height: number;
  /** 格 (0,0) 的菱形/格子中心（等距用得到）。 */
  centerX: number;
  centerY: number;
}

/**
 * 解算布局。
 *
 * 脚印尺寸（`width` / `height`）是**按格子算的包围盒**，与贴图实际大小无关：
 * 贴图可能比一格高（树、建筑），真正的裁剪包围盒要由渲染计划算
 * （`maprender.planBounds`），否则高贴图会被裁掉一截。
 */
export function layoutOf(grid: MapGrid, cols: number, rows: number): MapLayout {
  assertGrid(grid);
  assertMapSize(cols, rows);
  if (grid.kind === "square") {
    return {
      grid,
      cols,
      rows,
      stepX: grid.tileWidth,
      stepY: grid.tileHeight,
      width: cols * grid.tileWidth,
      height: rows * grid.tileHeight,
      centerX: grid.tileWidth / 2,
      centerY: grid.tileHeight / 2
    };
  }
  const stepX = grid.tileWidth / 2;
  const stepY = grid.tileHeight / 2;
  return {
    grid,
    cols,
    rows,
    stepX,
    stepY,
    width: (cols + rows - 2) * stepX + grid.tileWidth,
    height: (cols + rows - 2) * stepY + grid.tileHeight,
    // 让包围盒左上角正好落在 (0,0)：格 (0,0) 的菱形中心。
    centerX: (rows - 1) * stepX + grid.tileWidth / 2,
    centerY: grid.tileHeight / 2
  };
}

/** 格子中心（等距 = 菱形中心；正方形 = 方格中心）。 */
export function cellCenter(layout: MapLayout, r: number, c: number): { x: number; y: number } {
  if (layout.grid.kind === "square") {
    return { x: c * layout.grid.tileWidth + layout.grid.tileWidth / 2, y: r * layout.grid.tileHeight + layout.grid.tileHeight / 2 };
  }
  return { x: layout.centerX + (c - r) * layout.stepX, y: layout.centerY + (c + r) * layout.stepY };
}

/** 格子锚点（贴图锚点落地的点）。 */
export function cellAnchor(layout: MapLayout, r: number, c: number): { x: number; y: number } {
  const center = cellCenter(layout, r, c);
  if (layout.grid.kind === "square") {
    return { x: center.x, y: (r + 1) * layout.grid.tileHeight };
  }
  return { x: center.x, y: center.y + layout.grid.tileHeight / 2 };
}

/**
 * 一张贴图贴在某个格子上时，它的左上角在哪。
 *
 * `anchorX` / `anchorY` 是贴图内部的归一化锚点（默认底边中点）。
 * 贴图比一格大时（树、房子），只改 width/height 即可，锚点自动跟着走。
 */
export function cellTopLeft(
  layout: MapLayout,
  r: number,
  c: number,
  width: number,
  height: number,
  anchorX = 0.5,
  anchorY = 1
): { x: number; y: number } {
  const anchor = cellAnchor(layout, r, c);
  return { x: anchor.x - width * anchorX, y: anchor.y - height * anchorY };
}

export interface CellHit {
  r: number;
  c: number;
  /**
   * 是否落在地图范围内。
   *
   * 等距下这就是「是否落在菱形脚印内部」：菱形的 (u,v) 平面是**密铺**的
   * （每格覆盖 `max(|p−c|, |q−r|) ≤ 0.5`，无空隙），所以不在脚印里时一定
   * 反解到范围外的格子。**不要**再引入「在菱形内部」这种标志位 ——
   * 它对密铺网格恒为真，加了只会误导调用方。
   */
  inMap: boolean;
}

/**
 * 像素 → 格子（命中测试）。
 *
 * 等距的反解是**先换到菱形坐标再各自四舍五入**：
 *   u = (x − centerX) / stepX = c − r
 *   v = (y − centerY) / stepY = c + r
 *   c = round((v + u) / 2)，r = round((v − u) / 2)
 * 正负 0.5 的顶点处会有 2~4 个格子并列 —— 取哪个都合法（Tiled 同样）。
 *
 * ⚠️ 别把 `u`、`v` 直接当成格子下标（漏掉那个 /2）：在格中心处恰好看不出来，
 * 一偏离就整体错位。自检里有一条反向验证专门盯这个写法。
 */
export function pointToCell(layout: MapLayout, x: number, y: number): CellHit {
  if (layout.grid.kind === "square") {
    const c = Math.floor(x / layout.grid.tileWidth);
    const r = Math.floor(y / layout.grid.tileHeight);
    const inMap = r >= 0 && c >= 0 && r < layout.rows && c < layout.cols;
    return { r, c, inMap };
  }
  const u = (x - layout.centerX) / layout.stepX;
  const v = (y - layout.centerY) / layout.stepY;
  const c = Math.round((v + u) / 2);
  const r = Math.round((v - u) / 2);
  const inMap = r >= 0 && c >= 0 && r < layout.rows && c < layout.cols;
  return { r, c, inMap };
}

/** 逐格遍历顺序 = 绘制顺序（行优先，等价于 Tiled 的 `renderorder: right-down`）。 */
export function drawOrderRows(cols: number, rows: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([r, c]);
  return out;
}

// ── chunk（渲染计划的分块单位）────────────────────────────────────────────

export interface ChunkIndex {
  cx: number;
  cy: number;
}

export function chunkOf(r: number, c: number): ChunkIndex {
  return { cx: Math.floor(c / MAP_CHUNK_SIZE), cy: Math.floor(r / MAP_CHUNK_SIZE) };
}

export function chunkKey(chunk: ChunkIndex): string {
  return `${chunk.cx},${chunk.cy}`;
}

export function parseChunkKey(key: string): ChunkIndex | undefined {
  const [cx, cy] = key.split(",").map((piece) => Number.parseInt(piece, 10));
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return undefined;
  return { cx, cy };
}

/** chunk 覆盖的格子范围（右下开区间，且已按地图尺寸裁掉越界部分）。 */
export function chunkCellRange(chunk: ChunkIndex, cols: number, rows: number):
  { r0: number; c0: number; r1: number; c1: number } | undefined {
  const r0 = Math.max(0, chunk.cy * MAP_CHUNK_SIZE);
  const c0 = Math.max(0, chunk.cx * MAP_CHUNK_SIZE);
  const r1 = Math.min(rows, r0 + MAP_CHUNK_SIZE);
  const c1 = Math.min(cols, c0 + MAP_CHUNK_SIZE);
  if (r1 <= r0 || c1 <= c0) return undefined;
  return { r0, c0, r1, c1 };
}

export function allChunks(cols: number, rows: number): ChunkIndex[] {
  const out: ChunkIndex[] = [];
  const nx = Math.ceil(cols / MAP_CHUNK_SIZE);
  const ny = Math.ceil(rows / MAP_CHUNK_SIZE);
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) out.push({ cx, cy });
  return out;
}

/**
 * 一批格子会弄脏哪些 chunk。
 *
 * 一个格子最多让它所在 chunk 加上相邻（含对角）chunk 变脏 —— 自动过渡会改
 * 邻居的外观，而邻居可能在隔壁 chunk。上限是 4 个（32 的倍数边界上才会 4 个），
 * 这正是自检里那条「一次笔刷最多弄脏 4 个 chunk」的由来。
 */
export function dirtyChunksFor(cells: Iterable<{ r: number; c: number }>, cols: number, rows: number): string[] {
  const keys = new Set<string>();
  const push = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    keys.add(chunkKey(chunkOf(r, c)));
  };
  for (const cell of cells) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) push(cell.r + dr, cell.c + dc);
  }
  return [...keys].sort();
}

/** 视口矩形覆盖到的 chunk（外加一圈，避免拖动画布时边缘缺块）。 */
export function chunksCovering(
  layout: MapLayout,
  viewport: { x: number; y: number; width: number; height: number },
  padding = 1
): ChunkIndex[] {
  const corners = [
    { x: viewport.x, y: viewport.y },
    { x: viewport.x + viewport.width, y: viewport.y },
    { x: viewport.x, y: viewport.y + viewport.height },
    { x: viewport.x + viewport.width, y: viewport.y + viewport.height }
  ].map((point) => pointToCell(layout, point.x, point.y));
  const rs = corners.map((hit) => hit.r);
  const cs = corners.map((hit) => hit.c);
  const rMin = Math.max(0, Math.min(...rs) - padding);
  const rMax = Math.min(layout.rows - 1, Math.max(...rs) + padding);
  const cMin = Math.max(0, Math.min(...cs) - padding);
  const cMax = Math.min(layout.cols - 1, Math.max(...cs) + padding);
  if (rMax < rMin || cMax < cMin) return [];
  const out: ChunkIndex[] = [];
  for (let cy = Math.floor(rMin / MAP_CHUNK_SIZE); cy <= Math.floor(rMax / MAP_CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(cMin / MAP_CHUNK_SIZE); cx <= Math.floor(cMax / MAP_CHUNK_SIZE); cx++) {
      out.push({ cx, cy });
    }
  }
  return out;
}

/** 图层高度偏移（格）换算成像素位移（向上为正 → 屏幕 y 减少）。 */
export function heightOffsetPixels(grid: MapGrid, heightOffset: number): number {
  return -heightOffset * grid.heightStep;
}
