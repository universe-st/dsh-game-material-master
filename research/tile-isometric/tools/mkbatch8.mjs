/**
 * 最终批次 batch8：5 类地块各出多张候选，全部走「模板填充 + 透明背景」。
 * 模型用 Seedream 5.0（lite/flash/pro 三档都跑，比较几何保持力与画质）。
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(here, "..", "probe", "tpl");

const HEAD = [
  "参考图里那个洋红色菱形就是地块的确切形状与位置。请只把菱形内部填成下面的内容。",
  "硬性要求：菱形的四个顶点、四条边、大小、位置必须与参考图完全一致；",
  "不要改变或描画轮廓，不要加边框、描边、外发光、阴影、厚度、侧面墙、立体底座，不要旋转、不要缩放、不要裁切、不要把菱形画成方块。",
  "菱形之外的区域必须保持完全透明，不要出现任何其他元素、文字、数字、标记、水印。",
  "输出正方形画布，画面里只有一个菱形。",
].join("\n");

const CONTENT = {
  "grass": "内容：鲜绿色的短草地。均匀细密的草叶纹理，深浅绿色随机交错的斑块，整体明亮清新。像素画风的干净色块，无噪点。",
  "dirt": "内容：棕褐色的翻耕土地。细碎的土块与深浅不一的泥土颗粒，夹杂少量灰色小石子，温暖的土地色调。像素画风的干净色块，无噪点。",
  "rock": "内容：灰白色的岩石地面。大小不一的灰色石块、碎石与浅色裂隙拼在一起，表面接近平坦只有很轻微的体积感，石块严格限制在菱形内部。像素画风的干净色块，无噪点。",
  "bush": "内容：草地加一丛灌木。地面是鲜绿色短草地；菱形中央偏后（略偏上）长着一丛圆润茂密的深绿色灌木，灌木高度约为菱形高度的二分之一，灌木的底部落在菱形内部。像素画风的干净色块，无噪点。",
  "tree": "内容：草地加一棵大树。地面是鲜绿色短草地；菱形中央偏后长着一棵枝叶茂密的绿色阔叶树，树干短而粗，树冠圆润，树高约为菱形宽度的三分之二，树干底部落在菱形内部。像素画风的干净色块，无噪点。",
  "bushmany": "内容：草地加一片灌木丛。地面是鲜绿色短草地；菱形上散布三到四丛大小不一的深绿色圆润灌木，错落分布，全部落在菱形内部。像素画风的干净色块，无噪点。",
};

const MODELS = {
  lite: "doubao-seedream-5-0-260128",
  flash: "doubao-seedream-5-0-flash-260915",
  pro: "doubao-seedream-5-0-pro-260628",
};

const calls = [];
for (const [key, content] of Object.entries(CONTENT)) {
  for (const tier of ["lite", "flash"]) {
    calls.push({
      id: `G-${key}-${tier}`,
      model: MODELS[tier],
      size: "2K",
      background: "transparent",
      images: [resolve(TPL, "t1-2048.png")],
      prompt: `${HEAD}\n\n${content}`,
    });
  }
}
// Pro 只跑三张做画质对照
for (const key of ["grass", "rock", "tree"]) {
  calls.push({
    id: `G-${key}-pro`,
    model: MODELS.pro,
    size: "2K",
    background: "transparent",
    images: [resolve(TPL, "t1-2048.png")],
    prompt: `${HEAD}\n\n${CONTENT[key]}`,
  });
}
// 大型建筑：2x2 = 4 格
calls.push({
  id: "G-building-flash",
  model: MODELS.flash,
  size: "2K",
  background: "transparent",
  images: [resolve(TPL, "t2x2-2048.png")],
  prompt: [
    "参考图里由 4 个菱形拼成的那块大菱形（2x2 共 4 格地块），是一栋大型建筑的地基范围。请在这块大菱形范围内画一栋建筑。",
    "建筑内容：一座中世纪风格的两层石头房屋——灰白色石墙、深蓝灰色石板尖顶屋顶、正面一扇木门和两扇小窗，墙角有深色木结构装饰。",
    "视角必须是斜45度等轴测俯视：观察者从画面下方看向建筑，能看到屋顶的两个斜面和朝向观众的两面墙。",
    "建筑在画布上左右居中，地面投影必须完全落在大菱形范围内、四条边不超出；建筑可以往画面上方长高（高度约为大菱形高度的 1.6 倍）。",
    "硬性要求：不要加边框、描边、外发光、文字、数字、标记、水印；大菱形之外必须完全透明；不要画出菱形的洋红底色；像素画风的干净色块，色彩明快饱和，无噪点。",
  ].join("\n"),
});

const out = { concurrency: 4, calls };
// 作业文件写进 jobs/（入库）；probe/ 只放原始生成图
writeFileSync(resolve(here, "..", "jobs", "batch8.json"), JSON.stringify(out, null, 2));
console.log(`wrote batch8.json with ${calls.length} calls`);
