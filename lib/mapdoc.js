/**
 * 地图编辑器（模块六）的**文档模型与编辑操作**。
 *
 * 一张地图 = 若干图层，每个图层是一段 `cols × rows` 的数组：
 * `0` 表示空，其余是**全局图块序号**（见 `maptiles.flatTiles`）。
 *
 * ## 三条口径
 *
 * 1. **宿主是唯一写者**：界面不发「整份文档」，只发 op（`applyOps`）。
 *    撤销 = 逆操作日志，因此撤销栈不占内存、也不需要 diff。
 * 2. **派生数据不落盘**：自动过渡的最终贴图、跨格占格、垫底，全在渲染时算
 *    （`maprender.buildPlan`）。旧模块把它们存成 `buildings` / `buildingGround` /
 *    `map.pixel` 三份缓存，各自都出过「过期后凭空多出一栋楼」这类 bug。
 * 3. **操作必须是纯函数**：`applyOps(doc, ops)` 直接改传入的 doc 并返回被改的格子
 *    与逆操作。界面拖动时按 ~60ms 批量提交，宿主应用后回传脏 chunk。
 */
import { assertMapSize } from "./mapgeom.js";
export const MAP_LAYER_KINDS = ["ground", "decor", "object", "overlay"];
export function isMapLayerKind(value) {
    return typeof value === "string" && MAP_LAYER_KINDS.includes(value);
}
export function cellIndex(doc, r, c) {
    return r * doc.cols + c;
}
export function emptyData(cols, rows) {
    return new Array(cols * rows).fill(0);
}
export function defaultLayer(id, kind = "ground") {
    return {
        id,
        name: kind === "ground" ? "地面" : kind === "decor" ? "装饰" : kind === "object" ? "建筑" : "覆盖",
        kind,
        heightOffset: 0,
        opacity: 1,
        visible: true,
        locked: false
    };
}
export function createMapDoc(id, name, cols, rows, options = {}) {
    assertMapSize(cols, rows);
    const layers = options.layers !== undefined && options.layers.length > 0 ? options.layers : [defaultLayer("l0", "ground")];
    const now = new Date().toISOString();
    const data = {};
    for (const layer of layers)
        data[layer.id] = emptyData(cols, rows);
    return {
        id,
        name,
        cols,
        rows,
        variantSeed: Number.isFinite(options.variantSeed) ? Math.round(options.variantSeed) : 20261011,
        randomVariants: true,
        layers,
        data,
        createdAt: now,
        updatedAt: now
    };
}
/** 读盘 / 外部输入 → 合法文档：补缺字段、把图层数据裁齐到 `cols × rows`。 */
export function normalizeMapDoc(raw, fallbackId) {
    if (raw === null || typeof raw !== "object")
        return undefined;
    const input = raw;
    const cols = Math.max(1, Math.min(512, Math.round(Number(input.cols) || 32)));
    const rows = Math.max(1, Math.min(512, Math.round(Number(input.rows) || 32)));
    const layers = Array.isArray(input.layers) && input.layers.length > 0
        ? input.layers.map((layer, index) => ({
            id: typeof layer?.id === "string" && layer.id !== "" ? layer.id : `l${index}`,
            name: typeof layer?.name === "string" && layer.name !== "" ? layer.name : `图层 ${index + 1}`,
            kind: isMapLayerKind(layer?.kind) ? layer.kind : "ground",
            heightOffset: Number.isFinite(Number(layer?.heightOffset)) ? Number(layer.heightOffset) : 0,
            opacity: Number.isFinite(Number(layer?.opacity)) ? Math.min(1, Math.max(0, Number(layer.opacity))) : 1,
            visible: layer?.visible !== false,
            locked: layer?.locked === true,
            baseFamilyId: typeof layer?.baseFamilyId === "string" && layer.baseFamilyId !== "" ? layer.baseFamilyId : undefined
        }))
        : [defaultLayer("l0", "ground")];
    const data = {};
    for (const layer of layers) {
        const source = Array.isArray(input.data?.[layer.id]) ? input.data[layer.id] : [];
        const target = emptyData(cols, rows);
        for (let i = 0; i < target.length; i++) {
            const value = Number(source[i]);
            target[i] = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
        }
        data[layer.id] = target;
    }
    const now = new Date().toISOString();
    return {
        id: typeof input.id === "string" && input.id !== "" ? input.id : fallbackId,
        name: typeof input.name === "string" && input.name !== "" ? input.name : "未命名地图",
        cols,
        rows,
        variantSeed: Number.isFinite(Number(input.variantSeed)) ? Math.round(Number(input.variantSeed)) : 20261011,
        randomVariants: input.randomVariants !== false,
        layers,
        data,
        createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
        updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now
    };
}
export function cloneDoc(doc) {
    return {
        ...doc,
        layers: doc.layers.map((layer) => ({ ...layer })),
        data: Object.fromEntries(Object.entries(doc.data).map(([key, value]) => [key, [...value]]))
    };
}
// ── 结构操作（图层 / 尺寸）────────────────────────────────────────────────
export function nextLayerId(doc) {
    let index = doc.layers.length;
    while (doc.layers.some((layer) => layer.id === `l${index}`))
        index++;
    return `l${index}`;
}
export function addLayer(doc, kind = "ground", name) {
    const layer = defaultLayer(nextLayerId(doc), kind);
    if (name !== undefined && name !== "")
        layer.name = name;
    doc.layers.push(layer);
    doc.data[layer.id] = emptyData(doc.cols, doc.rows);
    doc.updatedAt = new Date().toISOString();
    return layer;
}
export function removeLayer(doc, layerId) {
    if (doc.layers.length <= 1)
        return false;
    const index = doc.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0)
        return false;
    doc.layers.splice(index, 1);
    delete doc.data[layerId];
    doc.updatedAt = new Date().toISOString();
    return true;
}
export function moveLayer(doc, layerId, toIndex) {
    const index = doc.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0)
        return false;
    const target = Math.min(doc.layers.length - 1, Math.max(0, Math.round(toIndex)));
    if (target === index)
        return false;
    const [layer] = doc.layers.splice(index, 1);
    doc.layers.splice(target, 0, layer);
    doc.updatedAt = new Date().toISOString();
    return true;
}
/**
 * 改地图尺寸（左上角对齐）。缩小时被丢掉的格子**写进日志**，且可撤销
 * （调用方在改之前存一份快照）。
 */
export function resizeDoc(doc, cols, rows) {
    assertMapSize(cols, rows);
    if (cols === doc.cols && rows === doc.rows)
        return { dropped: 0 };
    let dropped = 0;
    for (const layer of doc.layers) {
        const source = doc.data[layer.id] ?? emptyData(doc.cols, doc.rows);
        const target = emptyData(cols, rows);
        const copyCols = Math.min(cols, doc.cols);
        const copyRows = Math.min(rows, doc.rows);
        for (let r = 0; r < copyRows; r++) {
            for (let c = 0; c < copyCols; c++)
                target[r * cols + c] = source[r * doc.cols + c];
        }
        for (let r = 0; r < doc.rows; r++) {
            for (let c = 0; c < doc.cols; c++) {
                if (r < copyRows && c < copyCols)
                    continue;
                if (source[r * doc.cols + c] > 0)
                    dropped++;
            }
        }
        doc.data[layer.id] = target;
    }
    doc.cols = cols;
    doc.rows = rows;
    doc.updatedAt = new Date().toISOString();
    return { dropped };
}
function layerDataOrThrow(doc, layerId) {
    const data = doc.data[layerId];
    if (data === undefined)
        throw new Error(`图层不存在：${layerId}`);
    return data;
}
function isLocked(doc, layerId) {
    const layer = doc.layers.find((item) => item.id === layerId);
    return layer === undefined ? true : layer.locked;
}
/** 画一条线（Bresenham）：拖动时两点之间的格子不能漏（漏了就是「虚线」）。 */
export function lineCells(r0, c0, r1, c1) {
    const out = [];
    let r = Math.round(r0);
    let c = Math.round(c0);
    const rEnd = Math.round(r1);
    const cEnd = Math.round(c1);
    const dr = Math.abs(rEnd - r);
    const dc = Math.abs(cEnd - c);
    const sr = r < rEnd ? 1 : -1;
    const sc = c < cEnd ? 1 : -1;
    let err = dr - dc;
    for (;;) {
        out.push({ r, c });
        if (r === rEnd && c === cEnd)
            break;
        const e2 = 2 * err;
        if (e2 > -dc) {
            err -= dc;
            r += sr;
        }
        if (e2 < dr) {
            err += dr;
            c += sc;
        }
        if (out.length > 1_000_000)
            break;
    }
    return out;
}
/**
 * 应用一批 op。
 *
 * 不会抛「某个格子越界」这种错：拖动时指针滑出地图是常事，越界条目记进
 * `skipped` 由界面提示。锁定图层整批跳过（同样记进 `skipped`）。
 */
export function applyOps(doc, ops) {
    const changed = new Set();
    const undo = [];
    const skipped = [];
    const paintValue = (layerId, cells) => {
        const data = layerDataOrThrow(doc, layerId);
        const before = [];
        for (const cell of cells) {
            const r = Math.round(cell.r);
            const c = Math.round(cell.c);
            if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= doc.rows || c >= doc.cols) {
                skipped.push(`越界格 (${cell.r},${cell.c})`);
                continue;
            }
            const index = r * doc.cols + c;
            const tile = Number.isFinite(cell.tile) && cell.tile > 0 ? Math.round(cell.tile) : 0;
            const previous = data[index];
            if (previous === tile)
                continue;
            before.push({ r, c, tile: previous });
            data[index] = tile;
            changed.add(index);
        }
        return before;
    };
    for (const raw of ops) {
        const op = raw;
        if (op === null || typeof op !== "object" || typeof op.kind !== "string") {
            skipped.push("认不出的 op");
            continue;
        }
        if (typeof op.layerId !== "string" || doc.data[op.layerId] === undefined) {
            skipped.push(`图层不存在：${String(op.layerId)}`);
            continue;
        }
        if (isLocked(doc, op.layerId)) {
            skipped.push(`图层已锁定：${op.layerId}`);
            continue;
        }
        if (op.kind === "paint") {
            if (!Array.isArray(op.cells)) {
                skipped.push("paint 缺 cells");
                continue;
            }
            const before = paintValue(op.layerId, op.cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else if (op.kind === "fill") {
            const data = layerDataOrThrow(doc, op.layerId);
            const r = Math.round(op.r);
            const c = Math.round(op.c);
            if (r < 0 || c < 0 || r >= doc.rows || c >= doc.cols) {
                skipped.push(`fill 起点越界 (${op.r},${op.c})`);
                continue;
            }
            const tile = Number.isFinite(op.tile) && op.tile > 0 ? Math.round(op.tile) : 0;
            const target = data[r * doc.cols + c];
            if (target === tile)
                continue;
            const cells = [];
            const stack = [[r, c]];
            const seen = new Set();
            while (stack.length > 0) {
                const [cr, cc] = stack.pop();
                if (cr < 0 || cc < 0 || cr >= doc.rows || cc >= doc.cols)
                    continue;
                const index = cr * doc.cols + cc;
                if (seen.has(index))
                    continue;
                if (data[index] !== target)
                    continue;
                seen.add(index);
                cells.push({ r: cr, c: cc, tile });
                stack.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
            }
            const before = paintValue(op.layerId, cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else if (op.kind === "rect") {
            const r0 = Math.min(Math.round(op.r0), Math.round(op.r1));
            const r1 = Math.max(Math.round(op.r0), Math.round(op.r1));
            const c0 = Math.min(Math.round(op.c0), Math.round(op.c1));
            const c1 = Math.max(Math.round(op.c0), Math.round(op.c1));
            const tile = Number.isFinite(op.tile) && op.tile > 0 ? Math.round(op.tile) : 0;
            const cells = [];
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    const onEdge = r === r0 || r === r1 || c === c0 || c === c1;
                    if (!onEdge && op.filled !== false)
                        cells.push({ r, c, tile });
                    else if (onEdge)
                        cells.push({ r, c, tile });
                }
            }
            const before = paintValue(op.layerId, cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else if (op.kind === "replace") {
            const data = layerDataOrThrow(doc, op.layerId);
            const from = Math.round(op.from);
            const to = Number.isFinite(op.to) && op.to > 0 ? Math.round(op.to) : 0;
            const cells = [];
            for (let index = 0; index < data.length; index++) {
                if (data[index] !== from)
                    continue;
                cells.push({ r: Math.floor(index / doc.cols), c: index % doc.cols, tile: to });
            }
            const before = paintValue(op.layerId, cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else {
            skipped.push(`不支持的 op：${String(op.kind)}`);
        }
    }
    if (changed.size > 0)
        doc.updatedAt = new Date().toISOString();
    return { changed: [...changed].sort((a, b) => a - b), undo: undo.reverse(), skipped };
}
/** 撤销：把逆操作原样应用（它本身也是 op）。 */
export function revertOps(doc, undo) {
    return applyOps(doc, undo).changed;
}
/** 用到的图块序号（删图集 / 改切分前查引用）。 */
export function usedTileIndices(doc) {
    const out = new Set();
    for (const layer of doc.layers) {
        for (const value of doc.data[layer.id] ?? []) {
            if (value > 0)
                out.add(value);
        }
    }
    return out;
}
export function filledCount(doc, layerId) {
    let n = 0;
    for (const layer of doc.layers) {
        if (layerId !== undefined && layer.id !== layerId)
            continue;
        for (const value of doc.data[layer.id] ?? [])
            if (value > 0)
                n++;
    }
    return n;
}
export function isDocEmpty(doc) {
    return filledCount(doc) === 0;
}
/** 把越界 / 不存在的图块序号收拢：返回被清掉的格子数（切分变了之后要调用）。 */
export function pruneTileIndices(doc, maxIndex) {
    let pruned = 0;
    for (const layer of doc.layers) {
        const data = doc.data[layer.id];
        if (data === undefined)
            continue;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > maxIndex) {
                data[i] = 0;
                pruned++;
            }
        }
    }
    return pruned;
}
