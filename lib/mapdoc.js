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
 * 2. **派生数据不落盘**：A2 的象限形状、动画帧、脏 chunk 全在渲染 / 应用时算
 *    （`maprender.buildPlan` / `mapgeom.dirtyChunksFor`）。旧模块把「自动过渡的
 *    最终贴图、跨格占格、垫底」存成三份缓存，各自都出过「过期后凭空多出一栋楼」。
 * 3. **操作必须是纯函数**：`applyOps(doc, ops, layout)` 直接改传入的 doc 并返回被
 *    改的格子与逆操作。界面拖动时按 ~60ms 批量提交，宿主应用后回传脏 chunk。
 *
 * ## 图层为什么瘦成 `{ id, name }`
 *
 * 旧模型的 `kind` / `heightOffset` / `opacity` / `visible` / `locked` / `baseFamilyId`
 * 全部删掉：前四个只在界面与导出之间制造「两边口径不同」的空间（层高偏移与层不透明度
 * 各出过「预览 ≠ 导出」），`baseFamilyId` 是族体系的遗留，`locked` 则是一个纯界面状态
 * 却写在文档里、还会让 op 静默整批跳过。AsLib 的做法就是「只有名字的叠放顺序」。
 */
import { DEFAULT_GRID, MAX_MAP_DIM, assertMapSize, layoutOf, wrapCell } from "./mapgeom.js";
/** 整图旋转后占几格（顺时针 90° 的长宽互换）—— 与 `maptiles.stampSpan` 同一口径。 */
/**
 * 旋转档数归一成 0..3 的整数。
 *
 * 缺省 / NaN / null / 负数都要能兜住：`stampPlace` 不带 `rot` 时是 `NaN`，
 * 直接写进文档会被 JSON 序列化成 `null`，下次打开整图就「素材不见了」。
 * 写入、读取、撤销三处都走这一个函数，避免再出现「同一份数据两种表现」。
 */
function stampRotValue(rot) {
    const turn = Math.round(Number(rot));
    return Number.isFinite(turn) ? ((turn % 4) + 4) % 4 : 0;
}
function stampSpanOf(spec, rot) {
    const turn = ((Math.round(rot) % 4) + 4) % 4;
    return turn % 2 === 1 ? { cols: spec.rows, rows: spec.cols } : { cols: spec.cols, rows: spec.rows };
}
export function cellIndex(doc, r, c) {
    return r * doc.cols + c;
}
export function emptyData(cols, rows) {
    return new Array(cols * rows).fill(0);
}
/** 默认图层。名字缺省时只给一个中性名 —— 具体名字由调用方（`createMapDoc` / `addLayer`）给。 */
export function defaultLayer(id, name) {
    return { id, name: typeof name === "string" && name !== "" ? name : "图层" };
}
/**
 * 默认三层：地理层 / 装饰层 / 建筑层。
 *
 * 名字**中文硬编码** —— 宿主侧没有 i18n 通道（界面显示宿主给的名字，用户随时能改）。
 * 「标记层」不在这个数组里：它装的是带名字的标记（见 `MapMarker`），不是图块序号，
 * 在图层卡里是一行固定入口。
 */
function defaultLayers() {
    return [defaultLayer("l0", "地理层"), defaultLayer("l1", "装饰层"), defaultLayer("l2", "建筑层")];
}
export function createMapDoc(id, name, cols, rows) {
    assertMapSize(cols, rows);
    const now = new Date().toISOString();
    const layers = defaultLayers();
    const data = {};
    for (const layer of layers)
        data[layer.id] = emptyData(cols, rows);
    return { id, name, cols, rows, layers, data, markers: [], stamps: [], createdAt: now, updatedAt: now };
}
/** 读盘 / 外部输入 → 合法文档：补缺字段、把图层数据裁齐到 `cols × rows`。 */
export function normalizeMapDoc(raw, fallbackId) {
    if (raw === null || typeof raw !== "object")
        return undefined;
    const input = raw;
    const cols = Math.max(1, Math.min(MAX_MAP_DIM, Math.round(Number(input.cols) || 32)));
    const rows = Math.max(1, Math.min(MAX_MAP_DIM, Math.round(Number(input.rows) || 32)));
    const rawLayers = Array.isArray(input.layers) ? input.layers : [];
    // id 重复会让两层共用同一段数据（改一层等于同时改两层，且不报错）—— 这里必须去重。
    const used = new Set();
    const layers = [];
    for (const [index, item] of rawLayers.entries()) {
        const layer = item;
        const id = typeof layer?.id === "string" && layer.id !== "" ? layer.id : `l${index}`;
        const name = typeof layer?.name === "string" && layer.name !== "" ? layer.name : `图层 ${index + 1}`;
        let unique = id;
        if (used.has(unique)) {
            let bump = 0;
            while (used.has(`l${bump}`))
                bump++;
            unique = `l${bump}`;
        }
        used.add(unique);
        layers.push({ id: unique, name });
    }
    if (layers.length === 0)
        layers.push(...defaultLayers());
    /**
     * 老文档升级：**只动从来没被改过名的出厂两层**。
     *
     * 判据是「正好两层，且名字就是出厂名 `图层 1` / `图层 2`」—— 用户自己改过名的文档
     * 一个字都不动（猜错了语义比不改更坏）。幂等：升级完名字已经不是出厂名，
     * 下次读不会再来一遍。
     */
    if (layers.length === 2 && layers[0].name === "图层 1" && layers[1].name === "图层 2") {
        layers[0].name = "地理层";
        layers[1].name = "装饰层";
        let extra = 0;
        while (used.has(`l${extra}`))
            extra++;
        layers.push({ id: `l${extra}`, name: "建筑层" });
    }
    const layersData = (input.data ?? {});
    const data = {};
    for (const layer of layers) {
        const source = layersData[layer.id];
        const target = emptyData(cols, rows);
        if (Array.isArray(source)) {
            for (let i = 0; i < target.length; i++) {
                const value = Number(source[i]);
                target[i] = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
            }
        }
        data[layer.id] = target;
    }
    const now = new Date().toISOString();
    return {
        id: typeof input.id === "string" && input.id !== "" ? input.id : fallbackId,
        name: typeof input.name === "string" && input.name !== "" ? input.name : "未命名地图",
        cols,
        rows,
        layers,
        data,
        markers: normalizeMarkers(input.markers, cols, rows),
        stamps: normalizeStamps(input.stamps, cols, rows),
        createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
        updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now
    };
}
/**
 * 读盘 / 外部输入 → 合法标记表。
 *
 * - 缺字段（老文档）→ 空表，不抛；
 * - **越界的丢掉**（地图被改小过）：留着的话标记会画在地图外面，而导出 `map.json`
 *   里的坐标又对不上号；
 * - id 缺失或重复一律重新分配，否则两个标记共用一个 id，op 会改错那一个。
 */
function normalizeMarkers(raw, cols, rows) {
    if (!Array.isArray(raw))
        return [];
    const used = new Set();
    const out = [];
    let seq = 0;
    const nextId = () => {
        seq++;
        while (used.has(`m${seq}`))
            seq++;
        return `m${seq}`;
    };
    for (const item of raw) {
        const marker = item;
        const r = Math.round(Number(marker?.r));
        const c = Math.round(Number(marker?.c));
        if (!Number.isFinite(r) || !Number.isFinite(c))
            continue;
        if (r < 0 || c < 0 || r >= rows || c >= cols)
            continue;
        const given = typeof marker?.id === "string" && marker.id !== "" ? marker.id : "";
        const id = given !== "" && !used.has(given) ? given : nextId();
        used.add(id);
        const kind = typeof marker?.kind === "string" && marker.kind.trim() !== "" ? marker.kind.trim() : undefined;
        const color = typeof marker?.color === "string" && /^#[0-9a-f]{6}$/i.test(marker.color.trim()) ? marker.color.trim() : undefined;
        const note = typeof marker?.note === "string" && marker.note !== "" ? marker.note : undefined;
        const tags = Array.isArray(marker?.tags) ? marker.tags.filter((tag) => typeof tag === "string" && tag !== "") : undefined;
        out.push({
            id,
            r,
            c,
            name: typeof marker?.name === "string" ? marker.name : "",
            ...(kind === undefined ? {} : { kind }),
            ...(color === undefined ? {} : { color }),
            ...(note === undefined ? {} : { note }),
            ...(tags === undefined || tags.length === 0 ? {} : { tags })
        });
    }
    return out;
}
/**
 * 读盘 / 外部输入 → 合法整图表。
 *
 * - 缺字段（老文档 @3）→ 空表，不抛；
 * - **越界的丢掉**（地图被改小过）：留着的话它有一半格子在地图外面，导出坐标也对不上；
 * - 引用了不存在的素材 / 图层 → 也丢掉（素材被删过）——这一步在 `mapgen` 拿到 project 之后
 *   还会再核一次（`pruneStamps`），这里只保证结构与坐标合法。
 */
function normalizeStamps(raw, cols, rows) {
    if (!Array.isArray(raw))
        return [];
    const used = new Set();
    const out = [];
    let seq = 0;
    const nextId = () => {
        seq++;
        while (used.has(`s${seq}`))
            seq++;
        return `s${seq}`;
    };
    for (const item of raw) {
        const entry = item;
        const r = Math.round(Number(entry?.r));
        const c = Math.round(Number(entry?.c));
        const rot = Math.round(Number(entry?.rot));
        if (!Number.isFinite(r) || !Number.isFinite(c))
            continue;
        if (r < 0 || c < 0 || r >= rows || c >= cols)
            continue;
        const tilesetId = typeof entry?.tilesetId === "string" ? entry.tilesetId : "";
        const layerId = typeof entry?.layerId === "string" ? entry.layerId : "";
        if (tilesetId === "" || layerId === "")
            continue;
        const given = typeof entry?.id === "string" && entry.id !== "" ? entry.id : "";
        const id = given !== "" && !used.has(given) ? given : nextId();
        used.add(id);
        out.push({ id, tilesetId, layerId, r, c, rot: stampRotValue(rot) });
    }
    return out;
}
export function cloneDoc(doc) {
    const data = {};
    for (const [key, value] of Object.entries(doc.data))
        data[key] = [...value];
    return {
        ...doc,
        layers: doc.layers.map((layer) => ({ ...layer })),
        stamps: doc.stamps.map((stamp) => ({ ...stamp })),
        data,
        markers: doc.markers.map((marker) => ({ ...marker }))
    };
}
// ── 结构操作（图层 / 尺寸）────────────────────────────────────────────────
export function nextLayerId(doc) {
    let index = doc.layers.length;
    while (doc.layers.some((layer) => layer.id === `l${index}`))
        index++;
    return `l${index}`;
}
export function addLayer(doc, name) {
    const layer = defaultLayer(nextLayerId(doc), name !== undefined && name !== "" ? name : `图层 ${doc.layers.length + 1}`);
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
/** 改名。空名字**明确拒绝**（返回 false），不静默换成「图层」。 */
export function renameLayer(doc, layerId, name) {
    const layer = doc.layers.find((item) => item.id === layerId);
    if (layer === undefined)
        return false;
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed === "")
        return false;
    if (layer.name === trimmed)
        return false;
    layer.name = trimmed;
    doc.updatedAt = new Date().toISOString();
    return true;
}
/** 清空一层，返回**清掉的格子数**（已经是空的就返回 0，不改 `updatedAt`）。 */
export function clearLayer(doc, layerId) {
    const data = doc.data[layerId];
    if (data === undefined)
        return 0;
    let cleared = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) {
            data[i] = 0;
            cleared++;
        }
    }
    if (cleared > 0)
        doc.updatedAt = new Date().toISOString();
    return cleared;
}
/**
 * 改地图尺寸（左上角对齐）。缩小时被丢掉的格子**计数返回**，且可撤销
 * （调用方在改之前存一份快照）。标记同样按新边界裁剪 —— 留在界外的标记既画不出来，
 * 导出里的坐标也是错的，所以**必须一起丢**，并把条数报给调用方。
 */
export function resizeDoc(doc, cols, rows) {
    assertMapSize(cols, rows);
    if (cols === doc.cols && rows === doc.rows)
        return { dropped: 0, droppedMarkers: 0 };
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
    const kept = doc.markers.filter((marker) => marker.r < rows && marker.c < cols);
    const droppedMarkers = doc.markers.length - kept.length;
    doc.markers = kept;
    doc.updatedAt = new Date().toISOString();
    return { dropped, droppedMarkers };
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
/** 图块序号收口：非正数与 NaN 一律当「清空」（0），小数取整。 */
function tileValue(input) {
    const value = Number(input);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
export function applyOps(doc, ops, layout, options = {}) {
    const changed = new Set();
    const dirty = new Map();
    const undo = [];
    const skipped = [];
    /** 有不占格的改动（标记改名）。它不进 `changed`，但文档真的变了。 */
    let touched = false;
    /** 动到的整图张数（新增 + 删除）。 */
    let stampsTouched = 0;
    const canonical = (r, c) => {
        if (!Number.isInteger(r) || !Number.isInteger(c))
            return undefined;
        // 不环绕时 `wrapCell` 原样返回，下面的范围判断就是唯一的拦截。
        const wrapped = wrapCell(layout, r, c);
        if (wrapped.r < 0 || wrapped.c < 0 || wrapped.r >= doc.rows || wrapped.c >= doc.cols)
            return undefined;
        return wrapped;
    };
    const paintValue = (layerId, cells) => {
        const data = doc.data[layerId];
        const before = [];
        for (const cell of cells) {
            // 单元格本身不成形（null / 数字）时 `cell.r` 会直接抛 —— 校验层的承诺是「不抛」。
            if (cell === null || typeof cell !== "object") {
                skipped.push("认不出的 op");
                continue;
            }
            const target = canonical(cell.r, cell.c);
            if (target === undefined) {
                skipped.push(`越界格 (${cell.r},${cell.c})`);
                continue;
            }
            const index = target.r * doc.cols + target.c;
            const tile = tileValue(cell.tile);
            const previous = data[index];
            if (previous === tile)
                continue;
            before.push({ r: target.r, c: target.c, tile: previous });
            data[index] = tile;
            changed.add(index);
            dirty.set(index, target);
        }
        return before;
    };
    /** 标记 op 用的两个小工具：标脏一格 / 从第 N 个标记起全部标脏。 */
    const markCell = (r, c) => {
        const index = r * doc.cols + c;
        changed.add(index);
        dirty.set(index, { r, c });
    };
    const markNumberingFrom = (from) => {
        for (let i = Math.max(0, from); i < doc.markers.length; i++) {
            const marker = doc.markers[i];
            markCell(marker.r, marker.c);
        }
    };
    /** 整图占的格子（规范坐标的索引）。规格缺失时返回空表 —— 那张素材多半被删了。 */
    const stampCellIndices = (stamp) => {
        const spec = options.stampSpecOf?.(stamp.tilesetId);
        if (spec === undefined)
            return [];
        const span = stampSpanOf(spec, stamp.rot);
        const out = [];
        for (let dr = 0; dr < span.rows; dr++) {
            for (let dc = 0; dc < span.cols; dc++) {
                const cell = canonical(stamp.r + dr, stamp.c + dc);
                if (cell === undefined)
                    continue;
                out.push(cell.r * doc.cols + cell.c);
            }
        }
        return out;
    };
    /** 一张整图放在目标位置时占的格子；越界 / 规格缺失返回 undefined。 */
    const stampTargetCells = (spec, r, c, rot) => {
        const span = stampSpanOf(spec, rot);
        if (span.cols > doc.cols || span.rows > doc.rows)
            return undefined;
        const out = [];
        for (let dr = 0; dr < span.rows; dr++) {
            for (let dc = 0; dc < span.cols; dc++) {
                const cell = canonical(r + dr, c + dc);
                if (cell === undefined)
                    return undefined;
                out.push(cell.r * doc.cols + cell.c);
            }
        }
        return out;
    };
    /** 目标格是否被另一张整图占着（移动 / 旋转不能静默顶掉别的图）。 */
    const stampOccupiedByOther = (targetCells, selfId, layerId) => {
        for (const stamp of doc.stamps) {
            if (stamp.id === selfId || stamp.layerId !== layerId)
                continue;
            const cells = stampCellIndices(stamp);
            if (cells.some((index) => targetCells.includes(index)))
                return true;
        }
        return false;
    };
    /**
     * 落笔前把压在这些格子上的整图摘掉（同一图层）。
     *
     * 为什么连「值没变」也要摘：橡皮擦一格时那一格的图块值本来就是 0，`paintValue` 里
     * `previous === tile` 会直接跳过 —— 不在这里先摘的话，用户对着雕像按橡皮什么都不发生。
     */
    const dropStampsAt = (layerId, indices) => {
        const dropped = [];
        if (doc.stamps.length === 0 || indices.size === 0)
            return dropped;
        for (let i = doc.stamps.length - 1; i >= 0; i--) {
            const stamp = doc.stamps[i];
            if (stamp.layerId !== layerId)
                continue;
            const cells = stampCellIndices(stamp);
            if (!cells.some((index) => indices.has(index)))
                continue;
            doc.stamps.splice(i, 1);
            dropped.push(stamp.id);
            undo.push({ kind: "stampPlace", layerId: stamp.layerId, tilesetId: stamp.tilesetId, r: stamp.r, c: stamp.c, rot: stamp.rot, id: stamp.id });
            for (const index of cells)
                markCell(Math.floor(index / doc.cols), index % doc.cols);
            stampsTouched++;
        }
        return dropped;
    };
    for (const raw of ops) {
        const op = raw;
        if (op === null || typeof op !== "object" || typeof op.kind !== "string") {
            skipped.push("认不出的 op");
            continue;
        }
        if (op.kind === "marker") {
            touched = applyMarkerOp(doc, op, { canonical, markCell, markNumberingFrom }, skipped, undo) || touched;
            continue;
        }
        if (op.kind === "stampRemove") {
            const at = typeof op.id === "string" ? doc.stamps.findIndex((stamp) => stamp.id === op.id) : -1;
            if (at < 0) {
                skipped.push(`没有这张整图：${String(op.id)}`);
                continue;
            }
            const stamp = doc.stamps[at];
            const cells = stampCellIndices(stamp);
            doc.stamps.splice(at, 1);
            undo.push({ kind: "stampPlace", layerId: stamp.layerId, tilesetId: stamp.tilesetId, r: stamp.r, c: stamp.c, rot: stamp.rot, id: stamp.id });
            for (const index of cells)
                markCell(Math.floor(index / doc.cols), index % doc.cols);
            stampsTouched++;
            continue;
        }
        if (op.kind === "stampMove" || op.kind === "stampRotate") {
            const stamp = doc.stamps.find((entry) => entry.id === op.id);
            if (stamp === undefined) {
                skipped.push(`没有这张整图：${String(op.id)}`);
                continue;
            }
            const spec = options.stampSpecOf?.(stamp.tilesetId);
            if (spec === undefined) {
                skipped.push(`整图素材不存在或不是整图：${stamp.tilesetId}`);
                continue;
            }
            const targetR = op.kind === "stampMove" ? Math.round(Number(op.r)) : stamp.r;
            const targetC = op.kind === "stampMove" ? Math.round(Number(op.c)) : stamp.c;
            const targetRot = op.kind === "stampRotate" ? ((Math.round(Number(op.rot)) % 4) + 4) % 4 : stamp.rot;
            if (targetR === stamp.r && targetC === stamp.c && targetRot === stamp.rot)
                continue;
            const targetCells = stampTargetCells(spec, targetR, targetC, targetRot);
            if (targetCells === undefined) {
                skipped.push("整图放不下（目标位置越界或比地图还大）");
                continue;
            }
            if (stampOccupiedByOther(targetCells, stamp.id, stamp.layerId)) {
                skipped.push(`目标位置已经被另一张整图占着：${stamp.id}`);
                continue;
            }
            const oldCells = stampCellIndices(stamp);
            for (const index of oldCells)
                markCell(Math.floor(index / doc.cols), index % doc.cols);
            const before = { r: stamp.r, c: stamp.c, rot: stamp.rot };
            stamp.r = targetR;
            stamp.c = targetC;
            stamp.rot = targetRot;
            for (const index of targetCells)
                markCell(Math.floor(index / doc.cols), index % doc.cols);
            undo.push(op.kind === "stampMove"
                ? { kind: "stampMove", id: stamp.id, r: before.r, c: before.c }
                : { kind: "stampRotate", id: stamp.id, rot: before.rot });
            stampsTouched++;
            continue;
        }
        if (op.kind === "stampPlace") {
            if (typeof op.layerId !== "string" || doc.data[op.layerId] === undefined) {
                skipped.push(`图层不存在：${String(op.layerId)}`);
                continue;
            }
            const spec = options.stampSpecOf?.(String(op.tilesetId));
            if (spec === undefined) {
                skipped.push(`整图素材不存在或不是整图：${String(op.tilesetId)}`);
                continue;
            }
            const start = canonical(op.r, op.c);
            if (start === undefined) {
                skipped.push(`越界格 (${op.r},${op.c})`);
                continue;
            }
            const span = stampSpanOf(spec, op.rot);
            if (span.cols > doc.cols || span.rows > doc.rows) {
                skipped.push(`整图 ${span.cols}×${span.rows} 格比地图还大`);
                continue;
            }
            // 整图的每一格都得落在地图内（不环绕时 wrapCell 会原样返回，这里逐格核）。
            const cells = [];
            let outside = false;
            for (let dr = 0; dr < span.rows && !outside; dr++) {
                for (let dc = 0; dc < span.cols && !outside; dc++) {
                    const cell = canonical(start.r + dr, start.c + dc);
                    if (cell === undefined)
                        outside = true;
                    else
                        cells.push(cell.r * doc.cols + cell.c);
                }
            }
            if (outside) {
                skipped.push(`整图放不下（参考点 ${start.r},${start.c} 处会越界）`);
                continue;
            }
            // 同层已有整图压在这些格子上：替换掉（与「后画的在上」一致）。
            // 但**必须说出来**：整图之间常常「角落轻微重叠」（北墙 0–10 行 × 西墙 3–50 行），
            // 静默顶掉的话，Agent 摆 10 张、实际只落 6 张，dryRun 还报 10 —— 排查起来毫无线索。
            const replaced = dropStampsAt(op.layerId, new Set(cells));
            if (replaced.length > 0) {
                skipped.push(`同层整图被覆盖（图层 ${op.layerId}，新图与 ${replaced.join("、")} 有格子重叠）：` +
                    "想让它们共存就把墙/家具分到不同图层，或让占格不重叠");
            }
            const used = new Set(doc.stamps.map((stamp) => stamp.id));
            let id = typeof op.id === "string" && op.id !== "" ? op.id : "";
            if (id === "" || used.has(id)) {
                let seq = doc.stamps.length + 1;
                while (used.has(`s${seq}`))
                    seq++;
                id = `s${seq}`;
            }
            doc.stamps.push({ id, tilesetId: String(op.tilesetId), layerId: op.layerId, r: start.r, c: start.c, rot: stampRotValue(op.rot) });
            undo.push({ kind: "stampRemove", id });
            for (const index of cells)
                markCell(Math.floor(index / doc.cols), index % doc.cols);
            stampsTouched++;
            continue;
        }
        if (typeof op.layerId !== "string" || doc.data[op.layerId] === undefined) {
            skipped.push(`图层不存在：${String(op.layerId)}`);
            continue;
        }
        if (op.kind === "paint") {
            if (!Array.isArray(op.cells)) {
                skipped.push("paint 缺 cells");
                continue;
            }
            dropStampsAt(op.layerId, new Set(op.cells.map((cell) => {
                const target = cell === null || typeof cell !== "object" ? undefined : canonical(cell.r, cell.c);
                return target === undefined ? -1 : target.r * doc.cols + target.c;
            }).filter((index) => index >= 0)));
            const before = paintValue(op.layerId, op.cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else if (op.kind === "fill") {
            const start = canonical(op.r, op.c);
            if (start === undefined) {
                skipped.push(`越界格 (${op.r},${op.c})`);
                continue;
            }
            const data = doc.data[op.layerId];
            const tile = tileValue(op.tile);
            const target = data[cellIndex(doc, start.r, start.c)];
            if (target === tile)
                continue;
            // 洪水填充**不跨环绕接缝**（AsLib 同款）：在 0..cols / 0..rows 平面上做，
            // 越界邻居直接停。跨接缝填会把整张图一圈一圈填满，而且没人能预期到。
            const cells = [];
            const seen = new Set();
            const stack = [start];
            while (stack.length > 0) {
                const cell = stack.pop();
                if (cell.r < 0 || cell.c < 0 || cell.r >= doc.rows || cell.c >= doc.cols)
                    continue;
                const index = cell.r * doc.cols + cell.c;
                if (seen.has(index))
                    continue;
                if (data[index] !== target)
                    continue;
                seen.add(index);
                cells.push({ r: cell.r, c: cell.c, tile });
                stack.push({ r: cell.r + 1, c: cell.c }, { r: cell.r - 1, c: cell.c }, { r: cell.r, c: cell.c + 1 }, { r: cell.r, c: cell.c - 1 });
            }
            dropStampsAt(op.layerId, new Set(cells.map((cell) => {
                const target = canonical(cell.r, cell.c);
                return target === undefined ? -1 : target.r * doc.cols + target.c;
            }).filter((index) => index >= 0)));
            const before = paintValue(op.layerId, cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else if (op.kind === "rect") {
            // 四个角一起校验：不合法就整条跳过。只按格遍历、让 paintValue 逐格报错的话，
            // 一个浮点矩形会刷出上百条同样的 `越界格`，真正的问题被淹掉。
            if (![op.r0, op.c0, op.r1, op.c1].every((value) => Number.isInteger(value))) {
                skipped.push(`越界格 (${op.r0},${op.c0})`);
                continue;
            }
            const r0 = Math.min(op.r0, op.r1);
            const r1 = Math.max(op.r0, op.r1);
            const c0 = Math.min(op.c0, op.c1);
            const c1 = Math.max(op.c0, op.c1);
            const tile = tileValue(op.tile);
            const cells = [];
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    const onEdge = r === r0 || r === r1 || c === c0 || c === c1;
                    if (onEdge || op.filled !== false)
                        cells.push({ r, c, tile });
                }
            }
            dropStampsAt(op.layerId, new Set(cells.map((cell) => {
                const target = canonical(cell.r, cell.c);
                return target === undefined ? -1 : target.r * doc.cols + target.c;
            }).filter((index) => index >= 0)));
            const before = paintValue(op.layerId, cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else if (op.kind === "replace") {
            const data = doc.data[op.layerId];
            const from = Math.round(Number(op.from));
            const to = tileValue(op.to);
            const cells = [];
            for (let index = 0; index < data.length; index++) {
                if (data[index] !== from)
                    continue;
                cells.push({ r: Math.floor(index / doc.cols), c: index % doc.cols, tile: to });
            }
            dropStampsAt(op.layerId, new Set(cells.map((cell) => {
                const target = canonical(cell.r, cell.c);
                return target === undefined ? -1 : target.r * doc.cols + target.c;
            }).filter((index) => index >= 0)));
            const before = paintValue(op.layerId, cells);
            if (before.length > 0)
                undo.push({ kind: "paint", layerId: op.layerId, cells: before });
        }
        else {
            skipped.push(`不支持的 op：${String(op.kind)}`);
        }
    }
    if (changed.size > 0 || touched)
        doc.updatedAt = new Date().toISOString();
    return {
        changed: changed.size,
        touched,
        stamps: stampsTouched,
        skipped,
        dirty: [...dirty.values()].sort((a, b) => a.r - b.r || a.c - b.c),
        undo: undo.reverse()
    };
}
/**
 * 应用一条标记 op。返回「文档是否真的变了」。
 *
 * 编号 = 下标 + 1，所以**增删都要把后面那些标记的格子一起标脏**：删掉第 2 个之后，
 * 原来的第 3 个圆圈里就写着 2 —— 不标脏的话界面上那一格永远不会重画，屏幕上留着旧号码。
 * （宿主每次查询都会回整份标记表，所以只脏一个块也能拉到新号码；但脏哪一块是**宿主**
 * 算的，不能指望「用户恰好看得见被删的那个」。）
 */
/** 标记的语义字段（新增 / 更新共用；空串视为清空）。 */
function markerMeta(input, includeKind = true) {
    const rawKind = input.markerKind !== undefined ? input.markerKind : includeKind ? input.kind : undefined;
    const kind = typeof rawKind === "string" && rawKind.trim() !== "" ? rawKind.trim() : undefined;
    const color = typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color.trim()) ? input.color.trim() : undefined;
    const note = typeof input.note === "string" && input.note !== "" ? input.note : undefined;
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag) => typeof tag === "string" && tag !== "") : undefined;
    return {
        ...(kind === undefined ? {} : { kind }),
        ...(color === undefined ? {} : { color }),
        ...(note === undefined ? {} : { note }),
        ...(tags === undefined || tags.length === 0 ? {} : { tags })
    };
}
function applyMarkerOp(doc, op, env, skipped, undo) {
    const indexOf = (id) => (typeof id === "string" ? doc.markers.findIndex((marker) => marker.id === id) : -1);
    const occupiedAt = (r, c) => doc.markers.findIndex((marker) => marker.r === r && marker.c === c);
    const occupiedText = (index) => `这一格已经有标记了（第 ${index + 1} 个）`;
    if (op.op === "add") {
        const target = env.canonical(op.r, op.c);
        if (target === undefined) {
            skipped.push(`越界格 (${op.r},${op.c})`);
            return false;
        }
        const occupied = occupiedAt(target.r, target.c);
        if (occupied >= 0) {
            skipped.push(occupiedText(occupied));
            return false;
        }
        const given = typeof op.id === "string" && op.id !== "" ? op.id : "";
        if (given !== "" && indexOf(given) >= 0) {
            skipped.push(`标记 id 重复：${given}`);
            return false;
        }
        const id = given !== "" ? given : nextMarkerId(doc);
        const at = Number.isInteger(op.at) ? Math.min(doc.markers.length, Math.max(0, Number(op.at))) : doc.markers.length;
        doc.markers.splice(at, 0, {
            id,
            r: target.r,
            c: target.c,
            name: typeof op.name === "string" ? op.name : "",
            ...markerMeta(op, false)
        });
        env.markCell(target.r, target.c);
        env.markNumberingFrom(at);
        undo.push({ kind: "marker", op: "remove", id });
        return true;
    }
    const index = indexOf(op.id);
    if (index < 0) {
        skipped.push(`标记不存在：${String(op.id)}`);
        return false;
    }
    const marker = doc.markers[index];
    if (op.op === "remove") {
        doc.markers.splice(index, 1);
        env.markCell(marker.r, marker.c);
        env.markNumberingFrom(index);
        // 逆操作**插回原位置**：插到末尾的话，撤销之后编号顺序就变了。
        const saved = markerMeta(marker);
        undo.push({
            kind: "marker",
            op: "add",
            id: marker.id,
            r: marker.r,
            c: marker.c,
            name: marker.name,
            at: index,
            ...(saved.kind === undefined ? {} : { markerKind: saved.kind }),
            ...(saved.color === undefined ? {} : { color: saved.color }),
            ...(saved.note === undefined ? {} : { note: saved.note }),
            ...(saved.tags === undefined ? {} : { tags: saved.tags })
        });
        return true;
    }
    if (op.op === "move") {
        const target = env.canonical(op.r, op.c);
        if (target === undefined) {
            skipped.push(`越界格 (${op.r},${op.c})`);
            return false;
        }
        if (target.r === marker.r && target.c === marker.c)
            return false;
        const occupied = occupiedAt(target.r, target.c);
        if (occupied >= 0) {
            skipped.push(occupiedText(occupied));
            return false;
        }
        const from = { r: marker.r, c: marker.c };
        marker.r = target.r;
        marker.c = target.c;
        env.markCell(from.r, from.c);
        env.markCell(target.r, target.c);
        undo.push({ kind: "marker", op: "move", id: marker.id, r: from.r, c: from.c });
        return true;
    }
    if (op.op === "update") {
        const patch = op.patch ?? {};
        const before = { ...marker };
        if (typeof patch.name === "string")
            marker.name = patch.name;
        if (patch.kind !== undefined) {
            if (patch.kind.trim() === "")
                delete marker.kind;
            else
                marker.kind = patch.kind.trim();
        }
        if (patch.color !== undefined) {
            if (patch.color.trim() === "")
                delete marker.color;
            else if (/^#[0-9a-f]{6}$/i.test(patch.color.trim()))
                marker.color = patch.color.trim();
        }
        if (patch.note !== undefined) {
            if (patch.note === "")
                delete marker.note;
            else
                marker.note = patch.note;
        }
        if (patch.tags !== undefined) {
            const tags = patch.tags.filter((tag) => typeof tag === "string" && tag !== "");
            if (tags.length === 0)
                delete marker.tags;
            else
                marker.tags = tags;
        }
        if (JSON.stringify(before) === JSON.stringify(marker))
            return false;
        undo.push({
            kind: "marker",
            op: "update",
            id: marker.id,
            patch: {
                name: before.name,
                kind: before.kind ?? "",
                color: before.color ?? "",
                note: before.note ?? "",
                tags: before.tags ?? []
            }
        });
        return true;
    }
    const name = typeof op.name === "string" ? op.name : "";
    if (marker.name === name)
        return false;
    const before = marker.name;
    marker.name = name;
    undo.push({ kind: "marker", op: "rename", id: marker.id, name: before });
    return true;
}
/** 下一个不冲突的标记 id（`m1`、`m2`…）。删掉的不回收，免得和撤销栈里的旧 id 撞上。 */
export function nextMarkerId(doc) {
    let seq = doc.markers.length;
    for (;;) {
        seq++;
        if (!doc.markers.some((marker) => marker.id === `m${seq}`))
            return `m${seq}`;
    }
}
/**
 * 撤销：把逆操作原样应用（它本身也是 op）。
 *
 * 契约里没有 `layout` 参数 —— 逆操作记下来的坐标本来就是**规范坐标**，这里补一个
 * 只为了能复用 `applyOps`；wrap 对规范坐标是恒等变换，所以用哪个网格都不影响结果。
 */
export function revertOps(doc, undo, options = {}) {
    const layout = layoutOf(DEFAULT_GRID, doc.cols, doc.rows);
    return applyOps(doc, undo, layout, options).dirty.map((cell) => cell.r * doc.cols + cell.c);
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
/** 把越界 / 不存在的图块序号清掉：返回被清掉的格子数（删图集 / 改切分之后要调用）。 */
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
