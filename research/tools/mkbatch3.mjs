/**
 * 生成 batch3：统一风格约束 + 5 种地块内容，Lite 与 Pro 各一组。
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const STYLE = [
  "【必须严格遵守的画面规格】正方形画布，画面正中央只有一个地块。",
  "视角：斜45度俯视的等轴测（isometric）视角，正交投影，没有一丁点透视。",
  "地块形状：一个严格 2:1 的等距菱形——菱形左右两个顶点之间的宽度，是上下两个顶点之间高度的 2.0 倍（例如宽 1000px 时高 500px，误差不超过 2%）。",
  "四条边必须是完美的直线，斜率完全相同：左下的边向右下 26.565° 展开，右下的边向左下 26.565° 展开。",
  "没有地平线，没有侧面墙壁，没有厚度，没有立体方块，没有底座，没有透视收缩。",
  "渲染风格：像素画（pixel art）式的干净色块，色彩明快饱和，硬边缘，无噪点、无水印、无边框、无阴影、无文字、无编号、无标记。",
  "输出：背景完全透明，只有这一个菱形地块，不要出现第二个地块或任何地面以外的物件。",
];

/** 只在菱形范围内绘制的内容描述。 */
const CONTENTS = {
  "grass": "地块表面是鲜绿色的短草地，均匀细密的草叶纹理，略带深浅绿色的随机斑块，整体明亮清新。",
  "dirt": "地块表面是棕褐色的翻耕土地，有细碎土块与深浅不一的泥土颗粒，中间夹杂少量小石子，整体是温暖的土黄色调。",
  "rock": "地块表面是灰白色的岩石地面，由大小不一的灰色石块、碎石与裂隙组成，有轻微的高光与阴影表现体积感，石块不超出菱形边界。",
  "bush": "地块表面是草地，草地上长着一丛圆润茂密的深绿色灌木（低矮灌木，高度不超过地块宽度的三分之一），灌木数量一丛，位置在菱形中央偏后，不超出菱形范围。",
};

const BUILDS = {
  "grass": "C3a-50-grass",
  "dirt": "C3b-50-dirt",
  "rock": "C3c-50-rock",
  "bush": "C3d-50-bush",
};

function prompt(content) {
  return [...STYLE, content].join("\n");
}

const calls = [];
for (const [key, content] of Object.entries(CONTENTS)) {
  calls.push({
    id: `C3-${key}-lite`,
    model: "doubao-seedream-5-0-260128",
    size: "2K",
    background: "transparent",
    prompt: prompt(content),
  });
}
// 只给 Pro 跑 grass / rock 两张，看质量差
for (const key of ["grass", "rock"]) {
  calls.push({
    id: `C3-${key}-pro`,
    model: "doubao-seedream-5-0-pro-260628",
    size: "2K",
    background: "transparent",
    prompt: prompt(CONTENTS[key]),
  });
}
// 4.0 作为对照（无透明背景，出 jpg）
calls.push({
  id: "C3-grass-40",
  model: "doubao-seedream-4-0-250828",
  size: "2K",
  prompt: prompt(CONTENTS.grass) + "\n背景为纯白色（本模型不支持透明，请用纯白代替）。",
});

const out = { concurrency: 3, calls };
writeFileSync(resolve(here, "..", "probe", "batch3.json"), JSON.stringify(out, null, 2));
console.log(`wrote batch3.json with ${calls.length} calls`);
for (const c of calls) console.log(" ", c.id, c.model, (c.prompt.length) + " chars");
