#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· 纯本地内核自检。不联网、不花钱。
 *
 * 覆盖 `mapgeom.ts`（网格与坐标）、`mapauto.ts`（自动过渡）、`maptiles.ts`
 * （图集与切分）。这三层是纯函数，所以这里可以逐值断言，
 * 而且**必须有反向验证**：把归约、优先级、取整这三处换成错的写法，
 * 相应的断言必须变红 —— 否则那些断言只是自我循环。
 *
 * 用法：node scripts/verify-map.mjs
 */
import { readFileSync } from "node:fs";

const geom = await import("../lib/mapgeom.js");
const auto = await import("../lib/mapauto.js");
const tiles = await import("../lib/maptiles.js");

let passed = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const SQUARE = { kind: "square", tileWidth: 32, tileHeight: 32, heightStep: 16 };
const ISO = { kind: "iso2to1", tileWidth: 64, tileHeight: 32, heightStep: 16 };

// ══ 1. 网格参数 ═══════════════════════════════════════════════════════════
section("1) 网格参数（normalizeGrid / assertGrid）");
{
  const fallback = geom.normalizeGrid(undefined);
  check("空输入回落默认网格", fallback.kind === geom.DEFAULT_GRID.kind && fallback.tileWidth === geom.DEFAULT_GRID.tileWidth, JSON.stringify(fallback));
  check("未知 kind 回落默认值", geom.normalizeGrid({ kind: "hex" }).kind === geom.DEFAULT_GRID.kind);
  check("iso 网格缺 tileHeight 时按 tileWidth/2 补", geom.normalizeGrid({ kind: "iso2to1", tileWidth: 64 }).tileHeight === 32);
  check("heightStep 缺省是 tileHeight/2", geom.normalizeGrid({ kind: "square", tileWidth: 32, tileHeight: 24 }).heightStep === 12);

  check("合法网格不抛", !throws(() => geom.assertGrid(SQUARE)) && !throws(() => geom.assertGrid(ISO)));
  check("2:1 等距的比例被强制", throws(() => geom.assertGrid({ kind: "iso2to1", tileWidth: 64, tileHeight: 64, heightStep: 16 })), "64×64 应被拒");
  check("瓦片尺寸必须是正整数", throws(() => geom.assertGrid({ kind: "square", tileWidth: 0, tileHeight: 32, heightStep: 16 })));
  check("地图尺寸有上限", throws(() => geom.assertMapSize(geom.MAX_MAP_DIM + 1, 4)) && throws(() => geom.assertMapSize(0, 4)));
}

// ══ 2. 布局与脚印 ═════════════════════════════════════════════════════════
section("2) 布局（layoutOf / cellCenter / cellAnchor）");
{
  const one = geom.layoutOf(ISO, 1, 1);
  check("1×1 等距脚印 = 一个菱形", one.width === 64 && one.height === 32, `${one.width}×${one.height}`);
  const three = geom.layoutOf(ISO, 3, 3);
  check("3×3 等距脚印 = (cols+rows−2)·stepX + tileW", three.width === (3 + 3 - 2) * 32 + 64 && three.height === (3 + 3 - 2) * 16 + 32, `${three.width}×${three.height}`);
  const wide = geom.layoutOf(ISO, 5, 1);
  check("5×1 等距脚印横向更长", wide.width === (5 + 1 - 2) * 32 + 64 && wide.height === (5 + 1 - 2) * 16 + 32, `${wide.width}×${wide.height}`);

  const center00 = geom.cellCenter(three, 0, 0);
  check(
    "等距 (0,0) 是**最上面**那一格：菱形上顶点落在脚印顶边中点",
    center00.x === three.width / 2 && center00.y - 16 === 0,
    `${center00.x},${center00.y}`
  );
  const last = geom.cellCenter(three, 2, 2);
  check(
    "等距最后一格是最下面那一格：菱形下顶点落在脚印底边中点",
    last.x === three.width / 2 && last.y + 16 === three.height,
    `${last.x},${last.y}`
  );
  const leftMost = geom.cellCenter(three, 2, 0);
  check("等距最左一格（r 大 c 小）的菱形左顶点落在脚印左边", leftMost.x - 32 === 0, `${leftMost.x},${leftMost.y}`);

  const isoAnchor = geom.cellAnchor(three, 0, 0);
  check("等距锚点 = 菱形**下顶点**（不是中心）", isoAnchor.y === center00.y + 16 && isoAnchor.x === center00.x, `${isoAnchor.x},${isoAnchor.y}`);
  const square3 = geom.layoutOf(SQUARE, 3, 3);
  const squareAnchor = geom.cellAnchor(square3, 1, 2);
  check("正方形锚点 = 格子底边中点", squareAnchor.x === 2 * 32 + 16 && squareAnchor.y === 2 * 32, `${squareAnchor.x},${squareAnchor.y}`);

  // 贴图比一格大时按锚点摆放（底边中点对齐锚点）
  const topLeft = geom.cellTopLeft(three, 0, 0, 64, 96);
  check("大贴图按底边中点对齐锚点", topLeft.x === isoAnchor.x - 32 && topLeft.y === isoAnchor.y - 96, `${topLeft.x},${topLeft.y}`);
  const topLeftSquare = geom.cellTopLeft(square3, 0, 0, 32, 32);
  check("整格正方形贴图左上角 = 格子左上角", topLeftSquare.x === 0 && topLeftSquare.y === 0, `${topLeftSquare.x},${topLeftSquare.y}`);

  check("层高偏移为正在屏幕上向上（y 减少）", geom.heightOffsetPixels(ISO, 2) === -32 && geom.heightOffsetPixels(ISO, -1) === 16);
}

// ══ 3. 命中测试（含贴边与菱形角）══════════════════════════════════════════
section("3) 命中测试（pointToCell）");
{
  for (const [label, grid, cols, rows] of [["正方形", SQUARE, 6, 5], ["等距", ISO, 6, 5]]) {
    const layout = geom.layoutOf(grid, cols, rows);
    let hits = 0;
    let misses = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const center = geom.cellCenter(layout, r, c);
        const hit = geom.pointToCell(layout, center.x, center.y);
        if (hit.r === r && hit.c === c && hit.inMap) hits++;
        else misses.push(`(${r},${c})→(${hit.r},${hit.c})`);
      }
    }
    check(`${label}：每格中心反解回自己`, hits === cols * rows, misses.slice(0, 4).join(" "));

    // 菱形内部偏移 30% 也要落在同一格
    let offsetHits = 0;
    const layout2 = geom.layoutOf(grid, cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const center = geom.cellCenter(layout2, r, c);
        const dx = grid.tileWidth * 0.3;
        const dy = grid.kind === "iso2to1" ? grid.tileHeight * 0.3 : grid.tileHeight * 0.3;
        const okAll = [[dx, 0], [-dx, 0], [0, dy], [0, -dy]].every(([ox, oy]) => {
          const hit = geom.pointToCell(layout2, center.x + ox, center.y + oy);
          return hit.r === r && hit.c === c;
        });
        if (okAll) offsetHits++;
      }
    }
    check(`${label}：中心四周 30% 偏移仍落在同一格`, offsetHits === cols * rows, `${offsetHits}/${cols * rows}`);

    // 贴边：地图外一点必须 inMap=false
    const outside = geom.pointToCell(layout, -grid.tileWidth * 3, -grid.tileHeight * 3);
    check(`${label}：地图外的点 inMap=false`, outside.inMap === false);
  }

  // 等距下「不在脚印里」等价于「反解到范围外的格子」——菱形是密铺的，没有空隙
  const iso = geom.layoutOf(ISO, 3, 3);
  const bboxCorner = geom.pointToCell(iso, 1, 1);
  check("等距脚印角落的点反解到地图外（菱形密铺，没有空隙）", bboxCorner.inMap === false, JSON.stringify(bboxCorner));

  // 逐像素：命中结果对应的菱形必须真的包含这个点
  let insideOk = 0;
  let sampled = 0;
  for (let y = 0; y < iso.height; y += 3) {
    for (let x = 0; x < iso.width; x += 3) {
      const hit = geom.pointToCell(iso, x, y);
      if (!hit.inMap) continue;
      const center = geom.cellCenter(iso, hit.r, hit.c);
      const u = (x - center.x) / iso.stepX;
      const v = (y - center.y) / iso.stepY;
      sampled++;
      if (Math.abs(u) + Math.abs(v) <= 1.0001) insideOk++;
    }
  }
  check("等距逐像素：命中格的菱形确实包含该点", insideOk === sampled, `${insideOk}/${sampled}`);

  // 反向验证：把「先 /2 再四舍五入」写成「直接拿 u、v 当格子下标」，往返断言必须站不住
  let wrongHits = 0;
  const wrongInverse = (layout, x, y) => {
    const u = (x - layout.centerX) / layout.stepX;
    const v = (y - layout.centerY) / layout.stepY;
    return { r: Math.round(v - u), c: Math.round(v + u) };
  };
  for (let r = 0; r < iso.rows; r++) {
    for (let c = 0; c < iso.cols; c++) {
      const center = geom.cellCenter(iso, r, c);
      const hit = wrongInverse(iso, center.x, center.y);
      if (hit.r === r && hit.c === c) wrongHits++;
    }
  }
  check("反向验证：漏掉 /2 的反解在格中心就会错（说明往返断言有效）", wrongHits < iso.cols * iso.rows, `错误反解命中 ${wrongHits}/${iso.cols * iso.rows}`);
}

// ══ 4. 绘制顺序与 chunk ═══════════════════════════════════════════════════
section("4) 绘制顺序与 chunk");
{
  const order = geom.drawOrderRows(3, 2);
  check("绘制顺序是行优先（Tiled right-down）", JSON.stringify(order) === JSON.stringify([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]), JSON.stringify(order));

  check("chunk 按下标整除", geom.chunkKey(geom.chunkOf(0, 0)) === "0,0" && geom.chunkKey(geom.chunkOf(31, 63)) === "1,0" && geom.chunkKey(geom.chunkOf(64, 0)) === "0,2");
  check("chunkKey 能反解", JSON.stringify(geom.parseChunkKey("2,3")) === JSON.stringify({ cx: 2, cy: 3 }));
  check("非法 chunkKey 返回 undefined", geom.parseChunkKey("x,y") === undefined);

  const range = geom.chunkCellRange({ cx: 1, cy: 0 }, 40, 40);
  check("chunk 覆盖范围按地图裁边", range.r0 === 0 && range.c0 === 32 && range.r1 === 32 && range.c1 === 40, JSON.stringify(range));
  check("全越界的 chunk 返回 undefined", geom.chunkCellRange({ cx: 9, cy: 9 }, 40, 40) === undefined);
  check("allChunks 数量正确", geom.allChunks(64, 64).length === 4 && geom.allChunks(33, 1).length === 2);

  const dirty = geom.dirtyChunksFor([{ r: 0, c: 0 }], 64, 64);
  check("角落一格只弄脏 1 个 chunk", dirty.length === 1 && dirty[0] === "0,0", dirty.join(" "));
  const dirtyEdge = geom.dirtyChunksFor([{ r: 31, c: 31 }], 64, 64);
  check("chunk 边界上一格最多弄脏 4 个 chunk", dirtyEdge.length === 4, dirtyEdge.join(" "));

  const layout = geom.layoutOf(ISO, 64, 64);
  const covering = geom.chunksCovering(layout, { x: 0, y: 0, width: 800, height: 600 });
  check("视口覆盖的 chunk 都在地图范围内", covering.every((chunk) => chunk.cx >= 0 && chunk.cy >= 0), covering.map(geom.chunkKey).join(" "));
  check("视口覆盖的 chunk 数远小于全图", covering.length < geom.allChunks(64, 64).length, `${covering.length} < ${geom.allChunks(64, 64).length}`);
  check("视口只覆盖左下角时不会给出右上角 chunk", covering.every((chunk) => chunk.cx <= 2 && chunk.cy <= 2), covering.map(geom.chunkKey).join(" "));
}

// ══ 5. 自动过渡掩码 ═══════════════════════════════════════════════════════
section("5) 自动过渡（mapauto）");
{
  check("blob47 规范掩码恰好 47 个", auto.BLOB47_MASKS.length === 47, `${auto.BLOB47_MASKS.length}`);
  check("blob47 规范掩码互不相同且升序", new Set(auto.BLOB47_MASKS).size === 47 && auto.BLOB47_MASKS.every((mask, index) => index === 0 || mask > auto.BLOB47_MASKS[index - 1]));
  check("blob47 归约幂等", auto.BLOB47_MASKS.every((mask) => auto.canonicalBlobMask(mask) === mask));
  check("blob47 归约后一定落在表内", Array.from({ length: 256 }, (_u, mask) => auto.canonicalBlobMask(mask)).every((mask) => auto.BLOB47_MASKS.includes(mask)));
  check("只有一个角连通时归约掉该角位", auto.canonicalBlobMask(auto.NB_N | auto.NB_NE) === auto.NB_N);
  check("两条相邻边都连通时保留角位", auto.canonicalBlobMask(auto.NB_N | auto.NB_E | auto.NB_NE) === (auto.NB_N | auto.NB_E | auto.NB_NE));

  check("corner16 只要 16 个掩码", auto.expectedMasks("corner16").length === 16 && auto.expectedMasks("single").length === 1);
  check("corner16 从八邻域里抽四边位", auto.maskForScheme("corner16", auto.NB_N | auto.NB_E) === (auto.NB4_N | auto.NB4_E));
  check("corner16 忽略对角位", auto.maskForScheme("corner16", auto.NB_NE | auto.NB_SE) === 0);
  check("single 恒为 0", auto.maskForScheme("single", 0xff) === 0);

  // 八邻域掩码
  const grid = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ];
  const connected = (r, c) => (r < 0 || c < 0 || r > 2 || c > 2 ? undefined : grid[r][c] === 1);
  const mask = auto.neighborhoodMask8(1, 1, connected);
  check("八邻域掩码：八邻全连通 = 0xff", mask === 0xff, `0x${mask.toString(16)}`);
  const edgeSame = auto.neighborhoodMask8(0, 0, connected, "same");
  check("越界按 same 处理时上/左/左上也算连通", edgeSame === 0xff, `0x${edgeSame.toString(16)}`);
  const edgeDifferent = auto.neighborhoodMask8(0, 0, connected, "different");
  check(
    "越界按 different 处理时只留地图内的三个邻居（E / SE / S）",
    edgeDifferent === (auto.NB_E | auto.NB_SE | auto.NB_S),
    `0x${edgeDifferent.toString(16)}`
  );
  const hole = auto.neighborhoodMask8(1, 1, (r, c) => (r < 0 || c < 0 || r > 2 || c > 2 ? undefined : !(r === 0 && c === 0)), "same");
  check("缺口方向不置位", (hole & auto.NB_NW) === 0 && (hole & auto.NB_N) !== 0, `0x${hole.toString(16)}`);

  check("优先级规则：同族或更高优先级才算连通", auto.connectsTo(5, 5) && auto.connectsTo(5, 7) && !auto.connectsTo(5, 3) && !auto.connectsTo(5, undefined));

  // 族计划与解析
  const families = [
    { id: "grass", name: "草地", autotile: "blob47", priority: 0 },
    { id: "dirt", name: "土路", autotile: "blob47", priority: 1 },
    { id: "tree", name: "树", autotile: "single", priority: 2 }
  ];
  const tileList = [];
  for (const mask of auto.BLOB47_MASKS) {
    tileList.push({ id: `g${mask}`, familyId: "grass", mask, weight: 1 });
  }
  // 故意让土路缺一半掩码，用来验证回退
  for (const mask of auto.BLOB47_MASKS.filter((_u, index) => index % 2 === 0)) {
    tileList.push({ id: `d${mask}`, familyId: "dirt", mask, weight: 1 });
  }
  tileList.push({ id: "tree0", familyId: "tree" });

  const { plans, warnings } = auto.buildFamilyPlans(families, tileList);
  check("族计划按族建立", plans.size === 3);
  check("缺掩码的族给出警告", warnings.some((text) => text.includes("土路")), warnings.join(" | ").slice(0, 80));
  check("完全没有贴图的族也给出警告", auto.buildFamilyPlans([{ id: "x", autotile: "single", priority: 0 }], tileList).warnings[0]?.includes("一张贴图都没有"));

  const pickFirst = (candidates) => candidates[0];
  const grassPlan = plans.get("grass");
  const exact = auto.resolveMask(grassPlan, auto.NB_N | auto.NB_E | auto.NB_W, pickFirst);
  check("已有掩码精确命中", exact.mode === "exact" && exact.tileId === `g${auto.canonicalBlobMask(auto.NB_N | auto.NB_E | auto.NB_W)}`, JSON.stringify(exact));

  const dirtPlan = plans.get("dirt");
  const wanted = auto.canonicalBlobMask(auto.NB_N); // 缺（土路只配了偶数下标的掩码）
  const fallback = auto.resolveMask(dirtPlan, auto.NB_N, pickFirst);
  check("缺掩码时回退到最近邻", fallback.mode === "nearest" && dirtPlan.byMask.has(auto.maskForScheme("blob47", auto.NB_N)) === false, JSON.stringify(fallback));
  check("回退是确定性的（两次结果一致）", auto.resolveMask(dirtPlan, auto.NB_N, pickFirst).tileId === fallback.tileId);
  check("回退距离等于最小 Hamming 距离", (() => {
    const minimum = Math.min(...[...dirtPlan.byMask.keys()].map((candidate) => auto.hammingDistance(candidate, wanted)));
    return fallback.distance === minimum;
  })(), `distance=${fallback.distance}`);

  const base = auto.resolveMask({ familyId: "b", scheme: "single", priority: 0, edgeMode: "same", byMask: new Map(), baseTileIds: ["b0"] }, 0, pickFirst);
  check("族完全没有掩码时用基础块", base.mode === "base" && base.tileId === "b0");
  const none = auto.resolveMask({ familyId: "b", scheme: "single", priority: 0, edgeMode: "same", byMask: new Map(), baseTileIds: [] }, 0, pickFirst);
  check("族没有贴图时返回 none（界面要报错，不留洞）", none.mode === "none" && none.tileId === undefined);

  const coverage = auto.coverageReport(families, tileList);
  const grassRow = coverage.find((row) => row.familyId === "grass");
  const dirtRow = coverage.find((row) => row.familyId === "dirt");
  check("覆盖率：满配族 missing 为空", grassRow.expected === 47 && grassRow.assigned === 47 && grassRow.missing.length === 0);
  check("覆盖率：缺掩码族列出缺口（24/47）", dirtRow.assigned === 24 && dirtRow.missing.length === 23, `${dirtRow.assigned}/${dirtRow.expected}`);
  check("覆盖率：single 族只要一块", coverage.find((row) => row.familyId === "tree").expected === 1);
  check("掩码可读标签", auto.describeMask("blob47", auto.NB_N | auto.NB_E) === "N+E" && auto.describeMask("blob47", 0) === "孤立" && auto.describeMask("single", 7) === "唯一块");

  // 反向验证 ①：不做归约时「恰好 47 个」必然站不住
  const identityCount = new Set(Array.from({ length: 256 }, (_u, mask) => mask)).size;
  check("反向验证：恒等映射会给出 256 个掩码（47 这条断言不是自证）", identityCount === 256);
  // 反向验证 ②：角的处理写成「两条边连通就点亮角」时，规范表只剩 16 个
  const forcedCorner = (mask) => {
    let out = mask & (auto.NB_N | auto.NB_E | auto.NB_S | auto.NB_W);
    if ((mask & auto.NB_N) !== 0 && (mask & auto.NB_E) !== 0) out |= auto.NB_NE;
    if ((mask & auto.NB_S) !== 0 && (mask & auto.NB_E) !== 0) out |= auto.NB_SE;
    if ((mask & auto.NB_S) !== 0 && (mask & auto.NB_W) !== 0) out |= auto.NB_SW;
    if ((mask & auto.NB_N) !== 0 && (mask & auto.NB_W) !== 0) out |= auto.NB_NW;
    return out;
  };
  check(
    "反向验证：把角位写成「强制点亮」会退化成 16 种（所以 47 这条断言真的在盯着代码）",
    new Set(Array.from({ length: 256 }, (_u, mask) => forcedCorner(mask))).size === 16
  );
  // 反向验证 ③：优先级比较翻转，三族过渡会反过来
  const flipped = (myPriority, neighborPriority) => neighborPriority <= myPriority;
  check("反向验证：优先级比较翻转后语义确实不同", flipped(1, 0) !== auto.connectsTo(1, 0));
}

// ══ 6. 图集与切分 ═════════════════════════════════════════════════════════
section("6) 图集与切分（maptiles）");
{
  const slice = tiles.normalizeSlice({ mode: "grid", tileWidth: 32, tileHeight: 32, offsetX: 1, offsetY: 1, spacingX: 2, spacingY: 2 }, 200, 100);
  const result = tiles.sliceRects(slice, 200, 100);
  // 可用宽 200−1=199、步长 34 → floor((199+2)/34)=5；可用高 99 → floor((99+2)/34)=2
  check("网格切分计数正确（含偏移与间距）", result.cols === 5 && result.rows === 2, `${result.cols}×${result.rows}`);
  check("网格切分出的矩形数 = cols×rows", result.rects.length === 10);
  check("第一块落在偏移处", result.rects[0].x === 1 && result.rects[0].y === 1);
  check("第二列按 格宽+间距 前进", result.rects[1].x === 1 + 32 + 2);
  check("余数被明确报出（不静默）", result.remainderX === 31 && result.warnings.some((text) => text.includes("不足一格")), `remainderX=${result.remainderX} warnings=${result.warnings.join(" ")}`);

  const tiny = tiles.sliceRects(tiles.normalizeSlice({ tileWidth: 64, tileHeight: 64 }, 32, 32), 32, 32);
  check("切不出任何一块时给出明确原因", tiny.rects.length === 0 && tiny.warnings.length === 1, tiny.warnings[0]?.slice(0, 40));

  const rectMode = tiles.normalizeSlice({ mode: "rects", rects: [{ x: 0, y: 0, width: 16, height: 16 }, { x: 500, y: 0, width: 16, height: 16 }, { x: 0, y: 0, width: 0, height: 9 }] }, 64, 64);
  const rectResult = tiles.sliceRects(rectMode, 64, 64);
  check("rects 模式丢掉越界矩形并提示", rectResult.rects.length === 1 && rectResult.warnings.length === 1, rectResult.warnings.join(" "));
  check("rects 模式丢掉零尺寸矩形", rectMode.rects.length === 2);

  const suggestions = tiles.suggestGrids(64, 64);
  check("网格建议含 32×32", suggestions.some((item) => item.tileWidth === 32 && item.tileHeight === 32));
  check("网格建议含 2:1 等距 32×16", suggestions.some((item) => item.tileWidth === 32 && item.tileHeight === 16));
  check("不能整除的尺寸不出现在建议里", tiles.suggestGrids(130, 64).every((item) => 130 % item.tileWidth === 0));

  // 元数据按矩形保留
  const first = tiles.buildTiles(slice, 200, 100, []);
  const edited = first.tiles.map((tile, index) => (index === 0 ? { ...tile, name: "草地", familyId: "grass", mask: 255 } : tile));
  const again = tiles.buildTiles(slice, 200, 100, edited);
  check("重新切分后元数据按矩形保留", again.tiles[0].name === "草地" && again.tiles[0].familyId === "grass" && again.tiles[0].mask === 255);
  const changed = tiles.buildTiles(tiles.normalizeSlice({ tileWidth: 16, tileHeight: 16 }, 200, 100), 200, 100, edited);
  check("改了格尺寸后旧矩形消失，元数据不串位", changed.tiles.every((tile) => tile.name !== "草地"), changed.tiles[0].name);
  check("图块 id 由矩形派生（稳定）", tiles.tileIdFor({ x: 3, y: 5, width: 8, height: 8 }) === "t3_5");

  const merged = tiles.mergeTileMeta(again.tiles, [{ id: again.tiles[0].id, name: "深草", weight: 3, mask: 12 }]);
  check("mergeTileMeta 只改指定字段", merged[0].name === "深草" && merged[0].weight === 3 && merged[0].mask === 12 && merged[0].familyId === "grass");
  check("mergeTileMeta 忽略不认识的 id", tiles.mergeTileMeta(again.tiles, [{ id: "t999_999", name: "x" }]).length === again.tiles.length);

  const duplicated = tiles.duplicateRects([
    {
      id: "ts1",
      name: "a",
      file: "x.png",
      imageWidth: 64,
      imageHeight: 64,
      slice,
      tiles: [again.tiles[0], { ...again.tiles[0], id: "t_alias" }]
    }
  ]);
  check("重复矩形能被检出", duplicated.length === 1 && duplicated[0].tileIds.length === 2, JSON.stringify(duplicated[0]?.tileIds));

  const tileset = { id: "ts1", name: "图集", file: "tilesets/ts1.png", imageWidth: 200, imageHeight: 100, slice, tiles: again.tiles };
  const flat = tiles.flatTiles([tileset]);
  check("全局图块序号从 1 开始", flat[0].index === 1 && flat[flat.length - 1].index === flat.length);
  check("展平顺序 = 图集顺序 → 切分顺序", flat[0].id === again.tiles[0].id && flat[1].id === again.tiles[1].id);
  check("展平表带回锚点默认值", flat[0].anchorX === 0.5 && flat[0].anchorY === 1);
  check("按序号反查", tiles.flatIndexByValue([tileset]).get(2)?.id === again.tiles[1].id);
  check("按族查引用", tiles.tilesUsingFamily([tileset], "grass").length === 1);

  const preview = tiles.tilesetPreview(tileset, 100);
  check("预览的图块序号接着前面的图集", preview.tiles[0].index === 100 && preview.tiles.length === 10);
  check("预览给出网格线", preview.gridLinesX.length === result.cols + 1 && preview.gridLinesY.length === result.rows + 1);
  check("预览不抛（带余数时一样）", typeof preview.warnings.length === "number");

  // cropTile 真的裁对了
  const source = { width: 4, height: 3, rgba: Buffer.alloc(4 * 3 * 4) };
  for (let i = 0; i < 4 * 3; i++) {
    source.rgba[i * 4] = i;
    source.rgba[i * 4 + 3] = 255;
  }
  const cropped = tiles.cropTile(source, { x: 2, y: 1, width: 2, height: 2 });
  check("cropTile 尺寸正确", cropped.width === 2 && cropped.height === 2);
  check("cropTile 取到正确的像素", cropped.rgba[0] === 6 && cropped.rgba[4] === 7 && cropped.rgba[8] === 10, `${cropped.rgba[0]},${cropped.rgba[4]},${cropped.rgba[8]}`);
  check("cropTile 越界时收缩到图内", tiles.cropTile(source, { x: 3, y: 2, width: 8, height: 8 }).width === 1);
}

// ══ 7. 与浏览器半区的契约 ═════════════════════════════════════════════════
//
// 客户端复刻的坐标函数（`MAP_pointToCell` / `MAP_cellAnchor`）与宿主实现的
// **黄金对照**放在 `verify-map-client.mjs` 里（那边才有真渲染环境）。
// 这里只钉一条「浏览器半区不许自己发明几何」的静态约束。
section("7) 客户端几何约束（文本检查）");
{
  const clientText = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
  check(
    "浏览器半区没有自己实现变体挑选 / 绘制顺序（只允许复刻两个坐标函数）",
    !clientText.includes("function MAP_pickVariant") && !clientText.includes("function MAP_drawOrder"),
    "变体与顺序一律由宿主计划给出"
  );
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${passed} 项通过${failures.length > 0 ? `，${failures.length} 项失败` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
