/**
 * E2E 用的提示词。
 *
 * 这里**不再自己维护一份方向描述**——上一版就是因为脚本里另抄了一份 FACING 表，
 * 结果和宿主的方向语义各自漂移。现在直接引用宿主的 `directions.ts`：
 * 方位、脸部可见性、防俯仰措辞都只有一处定义。
 *
 * 需要额外风格时用 extraStyle 追加，而不是重写整段。
 */

import { DEFAULT_IMAGE_PROMPT, DEFAULT_VIDEO_PROMPT, DIRECTIONS, fillImagePrompt } from "../lib/directions.js";

/** 返回 { 方向 key: 提示词 }，内容与插件默认值完全一致。 */
export function directionalPrompts(extraStyle = "") {
  const out = {};
  for (const direction of DIRECTIONS) {
    const base = fillImagePrompt(DEFAULT_IMAGE_PROMPT, direction.facing, direction.visibility);
    out[direction.key] = extraStyle.trim() === "" ? base : `${base}\n${extraStyle.trim()}`;
  }
  return out;
}

export function videoPrompt(extraStyle = "") {
  return extraStyle.trim() === "" ? DEFAULT_VIDEO_PROMPT : `${DEFAULT_VIDEO_PROMPT}\n${extraStyle.trim()}`;
}

/** 打印一张「方位 → 看得见什么」对照表，跑之前先肉眼核一遍。 */
export function describeDirections() {
  const order = ["back", "upRight", "right", "downRight", "front", "downLeft", "left", "upLeft"];
  return order
    .map((key) => {
      const direction = DIRECTIONS.find((d) => d.key === key);
      return `  ${String(direction?.compass).padEnd(3)} ${String(direction?.label).padEnd(18)} refs=${direction?.refs.join(" + ")}`;
    })
    .join("\n");
}
