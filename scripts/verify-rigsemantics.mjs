#!/usr/bin/env node
/**
 * 骨骼动画**语义层**的算法验证（不花钱、不联网）。
 *
 * 覆盖 `src/rigsemantics.ts`：角色推断、默认语义生成、校验（父级/环/锚点/人形结构/
 * 左右镜像）、局部补丁合并、以及「同样输入永远同样输出」的确定性。
 *
 *   node scripts/verify-rigsemantics.mjs
 */

import {
  RIG_ROLES,
  ROLE_ANCHORS,
  defaultSemanticsOf,
  mergeSemantics,
  parentNameOf,
  roleOfName,
  sideOfName,
  validateSemantics
} from "../lib/rigsemantics.js";
import { defaultPartNames, RIG_SLOTS } from "../lib/spine.js";

let failures = 0;
function check(name, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  if (!ok) failures++;
  console.log(`  ${mark} ${name}${detail === "" ? "" : ` — ${detail}`}`);
}

// ── 1. 角色推断 ─────────────────────────────────────────────────────────

console.log("\n[1] 角色推断");
check("head → head", roleOfName("head") === "head");
check("left-upper-arm → upperArm", roleOfName("left-upper-arm") === "upperArm");
check("left-lower-arm → lowerArm（不能被 upper 规则抢走）", roleOfName("left-lower-arm") === "lowerArm");
check("forearm → lowerArm", roleOfName("forearm") === "lowerArm");
check("right-thigh → upperLeg", roleOfName("right-thigh") === "upperLeg");
check("中文「左小臂」→ lowerArm", roleOfName("左小臂") === "lowerArm");
check("中文「裙摆」→ cloth", roleOfName("裙摆") === "cloth");
check("未知名字兜底为 accessory", roleOfName("wibble-01") === "accessory");
check("每个推断结果都在枚举内", ["head", "wibble", "左耳", "sword"].every((n) => RIG_ROLES.includes(roleOfName(n))));

console.log("\n[2] 左右侧识别");
check("left-upper-arm → left", sideOfName("left-upper-arm") === "left");
check("右大腿 → right", sideOfName("右大腿") === "right");
check("torso → 空串", sideOfName("torso") === "");

// ── 3. 默认语义 ─────────────────────────────────────────────────────────

console.log("\n[3] 默认语义（v1 的 16 件套）");
const names = defaultPartNames();
const defaults = defaultSemanticsOf(names);
check("数量与 RIG_SLOTS 一致", defaults.length === RIG_SLOTS.length, `${defaults.length} vs ${RIG_SLOTS.length}`);
check("每个部件都有 role/proximal/distal", defaults.every((p) => RIG_ROLES.includes(p.role) && Array.isArray(p.proximal) && Array.isArray(p.distal)));
check("source 都是 default", defaults.every((p) => p.source === "default"));

// 默认语义必须能通过自己的校验——否则「不填表也能跑」这条保证就是假的。
const v0 = validateSemantics(defaults);
check("默认语义无 error", v0.errors.length === 0, v0.errors.map((e) => `${e.name}:${e.message}`).join("; "));
check("默认语义无 warning", v0.warnings.length === 0, v0.warnings.map((e) => `${e.name}:${e.message}`).join("; "));

// 与 v1 的 RIG_SLOTS 表逐条比对父级：语义层重构不能悄悄改掉默认骨架。
const v1Parent = new Map(RIG_SLOTS.map((slot) => [slot.name, slot.parent]));
let parentMismatch = [];
for (const part of defaults) {
  const expected = v1Parent.get(part.name);
  if ((part.parent ?? undefined) !== (expected ?? undefined)) parentMismatch.push(`${part.name}: ${part.parent} != ${expected}`);
}
check("默认父级与 v1 RIG_SLOTS 完全一致", parentMismatch.length === 0, parentMismatch.join("; "));

// 锚点也要一致（这是「初始姿态逐像素还原」的前提）。
let anchorMismatch = [];
for (const slot of RIG_SLOTS) {
  const part = defaults.find((p) => p.name === slot.name);
  if (part === undefined) continue;
  if (part.proximal[0] !== slot.proximal[0] || part.proximal[1] !== slot.proximal[1]) anchorMismatch.push(`${slot.name} proximal`);
  if (part.distal[0] !== slot.distal[0] || part.distal[1] !== slot.distal[1]) anchorMismatch.push(`${slot.name} distal`);
}
check("默认锚点与 v1 RIG_SLOTS 完全一致", anchorMismatch.length === 0, anchorMismatch.join("; "));

console.log("\n[4] 默认语义的父级链是树（无环、可达 root）");
{
  const byName = new Map(defaults.map((p) => [p.name, p]));
  let deepest = 0;
  let cyclic = 0;
  for (const part of defaults) {
    const seen = new Set([part.name]);
    let cursor = part.parent;
    let depth = 0;
    while (cursor !== undefined) {
      if (seen.has(cursor)) { cyclic++; break; }
      seen.add(cursor);
      cursor = byName.get(cursor)?.parent;
      if (++depth > 64) { cyclic++; break; }
    }
    deepest = Math.max(deepest, depth);
  }
  check("没有环", cyclic === 0);
  check("最深链长合理（4~6 层）", deepest >= 4 && deepest <= 6, `deepest=${deepest}`);
}

// ── 5. 校验 ─────────────────────────────────────────────────────────────

console.log("\n[5] 校验：error 情形");
{
  const dup = validateSemantics([{ name: "head", role: "head" }, { name: "head", role: "head" }]);
  check("重名 → error", dup.errors.some((e) => e.message.includes("重复")));

  const unknown = validateSemantics([{ name: "head", role: "banana" }]);
  check("未知角色 → error 且回落到按名推断", unknown.errors.length > 0 && unknown.parts[0].role === "head");

  const selfParent = validateSemantics([{ name: "head", role: "head", parent: "head" }]);
  check("父级指自己 → error 且清空父级", selfParent.errors.some((e) => e.message.includes("自己")) && selfParent.parts[0].parent === undefined);

  const missing = validateSemantics([{ name: "head", role: "head", parent: "nope" }]);
  check("父级不存在 → error 且清空父级", missing.errors.some((e) => e.message.includes("不存在")) && missing.parts[0].parent === undefined);

  const cycle = validateSemantics([
    { name: "a", role: "torso", parent: "b" },
    { name: "b", role: "hip", parent: "a" }
  ]);
  check("成环 → error", cycle.errors.some((e) => e.message.includes("成环")), cycle.errors.map((e) => e.message).join(" | "));
  check("成环后不再有环（已断开一处）", (() => {
    const byName = new Map(cycle.parts.map((p) => [p.name, p]));
    for (const part of cycle.parts) {
      const seen = new Set([part.name]);
      let cursor = part.parent;
      let guard = 0;
      while (cursor !== undefined && guard++ < 64) {
        if (seen.has(cursor)) return false;
        seen.add(cursor);
        cursor = byName.get(cursor)?.parent;
      }
    }
    return true;
  })());
}

console.log("\n[6] 校验：warning 情形");
{
  const degenerate = validateSemantics([{ name: "head", role: "head", proximal: [0.5, 0.5], distal: [0.5, 0.5] }]);
  check("锚点重合 → warning 且被纠正回默认", degenerate.warnings.some((w) => w.message.includes("重合")));
  check("锚点已不再是重合的", !(degenerate.parts[0].proximal[0] === degenerate.parts[0].distal[0] && degenerate.parts[0].proximal[1] === degenerate.parts[0].distal[1]));

  const headOnLeg = validateSemantics([
    { name: "head", role: "head", parent: "left-upper-leg" },
    { name: "left-upper-leg", role: "upperLeg", parent: "hip" },
    { name: "hip", role: "hip" }
  ]);
  check("头挂在腿上 → warning（祖先链经过肢体）", headOnLeg.warnings.some((w) => w.message.includes("经过肢体")), headOnLeg.warnings.map((w) => w.message).join(" | "));

  // 反向护栏：正常的极简骨架「头 → 躯干 → 胯」不能被误判。
  const minimal = validateSemantics([
    { name: "head", role: "head", parent: "torso" },
    { name: "torso", role: "torso", parent: "hip" },
    { name: "hip", role: "hip" }
  ]);
  check("头 → 躯干 → 胯 不报警", minimal.warnings.length === 0, minimal.warnings.map((w) => w.message).join(" | "));

  const noRight = validateSemantics([
    { name: "head", role: "head" },
    { name: "torso", role: "torso" },
    { name: "left-upper-arm", role: "upperArm", parent: "torso" }
  ]);
  check("只有左臂 → warning", noRight.warnings.some((w) => w.message.includes("没有右侧")));

  // 非人形角色不应该被人形规则误伤。
  const quadruped = validateSemantics([
    { name: "body", role: "torso" },
    { name: "front-left-leg", role: "upperLeg", parent: "body" },
    { name: "front-right-leg", role: "upperLeg", parent: "body" },
    { name: "back-left-leg", role: "upperLeg", parent: "body" },
    { name: "back-right-leg", role: "upperLeg", parent: "body" }
  ]);
  check("没有 head 时不按人形检查（四足不误伤）", quadruped.warnings.length === 0, quadruped.warnings.map((w) => w.message).join(" | "));
}

console.log("\n[7] 校验总是返回可用的 parts");
{
  const messy = validateSemantics([
    { name: "a", role: "nope", parent: "a" },
    { name: "b", role: "head", proximal: [9, -3], distal: "x" }
  ]);
  check("有 error 时 parts 仍然齐全", messy.parts.length === 2);
  check("越界锚点被夹到 [0,1]", messy.parts[1].proximal[0] === 1 && messy.parts[1].proximal[1] === 0, JSON.stringify(messy.parts[1].proximal));
  check("非法锚点回落到角色默认", Array.isArray(messy.parts[1].distal) && messy.parts[1].distal.length === 2);
  check("ok 为 false", messy.ok === false);
}

// ── 8. 局部补丁合并 ─────────────────────────────────────────────────────

console.log("\n[8] mergeSemantics");
{
  const base = defaultSemanticsOf(["head", "neck", "torso", "hip"]);
  const merged = mergeSemantics(base, [{ name: "head", parent: "torso", source: "human" }]);
  const head = merged.find((p) => p.name === "head");
  check("只改了 parent", head.parent === "torso");
  check("其余字段保留（锚点没被重置）", JSON.stringify(head.proximal) === JSON.stringify(ROLE_ANCHORS.head.proximal));
  check("source 被更新为 human", head.source === "human");
  check("其它部件不受影响", merged.find((p) => p.name === "neck").parent === "torso");

  const grown = mergeSemantics(base, [{ name: "tail-1", role: "accessory", parent: "hip" }]);
  check("新部件会用默认语义起头再套补丁", grown.length === base.length + 1);
  const tail = grown.find((p) => p.name === "tail-1");
  check("新部件的补丁生效", tail.parent === "hip");
  check("新部件有合法锚点", Array.isArray(tail.proximal) && tail.proximal.every((n) => n >= 0 && n <= 1));
}

// ── 9. 确定性 ───────────────────────────────────────────────────────────

console.log("\n[9] 确定性（同样输入永远同样输出）");
{
  const a = JSON.stringify(defaultSemanticsOf(names));
  const b = JSON.stringify(defaultSemanticsOf(names));
  check("默认语义可复现", a === b);

  // 同一角色的多个候选父级时，必须按确定的规则挑，而不是依赖 Map 的插入顺序。
  const map = new Map([["torso", "torso"], ["left-upper-arm", "upperArm"], ["right-upper-arm", "upperArm"]]);
  const pick = parentNameOf("left-upper-arm", map);
  check("同角色多候选时按侧别优先", pick === "torso" || pick === "left-upper-arm", `got ${pick}`);
  const shuffled = new Map([...map.entries()].reverse());
  check("候选顺序变化不影响结果", parentNameOf("left-upper-arm", shuffled) === pick);
}

// ── 10. 与 v1 的 parentBoneOf 行为差异（回归护栏）────────────────────────

console.log("\n[10] 表外部件与父级回退");
{
  const extra = defaultSemanticsOf(["skirt", "sword", "ponytail"]);
  check("裙摆 → cloth", extra[0].role === "cloth");
  check("剑 → weapon", extra[1].role === "weapon");
  check("马尾 → hair", extra[2].role === "hair");
  check("集合里没有任何宿主时挂 root（而不是挂到错误的部件上）", extra.every((p) => p.parent === undefined));
  check("仍然能被校验通过", validateSemantics(extra).errors.length === 0);

  // 理想父级缺席时要沿角色链向上退，而不是掉到 root。
  // 裙摆的理想父级是躯干；这里没有躯干，应该退到胯。
  const withHip = defaultSemanticsOf(["head", "hip", "skirt"]);
  check("无躯干时裙摆退到胯（cloth → torso → hip）", withHip.find((p) => p.name === "skirt").parent === "hip",
    `got ${withHip.find((p) => p.name === "skirt").parent}`);

  const withTorso = defaultSemanticsOf(["head", "torso", "hip", "skirt"]);
  check("有躯干时裙摆挂躯干（优先理想父级）", withTorso.find((p) => p.name === "skirt").parent === "torso");

  // 马尾的理想父级是头；给一个只有躯干的世界，应退到躯干。
  const noHead = defaultSemanticsOf(["torso", "hip", "ponytail"]);
  check("无头时马尾退到躯干（hair → head → neck → torso）", noHead.find((p) => p.name === "ponytail").parent === "torso",
    `got ${noHead.find((p) => p.name === "ponytail").parent}`);

  // 回退结果必须整体可校验通过。
  check("回退后的集合无 error", validateSemantics(withHip).errors.length === 0 && validateSemantics(noHead).errors.length === 0);
}

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
