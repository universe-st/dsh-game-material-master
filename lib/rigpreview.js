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
function safeJson(value) {
    // JSON 里可能出现 `</script>`，直接内联会提前结束脚本块。
    return JSON.stringify(value).replace(/<\//g, "<\\/");
}
export function buildPreviewHtml(options) {
    const title = options.title ?? "骨骼动画预览";
    const images = Object.fromEntries(options.images.map((image) => [image.name, image.dataUri]));
    const animations = Object.keys(options.spine?.animations ?? {});
    const defaultAnimation = options.defaultAnimation !== undefined && animations.includes(options.defaultAnimation)
        ? options.defaultAnimation
        : animations[0] ?? "";
    const background = options.background ?? "#12121c";
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
    if (!anim) return;
    var tracks = anim.bones || {};
    Object.keys(tracks).forEach(function (name) {
      var bone = bones[name];
      if (!bone) return;
      var tl = tracks[name];
      if (tl.rotate) { var r = sampleTrack(tl.rotate, t, 'rotate'); bone.animRot = (r && r.value) || 0; }
      if (tl.translate) { var v = sampleTrack(tl.translate, t, 'translate'); bone.animX = (v && v.x) || 0; bone.animY = (v && v.y) || 0; }
    });
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
  window.addEventListener('resize', function () { fitView(); render(animTime); });
})();
</script>
</body>
</html>
`;
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&#39;");
}
