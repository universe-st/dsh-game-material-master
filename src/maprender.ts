/**
 * 地图编辑器（模块六）的**渲染计划**：宿主是唯一渲染器。
 *
 * ## 为什么要有「计划」这一层
 *
 * 旧模块（已删除的 `tilemap.ts` + 界面里的复刻）把「变体怎么挑、装饰怎么居中、裁剪偏移
 * 多少、建筑锚点在哪」写了两遍 —— 两边只要有一处口径不同，就表现为
 * 「保存后整体抬高 / 树木悬空 / 点到的格子和涂到的不是同一格」，而且**不报错**。
 *
 * 现在只有一条路：宿主算出**绘制计划**（每一项 = 用哪块图、画在哪个像素），
 * 客户端拿 `<canvas>` 原样执行，导出 PNG 也执行同一份计划。于是
 * 「预览 = 导出」是构造出来的，不是靠自检碰运气对出来的。
 *
 * ## 计划里有什么
 *
 * 有：`{l, r, c, t, x, y, a}` —— 层号、**规范**格坐标（wrap 后）、第 0 帧的全局图块
 * 序号、目标左上角**绝对像素**（可越界）、不透明度（恒 1，字段保留）。多帧地块额外带
 * 一条 `cycle`（该格按帧序排列的图块序号），`fps` / `frameCount` / `cycles` 描述动画。
 * 没有：源矩形（在 `legend` 里按序号查一次）、任何需要二次判断的东西。
 *
 * ## 三件容易静默坏掉的事
 *
 * 1. **环绕**：`range` 可以越界（负 / 超过 cols / rows），同一格会在多个像素位置出现。
 *    读格一律走 `wrapCell`，像素位置用**未 wrap** 的坐标 —— 把两者搞反就是「接缝处
 *    画的是地图另一头的格子」，画面看着正常、内容全错。
 * 2. **A2 拼块**：一格发 **4 条 op**（TL/TR/BL/BR），每条指向素材里的一个**小格**。
 *    索引公式见 `a2SmallIndex` 的注释（对着 `maptiles.buildTiles` 的切分写的）。
 * 3. **动画**：A2 的「帧」就是变体；四个象限必须用**同一个全局帧号**，所以 4 条 op
 *    各带一条长度相同的 `cycle`。`t` 必须等于 `cycle[0]`，否则第 0 帧和其余帧错位。
 */

import { encodePng } from "./png.js";
import { type Bitmap } from "./bitmap.js";
import { cellIndex, type MapDoc, type MapStamp } from "./mapdoc.js";
import {
  cellCenter,
  cellTopLeft,
  chunkKey,
  chunkOf,
  layoutOf,
  parseChunkKey,
  wrapCell,
  type CellRange,
  type MapGrid,
  type MapLayout
} from "./mapgeom.js";
import { a2QuadrantShapes, corner16Mask, nearestMask, type NeighborAt } from "./mapauto.js";
import { checkerBackground, drawDigits, drawLine, fillCircle, fillRect, strokeCircle, strokeRect } from "./imagedraw.js";
import { applyLoop, flatTiles, stampSpan, type FlatTile, type MapRect, type MapTileset } from "./maptiles.js";

/** 单张导出图的最大像素数（超过就明确拒绝，而不是把进程 OOM 掉）。 */
export const MAX_RENDER_PIXELS = 64_000_000;

/** 动画帧率：AsLib 的 60 帧 ≈ 1 秒切一次。 */
const DEFAULT_FPS = 1;

export interface RenderContext {
  grid: MapGrid;
  layout: MapLayout;
  tilesets: readonly MapTileset[];
  /** 1-based 全局图块序号 → 展平后的图块（`maptiles.flatIndexByValue`）。 */
  lookup: Map<number, FlatTile>;
}

export interface PlanOp {
  /** 图层序号（绘制顺序即数组顺序）。 */
  l: number;
  /** **规范**格坐标（wrap 后，`0..cols-1` / `0..rows-1`）。 */
  r: number;
  c: number;
  /** 第 0 帧的 1-based 全局图块序号；多帧时等于 `cycle[0]`。 */
  t: number;
  /** 目标左上角绝对像素（可越界：环绕时同一格会出现在多个像素位置）。 */
  x: number;
  y: number;
  /** 不透明度（恒 1，字段保留以便以后做淡入）。 */
  a: number;
  /** 该格的循环帧（长度 > 1 时才出现）。 */
  cycle?: number[];
  /**
   * 该 op 用 `RenderPlan.cycles` 里的哪一条。
   *
   * 当前**总是内联** `cycle` 而不填这个字段：传输层（`mapgen.mapPlan` 的
   * `PlanQueryResult`）不带 `cycles` 数组，客户端只能从 op 自己身上读帧序。
   */
  cyc?: number;
  /**
   * 这一格的**播放速度**（帧/秒，来自素材自己的 `fps`）。省略 = 跟 `RenderPlan.fps`。
   *
   * 客户端照它算这一格的帧号（`floor(经过秒数 * fps) % cycle.length`）—— 一片水与一排
   * 霓虹灯因此可以各走各的速度。客户端要按 `fpsMax` 推时钟，否则慢速时钟会拖住快速素材。
   */
  fps?: number;
}

export interface PlanChunk {
  key: string;
  ops: PlanOp[];
}

export interface PlanLegendEntry {
  index: number;
  tilesetId: string;
  rect: MapRect;
}

/**
 * 计划里的一条标记（图层卡里的「标记层」）。
 *
 * **圆圈里的数字、圆心、半径、字号全部由宿主算好**：客户端只 `arc` + `fillText`，
 * 一个数都不许自己推（这套口径与图块 op 完全一致 —— 两边各算一遍就是「预览好看、
 * 导出不一致」的老路）。
 *
 * 名字也在里面：界面悬停时要显示它，但**不铺在画布上**（几十个名字会糊成一片）。
 */
export interface PlanMarker {
  /** 稳定 id（界面靠它认「点到了哪一个」）。 */
  id: string;
  /** 圆圈里的数字（= 文档标记数组下标 + 1，删掉一个后面自动往前顶）。 */
  n: number;
  name: string;
  /** **规范**格坐标（wrap 后）。 */
  r: number;
  c: number;
  /** 圆心**绝对像素**（环绕时同一标记会出现多份，每个像素位置一条）。 */
  x: number;
  y: number;
  radius: number;
  font: number;
}

/** 计划的像素包围盒（origin 恒为 0：只按整格算，贴图不跨格）。 */
export interface PlanBounds {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface RenderPlan {
  chunks: PlanChunk[];
  bounds: PlanBounds;
  /** 用到的图块序号 → 图集与源矩形。客户端画一次就够（`mapPlan` 全量给）。 */
  legend: PlanLegendEntry[];
  fps: number;
  /**
   * 计划里**最快**的那条播放速度（= `max(fps, 各 op 自己的 fps)`）。
   *
   * 客户端用它推动画时钟：只按全局 `fps` 推的话，一个 8 帧/秒的素材会被 1 帧/秒的时钟
   * 拖住（画面每秒才重画一次），表现为「设了速度却还是慢」。
   */
  fpsMax: number;
  /** 所有 `cycle` 长度的最大值（没有多帧地块时 = 1）。 */
  frameCount: number;
  /** 计划里出现的循环（按内容去重，顺序 = 首次出现顺序）。 */
  cycles: number[][];
  /** 落在 `range` 里的标记（**不进 chunk 缓存**，每次查询整份重发）。 */
  markers: PlanMarker[];
  warnings: string[];
}

/**
 * 计划的包围盒。
 *
 * 只按**整格**算：A2 是半格拼块、普通块恰好一格，所以包围盒 = 网格脚印，
 * 且同一份输入永远得到同一个矩形。旧实现按「最大贴图溢出 + 层高偏移」外扩，
 * 那两个来源（跨格大贴图、层高）已经随旧模型一起删掉了。
 */
export function planBounds(context: RenderContext, doc: MapDoc): PlanBounds {
  const layout = layoutOf(context.grid, doc.cols, doc.rows);
  return { originX: 0, originY: 0, width: layout.width, height: layout.height };
}

/** 计划生成期间的告警收集（去重 + 计数，避免大地图刷出上万条）。 */
interface WarnSink {
  /** 整图引用了不存在（或不是整图）的素材。 */
  missingStamp: Set<string>;
  /** 地图里引用、但展平后找不到的图块序号。 */
  missing: Set<number>;
  /** 缺掩码回退：`tilesetId|wanted|used` → 格子数。 */
  fallback: Map<string, { tilesetId: string; wanted: number; used: number; cells: number }>;
  /** 一块掩码都没配的自动连接图集。 */
  unmasked: Set<string>;
  /** A2 小格排列与预期不一致的图集。 */
  a2Layout: Set<string>;
  /** 变体 / 形状数超出素材小格的图集。 */
  a2Range: Set<string>;
}

interface CellOpsEnv {
  context: RenderContext;
  doc: MapDoc;
  layout: MapLayout;
  /** 图集 id → 该图集第 0 块的 1-based 全局序号。 */
  baseIndex: Map<string, number>;
  tilesetById: Map<string, MapTileset>;
  sink: WarnSink;
}

/**
 * 每个图集第 0 块的全局序号。
 *
 * 从 `flatTiles` 派生（不是自己再算一遍图集顺序 —— 序号的真源只有那一处）。
 */
function tilesetBaseIndex(tilesets: readonly MapTileset[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const flat of flatTiles(tilesets)) {
    if (!out.has(flat.tilesetId)) out.set(flat.tilesetId, flat.index);
  }
  return out;
}

/**
 * A2 素材里「块 (variant, shape) 的某个象限」对应的小格序号（0-based，图集内）。
 *
 * `maptiles.buildTiles` 把 A2 图切成**小格行优先**的一张表：
 * 小格列数 = `floor(imageWidth / 块宽) * 2`（只切完整的逻辑块，横向不留半块），
 * 共 10 行小格。块 (variant, shape) 的 4 个小格占：
 *   小格列 = `variant * 2 + (0|1)`（TL/TR 取 0，BL/BR 取 1）
 *   小格行 = `shape * 2 + (0|1)`（TL/TR 取 0，BL/BR 取 1）
 * 于是图集内的 0-based 序号 = `小格行 * 小格列数 + 小格列`。
 *
 * 手算核对（`cell = 32×32`、图 `64×160` → 小格 16×16、小格网格 4 列 × 10 行）：
 *   variant 0 占小格列 0..1，variant 1 占 2..3；shape 0 占小格行 0..1 … shape 4 占 8..9。
 *   (variant 0, shape 0, TL) = 0*4+0 = 0 → 1-based 1（图左上角那块）✓
 *   (variant 0, shape 0, BR) = 1*4+1 = 5 → 6（第一个块右下角）✓
 *   (variant 1, shape 0, TL) = 0*4+2 = 2 → 3（第二个块左上角）✓
 *   (variant 0, shape 4, BR) = 9*4+1 = 37 → 38（图最底行、variant 0 的右半）✓
 */
function a2SmallIndex(tileset: MapTileset, smallCols: number, variant: number, shape: number, quad: number): number {
  const smallRow = shape * 2 + Math.floor(quad / 2);
  const smallCol = variant * 2 + (quad % 2);
  return smallRow * smallCols + smallCol;
}

/** 解出一个格子的全部 op（A2 是 4 条，其余 1 条）。 */
function cellOpsAt(env: CellOpsEnv, layerId: string, layerIndex: number, rr: number, cc: number): PlanOp[] {
  const w = wrapCell(env.layout, rr, cc);
  // 非环绕时越界就是越界（`wrapCell` 原样返回），必须在这里拦住。
  if (w.r < 0 || w.c < 0 || w.r >= env.doc.rows || w.c >= env.doc.cols) return [];
  const data = env.doc.data[layerId];
  const value = data === undefined ? 0 : data[cellIndex(env.doc, w.r, w.c)];
  if (!(value > 0)) return [];
  const flat = env.context.lookup.get(value);
  const tileset = flat === undefined ? undefined : env.tilesetById.get(flat.tilesetId);
  const base = flat === undefined ? undefined : env.baseIndex.get(flat.tilesetId);
  if (flat === undefined || tileset === undefined || base === undefined) {
    env.sink.missing.add(value);
    return [];
  }
  const local = value - base;
  if (local < 0 || local >= tileset.tiles.length) {
    env.sink.missing.add(value);
    return [];
  }
  // 「(r,c) 是不是同一类」= 同一张图集的块。变体 / 形状是渲染时推导出来的，
  // 存的是哪一块都不影响连接判断。**不要**改成比较 `shape`：界面上从调色板随便点
  // 一块（不同变体 / 形状）就会被判成断开，大片地面碎成小方块，而且不报错。
  const at: NeighborAt = (nr, nc) => {
    const cell = wrapCell(env.layout, nr, nc);
    if (cell.r < 0 || cell.c < 0 || cell.r >= env.doc.rows || cell.c >= env.doc.cols) return false;
    const raw = data === undefined ? 0 : data[cellIndex(env.doc, cell.r, cell.c)];
    if (!(raw > 0)) return false;
    const neighbor = env.context.lookup.get(raw);
    return neighbor !== undefined && neighbor.tilesetId === tileset.id;
  };
  // ⚠️ 这条分支是 A2 笔刷能不能用的关键：调色板给 A2 素材只出一个条目（`mapgen.paletteFor`
  // 挑的是该素材里 shape 最大、variant 0 的那一小格当缩略图，写进图层数据的就是它的序号），
  // 所以存下来的值本身**只是代表** ——
  // 少了这条分支，用户拿 A2 笔刷刷下去只会画出一个 16px 小格（而不是 4 象限拼块）。
  if (tileset.shape === "a2quad") return a2Ops(env, layerIndex, tileset, base, at, w, rr, cc);
  return wholeCellOps(env, layerIndex, tileset, base, local, at, w, rr, cc);
}

/** 整格地块（`plain` / `corner16`）：一条 op，必要时带逐行动画的循环。 */
function wholeCellOps(
  env: CellOpsEnv,
  layerIndex: number,
  tileset: MapTileset,
  base: number,
  local: number,
  at: NeighborAt,
  w: { r: number; c: number },
  rr: number,
  cc: number
): PlanOp[] {
  let position = local;
  if (tileset.shape === "corner16") {
    const configured: number[] = [];
    for (const tile of tileset.tiles) {
      if (typeof tile.mask === "number" && Number.isInteger(tile.mask)) configured.push(tile.mask);
    }
    if (configured.length === 0) {
      // 一块掩码都没配：契约规定退「图集的第一块」，绝不留空（留空 = 屏幕上一个洞）。
      env.sink.unmasked.add(tileset.id);
      position = 0;
    } else {
      const wanted = corner16Mask(at, w.r, w.c);
      const used = configured.includes(wanted) ? wanted : nearestMask(wanted, configured);
      if (used === undefined) {
        env.sink.unmasked.add(tileset.id);
        position = 0;
      } else {
        const found = tileset.tiles.findIndex((tile) => tile.mask === used);
        if (found >= 0) position = found;
        if (used !== wanted) {
          const key = `${tileset.id}|${wanted}|${used}`;
          const row = env.sink.fallback.get(key);
          if (row === undefined) env.sink.fallback.set(key, { tilesetId: tileset.id, wanted, used, cells: 1 });
          else row.cells++;
        }
      }
    }
  }
  const cols = Math.max(1, Math.floor(tileset.imageWidth / Math.max(1, tileset.cell.width)));
  const rows = Math.max(1, Math.floor(tileset.imageHeight / Math.max(1, tileset.cell.height)));
  let cycle: number[] | undefined;
  if (tileset.animRows === true && rows > 1) {
    // 同列共用一个「逻辑块」，各帧就是各行同列的块。相位统一从第 0 行开始 ——
    // 每一格各自从「用户画的那一行」起步的话，同一片水会各流各的（不同频）。
    const column = position % cols;
    const frames: number[] = [];
    for (let row = 0; row < rows; row++) {
      const index = row * cols + column;
      if (index >= tileset.tiles.length) break;
      frames.push(base + index);
    }
    // 「一遍」的帧序 → 实际循环（正放 / 倒放 / 来回）；只展开帧序，客户端不用改。
    if (frames.length > 1) cycle = applyLoop(frames, tileset.loop ?? "forward");
  }
  const index = cycle === undefined ? base + position : cycle[0];
  const topLeft = cellTopLeft(env.layout, rr, cc, tileset.cell.width, tileset.cell.height);
  const op: PlanOp = { l: layerIndex, r: w.r, c: w.c, t: index, x: Math.round(topLeft.x), y: Math.round(topLeft.y), a: 1 };
  if (cycle !== undefined) {
    op.cycle = cycle;
    if (tileset.fps !== undefined) op.fps = tileset.fps;
  }
  return [op];
}

/** A2 拼块：一格 4 条 op（TL/TR/BL/BR），各自指向「该象限形状 + 变体」的那个小格。 */
function a2Ops(
  env: CellOpsEnv,
  layerIndex: number,
  tileset: MapTileset,
  base: number,
  at: NeighborAt,
  w: { r: number; c: number },
  rr: number,
  cc: number
): PlanOp[] {
  const halfWidth = tileset.cell.width / 2;
  const halfHeight = tileset.cell.height / 2;
  const shapes = a2QuadrantShapes(at, w.r, w.c);
  // 小格列数必须与 `maptiles.buildTiles` 的切分一致（只切完整逻辑块）。
  const smallCols = Math.max(1, Math.floor(tileset.imageWidth / Math.max(1, tileset.cell.width)) * 2);
  const declared = Math.max(1, Math.round(tileset.variants) || 1);
  const variants = Math.min(declared, Math.max(1, Math.floor(smallCols / 2)));
  if (declared > variants) env.sink.a2Range.add(tileset.id);
  // 格子左上角：拿「一格大小」的方块问 `cellTopLeft`，得到的正好是格子左上角，
  // 与贴图锚点怎么定义无关；四个象限再从它加上半格偏移。
  const origin = cellTopLeft(env.layout, rr, cc, env.layout.stepX, env.layout.stepY);
  const ops: PlanOp[] = [];
  for (let quad = 0; quad < 4; quad++) {
    const shape = shapes[quad];
    const smallRow = shape * 2 + Math.floor(quad / 2);
    const cycle: number[] = [];
    for (let variant = 0; variant < variants; variant++) {
      const index = a2SmallIndex(tileset, smallCols, variant, shape, quad);
      if (index < 0 || index >= tileset.tiles.length) {
        env.sink.a2Range.add(tileset.id);
        continue;
      }
      const rect = tileset.tiles[index].rect;
      if (rect.x !== (variant * 2 + (quad % 2)) * halfWidth || rect.y !== smallRow * halfHeight || rect.width !== halfWidth || rect.height !== halfHeight) {
        // 仍然按行优先公式取块（换别的算法也未必对），但要说出来 —— 错位是看得见的。
        env.sink.a2Layout.add(tileset.id);
      }
      cycle.push(base + index);
    }
    if (cycle.length === 0) continue;
    const op: PlanOp = {
      l: layerIndex,
      r: w.r,
      c: w.c,
      t: cycle[0],
      x: Math.round(origin.x + (quad % 2) * halfWidth),
      y: Math.round(origin.y + Math.floor(quad / 2) * halfHeight),
      a: 1
    };
    // 变体差异就是动画：四个象限各带一条**等长**的 cycle，帧号因此是全局同一个。
    if (cycle.length > 1) {
      // 四个象限各带一条**等长**的展开后帧序 —— 同一条循环方式，帧号因此仍然是全局同一个。
      op.cycle = applyLoop(cycle, tileset.loop ?? "forward");
      if (tileset.fps !== undefined) op.fps = tileset.fps;
    }
    ops.push(op);
  }
  return ops;
}

/**
 * 生成绘制计划。
 *
 * - `opts.range` 缺省 = 整张地图（`0..cols` / `0..rows`）—— **导出走这条**，不环绕。
 *   给了就越界也算（环绕）：同一格会在多个像素位置出现，读格一律 `wrapCell`。
 * - `opts.layers` 只算这些层号（单层预览）；`op.l` 仍是真实层号。
 * - chunk 之间按行优先的 chunk 序拼接，chunk 内按 行 → 列 → 层 稳定排序：
 *   客户端照序 `drawImage` 即可与宿主逐像素同构。
 */
/** 整图图块表的键：第几帧 / 转几档 / 第几行第几列。 */
function stampKey(frame: number, rot: number, r: number, c: number): string {
  return `${frame}|${rot}|${r}|${c}`;
}

/**
 * 整图旋转档数归一成 0..3 的整数。
 *
 * `MapStamp.rot` 声明是 `number`，但存档里确实出现过 `null`（老版本把缺省值序列化成 null）
 * 和 `NaN`（`stampPlace` 不带 rot 时 `Math.round(Number(undefined))` 就是 NaN）。
 * 直接拼进 `stampKey` 会得到 `0|null|0|0` / `0|NaN|0|0`，跟素材索引里的 `0|0|0|0` 对不上，
 * 于是整张整图被当成「素材不见了」跳过——**图一块都不画，只有一句素材没了**。
 * 渲染端必须自己兜底，别让脏数据决定画不画。
 */
function stampRotOf(rot: unknown): number {
  const turn = Math.round(Number(rot));
  return Number.isFinite(turn) ? ((turn % 4) + 4) % 4 : 0;
}

/** 一张整图素材的索引：`frame|rot|r|c` → **1-based 全局序号**（`base` = 该素材在 flatTiles 里的起点）。 */
function stampTileIndex(tileset: MapTileset, base: number): Map<string, number> {
  const index = new Map<string, number>();
  /**
   * ⚠️ `base` 是这块素材**第 0 块的全局序号**（`tilesetBaseIndex`，已经是从 1 开始的），
   * `local` 是块在素材里的 **0-based** 下标 —— 所以这里是 `base + local`，**不要再加 1**。
   *
   * 真机翻车（用户那张城门）：写成 `base + local + 1` 之后每一格都画成了**下一块** ——
   * 整张图整体左移一格（「左边少了一块」），最右一格则越过 rot0 的块边界、取到了 rot1 那个
   * 「竖着的」块（「右边多了点东西」）。这类错位不报任何警告，只能靠黄金对照拦住：
   * `verify-map-pipeline` 第 22 节会把计划里每条 op 的矩形取出来，逐格和素材图比像素。
   */
  tileset.tiles.forEach((tile, local) => {
    const meta = tile.stamp;
    if (meta === undefined) return;
    index.set(stampKey(meta.frame, meta.rot, meta.r, meta.c), base + local);
  });
  return index;
}

/**
 * 一张整图**占到的每一格** + 每格通行性（导出与「区域叠加」共用同一份几何）。
 *
 * - 坐标**取模**落到地图内（与渲染一致：跨接缝的整图每格各自环绕）；
 * - 通行性取**转前**那一格（转的是图，角色站的位置跟着转）；
 * - 素材不见了 / 不是整图 → 空表（调用方给警告）。
 */
export function stampCellsOf(
  context: RenderContext,
  doc: MapDoc,
  stamp: MapStamp
): Array<{ r: number; c: number; pass: number }> {
  const tileset = context.tilesets.find((entry) => entry.id === stamp.tilesetId);
  const spec = tileset?.stamp;
  if (spec === undefined) return [];
  const span = stampSpan(spec, stampRotOf(stamp.rot));
  const out: Array<{ r: number; c: number; pass: number }> = [];
  for (let dr = 0; dr < span.rows; dr++) {
    for (let dc = 0; dc < span.cols; dc++) {
      const r = ((stamp.r + dr) % doc.rows + doc.rows) % doc.rows;
      const c = ((stamp.c + dc) % doc.cols + doc.cols) % doc.cols;
      const source = stampSourceCell(spec, stamp.rot, dr, dc);
      out.push({ r, c, pass: spec.pass[source.r * spec.cols + source.c] ?? 0 });
    }
  }
  return out;
}

/** 旋转后 (r,c) 对应转前的哪一格（顺时针 90°）。 */
function stampSourceCell(spec: { cols: number; rows: number }, rot: number, r: number, c: number): { r: number; c: number } {
  const turn = ((Math.round(rot) % 4) + 4) % 4;
  if (turn === 1) return { r: spec.rows - 1 - c, c: r };
  if (turn === 2) return { r: spec.rows - 1 - r, c: spec.cols - 1 - c };
  if (turn === 3) return { r: c, c: spec.cols - 1 - r };
  return { r, c };
}

export function buildPlan(
  context: RenderContext,
  doc: MapDoc,
  opts: { range?: CellRange; layers?: number[]; includeLegend?: boolean } = {}
): RenderPlan {
  const layout = layoutOf(context.grid, doc.cols, doc.rows);
  const range: CellRange = opts.range ?? { r0: 0, c0: 0, r1: doc.rows, c1: doc.cols };
  const keepLayers = opts.layers === undefined ? undefined : new Set(opts.layers);
  const legend: PlanLegendEntry[] =
    opts.includeLegend === false
      ? []
      : flatTiles(context.tilesets).map((flat) => ({ index: flat.index, tilesetId: flat.tilesetId, rect: flat.tile.rect }));

  const env: CellOpsEnv = {
    context,
    doc,
    layout,
    baseIndex: tilesetBaseIndex(context.tilesets),
    tilesetById: new Map(context.tilesets.map((tileset) => [tileset.id, tileset])),
    sink: { missing: new Set(), fallback: new Map(), unmasked: new Set(), a2Layout: new Set(), a2Range: new Set(), missingStamp: new Set() }
  };

  // 每个 op 额外记下**未 wrap** 的 (rr,cc)：op 上的 r/c 是规范坐标，用来排序的话
  // 环绕视口里会把地图的另一头排到前面（屏幕上的行序就乱了）。
  const buckets = new Map<string, Array<{ op: PlanOp; rr: number; cc: number }>>();
  const push = (op: PlanOp, rr: number, cc: number): void => {
    const key = chunkKey(chunkOf(rr, cc));
    let list = buckets.get(key);
    if (list === undefined) {
      list = [];
      buckets.set(key, list);
    }
    list.push({ op, rr, cc });
  };
  for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
    if (keepLayers !== undefined && !keepLayers.has(layerIndex)) continue;
    const layer = doc.layers[layerIndex];
    if (layer === undefined) continue;
    for (let rr = range.r0; rr < range.r1; rr++) {
      for (let cc = range.c0; cc < range.c1; cc++) {
        const ops = cellOpsAt(env, layer.id, layerIndex, rr, cc);
        if (ops.length === 0) continue;
        for (const op of ops) push(op, rr, cc);
      }
    }
    /**
     * 整图（多格印花）：**同一层里画在图块之后**（它是立在格子上的物件）。
     *
     * 一格一条 op，`t` 指向「该帧 / 该旋转 / 第几行第几列」的那块图 —— 旋转已经烘在素材图里，
     * 运行期不转任何东西；坐标与像素位置都由这里算好，客户端照旧只 drawImage。
     */
    for (const stamp of doc.stamps) {
      if (stamp.layerId !== layer.id) continue;
      const tileset = env.tilesetById.get(stamp.tilesetId);
      const spec = tileset?.stamp;
      if (tileset === undefined || spec === undefined) {
        env.sink.missingStamp.add(stamp.tilesetId);
        continue;
      }
      const rot = stampRotOf(stamp.rot);
      const span = stampSpan(spec, rot);
      const base = env.baseIndex.get(tileset.id) ?? 0;
      const index = stampTileIndex(tileset, base);
      /** 一格的帧序（frames > 1 时才展开）。 */
      const cycleOf = (r: number, c: number): number[] | undefined => {
        if (spec.frames <= 1) return undefined;
        const frames: number[] = [];
        for (let frame = 0; frame < spec.frames; frame++) {
          const tile = index.get(stampKey(frame, rot, r, c));
          if (tile === undefined) break;
          frames.push(tile);
        }
        return frames.length > 1 ? applyLoop(frames, tileset.loop ?? "forward") : undefined;
      };
      for (let dr = 0; dr < span.rows; dr++) {
        for (let dc = 0; dc < span.cols; dc++) {
          const rr = stamp.r + dr;
          const cc = stamp.c + dc;
          if (rr < range.r0 || rr >= range.r1 || cc < range.c0 || cc >= range.c1) continue;
          const cell = wrapCell(env.layout, rr, cc);
          if (cell.r < 0 || cell.c < 0 || cell.r >= doc.rows || cell.c >= doc.cols) continue;
          const cycle = cycleOf(dr, dc);
          const first = index.get(stampKey(0, rot, dr, dc));
          if (first === undefined && cycle === undefined) {
            env.sink.missingStamp.add(stamp.tilesetId);
            continue;
          }
          const position = cellTopLeft(env.layout, rr, cc, env.layout.stepX, env.layout.stepY);
          const op: PlanOp = {
            l: layerIndex,
            r: cell.r,
            c: cell.c,
            t: cycle === undefined ? (first as number) : cycle[0],
            x: position.x,
            y: position.y,
            a: 1
          };
          if (cycle !== undefined) {
            op.cycle = cycle;
            if (tileset.fps !== undefined) op.fps = tileset.fps;
          }
          push(op, rr, cc);
        }
      }
    }
  }

  const warnings: string[] = [];
  const nameOf = (id: string): string => env.tilesetById.get(id)?.name ?? id;
  if (context.tilesets.length === 0) warnings.push("还没有导入任何图集。");
  if (env.sink.missing.size > 0) {
    warnings.push(
      `地图里用到了 ${env.sink.missing.size} 个在图集里找不到的图块序号（素材被删过或改过切分？），这些格子没有画出来。`
    );
  }
  for (const row of env.sink.fallback.values()) {
    warnings.push(`图集「${nameOf(row.tilesetId)}」没有掩码 ${row.wanted} 的块，${row.cells} 个格子用了最近的掩码 ${row.used} 顶上。`);
  }
  for (const id of env.sink.unmasked) warnings.push(`图集「${nameOf(id)}」是自动连接形态，但没有一块带掩码，统一按第一块绘制。`);
  for (const id of env.sink.a2Layout) warnings.push(`图集「${nameOf(id)}」的 A2 小格排列与预期（小格行优先）不一致，拼出来的地块可能错位。`);
  for (const id of env.sink.a2Range) warnings.push(`图集「${nameOf(id)}」的变体 / 形状数超过了素材里的小格，画不出来的帧被丢掉了。`);
  for (const id of env.sink.missingStamp) warnings.push(`地图里引用了「${nameOf(id)}」的整图，但那块素材不见了（或已经不是整图），这些整图没有画出来。`);

  const chunks: PlanChunk[] = [];
  const cycles: number[][] = [];
  const seenCycles = new Set<string>();
  let frameCount = 1;
  const ordered = [...buckets.entries()].sort((a, b) => {
    const pa = parseChunkKey(a[0]) ?? { cx: 0, cy: 0 };
    const pb = parseChunkKey(b[0]) ?? { cx: 0, cy: 0 };
    return pa.cy - pb.cy || pa.cx - pb.cx;
  });
  let fpsMax = DEFAULT_FPS;
  for (const [key, list] of ordered) {
    list.sort((a, b) => a.rr - b.rr || a.cc - b.cc || a.op.l - b.op.l);
    for (const item of list) {
      const cycle = item.op.cycle;
      if (cycle === undefined) continue;
      if (cycle.length > frameCount) frameCount = cycle.length;
      // 客户端照 fpsMax 推时钟，慢速的那个不会拖住快速的那个。
      if (typeof item.op.fps === "number" && item.op.fps > fpsMax) fpsMax = item.op.fps;
      const id = cycle.join(",");
      if (seenCycles.has(id)) continue;
      seenCycles.add(id);
      cycles.push(cycle);
    }
    chunks.push({ key, ops: list.map((item) => item.op) });
  }

  return {
    chunks,
    bounds: planBounds(context, doc),
    legend,
    fps: DEFAULT_FPS,
    fpsMax,
    frameCount,
    cycles,
    markers: buildMarkers(context, doc, range),
    warnings
  };
}

/**
 * 落在 `range` 里的标记。
 *
 * 与 `cellOpsAt` 同一套走法：按**未 wrap** 的格坐标遍历视口，读格时 `wrapCell` ——
 * 于是环绕接缝处的标记会以多个像素位置各出一条，界面不需要知道环绕。
 *
 * 一格最多一个标记（宿主 `applyOps` 已经拦住重复放置），所以这里是 1:1 的查表。
 */
export function buildMarkers(context: RenderContext, doc: MapDoc, range: CellRange): PlanMarker[] {
  if (doc.markers.length === 0) return [];
  const layout = layoutOf(context.grid, doc.cols, doc.rows);
  const byCell = new Map<number, { n: number; marker: (typeof doc.markers)[number] }>();
  doc.markers.forEach((marker, index) => {
    byCell.set(marker.r * doc.cols + marker.c, { n: index + 1, marker });
  });
  // 圆别比格子还大（小网格 + 大标记会互相盖住），字号跟着半径走。
  const radius = Math.max(5, Math.round(Math.min(layout.stepX, layout.stepY) * 0.42));
  const font = Math.max(8, Math.round(radius * 1.2));
  const out: PlanMarker[] = [];
  for (let rr = range.r0; rr < range.r1; rr++) {
    for (let cc = range.c0; cc < range.c1; cc++) {
      const w = wrapCell(layout, rr, cc);
      // 非环绕时越界就是越界（`wrapCell` 原样返回）。
      if (w.r < 0 || w.c < 0 || w.r >= doc.rows || w.c >= doc.cols) continue;
      const hit = byCell.get(w.r * doc.cols + w.c);
      if (hit === undefined) continue;
      const center = cellCenter(layout, rr, cc);
      out.push({
        id: hit.marker.id,
        n: hit.n,
        name: hit.marker.name,
        r: w.r,
        c: w.c,
        x: Math.round(center.x),
        y: Math.round(center.y),
        radius,
        font
      });
    }
  }
  return out;
}

// ── 光栅化（导出 PNG 用）──────────────────────────────────────────────────

/** source-over 合成（与浏览器 canvas 的默认混合一致）。 */
function blendPixel(dst: Buffer, index: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  const sa = Math.min(1, a);
  const da = dst[index + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  const mix = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / outA);
  dst[index] = mix(r, dst[index]);
  dst[index + 1] = mix(g, dst[index + 1]);
  dst[index + 2] = mix(b, dst[index + 2]);
  dst[index + 3] = Math.round(outA * 255);
}

/** 最近邻整数缩放贴一块图（像素画专用，不做插值）。 */
function blitScaled(dst: Bitmap, source: Bitmap, rect: MapRect, dx: number, dy: number, scale: number, alpha: number): void {
  const x0 = Math.max(0, -dx);
  const y0 = Math.max(0, -dy);
  const x1 = Math.min(rect.width, Math.ceil((dst.width - dx) / scale));
  const y1 = Math.min(rect.height, Math.ceil((dst.height - dy) / scale));
  for (let sy = y0; sy < y1; sy++) {
    const srcRow = (rect.y + sy) * source.width;
    if (rect.y + sy < 0 || rect.y + sy >= source.height) continue;
    for (let sx = x0; sx < x1; sx++) {
      const srcX = rect.x + sx;
      if (srcX < 0 || srcX >= source.width) continue;
      const si = (srcRow + srcX) * 4;
      const a = (source.rgba[si + 3] / 255) * alpha;
      if (a <= 0) continue;
      const r = source.rgba[si];
      const g = source.rgba[si + 1];
      const b = source.rgba[si + 2];
      for (let oy = 0; oy < scale; oy++) {
        const ty = dy + sy * scale + oy;
        if (ty < 0 || ty >= dst.height) continue;
        for (let ox = 0; ox < scale; ox++) {
          const tx = dx + sx * scale + ox;
          if (tx < 0 || tx >= dst.width) continue;
          blendPixel(dst.rgba, (ty * dst.width + tx) * 4, r, g, b, a);
        }
      }
    }
  }
}

export interface RasterOptions {
  /** 整数缩放（像素画专用，最近邻，不做插值）。 */
  scale?: number;
}

export interface RasterResult {
  bitmap: Bitmap;
  bounds: PlanBounds;
  warnings: string[];
  /** 真正画进图里的 op 数（0 = 全透明，调用方要提示）。 */
  drawn: number;
}

/**
 * 把计划光栅化成位图（导出 `map.png` 用）。
 *
 * `lookup` 是**已解码的图集**（tilesetId → 位图）；解码由调用方做一次，
 * 一张地图里同一张图集只解一次，不要每块贴图解一遍。
 *
 * 只画**第 0 帧**（`op.t`）：PNG 是静帧，动画信息留在 `map.json` 与计划里。
 */
export function rasterize(context: RenderContext, doc: MapDoc, lookup: Map<string, Bitmap>, options: RasterOptions = {}): RasterResult {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  // 不传 range = 整张地图、不环绕（导出就是这条路）。
  const plan = buildPlan(context, doc, { includeLegend: true });
  const width = Math.ceil(plan.bounds.width * scale);
  const height = Math.ceil(plan.bounds.height * scale);
  if (width < 1 || height < 1) throw new Error("这张地图还没有任何内容，先画点东西再导出。");
  if (width * height > MAX_RENDER_PIXELS) {
    throw new Error(
      `导出图会到 ${width}×${height}（${((width * height) / 1e6).toFixed(1)}M 像素），超过 ${MAX_RENDER_PIXELS / 1e6}M 上限。` +
        `请把缩放调小，或把地图拆小。`
    );
  }
  const bitmap: Bitmap = { width, height, rgba: Buffer.alloc(width * height * 4) };
  const legend = new Map(plan.legend.map((entry) => [entry.index, entry]));
  const warnings = [...plan.warnings];
  const missingBitmaps = new Set<string>();
  let drawn = 0;
  for (const chunk of plan.chunks) {
    for (const op of chunk.ops) {
      const entry = legend.get(op.t);
      if (entry === undefined) continue;
      const source = lookup.get(entry.tilesetId);
      if (source === undefined) {
        // 图集没解码出来就是一片透明，界面上完全看不出来 —— 必须报。
        missingBitmaps.add(entry.tilesetId);
        continue;
      }
      blitScaled(
        bitmap,
        source,
        entry.rect,
        Math.round((op.x - plan.bounds.originX) * scale),
        Math.round((op.y - plan.bounds.originY) * scale),
        scale,
        op.a
      );
      drawn++;
    }
  }
  for (const id of missingBitmaps) {
    const name = context.tilesets.find((tileset) => tileset.id === id)?.name ?? id;
    warnings.push(`图集「${name}」的图片没有解码出来，它上面的格子没有画进 PNG。`);
  }
  return { bitmap, bounds: plan.bounds, warnings, drawn };
}


// ── Agent 检查图：按区域渲染 + 叠加 ──────────────────────────────────────

export interface MapRenderCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapRenderOverlay {
  /** 画标记圆圈（默认 false）。 */
  markers?: boolean;
  /** 在圆圈里画编号（默认 true，只有 markers 打开时才生效）。 */
  markerLabels?: boolean;
  /** 画格线（默认 false）。 */
  grid?: boolean;
  /** 画行 / 列坐标（默认 false）。 */
  axes?: boolean;
  /** 画整图通行性叠加（需要调用方传 passCells）。 */
  pass?: boolean;
  /** 画临时方框标注（不落盘）。 */
  outlines?: Array<{ r: number; c: number; color?: string; label?: string; width?: number; height?: number }>;
}

export interface MapRenderOptions {
  /** 格子范围，右下开区间；缺省 = 整张地图。 */
  range?: CellRange;
  /** 整数缩放，1~4。 */
  scale?: number;
  /** 只画这些层（层号）。 */
  layers?: number[];
  /** 静态检查用第几帧（动画循环取模）。 */
  frame?: number;
  background?: "transparent" | "checker" | "white" | "dark";
  overlay?: MapRenderOverlay;
  /** 已算好的整图通行性（`mapgen.passCellsOf`）；不给就不画。 */
  passCells?: Array<{ r: number; c: number; kind: number }>;
  maxPixels?: number;
}

export interface MapRenderResult {
  bitmap: Bitmap;
  crop: MapRenderCrop;
  range: CellRange;
  scale: number;
  drawn: number;
  markersDrawn: number;
  warnings: string[];
}

const MARKER_COLORS: Record<string, [number, number, number]> = {
  spawn: [63, 185, 80],
  exit: [88, 166, 255],
  chest: [240, 192, 64],
  boss: [255, 59, 48],
  event: [163, 113, 247],
  resource: [57, 197, 207],
  npc: [255, 159, 26],
  custom: [240, 192, 64]
};

function parseColor(value: unknown, fallback: [number, number, number] = [240, 192, 64]): [number, number, number] {
  if (typeof value !== "string") return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return fallback;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function markerColorOf(marker: { kind?: unknown; color?: unknown }): [number, number, number] {
  const kind = typeof marker.kind === "string" ? marker.kind : "custom";
  return parseColor(marker.color, MARKER_COLORS[kind] ?? MARKER_COLORS.custom);
}

function passColor(kind: number): [number, number, number] {
  if (kind === 0) return [255, 80, 80];
  if (kind === 2) return [90, 160, 255];
  return [90, 210, 120];
}

/**
 * 渲染一块地图区域，供 Agent 检查。与导出共用 `buildPlan` / `blitScaled`，
 * 只额外做「按 crop 平移」「格线 / 标记 / 通行性叠加」。
 */
export function renderMapView(
  context: RenderContext,
  doc: MapDoc,
  lookup: Map<string, Bitmap>,
  options: MapRenderOptions = {}
): MapRenderResult {
  const layout = layoutOf(context.grid, doc.cols, doc.rows);
  const requested = options.range ?? { r0: 0, c0: 0, r1: doc.rows, c1: doc.cols };
  const range: CellRange = {
    r0: Math.round(requested.r0),
    c0: Math.round(requested.c0),
    r1: Math.round(requested.r1),
    c1: Math.round(requested.c1)
  };
  if (!(range.r1 > range.r0) || !(range.c1 > range.c0)) throw new Error("渲染区域必须是正矩形（r1 > r0、c1 > c0）。");
  const scale = Math.max(1, Math.min(4, Math.round(options.scale ?? 1)));
  const crop: MapRenderCrop = {
    x: range.c0 * layout.stepX,
    y: range.r0 * layout.stepY,
    width: (range.c1 - range.c0) * layout.stepX,
    height: (range.r1 - range.r0) * layout.stepY
  };
  const width = Math.max(1, Math.ceil(crop.width * scale));
  const height = Math.max(1, Math.ceil(crop.height * scale));
  const maxPixels = Math.max(1, Math.round(options.maxPixels ?? 16_000_000));
  if (width * height > maxPixels) {
    throw new Error(`检查图会到 ${width}×${height}（超过 ${maxPixels} 像素上限）：请缩小 region 或 scale。`);
  }
  const bitmap: Bitmap = { width, height, rgba: Buffer.alloc(width * height * 4) };
  const background = options.background ?? "transparent";
  if (background === "checker") checkerBackground(bitmap, Math.max(4, 8 * scale));
  else if (background === "white") fillRect(bitmap, 0, 0, width, height, [255, 255, 255], 1);
  else if (background === "dark") fillRect(bitmap, 0, 0, width, height, [42, 42, 42], 1);

  const plan = buildPlan(context, doc, { range, layers: options.layers, includeLegend: true });
  const legend = new Map(plan.legend.map((entry) => [entry.index, entry]));
  const warnings = [...plan.warnings];
  const missing = new Set<string>();
  let drawn = 0;
  const frame = Math.max(0, Math.round(options.frame ?? 0));
  for (const chunk of plan.chunks) {
    for (const op of chunk.ops) {
      const entry = legend.get(op.t);
      if (entry === undefined) continue;
      const source = lookup.get(entry.tilesetId);
      if (source === undefined) {
        missing.add(entry.tilesetId);
        continue;
      }
      const cycle = op.cycle;
      const tile = cycle === undefined || cycle.length === 0 ? op.t : cycle[frame % cycle.length];
      const actual = legend.get(tile) ?? entry;
      const actualSource = lookup.get(actual.tilesetId);
      if (actualSource === undefined) {
        missing.add(actual.tilesetId);
        continue;
      }
      blitScaled(
        bitmap,
        actualSource,
        actual.rect,
        Math.round((op.x - crop.x) * scale),
        Math.round((op.y - crop.y) * scale),
        scale,
        op.a
      );
      drawn++;
    }
  }
  for (const id of missing) {
    const name = context.tilesets.find((tileset) => tileset.id === id)?.name ?? id;
    warnings.push(`图集「${name}」的图片没有解码出来，它上面的格子没有画进检查图。`);
  }

  const overlay = options.overlay ?? {};
  if (overlay.pass === true && Array.isArray(options.passCells)) {
    for (const cell of options.passCells) {
      if (cell.r < range.r0 || cell.r >= range.r1 || cell.c < range.c0 || cell.c >= range.c1) continue;
      const x = (cell.c * layout.stepX - crop.x) * scale;
      const y = (cell.r * layout.stepY - crop.y) * scale;
      fillRect(bitmap, x, y, layout.stepX * scale, layout.stepY * scale, passColor(cell.kind), 0.16);
    }
  }
  if (overlay.grid === true) {
    const gridColor: [number, number, number] = [255, 255, 255];
    const gridAlpha = 0.24;
    for (let c = range.c0; c <= range.c1; c++) {
      const x = (c * layout.stepX - crop.x) * scale;
      drawLine(bitmap, x, 0, x, height - 1, gridColor, gridAlpha, 1);
    }
    for (let r = range.r0; r <= range.r1; r++) {
      const y = (r * layout.stepY - crop.y) * scale;
      drawLine(bitmap, 0, y, width - 1, y, gridColor, gridAlpha, 1);
    }
  }
  if (overlay.axes === true) {
    const labelColor: [number, number, number] = [255, 255, 255];
    const every = Math.max(1, Math.ceil(Math.max(range.c1 - range.c0, range.r1 - range.r0) / 12));
    for (let c = range.c0; c < range.c1; c += every) {
      const x = ((c + 0.5) * layout.stepX - crop.x) * scale;
      drawDigits(bitmap, String(((c % doc.cols) + doc.cols) % doc.cols), x, 5 * scale, 5 * scale, labelColor, 0.75);
    }
    for (let r = range.r0; r < range.r1; r += every) {
      const y = ((r + 0.5) * layout.stepY - crop.y) * scale;
      drawDigits(bitmap, String(((r % doc.rows) + doc.rows) % doc.rows), 5 * scale, y, 5 * scale, labelColor, 0.75);
    }
  }
  if (Array.isArray(overlay.outlines)) {
    for (const outline of overlay.outlines) {
      if (outline.r < range.r0 || outline.r >= range.r1 || outline.c < range.c0 || outline.c >= range.c1) continue;
      const x = (outline.c * layout.stepX - crop.x) * scale;
      const y = (outline.r * layout.stepY - crop.y) * scale;
      const w = Math.max(1, Math.round(outline.width ?? 1)) * layout.stepX * scale;
      const h = Math.max(1, Math.round(outline.height ?? 1)) * layout.stepY * scale;
      const color = parseColor(outline.color, [255, 59, 48]);
      strokeRect(bitmap, x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2), color, 0.95, Math.max(1, scale));
      if (typeof outline.label === "string" && outline.label !== "") {
        drawDigits(bitmap, outline.label, x + w / 2, y + h / 2, 5 * scale, color, 0.95);
      }
    }
  }

  let markersDrawn = 0;
  if (overlay.markers === true) {
    const byId = new Map(doc.markers.map((marker) => [marker.id, marker]));
    for (const marker of plan.markers) {
      if (marker.x < crop.x || marker.x > crop.x + crop.width || marker.y < crop.y || marker.y > crop.y + crop.height) continue;
      const source = byId.get(marker.id);
      const color = markerColorOf((source ?? {}) as any);
      const cx = (marker.x - crop.x) * scale;
      const cy = (marker.y - crop.y) * scale;
      const radius = Math.max(4, marker.radius * scale);
      fillCircle(bitmap, cx, cy, radius, [20, 20, 20], 0.88);
      strokeCircle(bitmap, cx, cy, radius, [255, 214, 64], 0.95, Math.max(1, scale));
      if (overlay.markerLabels !== false) {
        drawDigits(bitmap, String(marker.n), cx, cy, Math.max(6, marker.font * scale), color, 1);
      }
      markersDrawn++;
    }
  }

  return { bitmap, crop, range, scale, drawn, markersDrawn, warnings };
}

export function bitmapToPng(bitmap: Bitmap): Buffer {
  return encodePng(bitmap.rgba, bitmap.width, bitmap.height);
}
