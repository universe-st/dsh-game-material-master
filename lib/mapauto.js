/**
 * 地图编辑器（模块六）的**自动过渡**（autotile）内核：纯函数。
 *
 * 三种方案：
 *   · `single`    一张贴图，不做过渡
 *   · `corner16`  四邻域（N/E/S/W），4 位掩码 → 16 张
 *   · `blob47`    八邻域（含四个对角），8 位掩码归约成 **47 个**规范掩码
 *
 * ## 为什么要有「归约」
 *
 * 八邻域本来有 256 种组合，但四角的连通性只有在**两条相邻边都连通**时才看得见
 * （两条边都没接上时，角上那一格在菱形网格里根本不相邻）。归约后恰好 47 种，
 * 就是美术圈说的 blob tileset。归约表在这里是**固定表 + 断言**
 * （47 个规范输出、且幂等）—— 这正是自检里的反向验证目标：把它改成恒等映射，
 * 覆盖率断言必须变红。
 *
 * ## 优先级规则（多族过渡靠它）
 *
 * 一个格子属于族 F 时，某个方向的邻居只要是「优先级 ≥ F」的族（或空单元格所属
 * 的层基础族）就算**连通**。于是草地 / 沙 / 水三族按优先级排好，各自的过渡块
 * 只会朝更低优先级的邻居长 —— 这是 Tiled / Godot 的通行做法。
 */
export const AUTOTILE_SCHEMES = ["single", "corner16", "blob47"];
export function isAutotileScheme(value) {
    return typeof value === "string" && AUTOTILE_SCHEMES.includes(value);
}
/** 八邻域位值（与 `blob47` 的掩码一致）。 */
export const NB_N = 1;
export const NB_NE = 2;
export const NB_E = 4;
export const NB_SE = 8;
export const NB_S = 16;
export const NB_SW = 32;
export const NB_W = 64;
export const NB_NW = 128;
/** 四邻域位值（与 `corner16` 的掩码一致）：N=1, E=2, S=4, W=8。 */
export const NB4_N = 1;
export const NB4_E = 2;
export const NB4_S = 4;
export const NB4_W = 8;
/** 八邻域展开顺序：先四边、后四角，附其位值与四邻域位值。 */
const NEIGHBORS = [
    { dr: -1, dc: 0, bit: NB_N, edge4: NB4_N, corner: false },
    { dr: -1, dc: 1, bit: NB_NE, edge4: 0, corner: true },
    { dr: 0, dc: 1, bit: NB_E, edge4: NB4_E, corner: false },
    { dr: 1, dc: 1, bit: NB_SE, edge4: 0, corner: true },
    { dr: 1, dc: 0, bit: NB_S, edge4: NB4_S, corner: false },
    { dr: 1, dc: -1, bit: NB_SW, edge4: 0, corner: true },
    { dr: 0, dc: -1, bit: NB_W, edge4: NB4_W, corner: false },
    { dr: -1, dc: -1, bit: NB_NW, edge4: 0, corner: true }
];
/**
 * 算一个格子的八邻域掩码。
 *
 * `connected(r, c)` 返回该方向邻居是否与本格「同类」（同族或更高优先级），
 * 越界返回 `undefined`；越界按 `edgeMode` 处理，默认 `"same"`
 * （地图边缘不做过渡，否则一圈全是过渡块，看着像被围了一圈）。
 */
export function neighborhoodMask8(r, c, connected, edgeMode = "same") {
    let mask = 0;
    for (const neighbor of NEIGHBORS) {
        const value = connected(r + neighbor.dr, c + neighbor.dc);
        const same = value === undefined ? edgeMode === "same" : value === true;
        if (same)
            mask |= neighbor.bit;
    }
    return mask;
}
/** 邻居是否与本格同类：优先级 ≥ 本族即算连通（空单元格由调用方折算成层基础族）。 */
export function connectsTo(myPriority, neighborPriority) {
    if (neighborPriority === undefined)
        return false;
    return neighborPriority >= myPriority;
}
/**
 * 把八邻域掩码归约成「规范掩码」（`blob47` 的 47 种之一）。
 *
 * 规则：**角位只在两条相邻边都连通时才有意义**，否则一律清掉。
 *
 * ⚠️ 清掉与「强制点亮」是两回事：写成「两条边连通就把角点亮」的话，
 * 角位就完全由边位决定，规范掩码只剩 16 种，`blob47` 退化成 `corner16`
 * （自检里「恰好 47 个」那条会当场变红 —— 这就是它存在的意义）。
 * 正确做法是：两条边连通时**保留输入的角位**。
 */
export function canonicalBlobMask(mask) {
    const raw = mask & 0xff;
    let out = raw & (NB_N | NB_E | NB_S | NB_W);
    if ((raw & NB_N) !== 0 && (raw & NB_E) !== 0 && (raw & NB_NE) !== 0)
        out |= NB_NE;
    if ((raw & NB_S) !== 0 && (raw & NB_E) !== 0 && (raw & NB_SE) !== 0)
        out |= NB_SE;
    if ((raw & NB_S) !== 0 && (raw & NB_W) !== 0 && (raw & NB_SW) !== 0)
        out |= NB_SW;
    if ((raw & NB_N) !== 0 && (raw & NB_W) !== 0 && (raw & NB_NW) !== 0)
        out |= NB_NW;
    return out;
}
/** `blob47` 的全部规范掩码（恰好 47 个）。 */
export const BLOB47_MASKS = (() => {
    const out = [];
    for (let mask = 0; mask < 256; mask++) {
        const canonical = canonicalBlobMask(mask);
        if (!out.includes(canonical))
            out.push(canonical);
    }
    return out.sort((a, b) => a - b);
})();
/** 八邻域掩码 → 该方案真正用到的掩码（`corner16` 抽四边位，`single` 恒 0）。 */
export function maskForScheme(scheme, mask8) {
    if (scheme === "corner16") {
        let out = 0;
        for (const neighbor of NEIGHBORS) {
            if (neighbor.corner)
                continue;
            if ((mask8 & neighbor.bit) !== 0)
                out |= neighbor.edge4;
        }
        return out;
    }
    if (scheme === "single")
        return 0;
    return canonicalBlobMask(mask8);
}
/** 某方案需要覆盖的掩码全集。 */
export function expectedMasks(scheme) {
    if (scheme === "single")
        return [0];
    if (scheme === "corner16")
        return Array.from({ length: 16 }, (_unused, index) => index);
    return [...BLOB47_MASKS];
}
/** 掩码的位数（算 Hamming 距离用）。 */
function bitWidth(scheme) {
    return scheme === "corner16" ? 4 : 8;
}
function popcount(value) {
    let n = 0;
    let v = value >>> 0;
    while (v !== 0) {
        v &= v - 1;
        n++;
    }
    return n;
}
export function hammingDistance(a, b) {
    return popcount((a ^ b) >>> 0);
}
export function buildFamilyPlans(families, tiles) {
    const warnings = [];
    const plans = new Map();
    const byFamily = new Map();
    for (const tile of tiles) {
        if (tile.familyId === undefined)
            continue;
        const list = byFamily.get(tile.familyId);
        if (list === undefined)
            byFamily.set(tile.familyId, [tile]);
        else
            list.push(tile);
    }
    for (const family of families) {
        const scheme = isAutotileScheme(family.autotile) ? family.autotile : "single";
        const plan = {
            familyId: family.id,
            scheme,
            priority: Number.isFinite(family.priority) ? family.priority : 0,
            edgeMode: family.edgeMode === "different" ? "different" : "same",
            byMask: new Map(),
            baseTileIds: []
        };
        const own = byFamily.get(family.id) ?? [];
        for (const tile of own) {
            if (plan.baseTileIds.length === 0)
                plan.baseTileIds.push(tile.id);
            const mask = maskForScheme(scheme, typeof tile.mask === "number" ? tile.mask : 0);
            const list = plan.byMask.get(mask);
            if (list === undefined)
                plan.byMask.set(mask, [tile.id]);
            else
                list.push(tile.id);
        }
        if (own.length === 0)
            warnings.push(`族「${family.name ?? family.id}」下面一张贴图都没有。`);
        else if (scheme !== "single" && plan.byMask.size < expectedMasks(scheme).length) {
            warnings.push(`族「${family.name ?? family.id}」缺 ${expectedMasks(scheme).length - plan.byMask.size} 个掩码，` +
                `缺的地方会回退到最近的一个（界面里会标黄）。`);
        }
        plans.set(family.id, plan);
    }
    return { plans, warnings };
}
/**
 * 把一个掩码解析成贴图 id。
 *
 * 缺掩码时**必须回退而不是留空**：留空在菱形地图上就是一个透明洞，
 * 而且不报任何错（旧模块的「白色菱形洞」就是这么来的）。
 * 回退规则是确定的：Hamming 距离最近的已配掩码，并列取掩码值最小的那个。
 */
export function resolveMask(plan, mask8, pick) {
    const wanted = maskForScheme(plan.scheme, mask8);
    const exact = plan.byMask.get(wanted);
    if (exact !== undefined && exact.length > 0)
        return { tileId: pick(exact), mode: "exact", distance: 0, wanted };
    let bestMask;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of plan.byMask.keys()) {
        const distance = hammingDistance(candidate, wanted);
        if (distance < bestDistance || (distance === bestDistance && bestMask !== undefined && candidate < bestMask)) {
            bestDistance = distance;
            bestMask = candidate;
        }
    }
    if (bestMask !== undefined) {
        const candidates = plan.byMask.get(bestMask) ?? [];
        if (candidates.length > 0) {
            return { tileId: pick(candidates), mode: "nearest", distance: bestDistance, wanted };
        }
    }
    if (plan.baseTileIds.length > 0)
        return { tileId: pick(plan.baseTileIds), mode: "base", distance: -1, wanted };
    return { mode: "none", distance: -1, wanted };
}
/** 覆盖率报告：界面里那张 47/16 格矩阵就是按它渲染的。 */
export function coverageReport(families, tiles) {
    const { plans } = buildFamilyPlans(families, tiles);
    return families.map((family) => {
        const plan = plans.get(family.id);
        const expected = expectedMasks(plan?.scheme ?? "single");
        const assigned = expected.filter((mask) => (plan?.byMask.get(mask)?.length ?? 0) > 0);
        return {
            familyId: family.id,
            scheme: plan?.scheme ?? "single",
            expected: expected.length,
            assigned: assigned.length,
            missing: expected.filter((mask) => !assigned.includes(mask))
        };
    });
}
/** 掩码（规范值）→ 画格子矩阵时的可读标签，例如 `blob47` 的 `N,E,SE`。 */
export function describeMask(scheme, mask) {
    if (scheme === "single")
        return "唯一块";
    const names = scheme === "corner16"
        ? [[NB4_N, "N"], [NB4_E, "E"], [NB4_S, "S"], [NB4_W, "W"]]
        : [[NB_N, "N"], [NB_NE, "NE"], [NB_E, "E"], [NB_SE, "SE"], [NB_S, "S"], [NB_SW, "SW"], [NB_W, "W"], [NB_NW, "NW"]];
    const on = names.filter(([bit]) => (mask & bit) !== 0).map(([, label]) => label);
    return on.length === 0 ? "孤立" : on.join("+");
}
