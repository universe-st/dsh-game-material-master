/**
 * 蒙皮网格（M5 的 L1）与自动权重（L0）。
 *
 * 纯计算，不碰文件系统——网格与权重是「算出来的」，能离线断言就别放到运行时里试。
 *
 * 为什么需要它：**裙摆、披风、长发这类部件用刚体骨骼是动不好的**。一根骨骼只能
 * 让整块贴图绕原点转，而裙摆要的是「上缘几乎不动、下缘甩出去」——必须在部件内部
 * 细分顶点、让不同顶点受不同骨骼影响（或者被 FFD 直接搬走）。
 *
 * 网格用**规则三角化**而不是自适应三角化：规则网格的顶点是确定的（同样的输入永远
 * 同样的坐标），FFD 编辑器里「用户拖的是哪个顶点」才有稳定含义；自适应三角化每次
 * 跑出来的拓扑可能不同，存下来的 deform 会直接对不上号。
 *
 * 输出契约抄 DragonBones 的自包含设计：只要产出
 * `{vertices, uvs, triangles, weights, slotPose, bonePose}` 这六样，蒙皮就闭环，
 * 运行时不需要外部绑定姿势。这里的 `vertices/uvs/triangles` 都在**部件局部坐标系**
 * （左上角为原点），`slotPose/bonePose` 由导出器按当时的骨骼世界矩阵现算。
 */
/** 网格密度上限：16×16 已经 289 个顶点，再多预览里的逐三角形裁剪会明显掉帧。 */
export const MESH_MAX_DIVISIONS = 16;
/** 裙摆这类部件用 6×6 就够软；太密只会让 FFD 变难拖。 */
export const MESH_DEFAULT_DIVISIONS = 6;
/** 每个顶点最多受几根骨骼影响（DragonBones 的常见上限是 4）。 */
export const MESH_MAX_INFLUENCES = 3;
function clampDivisions(value, fallback) {
    const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.max(1, Math.min(MESH_MAX_DIVISIONS, parsed));
}
/**
 * 生成规则网格：`cols × rows` 个格子、`(cols+1) × (rows+1)` 个顶点、`cols × rows × 2` 个三角形。
 *
 * 顶点顺序是**逐行**的（先第一行从左到右），所以「第 i 个顶点」在编辑器里位置确定。
 */
export function buildRigMesh(options) {
    const width = Math.max(1, options.width);
    const height = Math.max(1, options.height);
    const cols = clampDivisions(options.cols, MESH_DEFAULT_DIVISIONS);
    const rows = clampDivisions(options.rows, MESH_DEFAULT_DIVISIONS);
    const maxInfluences = Math.max(1, Math.min(MESH_MAX_INFLUENCES, options.maxInfluences ?? MESH_MAX_INFLUENCES));
    const falloff = options.falloff ?? 2;
    const vertices = [];
    const uvs = [];
    const weights = [];
    const influenceCount = Math.min(maxInfluences, Math.max(1, options.bones.length));
    for (let row = 0; row <= rows; row++) {
        const v = row / rows;
        for (let col = 0; col <= cols; col++) {
            const u = col / cols;
            const localX = u * width;
            const localY = v * height;
            vertices.push(Number(localX.toFixed(4)), Number(localY.toFixed(4)));
            uvs.push(Number(u.toFixed(6)), Number(v.toFixed(6)));
            if (options.bones.length === 0) {
                weights.push([]);
                continue;
            }
            // 顶点在画布上的位置：离哪根骨骼近就多受谁影响。
            const worldX = options.x + localX;
            const worldY = options.y + localY;
            const scored = options.bones
                .map((bone, index) => {
                const dx = worldX - bone.x;
                const dy = worldY - bone.y;
                return { bone: index, distance: Math.sqrt(dx * dx + dy * dy) };
            })
                .sort((a, b) => a.distance - b.distance)
                .slice(0, influenceCount);
            // 反距离加权：恰好落在骨骼上时退化成「只受这一根影响」。
            let total = 0;
            const raw = scored.map((entry) => {
                const value = entry.distance <= 1e-3 ? 1e6 : 1 / Math.pow(entry.distance, falloff);
                total += value;
                return { bone: entry.bone, weight: value };
            });
            weights.push(raw
                .map((entry) => ({ bone: entry.bone, weight: Number((entry.weight / total).toFixed(6)) }))
                .filter((entry) => entry.weight > 0));
        }
    }
    const triangles = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const topLeft = row * (cols + 1) + col;
            const topRight = topLeft + 1;
            const bottomLeft = topLeft + (cols + 1);
            const bottomRight = bottomLeft + 1;
            triangles.push(topLeft, topRight, bottomLeft);
            triangles.push(topRight, bottomRight, bottomLeft);
        }
    }
    return {
        cols,
        rows,
        vertices,
        uvs,
        triangles,
        bones: options.bones.map((bone) => bone.name),
        weights
    };
}
/** 顶点个数。 */
export function meshVertexCount(mesh) {
    return mesh.vertices.length / 2;
}
/**
 * 把一份顶点位移（FFD）按双线性插值到一个任意局部坐标上。
 *
 * 预览器要把「顶点位移」变成「整张贴图的形变」，最常见的做法是逐三角形裁剪绘制；
 * 这个函数给的是**任意点**的位移，用于反查某个坐标被搬到了哪里（测试与调试用）。
 */
export function sampleDeform(mesh, offsets, localX, localY, width, height) {
    if (offsets === undefined || offsets.length !== mesh.vertices.length)
        return { x: localX, y: localY };
    const u = Math.max(0, Math.min(1, localX / Math.max(1e-6, width))) * mesh.cols;
    const v = Math.max(0, Math.min(1, localY / Math.max(1e-6, height))) * mesh.rows;
    const col = Math.min(mesh.cols - 1, Math.floor(u));
    const row = Math.min(mesh.rows - 1, Math.floor(v));
    const fx = u - col;
    const fy = v - row;
    const at = (c, r) => {
        const index = (r * (mesh.cols + 1) + c) * 2;
        return { x: offsets[index], y: offsets[index + 1] };
    };
    const a = at(col, row);
    const b = at(col + 1, row);
    const c = at(col, row + 1);
    const d = at(col + 1, row + 1);
    const top = { x: a.x + (b.x - a.x) * fx, y: a.y + (b.y - a.y) * fx };
    const bottom = { x: c.x + (d.x - c.x) * fx, y: c.y + (d.y - c.y) * fx };
    return { x: localX + top.x + (bottom.x - top.x) * fy, y: localY + top.y + (bottom.y - top.y) * fy };
}
/**
 * 生成一段"飘动"的 FFD 位移：越靠近**远端**（远离骨骼原点的那一侧）位移越大。
 *
 * 用正弦而不是随机：循环动画的首尾必须闭合（与动画预设同一个要求），
 * 而且「摆动」这件事本来就该是周期函数。
 */
export function buildWaveDeform(options) {
    const { mesh, width, height } = options;
    const amplitude = options.amplitude ?? Math.max(6, Math.min(width, height) * 0.06);
    const phase = options.phase ?? 0;
    const direction = options.direction ?? 0;
    const cycles = options.cycles ?? 1;
    const offsets = [];
    let maxDisplacement = 0;
    const count = meshVertexCount(mesh);
    for (let i = 0; i < count; i++) {
        const x = mesh.vertices[i * 2];
        const y = mesh.vertices[i * 2 + 1];
        // 权重：离"固定端"越远越自由（0 = 完全不动）。
        const along = options.anchor === "bottom" ? 1 - y / Math.max(1e-6, height) : options.anchor === "none" ? 1 : y / Math.max(1e-6, height);
        const sway = Math.sin((along * cycles + phase) * Math.PI * 2);
        const magnitude = amplitude * along * sway;
        const dx = Math.cos(direction) * magnitude;
        const dy = Math.sin(direction) * magnitude;
        offsets.push(Number(dx.toFixed(4)), Number(dy.toFixed(4)));
        maxDisplacement = Math.max(maxDisplacement, Math.abs(magnitude));
        void x;
    }
    return { offsets, maxDisplacement: Number(maxDisplacement.toFixed(4)) };
}
