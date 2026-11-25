/**
 * 地图编辑器（模块六）的**图集（tileset）模型与切分**。
 *
 * 一个项目可以导入多张图集；每张图集按**自动识别出来的形态**切成图块：
 *
 *   · `plain`    正方形网格：按 `cell` 行优先逐格切；`animRows` 时**同一列的每一行
 *                是同一块的一帧**（地形动画，AsLib 的「逐行动画」）
 *   · `corner16` 整格自动连接：切法与 plain 完全相同，只是每块会挂一个 4 位掩码
 *   · `a2quad`   A2 拼块：一格的四个象限从素材里各取一个小格（详见 `buildTiles`）
 *
 * ## 两条铁律
 *
 * 1. **图块 id 由矩形派生**（`t{x}_{y}`），不是数组下标。重新切分（改格尺寸、改形态）
 *    之后，同一个矩形的元数据仍然挂在同一个 id 上；用下标的话会静默漂移。
 * 2. **单元格里存的是「全局图块序号」（1-based，0 = 空）**，不是图块 id ——
 *    绘制计划、脏 chunk、`map.json` 都靠它。序号由 `flatTiles()` 唯一决定，
 *    顺序 = 图集顺序 → `tiles` 数组顺序，别的地方不许按下标自己算。
 *
 * ## A2 的真实几何（照 AsLib，`AsMap.hpp` 的 `drawMapBranch` / `map20n_Number`）
 *
 *   一张 A2 图：小格边长 `S = imageHeight / 10`（10 行小格），横向 `imageWidth % S === 0`。
 *   一个「逻辑块」（= 屏幕上一格）= 2×2 个小格。于是：
 *     · **块行号 0..4 = 形状号**（5 种），**块列号 = 变体号**（素材里横着排了几种）
 *     · 逻辑块尺寸 = 2S（32px 的块 = 16px 的小格），逻辑块列数 = `imageWidth / (2S)`
 *     · `detectLayout(64, 160)` → S=16、块 32×32、2 变体 × 5 形状
 *       （AsLib 要求「小格列数（= NumX）是偶数」，否则变体凑不成对）
 *   小格的行列号与小格内的象限是一一对应的：
 *     `smallRow = 2 * shape + (0 上 / 1 下)`，`smallCol = 2 * variant + (0 左 / 1 右)`
 *   这跟 AsLib 的 chip 下标 `NumX * 2 * shape + tm_id(+1)(+NumX)` 逐项相等 ——
 *   我们把 `tiles` 按小格行优先展开，于是 **1-based 序号 − 1 = AsLib 的 chip 下标**。
 *   渲染端（`maprender.ts`）按这个对应关系挑象限块，别自己另立一套顺序。
 */
import { pngSize, transparentFraction } from "./bitmap.js";
import { A2_SHAPES } from "./mapauto.js";
/**
 * 整图每边的格数下限。
 *
 * 从 2 松到 1：1×1 的整图等于「一格一张图」，用户拿它当带通行区域 / 可旋转的普通图块用；
 * 下限留 1 就行，再小就不是一张图了。
 */
export const STAMP_MIN_CELLS = 1;
/**
 * 整图占格的**硬上限**：只是一道「别把 9999 传进来」的保险；真正的业务上限是
 * **地图本身的大小**（一张整图最多和整张地图一样大）—— 那条在导入 / 整理时按项目尺寸校验
 * （`assertStampFitsProject`）。
 */
export const STAMP_MAX_CELLS = 512;
/** 整图最多几帧（每帧是一整张图，竖着排）。 */
export const STAMP_FRAMES_MAX = 16;
export const STAMP_PASS_LABELS = {
    0: "不可通过",
    1: "可通过（被人物遮挡）",
    2: "可通过（遮挡人物）"
};
/**
 * 归一「整图」规格：不认识的值**抛错**（不静默夹）。
 *
 * 返回 `undefined` 表示「这不是整图」（没给规格），与 `parseAssetFps` 的约定一致。
 */
export function parseStampSpec(raw) {
    if (raw === undefined || raw === null)
        return undefined;
    const source = raw;
    const int = (value) => {
        const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
        return Number.isFinite(n) ? Math.round(n) : undefined;
    };
    const cols = int(source.cols);
    const rows = int(source.rows);
    if (cols === undefined && rows === undefined)
        return undefined;
    for (const [label, value] of [["宽", cols], ["高", rows]]) {
        if (value === undefined || value < STAMP_MIN_CELLS || value > STAMP_MAX_CELLS) {
            throw new Error(`整图的${label}要在 ${STAMP_MIN_CELLS}~${STAMP_MAX_CELLS} 格之间，收到：${String(value)}`);
        }
    }
    const frames = int(source.frames) ?? 1;
    if (frames < 1 || frames > STAMP_FRAMES_MAX) {
        throw new Error(`整图的帧数要在 1~${STAMP_FRAMES_MAX} 之间，收到：${String(source.frames)}`);
    }
    const rawPass = Array.isArray(source.pass) ? source.pass : [];
    const pass = [];
    for (let i = 0; i < cols * rows; i++) {
        const value = rawPass[i] === undefined ? 0 : Math.round(Number(rawPass[i]));
        if (value !== 0 && value !== 1 && value !== 2) {
            throw new Error(`整图的区域只有三种：0 不可通过 / 1 可通过（被人物遮挡）/ 2 可通过（遮挡人物）—— 第 ${i + 1} 格收到：${String(rawPass[i])}`);
        }
        pass.push(value);
    }
    return { cols: cols, rows: rows, frames, pass };
}
/**
 * 整图在某个旋转下占几格（90° / 270° 时长宽互换）—— 旋转是顺时针。
 */
/**
 * 整图不能比地图大（一张整图最多占满整张地图）。
 *
 * 为什么不用固定的「最多 8 格」：用户要做「一张图铺满整张地图」的城门 / 大地图插画，8 格根本不够。
 * 真正的上限是地图自己 —— 比地图还大的整图永远画不全，只会让人以为是 bug。
 */
export function assertStampFitsProject(spec, mapCols, mapRows) {
    if (spec.cols > mapCols || spec.rows > mapRows) {
        throw new Error(`整图比地图还大：这张是 ${spec.cols}×${spec.rows} 格，而地图只有 ${mapCols}×${mapRows} 格。一张整图最多和整张地图一样大。`);
    }
}
export function stampSpan(spec, rot) {
    const turn = ((Math.round(rot) % 4) + 4) % 4;
    return turn % 2 === 1 ? { cols: spec.rows, rows: spec.cols } : { cols: spec.cols, rows: spec.rows };
}
/**
 * 烘焙排版：**每帧 4 个旋转，逐块竖排**。
 *
 * 顺序是 `frame 0 (rot 0,1,2,3) → frame 1 (rot 0,1,2,3) …`；宽度取 `max(cols, rows)` 格
 * （竖着的块比横着的块窄一点，右边留透明），这样非方形整图（4×3）也能放进同一张图。
 */
export function stampBlocks(spec) {
    const out = [];
    let y = 0;
    for (let frame = 0; frame < spec.frames; frame++) {
        for (let rot = 0; rot < 4; rot++) {
            const span = stampSpan(spec, rot);
            out.push({ frame, rot, y, cols: span.cols, rows: span.rows });
            y += span.rows;
        }
    }
    return out;
}
/**
 * **源图**有多少格宽 / 高（还**没有**烘旋转）。
 *
 * ⚠️ 这一条是给「AI 整理」用的：`composeMapAsset` 只负责把每帧拼成 `cols × rows*frames` 的
 * 源图，**旋转由导入端烘**。两边都烘过一次的话，导入会把「4 个旋转叠起来的图」当成一帧再压成
 * 一格高 —— 真机就是这么翻的车（`ai/…png` 是 1024×2560，导入压成 256×64，地图上全是横条纹）。
 */
export function stampSourceCells(spec) {
    return { cols: spec.cols, rows: spec.rows * spec.frames };
}
/** 烘焙后的素材图有多少格宽 / 高。 */
export function stampSheetCells(spec) {
    const blocks = stampBlocks(spec);
    const last = blocks[blocks.length - 1];
    return {
        cols: Math.max(spec.cols, spec.rows),
        rows: last === undefined ? spec.rows : last.y + last.rows
    };
}
export const COMMON_TILE_SIZES = [8, 16, 24, 32, 48, 64];
/** 素材自己的播放速度的合法范围（帧/秒）。下限 0.5 是「两秒走一帧」，上限 30 已经比手速快。 */
export const ASSET_FPS_MIN = 0.5;
export const ASSET_FPS_MAX = 30;
/**
 * 归一素材自己的播放速度：`undefined` / `null` / `""` = **跟全局**，返回 `undefined`。
 *
 * 不合法的值**抛错**（不静默夹到边界）—— 这个仓库的规矩：静默改值比直接报错难查得多。
 * 界面上是一个下拉框，会走到这里的只有对话面与老数据。
 */
export function parseAssetFps(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed))
        throw new Error(`播放速度得是数字（帧/秒），收到：${String(value)}`);
    if (parsed < ASSET_FPS_MIN || parsed > ASSET_FPS_MAX) {
        throw new Error(`播放速度要在 ${ASSET_FPS_MIN}~${ASSET_FPS_MAX} 帧/秒之间，收到：${parsed}`);
    }
    // 两位小数够了（0.5 帧/秒 = 两秒一帧）。
    return Math.round(parsed * 100) / 100;
}
export function tileIdFor(rect) {
    return `t${rect.x}_${rect.y}`;
}
export function rectKey(rect) {
    return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}
/**
 * plain 兜底的试算顺序：**先 ≤32 的降序**（32 → 24 → 16 → 8），再 >32 的升序（48 → 64）。
 *
 * 为什么不直接取「能整除的最大尺寸」：像素画工作流的默认口径就是 32px，而「最大」
 * 会把 2×2 个 32px 道具并成一个 64px 格 —— 那是**静默改掉用户素材的语义**（一块里
 * 装四个道具），比报错难查得多。48 / 64 只在前面的都试不出来时才轮到。
 *
 * 举例（都是 32px 网格）：`256×192` = 8 列 × 6 行 —— 若取最大会得到 64px / 4×3；
 * `96×96` = 3×3 —— 若取最大会得到 48px。注意 `256×160`（8×5）**轮不到这一分支**：
 * 它会先命中上面的 A2 判据（高 = 5 × 32、宽能被 32 整除），那正是内置道具图走
 * `importSampleTileset` 的 `known` 通道显式声明形态、不经自动识别的原因。
 */
const PLAIN_PREFERRED_SIZES = [
    ...COMMON_TILE_SIZES.filter((size) => size <= 32).reverse(),
    ...COMMON_TILE_SIZES.filter((size) => size > 32)
];
/**
 * 自动识别切分方式。
 *
 * **先试 A2**（`imageHeight === 5 × 块边长` 且 `imageWidth` 能被块边长整除，从小到大），
 * 免得 64×160 的草地被当成普通网格；再按 `PLAIN_PREFERRED_SIZES` 找能整除两者的
 * 正方形网格；两个都不成立时退回 32×32，并在 reason 里说清为什么要裁像素。
 *
 * ⚠️ **尺寸判据天生有二义性，这里不是 bug**：`256×160` 既可能是「8 变体 × 5 形状的
 * 拼块图」，也可能是「8×5 的 32px 普通网格」（AsLib 靠清单文件里的 `type` 列区分，
 * 光看尺寸分不开）。这里的取舍是**优先给拼块结论**；内置素材那条路不吃这个判据
 * （`mapgen.importSampleTileset` 带显式的 `shape` / `cell` / `animRows`），
 * 用户自己导入的图靠界面上「这块素材怎么用」的下拉改（`saveMapTileset`）。
 */
export function detectLayout(imageWidth, imageHeight) {
    for (const size of COMMON_TILE_SIZES) {
        if (imageHeight !== size * A2_SHAPES || imageWidth % size !== 0)
            continue;
        return {
            ...layoutFor("a2quad", { width: size, height: size }, imageWidth, imageHeight),
            reason: `识别到：拼块自动连接（${imageWidth / size} 种变体 × ${A2_SHAPES} 种形状）`
        };
    }
    for (const size of PLAIN_PREFERRED_SIZES) {
        if (imageWidth < size || imageHeight < size)
            continue;
        if (imageWidth % size !== 0 || imageHeight % size !== 0)
            continue;
        return {
            ...layoutFor("plain", { width: size, height: size }, imageWidth, imageHeight),
            reason: `识别到：正方形网格 ${size}×${size}（${imageWidth / size} 列 × ${imageHeight / size} 行）`
        };
    }
    return {
        ...layoutFor("plain", { width: 32, height: 32 }, imageWidth, imageHeight),
        reason: `没找到能整除 ${imageWidth}×${imageHeight} 的常见尺寸，先按 32×32 切：右侧 / 底部不足一格的部分会被裁掉。`
    };
}
/**
 * 按指定的形态与格尺寸算切分结果（用户在图集设置里改形态 / 格尺寸时走这条）。
 *
 * 只取**完整的块**：横向 / 纵向不足一个块的像素被裁掉（`Math.floor`），
 * 因为半个块既挑不出象限也对不上邻接。A2 还要求格尺寸是偶数（小格 = 块 / 2）。
 */
export function layoutFor(shape, cell, imageWidth, imageHeight, 
/** 仅 stamp：占几格 / 几帧（决定切多少块）。 */
stamp) {
    if (!Number.isInteger(cell.width) || !Number.isInteger(cell.height) || cell.width < 1 || cell.height < 1) {
        throw new Error(`图块尺寸必须是正整数，收到 ${cell.width}×${cell.height}`);
    }
    if (shape === "stamp") {
        // 整图：切分数由规格决定（帧 × 4 旋转 × 占格），具体块阵见 `buildTiles`。
        const spec = stamp;
        if (spec === undefined)
            throw new Error("整图素材缺规格（占几格 / 几帧）——请重新导入这张图。");
        const size = stampSheetCells(spec);
        return {
            cell: { width: cell.width, height: cell.height },
            shape,
            cols: size.cols,
            rows: size.rows,
            count: size.cols * size.rows,
            reason: `整图 ${spec.cols}×${spec.rows} 格、${spec.frames} 帧（含 4 个旋转）`
        };
    }
    if (shape === "a2quad") {
        if (cell.width % 2 !== 0 || cell.height % 2 !== 0) {
            throw new Error(`A2 拼块要求逻辑块尺寸是偶数（小格 = 逻辑块 / 2），收到 ${cell.width}×${cell.height}`);
        }
        const cols = Math.floor(imageWidth / cell.width);
        // 形状只有 0..4：第 6 行以后永远选不到，切出来只会让序号表里多出用不上的块。
        const rows = Math.min(A2_SHAPES, Math.floor(imageHeight / cell.height));
        if (cols < 1 || rows < 1) {
            return {
                cell: { width: cell.width, height: cell.height },
                shape,
                cols: 0,
                rows: 0,
                count: 0,
                reason: `素材 ${imageWidth}×${imageHeight} 比一个逻辑块 ${cell.width}×${cell.height} 还小，切不出图块。`
            };
        }
        return {
            cell: { width: cell.width, height: cell.height },
            shape,
            cols,
            rows,
            count: cols * 2 * rows * 2,
            reason: `已设为：拼块自动连接（${cols} 种变体 × ${rows} 种形状）`
        };
    }
    const cols = Math.floor(imageWidth / cell.width);
    const rows = Math.floor(imageHeight / cell.height);
    if (cols < 1 || rows < 1) {
        return {
            cell: { width: cell.width, height: cell.height },
            shape,
            cols: 0,
            rows: 0,
            count: 0,
            reason: `素材 ${imageWidth}×${imageHeight} 比一个图块 ${cell.width}×${cell.height} 还小，切不出图块。`
        };
    }
    const count = cols * rows;
    const reason = shape === "corner16"
        ? `已设为：整格自动连接（${cell.width}×${cell.height} 切 ${cols} 列 × ${rows} 行，16 种邻接）`
        : `已设为：正方形网格 ${cell.width}×${cell.height}（${cols} 列 × ${rows} 行）`;
    return { cell: { width: cell.width, height: cell.height }, shape, cols, rows, count, reason };
}
/**
 * 按切分结果生成图块表，并**保留已有元数据**。
 *
 * 保留的判据是矩形派生的 id（`tileIdFor`）：改格尺寸后仍然存在的矩形**把旧 tile 上的
 * 字段原样带过来** —— 界面上按位序配好的 16 张连接块、改过的名字不会因为一次
 * 「改格尺寸」全被抹掉。消失的 id 丢弃，新出现的给默认值。
 *
 * ⚠️ 这里**不做白名单拷贝**，只覆盖由几何算出来的那几项（`id` / `rect` / `shape` /
 * `variant` / `frame`）。白名单是旧实现踩过的坑：`MapTile` 以后加一个字段
 * （锚点、通行、标签……），白名单没跟上就会在每次重切时静默清空 —— 而且只有
 * 「改过那个字段、又改了格尺寸」的用户才会遇到。反过来，几何派生项**必须**覆盖：
 * 沿用旧值会让块号与 rect 对不上，静默错位。
 *
 * 顺序（= `flatTiles` 的 1-based 序号顺序，改了就等同于换了一套语义值）：
 *   · plain / corner16：行优先逐格；`animRows` 时 `frame` = 行号（同列共用一个逻辑块）
 *   · a2quad：小格行优先；`shape` = 块行号、`variant` = 块列号、`frame` = 0
 */
export function buildTiles(input, previous = []) {
    const { shape, cell, imageWidth, imageHeight } = input;
    const previousById = new Map(previous.map((tile) => [tile.id, tile]));
    const tileOf = (rect, shapeAt, variant, frame) => {
        const id = tileIdFor(rect);
        const old = previousById.get(id);
        // 先整份继承旧 tile（含以后新增的字段），再覆盖几何派生项。
        const tile = old === undefined ? { id, rect, name: id } : { ...old };
        tile.id = id;
        tile.rect = rect;
        if (typeof tile.name !== "string" || tile.name === "")
            tile.name = id;
        if (shapeAt === undefined)
            delete tile.shape;
        else
            tile.shape = shapeAt;
        if (variant === undefined)
            delete tile.variant;
        else
            tile.variant = variant;
        tile.frame = frame;
        return tile;
    };
    if (shape === "stamp") {
        /**
         * 整图：块 = 帧 × 4 个旋转 × 占格。每块都带 `stamp` 元数据，
         * 渲染时按「第几帧、转几档、第几行第几列」把一张图摆到 N×M 个格子上。
         * 几何全部来自 `stampBlocks`（与烘焙 `bakeStampSheet` 同一份排版）。
         */
        const spec = input.stamp;
        if (spec === undefined)
            throw new Error("整图素材缺规格（占几格 / 几帧）——请重新导入这张图。");
        const tiles = [];
        for (const block of stampBlocks(spec)) {
            for (let r = 0; r < block.rows; r++) {
                for (let c = 0; c < block.cols; c++) {
                    const tile = tileOf({ x: c * cell.width, y: (block.y + r) * cell.height, width: cell.width, height: cell.height }, undefined, undefined, block.frame);
                    tile.stamp = { frame: block.frame, rot: block.rot, r, c };
                    tiles.push(tile);
                }
            }
        }
        return tiles;
    }
    if (shape === "a2quad") {
        if (cell.width % 2 !== 0 || cell.height % 2 !== 0) {
            throw new Error(`A2 拼块要求逻辑块尺寸是偶数（小格 = 逻辑块 / 2），收到 ${cell.width}×${cell.height}`);
        }
        const smallWidth = cell.width / 2;
        const smallHeight = cell.height / 2;
        // 只切完整的逻辑块：横向留半块的话，那一列凑不齐左右象限（AsLib 要求小格列数是偶数）。
        const smallCols = Math.floor(imageWidth / cell.width) * 2;
        const smallRows = Math.min(A2_SHAPES, Math.floor(imageHeight / cell.height)) * 2;
        const tiles = [];
        for (let smallRow = 0; smallRow < smallRows; smallRow++) {
            for (let smallCol = 0; smallCol < smallCols; smallCol++) {
                tiles.push(tileOf({ x: smallCol * smallWidth, y: smallRow * smallHeight, width: smallWidth, height: smallHeight }, Math.floor(smallRow / 2), Math.floor(smallCol / 2), 0));
            }
        }
        return tiles;
    }
    const cols = Math.floor(imageWidth / cell.width);
    const rows = Math.floor(imageHeight / cell.height);
    const animRows = input.animRows === true;
    const tiles = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            tiles.push(tileOf({ x: col * cell.width, y: row * cell.height, width: cell.width, height: cell.height }, undefined, undefined, animRows ? row : 0));
        }
    }
    return tiles;
}
/**
 * 展平成一个全项目通用的索引。
 *
 * 顺序 = 图集顺序 → `tileset.tiles` 数组顺序，**因此只要不动图集顺序与切分参数，
 * 序号就稳定**；这也是 `applyOps` 里存的序号能跨会话读回来的前提。
 * 序号的唯一真源是这里，别的任何地方都不许自己按数组下标算。
 */
export function flatTiles(tilesets) {
    const out = [];
    let index = 1;
    for (const tileset of tilesets) {
        for (const tile of tileset.tiles) {
            out.push({ index, tilesetId: tileset.id, tile, value: index });
            index++;
        }
    }
    return out;
}
export function flatIndexByValue(tilesets) {
    return new Map(flatTiles(tilesets).map((flat) => [flat.value, flat]));
}
// ── 图像尺寸探测 / 裁剪 ──────────────────────────────────────────────────
/** 从文件头拿尺寸；PNG 之外的类型回落到 ffmpeg（见 `bitmap.probeImageSize`）。 */
export function sizeFromBytes(bytes) {
    return pngSize(bytes);
}
/** 给验收 / 界面用的图块位图（裁剪出一块）。 */
export function cropTile(source, rect) {
    const width = Math.max(1, Math.min(rect.width, source.width - rect.x));
    const height = Math.max(1, Math.min(rect.height, source.height - rect.y));
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const from = ((rect.y + y) * source.width + rect.x) * 4;
        source.rgba.copy(rgba, y * width * 4, from, from + width * 4);
    }
    return { width, height, rgba };
}
export const ASSET_LOOPS = ["forward", "reverse", "pingpong"];
/** 归一循环方式：不认识的值**抛错**（不静默回落）。留空 = `forward`。 */
export function parseAssetLoop(value) {
    if (value === undefined || value === null || value === "")
        return "forward";
    const text = String(value);
    if (!ASSET_LOOPS.includes(text)) {
        throw new Error(`未知的循环方式：${text}（可选 ${ASSET_LOOPS.join(" / ")}）`);
    }
    return text;
}
/**
 * 把「一遍」的帧序展开成**实际循环**的帧序。
 *
 * 来回播放用的是 `[0,1,2,3,2,1]`（首尾各留一次，中间来回），2 帧时就是原样 ——
 * 那是对的：两帧来回和正放看起来一样，循环点也不会跳。
 */
export function applyLoop(frames, loop = "forward") {
    if (frames.length <= 1)
        return [...frames];
    if (loop === "reverse")
        return [...frames].reverse();
    if (loop === "pingpong")
        return [...frames, ...frames.slice(1, -1).reverse()];
    return [...frames];
}
// ── 自动裁边：模型爱在四周留一圈白边 ───────────────────────────────────────
/** 算「白/浅灰画布边」用的亮度下界（0~255）。 */
const LIGHT_BAND = 170;
/**
 * 裁掉四周**近乎纯色**的边框（模型经常无视「四边不留白」）。
 *
 * 判据是「这一行 / 这一列的像素彼此几乎一样（偏差 < `tolerance`）」，从四条边往里推进，
 * 遇到第一行有内容（颜色起伏）就停。
 *
 * ⚠️ **宁可少裁，也不能把画面裁坏** —— 这个模块的素材是「一格内容」，四周本来就该有画面，
 * 裁错了就是内容被裁掉。所以四道保险缺一不可：
 *   ① 只裁**浅色**带（平均亮度 ≥ `LIGHT_BAND`）：模型留的是白 / 浅灰画布边；深色平底
 *      往往是道具自己的背景，属于内容；
 *   ② 每边最多裁 `maxRatio`（默认 6%）—— 真边框就是一圈薄边，超过 6% 更可能是背景；
 *   ③ 裁完至少留 `minKeep`（默认 60%）的宽高；
 *   ④ 四条边**都得**有浅色带，而且**里面必须真的有内容**（有 ≥2% 的像素与边框色明显不同）。
 *      整张图是一个纯色（测试夹具 / 单色砖）时因此一个像素都不动。
 */
export function trimUniformBorder(frame, options = {}) {
    const tolerance = Math.max(1, options.tolerance ?? 12);
    const maxRatio = Math.min(0.2, Math.max(0.01, options.maxRatio ?? 0.06));
    const minKeep = Math.min(0.95, Math.max(0.5, options.minKeep ?? 0.6));
    const unchanged = { bitmap: frame, left: 0, top: 0, right: 0, bottom: 0 };
    if (frame.width < 4 || frame.height < 4)
        return unchanged;
    const at = (x, y) => {
        const offset = (y * frame.width + x) * 4;
        return frame.rgba.subarray(offset, offset + 4);
    };
    /** 这一整行（或列）是不是「一个颜色」。 */
    const rowUniform = (y, from, to) => {
        const first = at(from, y);
        for (let x = from; x < to; x++) {
            const pixel = at(x, y);
            if (Math.abs(pixel[0] - first[0]) > tolerance || Math.abs(pixel[1] - first[1]) > tolerance || Math.abs(pixel[2] - first[2]) > tolerance)
                return false;
        }
        return true;
    };
    const colUniform = (x, from, to) => {
        const first = at(x, from);
        for (let y = from; y < to; y++) {
            const pixel = at(x, y);
            if (Math.abs(pixel[0] - first[0]) > tolerance || Math.abs(pixel[1] - first[1]) > tolerance || Math.abs(pixel[2] - first[2]) > tolerance)
                return false;
        }
        return true;
    };
    // 先量出纯色带「到底有多宽」（上限 45%，防病态图），再决定它算不算画布边。
    const scanLimitX = Math.floor(frame.width * 0.45);
    const scanLimitY = Math.floor(frame.height * 0.45);
    let left = 0;
    while (left < scanLimitX && colUniform(left, 0, frame.height))
        left++;
    let right = 0;
    while (right < scanLimitX && colUniform(frame.width - 1 - right, 0, frame.height))
        right++;
    let top = 0;
    while (top < scanLimitY && rowUniform(top, 0, frame.width))
        top++;
    let bottom = 0;
    while (bottom < scanLimitY && rowUniform(frame.height - 1 - bottom, 0, frame.width))
        bottom++;
    // ④a 四条边都得有浅色带；有一条没裁说明这条边是满的（图本来就是铺满的）。
    if (left === 0 || right === 0 || top === 0 || bottom === 0)
        return unchanged;
    /**
     * ② 带子太宽就不当画布边：真边框是一圈薄边（几个百分点）。宽过 `maxRatio` 的
     * 纯色带更可能是**背景**（道具画在平底上的那种），裁掉就把内容裁了 —— 宁可不动。
     */
    if (left > frame.width * maxRatio || right > frame.width * maxRatio || top > frame.height * maxRatio || bottom > frame.height * maxRatio)
        return unchanged;
    /**
     * 再多裁 `inset`（1%）：模型描的边框常有一两像素的柔化过渡，纯色判定会在过渡处停下，
     * 残留一圈**浅色细边** —— 缩到格子上就是每块素材边上一条白线。只在「确实有边框」时才多
     * 吃这一点（不会伤到正常素材），并且仍然受下面的最小保留量约束。
     */
    {
        const inset = Math.max(1, Math.round(Math.min(frame.width, frame.height) * 0.01));
        const capX = Math.floor(frame.width * maxRatio);
        const capY = Math.floor(frame.height * maxRatio);
        left = Math.min(left + inset, capX);
        right = Math.min(right + inset, capX);
        top = Math.min(top + inset, capY);
        bottom = Math.min(bottom + inset, capY);
    }
    // ③ 至少留 60%。
    const width = frame.width - left - right;
    const height = frame.height - top - bottom;
    if (width < frame.width * minKeep || height < frame.height * minKeep)
        return unchanged;
    if (width < 2 || height < 2)
        return unchanged;
    // ① 边框得是浅色（白 / 浅灰画布边），深色平底算内容。
    const band = at(Math.floor(left / 2), Math.floor(top / 2));
    const luminance = (band[0] + band[1] + band[2]) / 3;
    if (luminance < 170)
        return unchanged;
    // ④b 里面必须真的有内容：至少 2% 的像素与边框色明显不同。
    let different = 0;
    const total = width * height;
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const pixel = at(left + x, top + y);
            if (Math.abs(pixel[0] - band[0]) > tolerance * 2 || Math.abs(pixel[1] - band[1]) > tolerance * 2 || Math.abs(pixel[2] - band[2]) > tolerance * 2)
                different++;
        }
    }
    if (different < Math.max(4, total * 0.02 * 0.25))
        return unchanged;
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const from = ((top + y) * frame.width + left) * 4;
        frame.rgba.copy(rgba, y * width * 4, from, from + width * 4);
    }
    return { bitmap: { width, height, rgba }, left, top, right, bottom };
}
export const ASSET_CLARITIES = ["smooth", "sharp", "crisp"];
/** 归一清晰度：不认识的值**抛错**（不静默回落到某个默认值）。留空 = `smooth`。 */
export function parseClarity(value) {
    if (value === undefined || value === null || value === "")
        return "smooth";
    const text = String(value);
    if (!ASSET_CLARITIES.includes(text)) {
        throw new Error(`未知的清晰度：${text}（可选 ${ASSET_CLARITIES.join(" / ")}）`);
    }
    return text;
}
/**
 * 素材图最多保留多少倍分辨率（相对地图格子）。`composeMapAsset` 把大图先留到
 * `cell × 这个倍数`，等用户在「新增素材」里选好清晰度再缩到格子上 —— 留太多没意义
 * （32px 一格看不出 256px 与 128px 的区别），留 1 倍就等于没得选。
 */
export const MAX_ASSET_SCALE = 4;
/** 归一「素材图相对格子的倍数」：1~8 的整数，留空 = 1。越界抛错。 */
export function parseAssetScale(value) {
    if (value === undefined || value === null || value === "")
        return 1;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
        throw new Error(`素材图的倍数得是 1~8 的整数，收到：${String(value)}`);
    }
    return parsed;
}
/** 一次重采样的原料：源图 + 目标尺寸 + 方式。 */
function nearestResample(frame, width, height) {
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(frame.height - 1, Math.floor((y * frame.height) / height));
        for (let x = 0; x < width; x++) {
            const sx = Math.min(frame.width - 1, Math.floor((x * frame.width) / width));
            const from = (sy * frame.width + sx) * 4;
            const to = (y * width + x) * 4;
            rgba[to] = frame.rgba[from];
            rgba[to + 1] = frame.rgba[from + 1];
            rgba[to + 2] = frame.rgba[from + 2];
            rgba[to + 3] = frame.rgba[from + 3];
        }
    }
    return { width, height, rgba };
}
/** 面积平均（盒式）重采样：每个目标像素 = 它覆盖到的源像素的加权平均。 */
function boxResample(frame, width, height) {
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy0 = (y * frame.height) / height;
        const sy1 = ((y + 1) * frame.height) / height;
        const yStart = Math.max(0, Math.floor(sy0));
        const yEnd = Math.min(frame.height, Math.max(yStart + 1, Math.ceil(sy1)));
        for (let x = 0; x < width; x++) {
            const sx0 = (x * frame.width) / width;
            const sx1 = ((x + 1) * frame.width) / width;
            const xStart = Math.max(0, Math.floor(sx0));
            const xEnd = Math.min(frame.width, Math.max(xStart + 1, Math.ceil(sx1)));
            /**
             * alpha 要**预乘**再平均：不预乘的话透明边缘（抠过像的素材）会把黑色带进来，
             * 缩小之后一圈发黑 —— 这也是「看起来不干净」的一个来源。
             */
            let sumA = 0;
            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let count = 0;
            for (let sy = yStart; sy < yEnd; sy++) {
                for (let sx = xStart; sx < xEnd; sx++) {
                    const offset = (sy * frame.width + sx) * 4;
                    const alpha = frame.rgba[offset + 3] / 255;
                    sumR += frame.rgba[offset] * alpha;
                    sumG += frame.rgba[offset + 1] * alpha;
                    sumB += frame.rgba[offset + 2] * alpha;
                    sumA += frame.rgba[offset + 3];
                    count++;
                }
            }
            const to = (y * width + x) * 4;
            if (count === 0)
                continue;
            const averageAlpha = sumA / count;
            const weight = (averageAlpha / 255) * count;
            rgba[to] = weight <= 0 ? 0 : Math.min(255, Math.round(sumR / weight));
            rgba[to + 1] = weight <= 0 ? 0 : Math.min(255, Math.round(sumG / weight));
            rgba[to + 2] = weight <= 0 ? 0 : Math.min(255, Math.round(sumB / weight));
            rgba[to + 3] = Math.min(255, Math.round(averageAlpha));
        }
    }
    return { width, height, rgba };
}
/** 3×3 盒式模糊（只给锐化当底稿用）。 */
function blur3x3(frame) {
    const rgba = Buffer.alloc(frame.width * frame.height * 4);
    for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const sx = Math.min(frame.width - 1, Math.max(0, x + dx));
                    const sy = Math.min(frame.height - 1, Math.max(0, y + dy));
                    const offset = (sy * frame.width + sx) * 4;
                    r += frame.rgba[offset];
                    g += frame.rgba[offset + 1];
                    b += frame.rgba[offset + 2];
                    a += frame.rgba[offset + 3];
                    count++;
                }
            }
            const to = (y * frame.width + x) * 4;
            rgba[to] = Math.round(r / count);
            rgba[to + 1] = Math.round(g / count);
            rgba[to + 2] = Math.round(b / count);
            rgba[to + 3] = Math.round(a / count);
        }
    }
    return { width: frame.width, height: frame.height, rgba };
}
/** 锐化强度（`crisp` 用）：0.75 是「看得出来更利落、又不会出白边」的档。 */
const SHARPEN_AMOUNT = 0.75;
/**
 * 缩放到目标尺寸，按清晰度选算法。
 *
 * `sharp` 与原来源行为**逐像素一致**（最近邻）；`smooth` / `crisp` 只在**缩小**时有意义
 * （放大时退回最近邻 —— 插值放大只会更糊）。
 */
export function resampleToSize(frame, width, height, clarity = "smooth") {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    if (targetWidth === frame.width && targetHeight === frame.height)
        return { width: targetWidth, height: targetHeight, rgba: Buffer.from(frame.rgba) };
    const shrinking = targetWidth < frame.width || targetHeight < frame.height;
    if (clarity === "sharp" || !shrinking)
        return nearestResample(frame, targetWidth, targetHeight);
    const smoothed = boxResample(frame, targetWidth, targetHeight);
    if (clarity === "smooth")
        return smoothed;
    // crisp：平滑之后再按「原值 - 模糊」补一点边缘。
    const blurred = blur3x3(smoothed);
    const rgba = Buffer.from(smoothed.rgba);
    for (let offset = 0; offset < rgba.length; offset += 4) {
        for (let channel = 0; channel < 3; channel++) {
            const value = smoothed.rgba[offset + channel];
            const soft = blurred.rgba[offset + channel];
            rgba[offset + channel] = Math.min(255, Math.max(0, Math.round(value + SHARPEN_AMOUNT * (value - soft))));
        }
    }
    return { width: targetWidth, height: targetHeight, rgba };
}
// ── AI 生成素材：把模型吐出来的一批帧整理成一张能直接导入的素材图 ──────────
/**
 * 等比裁到目标宽高比、再**最近邻**缩放到 `width × height`。
 *
 * 为什么先裁再缩：地图上的图块是**按原尺寸**画在格子左上角的（宿主 `maprender`
 * 出的计划、界面按 `rect.width/height` `drawImage`），所以一格素材的像素尺寸必须
 * **正好等于地图网格**，否则会压到邻居格上。模型给的是 1024×1024 这类大图、也
 * 可能不是正方形，直接拉成网格尺寸会把内容压扁 —— 所以取中心等比裁切，再缩到
 * 目标尺寸。
 *
 * 为什么用最近邻而不是双线性：这是像素画工作流，硬边是内容的一部分；插值会把
 * 色块边缘糊成渐变（`rigpose` 那边的双线性采样是给骨骼变形用的，两件事）。
 */
export function fitFrameToCell(frame, cell, clarity = "sharp") {
    const width = Math.max(1, Math.floor(cell.width));
    const height = Math.max(1, Math.floor(cell.height));
    const targetRatio = width / height;
    const sourceRatio = frame.width / frame.height;
    // 按目标比例取中心那块（源图更宽 → 裁宽；更高 → 裁高）。
    let cropWidth;
    let cropHeight;
    if (sourceRatio > targetRatio) {
        cropHeight = frame.height;
        cropWidth = Math.max(1, Math.min(frame.width, Math.round(frame.height * targetRatio)));
    }
    else {
        cropWidth = frame.width;
        cropHeight = Math.max(1, Math.min(frame.height, Math.round(frame.width / targetRatio)));
    }
    const offsetX = Math.floor((frame.width - cropWidth) / 2);
    const offsetY = Math.floor((frame.height - cropHeight) / 2);
    // 先裁出中心那块，再按清晰度缩到目标尺寸（`sharp` = 最近邻，与原来逐像素一致）。
    const cropped = cropTile(frame, { x: offsetX, y: offsetY, width: cropWidth, height: cropHeight });
    return resampleToSize(cropped, width, height, clarity);
}
/**
 * 每帧先 `fitFrameToCell`，再**自上而下堆成一列**。
 *
 * 为什么是「一列 N 行」而不是「一行 N 列」：地图编辑器的翻页图（`animRows`）约定
 * **同一列的每一行是同一块的一帧** —— 调色板只取第 0 帧那一条、帧由宿主按全局
 * 帧号现推。横排会被当成 N 个互不相干的图块，画下去只是一块静止的图，而且不报错。
 */
export function stackFrames(frames, cell, clarity = "sharp") {
    if (frames.length === 0)
        throw new Error("没有可整理的帧");
    const width = Math.max(1, Math.floor(cell.width));
    const height = Math.max(1, Math.floor(cell.height));
    const fitted = frames.map((frame) => fitFrameToCell(frame, { width, height }, clarity));
    const rgba = Buffer.alloc(width * height * frames.length * 4);
    for (let index = 0; index < fitted.length; index++) {
        fitted[index].rgba.copy(rgba, index * height * width * 4);
    }
    return { width, height: height * frames.length, rgba };
}
// ── 按素材形态规整：普通 / 整格 / 拼块 ─────────────────────────────────────
/**
 * **非等比**最近邻缩放到指定宽高。
 *
 * 与 `fitFrameToCell` 的区别：那个是「中心等比裁切再缩」（一格内容 → 一格），
 * 这个是「整张图映射到目标矩形」（一张排布图 → 一张排布图）。
 *
 * 为什么整格 / 拼块必须**拉伸**而不是裁：模型画的是「4 列 × 4 行」「N 列 × 5 行」
 * 的排布，裁掉多余部分等于把某些块切掉，块与块的对应关系就没了；拉伸至少保证
 * **每块落在它该落的位置上**（内容会随源图比例轻微变形，但结构是对的）。提示词里
 * 会要求模型按目标比例出图，比例对上了拉伸就是恒等变换。
 */
export function stretchToSize(frame, width, height) {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    const rgba = Buffer.alloc(targetWidth * targetHeight * 4);
    for (let y = 0; y < targetHeight; y++) {
        const sy = Math.min(frame.height - 1, Math.floor((y * frame.height) / targetHeight));
        for (let x = 0; x < targetWidth; x++) {
            const sx = Math.min(frame.width - 1, Math.floor((x * frame.width) / targetWidth));
            const from = (sy * frame.width + sx) * 4;
            const to = (y * targetWidth + x) * 4;
            rgba[to] = frame.rgba[from];
            rgba[to + 1] = frame.rgba[from + 1];
            rgba[to + 2] = frame.rgba[from + 2];
            rgba[to + 3] = frame.rgba[from + 3];
        }
    }
    return { width: targetWidth, height: targetHeight, rgba };
}
/** 整格自动连接的块数（4×4 = 16 种接法，位序 N=1/E=2/S=4/W=8，掩码 = 行优先下标）。 */
export const CORNER16_BLOCKS = 4;
/** 拼块的形状行数（照 AsLib：上到下 5 种接法，最后一行是满格）。 */
export const A2_ROWS = A2_SHAPES;
/**
 * 「收口」的厚度：按被收口的那块图的大小算（32px 的一格 → 4px；拼块的 16px 小格 → 2px）。
 * 太薄看不出来，太厚会把内容吃掉。
 */
export function capThicknessFor(size) {
    return Math.min(6, Math.max(2, Math.round(size / 8)));
}
/** 把某个像素按系数压暗（alpha 不动：收口不该改变图像的形状）。 */
function darkenPixel(rgba, offset, factor) {
    for (let channel = 0; channel < 3; channel++) {
        const value = Math.round(rgba[offset + channel] * factor);
        rgba[offset + channel] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
}
/**
 * 在**一块图的某条边**上压一道「收口」：最外 1px 最深，往内线性回到原色。
 *
 * 为什么需要它：「断」的那一边是墙头 / 拐角 / 材质的边界，得能看出来；而**不能用
 * 模型画**（见 `corner16SheetFromTile` 的注释）—— 收口是几何，交给代码做才一致。
 */
export function shadeSide(bitmap, side, thickness = capThicknessFor(Math.min(bitmap.width, bitmap.height))) {
    const t = Math.max(1, Math.min(thickness, Math.min(bitmap.width, bitmap.height)));
    const horizontal = side === "N" || side === "S";
    const length = horizontal ? bitmap.width : bitmap.height;
    for (let depth = 0; depth < t; depth++) {
        // 最外一圈 0.35，往内线性回到 1.0（看起来像一条压边 + 内侧投影）。
        const factor = depth === 0 ? 0.35 : 0.35 + ((1 - 0.35) * depth) / t;
        for (let i = 0; i < length; i++) {
            const x = horizontal ? i : side === "W" ? depth : bitmap.width - 1 - depth;
            const y = horizontal ? (side === "N" ? depth : bitmap.height - 1 - depth) : i;
            darkenPixel(bitmap.rgba, (y * bitmap.width + x) * 4, factor);
        }
    }
}
/**
 * 在**一角**压一块 `size × size` 的收口（越靠外角越深）。
 *
 * 只有拼块的形状 3 用得上：它「上面和左边都接、左上方对角不接」—— 那个凹角要在
 * 象限的外角上露出一点缺口，否则形状 3 和满格（形状 4）就完全一样了。
 */
export function shadeCorner(bitmap, corner, size) {
    const t = Math.max(1, Math.min(size, Math.min(bitmap.width, bitmap.height)));
    for (let dy = 0; dy < t; dy++) {
        for (let dx = 0; dx < t; dx++) {
            const depth = Math.max(dx, dy);
            const factor = depth === 0 ? 0.35 : 0.35 + ((1 - 0.35) * depth) / t;
            const x = corner === "NW" || corner === "SW" ? dx : bitmap.width - 1 - dx;
            const y = corner === "NW" || corner === "NE" ? dy : bitmap.height - 1 - dy;
            darkenPixel(bitmap.rgba, (y * bitmap.width + x) * 4, factor);
        }
    }
}
/** 把一张小图画到另一张图上（左上角对齐）。 */
function blitInto(source, target, atX, atY) {
    for (let y = 0; y < source.height; y++) {
        const from = y * source.width * 4;
        const to = ((atY + y) * target.width + atX) * 4;
        source.rgba.copy(target.rgba, to, from, from + source.width * 4);
    }
}
/**
 * 整格（`corner16`）：由**一块无缝墙砖**拼出 4×4 = 16 格，每格只在「断」的那几边加收口。
 *
 * ⚠️ 这里**不再让模型画 4×4**，原因是实测出来的：一排墙在地图上会用到**三块不同的图块**
 * （只连右 / 左右都连 / 只连左 → 掩码 2 / 10 / 8 → 素材里的三个不同格子），而模型画出来的
 * 16 个格子是**各自独立**的（霓虹灯带、板缝各自偏几十像素），拼到一起边缘差 201、块内相邻
 * 列才差 58 —— 那就是用户看到的「接缝」。
 *
 * 正确做法是**几何交给代码**：模型只负责画**一块**无缝的墙面（内容），16 种接法由这里
 * 从同一块砖的像素拼出来 —— 凡是「连」的边都是同一张砖的边缘，接缝等于砖自身的环绕缝
 * （最好的可能值）；「断」的边由 `shadeSide` 加收口，所以墙头 / 拐角仍然看得见。
 */
/**
 * 顺时针转 90°：**竖着走的那一段墙要用它**。
 *
 * 一张砖墙贴图的砖缝是横向的；墙往南北走时，砖缝也得跟着竖过来 —— 否则竖着的那一段看着
 * 就是「同一张图硬贴上去」，花纹接不上（用户原话：「围墙竖过来的部分花纹就没拼了」）。
 */
export function rotate90(frame, clockwise = true) {
    const width = frame.height;
    const height = frame.width;
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // 顺时针：新 (x,y) 取原 (y, H-1-x)... 用行列替换写清楚更不容易错。
            const sx = clockwise ? y : frame.width - 1 - y;
            const sy = clockwise ? frame.height - 1 - x : x;
            const from = (sy * frame.width + sx) * 4;
            const to = (y * width + x) * 4;
            frame.rgba.copy(rgba, to, from, from + 4);
        }
    }
    return { width, height, rgba };
}
/**
 * **烘焙整图**：把「每帧一整张」的源图排成 `4 旋转 × 帧` 的素材图。
 *
 * 为什么把 4 个旋转烘进去、而不是让渲染器转：地图的绘制契约是「一格一次
 * `drawImage(rect → 目标格)`」，宿主的光栅化器（导出 PNG）也走同一条。旋转若发生在
 * 绘制时，客户端与宿主两边都要各写一套旋转几何，还要改黄金对照——烘进图里则只多占
 * 3 倍的图高，其余一行不动（调色板、legend、导出、客户端全都不用知道旋转这回事）。
 *
 * 源图要求：`cols × (rows × frames)` 格，帧自上而下排（与翻页图同一个约定）；
 * 尺寸不足 / 多出来的部分由 `resampleToSize` 的调用方负责（本函数按目标块切）。
 */
export function bakeStampSheet(source, spec, cell, clarity = "sharp") {
    const cellW = Math.max(1, Math.floor(cell.width));
    const cellH = Math.max(1, Math.floor(cell.height));
    const frameW = spec.cols * cellW;
    const frameH = spec.rows * cellH;
    const size = stampSheetCells(spec);
    const sheet = { width: size.cols * cellW, height: size.rows * cellH, rgba: Buffer.alloc(size.cols * cellW * size.rows * cellH * 4) };
    for (let frame = 0; frame < spec.frames; frame++) {
        // 逐帧取源图（源图可能刚被缩到目标尺寸，这里按格切，避免整图重采样两次）。
        const frameBitmap = { width: frameW, height: frameH, rgba: Buffer.alloc(frameW * frameH * 4) };
        for (let y = 0; y < frameH; y++) {
            const fromY = frame * frameH + y;
            if (fromY >= source.height)
                break;
            source.rgba.copy(frameBitmap.rgba, y * frameW * 4, (fromY * source.width) * 4, (fromY * source.width + Math.min(frameW, source.width)) * 4);
        }
        for (let rot = 0; rot < 4; rot++) {
            let turned = frameBitmap;
            for (let step = 0; step < rot; step++)
                turned = rotate90(turned, true);
            const block = stampBlocks(spec).find((item) => item.frame === frame && item.rot === rot);
            if (block === undefined)
                continue;
            blitInto(turned, sheet, 0, block.y * cellH);
        }
    }
    void clarity;
    return sheet;
}
/**
 * 「每帧一整张」的几张图 → 一张**源图**（`cols × rows*frames` 格，**不烘旋转**）。
 *
 * 分工：这里只负责「把每帧缩成一整块、竖着排好」；**4 个旋转由导入端烘**（`stampTilesetImage`）。
 * 两边都烘的话，导入会把「4 个旋转叠起来的那张图」当成一帧压扁 —— 真机踩过。
 */
export function composeStampSource(frames, spec, cell, clarity = "smooth") {
    if (frames.length === 0)
        throw new Error("没有可整理的帧");
    return stackFrames(frames, { width: spec.cols * Math.max(1, Math.floor(cell.width)), height: spec.rows * Math.max(1, Math.floor(cell.height)) }, clarity);
}
/**
 * 抠掉绿幕背景（**只给整图用**）：把「纯绿背景」变成透明。
 *
 * 为什么整图要抠、别的形态不用：普通 / 整格 / 拼块都是**铺满一格**的材质（背景就是内容），
 * 而整图是「立在格子上的物件」—— 绿幕是模型为了让人看清而加的假背景，留着就会在地图上
 * 出现一块绿色方框；而且它会让整图**占满** N×M 格，连本来该空着的角落也涂绿。
 *
 * 判定用 `chroma.keyGreen` 的 `backgroundFraction`：
 * - `< 0.02`：几乎没抠到东西（模型没画绿幕），**原样返回**并说明；
 * - `> 0.98`：整张都被判成背景（画面里没有主体），同样原样返回 —— 不能把图抠成空白。
 */
/**
 * 整图抠像的参数：**比角色抠像严格得多**，而且**关掉空间分割**。
 *
 * 真机教训（用户那张城门）：模型的「背景」其实是一片草地 + 泥土路，绿的优势值只有 26~59；
 * 角色的默认参数（`keyLow 14`）会把它当绿幕吃掉 82%，而空间分割（`bgTolerance 40`）会从四边
 * 灌进去把墙内部的阴影也吃掉 —— 城墙被啃成一堆碎片。
 * 所以整图只认「**饱和纯绿**」（优势值 ≥ 80 才开始透明、≥ 150 全透明），不分割；
 * 不够绿就原样保留并说明（宁可不抠，也不能把画面啃坏）。
 */
export const STAMP_KEY_OPTIONS = {
    keyLow: 80,
    keyHigh: 150,
    despill: 0.65,
    edgeShrink: 0,
    bgTolerance: 0
};
export function keyStampBackground(frame, keyGreenFn) {
    /**
     * 图已经带透明通道（Seedream 5.5 的透明幕布、或用户自己导的透明 PNG）：
     * 背景已经抠好了。再按「某个颜色」去找背景，既找不到、又可能把同色的角色细节吃掉。
     */
    if (transparentFraction(frame) >= 0.02)
        return { bitmap: frame, keyed: 0, alpha: true };
    if (keyGreenFn === undefined)
        return { bitmap: frame, keyed: 0 };
    const result = keyGreenFn(frame.rgba, frame.width, frame.height);
    const fraction = result.backgroundFraction;
    if (!Number.isFinite(fraction) || fraction < 0.02 || fraction > 0.98)
        return { bitmap: frame, keyed: 0 };
    return { bitmap: { width: frame.width, height: frame.height, rgba: result.rgba }, keyed: fraction };
}
/**
 * **源图 → 成品素材图**：先缩到「一格 = 一格地图格子」，再烘 4 个旋转。
 *
 * 导入（`registerTileset`）与原地重烘（`recomposeMapTileset`）共用这一条口径 ——
 * 少一处不烘，那一处的整图就永远只有一个朝向。
 */
export function stampTilesetImage(source, spec, cell, clarity = "smooth") {
    const cellW = Math.max(1, Math.floor(cell.width));
    const cellH = Math.max(1, Math.floor(cell.height));
    const base = resampleToSize(source, spec.cols * cellW, spec.rows * spec.frames * cellH, clarity);
    return bakeStampSheet(base, spec, { width: cellW, height: cellH }, clarity);
}
/** 整格的位序：北 1 / 东 2 / 南 4 / 西 8。 */
const CORNER_SIDES = { N: 1, E: 2, S: 4, W: 8 };
/**
 * 转角块：把「横着走的砖」和「竖着走的砖」沿一条**斜接线**拼起来，线的两侧各用各的。
 *
 * 这是真砌墙的做法（两块砖在转角处斜着对口），也是用户说的「拐角要有拐角的效果」：
 * 只画一条亮线没用，得让**砖缝真的换向**，否则看起来还是两段直墙交叉。
 *
 * 斜接线 = 两条相连边中点之间的那条线；线靠近「角」的那一小块用竖直方向的砖，
 * 其余用水平方向的砖（四种转角都是一个竖臂 + 一个横臂，所以这个分配是通用的）。
 */
export function joinCorner(horizontal, vertical, sideA, sideB, thickness = 2) {
    const { width, height } = horizontal;
    const rgba = Buffer.alloc(width * height * 4);
    const midA = sideMidpoint(sideA, width, height);
    const midB = sideMidpoint(sideB, width, height);
    // 角那一侧 = 两条边的公共角（N + W → 左上；N + E → 右上；S + E → 右下；S + W → 左下）。
    const cornerX = sideA === "N" || sideA === "S" ? (sideB === "W" ? 0 : width - 1) : sideA === "W" ? 0 : width - 1;
    const cornerY = sideA === "E" || sideA === "W" ? (sideB === "N" ? 0 : height - 1) : sideA === "N" ? 0 : height - 1;
    const line = Math.max(1, Math.round(thickness));
    const span = Math.max(1, Math.hypot(midB.x - midA.x, midB.y - midA.y));
    const towardsCorner = (midB.x - midA.x) * (cornerY - midA.y) - (midB.y - midA.y) * (cornerX - midA.x);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // 叉积的符号就是「在哪一侧」，不用开方也算得出距离。
            const cross = (midB.x - midA.x) * (y - midA.y) - (midB.y - midA.y) * (x - midA.x);
            const cornerSide = Math.sign(cross) === Math.sign(towardsCorner);
            const source = cornerSide ? vertical : horizontal;
            const offset = (y * width + x) * 4;
            rgba[offset] = source.rgba[offset];
            rgba[offset + 1] = source.rgba[offset + 1];
            rgba[offset + 2] = source.rgba[offset + 2];
            rgba[offset + 3] = source.rgba[offset + 3];
            const distance = Math.abs(cross) / span;
            if (distance <= line * 0.5) {
                // 斜接缝本身：提亮一线，读起来是两块砖在这里对口。
                for (let channel = 0; channel < 3; channel++)
                    rgba[offset + channel] = clamp255(Math.round(rgba[offset + channel] * 1.28));
            }
            else if (distance <= line * 2.5) {
                // 缝两侧一点点压暗（渐淡），给拐角一点体积感，不至于像贴纸。
                const factor = 1 - 0.18 * (1 - (distance - line * 0.5) / (line * 2));
                for (let channel = 0; channel < 3; channel++)
                    rgba[offset + channel] = clamp255(Math.round(rgba[offset + channel] * factor));
            }
        }
    }
    return { width, height, rgba };
}
/** 把 `joinCorner` 的结果写回已有的块（省一次分配）。 */
function joinCornerInto(target, horizontal, vertical, sideA, sideB, thickness) {
    const joined = joinCorner(horizontal, vertical, sideA, sideB, thickness);
    joined.rgba.copy(target.rgba);
}
/** 0~255 夹紧。 */
function clamp255(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}
/** 一条边的中点（画斜接用）。 */
function sideMidpoint(side, width, height) {
    if (side === "N")
        return { x: (width - 1) / 2, y: 0 };
    if (side === "S")
        return { x: (width - 1) / 2, y: height - 1 };
    if (side === "W")
        return { x: 0, y: (height - 1) / 2 };
    return { x: width - 1, y: (height - 1) / 2 };
}
export function corner16SheetFromTile(tile, cell, clarity = "sharp") {
    const blockW = Math.max(1, Math.floor(cell.width));
    const blockH = Math.max(1, Math.floor(cell.height));
    const sheet = { width: blockW * CORNER16_BLOCKS, height: blockH * CORNER16_BLOCKS, rgba: Buffer.alloc(blockW * CORNER16_BLOCKS * blockH * CORNER16_BLOCKS * 4) };
    const thickness = capThicknessFor(Math.min(blockW, blockH));
    // 斜接按块大小走：32px 一格约 2px 线，128px（4 倍留图）时约 7px。
    const miterSize = Math.max(1, Math.round(Math.min(blockW, blockH) / 18));
    const base = resampleToSize(tile, blockW, blockH, clarity);
    /**
     * **方向感知**：整格是「墙体」用法（拼块才是「材质」用法），所以砖缝要跟着墙的走向。
     *
     * - 南北直线（N+S，掩码 5）：把砖顺时针转 90° —— 墙竖起来，砖缝也得竖起来；
     * - 转角（N+E / E+S / S+W / W+N）：在两条相连边的中点之间画斜接，拐角才有「转角」的样子；
     * - 其它（直线东西、端头、T 字、十字、孤立）：直接用砖本身。
     *
     * 这一步做在 compose 阶段（16 块烘进素材图），渲染器一行不用改 —— 它照旧按掩码挑块。
     */
    const vertical = rotate90(base, true);
    for (let mask = 0; mask < CORNER16_BLOCKS * CORNER16_BLOCKS; mask++) {
        const block = { width: blockW, height: blockH, rgba: Buffer.from((mask === (CORNER_SIDES.N | CORNER_SIDES.S) ? vertical : base).rgba) };
        // 转角：横竖两版沿斜接线拼起来（真砌墙的转角做法）；收口照旧落在断开的那几边。
        if (mask === (CORNER_SIDES.N | CORNER_SIDES.W))
            joinCornerInto(block, base, vertical, "N", "W", miterSize);
        else if (mask === (CORNER_SIDES.N | CORNER_SIDES.E))
            joinCornerInto(block, base, vertical, "N", "E", miterSize);
        else if (mask === (CORNER_SIDES.E | CORNER_SIDES.S))
            joinCornerInto(block, base, vertical, "E", "S", miterSize);
        else if (mask === (CORNER_SIDES.S | CORNER_SIDES.W))
            joinCornerInto(block, base, vertical, "S", "W", miterSize);
        // 位序 N=1 / E=2 / S=4 / W=8：**没置位**的那几边就是「断」，要收口。
        if ((mask & 1) === 0)
            shadeSide(block, "N", thickness);
        if ((mask & 2) === 0)
            shadeSide(block, "E", thickness);
        if ((mask & 4) === 0)
            shadeSide(block, "S", thickness);
        if ((mask & 8) === 0)
            shadeSide(block, "W", thickness);
        blitInto(block, sheet, (mask % CORNER16_BLOCKS) * blockW, Math.floor(mask / CORNER16_BLOCKS) * blockH);
    }
    return sheet;
}
/**
 * 拼块（`a2quad`）：由**每个变体一块无缝砖**拼出 N 列 × 5 行；每一格的四个小格分别按
 * 「它自己那一侧的接法」加收口。
 *
 * 小格与地图象限的对应（见 `maprender.a2Ops`）：一格的第 (qx, qy) 个小格（qx 左/右、qy 上/下）
 * 就是地图上那一格的对应象限；形状号 s 决定该象限「横向邻居」（left/right）与「纵向邻居」
 * （up/down）接不接：
 *
 * | s | 横向邻居 | 纵向邻居 | 对角 |
 * |---|---|---|---|
 * | 0 | 断 | 断 | — |
 * | 1 | 断 | 连 | — |
 * | 2 | 连 | 断 | — |
 * | 3 | 连 | 连 | 断（凹角） |
 * | 4 | 连 | 连 | 连（满格，什么都不加） |
 *
 * 与整格同理：所有小格都来自**同一块砖**，所以任何两块在「连」的那边拼起来都是砖自己的
 * 边缘 —— 一排草地 / 一片水不会出现「每格各画各的」那种接缝。
 */
export function a2SheetFromTiles(tiles, cell, clarity = "sharp") {
    if (tiles.length === 0)
        throw new Error("没有可整理的帧");
    const blockW = Math.max(1, Math.floor(cell.width));
    const blockH = Math.max(1, Math.floor(cell.height));
    const subW = Math.max(1, Math.round(blockW / 2));
    const subH = Math.max(1, Math.round(blockH / 2));
    const variants = tiles.length;
    const sheet = { width: blockW * variants, height: blockH * A2_ROWS, rgba: Buffer.alloc(blockW * variants * blockH * A2_ROWS * 4) };
    const thickness = capThicknessFor(Math.min(subW, subH));
    for (let variant = 0; variant < variants; variant++) {
        const block = resampleToSize(tiles[variant], blockW, blockH, clarity);
        for (let shape = 0; shape < A2_ROWS; shape++) {
            // 该形状下，「横向邻居」「纵向邻居」接不接（见上面那张表）。
            const sideConnected = shape >= 2;
            const verticalConnected = shape === 1 || shape >= 3;
            for (let qy = 0; qy < 2; qy++) {
                for (let qx = 0; qx < 2; qx++) {
                    const sub = cropTile(block, { x: qx * subW, y: qy * subH, width: subW, height: subH });
                    if (!sideConnected)
                        shadeSide(sub, qx === 0 ? "W" : "E", thickness);
                    if (!verticalConnected)
                        shadeSide(sub, qy === 0 ? "N" : "S", thickness);
                    if (shape === 3)
                        shadeCorner(sub, `${qy === 0 ? "N" : "S"}${qx === 0 ? "W" : "E"}`, thickness);
                    blitInto(sub, sheet, variant * blockW + qx * subW, shape * blockH + qy * subH);
                }
            }
        }
    }
    return sheet;
}
/**
 * 砖自身的**环绕缝**：左右、上下两条对边的平均差，除以块内相邻列 / 行的平均差。
 *
 * 1 左右 = 和自己内部一样平（无缝）；明显大于 1 说明这块砖左右 / 上下接不上自己 ——
 * 平铺出去就会出现可见的缝。宿主把它写进 `notes`，用户 / agent 可以据此重画。
 */
export function tileSeamRatios(tile) {
    const px = (x, y) => {
        const offset = (y * tile.width + x) * 4;
        return [tile.rgba[offset], tile.rgba[offset + 1], tile.rgba[offset + 2], tile.rgba[offset + 3]];
    };
    const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
    let horizontalWrap = 0;
    let verticalWrap = 0;
    for (let y = 0; y < tile.height; y++)
        horizontalWrap += distance(px(0, y), px(tile.width - 1, y));
    for (let x = 0; x < tile.width; x++)
        verticalWrap += distance(px(x, 0), px(x, tile.height - 1));
    horizontalWrap /= tile.height;
    verticalWrap /= tile.width;
    let horizontalInner = 0;
    let verticalInner = 0;
    let innerCount = 0;
    for (let y = 0; y < tile.height; y++) {
        for (let x = 1; x < tile.width; x++) {
            horizontalInner += distance(px(x - 1, y), px(x, y));
            innerCount++;
        }
    }
    horizontalInner = innerCount === 0 ? 0 : horizontalInner / innerCount;
    innerCount = 0;
    for (let x = 0; x < tile.width; x++) {
        for (let y = 1; y < tile.height; y++) {
            verticalInner += distance(px(x, y - 1), px(x, y));
            innerCount++;
        }
    }
    verticalInner = innerCount === 0 ? 0 : verticalInner / innerCount;
    const ratio = (wrap, inner) => (inner <= 0.5 ? 1 : wrap / inner);
    return { horizontal: ratio(horizontalWrap, horizontalInner), vertical: ratio(verticalWrap, verticalInner) };
}
/**
 * 按形态算目标几何。`frames` 对普通是帧数、对拼块是变体数；整格固定 4×4；
 * 整图由 `stamp` 规格决定（帧 × 4 旋转 × 占格）。
 */
export function sheetPlanOf(shape, cell, frames, stamp) {
    if (shape === "stamp") {
        if (stamp === undefined)
            throw new Error("整图缺规格（占几格 / 几帧）");
        // 源图 = `cols × rows*frames`（**不含**旋转烘焙：那是导入端的事）。
        const size = stampSourceCells(stamp);
        return { shape, cell: { width: Math.max(1, Math.floor(cell.width)), height: Math.max(1, Math.floor(cell.height)) }, cols: size.cols, rows: size.rows };
    }
    const width = Math.max(1, Math.floor(cell.width));
    const height = Math.max(1, Math.floor(cell.height));
    const count = Math.max(1, Math.floor(frames) || 1);
    if (shape === "corner16")
        return { shape, cell: { width, height }, cols: CORNER16_BLOCKS, rows: CORNER16_BLOCKS };
    if (shape === "a2quad")
        return { shape, cell: { width, height }, cols: count, rows: A2_ROWS };
    return { shape: "plain", cell: { width, height }, cols: 1, rows: count };
}
/**
 * 按**形态计划**把模型吐出来的那几张图规整成地图编辑器要的几何。
 *
 * 三种形态的输入约定（提示词里逐条讲给模型听，这里是对应的代码）：
 *   · `plain`    每张 = **一帧**（一格内容）→ 每张裁成 `cell`、自上而下堆成一列
 *                （N 帧 = 一列 N 行的翻页图）
 *   · `corner16` 恰好 **1 张** = **一块**无缝墙砖 → `corner16SheetFromTile` 拼出 4×4 = 16 格
 *   · `a2quad`   每张 = **一个变体的一块**无缝材质 → `a2SheetFromTiles` 拼出 N 列 × 5 行
 *                （拼块的动画就是「换变体」，所以帧数 = 变体数）
 *
 * ⚠️ **整格 / 拼块都不能让模型直接画「多格排布」**：模型画出的多格是各自独立的
 * （灯带 / 板纹各自偏几十像素），而地图上相邻的两格往往取自**不同的格子**，于是每一处
 * 交界都是硬缝（实测一条墙的边缘差 201、块内才 58）。所以这两条路都是「模型给一块砖、
 * 代码拼出全部格子」。
 */
export function composeAssetSheet(frames, plan, clarity = "sharp") {
    if (frames.length === 0)
        throw new Error("没有可整理的帧");
    if (plan.shape === "plain")
        return stackFrames(frames, plan.cell, clarity);
    if (plan.shape === "corner16") {
        if (frames.length !== 1) {
            throw new Error(`整格自动连接的素材需要**一块**无缝墙砖（收到 ${frames.length} 张：16 种接法由宿主从这一块拼出来）`);
        }
        return corner16SheetFromTile(frames[0], plan.cell, clarity);
    }
    return a2SheetFromTiles(frames, plan.cell, clarity);
}
/**
 * 素材名字 → 能当文件名的干名。
 *
 * 名字是用户填的（可能带 `/`、换行、超长），要拿去当 `ai/<干名>.png`。这里只做
 * **保守归一**：去掉路径分隔与控制字符、把空白压成一个空格、截 40 字、去掉结尾的
 * 点（Windows 上 `x.` 是非法文件名）；实在空就退回 `ai-asset`。不做拼音 / 转写 ——
 * 中文文件名在 mac / Windows 与资源路由上都正常工作。
 */
export function safeAssetStem(name) {
    const cleaned = String(name ?? "")
        .normalize("NFC")
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 40)
        .replace(/\.+$/u, "")
        .trim();
    return cleaned === "" ? "ai-asset" : cleaned;
}
