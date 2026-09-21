/**
 * 自包含骨骼动画预览（HTML）。
 *
 * 为什么不用官方 Spine Web Player：它要从 CDN 拉 `spine-player.js`，而验收页
 * 可能在没有外网的环境里打开（本机离线、内网、或者 CDN 被墙）。这个预览把
 * 部件图片与骨架 JSON 全部以 base64 内联，**零外部依赖**，双击就能看。
 *
 * 渲染器实现的是 spine-core 的那套语义：
 *   - 骨骼局部量 = setup(x, y, rotation) + 动画增量；子骨骼的位移要先用
 *     父骨骼的旋转去转，再叠加到父骨骼世界坐标上。
 *   - 挂点 (x, y) 是图片中心相对骨骼原点的位移，处在骨骼局部坐标系里；
 *     `rotation` 是挂点自身的局部旋转（我们用它在初始姿态里抵消骨骼朝向，
 *     让装配结果逐像素还原）。
 *   - 动画曲线是 **Spine 4.2 的绝对贝塞尔**：4 个数给单属性（rotate 的 value），
 *     8 个数给双属性（translate 的 x、y 各占 4 个）。控制点是 (时间, 值) 空间里
 *     的绝对坐标，因此要在 x(u)=t 上反解 u，再取 y(u)。
 */

export interface PreviewPartImage {
  /** 骨架上的挂点名（同时也是 slots / skins 里的名字）。 */
  name: string;
  /** 已编码好的 data URI（`data:image/png;base64,...`）。 */
  dataUri: string;
}

export interface PreviewOptions {
  title?: string;
  spine: any;
  images: PreviewPartImage[];
  /** 打开时默认播放的动画。 */
  defaultAnimation?: string;
  /** 画布背景（CSS 颜色）。 */
  background?: string;
  /** FFD 变形（部件名 → 参数）。波形位移由预览按当前时间现算。 */
  deforms?: Record<string, { mode: "wave"; amplitude: number; cycles: number; direction: number; anchor: "top" | "bottom" | "none"; duration: number }>;
}

function safeJson(value: unknown): string {
  // JSON 里可能出现 `</script>`，直接内联会提前结束脚本块。
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

export function buildPreviewHtml(options: PreviewOptions): string {
  const title = options.title ?? "骨骼动画预览";
  const images = Object.fromEntries(options.images.map((image) => [image.name, image.dataUri]));
  const animations = Object.keys(options.spine?.animations ?? {});
  const defaultAnimation = options.defaultAnimation !== undefined && animations.includes(options.defaultAnimation)
    ? options.defaultAnimation
    : animations[0] ?? "";
  const background = options.background ?? "#12121c";
  /** 没有变形的部件不必内联任何东西——预览里靠 DEFORMS[name] 是否存在来分流。 */
  const deforms = options.deforms ?? {};

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: ${background};
    color: #e6e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px;
  }
  h1 { font-size: 16px; font-weight: 600; letter-spacing: .04em; color: #aab4d4; }
  #stage { border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.55); background: #1b1b28; }
  canvas { display: block; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
  button {
    background: #262a3d; color: #cfd6ea; border: 1px solid #363c56; border-radius: 8px;
    padding: 6px 12px; font-size: 13px; cursor: pointer; transition: .15s;
  }
  button:hover { background: #31374f; }
  button.active { background: #3f6fff; border-color: #3f6fff; color: #fff; }
  .meta { font-size: 12px; color: #7c86a6; }
  input[type=range] { width: 220px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div id="stage"><canvas id="cv"></canvas></div>
<div class="bar" id="anims"></div>
<div class="bar">
  <button id="play">⏸ 暂停</button>
  <input type="range" id="scrub" min="0" max="1000" value="0" />
  <button id="bones">骨骼</button>
  <button id="grid">网格</button>
  <span class="meta" id="tip"></span>
</div>
<div class="meta">内联渲染，无外部依赖；切换动画即时生效。</div>
<script>
(function () {
  var SPINE = ${safeJson(options.spine)};
  var IMAGE_DATA = ${safeJson(images)};
  var ANIMS = ${safeJson(animations)};
  // FFD 变形参数（部件名 → 波形）。没有它就不会走 mesh 渲染那条路。
  var DEFORMS = ${safeJson(deforms)};
  var current = ${safeJson(defaultAnimation)};
  // 允许用 URL 片段指定初始动画（#walk）：插件的界面用它做「切动画」按钮，
  // 不必反复重载整个预览页。
  var hashAnim = (location.hash || '').replace('#', '');
  if (hashAnim && ANIMS.indexOf(hashAnim) >= 0) current = hashAnim;

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var images = {};
  var loaded = 0;
  var total = Object.keys(IMAGE_DATA).length;

  var bones = {};
  var boneList = [];
  var slots = (SPINE.slots || []).slice();
  var skin = (SPINE.skins && SPINE.skins[0] && SPINE.skins[0].attachments) || {};

  // ── 骨骼树 ──────────────────────────────────────────────────────────
  (SPINE.bones || []).forEach(function (b) {
    bones[b.name] = {
      name: b.name, parent: b.parent || null, children: [],
      setupX: b.x || 0, setupY: b.y || 0, setupRot: b.rotation || 0, length: b.length || 0,
      animX: 0, animY: 0, animRot: 0, worldX: 0, worldY: 0, worldRot: 0
    };
    boneList.push(bones[b.name]);
  });
  boneList.forEach(function (b) {
    if (b.parent && bones[b.parent]) { b.parentBone = bones[b.parent]; bones[b.parent].children.push(b); }
  });

  function updateWorld(b) {
    var lx = b.setupX + b.animX;
    var ly = b.setupY + b.animY;
    var lr = (b.setupRot + b.animRot) * Math.PI / 180;
    if (!b.parentBone) { b.worldX = lx; b.worldY = ly; b.worldRot = lr; }
    else {
      var pr = b.parentBone.worldRot, c = Math.cos(pr), s = Math.sin(pr);
      b.worldX = b.parentBone.worldX + lx * c - ly * s;
      b.worldY = b.parentBone.worldY + lx * s + ly * c;
      b.worldRot = pr + lr;
    }
    for (var i = 0; i < b.children.length; i++) updateWorld(b.children[i]);
  }

  // ── IK 约束（两骨余弦定理） ──────────────────────────────────────────
  //
  // Spine 的 ik 里，bones 是「从根到末端」的骨骼名，target 是目标骨。
  // **只解最后两根**：三骨以上的 IK 需要另一套解法（解析解或 FABRIK），
  // 不是「多迭代几遍」就能对的——宁可不做，也不要给一个看起来能动、
  // 实际姿势错的结果。
  var IKS = (SPINE.ik || []).filter(function (c) { return c && c.bones && c.bones.length >= 2; });

  function shortestAngle(from, to) {
    var d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function solveIk() {
    for (var i = 0; i < IKS.length; i++) {
      var c = IKS[i];
      var chain = c.bones;
      var child = bones[chain[chain.length - 1]];
      var parent = bones[chain[chain.length - 2]];
      var target = bones[c.target];
      if (!child || !parent || !target) continue;
      // **第一段长度与方向都按「子骨原点在父骨局部系里的实际位置」算**，不用 parent.length。
      //
      // IK 的经典推导假设链上骨骼首尾相接（子骨原点落在父骨的局部 +y，即骨尖）。
      // 而我们的骨骼原点取的是**部件近端锚点**，部件摆得不够首尾相接时这个假设就破了：
      // 实测举起的右臂两段被摆在同一小块区域，实际间距 41.9px、而上臂长度 140px；
      // 更关键的是子骨原点在父骨局部系的**方向**（-160°）与父骨朝向（+90°）差了 250°。
      // 只把长度改对、方向还按父骨朝向算，解出来的角度依然不满足几何（骨尖离目标 208px）。
      //
      // 父骨旋转不改变这个局部偏移，所以它稳定等于绑定姿势下的值。
      var l1 = Math.sqrt(child.setupX * child.setupX + child.setupY * child.setupY);
      // 子骨原点在父骨局部系里的方向角；父骨旋转 θ 时，它的世界方向 = θ + phi。
      var phi = Math.atan2(child.setupY, child.setupX);
      var l2 = child.length;
      if (l1 <= 0.01 || l2 <= 0.01) continue;
      var dx = target.worldX - parent.worldX;
      var dy = target.worldY - parent.worldY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1e-6) continue;
      // 够不到就伸直、太近就折到极限：夹进 [|l1-l2|, l1+l2]，
      // 否则 acos 的参数会跑出 [-1,1]，NaN 顺着矩阵扩散、整只骨架消失。
      var d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, dist));
      var base = Math.atan2(dy, dx);
      var cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
      var cosB = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
      var a = Math.acos(Math.max(-1, Math.min(1, cosA)));
      var b = Math.acos(Math.max(-1, Math.min(1, cosB)));
      // bendPositive 决定取哪一支解（肘/膝往哪边弯）。
      var sign = c.bendPositive === false ? -1 : 1;
      var mix = typeof c.mix === 'number' ? Math.max(0, Math.min(1, c.mix)) : 1;
      var pOrig = parent.worldRot, cOrig = child.worldRot;
      // 两骨余弦定理的直接结论：
      //   父骨那一段的朝向 = base − a
      //   子骨的朝向       = **父骨朝向 + (π − b)**
      // 子骨那一项必须相对**父骨朝向**算，不能相对 base——P1 并不在 P0→target 的
      // 直线上，两者差一个 a。写错这一项的表现是「IK 看起来转了、但骨尖就是不到目标」
      // （实测差了整整 91°）。
      var pTheta = base - a * sign;
      var cTheta = pTheta + (Math.PI - b) * sign;
      // 骨骼沿**局部 +y** 生长，朝向角 = 世界旋转 + 90°。
      // 父骨那一段用的是「子骨原点方向」（θ + phi），不是父骨朝向，所以减 phi。
      var pWant = pTheta - phi;
      var cWant = cTheta - Math.PI / 2;
      // 软 IK：在「不约束」与「对齐目标」之间按最短角差插值。
      var pNew = pOrig + shortestAngle(pOrig, pWant) * mix;
      var cNew = cOrig + shortestAngle(cOrig, cWant) * mix;
      var pBase = parent.parentBone ? parent.parentBone.worldRot : 0;
      parent.animRot = pNew * 180 / Math.PI - parent.setupRot - pBase * 180 / Math.PI;
      child.animRot = cNew * 180 / Math.PI - child.setupRot - pNew * 180 / Math.PI;
    }
  }

  // ── 贝塞尔（绝对控制点，4.2 语义） ──────────────────────────────────
  // c = [cx1, cy1, cx2, cy2]，控制点与 time / value 同单位。
  function bezierValue(c, t0, v0, t1, v1, t) {
    if (!c || c.length < 4) {
      var lin = (t1 - t0) > 1e-9 ? (t - t0) / (t1 - t0) : 0;
      return v0 + (v1 - v0) * lin;
    }
    var x1 = c[0], y1 = c[1], x2 = c[2], y2 = c[3];
    var lo = 0, hi = 1, u = 0.5;
    for (var i = 0; i < 24; i++) {
      u = (lo + hi) / 2;
      var mu = 1 - u;
      var x = mu * mu * mu * t0 + 3 * mu * mu * u * x1 + 3 * mu * u * u * x2 + u * u * u * t1;
      if (x < t) lo = u; else hi = u;
    }
    var v = 1 - u;
    return v * v * v * v0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * v1;
  }

  function sampleTrack(frames, t, kind) {
    if (!frames || !frames.length) return null;
    if (frames.length === 1) return frames[0];
    // 末帧之外保持末帧值；时长等于末帧时间时由外层取模，循环自然闭合。
    if (t <= frames[0].time) return frames[0];
    if (t >= frames[frames.length - 1].time) return frames[frames.length - 1];
    for (var i = 0; i < frames.length - 1; i++) {
      var a = frames[i], b = frames[i + 1];
      if (t >= a.time && t <= b.time) {
        if (a.curve === 'stepped') return a;
        if (kind === 'rotate') {
          return { value: bezierValue(a.curve, a.time, a.value || 0, b.time, b.value || 0, t) };
        }
        var cx = a.curve && a.curve.length >= 8 ? a.curve.slice(0, 4) : null;
        var cy = a.curve && a.curve.length >= 8 ? a.curve.slice(4, 8) : null;
        return {
          x: bezierValue(cx, a.time, a.x || 0, b.time, b.x || 0, t),
          y: bezierValue(cy, a.time, a.y || 0, b.time, b.y || 0, t)
        };
      }
    }
    return frames[frames.length - 1];
  }

  function durationOf(anim) {
    var max = 0.0001;
    var b = anim.bones || {};
    Object.keys(b).forEach(function (name) {
      Object.keys(b[name]).forEach(function (kind) {
        (b[name][kind] || []).forEach(function (f) { if (f.time > max) max = f.time; });
      });
    });
    return max;
  }

  function applyAnimation(t) {
    boneList.forEach(function (b) { b.animX = 0; b.animY = 0; b.animRot = 0; });
    var anim = SPINE.animations && SPINE.animations[current];
    if (anim) {
      var tracks = anim.bones || {};
      Object.keys(tracks).forEach(function (name) {
        var bone = bones[name];
        if (!bone) return;
        var tl = tracks[name];
        if (tl.rotate) { var r = sampleTrack(tl.rotate, t, 'rotate'); bone.animRot = (r && r.value) || 0; }
        if (tl.translate) { var v = sampleTrack(tl.translate, t, 'translate'); bone.animX = (v && v.x) || 0; bone.animY = (v && v.y) || 0; }
      });
    }
    // 拖动过的 IK 目标点覆盖动画值：**拖动是用户的即时意图**，不该被动画轨道盖掉
    // （目标骨一般没有自己的轨道，但「手被动画驱动、目标点没动」时必须以手为准）。
    boneList.forEach(function (b) {
      if (b.dragX === undefined) return;
      b.animX = b.dragX - b.setupX;
      b.animY = b.dragY - b.setupY;
    });
  }

  // ── 蒙皮网格 + FFD 变形（M5 的 L1 / L3）─────────────────────────────
  //
  // 有网格的部件走「逐三角形裁剪绘制」，没有的仍是一整块 drawImage。
  // 分流的判据是 att.type === 'mesh'（骨架里写死的），不额外维护一张表。
  //
  // 顶点坐标在骨架里是「部件中心为原点」，与 region attachment 的 -w/2,-h/2 同一套系，
  // 所以两种附件的变换链完全一样，这里只是把 drawImage 换成按三角形贴。

  /**
   * 当前时刻的顶点位移（FFD）。
   *
   * 与宿主 rigmesh.ts 的 buildWaveDeform **同一个公式**：越靠近固定端越不动，
   * 相位按时间推进。两处必须一致，否则「预览里看到的」和「导出的」不是一回事。
   */
  function deformOffsetsOf(name, att, t) {
    var spec = DEFORMS[name];
    if (!spec) return null;
    var verts = att.vertices || [];
    var height = att.height || 1;
    var duration = spec.duration > 0 ? spec.duration : 1;
    var phase = ((t / duration) % 1 + 1) % 1;
    var cycles = spec.cycles || 1;
    var amplitude = spec.amplitude || 0;
    var dirX = Math.cos(spec.direction || 0);
    var dirY = Math.sin(spec.direction || 0);
    var out = new Array(verts.length);
    for (var i = 0; i < verts.length; i += 2) {
      // 顶点是中心坐标，换回「左上角为原点」才能算"离固定端多远"。
      var ly = verts[i + 1] + height / 2;
      var along = spec.anchor === 'bottom' ? 1 - ly / height : spec.anchor === 'none' ? 1 : ly / height;
      // 相位只随时间推进；沿 y 变化的是权重。写成 sin(along·cycles + phase) 会让
      // 不同高度在同一时刻朝相反方向走，整条裙子被横向扯开（第一版就是这个毛病）。
      var sway = Math.sin(phase * cycles * Math.PI * 2);
      var magnitude = amplitude * along * sway;
      out[i] = dirX * magnitude;
      out[i + 1] = dirY * magnitude;
    }
    return out;
  }

  /** 三个源点（图片像素）→ 三个目标点（当前坐标系）的仿射矩阵。 */
  function affineFromTriangles(s0, s1, s2, d0, d1, d2) {
    var denom = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(denom) < 1e-9) return null;
    var a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denom;
    var b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denom;
    var c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denom;
    var d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denom;
    return { a: a, b: b, c: c, d: d, e: d0.x - a * s0.x - c * s0.y, f: d0.y - b * s0.x - d * s0.y };
  }

  function drawMesh(bone, att, img, name, t) {
    var verts = att.vertices || [];
    var uvs = att.uvs || [];
    var tris = att.triangles || [];
    if (verts.length === 0 || tris.length === 0) return;
    var width = att.width || 1;
    var height = att.height || 1;
    var offsets = deformOffsetsOf(name, att, t);
    var halfW = width / 2;
    var halfH = height / 2;

    ctx.save();
    ctx.translate(bone.worldX, bone.worldY);
    ctx.rotate(bone.worldRot);
    ctx.translate(att.x || 0, att.y || 0);
    ctx.rotate((att.rotation || 0) * Math.PI / 180);
    ctx.scale(1, -1);
    // 到这里坐标系是「部件中心为原点、y 向上」，而顶点是「中心为原点、y 向下」
    // （骨架里按图片坐标算的），所以顶点取负 y。
    for (var k = 0; k + 2 < tris.length; k += 3) {
      var i0 = tris[k] * 2, i1 = tris[k + 1] * 2, i2 = tris[k + 2] * 2;
      var p0 = { x: verts[i0] + (offsets ? offsets[i0] : 0), y: -(verts[i0 + 1] + (offsets ? offsets[i0 + 1] : 0)) };
      var p1 = { x: verts[i1] + (offsets ? offsets[i1] : 0), y: -(verts[i1 + 1] + (offsets ? offsets[i1 + 1] : 0)) };
      var p2 = { x: verts[i2] + (offsets ? offsets[i2] : 0), y: -(verts[i2 + 1] + (offsets ? offsets[i2 + 1] : 0)) };
      // 源点用**图片像素**：顶点是中心坐标，加上半宽半高就是图片里的位置。
      var s0 = { x: verts[i0] + halfW, y: verts[i0 + 1] + halfH };
      var s1 = { x: verts[i1] + halfW, y: verts[i1 + 1] + halfH };
      var s2 = { x: verts[i2] + halfW, y: verts[i2 + 1] + halfH };
      var m = affineFromTriangles(s0, s1, s2, p0, p1, p2);
      if (m === null) continue;
      // 三个顶点以重心为中心**外扩一点点**。
      //
      // 逐三角形 clip 之后，每条边的抗锯齿像素都是半透明的，相邻三角形拼起来
      // 就会在共享边上留下一条亮白细线（实测裙子上能看出一整张网格）。外扩之后
      // 三角形彼此重叠，细线被后画的三角形盖掉。源点不跟着扩——那会让纹理整体
      // 放大一圈；这里只挪目标点，代价是每边约 0.5px 的轻微拉伸，看不出来。
      var gx = (p0.x + p1.x + p2.x) / 3;
      var gy = (p0.y + p1.y + p2.y) / 3;
      var grow = 1 + 1.2 / Math.max(1, Math.min(width, height) * view.scale);
      p0 = { x: gx + (p0.x - gx) * grow, y: gy + (p0.y - gy) * grow };
      p1 = { x: gx + (p1.x - gx) * grow, y: gy + (p1.y - gy) * grow };
      p2 = { x: gx + (p2.x - gx) * grow, y: gy + (p2.y - gy) * grow };
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.clip();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    void uvs;
  }

  // ── 视图 ────────────────────────────────────────────────────────────
  var view = { scale: 1, cx: 0, cy: 0 };
  function fitView() {
    var w = SPINE.skeleton.width || 512, h = SPINE.skeleton.height || 512;
    var box = { minX: -w / 2, maxX: w / 2, minY: 0, maxY: h };
    slots.forEach(function (slot) {
      var att = skin[slot.name] && skin[slot.name][slot.attachment];
      var bone = bones[slot.bone];
      if (!att || !bone) return;
      var rad = bone.worldRot + ((att.rotation || 0) * Math.PI / 180);
      var hw = att.width / 2, hh = att.height / 2;
      for (var sx = -1; sx <= 1; sx += 2) for (var sy = -1; sy <= 1; sy += 2) {
        var lx = att.x + (sx * hw * Math.cos(rad) - sy * hh * Math.sin(rad));
        var ly = att.y + (sx * hw * Math.sin(rad) + sy * hh * Math.cos(rad));
        var pr = bone.worldRot, c = Math.cos(pr), s = Math.sin(pr);
        var wx = bone.worldX + lx * c - ly * s;
        var wy = bone.worldY + lx * s + ly * c;
        if (wx < box.minX) box.minX = wx;
        if (wx > box.maxX) box.maxX = wx;
        if (wy < box.minY) box.minY = wy;
        if (wy > box.maxY) box.maxY = wy;
      }
    });
    var bw = Math.max(32, box.maxX - box.minX);
    var bh = Math.max(32, box.maxY - box.minY);
    var cw = Math.min(760, Math.max(300, Math.round(bw * 1.9)));
    var ch = Math.round(cw * (bh / bw) * 1.12);
    canvas.width = cw;
    canvas.height = Math.min(820, Math.max(260, ch));
    var margin = 26;
    var sc = Math.min((canvas.width - margin * 2) / bw, (canvas.height - margin * 2) / bh);
    view.scale = sc;
    view.cx = canvas.width / 2 - ((box.minX + box.maxX) / 2) * sc;
    view.cy = canvas.height / 2 + ((box.minY + box.maxY) / 2) * sc;
  }

  var showBones = false, showGrid = false;

  function render(t) {
    applyAnimation(t);
    boneList.forEach(function (b) { if (!b.parentBone) updateWorld(b); });
    // IK 要用**未约束**的姿态当基准（软 IK 的插值起点），所以先算一遍世界变换、
    // 求解、再算一遍让约束结果生效。
    solveIk();
    boneList.forEach(function (b) { if (!b.parentBone) updateWorld(b); });
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,140,200,.18)';
      ctx.lineWidth = 1;
      for (var x = 0; x < canvas.width; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (var y = 0; y < canvas.height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(view.cx, view.cy);
    ctx.scale(view.scale, -view.scale);

    slots.forEach(function (slot) {
      var bone = bones[slot.bone];
      if (!bone) return;
      var atts = skin[slot.name];
      if (!atts) return;
      var att = atts[slot.attachment];
      if (!att) return;
      var img = images[slot.name];
      if (!img || !img.complete || !img.naturalWidth) return;
      if (att.type === 'mesh') { drawMesh(bone, att, img, slot.name, t); return; }
      ctx.save();
      ctx.translate(bone.worldX, bone.worldY);
      ctx.rotate(bone.worldRot);
      ctx.translate(att.x || 0, att.y || 0);
      ctx.rotate((att.rotation || 0) * Math.PI / 180);
      ctx.scale(1, -1);
      ctx.drawImage(img, -(att.width / 2), -(att.height / 2), att.width, att.height);
      ctx.restore();
    });

    if (showBones) {
      boneList.forEach(function (b) {
        ctx.save();
        ctx.translate(b.worldX, b.worldY);
        ctx.rotate(b.worldRot);
        if (b.length > 0) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, b.length);
          ctx.strokeStyle = 'rgba(80,230,140,.85)';
          ctx.lineWidth = 1.6 / view.scale;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 3.2 / view.scale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,90,90,.95)';
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(b.worldX, b.worldY);
        ctx.scale(1, -1);
        ctx.fillStyle = 'rgba(255,255,255,.62)';
        ctx.font = (9 / view.scale) + 'px sans-serif';
        ctx.fillText(b.name, 5 / view.scale, -3 / view.scale);
        ctx.restore();
      });
    }

    // IK 目标点：画成显眼的菱形——它是**可拖的**，也就是验收判据里那个「目标点」。
    IKS.forEach(function (c) {
      var t = bones[c.target];
      if (!t) return;
      ctx.save();
      ctx.translate(t.worldX, t.worldY);
      ctx.scale(1, -1); // 抵消全局的 y 翻转，形状才是正立的
      var r = 6 / view.scale;
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fillStyle = 'rgba(90,220,255,.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,58,88,.95)';
      ctx.lineWidth = 1.2 / view.scale;
      ctx.stroke();
      ctx.restore();
    });

    ctx.restore();
  }

  // ── 播放控制 ────────────────────────────────────────────────────────
  var playing = true, animTime = 0, last = 0, scrubLock = false;
  var scrub = document.getElementById('scrub');
  var tip = document.getElementById('tip');

  function duration() {
    var anim = SPINE.animations && SPINE.animations[current];
    return anim ? durationOf(anim) : 1;
  }

  function tick(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    var dur = duration();
    if (playing) {
      animTime = (animTime + dt) % dur;
      if (!scrubLock) scrub.value = String(Math.round((animTime / dur) * 1000));
    }
    render(animTime);
    requestAnimationFrame(tick);
  }

  function updateTip() {
    var anim = SPINE.animations && SPINE.animations[current];
    if (!anim) { tip.textContent = '（没有动画数据）'; return; }
    var count = Object.keys(anim.bones || {}).length;
    tip.textContent = '时长 ' + durationOf(anim).toFixed(2) + ' 秒 · 驱动 ' + count + ' 根骨骼 · 共 ' + ANIMS.length + ' 个动作';
  }

  Object.entries(IMAGE_DATA).forEach(function (entry) {
    var img = new Image();
    img.onload = img.onerror = function () {
      loaded++;
      if (loaded === total) { fitView(); updateTip(); requestAnimationFrame(tick); }
    };
    img.src = entry[1];
    images[entry[0]] = img;
  });
  if (total === 0) { fitView(); updateTip(); requestAnimationFrame(tick); }

  var box = document.getElementById('anims');
  ANIMS.forEach(function (name) {
    var btn = document.createElement('button');
    btn.textContent = name;
    if (name === current) btn.className = 'active';
    btn.onclick = function () {
      current = name;
      animTime = 0;
      Array.prototype.forEach.call(box.children, function (c) { c.className = ''; });
      btn.className = 'active';
      updateTip();
    };
    box.appendChild(btn);
  });

  document.getElementById('play').onclick = function () {
    playing = !playing;
    this.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  };
  document.getElementById('bones').onclick = function () {
    showBones = !showBones;
    this.className = showBones ? 'active' : '';
  };
  document.getElementById('grid').onclick = function () {
    showGrid = !showGrid;
    this.className = showGrid ? 'active' : '';
  };
  scrub.addEventListener('input', function () {
    animTime = duration() * (Number(this.value) / 1000);
  });
  scrub.addEventListener('pointerdown', function () { scrubLock = true; });
  scrub.addEventListener('pointerup', function () { scrubLock = false; });
  // ── 拖动 IK 目标点 ──────────────────────────────────────────────────
  //
  // 验收判据就是这一条：「把一只手约束到目标点，拖动目标点时手跟随」。
  // 所以预览页必须能直接拖——只能去编辑器里改数字的话，这条判据等于没验。
  var draggingTarget = null;
  function toWorldPoint(event) {
    var rect = canvas.getBoundingClientRect();
    var sx = (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    var sy = (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
    // 与 render 里的变换严格互逆：屏幕 = (cx + wx·s, cy − wy·s)
    return { x: (sx - view.cx) / view.scale, y: (view.cy - sy) / view.scale };
  }
  canvas.addEventListener('mousedown', function (event) {
    if (IKS.length === 0) return;
    var point = toWorldPoint(event);
    var best = null;
    var bestDist = 26 / view.scale;
    IKS.forEach(function (c) {
      var t = bones[c.target];
      if (!t) return;
      var d = Math.sqrt(Math.pow(t.worldX - point.x, 2) + Math.pow(t.worldY - point.y, 2));
      if (d < bestDist) { bestDist = d; best = t; }
    });
    if (best !== null) {
      draggingTarget = best;
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
    }
  });
  window.addEventListener('mousemove', function (event) {
    if (draggingTarget === null) return;
    var point = toWorldPoint(event);
    draggingTarget.dragX = point.x;
    draggingTarget.dragY = point.y;
    event.preventDefault();
  });
  window.addEventListener('mouseup', function () {
    if (draggingTarget === null) return;
    draggingTarget = null;
    canvas.style.cursor = '';
  });

  // 只读验收钩子：自动化测试要能问「链末端的骨尖现在在哪」，
  // 否则「拖动目标点时手跟随」这条判据只能靠肉眼看截图。
  // 只暴露读接口，不提供任何写入口——验收用的东西不该能改状态。
  window.__gmmPreview = {
    bones: function () {
      var out = {};
      boneList.forEach(function (b) {
        out[b.name] = { x: b.worldX, y: b.worldY, rot: b.worldRot, length: b.length };
      });
      return out;
    },
    iks: function () {
      return IKS.map(function (c) { return { name: c.name, target: c.target, bones: c.bones.slice(), mix: c.mix }; });
    },
    /** 骨骼在 canvas 里的像素坐标（拖动验收要用它算出鼠标该落在哪）。 */
    screen: function (name) {
      var b = bones[name];
      if (!b) return null;
      return { x: view.cx + b.worldX * view.scale, y: view.cy - b.worldY * view.scale };
    },
    /** 链末端的**骨尖**世界坐标——它应该落在目标点上。 */
    tip: function (constraintName) {
      for (var i = 0; i < IKS.length; i++) {
        if (constraintName !== undefined && IKS[i].name !== constraintName) continue;
        var chain = IKS[i].bones;
        var last = bones[chain[chain.length - 1]];
        if (!last) continue;
        return { x: last.worldX - Math.sin(last.worldRot) * last.length, y: last.worldY + Math.cos(last.worldRot) * last.length };
      }
      return null;
    }
  };

  window.addEventListener('resize', function () { fitView(); render(animTime); });
})();
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&#39;"
  );
}
