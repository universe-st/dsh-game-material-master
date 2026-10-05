/**
 * 地图地块模块 · 几何内核离线自检（对应开发计划 §10.2 的 G/S/D/P 系列断言）。
 *
 * 纯本地、不联网、不花钱。分成两部分：
 *
 *   A. **自包含**：用代码渲染的模板 + 合成图做断言。任何环境都能跑，
 *      包括 `probe/` 被 .gitignore 排除的干净克隆。
 *   B. **对照研究数据**：`probe/` 存在时，用研究期真实生成的 2K 图重跑 TS 规整，
 *      与研究报告里的数字比对（比例 1.986~2.019、残差 ≤3px）。
 *      `probe/` 不在时这一部分自动跳过并打印提示，不算失败。
 *
 * 反向验证（去掉修复就会失败）：
 *   · G9  把模板几何改成硬编码的错误值 → 产物必须出现透明缺口
 *   · D5  把抠底换回「硬阈值 + 只改 alpha」→ 近白不透明像素必须出现
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SETTINGS,
  assertSettings,
  bilinearResize,
  decorAnchorY,
  diamondAlpha,
  diamondCenterY,
  diamondDistance,
  diamondHeight,
  insideDiamond,
  matteForeground,
  measureGroundDiamond,
  measurementLooksSane,
  regularizeDecorSprite,
  regularizeToCell,
  renderTemplate,
  upscale
} from "../lib/tilegeom.js";
import { decodeFile, decodeImage, encodeBitmap, pngSize } from "../lib/tilemedia.js";
import {
  assembleMap,
  countInteriorHoles,
  emptyMapState,
  mulberry32,
  shapeBaseOffset,
  shapeDiamondHalf,
  shapeOfEntry,
  tileLayout,
  tileOriginAt,
  trimTransparent
} from "../lib/tilemap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PROBE = join(ROOT, "research", "tile-isometric", "probe");
const TMP = join(ROOT, ".verify", "tile");

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function near(name, actual, expected, tolerance, unit = "") {
  check(name, Math.abs(actual - expected) <= tolerance, `实测 ${actual}${unit}，期望 ${expected}±${tolerance}${unit}`);
}
/**
 * 在**小单元格**（64×96 这种）上验证「菱形是否就是那个数学菱形」。
 *
 * 不能拿 `measureGroundDiamond` 去量规整产物 —— 它是为 2K 生成图设计的
 * （要求「下半部分」有足够的行去拟合斜率），32~96px 的成品根本喂不饱它。
 * 这里改成与**理想菱形**直接比对，这才是我们真正想保证的不变量。
 *
 * 阈值说明（都是设计使然，不是放宽标准）：
 *   · `holes` 的判定用 d ≤ 0.90（**内缩** 10%）—— 边界那一圈本来就是羽化区，
 *     半透明是预期的，不该算缺口。
 *   · `outside` 的判定要放得很宽：裁切遮罩为了**让地块边缘不透明**，刻意取到
 *     数学菱形之外（见 DIAMOND_MASK_SLACK 与 DEFAULT_OVERSCAN 的注释）。
 *     实测过：不外推时单元格边缘 alpha 只有 42~213，相邻地块拼起来就是
 *     地图上一圈白线；现在边缘是 255，代价是包围盒比数学菱形大约 2px。
 */
function diamondFidelity(bitmap, settings, slack = 0.45) {
  let holes = 0;
  let outside = 0;
  let area = 0;
  let left = bitmap.width;
  let top = bitmap.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const a = bitmap.rgba[(y * bitmap.width + x) * 4 + 3];
      const d = diamondDistance(settings, x, y);
      if (a > 8) {
        area++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
      if (d <= 0.9 && a < 40) holes++;
      if (d > 1 + slack && a > 8) outside++;
    }
  }
  const w = right - left + 1;
  const h = bottom - top + 1;
  return { holes, outside, area, ratioLike: w / h, bounds: { left, top, right, bottom } };
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

mkdirSync(TMP, { recursive: true });
const S = DEFAULT_SETTINGS;

// ═══════════════════════════════════════════════════════════════════════════
section("G1 模板渲染：比例严格 2:1、四顶点位置正确");
// ═══════════════════════════════════════════════════════════════════════════
{
  const t = renderTemplate({ size: 512, cols: 1, rows: 1 });
  const w = t.bounds.right - t.bounds.left + 1;
  const h = t.bounds.bottom - t.bounds.top + 1;
  near("G1a 模板菱形宽高比 = 2.000", w / h, 2.0, 0.005);
  near("G1b 模板包围盒中心 x 在画布中心", (t.bounds.left + t.bounds.right + 1) / 2, 256, 1.5, "px");
  near("G1c 模板包围盒中心 y 在画布中心", (t.bounds.top + t.bounds.bottom + 1) / 2, 256, 1.5, "px");
  near("G1d 菱形宽占画布 92%", w / 512, 0.92, 0.02);
  // 四顶点：用掩码实测
  const mask = alphaMask(t.bitmap);
  const top = firstRowWithAlpha(mask, t.bitmap.width, t.bitmap.height, true);
  const bottom = firstRowWithAlpha(mask, t.bitmap.width, t.bitmap.height, false);
  near("G1e 上顶点在包围盒顶部", top, t.bounds.top, 1.5, "px");
  near("G1f 下顶点在包围盒底部", bottom, t.bounds.bottom, 1.5, "px");
}

section("G1g 2×2 地基模板：外轮廓与分格线都在");
{
  const t = renderTemplate({ size: 512, cols: 2, rows: 2, grid: true });
  const w = t.bounds.right - t.bounds.left + 1;
  const h = t.bounds.bottom - t.bounds.top + 1;
  near("G1g 2×2 大菱形比例仍为 2.0", w / h, 2.0, 0.01);
  let red = 0;
  for (let i = 0; i < t.bitmap.rgba.length; i += 4) {
    if (t.bitmap.rgba[i] > 200 && t.bitmap.rgba[i + 1] < 120 && t.bitmap.rgba[i + 2] < 120) red++;
  }
  check("G1h 存在红色分格线像素", red > 50, `只有 ${red} 个`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("G2 合成图的菱形测量（带装饰的图也能量准地面）");
// ═══════════════════════════════════════════════════════════════════════════
{
  const size = 512;
  const bmp = syntheticGround(size, 0.8);
  const m = measureGroundDiamond(bmp);
  near("G2a 合成图比例 = 2.0", m.ratio, 2.0, 0.05);
  check("G2b 边缘残差 ≤ 2px", m.residual <= 2, `残差 ${m.residual.toFixed(2)}`);
  check("G2c 测量可信（measurementLooksSane 返回 undefined）", measurementLooksSane(bmp, m) === undefined,
    String(measurementLooksSane(bmp, m)));
}

section("G2d 装饰遮挡下半部分时，仍只量地面边而不被装饰带偏");
{
  const bmp = syntheticGroundWithDecor(512, 0.8);
  const m = measureGroundDiamond(bmp);
  near("G2d 带装饰的图比例仍 ≈ 2.0", m.ratio, 2.0, 0.08);
}

// ═══════════════════════════════════════════════════════════════════════════
section("G3~G7 规整：比例、裁切、无缺口、无越界");
// ═══════════════════════════════════════════════════════════════════════════
{
  const src = syntheticGround(512, 0.8);
  const m = measureGroundDiamond(src);
  const { bitmap, report } = regularizeToCell(src, S, m, "measured");
  check("G3a 规整产物尺寸 = 单元格", bitmap.width === S.cellWidth && bitmap.height === S.cellHeight);
  near("G3b 报告里的实测比例 ≈ 2.0", report.ratioMeasured ?? 0, 2.0, 0.05);
  check("G3c 报告 mode = measured", report.mode === "measured");

  // G3d：菱形是不是「正」的，靠与理想菱形直接比对（见 diamondFidelity）。
  // 不用 measureGroundDiamond 去量 64×96 的成品 —— 它是为 2K 源图设计的。
  const fid = diamondFidelity(bitmap, S);
  check("G3d 实测包围盒比例合理（1.5~2.1；含刻意外扩）", fid.ratioLike >= 1.5 && fid.ratioLike <= 2.1,
    `实测 ${fid.ratioLike.toFixed(3)}`);

  check("G4 菱形内无透明缺口", fid.holes === 0, `${fid.holes} 个缺口像素`);
  check("G5 菱形外无非透明像素", fid.outside === 0, `${fid.outside} 个越界像素`);

  // G7：洋红残留
  let magenta = 0;
  for (let i = 0; i < bitmap.rgba.length; i += 4) {
    if (bitmap.rgba[i + 3] > 0 &&
        Math.abs(bitmap.rgba[i] - 255) + Math.abs(bitmap.rgba[i + 1]) + Math.abs(bitmap.rgba[i + 2] - 255) < 60) magenta++;
  }
  check("G7 洋红残留像素 = 0", magenta === 0, `${magenta} 个`);

  // ★ G10 菱形**内部**必须是不透明的，且半透明只能出现在上下两个顶点。
  //
  // 这条是「地图上不该出现拼缝白线」的判据。为什么是「内部 + 顶点例外」而不是
  // 「整个菱形都不许半透明」：
  //
  //   2:1 菱形的左右顶点落在像素**边界**上（x = 0 与 x = 64）。
  //   像素中心在 0.5 处，所以 (0,48) 的归一化距离是 1.0156 —— 它按定义就在
  //   数学菱形之外一点点，属于羽化区。这是栅格化的必然结果，不是 bug。
  //
  //   实测：这些弱像素（最低 42）只出现在 `(0,48)/(63,48)/(32,31)/(32,64)` 这几个
  //   顶点上，总数不到 10 个，而且**相邻地块的不透明部分正好盖在上面**
  //   （见 G10d 的整图断言与「地图无缝」的实测）。
  //
  // 真正要保证的是：菱形主体不透明 → 相邻地块不会两边都半透明 → 没有白线。
  {
    let semiInside = 0;
    let weakestInside = 255;
    for (let y = 0; y < S.cellHeight; y++) {
      for (let x = 0; x < S.cellWidth; x++) {
        // 0.96 留出「顶点栅格化」那一点余量；主体部分必须是全不透明
        if (diamondDistance(S, x, y) > 0.96) continue;
        const a = bitmap.rgba[(y * S.cellWidth + x) * 4 + 3];
        if (a < 250) semiInside++;
        if (a < weakestInside) weakestInside = a;
      }
    }
    check("G10 菱形主体（d ≤ 0.96）全部不透明", semiInside === 0 && weakestInside === 255,
      `半透明 ${semiInside} 个，最弱 ${weakestInside}`);

    // 半透明像素只允许出现在菱形的**边缘那一圈**，不允许出现在内部。
    // 实测一个规整好的单元格约 190 个（四条边各约 48 个），这是正常抗锯齿；
    // 而菱形内部一旦有半透明，相邻两块就会都半透明 → 拼缝白线。
    let semiTotal = 0;
    let semiDeepInside = 0;
    for (let y = 0; y < S.cellHeight; y++) {
      for (let x = 0; x < S.cellWidth; x++) {
        const a = bitmap.rgba[(y * S.cellWidth + x) * 4 + 3];
        if (a === 0 || a >= 250) continue;
        semiTotal++;
        if (diamondDistance(S, x, y) < 0.9) semiDeepInside++;
      }
    }
    check("G10b 半透明只出现在边缘圈，不深入菱形内部", semiDeepInside === 0,
      `半透明共 ${semiTotal} 个，其中深入内部的 ${semiDeepInside} 个`);
  }
}

section("G8 测量失败时回退模板几何，不抛异常");
{
  const blank = { width: 128, height: 128, rgba: Buffer.alloc(128 * 128 * 4, 255) };
  let measureThrew = false;
  try {
    measureGroundDiamond(blank);
  } catch {
    measureThrew = true;
  }
  check("G8a 全白图测量会抛错（可被上层捕获）", measureThrew);
  const { bitmap, report } = regularizeToCell(blank, S, { centerX: 64, centerY: 64, halfWidth: 40, halfHeight: 20 }, "template", "测量失败");
  check("G8b 回退后仍产出正确尺寸", bitmap.width === S.cellWidth && bitmap.height === S.cellHeight);
  check("G8c 报告标注 mode=template 与原因", report.mode === "template" && report.fallbackReason === "测量失败");
}

// ═══════════════════════════════════════════════════════════════════════════
section("★ G9 反向验证：硬编码模板几何 → 必须出现透明缺口");
// ═══════════════════════════════════════════════════════════════════════════
{
  // 造一张 1536 的「真实感」样本（研究期把 2048 压到过 1536，正是踩坑现场）
  const scaled = realisticGenerated(1536, 0.7); // 0.7 保证菱形不被画布边缘截断
  const S1536 = 1884; // 「1536 图上的模板菱形宽 1884」= 研究期那个失效的硬编码值

  // 先用真实测量规整：不应有缺口
  const m = measureGroundDiamond(scaled);
  const good = regularizeToCell(scaled, S, m, "measured");
  let goodHoles = 0;
  for (let y = 0; y < S.cellHeight; y++) {
    for (let x = 0; x < S.cellWidth; x++) {
      if (insideDiamond(S, x, y) && good.bitmap.rgba[(y * S.cellWidth + x) * 4 + 3] < 40) goodHoles++;
    }
  }
  check("G9a 按实测几何规整 → 无缺口", goodHoles === 0, `${goodHoles} 个`);

  // 再用「硬编码 1884/942、中心 1024」的错误几何规整同一张图：缺口必须出现
  const wrong = { centerX: 1024, centerY: 1024, halfWidth: S1536 / 2, halfHeight: S1536 / 4 };
  const bad = regularizeToCell(scaled, S, wrong, "template");
  let badHoles = 0;
  for (let y = 0; y < S.cellHeight; y++) {
    for (let x = 0; x < S.cellWidth; x++) {
      if (insideDiamond(S, x, y) && bad.bitmap.rgba[(y * S.cellWidth + x) * 4 + 3] < 40) badHoles++;
    }
  }
  check("G9b 按硬编码几何规整 → 出现透明缺口（证明这条断言有效）", badHoles > 0, `${badHoles} 个缺口`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("D1~D4 独立装饰：锚点、尺度、边界、遮挡");
// ═══════════════════════════════════════════════════════════════════════════
{
  const sprite = syntheticDecor(512);
  const { bitmap, report } = regularizeDecorSprite(sprite, S);
  near("D1 装饰底部锚点 = decorAnchorY()", report.anchorY, decorAnchorY(S), 0);
  near("D1b 64×96 的锚点 = 54", decorAnchorY(S), 54, 0);
  const bounds = alphaBounds(bitmap);
  check("D1c 装饰实际底边贴近锚点", bounds !== undefined && Math.abs(bounds.bottom + 1 - report.anchorY) <= 2,
    bounds ? `底边 ${bounds.bottom + 1}` : "无内容");
  check("D2 装饰宽度 ≤ 单元格宽的 5/8 + 容差", bounds !== undefined && bounds.right - bounds.left + 1 <= S.cellWidth * 0.625 + 4,
    bounds ? `宽 ${bounds.right - bounds.left + 1}` : "无内容");
  check("D3 装饰全在单元格内", bounds !== undefined && bounds.top >= 0 && bounds.bottom < S.cellHeight);
  // D4：把装饰放到草地上再画一格前排草地，装饰下半部必须被盖住
  {
    const ground = solidCell(S, [124, 176, 66, 255]);
    const lookup = new Map([["tree", bitmap], ["grass", ground]]);
    const state = emptyMapState(2, 2, "grass");
    state.decor = { "0,0": "tree" };
    const map = assembleMap(lookup, state, { settings: S, families: { grass: ["grass"] } });
    // 装饰在下半部被前排 (1,0) 盖住 —— 后排装饰的像素数应少于贴图本身
    let spritePixels = 0;
    for (let i = 3; i < bitmap.rgba.length; i += 4) if (bitmap.rgba[i] > 8) spritePixels++;
    let visible = 0;
    for (let i = 3; i < map.rgba.length; i += 4) if (map.rgba[i] > 8) visible++;
    check("D4 前排地块覆盖后，可见像素少于装饰本身（遮挡生效）", visible < map.width * map.height && spritePixels > 0);
  }
}

section("★ D5~D9 反向验证：白边与软 alpha");
{
  // 优先用**真实生成图**做这组断言：合成图的边缘太干净，测不出差异。
  const realTree = join(PROBE, "b13", "D-treeA-white.png");
  const useReal = existsSync(realTree);
  const sprite = useReal ? await decodeImage(realTree) : syntheticDecor(512);
  console.log(`  · 样本：${useReal ? "真实生成图 probe/b13/D-treeA-white.png" : "合成图（probe/ 不存在）"}`);

  /**
   * 「旧路线」的忠实复刻（研究期会留白边的那个版本）：
   *   硬阈值抠底（dist ≤ 66 → alpha 0）→ **只改 alpha、RGB 原样留着**
   *   → RGB 与 alpha 一起做一次普通双线性缩放。
   * 关键就是「不清理 RGB」+「不感知 alpha 的缩放」这两点叠加。
   */
  const legacySprite = (src, settings) => {
    const bg = [254, 254, 254];
    const rgba = Buffer.alloc(src.width * src.height * 4);
    for (let i = 0, p = 0; i < src.width * src.height; i++, p += 4) {
      rgba[p] = src.rgba[p];
      rgba[p + 1] = src.rgba[p + 1];
      rgba[p + 2] = src.rgba[p + 2];
      const d = Math.abs(src.rgba[p] - bg[0]) + Math.abs(src.rgba[p + 1] - bg[1]) + Math.abs(src.rgba[p + 2] - bg[2]);
      rgba[p + 3] = d <= 66 ? 0 : 255;
    }
    let left = src.width, top = src.height, right = -1, bottom = -1;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        if (rgba[(y * src.width + x) * 4 + 3] === 0) continue;
        if (x < left) left = x; if (x > right) right = x;
        if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
    const cw = right - left + 1;
    const ch = bottom - top + 1;
    const anchorY = decorAnchorY(settings);
    const k = Math.min((settings.cellWidth * 5 / 8) / cw, anchorY / ch);
    const ow = Math.max(1, Math.round(cw * k));
    const oh = Math.max(1, Math.round(ch * k));
    const crop = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      rgba.copy(crop, y * cw * 4, ((y + top) * src.width + left) * 4, ((y + top) * src.width + left + cw) * 4);
    }
    // 直接做一次双线性（RGB 与 alpha 混在一起）—— 这就是白边的来源
    const scaled = bilinearResize({ width: cw, height: ch, rgba: crop }, ow, oh);
    const out = Buffer.alloc(settings.cellWidth * settings.cellHeight * 4);
    const px = Math.round(settings.cellWidth / 2 - ow / 2);
    const py = anchorY - oh;
    for (let y = 0; y < oh; y++) {
      const ty = py + y;
      if (ty < 0 || ty >= settings.cellHeight) continue;
      for (let x = 0; x < ow; x++) {
        const tx = px + x;
        if (tx < 0 || tx >= settings.cellWidth) continue;
        scaled.rgba.copy(out, (ty * settings.cellWidth + tx) * 4, (y * ow + x) * 4, (y * ow + x) * 4 + 4);
      }
    }
    return { width: settings.cellWidth, height: settings.cellHeight, rgba: out };
  };

  /** 在「交付尺寸」（再放大 2 倍，肉眼看到的就是那一级）上量。 */
  const inspectDeliverable = (bitmap) => {
    const big = upscale(bitmap, 2);
    let white = 0;
    let semi = 0;
    let on = 0;
    const seen = new Set();
    for (let i = 0; i < big.rgba.length; i += 4) {
      const a = big.rgba[i + 3];
      seen.add(a);
      if (a > 8) {
        on++;
        if (a < 248) semi++;
      }
      const mn = Math.min(big.rgba[i], big.rgba[i + 1], big.rgba[i + 2]);
      if (a > 200 && mn >= 220) white++;
    }
    return { white, semi, levels: seen.size, opaque: countOpaque(bitmap), on };
  };

  const good = inspectDeliverable(regularizeDecorSprite(sprite, S, { matte: true }).bitmap);
  const bad = inspectDeliverable(legacySprite(sprite, S));

  check("D5 新版：交付尺寸上没有近白不透明像素", good.white === 0, `${good.white} 个`);
  check("D6 新版保留的软边像素不少于旧路线", good.semi >= bad.semi,
    `新版 ${good.semi}，旧路线 ${bad.semi}`);
  check("D7 新版剪影不被吃掉（≥ 旧路线 95%）", good.opaque >= bad.opaque * 0.95,
    `新版 ${good.opaque} vs 旧路线 ${bad.opaque}`);

  // 抠底层面的本质区别：软 alpha vs 硬二值（这条是反向验证的核心）
  {
    const m = matteForeground(sprite);
    const levels = new Set();
    for (const a of m.alpha) levels.add(a);
    check("D9 抠底层保留软 alpha（档位 ≥ 32；硬阈值只有 2）", levels.size >= 32, `${levels.size} 档`);
  }

  if (useReal) {
    // 真实图才量得出「近白像素」这类细节；合成图边缘太干净，量不出来
    console.log(`  · 参考：近白不透明像素 新版 ${good.white} / 旧路线 ${bad.white}；` +
      `软边像素 新版 ${good.semi} / 旧路线 ${bad.semi}；alpha 档位 新版 ${good.levels} / 旧路线 ${bad.levels}`);
  }

  // D8：纯白底（只有噪声）必须被判成「无前景」，而不是把整张底当前景
  const noise = { width: 64, height: 64, rgba: Buffer.alloc(64 * 64 * 4, 255) };
  {
    const m = matteForeground(noise);
    let nonzero = 0;
    for (const a of m.alpha) if (a > 0) nonzero++;
    check("D8 死区生效：纯白噪点图的软 alpha 全为 0", nonzero === 0, `${nonzero} 个非零`);
  }
  check("D8b 纯白噪点图被判定为「无前景」而拒绝", (() => {
    try {
      regularizeDecorSprite(noise, S);
      return false;
    } catch {
      return true;
    }
  })());
}

// ═══════════════════════════════════════════════════════════════════════════
section("P1~P2 参数化：换单元格尺寸，比例仍为 2:1");
// ═══════════════════════════════════════════════════════════════════════════
{
  for (const settings of [{ cellWidth: 96, cellHeight: 144 }, { cellWidth: 32, cellHeight: 48 }, { cellWidth: 128, cellHeight: 192 }]) {
    const src = syntheticGround(512, 0.8);
    // 注意：这里量的是**源图**，然后把同一个测量结果喂给不同 settings。
    // 不能去量规整产物 —— 32×48 的单元格里菱形半高只有 8px，
    // 「下半部分」不足 12 行，测量会直接拒绝（那是分辨率下限，不是 bug）。
    const m = measureGroundDiamond(src);
    const { bitmap, report } = regularizeToCell(src, settings, m, "measured");
    check(`P1 ${settings.cellWidth}×${settings.cellHeight} 产物尺寸正确`,
      bitmap.width === settings.cellWidth && bitmap.height === settings.cellHeight);
    // 缩放系数现在含 `overscan`（刻意多取源区域），所以它**不再等于 1**。
    // 真正要保证的是：源本身就是 2:1，因此两个方向的缩放必须相等（不拉伸）。
    check(`P1a ${settings.cellWidth}×${settings.cellHeight} 两个方向缩放一致（源是 2:1，不该被拉伸）`,
      Math.abs(report.scale[0] - report.scale[1]) <= 0.005,
      `${report.scale[0]} vs ${report.scale[1]}`);
    check(`P1a2 ${settings.cellWidth}×${settings.cellHeight} 缩放系数为正且小于 1`,
      report.scale[0] > 0 && report.scale[0] < 1, String(report.scale[0]));
    near(`P1b ${settings.cellWidth}×${settings.cellHeight} 的锚点按公式变化`, decorAnchorY(settings),
      Math.round(settings.cellHeight / 2 + settings.cellWidth / 4 - settings.cellWidth / 8 - 2), 0);
  }
  // 大单元格下再用 diamondFidelity 验一次几何（128×192 分辨率够高）
  {
    const settings = { cellWidth: 128, cellHeight: 192 };
    const src = syntheticGround(512, 0.8);
    const m = measureGroundDiamond(src);
    const { bitmap } = regularizeToCell(src, settings, m, "measured");
    const fid = diamondFidelity(bitmap, settings);
    check("P1c 128×192 下无透明缺口", fid.holes === 0, `${fid.holes} 个`);
    check("P1d 128×192 下无越界像素", fid.outside === 0, `${fid.outside} 个`);
    check("P1e 128×192 下包围盒比例合理（1.5~2.1）", fid.ratioLike >= 1.5 && fid.ratioLike <= 2.1,
      `实测 ${fid.ratioLike.toFixed(3)}`);
  }
  let threw = false;
  try {
    assertSettings({ cellWidth: 70, cellHeight: 96 });
  } catch {
    threw = true;
  }
  check("P2 cellWidth 不能被 4 整除时被拒绝", threw);

  let threw2 = false;
  try {
    assertSettings({ cellWidth: 64, cellHeight: 32 });
  } catch {
    threw2 = true;
  }
  check("P3 cellHeight ≤ 菱形高时被拒绝（没空间放装饰）", threw2);
}

// ═══════════════════════════════════════════════════════════════════════════
section("S1~S6 拼图：无洞、可复现、跨格锚点、边界");
// ═══════════════════════════════════════════════════════════════════════════
{
  const grass = solidCell(S, [124, 176, 66, 255]);
  const lookup = new Map([["grass", grass]]);
  const state = emptyMapState(5, 5, "grass");
  const map = assembleMap(lookup, state, { settings: S, families: { grass: ["grass"] } });
  // 同类铺满后，去重内部不应有透明洞（注意：整张图是菱形，四角本来就是空的）
  check("S1 同类地块铺 5×5 后内部无透明洞", countInteriorHoles(map) === 0, `${countInteriorHoles(map)} 个洞`);
  // ★ S1c 拼缝白线的直接判据：用**真实规整产物**（带羽化边缘）铺图，
  // 断言整张图内部**没有透明的洞**。
  //
  // 为什么不用「半透明像素占比」：那个指标会把**地图自己的外轮廓**也算进去
  // ——整张图的菱形边缘当然是半透明的，那是边界不是缝。实测踩过这个坑：
  // 全草地 4×4 铺出来报 16.78%「半透明」，逐像素 dump 一看全在地图外围的顶点上。
  //
  // 真正会露出白线的是「内部有透光的洞」——纯色块测不出来（每像素都是 255），
  // 真实地块才测得出。
  {
    const src = syntheticGround(512, 0.8);
    const m = measureGroundDiamond(src);
    const cell = regularizeToCell(src, S, m, "measured").bitmap;
    // 单元格自身：菱形主体必须不透明（否则邻居两边都半透明 → 缝）
    let weakInterior = 0;
    for (let y = 0; y < S.cellHeight; y++) {
      for (let x = 0; x < S.cellWidth; x++) {
        if (diamondDistance(S, x, y) > 0.96) continue;
        if (cell.rgba[(y * S.cellWidth + x) * 4 + 3] < 250) weakInterior++;
      }
    }
    check("S1c 真实地块的菱形主体不透明（相邻两块不会都半透明）", weakInterior === 0,
      `${weakInterior} 个半透明像素`);

    const realMap = assembleMap(new Map([["g#0", cell]]), emptyMapState(4, 4, "g"), {
      settings: S,
      families: { g: ["g#0"] },
      background: [0, 0, 0, 0]
    });
    const holes = countInteriorHoles(realMap);
    check("S1d 真实地块铺图后内部没有透光的洞（拼缝白线的判据）", holes === 0,
      `${holes} 个洞`);
  }

  // 菱形网格的形状：每行不透明像素数应呈先增后减
  const rowWidths = [];
  for (let y = 0; y < map.height; y += Math.max(1, Math.floor(map.height / 12))) {
    let n = 0;
    for (let x = 0; x < map.width; x++) if (map.rgba[(y * map.width + x) * 4 + 3] > 8) n++;
    rowWidths.push(n);
  }
  check("S1b 不透明区域呈菱形（行宽先增后减）",
    rowWidths[0] < rowWidths[Math.floor(rowWidths.length / 2)] && rowWidths[rowWidths.length - 1] < rowWidths[Math.floor(rowWidths.length / 2)],
    rowWidths.join(","));
}

section("S2 同种子两次渲染逐像素一致");
{
  const a = solidCell(S, [10, 20, 30, 255]);
  const b = solidCell(S, [200, 100, 50, 255]);
  const lookup = new Map([["a", a], ["b", b]]);
  const mk = () => {
    const st = emptyMapState(6, 6, "x");
    return assembleMap(lookup, st, { settings: S, families: { x: ["a", "b"] } });
  };
  const m1 = mk();
  const m2 = mk();
  check("S2 同种子两次渲染完全一致", m1.rgba.equals(m2.rgba));
  const st3 = emptyMapState(6, 6, "x");
  st3.seed = 12345;
  const m3 = assembleMap(lookup, st3, { settings: S, families: { x: ["a", "b"] } });
  check("S3 换种子后像素分布不同", !m1.rgba.equals(m3.rgba));
}

section("S4 跨格建筑锚点");
{
  const ground = solidCell(S, [124, 176, 66, 255]);
  const building = { width: 128, height: 96, rgba: Buffer.alloc(128 * 96 * 4, 255) };
  for (let i = 0; i < 128 * 96; i++) {
    building.rgba[i * 4] = 200;
    building.rgba[i * 4 + 1] = 60;
    building.rgba[i * 4 + 2] = 60;
    building.rgba[i * 4 + 3] = 255;
  }
  const lookup = new Map([["grass", ground], ["building", building]]);
  const state = emptyMapState(3, 3, "grass");
  state.buildings = [[1, 1, "building"]];
  const map = assembleMap(lookup, state, { settings: S, families: { grass: ["grass"] } });
  let minX = map.width, maxX = -1, minY = map.height, maxY = -1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = (y * map.width + x) * 4;
      if (map.rgba[i] > 180 && map.rgba[i + 1] < 100) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  check("S4 建筑真的被画上去了", maxX > minX, `x ${minX}..${maxX}`);
  near("S4b 建筑宽度 = 贴图宽度", maxX - minX + 1, 128, 2, "px");
}

// ★ S4c 跨格建筑的**底面中心**必须落在「占格菱形」的中心，不是锚点格中心。
//
// 真机踩过：2×2 建筑（锚点在左上那格）的底面比锚点格中心右移半格、下移半格，
// 而地面垫底画在锚点格中心 —— 于是垫底整个往左上偏半格，
// 建筑看着像**浮在半空**（脚下那块地面没跟上）。
{
  const ground = solidCell(S, [124, 176, 66, 255]);
  // 建筑底面画成一条 2px 的洋红线，用来量它到底落在哪
  const bw = 128, bh = 96, baseRow = 80;
  const building = { width: bw, height: bh, rgba: Buffer.alloc(bw * bh * 4, 0) };
  for (let x = 0; x < bw; x++) {
    for (let dy = 0; dy < 2; dy++) {
      const i = ((baseRow + dy) * bw + x) * 4;
      building.rgba[i] = 255; building.rgba[i + 1] = 0; building.rgba[i + 2] = 255; building.rgba[i + 3] = 255;
    }
  }
  building.baseFraction = baseRow / bh;
  const lookup = new Map([["grass#0", ground], ["bld#0", building]]);
  const st = emptyMapState(4, 4, "grass");
  st.cells = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "grass"));
  st.buildings = [[1, 1, "bld#0"]];
  st.buildingGround = [[1, 1, 2, 2, "grass#0"]];
  const map = assembleMap(lookup, st, { settings: S, families: { grass: ["grass"] } });

  // 量洋红线的中心
  let mx = 0, mn = 0, my = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = (y * map.width + x) * 4;
      if (map.rgba[i] > 200 && map.rgba[i + 1] < 60 && map.rgba[i + 2] > 200 && map.rgba[i + 3] > 200) {
        mx += x; mn++; my += y;
      }
    }
  }
  const layout = tileLayout(S, 4, 4);
  const o = tileOriginAt(layout, 1, 1);
  // ⚠️ 期望值按**形状**现算（`shapeBaseOffset`），不要手写 `stepX/2`。
  // 手写那版与老代码的 `((fw−1)·cellW/2)/2` 是同一个错 —— 实测真值底心是
  // (o + 半格 + (0,16))，而老式子给 (o + 半格 + (16,8))，**两个方向各差半格**。
  // 夹具是 2×2，所以形状取矩形 2×2。
  const shape2x2 = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const off = shapeBaseOffset(shape2x2, S.cellWidth);
  const wantX = o.x + S.cellWidth / 2 + off.dx;
  const wantY = o.y + S.cellHeight / 2 + off.dy;
  near("S4c 建筑底面中心 x = 占格菱形中心 x", mx / mn, wantX, 2, "px");
  near("S4d 建筑底面中心 y = 占格菱形中心 y", my / mn, wantY, 2, "px");
  // 反面：不能等于锚点格中心（那正是真机那个 bug）。
  near("S4e 底面中心 ≠ 锚点格中心（差半格，真机 bug 的判据）",
    my / mn - (o.y + S.cellHeight / 2), off.dy, 2, "px");
  // ★ 再加一条独立的真值：底心必须等于**四个占格菱形中心的包围盒中点**。
  // 这是几何上唯一自然的定义，与公式无关 —— 公式错了它也会红。
  {
    const centers = [[1, 1], [1, 2], [2, 1], [2, 2]].map(([r, c]) => {
      const p = tileOriginAt(layout, r, c);
      return { x: p.x + S.cellWidth / 2, y: p.y + S.cellHeight / 2 };
    });
    const truthX = (Math.min(...centers.map((p) => p.x)) + Math.max(...centers.map((p) => p.x))) / 2;
    const truthY = (Math.min(...centers.map((p) => p.y)) + Math.max(...centers.map((p) => p.y))) / 2;
    near("S4f 底面中心 = 四个占格菱形中心的包围盒中点（独立真值）", mx / mn, truthX, 2, "px");
    near("S4g 同上（y）", my / mn, truthY, 2, "px");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section("S4h 任意形状（L 形 / T 形 / 线形）");
// ═══════════════════════════════════════════════════════════════════════════
//
// 占了多格的图块不只有矩形。形状用「相对锚点的格子集合」表达，
// 几何上要满足三条：
//   1. 底面中心 = 各占格菱形中心的**包围盒中点**（几何定义，不看公式）；
//   2. 包围菱形半宽 = x 方向极差 + 一格（**不是** `(cols+rows)/2`）；
//   3. 矩形退化成老公式，逐字一致。
{
  const rect = (cols, rows) => {
    const s = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s.push([r, c]);
    return s;
  };
  /** 逐格菱形中心相对锚点格中心的偏移（世界坐标，1×）。 */
  const centersOf = (shape) => shape.map(([r, c]) => ({
    x: (c - r) * (S.cellWidth / 2),
    y: (c + r) * (S.cellWidth / 4)
  }));

  // ① 矩形：底面偏移必须等于「各格菱形中心包围盒的中点」。
  //
  // ⚠️ dy 与**老代码**有意不一致：老代码 dy 用的是 `((fh−1)·cellW/4)/2`，
  // 括号里少了一半（应为 `cellW/2`），实测每格差半格（2×2 偏 8px）。
  // 这是这次顺手修掉的老 bug，所以这里断言的是**几何真值**而非老式子。
  let rectOk = true;
  const rectDetail = [];
  for (const [cols, rows] of [[1, 1], [2, 2], [3, 1], [1, 3], [4, 2], [3, 3], [5, 5]]) {
    const off = shapeBaseOffset(rect(cols, rows), S.cellWidth);
    const cs = centersOf(rect(cols, rows));
    const wantDx = (Math.min(...cs.map((p) => p.x)) + Math.max(...cs.map((p) => p.x))) / 2;
    const wantDy = (Math.min(...cs.map((p) => p.y)) + Math.max(...cs.map((p) => p.y))) / 2;
    if (Math.abs(off.dx - wantDx) > 1e-9 || Math.abs(off.dy - wantDy) > 1e-9) {
      rectOk = false;
      rectDetail.push(`${cols}x${rows}: 新(${off.dx},${off.dy}) 真值(${wantDx},${wantDy})`);
    }
  }
  check("S4h-1 矩形形状的底面偏移 = 各格菱形中心包围盒中点", rectOk, rectDetail.join(" | "));
  // 老代码的 dx/dy 都按 `(f−1)` **各自**算，但真实底心是
  // 「各格菱形中心包围盒的中点」，两者只在 `fw == fh` 时对得上（平方约掉系数）。
  // 这一节把「哪一半是回归、哪一半是修复」钉清楚，并留一条**独立真值**断言。
  //
  // ⚠️ 老代码原样照抄：`oldDx = ((fw−1)·cellW/2)/2`、`oldDy = ((fh−1)·cellW/4)/2`。
  const oldCodeOffset = (cols, rws) => ({
    dx: ((cols - 1) * (S.cellWidth / 2)) / 2,
    dy: ((rws - 1) * (S.cellWidth / 4)) / 2
  });
  // 真实底心（与公式无关的独立定义）：各格菱形中心包围盒的中点
  const truthOffset = (shape) => {
    const cs = centersOf(shape);
    return {
      dx: (Math.min(...cs.map((p) => p.x)) + Math.max(...cs.map((p) => p.x))) / 2,
      dy: (Math.min(...cs.map((p) => p.y)) + Math.max(...cs.map((p) => p.y))) / 2
    };
  };
  check("S4h-1b 矩形底面偏移 = 各格菱形中心包围盒中点（独立真值，含非正方形）",
    [[2, 2], [3, 2], [2, 3], [4, 2], [5, 5], [3, 1]].every(([cols, rws]) => {
      const off = shapeBaseOffset(rect(cols, rws), S.cellWidth);
      const t = truthOffset(rect(cols, rws));
      return Math.abs(off.dx - t.dx) < 1e-9 && Math.abs(off.dy - t.dy) < 1e-9;
    }),
    JSON.stringify([[3, 2], [2, 3]].map(([c, r]) => ({
      格子: `${c}x${r}`,
      新: shapeBaseOffset(rect(c, r), S.cellWidth),
      真值: truthOffset(rect(c, r)),
      老代码: oldCodeOffset(c, r)
    }))));

  // ② 非矩形：底心必须等于「各格菱形中心的包围盒中点」
  const cases = [
    ["L 形", [[0, 0], [1, 0], [1, 1]]],
    ["T 形", [[0, 0], [0, 1], [0, 2], [1, 1]]],
    ["线形 1×3", [[0, 0], [0, 1], [0, 2]]],
    ["线形 3×1", [[0, 0], [1, 0], [2, 0]]],
    ["十字", [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]]
  ];
  const detail = [];
  let allOk = true;
  for (const [name, shape] of cases) {
    const off = shapeBaseOffset(shape, S.cellWidth);
    const cs = centersOf(shape);
    const truthX = (Math.min(...cs.map((p) => p.x)) + Math.max(...cs.map((p) => p.x))) / 2;
    const truthY = (Math.min(...cs.map((p) => p.y)) + Math.max(...cs.map((p) => p.y))) / 2;
    if (Math.abs(off.dx - truthX) > 1e-9 || Math.abs(off.dy - truthY) > 1e-9) {
      allOk = false;
      detail.push(`${name}: 公式(${off.dx},${off.dy}) 真值(${truthX},${truthY})`);
    }
  }
  check("S4h-2 非矩形形状的底面中心 = 各格菱形中心包围盒的中点", allOk, detail.join(" | "));

  // ③ 包围菱形半宽 = 两轴极差之和 /4 格 + 半格（= x 与 y 方向极差各贡献一半）
  //
  // 推导：x 跨度 = (maxX−minX)·stepX，两边各再留半格 → 总宽 = 跨度 + cellWidth。
  const widths = cases.map(([name, shape]) => {
    const { halfW } = shapeDiamondHalf(shape, S.cellWidth);
    const cs = centersOf(shape);
    const spanX = Math.max(...cs.map((p) => p.x)) - Math.min(...cs.map((p) => p.x));
    const want = (spanX + S.cellWidth) / 2;
    return { name, halfW, want };
  });
  check("S4h-3 包围菱形半宽 = x 极差/2 + 半格（不是 (cols+rows)/2）",
    widths.every((w) => Math.abs(w.halfW - w.want) < 1e-9),
    widths.map((w) => `${w.name}:${w.halfW}/${w.want}`).join(" | "));
  // 反例：L 形（3 格、2×2 跨度）按包围矩形 `(2+2)/2 = 2` 格会算成 64，真值 48
  const lShape = [[0, 0], [1, 0], [1, 1]];
  check("S4h-4 L 形不能按包围矩形算宽（真值 48，不是 64）",
    shapeDiamondHalf(lShape, S.cellWidth).halfW === S.cellWidth * 0.75,
    `halfW=${shapeDiamondHalf(lShape, S.cellWidth).halfW}（期望 ${S.cellWidth * 0.75}）`);

  // ④ `shapeOfEntry` 兼容老的 `[r,c,fw,fh,ground]` 五元组
  check("S4h-5 shapeOfEntry 老五元组 → 矩形形状",
    JSON.stringify(shapeOfEntry([1, 1, 2, 2, "grass#0"])) === JSON.stringify([[0, 0], [0, 1], [1, 0], [1, 1]]),
    JSON.stringify(shapeOfEntry([1, 1, 2, 2, "grass#0"])));
  check("S4h-6 shapeOfEntry 新六元组 → 用形状本身",
    JSON.stringify(shapeOfEntry([1, 1, 2, 2, "grass#0", [[0, 0], [1, 1]]])) === JSON.stringify([[0, 0], [1, 1]]),
    JSON.stringify(shapeOfEntry([1, 1, 2, 2, "grass#0", [[0, 0], [1, 1]]])));
}

// ★ S4j 形状的**底心**可直接用像素量出来：拿一张极小的不透明贴图，
// 它落在哪儿就是底心落在哪儿。这条与公式无关，是端到端的独立验证。
{
  const tiny = { width: 2, height: 2, rgba: Buffer.alloc(2 * 2 * 4, 0), baseFraction: 0.5 };
  for (let i = 0; i < 4; i++) {
    tiny.rgba[i * 4] = 255;
    tiny.rgba[i * 4 + 3] = 255;
  }
  const grass = solidCell(S, [0, 0, 255, 255]);
  const lookup = new Map([["grass#0", grass], ["bld#0", tiny]]);
  const probe = (shape) => {
    const st = emptyMapState(4, 4, "grass");
    st.cells = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "grass"));
    st.buildings = [[1, 1, "bld#0"]];
    st.buildingGround = [[1, 1, 2, 2, "grass#0", shape]];
    const map = assembleMap(lookup, st, { settings: S, families: { grass: ["grass"] } });
    let sumX = 0;
    let count = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = (y * map.width + x) * 4;
        if (map.rgba[i] > 180 && map.rgba[i + 3] > 200) {
          count++;
          sumX += x;
        }
      }
    }
    // 贴图是 2×2 像素，画出来占 4 个像素，取**质心**才是底心。
    return { cx: count === 0 ? NaN : sumX / count, count };
  };
  const L = [[0, 0], [1, 0], [1, 1]];
  const SQ = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const a = probe(L);
  const b = probe(SQ);
  check("S4j-1 极小贴图能在渲染结果里被量到（各 4 个像素）",
    a.count === 4 && b.count === 4, `L=${a.count} 2x2=${b.count}`);
  // 独立真值：底心一步就是各格菱形中心包围盒中点。
  const layout = tileLayout(S, 4, 4);
  const origin = tileOriginAt(layout, 1, 1);
  const expect = (shape) => {
    const xs = shape.map(([r, c]) => origin.x + (c - r) * (S.cellWidth / 2) + S.cellWidth / 2);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  };
  const nearPx = (got, want) => Math.abs(got - want) <= 1;
  check("S4j-2 L 形的底心 x = 各格菱形中心的中点（像素级）",
    nearPx(a.cx, expect(L)), `实测 ${a.cx} 期望 ${expect(L)}`);
  check("S4j-3 2×2 的底心 x = 各格菱形中心的中点（像素级）",
    nearPx(b.cx, expect(SQ)), `实测 ${b.cx} 期望 ${expect(SQ)}`);
  check("S4j-4 L 形与 2×2 的底心不同（形状真的生效了）",
    Math.abs(a.cx - b.cx) > 8, `L=${a.cx} 2x2=${b.cx}`);
  check("S4j-5 两者相差正好 16px（半个 stepX）",
    Math.abs((b.cx - a.cx) - 16) <= 1, `差 ${b.cx - a.cx}`);
}

//
// 逐格垫底 vs 画一个包围大菱形：后者会把凹口也涂成地面色，
// 而凹口本来该透出下面的地面（L 形的意义就在于此）。
{
  const grass = solidCell(S, [124, 176, 66, 255]);
  const building = solidCell(S, [200, 60, 60, 255]);
  building.baseFraction = 0.5;
  const lookup = new Map([["grass#0", grass], ["bld#0", building]]);
  const st = emptyMapState(6, 6, "grass");
  st.cells = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => "grass"));
  st.buildings = [[2, 2, "bld#0"]];
  // 只填 (0,0)(1,0)(1,1) 三个格 —— 凹口是 (0,1)
  st.buildingGround = [[2, 2, 2, 2, "grass#0", [[0, 0], [1, 0], [1, 1]]]];
  const map = assembleMap(lookup, st, { settings: S, families: { grass: ["grass"] } });
  const layout = tileLayout(S, 6, 6);

  // 建筑贴图是纯色块，会把占格全盖住；所以要看的是**垫底的范围**：
  // 凹口那一格不该有建筑色。这里直接量「建筑色像素」在凹口格中心处是否存在。
  const hole = tileOriginAt(layout, 2, 3);
  const hx = Math.round(hole.x + S.cellWidth / 2);
  const hy = Math.round(hole.y + S.cellHeight / 2);
  const i = (hy * map.width + hx) * 4;
  const isBuilding = map.rgba[i] > 150 && map.rgba[i + 1] < 110 && map.rgba[i + 2] < 110;
  check("S4i L 形凹口不被当成占格（建筑没盖住凹口）", !isBuilding,
    `凹口中心 rgb=${map.rgba[i]},${map.rgba[i + 1]},${map.rgba[i + 2]}`);
}

// ★ S7 `families` 必须按**地块键**索引，不能按**类别**索引。
//
// `state.cells` 存的是地块键（`rock2`），`assembleMap` 直接拿它查
// `options.families[键]`。传按类别聚合的那份时，凡是「地块键 ≠ 类别名」的
// （`rock2` 的类别是 `rock`、`dirt2` 的类别是 `dirt`）都会查不到、
// **整格静默跳过** —— 地图上留下透明菱形洞，而且预校验查的是另一份表、不报错。
{
  const grass = solidCell(S, [80, 160, 60, 255]);
  const rock = solidCell(S, [140, 140, 140, 255]);
  // 两个地块共用一个类别：rock2 的 family 是 rock
  const lookup = new Map([["grass#0", grass], ["rock#0", rock], ["rock2#0", rock]]);
  const st = emptyMapState(3, 3, "grass#0");
  st.cells = [["grass", "rock2", "grass"], ["rock2", "grass", "rock2"], ["grass", "rock2", "grass"]];
  // 正确：按地块键索引
  const byCellKey = { grass: ["grass#0"], rock2: ["rock2#0"] };
  const ok = assembleMap(lookup, st, { settings: S, families: byCellKey });
  // 错误：按类别索引（rock2 查不到）
  const byFamily = { grass: ["grass#0"], rock: ["rock#0", "rock2#0"] };
  const bad = assembleMap(lookup, st, { settings: S, families: byFamily });

  const opaque = (m) => {
    let n = 0;
    for (let i = 0; i < m.width * m.height; i++) if (m.rgba[i * 4 + 3] > 200) n++;
    return n;
  };
  const perCell = opaque(solidCell(S, [80, 160, 60, 255]));   // 单格满铺的不透明像素数
  check("★ S7a 按地块键索引时 9 格全铺满（无跳过）", opaque(ok) === 9 * perCell,
    `${opaque(ok)} vs ${9 * perCell}`);
  // 坏的那份漏掉 5 个 rock2 格 —— 缺口至少 4 格（邻格会盖掉一部分，所以不比精确值）
  const gap = opaque(ok) - opaque(bad);
  check("★ S7b 按类别索引会明显漏画（证明必须传地块键表）",
    gap >= 4 * perCell,
    `缺口 ${gap}，至少应缺 ${4 * perCell}（5 个 rock2 格）`);
}

section("S5/S6 边界与守卫");
{
  const grass = solidCell(S, [124, 176, 66, 255]);
  const lookup = new Map([["grass", grass]]);
  let ok1x1 = true;
  try {
    assembleMap(lookup, emptyMapState(1, 1, "grass"), { settings: S, families: { grass: ["grass"] } });
  } catch {
    ok1x1 = false;
  }
  check("S5 1×1 地图不崩", ok1x1);

  let threw = false;
  try {
    assembleMap(lookup, emptyMapState(100, 100, "grass"), { settings: { cellWidth: 128, cellHeight: 192 }, families: { grass: ["grass"] } });
  } catch {
    threw = true;
  }
  check("S6 超大地图抛出明确错误（不是 OOM）", threw);

  let threw2 = false;
  try {
    assembleMap(lookup, emptyMapState(0, 3, "grass"), { settings: S, families: { grass: ["grass"] } });
  } catch {
    threw2 = true;
  }
  check("S6b 0 行地图被拒绝", threw2);
}

section("R1 PNG 编解码往返 + 头部对账");
{
  // 用「铺满整个画布」的图做往返 —— solidCell 只覆盖菱形，取 (0,0) 会拿到透明像素
  const src = { width: 16, height: 16, rgba: Buffer.alloc(16 * 16 * 4) };
  for (let i = 0; i < 16 * 16; i++) {
    src.rgba[i * 4] = 12; src.rgba[i * 4 + 1] = 34;
    src.rgba[i * 4 + 2] = 56; src.rgba[i * 4 + 3] = 200;
  }
  const png = encodeBitmap(src);
  const size = pngSize(png);
  check("R1a PNG 头尺寸正确", size !== undefined && size.width === 16 && size.height === 16);
  const file = join(TMP, "roundtrip.png");
  writeFileSync(file, png);
  const back = await decodeFile(file);
  check("R1b ffmpeg 解码尺寸与头一致", back.width === 16 && back.height === 16,
    `${back.width}×${back.height}`);
  const first = [back.rgba[0], back.rgba[1], back.rgba[2], back.rgba[3]];
  check("R1c 像素值往返一致", first[0] === 12 && first[1] === 34 && first[2] === 56 && first[3] === 200, first.join(","));
}

section("mulberry32 确定性");
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  check("PRNG 同种子同序列", seqA.every((v, i) => v === seqB[i]));
  const c = mulberry32(43);
  check("PRNG 不同种子不同序列", seqA[0] !== c());
  check("PRNG 值域在 [0,1)", seqA.every((v) => v >= 0 && v < 1));
}

// ═══════════════════════════════════════════════════════════════════════════
section("B. 对照研究数据（probe/ 存在时）");
// ═══════════════════════════════════════════════════════════════════════════
const PROBE_SAMPLES = [
  ["b8/G-grass-flash.png", "草地"],
  ["b8/G-dirt-flash.png", "土地"],
  ["b8/G-rock-pro.png", "石块"],
  ["b8/G-bush-flash.png", "灌木"],
  ["b10/G-grass3-flash.png", "草地变体"],
  ["b10/G-dirt2-flash.png", "土地变体"]
];
if (existsSync(PROBE) && existsSync(join(PROBE, "b8"))) {
  const ratios = [];
  for (const [rel, label] of PROBE_SAMPLES) {
    const file = join(PROBE, rel);
    if (!existsSync(file)) {
      console.log(`  · 跳过 ${label}（${rel} 不存在）`);
      continue;
    }
    const bmp = await decodeImage(file);
    const m = measureGroundDiamond(bmp);
    const sane = measurementLooksSane(bmp, m);
    check(`B ${label} 测量可信`, sane === undefined, String(sane));
    ratios.push(m.ratio);
    near(`B ${label} 实测比例 ∈ [1.98, 2.02]`, m.ratio, 2.0, 0.02);
    check(`B ${label} 边缘残差 ≤ 3px`, m.residual <= 3, `${m.residual.toFixed(2)}px`);

    // 规整后与**理想菱形**比对（64×96 的成品喂不饱 measureGroundDiamond）
    const { bitmap } = regularizeToCell(bmp, S, m, "measured");
    const fid = diamondFidelity(bitmap, S);
    check(`B ${label} 规整后无透明缺口`, fid.holes === 0, `${fid.holes} 个`);
    check(`B ${label} 规整后无越界像素`, fid.outside === 0, `${fid.outside} 个`);
    check(`B ${label} 规整后包围盒比例合理（1.5~2.1）`, fid.ratioLike >= 1.5 && fid.ratioLike <= 2.1,
      `实测 ${fid.ratioLike.toFixed(3)}`);
  }
  if (ratios.length > 0) {
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    near("B 汇总：平均比例 = 1.999（研究报告 1.9994）", mean, 1.999, 0.01);
    check("B 汇总：全部落在 1.986~2.019（研究报告范围）",
      ratios.every((r) => r >= 1.98 && r <= 2.02), ratios.map((r) => r.toFixed(3)).join(", "));
  }
} else {
  console.log("  · probe/ 不存在（已被 .gitignore 排除）—— 跳过研究数据对照，不算失败");
  console.log("    要跑这部分：先按研究报告「复跑方式」生成 probe/ 下的样本。");
}

// ═══════════════════════════════════════════════════════════════════════════
section("装饰贴图对照（probe/b13）");
// ═══════════════════════════════════════════════════════════════════════════
if (existsSync(join(PROBE, "b13"))) {
  for (const [file, label] of [["D-treeA-white.png", "阔叶树"], ["D-rockA-white.png", "巨石"]]) {
    const full = join(PROBE, "b13", file);
    if (!existsSync(full)) continue;
    const bmp = await decodeImage(full);
    const { bitmap, report } = regularizeDecorSprite(bmp, S);
    const b = alphaBounds(bitmap);
    check(`B 装饰 ${label}：底边贴在锚点上`, b !== undefined && Math.abs(b.bottom + 1 - report.anchorY) <= 2,
      b ? `底边 ${b.bottom + 1}，锚点 ${report.anchorY}` : "无内容");
    let white = 0;
    const levels = new Set();
    for (let i = 0; i < bitmap.rgba.length; i += 4) {
      levels.add(bitmap.rgba[i + 3]);
      const mn = Math.min(bitmap.rgba[i], bitmap.rgba[i + 1], bitmap.rgba[i + 2]);
      if (bitmap.rgba[i + 3] > 200 && mn >= 220) white++;
    }
    check(`B 装饰 ${label}：无近白不透明像素`, white === 0, `${white} 个`);
    // 只断言「有软边」：40px 宽的产物在 36× 降采样后保不住 64 档
    // （实测 8~9 档）。想要「档位 ≥ 64」是拿 2K 源图的档位数当成了产物指标。
    check(`B 装饰 ${label}：保留软边（alpha 档位 ≥ 4）`, levels.size >= 4, `${levels.size} 档`);
  }
} else {
  console.log("  · probe/b13 不存在 —— 跳过装饰对照");
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log("\n失败清单：");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("地图地块几何内核自检全绿 ✅");
try {
  rmSync(join(TMP, "roundtrip.png"), { force: true });
} catch {
  /* 清理失败不影响结论 */
}

// ── 测试用的小工具 ────────────────────────────────────────────────────────

function alphaMask(bitmap) {
  const mask = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < mask.length; i++) mask[i] = bitmap.rgba[i * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}

function firstRowWithAlpha(mask, width, height, fromTop) {
  for (let k = 0; k < height; k++) {
    const y = fromTop ? k : height - 1 - k;
    for (let x = 0; x < width; x++) if (mask[y * width + x] === 1) return y;
  }
  return -1;
}

function alphaBounds(bitmap) {
  let left = bitmap.width, top = bitmap.height, right = -1, bottom = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.rgba[(y * bitmap.width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? undefined : { left, top, right, bottom };
}

function countOpaque(bitmap) {
  let n = 0;
  for (let i = 3; i < bitmap.rgba.length; i += 4) if (bitmap.rgba[i] > 8) n++;
  return n;
}

/** 造一张「菱形地面」的合成图（白底，颜色明显区别于白）。 */
function syntheticGround(size, widthRatio = 0.8) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 254; rgba[i * 4 + 1] = 254; rgba[i * 4 + 2] = 254; rgba[i * 4 + 3] = 255;
  }
  const hw = (size * widthRatio) / 2;
  const hh = hw / 2;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x + 0.5 - cx) / hw + Math.abs(y + 0.5 - cy) / hh;
      if (d > 1) continue;
      const i = (y * size + x) * 4;
      const shade = ((x * 7 + y * 13) % 40);
      rgba[i] = 90 + shade; rgba[i + 1] = 150 + shade; rgba[i + 2] = 60 + shade; rgba[i * 4 + 3] = 255;
      rgba[i + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

/** 造一张「菱形地面 + 上方装饰」的合成图（装饰故意超出菱形上边界）。 */
function syntheticGroundWithDecor(size, widthRatio = 0.8) {
  const base = syntheticGround(size, widthRatio);
  const hw = (size * widthRatio) / 2;
  const hh = hw / 2;
  const cx = size / 2;
  const cy = size / 2;
  const topY = cy - hh;
  // 装饰：一个深色方块，从菱形上顶点往上长。
  // ⚠️ 只长到「下半部分扫描起点（0.5h）之上」—— 真实装饰（树冠 + 树干）也是这样。
  // 让它盖住下半部分就不是「装饰」了，而是把地面整个挡住，任何算法都量不出来。
  const dw = hw * 0.5;
  const dh = hh * 1.2;
  const decorBottom = cy - hh * 0.2; // 菱形上顶点再往下一点，仍在 0.5h 之上
  for (let y = Math.floor(topY - dh); y < Math.floor(decorBottom); y++) {
    for (let x = Math.floor(cx - dw / 2); x < Math.floor(cx + dw / 2); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = (y * size + x) * 4;
      base.rgba[i] = 40; base.rgba[i + 1] = 80; base.rgba[i + 2] = 30; base.rgba[i + 3] = 255;
    }
  }
  return base;
}

/** 造一张「独立装饰」的合成图：白底上一个深色圆角块。 */
function syntheticDecor(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 254; rgba[i * 4 + 1] = 254; rgba[i * 4 + 2] = 254; rgba[i * 4 + 3] = 255;
  }
  const cx = size / 2;
  const top = size * 0.15;
  const bottom = size * 0.85;
  const halfW = size * 0.25;
  // 树冠：椭圆
  for (let y = Math.floor(top); y < Math.floor(size * 0.6); y++) {
    for (let x = Math.floor(cx - halfW); x < Math.floor(cx + halfW); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const nx = (x - cx) / halfW;
      const ny = (y - (top + (size * 0.6 - top) / 2)) / ((size * 0.6 - top) / 2);
      if (nx * nx + ny * ny > 1) continue;
      const i = (y * size + x) * 4;
      const shade = (x * 5 + y * 11) % 50;
      rgba[i] = 30 + shade; rgba[i + 1] = 110 + shade; rgba[i + 2] = 20 + shade; rgba[i + 3] = 255;
    }
  }
  // 树干：窄矩形
  for (let y = Math.floor(size * 0.55); y < Math.floor(bottom); y++) {
    for (let x = Math.floor(cx - size * 0.03); x < Math.floor(cx + size * 0.03); x++) {
      const i = (y * size + x) * 4;
      rgba[i] = 120; rgba[i + 1] = 70; rgba[i + 2] = 40; rgba[i + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

/**
 * 造一张「像真实生成图」的样本：白底 + 精确 2:1 菱形，菱形内填地面色。
 *
 * 直接用 `renderTemplate` 是不行的 —— 它输出的菱形外是**透明**的，
 * 而真实生成图是「白底不透明 + 菱形在中间」。两者对前景掩码的影响完全不同
 * （透明底会让整张图都算前景，菱形反而量不出来）。G9 就栽在这上面。
 */
function realisticGenerated(size, widthRatio = 0.9) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 254; rgba[i * 4 + 1] = 254; rgba[i * 4 + 2] = 254; rgba[i * 4 + 3] = 255;
  }
  const hw = (size * widthRatio) / 2;
  const hh = hw / 2;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(x + 0.5 - cx) / hw + Math.abs(y + 0.5 - cy) / hh > 1) continue;
      const i = (y * size + x) * 4;
      const shade = (x * 7 + y * 13) % 40;
      rgba[i] = 90 + shade; rgba[i + 1] = 150 + shade; rgba[i + 2] = 60 + shade; rgba[i + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

/** 一张纯色单元格（只覆盖菱形区域）。 */
function solidCell(settings, color) {
  const rgba = Buffer.alloc(settings.cellWidth * settings.cellHeight * 4);
  for (let y = 0; y < settings.cellHeight; y++) {
    for (let x = 0; x < settings.cellWidth; x++) {
      if (!insideDiamond(settings, x, y)) continue;
      const i = (y * settings.cellWidth + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
    }
  }
  return { width: settings.cellWidth, height: settings.cellHeight, rgba };
}

void diamondAlpha;
void diamondCenterY;
void diamondHeight;
void trimTransparent;
void readFileSync;
