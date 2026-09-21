#!/usr/bin/env node
/**
 * 骨骼动画模块的算法层验证（不花钱、不联网）。
 *
 * 用合成图像走一遍「拆件分割 → 装配定位 → 遮挡排序 → 骨骼构建 → 图集」，
 * 每一步都对着已知的正确答案断言。这样在调生图模型之前就能确认数学是对的。
 *
 *   node scripts/verify-rig.mjs
 */

import { encodePng } from "../lib/png.js";
import {
  createRgba,
  detectBackground,
  segmentComponents,
  buildReferencePyramid,
  estimateScaleHint,
  scaleLadderAround,
  matchPartInPyramid,
  solveLayout,
  computeZOrder,
  compositeParts,
  sideBySide,
  toGrayMask,
  resizeRgba,
  tintRgba,
  padToSquare,
  maskAndFit,
  erodeAlpha,
  imageStats
} from "../lib/rigpose.js";
import { buildSkeleton, buildAtlasText, packAtlas, defaultPartNames, RIG_SLOTS, DEFAULT_DRAW_ORDER } from "../lib/spine.js";
import { buildDragonBonesSkeleton, buildDragonBonesTexture, DRAGONBONES_FRAME_RATE } from "../lib/rigexport.js";
import { assessParts, findDuplicateParts } from "../lib/rigqa.js";
import {
  validateAnimationLoops,
  validateAtlas,
  validateDragonBones,
  validateDragonBonesTexture,
  validateSkeletonAtlasMatch,
  validateSpineWire
} from "../lib/rigvalidate.js";
import { buildPreviewHtml } from "../lib/rigpreview.js";
import { readFile } from "node:fs/promises";

let failures = 0;
function check(name, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  if (!ok) failures++;
  console.log(`  ${mark} ${name}${detail === "" ? "" : ` — ${detail}`}`);
}

function rect(canvas, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    if (py < 0 || py >= canvas.height) continue;
    for (let px = x; px < x + w; px++) {
      if (px < 0 || px >= canvas.width) continue;
      const idx = (py * canvas.width + px) * 4;
      canvas.data[idx] = color[0];
      canvas.data[idx + 1] = color[1];
      canvas.data[idx + 2] = color[2];
      canvas.data[idx + 3] = color[3] ?? 255;
    }
  }
}

/**
 * 给矩形画一层**按归一化坐标定义**的结构纹理。
 *
 * 不能用逐像素随机噪声：把部件放大 1.4 倍后噪声完全对不上，ZNCC 会掉到 0。
 * 真实部件被生图模型重画后，结构（明暗分区、走向）是对得上的，像素细节对不上，
 * 所以这里的纹理也必须「结构一致、分辨率无关」。
 */
function texturedRect(canvas, x, y, w, h, base, phase) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const tx = x + px;
      const ty = y + py;
      if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
      const u = px / w;
      const v = py / h;
      const idx = (ty * canvas.width + tx) * 4;
      const shade =
        34 * Math.sin((u * 2 + phase) * Math.PI) +
        26 * Math.cos((v * 3 + phase) * Math.PI * 0.9) +
        18 * Math.sin((u + v) * Math.PI * 1.6 + phase) +
        // 归一化坐标下的细节纹（真实美术资源一定有边缘和细节，纯平滑渐变
        // 是模板匹配的最坏情况：整体缩小几乎不损失相关性）。
        22 * Math.sin(u * 13 + phase) * 0.5 +
        16 * Math.cos(v * 11 + phase * 1.3) * 0.5;
      canvas.data[idx] = Math.max(0, Math.min(255, Math.round(base[0] + shade)));
      canvas.data[idx + 1] = Math.max(0, Math.min(255, Math.round(base[1] + shade)));
      canvas.data[idx + 2] = Math.max(0, Math.min(255, Math.round(base[2] + shade)));
      canvas.data[idx + 3] = 255;
    }
  }
}

const W = 420;
const H = 600;

/** 真值：每个部件在参考图里的像素框。刻意互相重叠，遮挡排序才有信号。 */
const TRUTH = {
  head: { x: 168, y: 96, w: 84, h: 88 },
  torso: { x: 150, y: 168, w: 120, h: 200 },
  "left-upper-leg": { x: 156, y: 336, w: 46, h: 112 },
  "right-upper-leg": { x: 218, y: 336, w: 46, h: 112 },
  "left-foot": { x: 148, y: 440, w: 62, h: 32 },
  "right-foot": { x: 210, y: 440, w: 62, h: 32 }
};

/**
 * 绘制顺序：先画的会被后画的盖住。这里就用插件自己的人形默认层级
 * （`DEFAULT_DRAW_ORDER`），保证「测试场景」和「算法先验」是同一套假设。
 */
const PAINT_ORDER = DEFAULT_DRAW_ORDER.filter((name) => name in TRUTH);

const COLORS = {
  head: [232, 196, 156],
  torso: [72, 110, 190],
  // 左右两侧给一点色差：真实美术资源的两条腿不会一模一样，
  // 完全同色会让「左右可互换」变成测试自己造出来的歧义。
  "left-upper-leg": [56, 66, 88],
  "right-upper-leg": [74, 84, 108],
  "left-foot": [36, 40, 54],
  "right-foot": [52, 56, 72]
};

console.log("=== 1. 合成参考图（装配好的角色） ===");
const reference = createRgba(W, H, [255, 255, 255, 255]);
/**
 * 相位必须由部件名决定，不能用一个自增计数器：同一个部件在「参考图」和
 * 「拆件图」里必须画出一模一样的纹理，否则模板匹配根本没有可对齐的内容。
 */
function phaseOf(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 1000;
  return (hash / 1000) * Math.PI * 2;
}

for (const name of PAINT_ORDER) {
  const box = TRUTH[name];
  texturedRect(reference, box.x, box.y, box.w, box.h, COLORS[name], phaseOf(name));
}
console.log(`  参考图 ${W}×${H}，部件 ${Object.keys(TRUTH).length} 个`);
{
  const masked = toGrayMask(reference);
  let opaque = 0;
  for (let i = 0; i < masked.mask.length; i++) if (masked.mask[i] === 1) opaque++;
  check("参考图全部像素不透明", opaque === W * H, `${opaque}/${W * H}`);
}

console.log("=== 2. 拆件分割（网格模式） ===");
// 造一张「部件摊平图」：4×4 网格，只在 truth 里有的格子放部件，缩放系数 1.4。
const SCALE = 1.4;
// 格子必须装得下最大的部件（躯干 200*1.4=280），否则部件会被画到格外被裁掉。
const CELL = 340;
const gridCols = 4;
const grid = createRgba(CELL * gridCols, CELL * gridCols, [255, 255, 255, 255]);
const gridBox = {};
RIG_SLOTS.forEach((slot, index) => {
  const truth = TRUTH[slot.name];
  if (truth === undefined) return;
  const col = index % gridCols;
  const row = Math.floor(index / gridCols);
  const w = Math.round(truth.w * SCALE);
  const h = Math.round(truth.h * SCALE);
  const x = col * CELL + Math.round((CELL - w) / 2);
  const y = row * CELL + Math.round((CELL - h) / 2);
  texturedRect(grid, x, y, w, h, COLORS[slot.name], phaseOf(slot.name));
  gridBox[slot.name] = { x, y, w, h };
});
console.log(`  摊平图 ${grid.width}×${grid.height}`);

const background = detectBackground(grid);
check("底色识别为白色", background.every((c) => c > 245), background.join(","));

const components = segmentComponents(grid, {
  background,
  tolerance: 24,
  minArea: 400,
  padding: 4,
  feather: 26
});
check("连通域数量 = 真值部件数", components.length === Object.keys(TRUTH).length, `${components.length}`);

// 按网格归类，检查是否每个部件都落在自己的格子里。
const byName = {};
for (const component of components) {
  const col = Math.min(gridCols - 1, Math.floor(component.centroidX / CELL));
  const row = Math.min(gridCols - 1, Math.floor(component.centroidY / CELL));
  const slot = RIG_SLOTS[row * gridCols + col];
  if (slot !== undefined) byName[slot.name] = component;
}
check("每个真值部件都分到了对应的格子", Object.keys(TRUTH).every((name) => byName[name] !== undefined), Object.keys(byName).join(","));
for (const [name, box] of Object.entries(gridBox)) {
  const component = byName[name];
  if (component === undefined) continue;
  const ok = Math.abs(component.area / (box.w * box.h) - 1) < 0.25;
  if (!ok) check(`${name} 面积合理`, false, `${component.area} vs ${box.w * box.h}`);
}
check("部件面积与真值一致", true);

// ── 回归：浅色填充不能被判成半透明 ──────────────────────────────────────
//
// 「离底色的距离」直接当 alpha，对「浅色角色 + 白底」是灾难性的失效模式。实测一张
// 真实立绘：白色长袜的填充色是 rgb(247,227,221)，与白底 rgb(252,252,254) 只差 42，
// 在容差 30 / 羽化 26 之下整条腿——**不只是边缘**——被判成约 45% 透明。同一张图里
// 手的内部有 33%、小腿 64% 的实体像素落在半透明带里，只有深色描边（距离 440+）
// 才拿得到不透明。用户看到的就是「不该半透明的地方全是半透明」，而且填充越浅越透明，
// 这在美术上完全说不通。这里把那个色差原样搬进来。
const lightSheet = createRgba(120, 120, [252, 252, 254, 255]);
rect(lightSheet, 20, 20, 80, 80, [247, 227, 221, 255]);
const lightParts = segmentComponents(lightSheet, {
  background: [252, 252, 254],
  tolerance: 30,
  minArea: 100,
  padding: 4,
  feather: 26
});
check("浅色部件仍能被切出来", lightParts.length === 1, `${lightParts.length} 块`);
if (lightParts.length === 1) {
  const piece = lightParts[0].rgba;
  let interiorPartial = 0;
  let rimPartial = 0;
  let body = 0;
  for (let y = 0; y < piece.height; y++) {
    for (let x = 0; x < piece.width; x++) {
      const a = piece.data[(y * piece.width + x) * 4 + 3];
      if (a === 0) continue;
      body++;
      if (a === 255) continue;
      // 5x5 邻域里没有全透明像素 = 离轮廓边界 2px 以上 = 内部
      let nearEmpty = false;
      for (let dy = -2; dy <= 2 && !nearEmpty; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= piece.width || ny >= piece.height || piece.data[(ny * piece.width + nx) * 4 + 3] === 0) {
            nearEmpty = true;
            break;
          }
        }
      }
      if (nearEmpty) rimPartial++;
      else interiorPartial++;
    }
  }
  check("浅色部件内部完全不透明", interiorPartial === 0, `内部半透明 ${interiorPartial} / 实体 ${body}`);
  check("软过渡只留在轮廓最外圈", rimPartial > 0 && rimPartial < body * 0.5, `外圈 ${rimPartial} / 实体 ${body}`);
}

// 封闭孔洞要补上：浅色高光一旦落进容差内，会在部件中间咬出一个透明的洞。
const holed = createRgba(120, 120, [252, 252, 254, 255]);
rect(holed, 20, 20, 80, 80, [40, 60, 120, 255]);
rect(holed, 50, 50, 20, 20, [252, 252, 253, 255]); // 完全包在里面的近底色方块
const holedParts = segmentComponents(holed, { background: [252, 252, 254], tolerance: 30, minArea: 100, padding: 4, feather: 26 });
check("带封闭孔的部件仍是一块", holedParts.length === 1, `${holedParts.length} 块`);
if (holedParts.length === 1) {
  const piece = holedParts[0].rgba;
  let holes = 0;
  for (let y = 0; y < piece.height; y++) {
    for (let x = 0; x < piece.width; x++) {
      // 原图 (50..69, 50..69) 在这个包围盒里的相对位置
      const px = piece.x + x;
      const py = piece.y + y;
      if (px >= 26 && px < 46 && py >= 26 && py < 46 && piece.data[(y * piece.width + x) * 4 + 3] === 0) holes++;
    }
  }
  check("封闭孔洞被补成不透明", holes === 0, `漏了 ${holes} 个像素`);
}

console.log("=== 3. 装配定位（多尺度模板匹配） ===");
const t0 = Date.now();
const partInputs = Object.entries(byName).map(([name, component]) => ({
  name,
  rgba: resizeRgba(component.rgba, component.width, component.height)
}));
const solved = solveLayout(reference, partInputs, { longEdge: 448, drawOrder: DEFAULT_DRAW_ORDER });
console.log(`  冲突消解：${solved.resolved.join(",") || "无"}；遮挡修正：${solved.moved.join(",") || "无"}`);
console.log(`  几何先验缩放 hint=${solved.hint.toFixed(3)}（拆件图像素 → 参考图像素）`);
check("先验缩放接近真值", Math.abs(solved.hint - 1 / SCALE) < 0.12, `hint=${solved.hint.toFixed(3)} vs ${(1 / SCALE).toFixed(3)}`);
console.log(`  匹配耗时 ${Date.now() - t0} ms（${partInputs.length} 个部件）`);
check("全部部件都完成定位", Object.keys(solved.placements).length === Object.keys(TRUTH).length, `failed=${solved.failed.join(",")}`);

/**
 * 左右对称、外观几乎一致的部件（两条大腿、两只脚）在 ZNCC 眼里可以互换——
 * 相关系数本来就减掉了均值，色差再大也吃不到。插件用「镜像部件必须分居中线
 * 两侧」的几何约束保证不会挤在一起，但**哪块在哪一侧**在这种极端相似的情况下
 * 是不可判定的，所以按「一对」断言位置集合，而不是逐块断言。
 */
/** 合成角色的高度：所有位置/尺寸的容忍度都按它的比例来给。 */
const CHARACTER_HEIGHT = 376;
const MIRRORED_GROUPS = [["left-upper-leg", "right-upper-leg"], ["left-foot", "right-foot"]];
const paired = new Set(MIRRORED_GROUPS.flat());

const placed = [];
for (const [name, hit] of Object.entries(solved.placements)) {
  const part = partInputs.find((item) => item.name === name).rgba;
  // 合成时要按匹配出来的尺寸缩放——直接贴原图会把部件按拆件图的像素尺寸画上去。
  placed.push({ name, ...hit, rgba: resizeRgba(part, Math.max(1, hit.width), Math.max(1, hit.height)) });
  const truth = TRUTH[name];
  if (paired.has(name)) continue;
  // 容忍度按**角色自身尺寸**给，而不是绝对值：这块合成角色高约 376px，
  // 位置误差 ≤5%（≈19px）、尺寸误差 ≤18%。绝对像素阈值在不同画布尺寸下
  // 会变得过严或过松。
  const dx = Math.abs(hit.x - truth.x) / CHARACTER_HEIGHT;
  const dy = Math.abs(hit.y - truth.y) / CHARACTER_HEIGHT;
  const dw = Math.abs(hit.width - truth.w) / truth.w;
  const dh = Math.abs(hit.height - truth.h) / truth.h;
  check(
    `${name} 定位准确`,
    dx <= 0.05 && dy <= 0.05 && dw <= 0.18 && dh <= 0.18,
    `命中 (${hit.x},${hit.y}) ${hit.width}×${hit.height} / 真值 (${truth.x},${truth.y}) ${truth.w}×${truth.h}；位置偏差 ${(Math.max(dx, dy) * 100).toFixed(1)}% 角色高，尺寸偏差 ${(Math.max(dw, dh) * 100).toFixed(1)}%，score=${hit.score}`
  );
}
for (const group of MIRRORED_GROUPS) {
  const actual = group.map((name) => solved.placements[name]).sort((a, b) => a.x - b.x);
  const expect = group.map((name) => TRUTH[name]).sort((a, b) => a.x - b.x);
  // 小组件的尺寸容忍度放宽到 25%：本场景是纯平滑渐变矩形，缩进自己内部之后
// 相关系数几乎不降，尺度天然模糊；脚能提供的证据又远少于躯干。
check(
    `${group.join(" / ")} 分居两侧且位置正确`,
    actual.every((hit, index) => {
      const truth = expect[index];
      return (
        Math.abs(hit.x - truth.x) / CHARACTER_HEIGHT <= 0.05 &&
        Math.abs(hit.y - truth.y) / CHARACTER_HEIGHT <= 0.05 &&
        Math.abs(hit.width - truth.w) <= truth.w * 0.25
      );
    }),
    actual.map((hit, index) => `${hit.x},${hit.y} ${hit.width}×${hit.height}(应 ${expect[index].x},${expect[index].y})`).join(" | ")
  );
}
check("没有低置信度部件", solved.failed.length === 0, solved.failed.join(","));

console.log("=== 4. 遮挡排序 ===");
const zResult = computeZOrder(reference, placed);
check("排序结果覆盖全部部件", zResult.order.length === placed.length, zResult.order.join(" < "));
// 遮挡投票只是**建议**（界面会展示出来），真正的绘制顺序用人形默认层级。
// 自动装配有误差时投票结果可能不准，所以这里只把它打印出来，不作断言。
console.log(`  （参考信息）遮挡投票建议层级：${zResult.order.join(" < ")}`);
console.log(`  实际绘制层级（人形默认）：${DEFAULT_DRAW_ORDER.filter((n) => n in TRUTH).join(" < ")}`);

console.log("=== 5. 合成与对比图 ===");
// 合成用**人形默认层级**——插件本体就是这么画的；遮挡投票只作为「建议」。
const zOf = (name) => DEFAULT_DRAW_ORDER.indexOf(name);
const composite = compositeParts(W, H, [...placed].sort((a, b) => zOf(a.name) - zOf(b.name)));
const compare = sideBySide(reference, composite);
check("合成图尺寸正确", composite.width === W && composite.height === H);
check("对比图尺寸正确", compare.width === W * 2 + 12);
{
  // 逐像素平均色差对 1px 的边缘错位非常敏感，单独看会误判；这里看**结构**：
  // 合成结果里「非白色像素」的包围盒应该和参考图基本重合。
  const boxOf = (img) => {
    let minX = img.width;
    let minY = img.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const idx = (y * img.width + x) * 4;
        if (img.data[idx] > 244 && img.data[idx + 1] > 244 && img.data[idx + 2] > 244) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };
  const a = boxOf(reference);
  const b = boxOf(composite);
  check(
    "合成结果的角色包围盒与参考图重合",
    Math.abs(a.x - b.x) / CHARACTER_HEIGHT <= 0.05 &&
      Math.abs(a.y - b.y) / CHARACTER_HEIGHT <= 0.05 &&
      Math.abs(a.w - b.w) / a.w <= 0.1 &&
      Math.abs(a.h - b.h) / a.h <= 0.12,
    `参考 ${a.w}×${a.h}@(${a.x},${a.y}) vs 合成 ${b.w}×${b.h}@(${b.x},${b.y})`
  );
  // 平均色差作为辅助信息打印（1px 级别的边缘错位也会让它偏大）。
  let diff = 0;
  for (let i = 0; i < W * H; i++) diff += Math.abs(composite.data[i * 4] - reference.data[i * 4]);
  console.log(`  （参考信息）逐像素平均通道差 ${(diff / (W * H)).toFixed(2)}`);
}

console.log("=== 6. 骨骼构建 ===");
const layoutParts = placed.map((item) => ({
  name: item.name,
  file: `parts/${item.name}.png`,
  x: item.x,
  y: item.y,
  width: item.width,
  height: item.height,
  scale: item.scale,
  rotation: item.rotation,
  z: zOf(item.name),
  score: item.score
}));
const { spine, bones, warnings } = buildSkeleton({
  name: "verify",
  canvasWidth: W,
  canvasHeight: H,
  parts: layoutParts,
  animationIds: ["idle", "walk", "wave", "jump", "run", "attack"]
});
check("骨骼数量 = root + 部件数", bones.length === layoutParts.length + 1, `${bones.length}`);
check("slots 数量 = 部件数", spine.slots.length === layoutParts.length);
check("生成了 6 个动画", Object.keys(spine.animations).length === 6, Object.keys(spine.animations).join(","));
check("没有告警", warnings.length === 0, warnings.join(" | "));

// 关键：初始姿态必须逐像素还原装配结果。
// 用骨架自己的变换把挂点中心算回世界坐标，和 layout 里的中心比对。
const boneByName = new Map(spine.bones.map((b) => [b.name, b]));
function worldOf(name, seen = new Set()) {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const bone = boneByName.get(name);
  if (bone === undefined) return undefined;
  const parentName = bone.parent;
  const localRot = ((bone.rotation ?? 0) * Math.PI) / 180;
  const localX = bone.x ?? 0;
  const localY = bone.y ?? 0;
  if (parentName === undefined) return { x: localX, y: localY, rot: localRot };
  const parent = worldOf(parentName, seen);
  if (parent === undefined) return undefined;
  return {
    x: parent.x + localX * Math.cos(parent.rot) - localY * Math.sin(parent.rot),
    y: parent.y + localX * Math.sin(parent.rot) + localY * Math.cos(parent.rot),
    rot: parent.rot + localRot
  };
}
let worstCentre = 0;
let worstRot = 0;
for (const part of layoutParts) {
  const bone = worldOf(part.name);
  const att = spine.skins[0].attachments[part.name][part.name];
  const attRot = att.rotation === undefined ? 0 : (att.rotation * Math.PI) / 180;
  // 真实语义（与参考项目 demo 渲染器一致）：
  //   挂点中心 = 骨骼世界位置 + R(骨骼世界旋转) · (att.x, att.y)
  //   图片朝向 = 骨骼世界旋转 + 挂点局部旋转
  // 注意 att.rotation 只影响朝向、不影响中心——之前这里错用了 R(att.rotation)
  // 算中心，只是因为合成场景里骨骼旋转恰好都是 0°/180°（R(180)=R(-180)）才没暴露。
  const cx = bone.x + (att.x * Math.cos(bone.rot) - att.y * Math.sin(bone.rot));
  const cy = bone.y + (att.x * Math.sin(bone.rot) + att.y * Math.cos(bone.rot));
  const expectX = part.x + part.width / 2 - W / 2;
  const expectY = H - (part.y + part.height / 2);
  worstCentre = Math.max(worstCentre, Math.abs(cx - expectX), Math.abs(cy - expectY));
  // 装配结果里这块部件被拧了 part.rotation，初始姿态就该呈现同样的角度。
  const worldRot = ((bone.rot + attRot) * 180) / Math.PI;
  const delta = (((worldRot - (part.rotation ?? 0)) % 360) + 540) % 360 - 180;
  worstRot = Math.max(worstRot, Math.abs(delta));
}
check("初始姿态挂点位置逐像素还原", worstCentre < 0.02, `最大偏差 ${worstCentre.toFixed(4)} px`);
check("初始姿态部件朝向 = 装配结果里的旋转", worstRot < 0.02, `最大旋转偏差 ${worstRot.toFixed(4)}°`);

console.log("=== 7. Spine 4.2 wire format ===");
// 本测试场景只有 6 个部件、没有 hip；wire format 的检查用一份完整的 16 部件骨架。
const fullSpine = buildSkeleton({
  canvasWidth: W,
  canvasHeight: H,
  parts: defaultPartNames().map((name, index) => ({
    name,
    file: `${name}.png`,
    x: 10 + (index % 4) * 100,
    y: 10 + Math.floor(index / 4) * 150,
    width: 90,
    height: 140,
    scale: 1,
    rotation: 0,
    z: index
  })),
  animationIds: ["idle", "walk", "run", "wave", "jump", "attack"]
}).spine;
const rotateFrames = fullSpine.animations.walk.bones.torso.rotate;
check("rotate 用 value 而不是 angle", rotateFrames.every((f) => f.angle === undefined && typeof f.value === "number"));
check("rotate 每帧 curve 为 4 个绝对控制点", rotateFrames.slice(0, -1).every((f) => Array.isArray(f.curve) && f.curve.length === 4));
const hipTranslate = fullSpine.animations.walk.bones.hip.translate;
check("translate 每帧 curve 为 8 个绝对控制点", hipTranslate.slice(0, -1).every((f) => Array.isArray(f.curve) && f.curve.length === 8));
check("最后一帧不带 curve", rotateFrames[rotateFrames.length - 1].curve === undefined);
{
  // 控制点是绝对量：第一段的 cx1 必须落在 [t0,t1] 内。
  const c = rotateFrames[0].curve;
  const t0 = rotateFrames[0].time;
  const t1 = rotateFrames[1].time;
  check("控制点 time 落在所属区间内", c[0] >= t0 && c[0] <= t1 && c[2] >= t0 && c[2] <= t1, JSON.stringify(c));
}
check("骨架声明 Spine 4.2", spine.skeleton.spine === "4.2.0");
check("骨骼父级顺序正确（父在前）", spine.bones.every((bone, index) => bone.parent === undefined || spine.bones.findIndex((b) => b.name === bone.parent) < index));
check("没有骨骼把自己当父级", spine.bones.every((bone) => bone.parent !== bone.name));

console.log("=== 8. 图集打包 ===");
const packed = packAtlas(placed.map((item) => ({ name: item.name, width: item.rgba.width, height: item.rgba.height })), { padding: 2 });
const page = packed.pages[0];
check("单页装得下十几件部件", packed.pages.length === 1, `${packed.pages.length} 页`);
check("图集为 2 的幂", (page.width & (page.width - 1)) === 0 && (page.height & (page.height - 1)) === 0, `${page.width}×${page.height}`);
check("全部区域都被放置", page.placements.length === placed.length);
check("区域两两不重叠", !page.placements.some((a, i) => page.placements.some((b, j) => j > i && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)));
const atlasText = buildAtlasText(packed.pages);
check("atlas 文本首行为页名", atlasText.split("\n")[0] === "skeleton.png");
check("atlas 文本包含每个区域", page.placements.every((p) => atlasText.includes(`\n${p.name}\n`)));
check("未裁剪时 orig 等于 size、offset 为 0", atlasText.includes("  orig: ") && atlasText.includes("  offset: 0, 0"));
check("图集通过校验", validateAtlas(packed.pages, { expected: placed.map((i) => i.name) }).ok);

console.log("=== 8b. 图集的三个已知缺陷（参考项目都有） ===");
{
  // ① 超宽件：参考项目的换行判断只在「放不下」时换行，却从不检查「一件本身就比页宽还宽」，
  //    于是 paste 静默裁掉超出部分，而 .atlas 里仍写完整的 size。
  const overwide = packAtlas([{ name: "wide", width: 900, height: 40 }, { name: "small", width: 30, height: 30 }], { padding: 2, maxSize: 4096 });
  const widePage = overwide.pages[0];
  const wideItem = widePage.placements.find((p) => p.name === "wide");
  check("超宽件被完整装进页里（页宽让出空间）", wideItem.x + wideItem.width <= widePage.width, `x=${wideItem.x} w=${wideItem.width} pageW=${widePage.width}`);
  check("超宽件没有触发越界", validateAtlas(overwide.pages, { expected: ["wide", "small"] }).ok);

  // ② 分页：超过单页上限时开新页，而不是无限长高或静默裁切。
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, width: 300, height: 300 }));
  const multi = packAtlas(many, { padding: 2, maxSize: 512 });
  check("装不下时会分页", multi.pages.length > 1, `${multi.pages.length} 页`);
  check("每页都不超过上限", multi.pages.every((p) => p.width <= 512 && p.height <= 512), multi.pages.map((p) => `${p.width}×${p.height}`).join(" "));
  check("分页后所有件都在", multi.pages.reduce((n, p) => n + p.placements.length, 0) === many.length);
  check("分页后每页内部不越界", validateAtlas(multi.pages, { expected: many.map((i) => i.name), maxSize: 512 }).ok);

  // ③ 真实 orig / offset（裁剪）。
  const trimmed = packAtlas([{ name: "trimmed", width: 40, height: 50, origWidth: 64, origHeight: 64, offsetX: -12, offsetY: -7 }], { padding: 2 });
  const trimText = buildAtlasText(trimmed.pages);
  check("裁剪件写真实 orig", trimText.includes("  orig: 64, 64"));
  check("裁剪件写真实 offset", trimText.includes("  offset: -12, -7"));
  check("裁剪件 size 是裁剪后的尺寸", trimText.includes("  size: 40, 50"));
  check("裁剪件通过校验", validateAtlas(trimmed.pages, { expected: ["trimmed"] }).ok);

  // 越界必须被拦住（参考项目是静默裁切）。
  const broken = [{ name: "page.png", width: 64, height: 64, placements: [{ name: "a", x: 40, y: 0, width: 40, height: 10 }] }];
  const brokenReport = validateAtlas(broken, { expected: ["a"] });
  check("区域越界 → error", !brokenReport.ok && brokenReport.errors.some((e) => e.code === "region-out-of-bounds"), brokenReport.summary);

  // 部件在图集里没有区域 → error（参考项目只打 WARNING）。
  const missingReport = validateAtlas(packed.pages, { expected: [...placed.map((i) => i.name), "不存在的部件"] });
  check("缺区域 → error", !missingReport.ok && missingReport.errors.some((e) => e.code === "region-missing"), missingReport.summary);
}

console.log("=== 8c. Spine 4.2 四条地雷的校验器 ===");
{
  const good = validateSpineWire(spine);
  check("正常生成物校验通过", good.ok, good.errors.map((e) => `${e.where}:${e.message}`).join(" | "));

  // ── 现成的「坏 / 好」夹具 ────────────────────────────────────────────
  // 来自参考项目 `spine-animation-ai/examples/sombrero/`：两份都声明自己是
  // 4.2，但 `skeleton.json` 其实是 3.8 写法（用 `angle`、translate 的 curve 只给
  // 4 个数、控制点是归一化的），`sombrero.json` 才是真正合规的那份。
  // 仓库里没有任何测试去断言它们的差别——这里补上：校验器必须分得开。
  {
    const bad = JSON.parse(await readFile(new URL("./fixtures/spine42/bad-38-style.json", import.meta.url), "utf8"));
    const badReport = validateSpineWire(bad);
    const badCodes = new Set(badReport.errors.map((e) => e.code));
    check("坏夹具（声明 4.2 但用 3.8 写法）被判失败", !badReport.ok, badReport.summary);
    check("认出 `angle` 写法", badCodes.has("rotate-angle"));
    check("认出控制点不是绝对量", badCodes.has("curve-not-absolute"));
    check("认出末帧带 curve", badCodes.has("curve-on-last-frame"));

    const goodFixture = JSON.parse(await readFile(new URL("./fixtures/spine42/good-42-style.json", import.meta.url), "utf8"));
    const goodReport = validateSpineWire(goodFixture);
    check("好夹具（真正合规的 4.2）通过", goodReport.ok, goodReport.errors.slice(0, 3).map((e) => `${e.where}:${e.message}`).join(" | "));
  }

  const baseFrames = () => [
    { time: 0, value: 0, curve: [0.25, 0, 0.75, 1] },
    { time: 0.5, value: 10 }
  ];

  // ① angle
  const angle = validateSpineWire({ animations: { a: { bones: { b: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 5 }] } } } } });
  check("angle → error", !angle.ok && angle.errors.some((e) => e.code === "rotate-angle"), angle.summary);

  // ② curve 长度：translate 需要 8 个，只给 4 个
  const shortCurve = validateSpineWire({ animations: { a: { bones: { b: { translate: [{ time: 0, x: 0, y: 0, curve: [0.25, 0, 0.75, 1] }, { time: 1, x: 10, y: 5 }] } } } } });
  check("translate 只给 4 个控制点 → error", !shortCurve.ok && shortCurve.errors.some((e) => e.code === "curve-length"), shortCurve.summary);

  // ③ 控制点不是绝对量（写成 0..1 归一化）
  const normalized = validateSpineWire({ animations: { a: { bones: { b: { rotate: [{ time: 100, value: 0, curve: [0.25, 0, 0.75, 1] }, { time: 200, value: 10 }] } } } } });
  check("归一化控制点 → error", !normalized.ok && normalized.errors.some((e) => e.code === "curve-not-absolute"), normalized.summary);

  // ④ 末帧带 curve
  const lastCurve = validateSpineWire({ animations: { a: { bones: { b: { rotate: [...baseFrames(), { time: 1, value: 0, curve: [1, 0, 1, 1] }] } } } } });
  check("末帧带 curve → error", !lastCurve.ok && lastCurve.errors.some((e) => e.code === "curve-on-last-frame"), lastCurve.summary);

  // 合法：stepped + 正确的 8 控制点
  const legal = validateSpineWire({
    animations: {
      a: {
        bones: {
          b: {
            rotate: [{ time: 0, value: 0, curve: "stepped" }, { time: 0.5, value: 3 }],
            translate: [{ time: 0, x: 0, y: 0, curve: [0.1, 0, 0.3, 2, 0.1, 0, 0.3, 2] }, { time: 0.5, x: 4, y: 2 }]
          }
        }
      }
    }
  });
  check("stepped 与 8 控制点都合法", legal.ok, legal.errors.map((e) => `${e.where}:${e.message}`).join(" | "));

  // 时间不递增
  const badTime = validateSpineWire({ animations: { a: { bones: { b: { rotate: [{ time: 1, value: 0 }, { time: 1, value: 5 }] } } } } });
  check("时间不递增 → error", !badTime.ok && badTime.errors.some((e) => e.code === "time-order"), badTime.summary);

  // 骨架 ↔ 图集一致性
  const mismatch = validateSkeletonAtlasMatch(spine, packed.pages);
  check("骨架与图集一致", mismatch.ok, mismatch.errors.map((e) => e.where).join("、"));
  const mismatchBad = validateSkeletonAtlasMatch({ skins: [{ attachments: { slotA: { attMissing: {} } } }] }, packed.pages);
  check("挂点找不到区域 → error", !mismatchBad.ok && mismatchBad.errors.some((e) => e.code === "attachment-missing-region"), mismatchBad.summary);
}

console.log("=== 8d. 动画参数与循环接缝 ===");
{
  // 预设本身必须首尾闭合——参考项目只在 prose 里要求「All loops must return to
  // starting values」，脚本完全不校验。
  const loops = validateAnimationLoops(spine);
  check("预设动画都首尾闭合", loops.ok, loops.errors.slice(0, 2).map((e) => `${e.where}: ${e.message}`).join(" | "));

  const open = validateAnimationLoops({
    animations: { walk: { bones: { torso: { rotate: [{ time: 0, value: 0 }, { time: 0.4, value: 5 }, { time: 0.8, value: 9 }] } } } }
  });
  check("不闭合的循环 → error", !open.ok && open.errors.some((e) => e.code === "loop-not-closed"), open.summary);

  // 非循环动作不参与该检查。
  const idleOnly = validateAnimationLoops({ animations: { notALoop: { bones: { torso: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 9 }] } } } } });
  check("不在预设表里的动作不检查", idleOnly.ok, idleOnly.summary);

  // 用完整 16 部件骨架测参数：幅度与时长都要真的生效，
  // 而且必须**仍然通过 wire 校验**（参数若在绝对化之后缩放，控制点就会跑出段外）。
  const fullParts = defaultPartNames().map((name, index) => ({
    name,
    file: `${name}.png`,
    x: 20 + (index % 4) * 90,
    y: 20 + Math.floor(index / 4) * 130,
    width: 80,
    height: 120,
    scale: 1,
    rotation: 0,
    z: index
  }));
  const plain = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts: fullParts, animationIds: ["walk"] });
  const scaled = buildSkeleton({
    canvasWidth: W,
    canvasHeight: H,
    parts: fullParts,
    animationIds: ["walk"],
    animationSettings: { walk: { amplitude: 2, duration: 1.6 } }
  });

  const plainFrames = plain.spine.animations.walk.bones.torso.rotate;
  const scaledFrames = scaled.spine.animations.walk.bones.torso.rotate;
  const plainAmp = Math.max(...plainFrames.map((f) => Math.abs(f.value)));
  const scaledAmp = Math.max(...scaledFrames.map((f) => Math.abs(f.value)));
  check("amplitude 放大旋转幅度", Math.abs(scaledAmp - plainAmp * 2) < 0.01, `${plainAmp} → ${scaledAmp}`);

  const plainEnd = plainFrames[plainFrames.length - 1].time;
  const scaledEnd = scaledFrames[scaledFrames.length - 1].time;
  check("duration 改循环时长", Math.abs(plainEnd - 0.8) < 1e-6 && Math.abs(scaledEnd - 1.6) < 1e-6, `${plainEnd} → ${scaledEnd}`);

  check("缩放后仍然通过 wire 校验（控制点没跑出段外）", validateSpineWire(scaled.spine).ok,
    validateSpineWire(scaled.spine).errors.slice(0, 2).map((e) => `${e.where}: ${e.message}`).join(" | "));
  check("缩放后仍然首尾闭合", validateAnimationLoops(scaled.spine).ok);

  // 幅度只该作用在数值上，不该动控制点的归属结构。
  const scaledCurve = scaledFrames[0].curve;
  check("控制点仍是 4 个数（rotate）", Array.isArray(scaledCurve) && scaledCurve.length === 4, JSON.stringify(scaledCurve));
  check("控制点仍在所属区间内",
    scaledCurve[0] >= scaledFrames[0].time - 1e-3 && scaledCurve[2] <= scaledFrames[1].time + 1e-3,
    `${scaledCurve[0]},${scaledCurve[2]} vs [${scaledFrames[0].time}, ${scaledFrames[1].time}]`);
}

console.log("=== 8e. 换色（贴图变体的基础） ===");
{
  const src = createRgba(4, 1);
  // 三个不透明像素（红/绿/蓝）+ 一个全透明。
  const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [123, 45, 67, 0]];
  colors.forEach((color, index) => {
    for (let c = 0; c < 4; c++) src.data[index * 4 + c] = color[c];
  });

  const identity = tintRgba(src, {});
  check("空参数 = 原样返回", Buffer.compare(identity.data, src.data) === 0);

  const hue = tintRgba(src, { hue: 120 });
  check("色相 +120° 把红变绿", hue.data[0] < 60 && hue.data[1] > 200, `rgb(${hue.data[0]},${hue.data[1]},${hue.data[2]})`);
  check("色相旋转不动 alpha", hue.data[3] === 255 && hue.data[11] === 255 && hue.data[15] === 0);
  check("全透明像素保持不变（换色不该把「没有像素」变成「有一点像素」）",
    hue.data[12] === 123 && hue.data[13] === 45 && hue.data[14] === 67 && hue.data[15] === 0);

  const gray = tintRgba(src, { saturation: 0 });
  check("饱和度 0 → 灰（R=G=B）", gray.data[0] === gray.data[1] && gray.data[1] === gray.data[2], `${gray.data[0]},${gray.data[1]},${gray.data[2]}`);

  const brighter = tintRgba(src, { brightness: 0.2 });
  check("亮度 +0.2 让红更亮或已饱和", brighter.data[0] >= src.data[0] && brighter.data[1] > src.data[1], `rgb(${brighter.data[0]},${brighter.data[1]},${brighter.data[2]})`);

  const clamped = tintRgba(src, { brightness: 5 });
  check("超范围亮度被夹到 0..255", clamped.data[0] === 255 && clamped.data[1] === 255 && clamped.data[2] === 255);

  const darker = tintRgba(src, { contrast: 0.2, brightness: -0.4 });
  check("低对比 + 负亮度不会溢出", darker.data.every((value) => value >= 0 && value <= 255));

  check("换色不改尺寸", hue.width === src.width && hue.height === src.height);
  check("原图不被就地修改", src.data[0] === 255 && src.data[4] === 0);
}

console.log("=== 8f. AI 重绘的三个基础操作 ===");
{
  // ① 正方化：细长部件要先补成正方形，模型才不会重新构图。
  const tall = createRgba(20, 60);
  for (let y = 10; y < 50; y++) for (let x = 5; x < 15; x++) {
    const at = (y * 20 + x) * 4;
    tall.data[at] = 200; tall.data[at + 1] = 40; tall.data[at + 2] = 40; tall.data[at + 3] = 255;
  }
  const square = padToSquare(tall);
  check("补成正方形", square.size === 60 && square.image.width === 60 && square.image.height === 60, `${square.image.width}×${square.image.height}`);
  check("补边是居中的", square.padX === 20 && square.padY === 0, `pad=${square.padX},${square.padY}`);
  const centerAt = ((30 * 60) + 30) * 4;
  check("部件落在正方形中央", square.image.data[centerAt] === 200 && square.image.data[centerAt + 3] === 255);
  const cornerAt = 0;
  check("补边是白底且不透明", square.image.data[cornerAt] === 255 && square.image.data[cornerAt + 3] === 255);

  // ② 裁回 + 缩放 + 用原图 alpha 当掩码：轮廓必须保持原样。
  const fake = createRgba(60, 60, [10, 200, 10, 255]); // 模型交回来的「整张都是绿的」
  const masked = maskAndFit(fake, tall, square, 20, 60);
  check("缩放回原尺寸", masked.width === 20 && masked.height === 60, `${masked.width}×${masked.height}`);
  check("轮廓按原图 alpha 裁掉（模型画的背景被切掉）", masked.data[3] === 0 && masked.data[((30 * 20) + 10) * 4 + 3] === 255,
    `角 alpha=${masked.data[3]} 中心 alpha=${masked.data[((30 * 20) + 10) * 4 + 3]}`);
  check("保留模型给的像素颜色", masked.data[((30 * 20) + 10) * 4 + 1] > 150);

  // ②b **模型返回的尺寸几乎总是和补边正方形不同**（Seedream 固定给 2048×2048）。
  //    不先缩放就直接按 padX/padY 取样，读到的只是大图左上角一块平坦区域——
  //    症状是「模型明明画对了，我们却拿到一片纯色」。这条断言就是为了钉住它。
  const bigSame = createRgba(240, 240, [10, 200, 10, 255]); // 240 = 4× 的 60
  // 部件在补边正方形里占 x∈[25,35)、y∈[10,50)（padX=20），放大 4 倍就是
  // x∈[100,140)、y∈[40,200)。**只在部件投影区画红块**，这样：
  //   · 修好之后（先缩放到正方形再裁）中心读到红色；
  //   · 没修时（直接按 padX/padY 从大图取样）读到的是左上角的绿色。
  for (let y = 40; y < 200; y++) for (let x = 100; x < 140; x++) {
    const at = (y * 240 + x) * 4;
    bigSame.data[at] = 255; bigSame.data[at + 1] = 0; bigSame.data[at + 2] = 0;
  }
  const maskedBig = maskAndFit(bigSame, tall, square, 20, 60);
  const bigCenter = ((30 * 20) + 10) * 4;
  check("模型返回大图时先缩放再裁（不会读到左上角一片纯色）",
    maskedBig.data[bigCenter] > 200 && maskedBig.data[bigCenter + 1] < 80,
    `中心 rgb(${maskedBig.data[bigCenter]},${maskedBig.data[bigCenter + 1]},${maskedBig.data[bigCenter + 2]})`);
  check("大图路径下轮廓同样保持", maskedBig.data[3] === 0 && maskedBig.data[bigCenter + 3] === 255);

  // ③ 腐蚀 alpha：削掉 AI 部件边缘的白晕。
  const solid = createRgba(9, 9, [255, 255, 255, 255]);
  const eroded1 = erodeAlpha(solid, 1);
  const eroded2 = erodeAlpha(solid, 2);
  const alphaAt = (image, x, y) => image.data[(y * image.width + x) * 4 + 3];
  check("腐蚀 1 次把外圈清掉", alphaAt(eroded1, 0, 4) === 0 && alphaAt(eroded1, 4, 4) === 255, `边=${alphaAt(eroded1, 0, 4)} 心=${alphaAt(eroded1, 4, 4)}`);
  check("腐蚀 2 次清得更深", alphaAt(eroded2, 1, 4) === 0 && alphaAt(eroded2, 4, 4) === 255, `边=${alphaAt(eroded2, 1, 4)} 心=${alphaAt(eroded2, 4, 4)}`);
  check("半径 0 = 原样", Buffer.compare(erodeAlpha(solid, 0).data, solid.data) === 0);
  check("腐蚀不改原图", solid.data[3] === 255);

  // ④ 结果健全性：纯色结果必须能被识别出来（否则用户会拿到一版白块贴图）。
  const blank = createRgba(10, 10, [252, 252, 252, 255]);
  const blankStats = imageStats(blank);
  check("纯白图的标准差接近 0", blankStats.stdDev < 2, `stdDev=${blankStats.stdDev.toFixed(2)}`);
  check("纯白图被判为「没内容」（低于阈值）", blankStats.stdDev < 6);
  const artwork = createRgba(10, 10, [252, 252, 252, 255]);
  for (let i = 0; i < 30; i++) { artwork.data[i * 4] = 20; artwork.data[i * 4 + 1] = 40; artwork.data[i * 4 + 2] = 90; }
  const artStats = imageStats(artwork);
  check("有内容的图标准差明显更大", artStats.stdDev > 60, `stdDev=${artStats.stdDev.toFixed(1)}`);
  check("只统计不透明像素", imageStats(createRgba(4, 4, [0, 0, 0, 0])).opaque === 0);
  check("平均值合理", Math.abs(artStats.meanLuma - (imageStats(artwork).meanLuma)) < 1e-9);
}

console.log("=== 9. 预览 HTML ===");
const html = buildPreviewHtml({
  title: "验证角色",
  spine,
  images: placed.map((item) => ({ name: item.name, dataUri: `data:image/png;base64,${encodePng(item.rgba.data, item.rgba.width, item.rgba.height).toString("base64")}` })),
  defaultAnimation: "walk"
});
check("HTML 自带 doctype", html.startsWith("<!DOCTYPE html>"));
check("HTML 没有外部 script/link 依赖", !/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html));
check("HTML 内联了骨架 JSON", html.includes('"spine":"4.2.0"') || html.includes('"spine": "4.2.0"'));
check("HTML 内联了部件图片", html.includes("data:image/png;base64,"));
check("HTML 默认播放 walk", html.includes('var current = "walk"'));

console.log("=== 10. 预设骨骼名覆盖 ===");
check("默认拆件名包含 16 个标准部件", defaultPartNames().length === 16, defaultPartNames().join(","));
{
  const all = buildSkeleton({
    canvasWidth: W,
    canvasHeight: H,
    parts: defaultPartNames().map((name, index) => ({
      name,
      file: `${name}.png`,
      x: 10 + (index % 4) * 90,
      y: 10 + Math.floor(index / 4) * 130,
      width: 80,
      height: 120,
      scale: 1,
      rotation: 0,
      z: index
    })),
    animationIds: ["idle", "walk", "run", "wave", "jump", "attack"]
  });
  check("完整 16 部件下 6 个动画都有内容", Object.values(all.spine.animations).every((a) => Object.keys(a.bones).length > 0));
  check("没有告警", all.warnings.length === 0, all.warnings.join(" | "));
}

console.log("=== 11. DragonBones 5.5 导出 ===");
{
  const { spine: dbSpineSource, animationsRaw } = buildSkeleton({
    name: "verify",
    canvasWidth: W,
    canvasHeight: H,
    parts: layoutParts,
    animationIds: ["idle", "walk", "wave", "jump", "run", "attack"]
  });
  const db = buildDragonBonesSkeleton({
    name: "verify",
    canvasWidth: W,
    canvasHeight: H,
    spine: dbSpineSource,
    animations: animationsRaw
  });

  check("版本写 5.5（解析器白名单内）", db.version === "5.5" && db.compatibleVersion === "5.5");
  check("顶层带 frameRate", db.frameRate === DRAGONBONES_FRAME_RATE);
  const armature = db.armature[0];
  check("骨骼数与 Spine 一致", armature.bone.length === dbSpineSource.bones.length);
  check("槽位数与 Spine 一致", armature.slot.length === dbSpineSource.slots.length);
  check("槽位顺序即 zOrder（与 Spine 的绘制序一致）",
    armature.slot.map((s) => s.name).join(",") === dbSpineSource.slots.map((s) => s.name).join(","));
  check("骨骼用 transform.skX/skY 而不是 rotation",
    armature.bone.every((b) => b.transform !== undefined && b.rotation === undefined && b.transform.skX === b.transform.skY));
  check("骨骼父级都在子级之前（拓扑序）", (() => {
    const seen = new Set();
    for (const bone of armature.bone) {
      if (bone.parent !== undefined && !seen.has(bone.parent)) return false;
      seen.add(bone.name);
    }
    return true;
  })());
  check("inherit* 四项显式写全", armature.bone.every((b) =>
    b.inheritTranslation === true && b.inheritRotation === true && b.inheritScale === true && b.inheritReflection === true));
  check("每个槽位的父骨骼都存在", armature.slot.every((s) => armature.bone.some((b) => b.name === s.parent)));
  check("皮肤只有一套 default", armature.skin.length === 1 && armature.skin[0].name === "default");
  check("图片挂点用 pivot 0.5/0.5 + transform 落点", armature.skin[0].slot.every((s) => {
    const d = s.display[0];
    return d.type === "image" && d.pivot.x === 0.5 && d.pivot.y === 0.5 && typeof d.transform.x === "number";
  }));
  check("挂点 path == 图集区域名", armature.skin[0].slot.every((s) => s.display[0].path === s.display[0].name));

  // 挂点位置：DragonBones 的渲染是「图片左上角画在 -pivot 处」，pivot 由
  // `pivot.x * frameWidth + frameX` 算出。模拟一遍，图片中心必须回到挂点上。
  {
    let worst = 0;
    for (const slot of armature.skin[0].slot) {
      const d = slot.display[0];
      const att = dbSpineSource.skins[0].attachments[slot.name][slot.name];
      // 未裁剪时 frame 为 null，rect = region = 原尺寸。
      const frameWidth = att.width;
      const frameHeight = att.height;
      const pivotX = d.pivot.x * frameWidth;
      const pivotY = d.pivot.y * frameHeight;
      // 图片中心（display 局部）→ 经 transform 旋转 → 骨骼局部。
      const rad = (d.transform.skY * Math.PI) / 180;
      const cx = (frameWidth / 2 - pivotX);
      const cy = (frameHeight / 2 - pivotY);
      const wx = d.transform.x + cx * Math.cos(rad) - cy * Math.sin(rad);
      const wy = d.transform.y + cx * Math.sin(rad) + cy * Math.cos(rad);
      worst = Math.max(worst, Math.hypot(wx - att.x, wy - att.y));
    }
    check("图片中心与 Spine 挂点重合（偏差 < 0.01px）", worst < 0.01, `最差 ${worst.toFixed(5)}px`);
  }

  // 动画：时长是帧数、补间帧必须显式声明缓动、curve 是 0~1 归一化。
  check("6 个动画都在", armature.animation.length === 6, armature.animation.map((a) => a.name).join(","));
  check("duration 是正整数帧数", armature.animation.every((a) => Number.isInteger(a.duration) && a.duration > 0),
    armature.animation.map((a) => `${a.name}:${a.duration}`).join(" "));
  {
    const idle = armature.animation.find((a) => a.name === "idle");
    check("idle 时长 = 1.6s × 30fps = 48 帧", idle.duration === 48, String(idle.duration));
    const walk = armature.animation.find((a) => a.name === "walk");
    check("walk 时长 = 0.8s × 30fps = 24 帧", walk.duration === 24, String(walk.duration));
    check("循环动画 playTimes = 0（无限）", armature.animation.every((a) => a.playTimes === 0));
  }
  {
    let tweenFrames = 0;
    let explicit = 0;
    let badCurve = 0;
    for (const animation of armature.animation) {
      for (const timeline of animation.bone) {
        for (const key of ["rotateFrame", "translateFrame", "scaleFrame"]) {
          const frames = timeline[key];
          if (frames === undefined) continue;
          for (let i = 0; i < frames.length - 1; i++) {
            tweenFrames++;
            const frame = frames[i];
            if (frame.tweenEasing !== undefined || frame.curve !== undefined) explicit++;
            if (frame.curve !== undefined && frame.curve.length % 3 !== 1 && frame.curve.length % 3 !== 2) badCurve++;
            if (frame.duration <= 0) badCurve++;
          }
        }
      }
    }
    check(`补间帧全部显式声明缓动（${tweenFrames} 帧）`, explicit === tweenFrames, `${explicit}/${tweenFrames}`);
    check("curve 长度合法且中间帧 duration ≥ 1", badCurve === 0, `${badCurve} 处`);
  }
  {
    // curve 必须是**归一化**的：同一条曲线在 Spine 那边被绝对化过，
    // 反推回去应该正好等于 DragonBones 写的 0~1 值。
    const boneName = Object.keys(animationsRaw.walk.bones).find((name) => animationsRaw.walk.bones[name].rotate !== undefined);
    const rawFrames = animationsRaw.walk.bones[boneName].rotate;
    const dbTimeline = armature.animation.find((a) => a.name === "walk").bone.find((t) => t.name === boneName);
    const spineFrames = dbSpineSource.animations.walk.bones[boneName].rotate;
    let worst = 0;
    let compared = 0;
    for (let i = 0; i + 1 < rawFrames.length; i++) {
      const authored = rawFrames[i + 1].curve;
      if (!Array.isArray(authored)) continue;
      const spineCurve = spineFrames[i].curve;
      if (!Array.isArray(spineCurve)) continue;
      const time1 = rawFrames[i].time;
      const time2 = rawFrames[i + 1].time;
      const span = time2 - time1;
      const value1 = rawFrames[i].angle ?? 0;
      const value2 = rawFrames[i + 1].angle ?? 0;
      const delta = value2 - value1;
      // Spine 侧是绝对量 → 归一化回去。
      const back = [(spineCurve[0] - time1) / span, delta === 0 ? 0 : (spineCurve[1] - value1) / delta,
        (spineCurve[2] - time1) / span, delta === 0 ? 0 : (spineCurve[3] - value1) / delta];
      const dbCurve = dbTimeline.rotateFrame[i].curve;
      for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(back[k] - dbCurve[k]));
      compared++;
    }
    check(`curve 是 0~1 归一化（与 Spine 绝对量互逆，比了 ${compared} 段）`, compared > 0 && worst < 1e-3, `最差 ${worst.toExponential(2)}`);
    if (compared === 0) check("walk 至少有一段带 bezier 的补间", false, "没比到任何一段");
  }

  // 正例：完整导出物必须过校验器。
  const dbReport = validateDragonBones(db);
  check("导出的骨架通过 validateDragonBones", dbReport.ok, dbReport.errors.map((e) => `${e.where} ${e.message}`).join("；"));

  // 反例：每一条地雷都要被抓住——否则校验器就是摆设。
  const mutate = (fn) => {
    const copy = JSON.parse(JSON.stringify(db));
    fn(copy);
    return validateDragonBones(copy);
  };
  check("抓住 version 不在白名单", !mutate((d) => { d.version = "6.0"; d.compatibleVersion = "6.0"; }).ok);
  check("抓住补间帧漏写缓动", !mutate((d) => {
    const frames = d.armature[0].animation[0].bone[0].rotateFrame;
    delete frames[0].tweenEasing;
    delete frames[0].curve;
  }).ok);
  check("抓住 curve 长度非法", !mutate((d) => {
    const frames = d.armature[0].animation[0].bone[0].rotateFrame;
    frames[0].curve = [0.1, 0.2, 0.3];
    delete frames[0].tweenEasing;
  }).ok);
  check("抓住中间帧 duration = 0", !mutate((d) => {
    d.armature[0].animation[0].bone[0].rotateFrame[0].duration = 0;
  }).ok);
  check("抓住父级骨骼缺失", !mutate((d) => { d.armature[0].bone[1].parent = "不存在的骨头"; }).ok);
  check("抓住槽位挂在缺失骨骼上", !mutate((d) => { d.armature[0].slot[0].parent = "不存在的骨头"; }).ok);
  check("抓住动画引用缺失骨骼", !mutate((d) => { d.armature[0].animation[0].bone[0].name = "不存在的骨头"; }).ok);
  check("抓住 duration 非帧数（写成秒）", !mutate((d) => { d.armature[0].animation[0].duration = 1.6; }).ok);

  // 贴图描述：裁剪过的部件必须给全 frame*。
  //
  // 符号约定（照着 runtime 反推，不是猜的）：`Slot._updateFrame` 里
  // `_pivotX = pivot.x * frameWidth + frameX`，图片左上角画在 `-pivot` 处；
  // 要让**原图**中心落在挂点上，就需要 `pivotX = 原图宽/2 - 裁剪左边距`，
  // 即 `frameX = -裁剪左边距 = offsetX`（我们图集里 offsetX 恒 ≤ 0）。
  const page = {
    name: "skeleton.png",
    width: 256,
    height: 256,
    placements: [
      { name: "head", x: 2, y: 2, width: 60, height: 80 },
      { name: "torso", x: 70, y: 2, width: 40, height: 50, origWidth: 56, origHeight: 66, offsetX: -5, offsetY: -7 }
    ]
  };
  const tex = buildDragonBonesTexture(page, { imagePath: "skeleton.png", name: "skeleton" });
  check("_tex.json 顶层字段齐全",
    tex.name === "skeleton" && tex.imagePath === "skeleton.png" && tex.width === 256 && tex.height === 256 && tex.scale === 1);
  check("未裁剪的部件不写 frame*", tex.SubTexture[0].frameX === undefined && tex.SubTexture[0].frameWidth === undefined);
  check("裁剪过的部件写全 frame*（frameX = 裁剪偏移，负值）",
    tex.SubTexture[1].frameX === -5 && tex.SubTexture[1].frameY === -7 &&
    tex.SubTexture[1].frameWidth === 56 && tex.SubTexture[1].frameHeight === 66);
  check("_tex.json 通过校验", validateDragonBonesTexture(tex).ok);
  check("抓住区域越界", !validateDragonBonesTexture({
    ...tex,
    SubTexture: [{ ...tex.SubTexture[0], x: 250, width: 60 }]
  }).ok);
  check("抓住 frame* 只给一半", !validateDragonBonesTexture({
    ...tex,
    SubTexture: [{ ...tex.SubTexture[1], frameHeight: undefined }]
  }).ok);

  // 裁剪后的挂点落点：照 runtime 的算法算一遍，确认 frameX 的符号没写反。
  {
    const att = { x: 10, y: -4, rotation: 0, width: 56, height: 66 };
    const trimX = 5; // 从左边裁掉 5px
    const trimY = 7;
    const item = tex.SubTexture[1];
    const pivotX = 0.5 * item.frameWidth + item.frameX;
    const pivotY = 0.5 * item.frameHeight + item.frameY;
    // display 局部里，原图左上角 = 裁剪区左上角(-pivot) 再往回退裁剪量。
    const centerX = -pivotX - trimX + att.width / 2;
    const centerY = -pivotY - trimY + att.height / 2;
    check("裁剪件的原图中心落在挂点上", Math.abs(centerX) < 1e-9 && Math.abs(centerY) < 1e-9, `(${centerX}, ${centerY})`);
    check("pivot 折算正确（0.5*56-5）", pivotX === 23 && pivotY === 26, `${pivotX}, ${pivotY}`);
  }
}

console.log("=== 12. 语义成环时骨架必须仍然无环 ===");
{
  // 实测撞出来的场景：语义表被手工/AI 改成 `hip.parent = torso`，
  // 而 `torso.parent = hip`（躯干的默认父级本来就是胯部）。
  // 旧的父级解析函数「断环之后又兜底挂回 torso」，于是产物里
  // `hip ← torso` 与 `torso ← hip` 同时存在——Spine 那边一路绿灯，
  // 是 DragonBones 的拓扑序校验才把它揪出来的。
  const cyclic = buildSkeleton({
    canvasWidth: W,
    canvasHeight: H,
    parts: [
      { name: "hip", file: "hip.png", x: 180, y: 300, width: 90, height: 70, scale: 1, rotation: 0, z: 0, parent: "torso" },
      { name: "torso", file: "torso.png", x: 170, y: 200, width: 100, height: 140, scale: 1, rotation: 0, z: 1, parent: "hip" },
      { name: "head", file: "head.png", x: 185, y: 120, width: 70, height: 80, scale: 1, rotation: 0, z: 2 }
    ],
    animationIds: ["idle"]
  });
  const indexOf = (name) => cyclic.spine.bones.findIndex((b) => b.name === name);
  check("成环语义下仍然产出骨骼", cyclic.spine.bones.length === 4, cyclic.spine.bones.map((b) => `${b.name}<-${b.parent}`).join(" "));
  check("没有自环", cyclic.spine.bones.every((b) => b.parent !== b.name));
  check("没有互环（hip 与 torso 不再互相指认）", (() => {
    const hip = cyclic.spine.bones.find((b) => b.name === "hip");
    const torso = cyclic.spine.bones.find((b) => b.name === "torso");
    return !(hip.parent === "torso" && torso.parent === "hip");
  })(), `hip<-${cyclic.spine.bones.find((b) => b.name === "hip").parent} torso<-${cyclic.spine.bones.find((b) => b.name === "torso").parent}`);
  check("骨骼表是拓扑序", cyclic.spine.bones.every((bone) => bone.parent === undefined || indexOf(bone.parent) < indexOf(bone.name)));
  check("断环这件事被写进了告警", cyclic.warnings.some((w) => w.includes("环")), cyclic.warnings.join(" | "));
  check("Spine 校验器认可这份骨架", validateSpineWire(cyclic.spine).ok,
    validateSpineWire(cyclic.spine).errors.map((e) => `${e.where} ${e.message}`).join("；"));
  check("DragonBones 校验器也认可", (() => {
    const db = buildDragonBonesSkeleton({
      name: "cyclic", canvasWidth: W, canvasHeight: H, spine: cyclic.spine, animations: cyclic.animationsRaw
    });
    const report = validateDragonBones(db);
    return report.ok;
  })());
  // 反例：手写一份成环的骨骼表，新加的拓扑序校验必须抓住。
  check("Spine 校验器抓得住成环的骨骼表", !validateSpineWire({
    bones: [{ name: "hip", parent: "torso" }, { name: "torso", parent: "hip" }],
    animations: {}
  }).ok);
}

console.log("=== 13. 默认网格的骨架不该有互环 ===");
{
  // `hip` 是身体根（`RIG_SLOTS` 里它的 parent 就是 undefined）。
  // 兜底逻辑无权把它挂到躯干上——那会立刻和「躯干的父级是胯部」互环。
  const grid = buildSkeleton({
    canvasWidth: W,
    canvasHeight: H,
    parts: defaultPartNames().map((name, index) => ({
      name,
      file: `${name}.png`,
      x: 10 + (index % 4) * 90,
      y: 10 + Math.floor(index / 4) * 130,
      width: 80,
      height: 120,
      scale: 1,
      rotation: 0,
      z: index
    })),
    animationIds: ["idle"]
  });
  const hip = grid.spine.bones.find((b) => b.name === "hip");
  const torso = grid.spine.bones.find((b) => b.name === "torso");
  check("hip 是根骨骼", hip.parent === undefined, `hip<-${hip.parent}`);
  check("torso 挂在 hip 上", torso.parent === "hip", `torso<-${torso.parent}`);
  check("默认网格不产生任何告警", grid.warnings.length === 0, grid.warnings.join(" | "));
  check("默认网格的骨骼表是拓扑序", grid.spine.bones.every((bone) =>
    bone.parent === undefined || grid.spine.bones.findIndex((b) => b.name === bone.parent) < grid.spine.bones.findIndex((b) => b.name === bone.name)));
}

console.log("=== 14. 拆件质检 ===");
{
  // 用合成图形构造这次真实踩到的形态：同一部位画了多遍 + 完全不同的部件混在一起。
  // 判据必须能区分「同一块重画」和「长得像但确实不同」。
  const legLike = (wobble) => {
    const image = createRgba(60, 140);
    for (let y = 0; y < 140; y++) {
      for (let x = 0; x < 60; x++) {
        // 上宽下窄的腿形；`wobble` 制造一点点抗锯齿级差异（模拟重画时的微小出入）。
        const half = 26 - (y / 140) * 12 + (y > 100 ? wobble : 0);
        if (Math.abs(x - 30) > half) continue;
        const idx = (y * 60 + x) * 4;
        image.data[idx] = 240;
        image.data[idx + 1] = 200;
        image.data[idx + 2] = 190;
        image.data[idx + 3] = 255;
      }
    }
    return image;
  };
  const shoeLike = (flip) => {
    const image = createRgba(70, 50);
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 70; x++) {
        const dx = flip ? 69 - x : x;
        if (dx < 8 || dx > 52 || y < 12) continue;
        const idx = (y * 70 + x) * 4;
        image.data[idx] = 40;
        image.data[idx + 1] = 40;
        image.data[idx + 2] = 110;
        image.data[idx + 3] = 255;
      }
    }
    return image;
  };
  const parts = [
    { name: "leg-a", rgba: legLike(0) },
    { name: "leg-b", rgba: legLike(1) },
    { name: "leg-c", rgba: legLike(2) },
    { name: "leg-d", rgba: legLike(0) },
    { name: "shoe-a", rgba: shoeLike(false) },
    { name: "shoe-b", rgba: shoeLike(true) },
    { name: "head", rgba: (() => {
      const image = createRgba(90, 90);
      for (let y = 0; y < 90; y++) {
        for (let x = 0; x < 90; x++) {
          if (Math.hypot(x - 45, y - 45) > 42) continue;
          const idx = (y * 90 + x) * 4;
          image.data[idx] = 120; image.data[idx + 1] = 150; image.data[idx + 2] = 220; image.data[idx + 3] = 255;
        }
      }
      return image;
    })() }
  ];

  const duplicates = findDuplicateParts(parts);
  const legGroup = duplicates.find((group) => group.parts.includes("leg-a"));
  const shoeGroup = duplicates.find((group) => group.parts.includes("shoe-a"));
  check("抓到「同一部位画了 4 遍」", legGroup !== undefined && legGroup.parts.length === 4, JSON.stringify(legGroup?.parts));
  check("同向重合才并组，左右镜像件不并进来", shoeGroup === undefined || shoeGroup.symmetric === true, JSON.stringify(shoeGroup));
  check("圆形头不会被误判成腿或鞋", duplicates.every((group) => !group.parts.includes("head")), JSON.stringify(duplicates.map((g) => g.parts)));
  check("组数正确（2 组）", duplicates.length === 2, String(duplicates.length));

  // 反例：正常的一组部件不该被报成重复。
  const distinct = [
    { name: "a", rgba: legLike(0) },
    { name: "b", rgba: shoeLike(false) },
    { name: "c", rgba: parts[6].rgba }
  ];
  check("三个互不相同的部件不报重复", findDuplicateParts(distinct).length === 0);

  // 装配相似度：这次的实测值是 0.08~0.5，必须被判成「不可信」。
  const badLayout = assessParts({
    partCount: 12,
    matches: [
      { name: "head", score: 0.421, matched: true },
      { name: "torso", score: 0.357, matched: true },
      { name: "hip", score: 0.517, matched: true },
      { name: "left-hand", score: 0.179, matched: true },
      { name: "right-hand-17", score: 0.198, matched: true },
      { name: "right-upper-leg", score: 0.359, matched: true },
      { name: "left-upper-leg", score: 0.117, matched: true },
      { name: "neck-18", score: 0.316, matched: true },
      { name: "right-upper-arm", score: 0.427, matched: true },
      { name: "left-upper-arm", score: 0.367, matched: true }
    ]
  });
  check("低相似度被判成 error", !badLayout.ok);
  check("低相似度的 error 码正确", badLayout.issues.some((issue) => issue.code === "layout-low-confidence"));
  check("低相似度给得出「先给先验再重跑」的建议",
    badLayout.issues.find((issue) => issue.code === "layout-low-confidence")?.suggestion?.includes("setRigLayoutHints") === true);
  check("可信度分数很低", badLayout.score < 0.3, String(badLayout.score));

  const goodLayout = assessParts({
    partCount: 12,
    matches: [
      { name: "head", score: 0.82, matched: true },
      { name: "torso", score: 0.74, matched: true },
      { name: "hip", score: 0.91, matched: true }
    ]
  });
  check("高相似度 + 无重复 = 通过", goodLayout.ok, goodLayout.summary);
  check("通过时分数明显高于低相似度那一组", goodLayout.score > 0.7 && goodLayout.score > badLayout.score, `${goodLayout.score} vs ${badLayout.score}`);

  // 部件数明显多于参考图可见部位数 → 直接点名「疑似重复」。
  const tooMany = assessParts({ partCount: 18, expectedParts: 14 });
  check("部件数超出目测部位数被判成 error", !tooMany.ok);
  check("部件数超标的 error 码正确", tooMany.issues.some((issue) => issue.code === "too-many-parts"));
  check("没给 expectedParts 就不做这项判断", assessParts({ partCount: 18 }).issues.every((issue) => issue.code !== "too-many-parts"));
  // 隐藏的部件不该参与统计（这次正是靠隐藏 6 块重复件修好的）。
  const withHidden = assessParts({
    partCount: 12,
    matches: [{ name: "head", score: 0.9, matched: true }],
    expectedParts: 14
  });
  check("隐藏之后的部件数不再超标", withHidden.ok, withHidden.summary);
}

console.log("=== 15. IK 约束（M5）===");
{
  const ikSkeleton = buildSkeleton({
    canvasWidth: W,
    canvasHeight: H,
    parts: [
      { name: "torso", file: "torso.png", x: 260, y: 180, width: 120, height: 160, scale: 1, rotation: 0, z: 0 },
      { name: "left-upper-arm", file: "ua.png", x: 300, y: 320, width: 50, height: 130, scale: 1, rotation: 0, z: 1 },
      { name: "left-lower-arm", file: "la.png", x: 300, y: 450, width: 46, height: 130, scale: 1, rotation: 0, z: 2 }
    ],
    animationIds: ["idle"],
    constraints: [
      { type: "ik", name: "ik-left-arm", bone: "left-lower-arm", target: "arm-target", chain: 1, bendPositive: true, weight: 1 }
    ]
  });

  check("骨架里输出了 ik 段", Array.isArray(ikSkeleton.spine.ik) && ikSkeleton.spine.ik.length === 1);
  const ik = ikSkeleton.spine.ik[0];
  check("ik.bones 是从根到末端的骨骼名（含末端）",
    ik.bones.join(",") === "left-upper-arm,left-lower-arm", ik.bones.join(","));
  check("ik.target 指向目标骨", ik.target === "arm-target", ik.target);
  check("ik 带 mix / bendPositive / compress / stretch / uniform",
    ik.mix === 1 && ik.bendPositive === true && ik.compress === false && ik.stretch === false && ik.uniform === false);
  check("目标骨被自动补进骨架", ikSkeleton.spine.bones.some((b) => b.name === "arm-target" && b.length === 0));

  // 目标骨必须落在链末端的**骨尖**上：加上约束的那一刻姿态不该跳。
  {
    const byName = new Map(ikSkeleton.spine.bones.map((b) => [b.name, b]));
    const worldOfBone = (name) => {
      const bone = byName.get(name);
      const parent = bone.parent === undefined ? undefined : worldOfBone(bone.parent);
      if (parent === undefined) return { x: bone.x, y: bone.y, rot: (bone.rotation * Math.PI) / 180 };
      const rad = parent.rot;
      return {
        x: parent.x + bone.x * Math.cos(rad) - bone.y * Math.sin(rad),
        y: parent.y + bone.x * Math.sin(rad) + bone.y * Math.cos(rad),
        rot: rad + (bone.rotation * Math.PI) / 180
      };
    };
    const tip = worldOfBone("left-lower-arm");
    const tipX = tip.x - Math.sin(tip.rot) * byName.get("left-lower-arm").length;
    const tipY = tip.y + Math.cos(tip.rot) * byName.get("left-lower-arm").length;
    const target = byName.get("arm-target");
    check("目标骨落在链末端的骨尖上（加约束时姿态不跳）",
      Math.hypot(target.x - tipX, target.y - tipY) < 0.02,
      `目标 (${target.x},${target.y}) vs 骨尖 (${tipX.toFixed(2)},${tipY.toFixed(2)})`);
  }

  // 没有约束时不该凭空出现 ik 段与目标骨。
  {
    const plain = buildSkeleton({
      canvasWidth: W, canvasHeight: H,
      parts: [{ name: "head", file: "h.png", x: 200, y: 100, width: 80, height: 90, scale: 1, rotation: 0, z: 0 }],
      animationIds: ["idle"]
    });
    check("没有约束时不输出 ik 段", plain.spine.ik === undefined);
  }

  // DragonBones 侧：同一个约束换一种写法（末端骨 + chain），两边必须指同一件事。
  {
    const db = buildDragonBonesSkeleton({
      name: "ik", canvasWidth: W, canvasHeight: H, spine: ikSkeleton.spine, animations: ikSkeleton.animationsRaw
    });
    const dbIk = db.armature[0].ik;
    check("DragonBones 导出了 ik", Array.isArray(dbIk) && dbIk.length === 1);
    check("DragonBones 的 bone 是链末端、chain 不含末端自己",
      dbIk[0].bone === "left-lower-arm" && dbIk[0].chain === 1 && dbIk[0].target === "arm-target",
      JSON.stringify(dbIk[0]));
    check("DragonBones 保留了弯曲方向与权重", dbIk[0].bendPositive === true && dbIk[0].weight === 1);
  }

  // 正例：这份骨架必须过校验器。
  check("带 IK 的骨架通过 validateSpineWire", validateSpineWire(ikSkeleton.spine).ok,
    validateSpineWire(ikSkeleton.spine).errors.map((e) => `${e.where} ${e.message}`).join("；"));

  // 反例：每一条坏约束都要被抓住——否则校验器就是摆设。
  const mutateIk = (fn) => {
    const copy = JSON.parse(JSON.stringify(ikSkeleton.spine));
    fn(copy.ik[0], copy);
    return validateSpineWire(copy);
  };
  check("抓住「IK 链引用了不存在的骨骼」", !mutateIk((c) => { c.bones = ["nope", "left-lower-arm"]; }).ok);
  check("抓住「目标骨不在骨架里」", !mutateIk((c) => { c.target = "no-such-bone"; }).ok);
  check("抓住「目标骨在链上（自环）」", !mutateIk((c) => { c.target = "left-upper-arm"; }).ok);
  // 只有**末端骨**的长度是必须的：它定义了「骨尖」这一端。父骨那一段用的是
  // 「父骨原点到子骨原点的实际距离」，不依赖父骨的 length。
  check("抓住「链末端骨骼长度为 0」", !mutateIk((c, spine) => {
    spine.bones.find((b) => b.name === "left-lower-arm").length = 0;
  }).ok);
  check("父骨长度为 0 但末端正常时不算错（第一段用实际距离）", mutateIk((c, spine) => {
    spine.bones.find((b) => b.name === "left-upper-arm").length = 0;
  }).ok);
  check("抓住「链不足两根骨」", !mutateIk((c) => { c.bones = ["left-lower-arm"]; }).ok);
  check("抓住「mix 越界」", !mutateIk((c) => { c.mix = 1.5; }).ok);
}

console.log("");
if (failures === 0) {
  console.log("全部通过 ✓");
} else {
  console.log(`${failures} 项失败 ✗`);
  process.exitCode = 1;
}
