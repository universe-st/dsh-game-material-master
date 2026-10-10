#!/usr/bin/env node
/**
 * 用官方 Spine 4.2.120 解析器与求值器验证导出，而不是用插件自己的公式验自己。
 * 不联网、不调用生图、不启动宿主；纹理图集在内存中构造。
 *
 *   npm run verify:rig:runtime
 *   node scripts/verify-rig-runtime.mjs --preview   # 另存免费示例到临时目录
 */
import {
  AtlasAttachmentLoader, DeformTimeline, FakeTexture, MeshAttachment, MixBlend,
  MixDirection, Physics, Skeleton, SkeletonJson, TextureAtlas, TextureRegion
} from "@esotericsoftware/spine-core";
import { buildSkeleton, buildAtlasText, packAtlas } from "../lib/spine.js";
import { buildPreviewHtml } from "../lib/rigpreview.js";
import { createRgba } from "../lib/rigpose.js";
import { encodePng } from "../lib/png.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

let checks = 0;
let failures = 0;
const W = 400, H = 400;
function check(name, ok, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function section(name, fn) {
  console.log(`\n=== ${name} ===`);
  try { fn(); } catch (error) { check(`${name} 可由官方运行时加载并求值`, false, error.message); }
}
function part(name, x, y, width, height, extras = {}) {
  return { name, file: `${name}.png`, x, y, width, height, z: 0, scale: 1, rotation: 0, ...extras };
}
// 官方 AtlasAttachmentLoader 配合内存纹理；不替换 SkeletonJson 或任何变换/约束代码。
function load(spine, parts) {
  const sizes = new Map(parts.map((p) => [p.name, p]));
  const atlas = { findRegion(name) {
    const p = sizes.get(name);
    if (!p) return null;
    const region = new TextureRegion();
    Object.assign(region, { u: 0, v: 0, u2: 1, v2: 1, width: p.width, height: p.height,
      originalWidth: p.width, originalHeight: p.height, offsetX: 0, offsetY: 0, degrees: 0,
      texture: new FakeTexture({ width: p.width, height: p.height }) });
    return region;
  } };
  const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(spine);
  const skeleton = new Skeleton(data);
  skeleton.updateWorldTransform(Physics.none);
  return { data, skeleton };
}
function vertices(skeleton, name) {
  const slot = skeleton.findSlot(name);
  const attachment = slot.getAttachment();
  const out = new Float32Array(attachment instanceof MeshAttachment ? attachment.worldVerticesLength : 8);
  if (attachment instanceof MeshAttachment) attachment.computeWorldVertices(slot, 0, out.length, out, 0, 2);
  else attachment.computeWorldVertices(slot, out, 0, 2);
  return Array.from(out);
}
function difference(a, b) { return Math.max(...a.map((v, i) => Math.abs(v - b[i]))); }
function imagePoint(p, u, v) {
  const angle = p.rotation * Math.PI / 180;
  const dx = (u - 0.5) * p.width, dy = (v - 0.5) * p.height;
  return { x: p.x + p.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle) - W / 2,
    y: H - (p.y + p.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)) };
}
function apply(data, skeleton, name, time) {
  skeleton.setToSetupPose();
  data.findAnimation(name).apply(skeleton, -1, time, false, [], 1, MixBlend.replace, MixDirection.mixIn);
  skeleton.updateWorldTransform(Physics.none);
}
function preview(spine, name, time, duration, paths) {
  const drawing = new Proxy({}, { get: () => () => {} });
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { width: 800, height: 600, style: {}, children: [],
      events: {}, value: "0", getContext: () => drawing,
      appendChild(item) { this.children.push(item); },
      addEventListener(type, fn) { this.events[type] = fn; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
    return elements.get(id);
  };
  let nextFrame;
  const window = { innerWidth: 800, innerHeight: 700, devicePixelRatio: 1, addEventListener() {} };
  const context = { window, location: { hash: "" },
    document: { getElementById: element, createElement: () => element(Symbol()) },
    requestAnimationFrame: (fn) => { nextFrame = fn; } };
  const html = buildPreviewHtml({ title: "求值器回归", spine, images: [], defaultAnimation: name, paths });
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  element("play").onclick(); // 暂停后逐点采样，不受墙钟时间影响。
  const scrub = element("scrub");
  scrub.value = String(time / duration * 1000);
  scrub.events.input.call(scrub);
  nextFrame(1000);
  return window.__gmmPreview;
}

section("旋后关节、图片四角与 +X 骨轴", () => {
  const arm = part("left-lower-arm", 220, 140, 34, 110,
    { rotation: 37, proximal: [0.2, 0.1], distal: [0.8, 0.9], parent: null });
  const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts: [arm], animationIds: [] });
  const { skeleton } = load(built.spine, [arm]);
  const bone = skeleton.findBone(arm.name);
  const proximal = imagePoint(arm, ...arm.proximal), distal = imagePoint(arm, ...arm.distal);
  check("旋后的近端锚点就是官方骨骼世界原点",
    Math.hypot(bone.worldX - proximal.x, bone.worldY - proximal.y) < 0.001);
  check("官方 +X 骨尖落在旋后的远端锚点",
    Math.hypot(bone.worldX + bone.a * bone.data.length - distal.x,
      bone.worldY + bone.c * bone.data.length - distal.y) < 0.001);
  const actual = vertices(skeleton, arm.name);
  // RegionAttachment 的四角顺序对应图片左下、左上、右上、右下。
  const expected = [[0, 1], [0, 0], [1, 0], [1, 1]].flatMap(([u, v]) => {
    const p = imagePoint(arm, u, v); return [p.x, p.y];
  });
  check("顺时针装配旋转与官方 region 四角逐点一致", difference(actual, expected) < 0.001,
    `最大误差 ${difference(actual, expected).toFixed(6)}px`);
});

section("叶子 mesh 的 UV、绑定姿态与旋转跟随", () => {
  const head = part("head", 160, 60, 54, 108, { parent: null, rotation: 23 });
  const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts: [head], animationIds: [],
    meshes: { head: { cols: 2, rows: 2 } },
    customAnimations: { turn: { duration: 1, loop: false, bones: {
      head: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 30 }] }
    } } } });
  const { data, skeleton } = load(built.spine, [head]);
  const slot = skeleton.findSlot("head"), mesh = slot.getAttachment();
  check("官方解析得到 MeshAttachment", mesh instanceof MeshAttachment);
  const headIndex = data.findBone("head").index;
  let cursor = 0, ownsEveryVertex = mesh.bones !== null;
  while (mesh.bones !== null && cursor < mesh.bones.length) {
    const count = mesh.bones[cursor++];
    ownsEveryVertex &&= mesh.bones.slice(cursor, cursor + count).includes(headIndex);
    cursor += count;
  }
  check("叶子 mesh 每个顶点有自身骨骼影响", ownsEveryVertex);
  const before = vertices(skeleton, "head");
  const uv = mesh.regionUVs;
  const expected = Array.from({ length: uv.length / 2 }, (_, i) => {
    const p = imagePoint(head, uv[i * 2], uv[i * 2 + 1]); return [p.x, p.y];
  }).flat();
  check("非90度旋转 mesh 各 UV 顶点还原装配位置", difference(before, expected) < 0.001,
    `最大误差 ${difference(before, expected).toFixed(6)}px`);
  apply(data, skeleton, "turn", 1);
  const after = vertices(skeleton, "head");
  const pivot = imagePoint(head, 0.5, 1), angle = Math.PI / 6;
  const rotated = [];
  for (let i = 0; i < before.length; i += 2) {
    const dx = before[i] - pivot.x, dy = before[i + 1] - pivot.y;
    rotated.push(pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle));
  }
  check("官方动画旋骨30度使mesh实际移动", difference(before, after) > 10);
  check("mesh每个顶点绕近端旋转30度", difference(after, rotated) < 0.001,
    `最大误差 ${difference(after, rotated).toFixed(6)}px`);
  const withParent = [part("torso", 150, 160, 100, 130, { parent: null }), { ...head, parent: "torso" }];
  const parented = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts: withParent, animationIds: [],
    meshes: { head: { cols: 2, rows: 2 } }, customAnimations: {
      turn: { duration: 1, loop: false, bones: { head: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 30 }] } } }
    } });
  const related = load(parented.spine, withParent);
  const attachedBefore = vertices(related.skeleton, "head");
  apply(related.data, related.skeleton, "turn", 1);
  check("有父骨的叶子mesh也随自身骨骼动画移动", difference(attachedBefore, vertices(related.skeleton, "head")) > 1);
});

const ikParts = [part("left-upper-arm", 240, 80, 30, 90, { parent: null }),
  part("left-lower-arm", 270, 166, 28, 75, { parent: "left-upper-arm", rotation: -12 })];
section("官方两骨 IK 不跳姿态且能追踪移动目标", () => {
  const options = { canvasWidth: W, canvasHeight: H, parts: ikParts, animationIds: [] };
  const plain = load(buildSkeleton(options).spine, ikParts).skeleton;
  const built = buildSkeleton({ ...options,
    constraints: [{ type: "ik", name: "arm-ik", bone: "left-lower-arm", target: "arm-target",
      chain: 1, bendPositive: false, weight: 1 }] });
  const { skeleton } = load(built.spine, ikParts);
  const before = ikParts.flatMap((p) => vertices(plain, p.name));
  const constrained = ikParts.flatMap((p) => vertices(skeleton, p.name));
  check("官方运行时加IK保持所有贴图顶点", difference(before, constrained) < 0.01,
    `最大误差 ${difference(before, constrained).toFixed(6)}px`);
  const flipped = load(buildSkeleton({ ...options,
    constraints: [{ type: "ik", name: "arm-ik", bone: "left-lower-arm", target: "arm-target",
      chain: 1, bendPositive: true, weight: 1 }] }).spine, ikParts).skeleton;
  check("明确切换IK弯曲方向会换肘侧", difference(constrained, ikParts.flatMap((p) => vertices(flipped, p.name))) > 1);
  const target = skeleton.findBone("arm-target"), lower = skeleton.findBone("left-lower-arm");
  target.x -= 10; target.y += 20;
  skeleton.updateWorldTransform(Physics.none);
  check("官方IK移动目标后骨尖抵达目标",
    Math.hypot(lower.worldX + lower.a * lower.data.length - target.worldX,
      lower.worldY + lower.c * lower.data.length - target.worldY) < 0.01);
  check("官方IK移动目标后贴图确实移动", difference(constrained,
    ikParts.flatMap((p) => vertices(skeleton, p.name))) > 1);
});

section("手工骨偏移之后自动 IK 目标仍在实际骨尖", () => {
  const offsetParts = ikParts.map((p, i) => ({ ...p,
    offset: i === 0 ? { x: 4, y: 3, rotation: 7 } : { rotation: -5 } }));
  const options = { canvasWidth: W, canvasHeight: H, parts: offsetParts, animationIds: [] };
  const plain = load(buildSkeleton(options).spine, offsetParts).skeleton;
  const before = offsetParts.flatMap((p) => vertices(plain, p.name));
  const lowerBefore = plain.findBone("left-lower-arm");
  const tip = { x: lowerBefore.worldX + lowerBefore.a * lowerBefore.data.length,
    y: lowerBefore.worldY + lowerBefore.c * lowerBefore.data.length };
  const built = buildSkeleton({ ...options,
    constraints: [{ type: "ik", name: "offset-arm-ik", bone: "left-lower-arm", target: "offset-target",
      chain: 1, bendPositive: false, weight: 1 }] });
  const { skeleton } = load(built.spine, offsetParts);
  const target = skeleton.findBone("offset-target");
  check("自动IK目标使用含平移与旋转偏移的实际骨尖",
    Math.hypot(target.worldX - tip.x, target.worldY - tip.y) < 0.001);
  const after = offsetParts.flatMap((p) => vertices(skeleton, p.name));
  check("骨偏移后加同弯曲方向IK仍保持全部贴图顶点", difference(before, after) < 0.01,
    `最大误差 ${difference(before, after).toFixed(6)}px`);
});

section("官方 FFD 时间轴加载与实际顶点变形", () => {
  const cloth = part("hip", 140, 180, 100, 100, { parent: null, rotation: 31 });
  const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts: [cloth], animationIds: [],
    meshes: { hip: { cols: 2, rows: 2 } },
    deforms: { hip: { mode: "wave", amplitude: 12, cycles: 1, direction: 0, anchor: "top", duration: 1.6 } },
    customAnimations: { idle: { duration: 1.6, loop: true, bones: {} } } });
  const { data, skeleton } = load(built.spine, [cloth]);
  const animation = data.findAnimation("idle");
  check("官方动画中确实加载DeformTimeline", animation.timelines.some((t) => t instanceof DeformTimeline));
  const before = vertices(skeleton, "hip");
  apply(data, skeleton, "idle", 1.6 / 6);
  const after = vertices(skeleton, "hip");
  check("FFD产生实际顶点位移", difference(before, after) > 5);
  check("FFD固定上缘不动", difference(before.slice(0, 6), after.slice(0, 6)) < 0.001);
  check("官方slot有deform数据且全为有限数", skeleton.findSlot("hip").deform.length > 0 &&
    skeleton.findSlot("hip").deform.every(Number.isFinite));
  const bottom = after.length - 2;
  const amount = 12 * Math.sin(Math.PI / 3), angle = cloth.rotation * Math.PI / 180;
  check("旋转贴图的FFD按图片方向变形",
    Math.abs(after[bottom] - before[bottom] - amount * Math.cos(angle)) < 0.002 &&
    Math.abs(after[bottom + 1] - before[bottom + 1] + amount * Math.sin(angle)) < 0.002);
  apply(data, skeleton, "idle", 1.6);
  check("FFD首尾循环回到绑定顶点", difference(before, vertices(skeleton, "hip")) < 0.001);
  apply(data, skeleton, "idle", 1.6 / 6);
  const playback = preview(built.spine, "idle", 1.6 / 6, 1.6);
  check("自包含预览的加权FFD顶点与官方求值一致",
    difference(vertices(skeleton, "hip"), playback.meshVertices("hip")) < 0.002);
});

for (const closed of [false, true]) section(`官方${closed ? "闭合" : "开放"} Path 解析与约束求值`, () => {
  const points = [60, 120, 120, 120, 120, 200];
  const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts: ikParts, animationIds: [], paths: {
    route: { points, closed, bones: ikParts.map((p) => p.name), spacing: 50, translateMix: 1, rotateMix: 1 }
  } });
  const { data, skeleton } = load(built.spine, ikParts);
  check("官方解析得到PathConstraint", data.pathConstraints.length === 1);
  const pathSlot = skeleton.findSlot("path:route"), path = pathSlot.getAttachment();
  check("路径附件vertexCount真实解析", path.worldVerticesLength === built.spine.skins[0].attachments["path:route"].route.vertexCount * 2);
  check("路径闭合标记正确", path.closed === closed);
  const first = skeleton.findBone(ikParts[0].name), second = skeleton.findBone(ikParts[1].name);
  check("路径首骨实际落在首点", Math.hypot(first.worldX - (60 - W / 2), first.worldY - (H - 120)) < 0.02);
  check("固定50px间距把第二根骨移到折线第一段", Math.hypot(second.worldX - (110 - W / 2), second.worldY - (H - 120)) < 0.1,
    `骨原点(${second.worldX.toFixed(4)},${second.worldY.toFixed(4)})`);
  check("路径求值所有骨矩阵均为有限数", skeleton.bones.every((b) => [b.a, b.b, b.c, b.d, b.worldX, b.worldY].every(Number.isFinite)));
});

section("重复路径端点的预览与官方求值一致", () => {
  const parts = [part("head", 150, 40, 50, 90, { parent: null }), part("hip", 130, 180, 70, 80, { parent: null })];
  for (const [label, points] of [
    ["首段零长", [100, 100, 100, 100, 100, 200]],
    ["尾段零长且外推", [100, 100, 100, 200, 100, 200]]
  ]) {
    const route = { points, closed: false, bones: parts.map((p) => p.name), spacing: 150, translateMix: 1, rotateMix: 1 };
    const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts, animationIds: [], paths: { route } });
    const { skeleton } = load(built.spine, parts);
    // 与真实宿主一样给预览传Y向上的世界路径；骨架JSON只供官方运行时的Path附件加载。
    const actual = preview(built.spine, "", 0, 1, { route: { ...route,
      points: points.map((n, i) => i % 2 === 0 ? n - W / 2 : H - n) } }).bones();
    const errors = parts.map((p) => {
      const official = skeleton.findBone(p.name), local = actual[p.name];
      return { position: Math.hypot(local.x - official.worldX, local.y - official.worldY),
        direction: Math.max(Math.abs(Math.sin(local.rot) - official.c), Math.abs(Math.cos(local.rot) - official.a)) };
    });
    check(`${label}的骨骼位置与方向和官方一致`, errors.every((e) => e.position < 0.02 && e.direction < 0.001),
      `最大位置误差 ${Math.max(...errors.map((e) => e.position)).toFixed(6)}px`);
  }
  const route = { points: [100, 100, 100, 100], closed: false, bones: ["head"], spacing: 0, translateMix: 1, rotateMix: 1 };
  const plain = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts, animationIds: [], paths: { route } });
  const bones = preview(plain.spine, "", 0, 1, { route: { ...route, points: [-100, 300, -100, 300] } }).bones();
  check("全重复路径退化时预览坐标仍有限", Object.values(bones).every((b) => [b.x, b.y, b.rot].every(Number.isFinite)));
});

section("IK与Path同时存在时两个约束都实际求值", () => {
  const parts = [...ikParts, part("head", 150, 20, 54, 90, { parent: null })];
  const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts, animationIds: [],
    constraints: [{ type: "ik", name: "arm-ik", bone: "left-lower-arm", target: "arm-target",
      chain: 1, bendPositive: false, weight: 1 }],
    paths: { route: { points: [60, 120, 120, 120], closed: false,
      bones: ["head"], spacing: 0, translateMix: 1, rotateMix: 1 } } });
  const { data, skeleton } = load(built.spine, parts);
  check("同时加载IK和Path约束", data.ikConstraints.length === 1 && data.pathConstraints.length === 1);
  const head = skeleton.findBone("head");
  check("IK之后的Path没有因重复order被跳过", Math.hypot(head.worldX - (60 - W / 2), head.worldY - (H - 120)) < 0.02);
});

section("图集可由官方Atlas解析器加载", () => {
  const packed = packAtlas([{ name: "wide", width: 90, height: 36 }, { name: "tall", width: 30, height: 110 }]);
  const text = buildAtlasText(packed.pages);
  const atlas = new TextureAtlas(text);
  for (const page of atlas.pages) page.setTexture(new FakeTexture({ width: page.width, height: page.height }));
  check("官方Atlas找得到每个区域", ["wide", "tall"].every((name) => atlas.findRegion(name) !== null));
  check("官方Atlas原尺寸和裁剪尺寸一致", atlas.regions.every((r) => r.width === r.originalWidth && r.height === r.originalHeight));
});

if (process.argv.includes("--preview")) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-rig-runtime-preview-"));
  const parts = [part("torso", 166, 150, 70, 120, { parent: null }),
    part("head", 175, 50, 54, 96, { parent: "torso", rotation: 23 }),
    part("hip", 130, 265, 140, 90, { parent: "torso" })];
  const built = buildSkeleton({ canvasWidth: W, canvasHeight: H, parts, animationIds: ["idle", "walk"],
    meshes: { head: { cols: 2, rows: 2 }, hip: { cols: 4, rows: 4 } },
    deforms: { hip: { mode: "wave", amplitude: 18, cycles: 1, direction: 0, anchor: "top", duration: 1.6 } } });
  const images = parts.map((p, index) => {
    const rgba = createRgba(p.width, p.height, [[70, 120, 190, 255], [242, 190, 95, 255], [170, 80, 160, 255]][index]);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      if (x < 5 || y < 5 || (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0) continue;
      const at = (y * p.width + x) * 4;
      for (let c = 0; c < 3; c++) rgba.data[at + c] = Math.max(0, rgba.data[at + c] - 40);
    }
    return { name: p.name, dataUri: `data:image/png;base64,${encodePng(rgba.data, p.width, p.height).toString("base64")}` };
  });
  await writeFile(join(directory, "skeleton.json"), JSON.stringify(built.spine, null, 2));
  await writeFile(join(directory, "preview.html"), buildPreviewHtml({ title: "免费绑定回归样例", spine: built.spine, images, defaultAnimation: "idle" }));
  console.log(`\n本地预览：${join(directory, "preview.html")}`);
}
console.log(`\n共 ${checks} 项官方运行时检查，${failures === 0 ? "全部通过 ✓" : `${failures} 项失败 ✗`}`);
if (failures !== 0) process.exitCode = 1;
