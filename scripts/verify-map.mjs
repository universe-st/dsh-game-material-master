#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· 纯本地内核自检。不联网、不花钱。
 *
 * 覆盖三层纯函数：
 *   · `mapgeom.ts`   —— 网格、环绕取模、命中测试、chunk、视口范围
 *   · `mapauto.ts`   —— 整格自动连接（16 掩码）与 A2 拼块自动连接（5 形状）
 *   · `maptiles.ts`  —— 素材形态自动识别与切片
 *
 * ## 为什么每条核心断言都配一条「反向验证」
 *
 * 自己验自己最容易骗过自己：写 `a2Shape` 的人当然也会照同一张表写断言。
 * 所以每条核心规则都再写一条**错写法**，断言它必须得出不同结果 ——
 * 错写法也「通过」的话，说明这条断言没有区分力。旧模块六在这里真的抓到过
 * 「blob47 退化成 16 种」与「漏掉 /2 的反解」两个静默坏，这条习惯保留。
 *
 * 用法：node scripts/verify-map.mjs
 */
import { readFileSync } from "node:fs";

const geom = await import("../lib/mapgeom.js");
const auto = await import("../lib/mapauto.js");
const tiles = await import("../lib/maptiles.js");
const render = await import("../lib/maprender.js");
const doc = await import("../lib/mapdoc.js");

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

const WRAP = { tileWidth: 32, tileHeight: 32, wrap: true };
const FLAT = { tileWidth: 32, tileHeight: 32, wrap: false };

// ══ 1. 网格参数 ═══════════════════════════════════════════════════════════
section("1) 网格参数（normalizeGrid / assertGrid）");
{
  const fallback = geom.normalizeGrid(undefined);
  check(
    "空输入回落默认网格（32×32、默认环绕）",
    fallback.tileWidth === geom.DEFAULT_GRID.tileWidth &&
      fallback.tileHeight === geom.DEFAULT_GRID.tileHeight &&
      fallback.wrap === true,
    JSON.stringify(fallback)
  );
  check("wrap 缺省为 true（AsLib 的地图就是环绕的）", geom.normalizeGrid({ tileWidth: 16 }).wrap === true);
  check("wrap: false 被尊重", geom.normalizeGrid({ tileWidth: 16, wrap: false }).wrap === false);
  check("wrap 非法值回落默认 true", geom.normalizeGrid({ wrap: "nope" }).wrap === true);
  check("尺寸取整", geom.normalizeGrid({ tileWidth: 32.4, tileHeight: 31.6 }).tileHeight === 32);

  check("合法网格不抛", !throws(() => geom.assertGrid(WRAP)) && !throws(() => geom.assertGrid(FLAT)));
  check("瓦片尺寸必须是正整数", throws(() => geom.assertGrid({ tileWidth: 0, tileHeight: 32, wrap: true })));
  check("瓦片尺寸有上限", throws(() => geom.assertGrid({ tileWidth: 4096, tileHeight: 32, wrap: true })));
  check(
    "地图尺寸必须是正整数且有上限",
    throws(() => geom.assertMapSize(0, 4)) &&
      throws(() => geom.assertMapSize(geom.MAX_MAP_DIM + 1, 4)) &&
      !throws(() => geom.assertMapSize(1, 1))
  );
}

// ══ 2. 布局与坐标 ═════════════════════════════════════════════════════════
section("2) 布局与坐标（layoutOf / cellCenter / cellAnchor / cellTopLeft）");
{
  const l8 = geom.layoutOf(WRAP, 8, 6);
  check("步长 = 瓦片尺寸", l8.stepX === 32 && l8.stepY === 32);
  check("脚印 = 格数 × 瓦片尺寸", l8.width === 8 * 32 && l8.height === 6 * 32, `${l8.width}×${l8.height}`);
  check("layout 带上 wrap 标志", l8.wrap === true && geom.layoutOf(FLAT, 8, 6).wrap === false);

  const center = geom.cellCenter(l8, 2, 3);
  check("格中心 = (c+0.5, r+0.5) × 瓦片", center.x === 3 * 32 + 16 && center.y === 2 * 32 + 16, `${center.x},${center.y}`);
  const anchor = geom.cellAnchor(l8, 2, 3);
  check("格锚点 = 底边中点（不是中心）", anchor.x === center.x && anchor.y === 3 * 32, `${anchor.x},${anchor.y}`);
  const topLeft = geom.cellTopLeft(l8, 2, 3, 32, 64);
  check("默认锚点 = 底边中点 → 高一格的贴图左上角上移一整格", topLeft.x === 3 * 32 && topLeft.y === 96 - 64, `${topLeft.x},${topLeft.y}`);
  const custom = geom.cellTopLeft(l8, 2, 3, 32, 32, 0, 0);
  check(
    "锚点 (0,0) = 贴图自己的左上角落在格子锚点上（底边中点）",
    custom.x === 112 && custom.y === 96,
    `${custom.x},${custom.y}`
  );

  // 越界坐标必须是**线性**的：环绕时要用它算视口外那些复制格的像素位置。
  const outside = geom.cellTopLeft(l8, -1, -1, 32, 32);
  check("越界坐标（-1,-1）照样给出线性像素位置", outside.x === -32 && outside.y === -32, `${outside.x},${outside.y}`);
}

// ══ 3. 环绕取模 ═══════════════════════════════════════════════════════════
section("3) 环绕取模（wrapRow / wrapCol / wrapCell）");
{
  const l = geom.layoutOf(WRAP, 8, 6);
  check("正数直接取模", geom.wrapRow(l, 7) === 1 && geom.wrapCol(l, 9) === 1);
  check("负数也能取模（-1 → 末行 / 末列）", geom.wrapRow(l, -1) === 5 && geom.wrapCol(l, -1) === 7);
  check("多圈取模", geom.wrapRow(l, 6 * 3 + 2) === 2 && geom.wrapRow(l, -6 * 3 - 2) === 4);
  const cell = geom.wrapCell(l, -1, 8);
  check("wrapCell 同时收敛两个方向", cell.r === 5 && cell.c === 0);

  const flat = geom.layoutOf(FLAT, 8, 6);
  check("非环绕时原样返回（越界仍是越界）", geom.wrapRow(flat, -1) === -1 && geom.wrapCol(flat, 9) === 9);
}

// ══ 4. 命中测试 ═══════════════════════════════════════════════════════════
section("4) 命中测试（pointToCellRaw / pointToCell）");
{
  const l = geom.layoutOf(WRAP, 8, 6);
  let roundTrip = 0;
  const misses = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 8; c++) {
      const center = geom.cellCenter(l, r, c);
      const hit = geom.pointToCell(l, center.x, center.y);
      if (hit.r === r && hit.c === c && hit.inMap === true) roundTrip++;
      else misses.push(`(${r},${c})→(${hit.r},${hit.c})`);
    }
  }
  check("每格中心都能命中自己", misses.length === 0 && roundTrip === 48, misses.slice(0, 4).join(" "));

  // 贴边：格子内部偏移 45% 仍应落在同一格
  let offsetOk = 0;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 8; c++) {
      const center = geom.cellCenter(l, r, c);
      const all = [[14, 0], [-14, 0], [0, 14], [0, -14]].every(([dx, dy]) => {
        const hit = geom.pointToCell(l, center.x + dx, center.y + dy);
        return hit.r === r && hit.c === c;
      });
      if (all) offsetOk++;
    }
  }
  check("中心四周偏移 45% 仍落在同一格", offsetOk === 48, `${offsetOk}/48`);

  const edge = geom.pointToCell(l, 0, 0);
  check("左上角的点落在 (0,0)", edge.r === 0 && edge.c === 0);
  const far = geom.pointToCell(l, 8 * 32 - 0.001, 6 * 32 - 0.001);
  check("右下角内侧落在最后一格", far.r === 5 && far.c === 7, `${far.r},${far.c}`);

  // 环绕：图外的点一定被折回图内，且 inMap 恒为 true（AsLib 同款）。
  const wrapped = geom.pointToCell(l, -1, 6 * 32 + 1);
  check("环绕时图外点折回图内（列 -1 → 7，行 6 → 0）", wrapped.r === 0 && wrapped.c === 7 && wrapped.inMap === true, `${wrapped.r},${wrapped.c}`);
  const raw = geom.pointToCellRaw(l, -1, 6 * 32 + 1);
  check("pointToCellRaw 不折回、inMap = false", raw.r === 6 && raw.c === -1 && raw.inMap === false, `${raw.r},${raw.c}`);

  const flat = geom.layoutOf(FLAT, 8, 6);
  const flatHit = geom.pointToCell(flat, -1, -1);
  check("非环绕时图外点保留越界坐标且 inMap = false", flatHit.r === -1 && flatHit.c === -1 && flatHit.inMap === false);

  // 反向验证：把「取模」换成「原样 floor」，跨边界点必须得出不同结果。
  const naive = Math.floor(-1 / 32);
  check("反向验证：不取模的写法在跨边界点上得到不同结果", naive !== wrapped.c, `naive=${naive} vs wrapped=${wrapped.c}`);
}

// ══ 5. chunk 与脏块 ═══════════════════════════════════════════════════════
section("5) chunk（chunkOf / rangeOfChunk / chunksInRange / canonicalChunk / dirtyChunksFor）");
{
  /**
   * ⚠️ 这里**不许写死块边长**：`MAP_CHUNK_SIZE` 是性能旋钮（它决定一次笔刷要重发多少 op），
   * 断言要表达的是「按块边长对齐 / 跨块 / 环绕折回」这些**契约**，不是那个数字。
   * 夹具统一用 4×4 块的图（边长 S，块数 NX），块键都按 S 推出来。
   */
  const S = geom.MAP_CHUNK_SIZE;
  const NX = 4;
  const DIM = S * NX;
  const l = geom.layoutOf(WRAP, DIM, DIM);
  const flat = geom.layoutOf(FLAT, DIM, DIM);

  check("chunkOf 按块边长对齐", geom.chunkOf(0, 0).cx === 0 && geom.chunkOf(S - 1, S + 1).cx === 1 && geom.chunkOf(S, 0).cy === 1);
  check("负数坐标给出负 chunk 号", geom.chunkOf(-1, -1).cx === -1 && geom.chunkOf(-1, -1).cy === -1);
  const roundTripKey = geom.chunkKey(geom.chunkOf(70, 40));
  check(
    "chunkKey 往返",
    roundTripKey === `${Math.floor(40 / S)},${Math.floor(70 / S)}` && geom.parseChunkKey(roundTripKey).cy === Math.floor(70 / S),
    roundTripKey
  );
  check("非法 key 返回 undefined", geom.parseChunkKey("a,b") === undefined && geom.parseChunkKey("") === undefined);

  const range = geom.rangeOfChunk({ cx: 0, cy: 1 });
  check("rangeOfChunk 不裁剪（右下开区间 = 块边长）", range.r0 === S && range.r1 === S * 2 && range.c0 === 0 && range.c1 === S, JSON.stringify(range));
  const negative = geom.rangeOfChunk({ cx: -1, cy: -1 });
  check("rangeOfChunk 对负 chunk 也成立", negative.r0 === -S && negative.r1 === 0 && negative.c0 === -S, JSON.stringify(negative));

  const covered = geom.chunksInRange({ r0: 0, c0: 0, r1: S + 1, c1: S + 1 });
  check("chunksInRange 覆盖跨界范围（2×2）", covered.length === 4, String(covered.length));
  const coveredNeg = geom.chunksInRange({ r0: -1, c0: -1, r1: S, c1: S });
  check(
    "chunksInRange 覆盖负范围（2×2，含 (-1,-1)）",
    coveredNeg.length === 4 && coveredNeg.some((chunk) => chunk.cx === -1 && chunk.cy === -1),
    coveredNeg.map(geom.chunkKey).join(" ")
  );
  check("空范围 → 空数组", geom.chunksInRange({ r0: 0, c0: 0, r1: 0, c1: 0 }).length === 0);
  // 块数上限按**面积**折算：调小块边长（性能旋钮）不能悄悄让「缩小到最远」开始截断。
  check(
    "计划块数上限按面积折算 = 一张最大地图（与块边长无关）",
    geom.MAX_PLAN_CHUNKS * geom.MAP_CHUNK_SIZE * geom.MAP_CHUNK_SIZE >= geom.MAX_MAP_DIM * geom.MAX_MAP_DIM,
    `块边长 ${S} → 上限 ${geom.MAX_PLAN_CHUNKS} 块 = ${geom.MAX_PLAN_CHUNKS * S * S} 格`
  );

  check(
    "allChunks = ceil(cols/块边长) × ceil(rows/块边长)",
    geom.allChunks(DIM, DIM).length === NX * NX && geom.allChunks(1, 1).length === 1 && geom.allChunks(S * 2, S * 2).length === 4,
    `4×4 块 → ${geom.allChunks(DIM, DIM).length}`
  );

  const canonical = geom.canonicalChunk({ cx: -1, cy: -1 }, DIM, DIM);
  check("canonicalChunk 把负 chunk 折回（-1 → 块数-1）", canonical.cx === NX - 1 && canonical.cy === NX - 1, `${canonical.cx},${canonical.cy}`);
  check(
    "canonicalChunk 对已经规范的 key 是恒等（所以 dropKeys 用它映射缓存键是安全的）",
    geom.canonicalChunk({ cx: 0, cy: 1 }, DIM, DIM).cx === 0 && geom.canonicalChunk({ cx: 1, cy: 0 }, DIM, DIM).cy === 0
  );
  check(
    "canonicalChunk 对多圈的越界 key 也能折回",
    geom.canonicalChunk({ cx: NX + 1, cy: -(NX + 1) }, DIM, DIM).cx === 1 && geom.canonicalChunk({ cx: NX + 1, cy: -(NX + 1) }, DIM, DIM).cy === NX - 1
  );

  // 非环绕时视口范围本来就裁在图内，所以缓存键永远是规范的 —— canonicalChunk 在这里不会被用到。
  const corner = geom.dirtyChunksFor([{ r: 0, c: 0 }], flat);
  check("非环绕：角落一格只弄脏 1 个 chunk", corner.length === 1 && corner[0] === "0,0", corner.join(" "));

  const boundary = geom.dirtyChunksFor([{ r: S, c: S }], flat);
  check("非环绕：块边界上恰好弄脏 4 个 chunk", boundary.length === 4, boundary.join(" "));

  // 环绕下画第 0 行会改变最后一行的自动连接外观 → 必须连带弄脏最后一行所在的 chunk。
  const wrapCorner = geom.dirtyChunksFor([{ r: 0, c: 0 }], l);
  check("环绕：画第 0 行必须连带弄脏最后一行的 chunk", wrapCorner.includes(`${NX - 1},0`) && wrapCorner.includes(`${NX - 1},${NX - 1}`), wrapCorner.join(" "));
  check("环绕：角落一格会弄脏全部 4 个 chunk（4×4 块的图，邻域折回后落在四角）", wrapCorner.length === 4, wrapCorner.join(" "));

  const flatCorner = geom.dirtyChunksFor([{ r: 0, c: 0 }], flat);
  check("反向验证：非环绕时不会连带弄脏最后一行", !flatCorner.includes(`${NX - 1},0`), flatCorner.join(" "));
}

// ══ 6. 视口范围 ═══════════════════════════════════════════════════════════
section("6) 视口范围（viewCellRange / clampRangeToMap）");
{
  const l = geom.layoutOf(WRAP, 8, 6);
  // 视口 [32,96) × [32,64) 严格覆盖第 1 行的第 1~2 列。
  // 契约是「四角反解 + 外扩」，所以范围允许比严格覆盖**多一圈**（多画一格无害，
  // 反而是安全的：不会被舍入误差咬掉边上那一列），但不能多出更多。
  const inside = geom.viewCellRange(l, { x: 32, y: 32, width: 64, height: 32 }, 0);
  check(
    "纯图内视口：覆盖到真正的可见格（允许各边多一格）",
    inside.r0 <= 1 && inside.r1 >= 2 && inside.c0 <= 1 && inside.c1 >= 3 && inside.r1 - inside.r0 <= 2 && inside.c1 - inside.c0 <= 3,
    JSON.stringify(inside)
  );
  const padded = geom.viewCellRange(l, { x: 32, y: 32, width: 64, height: 32 }, 1);
  check(
    "padding = 1 向四周各扩一圈（自动连接要看邻居）",
    padded.r0 === inside.r0 - 1 && padded.c0 === inside.c0 - 1 && padded.r1 === inside.r1 + 1 && padded.c1 === inside.c1 + 1,
    JSON.stringify(padded)
  );

  const crossSeam = geom.viewCellRange(l, { x: -16, y: -16, width: 64, height: 64 }, 0);
  check("环绕：跨左上边界时范围可以是负数", crossSeam.r0 === -1 && crossSeam.c0 === -1, JSON.stringify(crossSeam));

  const huge = geom.viewCellRange(l, { x: -4000, y: -4000, width: 8000, height: 8000 }, 0);
  check(
    "环绕：范围被截到最多一张地图那么大（内容重复，多画只会爆计划）",
    huge.r1 - huge.r0 <= 6 && huge.c1 - huge.c0 <= 8,
    `${huge.r1 - huge.r0}×${huge.c1 - huge.c0}`
  );

  /**
   * ⚠️ 真机踩过：视口比地图还大（画布大、地图只占左上角一片，相机被夹在 0）时，
   * 收口如果「从视口左上角起算一整轮」，padding 会把起点推到 -1，于是范围变成
   * `[-1, cols-1)` —— 地图自己的最后一列只以画布外的那份环绕副本出现。
   * 表现：地图右边缘少一列、底边少一行（摆在那里的标记点直接看不见）。
   */
  const wide = geom.viewCellRange(l, { x: 0, y: 0, width: 8 * 32 * 3, height: 6 * 32 * 3 }, 1);
  check("视口比地图大：给整张地图（含最右一列 / 最下一行）", wide.c0 === 0 && wide.c1 === 8 && wide.r0 === 0 && wide.r1 === 6, JSON.stringify(wide));
  check(
    "反向验证：从视口左上角起算一整轮会丢掉最后一列（-1 + 8 = 7，格 7 被挤出窗口）",
    wide.c1 > 7 && -1 + 8 <= 7,
    `新取法 c1=${wide.c1}；旧取法 c1=${-1 + 8}`
  );

  const flat = geom.layoutOf(FLAT, 8, 6);
  const clamped = geom.viewCellRange(flat, { x: -4000, y: -4000, width: 8000, height: 8000 }, 0);
  check("非环绕：范围被裁到地图内", clamped.r0 === 0 && clamped.c0 === 0 && clamped.r1 === 6 && clamped.c1 === 8, JSON.stringify(clamped));

  const clamp = geom.clampRangeToMap(flat, { r0: -5, c0: -5, r1: 99, c1: 99 });
  check("clampRangeToMap 裁到地图内", clamp.r0 === 0 && clamp.c0 === 0 && clamp.r1 === 6 && clamp.c1 === 8);
}

// ══ 7. 整格自动连接（16 掩码）══════════════════════════════════════════════
section("7) 整格自动连接（corner16Mask）");
{
  // 十字形：(1,1) 的四邻都在，用来验证「四邻全通」；边缘格用来验证单边。
  const plus = new Set(["1,1", "0,1", "2,1", "1,0", "1,2"]);
  const at = (r, c) => plus.has(`${r},${c}`);
  check("位序 N=1 E=2 S=4 W=8", auto.NB4_N === 1 && auto.NB4_E === 2 && auto.NB4_S === 4 && auto.NB4_W === 8);
  check("四邻都连通 → 15", auto.corner16Mask(at, 1, 1) === 15, String(auto.corner16Mask(at, 1, 1)));
  check("只有上邻连通 → 1", auto.corner16Mask(at, 2, 1) === 1, String(auto.corner16Mask(at, 2, 1)));
  check("只有右邻连通 → 2", auto.corner16Mask(at, 1, 0) === 2, String(auto.corner16Mask(at, 1, 0)));
  check("孤立块 → 0", auto.corner16Mask(at, 5, 5) === 0);
  check("掩码全集是 0..15", auto.CORNER16_MASKS.length === 16 && Math.max(...auto.CORNER16_MASKS) === 15);

  // 反向验证：把 N/E 两位写反，只有上邻的格子结果必须不同。
  const swapped = (at_, r, c) =>
    (at_(r, c + 1) ? 1 : 0) | (at_(r - 1, c) ? 2 : 0) | (at_(r + 1, c) ? 4 : 0) | (at_(r, c - 1) ? 8 : 0);
  check(
    "反向验证：把 N/E 两位写反后结果确实不同",
    swapped(at, 2, 1) !== auto.corner16Mask(at, 2, 1),
    `swapped=${swapped(at, 2, 1)} vs real=${auto.corner16Mask(at, 2, 1)}`
  );

  check("缺块回退取 Hamming 最近的掩码", auto.nearestMask(15, [0, 7]) === 7 && auto.nearestMask(0, [15, 14]) === 14);
  check("回退并列取掩码小的那个", auto.nearestMask(15, [7, 11]) === 7);
  check("没有已配掩码时返回 undefined（绝不留空）", auto.nearestMask(3, []) === undefined);
  check(
    "hammingDistance 对称且相等时为 0",
    auto.hammingDistance(10, 10) === 0 && auto.hammingDistance(10, 15) === auto.hammingDistance(15, 10)
  );
}

// ══ 8. A2 拼块自动连接（5 形状）════════════════════════════════════════════
section("8) A2 拼块自动连接（a2Shape / a2QuadrantShapes）");
{
  check("形状数恰好 5", auto.A2_SHAPES === 5);
  check("四象限顺序固定 TL/TR/BL/BR", JSON.stringify(auto.A2_QUADRANT_ORDER) === JSON.stringify(["TL", "TR", "BL", "BR"]));
  check("都不连通 → 0", auto.a2Shape(false, false, false) === 0 && auto.a2Shape(false, false, true) === 0);
  check("只上连通 → 1", auto.a2Shape(false, true, false) === 1 && auto.a2Shape(false, true, true) === 1);
  check("只左连通 → 2", auto.a2Shape(true, false, false) === 2 && auto.a2Shape(true, false, true) === 2);
  check("左上都连通、对角不通 → 3", auto.a2Shape(true, true, false) === 3);
  check("左上都连通、对角也通 → 4", auto.a2Shape(true, true, true) === 4);

  // 反向验证：只有一边连通时，左与上必须给出不同形状（1 ↔ 2）——
  // 把两者写反的实现在这里一定红。
  check(
    "反向验证：交换 left/up 语义后形状 1 与 2 互换",
    auto.a2Shape(true, false, false) === 2 && auto.a2Shape(false, true, false) === 1
  );

  const solid = (r, c) => r >= 0 && r < 3 && c >= 0 && c < 3;
  check("3×3 实心块正中一格四象限都是 4", auto.a2QuadrantShapes(solid, 1, 1).every((shape) => shape === 4), JSON.stringify(auto.a2QuadrantShapes(solid, 1, 1)));

  const lonely = (r, c) => r === 1 && c === 1;
  check("单格孤岛四象限都是 0", auto.a2QuadrantShapes(lonely, 1, 1).every((shape) => shape === 0));

  const rightOnly = (r, c) => r === 1 && (c === 1 || c === 2);
  const quad = auto.a2QuadrantShapes(rightOnly, 1, 1);
  check("右边有邻居：TL=0 TR=2 BL=0 BR=2", JSON.stringify(quad) === JSON.stringify([0, 2, 0, 2]), JSON.stringify(quad));
}

// ══ 9. 素材形态识别与切片 ═════════════════════════════════════════════════
section("9) 素材形态识别（detectLayout / layoutFor / buildTiles）");
{
  const a2 = tiles.detectLayout(64, 160);
  check(
    "64×160 识别为 A2 拼块（2 变体 × 5 形状）",
    a2.shape === "a2quad" && a2.cell.width === 32 && a2.cell.height === 32 && a2.cols === 2 && a2.rows === 5,
    JSON.stringify({ shape: a2.shape, cell: a2.cell, cols: a2.cols, rows: a2.rows })
  );
  check("识别说明是人话且提到拼块", typeof a2.reason === "string" && a2.reason.includes("拼块"), a2.reason);

  const wide = tiles.detectLayout(256, 160);
  check(
    "256×160 识别为 A2 且 8 变体",
    wide.shape === "a2quad" && wide.cell.width === 32 && wide.cols === 8 && wide.rows === 5,
    JSON.stringify({ shape: wide.shape, cols: wide.cols })
  );

  const plain = tiles.detectLayout(128, 96);
  check(
    "128×96 识别为普通图块（32px、4×3）",
    plain.shape === "plain" && plain.cell.width === 32 && plain.cell.height === 32 && plain.cols === 4 && plain.rows === 3,
    JSON.stringify({ shape: plain.shape, cell: plain.cell, cols: plain.cols, rows: plain.rows })
  );

  const odd = tiles.detectLayout(37, 41);
  check("识别不出来时给出人话原因", typeof odd.reason === "string" && odd.reason.length > 0, odd.reason);

  // 256×192 = 8×6 个 32px 道具。plain 兜底必须**优先 ≤32**，否则「能整除的最大尺寸」
  // 会把它算成 64px 格（4×3）—— 那等于静默把 2×2 个道具并成一块。
  const props = tiles.detectLayout(256, 192);
  check(
    "256×192 的 32px 道具图识别为 32px 格（不会被 64px 抢走）",
    props.shape === "plain" && props.cell.width === 32 && props.cols === 8 && props.rows === 6,
    JSON.stringify({ shape: props.shape, cell: props.cell, cols: props.cols, rows: props.rows })
  );

  check(
    "layoutFor 能强制指定形态（界面上的手动开关）",
    tiles.layoutFor("plain", { width: 16, height: 16 }, 64, 160).shape === "plain" &&
      tiles.layoutFor("plain", { width: 16, height: 16 }, 64, 160).cols === 4
  );

  const a2Tiles = tiles.buildTiles({ shape: "a2quad", cell: { width: 32, height: 32 }, imageWidth: 64, imageHeight: 160 });
  check("A2 切片数量 = 小格列数 × 10 行", a2Tiles.length === 4 * 10, String(a2Tiles.length));
  const shapes = new Set(a2Tiles.map((tile) => tile.shape));
  const variants = new Set(a2Tiles.map((tile) => tile.variant));
  check("A2 小格标了形状 0..4", shapes.size === 5 && Math.min(...shapes) === 0 && Math.max(...shapes) === 4, [...shapes].join(","));
  check("A2 小格标了变体 0..1", variants.size === 2, [...variants].join(","));
  check(
    "A2 小格的 id 由矩形派生、rect 是小格尺寸",
    a2Tiles.every((tile) => /^t\d+_\d+$/.test(tile.id) && tile.rect.width === 16 && tile.rect.height === 16)
  );
  // 契约：小格列 = variant*2 + (0|1)，小格行 = shape*2 + (0|1)
  const cellOf = (shape, variant, dx, dy) =>
    a2Tiles.find(
      (tile) =>
        tile.shape === shape &&
        tile.variant === variant &&
        tile.rect.x === (variant * 2 + dx) * 16 &&
        tile.rect.y === (shape * 2 + dy) * 16
    );
  check(
    "形状/变体 → 小格行列的映射（形状 3 变体 1 的 TL 小格在 (48, 96)）",
    cellOf(3, 1, 0, 0) !== undefined && cellOf(4, 0, 1, 1) !== undefined
  );

  const plainTiles = tiles.buildTiles({ shape: "plain", cell: { width: 32, height: 32 }, imageWidth: 128, imageHeight: 96 });
  check(
    "普通切片 = 4×3 共 12 块、行优先",
    plainTiles.length === 12 && plainTiles[0].rect.x === 0 && plainTiles[0].rect.y === 0 && plainTiles[4].rect.y === 32
  );
  check("普通图块默认没有动画帧", plainTiles.every((tile) => (tile.frame ?? 0) === 0));

  const anim = tiles.buildTiles({ shape: "plain", cell: { width: 32, height: 32 }, imageWidth: 32, imageHeight: 96, animRows: true });
  check("逐行动画：同列不同行 = 同一块的帧 0/1/2", anim.length === 3 && anim.map((tile) => tile.frame).join(",") === "0,1,2");

  const kept = tiles.buildTiles(
    { shape: "plain", cell: { width: 32, height: 32 }, imageWidth: 128, imageHeight: 96 },
    plainTiles.map((tile, index) => (index === 0 ? { ...tile, mask: 7, name: "手工改过的名字" } : tile))
  );
  check("重切时按 id 保留人工字段", kept[0].mask === 7 && kept[0].name === "手工改过的名字", JSON.stringify({ mask: kept[0].mask, name: kept[0].name }));

  const plainTs = {
    id: "a",
    name: "a",
    file: "tilesets/a.png",
    imageWidth: 128,
    imageHeight: 96,
    cell: { width: 32, height: 32 },
    shape: "plain",
    animRows: false,
    variants: 1,
    tiles: plainTiles
  };
  const flat = tiles.flatTiles([plainTs]);
  check("全局图块序号从 1 开始、按切分顺序", flat.length === 12 && flat[0].index === 1 && flat[0].value === 1 && flat[11].index === 12);
  check("按序号反查", tiles.flatIndexByValue([plainTs]).get(2).index === 2);
  check("图块 id 由矩形派生（稳定）", tiles.tileIdFor({ x: 3, y: 5, width: 8, height: 8 }) === "t3_5");

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

// ══ 10. 与浏览器半区的契约 ════════════════════════════════════════════════
//
// 客户端复刻的坐标函数与宿主实现的**黄金对照**放在 `verify-map-client.mjs`
// （那边才有真渲染环境）。这里钉两条静态约束：客户端不许自己发明几何，
// 也不许把旧术语（用户抱怨「门槛高」的根因）带回来。
// ══ 10. 标记点几何（buildMarkers）═════════════════════════════════════════
section("10) 标记点几何（圆心 / 半径 / 字号 / 编号都由宿主算）");
{
  const grid = { tileWidth: 32, tileHeight: 32, wrap: true };
  const map = doc.createMapDoc("vm", "夹具", 8, 8);
  map.markers = [
    { id: "m1", r: 2, c: 3, name: "宝箱" },
    { id: "m2", r: 5, c: 0, name: "" }
  ];
  const context = { grid, layout: geom.layoutOf(grid, map.cols, map.rows), tilesets: [], lookup: new Map() };
  const plan = render.buildMarkers(context, map, { r0: 0, c0: 0, r1: 8, c1: 8 });
  const first = plan.find((marker) => marker.id === "m1");
  check("圆心 = 格子中心（宿主算，界面只 arc 到这里）", first.x === 3 * 32 + 16 && first.y === 2 * 32 + 16, JSON.stringify(first));
  check("半径 / 字号跟着格子尺寸推导（32px 网格 → 13 / 16）", first.radius === Math.max(5, Math.round(32 * 0.42)) && first.font === Math.max(8, Math.round(first.radius * 1.2)), `${first.radius} / ${first.font}`);
  check("编号 = 数组下标 + 1（连续编号，删了自动重排）", plan.map((marker) => marker.n).join(",") === "1,2", plan.map((marker) => marker.n).join(","));
  check("名字只作数据带着（名字不上画布，界面自己决定怎么显示）", first.name === "宝箱" && plan[1].name === "");

  // 反向验证①：半径必须随网格变 —— 写死 13 的错写法在 64px 网格上会被抓住。
  const bigGrid = { tileWidth: 64, tileHeight: 64, wrap: true };
  const bigContext = { grid: bigGrid, layout: geom.layoutOf(bigGrid, 8, 8), tilesets: [], lookup: new Map() };
  const bigPlan = render.buildMarkers(bigContext, map, { r0: 0, c0: 0, r1: 8, c1: 8 });
  check("反向验证：64px 网格上半径翻倍（不是写死的常数）", bigPlan[0].radius === Math.round(64 * 0.42) && bigPlan[0].radius !== first.radius, `${first.radius} → ${bigPlan[0].radius}`);

  // 反向验证②：环绕视口里同一个标记会出现多份，非环绕时一份都不多。
  const wrapPlan = render.buildMarkers(context, map, { r0: 0, c0: 0, r1: 8, c1: 9 });
  const dupes = wrapPlan.filter((marker) => marker.id === "m2");
  check("环绕：视口越界时同一个标记以多个像素位置各出一条（多份、同一个 id）", dupes.length === 2 && dupes[1].x - dupes[0].x === 8 * 32, JSON.stringify(dupes.map((marker) => [marker.c, marker.x])));
  const flatGrid = { tileWidth: 32, tileHeight: 32, wrap: false };
  const flatPlan = render.buildMarkers({ grid: flatGrid, layout: geom.layoutOf(flatGrid, 8, 8), tilesets: [], lookup: new Map() }, map, { r0: 0, c0: 0, r1: 8, c1: 9 });
  check("反向验证：关掉环绕后越界那一份不再出现", flatPlan.filter((marker) => marker.id === "m2").length === 1, `${flatPlan.length} 条`);

  // 一格最多一个标记：同格塞两个（绕过 op 校验直接造数据）也只出一条。
  const stacked = doc.createMapDoc("vm2", "同格", 4, 4);
  stacked.markers = [{ id: "m1", r: 1, c: 1, name: "先" }, { id: "m2", r: 1, c: 1, name: "后" }];
  const stackedPlan = render.buildMarkers({ grid, layout: geom.layoutOf(grid, 4, 4), tilesets: [], lookup: new Map() }, stacked, { r0: 0, c0: 0, r1: 4, c1: 4 });
  check("一格最多一个标记（同格重复时只出一条，不会叠两个圈）", stackedPlan.length === 1 && stackedPlan[0].id === "m2", `${stackedPlan.length} 条`);
}

section("11) AI 素材的帧整理（fitFrameToCell / stackFrames / safeAssetStem）");
{
  /** 造一张左下角有记号的位图：`paint(x, y)` 决定颜色，便于逐像素核对。 */
  const makeFrame = (width, height, paint) => {
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b, a] = paint(x, y);
        const offset = (y * width + x) * 4;
        rgba[offset] = r;
        rgba[offset + 1] = g;
        rgba[offset + 2] = b;
        rgba[offset + 3] = a;
      }
    }
    return { width, height, rgba };
  };
  const pixel = (bitmap, x, y) => {
    const offset = (y * bitmap.width + x) * 4;
    return [bitmap.rgba[offset], bitmap.rgba[offset + 1], bitmap.rgba[offset + 2], bitmap.rgba[offset + 3]];
  };

  // ① 等比缩到正好一格：最近邻，左上角那块必须原样搬过去（不插值、不糊边）。
  const solid = makeFrame(64, 64, (x, y) => [x * 4, y * 4, 0, 255]);
  const fitted = tiles.fitFrameToCell(solid, { width: 32, height: 32 });
  check("fitFrameToCell：尺寸正好是目标格子", fitted.width === 32 && fitted.height === 32, `${fitted.width}×${fitted.height}`);
  check("fitFrameToCell：最近邻 —— 源图 (0,0) 原样落在目标 (0,0)", JSON.stringify(pixel(fitted, 0, 0)) === JSON.stringify([0, 0, 0, 255]), JSON.stringify(pixel(fitted, 0, 0)));
  check("fitFrameToCell：目标最后一格取源图对应位置（x=31 → 源 62）", JSON.stringify(pixel(fitted, 31, 0)) === JSON.stringify([248, 0, 0, 255]), JSON.stringify(pixel(fitted, 31, 0)));

  // ② 非正方形源图：**先按目标比例取中心那一块**，不拉伸变形。
  const wide = makeFrame(64, 16, () => [10, 20, 30, 255]);
  const squared = tiles.fitFrameToCell(wide, { width: 32, height: 32 });
  check("fitFrameToCell：宽图先裁中心再缩，尺寸仍是目标尺寸（不拉伸）", squared.width === 32 && squared.height === 32, `${squared.width}×${squared.height}`);

  // ③ 反向验证：换成长宽比对调的格子（16×32），输出尺寸必须跟着格子走。
  const tall = tiles.fitFrameToCell(wide, { width: 16, height: 32 });
  check("反向验证：格子换成 16×32 后输出就是 16×32（尺寸来自参数，不是写死的）", tall.width === 16 && tall.height === 32, `${tall.width}×${tall.height}`);

  // ④ 一列 N 行：总高 = 格子高 × 帧数；第 k 帧落在第 k 行，且顺序不乱。
  const frameRed = makeFrame(8, 8, () => [255, 0, 0, 255]);
  const frameGreen = makeFrame(8, 8, () => [0, 255, 0, 255]);
  const stacked = tiles.stackFrames([frameRed, frameGreen], { width: 8, height: 8 });
  check("stackFrames：2 帧竖排成 8×16（一列两行）", stacked.width === 8 && stacked.height === 16, `${stacked.width}×${stacked.height}`);
  check("stackFrames：第 0 帧在第 0 行、第 1 帧在第 1 行（顺序就是传入顺序）", JSON.stringify(pixel(stacked, 0, 0)) === JSON.stringify([255, 0, 0, 255]) && JSON.stringify(pixel(stacked, 0, 8)) === JSON.stringify([0, 255, 0, 255]), `${JSON.stringify(pixel(stacked, 0, 0))} / ${JSON.stringify(pixel(stacked, 0, 8))}`);
  check("反向验证：把顺序换过来，第 0 行跟着换（不是写死红在上）", JSON.stringify(pixel(tiles.stackFrames([frameGreen, frameRed], { width: 8, height: 8 }), 0, 0)) === JSON.stringify([0, 255, 0, 255]));
  check("stackFrames：空数组明确抛错（不静默产出一张空图）", throws(() => tiles.stackFrames([], { width: 8, height: 8 })));

  // ⑤ 文件名归一：路径分隔 / 控制字符 / 结尾的点 / 超长都要收拾干净。
  check("safeAssetStem：去掉路径分隔符", tiles.safeAssetStem("a/b\\c") === "a b c", tiles.safeAssetStem("a/b\\c"));
  check("safeAssetStem：中文名原样保留（不转拼音、不丢字）", tiles.safeAssetStem("岩浆 纹理") === "岩浆 纹理", tiles.safeAssetStem("岩浆 纹理"));
  check("safeAssetStem：截到 40 字", tiles.safeAssetStem("字".repeat(80)).length === 40, String(tiles.safeAssetStem("字".repeat(80)).length));
  check("safeAssetStem：结尾的点去掉（Windows 上非法）", tiles.safeAssetStem("abc...") === "abc", tiles.safeAssetStem("abc..."));
  check("safeAssetStem：空名退回 ai-asset", tiles.safeAssetStem("   ") === "ai-asset" && tiles.safeAssetStem("") === "ai-asset");

  // ⑥ 「这块素材怎么用」三种形态的目标几何：普通 1×N、整格 4×4、拼块 N×5。
  check(
    "sheetPlanOf：普通 = 1 列 × 帧数（帧就是翻页图的行）",
    (() => { const p = tiles.sheetPlanOf("plain", { width: 32, height: 32 }, 4); return p.cols === 1 && p.rows === 4; })()
  );
  check(
    "sheetPlanOf：整格固定 4×4（帧数被忽略，且至少算 1 块）",
    (() => { const p = tiles.sheetPlanOf("corner16", { width: 32, height: 32 }, 3); return p.cols === 4 && p.rows === 4; })()
  );
  check(
    "sheetPlanOf：拼块 = 变体数列 × 5 行形状",
    (() => { const p = tiles.sheetPlanOf("a2quad", { width: 32, height: 32 }, 3); return p.cols === 3 && p.rows === 5; })()
  );
  check(
    "反向验证：帧数喂 0 也不会算出 0 列（夹到 1）",
    tiles.sheetPlanOf("plain", { width: 8, height: 8 }, 0).rows === 1 && tiles.sheetPlanOf("a2quad", { width: 8, height: 8 }, 0).cols === 1
  );

  // ⑦ stretchToSize：**非等比**缩放（砖 → 一格，保住砖自身的环绕缝）。
  const wide2 = makeFrame(8, 4, (x) => [x * 30, 0, 0, 255]);
  const stretched = tiles.stretchToSize(wide2, 4, 8);
  check("stretchToSize：尺寸就是目标尺寸（宽高各自独立，不像 fitFrameToCell 那样保比例）", stretched.width === 4 && stretched.height === 8, `${stretched.width}×${stretched.height}`);
  check("stretchToSize：起点与各列都按比例映射（8 列 → 4 列取下标 0/2/4/6，与 fitFrameToCell 同一条取整口径，不做中心裁切）", JSON.stringify(pixel(stretched, 0, 0)) === JSON.stringify([0, 0, 0, 255]) && JSON.stringify(pixel(stretched, 3, 0)) === JSON.stringify([180, 0, 0, 255]), `${JSON.stringify(pixel(stretched, 0, 0))} / ${JSON.stringify(pixel(stretched, 3, 0))}`);
  check("反向验证：同一张图交给 fitFrameToCell 会先裁成方形（两者的区别就在这里）", tiles.fitFrameToCell(wide2, { width: 4, height: 4 }).height === 4);

  // ⑧ 收口：整格 / 拼块的「断」边由代码压暗，越靠外越深。
  {
    const flat = makeFrame(16, 16, () => [200, 200, 200, 255]);
    check("capThicknessFor：32 的一格 → 4px；16 的小格 → 2px（跟尺寸走，不是写死）", tiles.capThicknessFor(32) === 4 && tiles.capThicknessFor(16) === 2 && tiles.capThicknessFor(64) === 6, `${tiles.capThicknessFor(32)} / ${tiles.capThicknessFor(16)}`);
    const capped = makeFrame(16, 16, () => [200, 200, 200, 255]);
    tiles.shadeSide(capped, "W", 4);
    check("shadeSide：最外一圈最暗（≈0.35 倍），往内线性回到原色（第 4 列已经不受影响）", pixel(capped, 0, 8)[0] === 70 && pixel(capped, 1, 8)[0] > 70 && pixel(capped, 1, 8)[0] < 200 && pixel(capped, 4, 8)[0] === 200, `${pixel(capped, 0, 8)[0]} / ${pixel(capped, 1, 8)[0]} / ${pixel(capped, 4, 8)[0]}`);
    check("shadeSide：只动被指定的那条边（其它三边原样）", pixel(capped, 15, 8)[0] === 200 && pixel(capped, 8, 0)[0] === 200 && pixel(capped, 8, 15)[0] === 200);
    const cornerShaded = makeFrame(16, 16, () => [200, 200, 200, 255]);
    tiles.shadeCorner(cornerShaded, "NW", 3);
    check("shadeCorner：外角最深、往里两行两列恢复（形状 3 的凹角用）", pixel(cornerShaded, 0, 0)[0] === 70 && pixel(cornerShaded, 2, 2)[0] < 200 && pixel(cornerShaded, 3, 3)[0] === 200 && pixel(cornerShaded, 15, 15)[0] === 200);
    void flat;
  }

  // ⑨ 整格：由**一块砖**拼出 4×4 —— 所有「连」的边都是砖自己的像素（这就是没有接缝的原因）。
  {
    const tile = makeFrame(32, 32, (x, y) => [x * 8, y * 8, 40, 255]);
    const cell = { width: 16, height: 16 };
    const sheet = tiles.corner16SheetFromTile(tile, cell);
    const base = tiles.stretchToSize(tile, cell.width, cell.height);
    const blockAt = (mask) => ({ x: (mask % 4) * cell.width, y: Math.floor(mask / 4) * cell.height });
    check("corner16SheetFromTile：4 格 × 4 格（16 种接法）", sheet.width === 64 && sheet.height === 64, `${sheet.width}×${sheet.height}`);
    check(
      "corner16SheetFromTile：满格（掩码 15）**一点收口都不加**，和砖本身逐像素相同",
      (() => {
        const at = blockAt(15);
        for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) {
          if (JSON.stringify(pixel(sheet, at.x + x, at.y + y)) !== JSON.stringify(pixel(base, x, y))) return false;
        }
        return true;
      })()
    );
    check(
      "corner16SheetFromTile：孤块（掩码 0）四边都压了收口（外圈明显比砖暗）",
      (() => {
        const at = blockAt(0);
        const outer = [pixel(sheet, at.x, at.y)[0], pixel(sheet, at.x + cell.width - 1, at.y)[0], pixel(sheet, at.x, at.y + cell.height - 1)[0], pixel(sheet, at.x + cell.width - 1, at.y + cell.height - 1)[0]];
        const inner = pixel(sheet, at.x + 8, at.y + 8);
        return outer.every((value, index) => value < (index === 0 ? inner[0] : inner[0])) && inner[0] > 40;
      })()
    );
    /**
     * ★ 这条就是这次返工的**守门断言**：一排墙在地图上用到的是掩码 2 / 10 / 8 三块，
     * 它们「连」的那条边必须**逐像素等于砖自己的边**（接缝只可能来自砖自身的环绕缝）。
     */
    /**
     * 取某一块的某条边的像素。⚠️ **只取中段**：两端 `t` 像素会被**相邻那条边的收口**
     * 盖到（拐角本来就是两条收口相交的地方），拿它比会误判成「有接缝」。
     */
    const cap = tiles.capThicknessFor(Math.min(cell.width, cell.height));
    const edgeColumnOf = (mask, side) => {
      const at = blockAt(mask);
      const column = side === "E" ? cell.width - 1 : 0;
      const out = [];
      for (let y = cap; y < cell.height - cap; y++) out.push(pixel(sheet, at.x + column, at.y + y));
      return out;
    };
    const adjacentGap = (left, right) => left.reduce((sum, value, index) => sum + Math.abs(value[0] - right[index][0]) + Math.abs(value[1] - right[index][1]) + Math.abs(value[2] - right[index][2]), 0) / left.length;
    const tileWrapGap = (() => {
      let sum = 0;
      for (let y = 0; y < cell.height; y++) sum += Math.abs(pixel(base, cell.width - 1, y)[0] - pixel(base, 0, y)[0]);
      return sum / cell.height;
    })();
    const runGaps = [adjacentGap(edgeColumnOf(2, "E"), edgeColumnOf(10, "W")), adjacentGap(edgeColumnOf(10, "E"), edgeColumnOf(8, "W"))];
    check(
      "★ 一排墙（掩码 2 → 10 → 8）的拼接处差值 == 砖自身的环绕缝（不再出现「每块各画各的」那种接缝）",
      runGaps.every((gap) => Math.abs(gap - tileWrapGap) < 0.5),
      `拼接处 ${runGaps.map((gap) => gap.toFixed(1)).join(" / ")} vs 砖环绕缝 ${tileWrapGap.toFixed(1)}`
    );
    check("反向验证：孤块被收口的那条边确实与砖不同（收口真的画上去了，不是空操作）", adjacentGap(edgeColumnOf(0, "E"), edgeColumnOf(15, "E")) > 1);
    check("corner16SheetFromTile：给 2 张明确抛错（多给一定是形态判断错了）", throws(() => tiles.composeAssetSheet([tile, tile], tiles.sheetPlanOf("corner16", cell, 1))));
  }

  // ⑩ 拼块：由每个变体一块砖拼出 N 列 × 5 行，小格按自己那一侧加收口。
  {
    const redTile = makeFrame(16, 16, () => [255, 0, 0, 255]);
    const greenTile = makeFrame(16, 16, () => [0, 255, 0, 255]);
    const cell = { width: 16, height: 16 };
    const sheet = tiles.composeAssetSheet([redTile, greenTile], tiles.sheetPlanOf("a2quad", cell, 2));
    check("composeAssetSheet（拼块）：2 块砖 → 2 列 × 5 行 = 32×80", sheet.width === 32 && sheet.height === 80, `${sheet.width}×${sheet.height}`);
    check(
      "拼块：满格行（形状 4）没有收口 —— 那是调色板缩略图用的那一行，必须就是砖本身",
      JSON.stringify(pixel(sheet, 3, 4 * cell.height + 3)) === JSON.stringify([255, 0, 0, 255]) && JSON.stringify(pixel(sheet, cell.width + 3, 4 * cell.height + 3)) === JSON.stringify([0, 255, 0, 255])
    );
    check(
      "拼块：形状 0（两边都不接）的左上小格，上边与左边都被压暗（≤ 一半亮度）",
      pixel(sheet, 0, 0)[0] <= 130 && pixel(sheet, 8, 0)[0] <= 130 && pixel(sheet, 4, 4)[0] === 255
    );
    check(
      "拼块：形状 2（横向接、纵向不接）只压上下两边，左右两边保持原色（横向一排草地不会有缝）",
      // 左边界取**中段**：两端会被上下那两条收口盖住，那是拐角该有的样子。
      pixel(sheet, 0, 2 * cell.height + 8)[0] === 255 &&
        pixel(sheet, cell.width - 1, 2 * cell.height + 8)[0] === 255 &&
        pixel(sheet, 3, 2 * cell.height + 4)[0] === 255
    );
    check(
      "拼块：形状 1（纵向接、横向不接）只压左右两边（上下两边在中段保持原色）",
      pixel(sheet, 0, 1 * cell.height + 8)[0] < 255 && pixel(sheet, 4, 1 * cell.height + 8)[0] === 255
    );
    check(
      "拼块：形状 3 在象限外角多一块凹角收口（否则形状 3 和满格完全一样）",
      (() => {
        const rowTop = 3 * cell.height;
        // 左上小格的外角（0,0）应被压暗；同一小格靠内的像素不受影响
        return pixel(sheet, 0, rowTop)[0] <= 130 && pixel(sheet, 4, rowTop + 4)[0] === 255;
      })()
    );
    check("拼块：同一条横向接边的两侧像素一致（相邻两格之间不会有缝）", (() => {
      // 形状 2 与形状 4 在「横边」上都不收口：取两者的小格右边界比对
      const a = pixel(sheet, 7, 2 * cell.height + 8);
      const b = pixel(sheet, 7, 4 * cell.height + 8);
      return JSON.stringify(a) === JSON.stringify(b);
    })());
    check("反向验证：拼块给 1 张就是 1 列（不是 5 列）", tiles.composeAssetSheet([redTile], tiles.sheetPlanOf("a2quad", cell, 1)).width === 16);
  }

  // ⑪ 砖自身的环绕缝：量得出来才能提醒用户 / agent 重画。
  {
    const seamless = makeFrame(16, 16, (x) => [x < 8 ? 100 : 100, 100, 100, 255]);
    const ratios = tiles.tileSeamRatios(seamless);
    check("tileSeamRatios：纯色砖的环绕缝 ≈ 1（无缝）", ratios.horizontal < 1.2 && ratios.vertical < 1.2, `横 ${ratios.horizontal.toFixed(2)} / 纵 ${ratios.vertical.toFixed(2)}`);
    const broken = makeFrame(16, 16, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const bad = tiles.tileSeamRatios(broken);
    check("tileSeamRatios：左白右黑那种接不上自己的砖，比值远大于 1（能报出来）", bad.horizontal > 5, `横 ${bad.horizontal.toFixed(2)}`);
    check("反向验证：把最左一列改成与最右一列同色，比值立刻掉下来", tiles.tileSeamRatios(makeFrame(16, 16, () => [0, 0, 0, 255])).horizontal < 1.2);
  }

  // ⑫ 素材自己的播放速度：归一化（越界 / 乱码一律抛错，不静默夹到边界）。
  {
    check("parseAssetFps：留空 / null / 空串 = 跟全局（返回 undefined）", tiles.parseAssetFps(undefined) === undefined && tiles.parseAssetFps(null) === undefined && tiles.parseAssetFps("") === undefined);
    check("parseAssetFps：数字原样（0.5 / 1 / 4 / 30 都在范围内）", tiles.parseAssetFps(0.5) === 0.5 && tiles.parseAssetFps(1) === 1 && tiles.parseAssetFps(4) === 4 && tiles.parseAssetFps(30) === 30);
    check("parseAssetFps：字符串数字也收（对话面传过来的可能是字符串）", tiles.parseAssetFps("6") === 6);
    check("反向验证：越界抛错（不是夹到 0.5 / 30）", throws(() => tiles.parseAssetFps(0)) && throws(() => tiles.parseAssetFps(31)) && throws(() => tiles.parseAssetFps(-1)));
    check("反向验证：乱码抛错", throws(() => tiles.parseAssetFps("快")) && throws(() => tiles.parseAssetFps(Number.NaN)));
    check("parseAssetFps：小数保留两位（2.345 → 2.35）", tiles.parseAssetFps(2.345) === 2.35, String(tiles.parseAssetFps(2.345)));
  }

  // ⑪d 整图（多格印花）：规格、旋转占格、烘焙排版、切块
  {
    const spec = tiles.parseStampSpec({ cols: 4, rows: 3, frames: 2, pass: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2] });
    check("parseStampSpec：4×3、2 帧、12 格区域都收下来", spec.cols === 4 && spec.rows === 3 && spec.frames === 2 && spec.pass.length === 12, JSON.stringify(spec));
    check("parseStampSpec：没给 cols/rows = 不是整图（返回 undefined）", tiles.parseStampSpec(undefined) === undefined && tiles.parseStampSpec({}) === undefined);
    check("parseStampSpec：区域缺省 = 0（不可通过）", tiles.parseStampSpec({ cols: 2, rows: 2 }).pass.every((value) => value === 0));
    /**
     * 占格的上下限：下限 1（1×1 = 一格一张图）；上限是**地图自己**（由 `assertStampFitsProject` 按项目校验），
     * 这里只留一道「别把 9999 传进来」的硬上限（512）。所以 9 格现在是**合法**的。
     */
    check("占格下限是 1（1×1 = 一格一张图，带上通行区域 / 可旋转）", tiles.parseStampSpec({ cols: 1, rows: 1 }).cols === 1 && tiles.parseStampSpec({ cols: 1, rows: 3 }).rows === 3);
    check("反向验证：占格 < 1 抛错（0 / 负数不是一张图）", throws(() => tiles.parseStampSpec({ cols: 0, rows: 3 })) && throws(() => tiles.parseStampSpec({ cols: 3, rows: -1 })));
    check("占格 9 现在合法（旧限制是 8，地图够大就该允许）", tiles.parseStampSpec({ cols: 9, rows: 3 }).cols === 9);
    check("占格超过硬上限（512）抛错", throws(() => tiles.parseStampSpec({ cols: 513, rows: 3 })));
    check("★ assertStampFitsProject：比地图大就抛错，和地图一样大可以", (() => {
      const spec = tiles.parseStampSpec({ cols: 12, rows: 10 });
      let threw = false;
      try {
        tiles.assertStampFitsProject(spec, 12, 10);
      } catch {
        threw = true;
      }
      let small = false;
      try {
        tiles.assertStampFitsProject(spec, 11, 10);
      } catch {
        small = true;
      }
      return threw === false && small === true;
    })());
    check("反向验证：帧数越界抛错", throws(() => tiles.parseStampSpec({ cols: 3, rows: 3, frames: 0 })) && throws(() => tiles.parseStampSpec({ cols: 3, rows: 3, frames: 17 })));
    check("反向验证：区域只能是 0/1/2（3 抛错，不静默当成不可通过）", throws(() => tiles.parseStampSpec({ cols: 2, rows: 2, pass: [0, 0, 3, 0] })));

    check("stampSpan：0/2 档 = 原样，1/3 档长宽互换", JSON.stringify(tiles.stampSpan(spec, 0)) === JSON.stringify({ cols: 4, rows: 3 }) && JSON.stringify(tiles.stampSpan(spec, 1)) === JSON.stringify({ cols: 3, rows: 4 }) && JSON.stringify(tiles.stampSpan(spec, 3)) === JSON.stringify({ cols: 3, rows: 4 }));
    check("stampSpan：转满一圈回到原样（4 档 = 0 档）", JSON.stringify(tiles.stampSpan(spec, 4)) === JSON.stringify(tiles.stampSpan(spec, 0)));

    const blocks = tiles.stampBlocks(spec);
    check("stampBlocks：每帧 4 块（2 帧 = 8 块），顺序是帧 → 旋转", blocks.length === 8 && blocks[0].rot === 0 && blocks[4].frame === 1, blocks.map((block) => `${block.frame}/${block.rot}`).join(" "));
    check("stampBlocks：竖排的 y 累加正确（4×3 → 3+4+3+4 = 14 格一帧）", blocks[0].y === 0 && blocks[1].y === 3 && blocks[2].y === 7 && blocks[3].y === 10 && blocks[4].y === 14, blocks.map((block) => block.y).join(","));
    check("stampSheetCells：宽度取长边、高度 = 帧数 × 14", JSON.stringify(tiles.stampSheetCells(spec)) === JSON.stringify({ cols: 4, rows: 28 }));

    const stampTiles = tiles.buildTiles({ shape: "stamp", cell: { width: 10, height: 10 }, imageWidth: 40, imageHeight: 280, stamp: spec });
    // 每帧 = (3×4) + (4×3) + (3×4) + (4×3) = 48 块；2 帧 = 96。
    check("buildTiles(整图)：块数 = 每帧 48 块 × 2 帧 = 96", stampTiles.length === 96, String(stampTiles.length));
    check("buildTiles(整图)：每块都带 frame / rot / r / c 元数据", stampTiles.every((tile) => tile.stamp !== undefined && Number.isInteger(tile.stamp.r) && Number.isInteger(tile.stamp.c)));
    const rot1First = stampTiles.find((tile) => tile.stamp.rot === 1 && tile.stamp.r === 0 && tile.stamp.c === 0);
    check("buildTiles(整图)：转 90° 那块从第 3 行开始（rot0 占 3 行）", rot1First !== undefined && rot1First.rect.y === 30 && rot1First.rect.x === 0, JSON.stringify(rot1First?.rect));

    /** 烘焙：每格不同颜色 → 看旋转后哪一格跑到左上角。 */
    const cols = 4, rows = 3, size = 4;
    const source = { width: cols * size, height: rows * size, rgba: Buffer.alloc(cols * size * rows * size * 4) };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const offset = ((r * size + y) * cols * size + c * size + x) * 4;
            source.rgba[offset] = 20 + c * 50;
            source.rgba[offset + 1] = 20 + r * 60;
            source.rgba[offset + 2] = 100;
            source.rgba[offset + 3] = 255;
          }
        }
      }
    }
    const baked = tiles.bakeStampSheet(source, { cols, rows, frames: 1, pass: new Array(12).fill(0) }, { width: size, height: size });
    const blockAt = (rot, r, c) => {
      const block = tiles.stampBlocks({ cols, rows, frames: 1, pass: new Array(12).fill(0) })[rot];
      const offset = (((block.y + r) * size) * baked.width + c * size) * 4;
      return [baked.rgba[offset], baked.rgba[offset + 1]];
    };
    check("bakeStampSheet：0 档左上角 = 源图左上角", JSON.stringify(blockAt(0, 0, 0)) === JSON.stringify([20, 20]), JSON.stringify(blockAt(0, 0, 0)));
    check("★ bakeStampSheet：顺时针 90° 后左上角 = 源图**左下角**（第 3 行第 1 列）", JSON.stringify(blockAt(1, 0, 0)) === JSON.stringify([20, 140]), JSON.stringify(blockAt(1, 0, 0)));
    check("★ bakeStampSheet：180° 后左上角 = 源图右下角", JSON.stringify(blockAt(2, 0, 0)) === JSON.stringify([170, 140]), JSON.stringify(blockAt(2, 0, 0)));
    check("bakeStampSheet：270° 后左上角 = 源图右上角", JSON.stringify(blockAt(3, 0, 0)) === JSON.stringify([170, 20]), JSON.stringify(blockAt(3, 0, 0)));
    check("bakeStampSheet：旋转后的块宽高互换（1 档 = 3 列 × 4 行）", tiles.stampBlocks({ cols, rows, frames: 1, pass: new Array(12).fill(0) })[1].cols === 3 && tiles.stampBlocks({ cols, rows, frames: 1, pass: new Array(12).fill(0) })[1].rows === 4);

    const plan = tiles.sheetPlanOf("stamp", { width: 8, height: 8 }, 1, spec);
    /**
     * ⚠️ `sheetPlanOf` 描述的是 **composeMapAsset 产出的源图**：`cols × rows*frames` 格，
     * **不含**旋转烘焙（烘焙在导入端；两边都烘就会把 4 个旋转叠起来的图再压一次）。
     */
    check("sheetPlanOf(整图)：源图几何 = 4 列 × (3 行 × 2 帧 = 6 行)，不含旋转", plan.cols === 4 && plan.rows === 6, `${plan.cols}×${plan.rows}`);
    check("stampSourceCells 与 stampSheetCells 是两件事（源图 vs 成品）", JSON.stringify(tiles.stampSourceCells(spec)) === JSON.stringify({ cols: 4, rows: 6 }) && JSON.stringify(tiles.stampSheetCells(spec)) === JSON.stringify({ cols: 4, rows: 28 }));
    const layout = tiles.layoutFor("stamp", { width: 8, height: 8 }, 32, 224, spec);
    check("layoutFor(整图)：切分数与规格一致", layout.cols === 4 && layout.rows === 28 && layout.count === 112, JSON.stringify({ cols: layout.cols, rows: layout.rows, count: layout.count }));
    check("反向验证：整图没给规格时 layoutFor / buildTiles 明确抛错（不猜一个几何出来）", throws(() => tiles.layoutFor("stamp", { width: 8, height: 8 }, 32, 224)) && throws(() => tiles.buildTiles({ shape: "stamp", cell: { width: 8, height: 8 }, imageWidth: 32, imageHeight: 224 })));
  }

  // ⑪b 方向感知：竖段换向 + 转角斜接（否则「竖着的墙花纹接不上、拐角没拐角」）
  {
    /** 2×3 的标记图：左上=1、右上=2、左下=3、右下=4、中间=5、右上角… 用单通道值当指纹。 */
    const marker = { width: 2, height: 3, rgba: Buffer.alloc(2 * 3 * 4) };
    for (let i = 0; i < 6; i++) marker.rgba[i * 4] = i + 1;
    const cw = tiles.rotate90(marker, true);
    check("rotate90：宽高互换（2×3 → 3×2）", cw.width === 3 && cw.height === 2, `${cw.width}×${cw.height}`);
    // 顺时针：新的左上角来自原图的**左下角**（(0, h-1) = 第 5 格，值 5）。
    check("rotate90：顺时针把左下角转到左上角", cw.rgba[0] === 5, String(cw.rgba[0]));
    check("rotate90：转两次 = 转 180°（每个像素都对）", JSON.stringify([...tiles.rotate90(tiles.rotate90(marker, true), true).rgba]) === JSON.stringify([...tiles.rotate90(tiles.rotate90(marker, false), false).rgba]));
    check("rotate90：逆时针 = 顺时针转三次", JSON.stringify([...tiles.rotate90(marker, false).rgba]) === JSON.stringify([...tiles.rotate90(tiles.rotate90(tiles.rotate90(marker, true), true), true).rgba]));

    // 斜接：左半红、右半蓝两块平色，转角（N+W）那一侧应当取竖直那版。
    const flat = (r, g, b) => { const rgba = Buffer.alloc(8 * 8 * 4); for (let i = 0; i < 8 * 8; i++) { rgba[i*4]=r; rgba[i*4+1]=g; rgba[i*4+2]=b; rgba[i*4+3]=255; } return { width: 8, height: 8, rgba }; };
    const horizontal = flat(200, 40, 40), vertical = flat(40, 40, 200);
    const joined = tiles.joinCorner(horizontal, vertical, "N", "W", 1);
    const px = (b, x, y) => { const o = (y * b.width + x) * 4; return [b.rgba[o], b.rgba[o+1], b.rgba[o+2]]; };
    check("joinCorner：靠角（左上）那块取竖直方向的砖", px(joined, 0, 0)[2] > 150 && px(joined, 0, 0)[0] < 120, JSON.stringify(px(joined, 0, 0)));
    check("joinCorner：远离角（右下）那块用水平方向的砖", px(joined, 7, 7)[0] > 150 && px(joined, 7, 7)[2] < 120, JSON.stringify(px(joined, 7, 7)));
    // 斜接线从 N 中点 (3.5,0) 到 W 中点 (0,3.5)：找整张图最亮的那个像素，它必须在线上（红 200×1.28 会夹到 255）。
    let brightest = { value: -1, x: 0, y: 0 };
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const value = px(joined, x, y)[0]; if (value > brightest.value) brightest = { value, x, y }; }
    check("joinCorner：斜接线上提亮（不是一道黑缝）", brightest.value > 240 && brightest.x + brightest.y <= 5, JSON.stringify(brightest));

    /** 条纹砖：横条纹时，竖着走的那一段必须变成竖条纹。 */
    const striped = { width: 16, height: 16, rgba: Buffer.alloc(16 * 16 * 4) };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = (y*16+x)*4; const on = Math.floor(y / 4) % 2 === 0; striped.rgba[o] = on ? 240 : 30; striped.rgba[o+1] = on ? 220 : 40; striped.rgba[o+2] = 60; striped.rgba[o+3] = 255; }
    const sheet = tiles.corner16SheetFromTile(striped, { width: 16, height: 16 }, "sharp");
    const blockOf = (mask) => { const rgba = Buffer.alloc(16 * 16 * 4); for (let y = 0; y < 16; y++) { const from = (((Math.floor(mask / 4) * 16) + y) * sheet.width + (mask % 4) * 16) * 4; sheet.rgba.copy(rgba, y * 16 * 4, from, from + 16 * 4); } return { width: 16, height: 16, rgba }; };
    /** 沿 x 方向的变化量 vs 沿 y 方向的变化量：横条纹的 y 变化大，转 90° 后反过来。 */
    const variation = (b) => { let dx = 0, dy = 0, n = 0; for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) { const o=(y*16+x)*4; dx += Math.abs(b.rgba[o]-b.rgba[o-4]); dy += Math.abs(b.rgba[o]-b.rgba[o-64]); n++; } return { dx: dx/n, dy: dy/n }; };
    const horizontalRun = variation(blockOf(10)); // E+W：横着走
    const verticalRun = variation(blockOf(5));    // N+S：竖着走
    check("mask 10（横着走）保持横条纹：纵向变化明显大于横向", horizontalRun.dy > horizontalRun.dx * 2, JSON.stringify(horizontalRun));
    check("★ mask 5（竖着走）换向 90°：变成竖条纹（横向变化 > 纵向）", verticalRun.dx > verticalRun.dy * 2, JSON.stringify(verticalRun));
    check("★ 转角块（N+W）和直墙块不一样（斜接真的画进去了）", JSON.stringify([...blockOf(9).rgba]) !== JSON.stringify([...blockOf(15).rgba]));
    check("反向验证：十字块（15）与直线块（10）的中间几列像素一致（不该被乱动）", (() => { const a = blockOf(15), b = blockOf(10); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) { const o=(y*16+x)*4; if (a.rgba[o] !== b.rgba[o]) return false; } return true; })());
  }

  // ⑪c 自动裁边：模型爱在四周留一圈白边，裁的时候不能把内容裁坏
  {
    /** 白边框 + 深色内容（真实素材就是这种）。 */
    const framed = makeFrame(200, 180, (x, y) => ((x < 8 || y < 8 || x >= 192 || y >= 172) ? [248, 248, 246, 255] : [20 + ((x * 7 + y * 3) % 40), 30 + ((x * 5) % 40), 60, 255]));
    const trimmed = tiles.trimUniformBorder(framed);
    // 8px 白边 + 1% 的安全内缩（200×180 → 2px）→ 每边 10px。
    check("trimUniformBorder：白边框被裁掉（200×180 → 180×160，四边各 8px + 1% 内缩）", trimmed.bitmap.width === 180 && trimmed.bitmap.height === 160 && trimmed.left === 10 && trimmed.top === 10 && trimmed.right === 10 && trimmed.bottom === 10, `${trimmed.bitmap.width}×${trimmed.bitmap.height} / ${trimmed.left},${trimmed.top},${trimmed.right},${trimmed.bottom}`);
    check("裁完左上角就是原来的内容（不是白边）", JSON.stringify(pixel(trimmed.bitmap, 0, 0)) !== JSON.stringify([248, 248, 246, 255]), JSON.stringify(pixel(trimmed.bitmap, 0, 0)));
    const solid = tiles.trimUniformBorder(makeFrame(64, 64, () => [120, 60, 30, 255]));
    check("反向验证：整张纯色不裁（里面没有「内容」，裁了就成洞）", solid.left + solid.top + solid.right + solid.bottom === 0 && solid.bitmap.width === 64);
    const darkBackground = tiles.trimUniformBorder(makeFrame(128, 128, (x, y) => ((x < 10 || y < 10 || x >= 118 || y >= 118) ? [18, 18, 22, 255] : [200, 120, 40, 255])));
    check("反向验证：深色平底不裁（那是道具自己的背景，属于内容）", darkBackground.left + darkBackground.top + darkBackground.right + darkBackground.bottom === 0);
    const edgeToEdge = tiles.trimUniformBorder(makeFrame(96, 96, (x, y) => [((x * 13 + y * 7) % 200) + 20, 90, 140, 255]));
    check("反向验证：铺满纹理的图不裁（一条纯色带都没有）", edgeToEdge.bitmap.width === 96 && edgeToEdge.left === 0);
    const thinFrame = tiles.trimUniformBorder(makeFrame(100, 100, (x, y) => ((x < 3 || y < 3 || x >= 97 || y >= 97) ? [255, 255, 255, 255] : [40, 80, 120, 255])));
    // 3px 白边 + 1px 内缩 = 4px（100 → 92）。
    check("薄边框（3px，加 1% 内缩共 4px）也能裁掉", thinFrame.left === 4 && thinFrame.top === 4 && thinFrame.bitmap.width === 92, `${thinFrame.left} / ${thinFrame.bitmap.width}`);
    const wide = tiles.trimUniformBorder(makeFrame(100, 100, (x, y) => ((x < 20 || y < 20 || x >= 80 || y >= 80) ? [250, 250, 250, 255] : [30, 60, 90, 255])));
    check("反向验证：白边超过 6% 就不当边框（那是背景，不是画布边）", wide.left === 0 && wide.bitmap.width === 100, `${wide.left} / ${wide.bitmap.width}`);
  }

  // ⑫a 循环方式：正放 / 倒放 / 来回（只是把帧序展开，客户端不用改）
  {
    check("parseAssetLoop：留空 = 正放（默认），三种值都收", tiles.parseAssetLoop(undefined) === "forward" && tiles.parseAssetLoop("") === "forward" && tiles.parseAssetLoop("reverse") === "reverse" && tiles.parseAssetLoop("pingpong") === "pingpong");
    check("反向验证：未知循环方式抛错（不静默回落成正放）", throws(() => tiles.parseAssetLoop("yoyo")));

    const frames = [10, 20, 30, 40];
    check("applyLoop：正放原样", JSON.stringify(tiles.applyLoop(frames, "forward")) === JSON.stringify([10, 20, 30, 40]));
    check("applyLoop：倒放就是反过来", JSON.stringify(tiles.applyLoop(frames, "reverse")) === JSON.stringify([40, 30, 20, 10]));
    check(
      "applyLoop：来回 = 正放 + 去掉首尾的倒放（0→1→2→3→2→1）",
      JSON.stringify(tiles.applyLoop(frames, "pingpong")) === JSON.stringify([10, 20, 30, 40, 30, 20]),
      JSON.stringify(tiles.applyLoop(frames, "pingpong"))
    );
    check("applyLoop：两帧时来回 == 正放（不会多出一帧重复）", JSON.stringify(tiles.applyLoop([1, 2], "pingpong")) === JSON.stringify([1, 2]));
    check("applyLoop：单帧不动、空数组也不炸", JSON.stringify(tiles.applyLoop([7], "pingpong")) === JSON.stringify([7]) && JSON.stringify(tiles.applyLoop([], "reverse")) === JSON.stringify([]));
    check("反向验证：来回的长度 = 2n-2（4 帧 → 6 条）", tiles.applyLoop(frames, "pingpong").length === 6);
  }

  // ⑫b 清晰度：把大图缩到格子时用哪种重采样（真机反馈「出来的图不清晰」）
  {
    check("parseClarity：留空 = 平滑（默认），三种值都收", tiles.parseClarity(undefined) === "smooth" && tiles.parseClarity("") === "smooth" && tiles.parseClarity("sharp") === "sharp" && tiles.parseClarity("crisp") === "crisp");
    check("反向验证：未知清晰度抛错（不静默回落成默认）", throws(() => tiles.parseClarity("blur")));
    check("parseAssetScale：留空 = 1，1~8 的整数都收", tiles.parseAssetScale(undefined) === 1 && tiles.parseAssetScale("4") === 4 && tiles.parseAssetScale(8) === 8);
    check("反向验证：倍数越界 / 小数 / 乱码抛错", throws(() => tiles.parseAssetScale(0)) && throws(() => tiles.parseAssetScale(9)) && throws(() => tiles.parseAssetScale(2.5)) && throws(() => tiles.parseAssetScale("x")));

    /** 1px 棋盘格（红 / 绿）64×64：缩到 16×16 时三种算法的结果必须明显不同。 */
    const checker = makeFrame(64, 64, (x, y) => ((x + y) % 2 === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
    const isPure = (value) => (value[0] === 255 && value[1] === 0) || (value[0] === 0 && value[1] === 255);
    const countPure = (bitmap) => {
      let pure = 0;
      for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) if (isPure(pixel(bitmap, x, y))) pure++;
      return pure;
    };
    const nearest = tiles.resampleToSize(checker, 16, 16, "sharp");
    const boxed = tiles.resampleToSize(checker, 16, 16, "smooth");
    check("resampleToSize：三种方式都产出目标尺寸", nearest.width === 16 && boxed.width === 16 && tiles.resampleToSize(checker, 16, 16, "crisp").width === 16);
    check("★ 锐利（最近邻）：64→16 只取每 4 个像素里的 1 个，缩完还是纯色", countPure(nearest) === 16 * 16, `${countPure(nearest)}/256 纯色`);
    check("★ 平滑（面积平均）：每个目标像素 = 4×4 块的平均 → 纯色一个不剩", countPure(boxed) === 0, `${countPure(boxed)}/256 纯色`);
    check("平滑出来的值就是「一半红一半绿」（128,128,0 —— 8 红 8 绿取平均）", JSON.stringify(pixel(boxed, 8, 8)) === JSON.stringify([128, 128, 0, 255]), JSON.stringify(pixel(boxed, 8, 8)));
    check("反向验证：锐利与平滑在同一处取到的值确实不同", JSON.stringify(pixel(nearest, 8, 8)) !== JSON.stringify(pixel(boxed, 8, 8)));

    /** 波纹：面积平均保留波形，锐化把振幅拉大。 */
    const wave = makeFrame(64, 64, (x) => {
      const value = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.sin((2 * Math.PI * x) / 16))));
      return [value, value, value, 255];
    });
    const contrastOf = (bitmap) => {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 1; x < bitmap.width; x++) {
          sum += Math.abs(pixel(bitmap, x, y)[0] - pixel(bitmap, x - 1, y)[0]);
          count++;
        }
      }
      return count === 0 ? 0 : sum / count;
    };
    const smoothWave = tiles.resampleToSize(wave, 16, 16, "smooth");
    const crispWave = tiles.resampleToSize(wave, 16, 16, "crisp");
    check("★ 清晰（平均 + 锐化）比平滑的局部对比更强", contrastOf(crispWave) > contrastOf(smoothWave), `平滑 ${contrastOf(smoothWave).toFixed(1)} < 清晰 ${contrastOf(crispWave).toFixed(1)}`);

    // 不缩小（或已经一样大）时：三种方式都一样，且不复制出错。
    const same = tiles.resampleToSize(checker, 64, 64, "smooth");
    check("尺寸一样时原样返回（不缩放、不糊）", same.width === 64 && JSON.stringify(pixel(same, 3, 3)) === JSON.stringify(pixel(checker, 3, 3)));
    const upscaled = tiles.resampleToSize(makeFrame(4, 4, (x, y) => [x * 60, y * 60, 0, 255]), 16, 16, "smooth");
    check("放大时退回最近邻（插值放大只会更糊）", JSON.stringify(pixel(upscaled, 15, 15)) === JSON.stringify(pixel(upscaled, 12, 12)));

    /**
     * 抠过像的素材：alpha 必须**预乘**再平均。
     *
     * 夹具：3 列不透明白 + 1 列「透明黑」，8→2 时左边那个目标像素覆盖到这三白一黑。
     * 预乘再平均 → 红色仍是 255（只是 alpha 变 191）；不预乘 → 红色被拉成 191（一圈发黑）。
     */
    const withAlpha = makeFrame(8, 8, (x) => (x < 3 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const alphaFitted = tiles.resampleToSize(withAlpha, 2, 2, "smooth");
    check(
      "平滑：透明边缘预乘 alpha 再平均（颜色不会被透明像素的黑色拖暗）",
      pixel(alphaFitted, 0, 0)[0] > 240 && pixel(alphaFitted, 0, 0)[3] > 180 && pixel(alphaFitted, 1, 0)[3] === 0,
      JSON.stringify(pixel(alphaFitted, 0, 0))
    );
  }

  // ⑬ composeAssetSheet：三种形态的最终几何与排布。
  const redFrame = makeFrame(8, 8, () => [255, 0, 0, 255]);
  const greenFrame = makeFrame(8, 8, () => [0, 255, 0, 255]);
  const plainSheet = tiles.composeAssetSheet([redFrame, greenFrame], tiles.sheetPlanOf("plain", { width: 8, height: 8 }, 2));
  check("composeAssetSheet（普通）：2 张 → 8×16 一列两行，顺序不乱", plainSheet.width === 8 && plainSheet.height === 16 && JSON.stringify(pixel(plainSheet, 0, 0)) === JSON.stringify([255, 0, 0, 255]) && JSON.stringify(pixel(plainSheet, 0, 8)) === JSON.stringify([0, 255, 0, 255]));
  check("composeAssetSheet：空数组明确抛错", throws(() => tiles.composeAssetSheet([], tiles.sheetPlanOf("plain", { width: 8, height: 8 }, 1))));
}

section("12) 客户端静态约束（文本检查）");
{
  const clientText = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
  check(
    "浏览器半区没有自己实现变体挑选 / 绘制顺序 / chunk 计算",
    !clientText.includes("function MAP_pickVariant") &&
      !clientText.includes("function MAP_drawOrder") &&
      !clientText.includes("function MAP_visibleChunks"),
    "变体、顺序、chunk 一律由宿主计划给出"
  );
  check(
    "浏览器半区仍复刻着坐标函数",
    clientText.includes("function MAP_pointToCell") && clientText.includes("function MAP_cellTopLeft")
  );

  // 术语黑名单只扫**模块六那一段**：`图集`（Spine 纹理图集）与 `等距`（45° 地块）
  // 在别的模块里是正确用词，全文件扫会误伤 —— 而模块六的实际代码就在 `模块②：图片生成`
  // **之前**，所以切片终点取「锚点之后的下一条 `// ──` 分节注释」，别再去 indexOf 另一个模块名
  // （那会命中文件更靠前的同名字符串，切出空段 → 黑名单变成假绿）。
  const start = clientText.indexOf("模块六 · 地图编辑器");
  const after = start < 0 ? -1 : clientText.indexOf("\n    // ──", start + 20);
  const sectionText = start < 0 ? "" : clientText.slice(start, after > start ? after : undefined);
  check(
    "模块六段落的切片锚点还在、且切出了足量内容（否则下面的黑名单会假绿）",
    sectionText.length > 20000,
    `start=${start} end=${after} 长度=${sectionText.length}`
  );
  for (const word of ["地形族", "掩码", "优先级", "切分", "图集", "变体种子", "高度偏移", "Tiled", "等距"]) {
    const hit = sectionText.includes(word);
    check(`模块六界面源码里不出现旧术语「${word}」`, !hit, hit ? "命中旧术语" : "");
  }
  // `chunk` 单独用词边界判：宿主协议里的字段名就是 `chunks`，那是**协议**不是界面术语，
  // 禁掉它只会逼出 `"chu" + "nks"` 这类为了骗过自检的写法（真出现过），反而更坏。
  {
    const hit = /\bchunk\b/.test(sectionText);
    check("模块六界面源码里不出现旧术语「chunk」（协议字段 chunks 除外）", !hit, hit ? "命中旧术语" : "");
  }
  check(
    "（对照）整份客户端里仍然允许别处出现「图集」/「等距」（模块④ / 模块⑤ 的正确用词）",
    clientText.length > sectionText.length
  );
}

// ── 13) 已带透明通道的整图：不要按颜色再抠一遍 ──────────────────────────
{
  section("13) 透明通道整图（Seedream 5.5 / 自备透明 PNG）");
  const transparent = { width: 8, height: 8, rgba: Buffer.alloc(8 * 8 * 4, 0) };
  for (let i = 0; i < 16; i++) {
    const p = i * 4;
    transparent.rgba[p] = 240;
    transparent.rgba[p + 1] = 240;
    transparent.rgba[p + 2] = 240;
    transparent.rgba[p + 3] = 255;
  }
  let called = 0;
  const skipped = tiles.keyStampBackground(transparent, () => {
    called++;
    return { rgba: transparent.rgba, backgroundFraction: 1 };
  });
  check("已带 alpha 的整图跳过绿幕抠像", skipped.alpha === true && called === 0 && skipped.keyed === 0);
  check("跳过抠像时原图字节原样保留", skipped.bitmap === transparent);
  const opaque = { width: 8, height: 8, rgba: Buffer.alloc(8 * 8 * 4, 255) };
  let opaqueCalled = 0;
  const keyed = tiles.keyStampBackground(opaque, () => {
    opaqueCalled++;
    return { rgba: opaque.rgba, backgroundFraction: 0.5 };
  });
  check("没有 alpha 的整图仍然按颜色抠", opaqueCalled === 1 && keyed.keyed === 0.5 && keyed.alpha !== true);
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${passed} 项通过${failures.length > 0 ? `，${failures.length} 项失败` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
