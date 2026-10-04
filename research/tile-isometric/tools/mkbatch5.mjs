/**
 * 最终生成 batch5：模板填充法，5 种地块（含占 4 格的建筑）。
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(here, "..", "probe", "tpl");

const HEAD = [
  "参考图里的洋红色菱形就是地块的精确形状与位置，请只把菱形内部填成下面的内容。",
  "硬性要求：菱形的四个顶点、四条边、大小、位置必须与参考图逐像素一致；",
  "不要改变或描画轮廓，不要加边框、描边、外发光、阴影、厚度、侧面墙、立体底座，不要旋转、不要裁切、不要放大缩小。",
  "菱形之外的区域必须保持完全透明（alpha=0），不要出现任何其他元素、文字、数字、标记、水印。",
].join("\n");

const CONTENT = {
  "grass": "内容：鲜绿色的短草地。均匀细密的草叶纹理，深浅绿色随机交错的斑块，整体明亮清新，像素画风的干净色块，无噪点。",
  "dirt": "内容：棕褐色的翻耕土地。细碎的土块与深浅不一的泥土颗粒，夹杂少量灰色小石子，温暖的土地色调，像素画风的干净色块，无噪点。",
  "rock": "内容：灰白色的岩石地面。大小不一的灰色石块、碎石与浅色裂隙拼在一起，表面平坦只有很轻微的体积感，石块严格限制在菱形内，像素画风的干净色块，无噪点。",
  "bush": "内容：草地加一丛灌木。地面是鲜绿色短草地；菱形中央偏后长着一丛圆润茂密的深绿色灌木，灌木高度约为菱形宽度的四分之一，灌木完全落在菱形内部，不超出边界，像素画风的干净色块，无噪点。",
};

const calls = [];
for (const [key, content] of Object.entries(CONTENT)) {
  calls.push({
    id: `F-${key}`,
    model: "doubao-seedream-5-0-260128",
    size: "2K",
    background: "transparent",
    images: [resolve(TPL, "t1-2048.png")],
    prompt: `${HEAD}\n\n${content}`,
  });
}

// 大型建筑：占 2x2 = 4 格，用 2x2 模板
calls.push({
  id: "F-building",
  model: "doubao-seedream-5-0-260128",
  size: "2K",
  background: "transparent",
  images: [resolve(TPL, "t2x2-2048.png")],
  prompt: [
    "参考图里由 4 个菱形拼成的大菱形，是一栋占 2x2 共 4 格地块的大型建筑的地基范围，请在这个大菱形范围内画出建筑。",
    "建筑内容：一座中世纪风格的石头房屋——灰白石墙配深灰色石板屋顶，屋顶是尖顶，正面有一扇木门与两扇小窗，墙角有一点木结构装饰。",
    "视角必须是斜45度等轴测俯视：屋顶朝向观众（画面下方），能看到屋顶的两个斜面；建筑在画面里左右对称地坐落在大菱形中央；",
    "建筑的地面投影必须完全落在大菱形范围内，四条边不要超出大菱形的边界；建筑在画布上的垂直高度约为大菱形高度的 1.2 倍（可以往上长高，但不能往左右超出）。",
    "硬性要求：不要加边框、描边、阴影、文字、数字、标记、水印；大菱形之外必须完全透明；像素画风的干净色块，色彩明快饱和，无噪点。",
  ].join("\n"),
});

// 自由生成路线做对照（无模板）
calls.push({
  id: "F-free-bush",
  model: "doubao-seedream-5-0-260128",
  size: "2K",
  background: "transparent",
  prompt: [
    "画一个斜45度等轴测视角的游戏地图地块。",
    "地块底座是一个严格 2:1 的等距菱形（宽是高的 2.0 倍），四条边是直线，倾角 26.565 度，正交投影，没有透视、没有地平线、没有厚度、没有侧面墙。",
    "菱形上是鲜绿色短草地，中央有一丛圆润茂密的深绿色灌木。",
    "正方形画布、地块居中、背景完全透明，只有这一个地块，没有别的东西。",
    "像素画风，色彩明快饱和，干净色块，无噪点、无文字、无边框。",
  ].join("\n"),
});

const out = { concurrency: 4, calls };
// 作业文件写进 jobs/（入库）；probe/ 只放原始生成图
writeFileSync(resolve(here, "..", "jobs", "batch5.json"), JSON.stringify(out, null, 2));
console.log(`wrote batch5.json with ${calls.length} calls`);
for (const c of calls) console.log(" ", c.id, c.model, c.prompt.length + " chars");
