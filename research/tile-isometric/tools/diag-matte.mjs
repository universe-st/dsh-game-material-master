/** 一次性诊断：抠底与白边断言到底该怎么写。 */
import { decodeImage } from "../../../lib/tilemedia.js";
import { matteForeground, regularizeDecorSprite } from "../../../lib/tilegeom.js";

const S = { cellWidth: 64, cellHeight: 96 };
const bmp = await decodeImage("research/tile-isometric/probe/b13/D-treeA-white.png");

const m = matteForeground(bmp);
let minA = 255, maxA = 0;
const levels = new Set();
for (const a of m.alpha) {
  levels.add(a);
  if (a < minA) minA = a;
  if (a > maxA) maxA = a;
}
console.log("matteForeground alpha：档位", levels.size, "min", minA, "max", maxA);

// 手写「旧路线」：硬阈值 + RGBA 一起缩（这是研究期那个会留白边的做法）
const bgc = [254, 254, 254];
const alpha = Buffer.alloc(bmp.width * bmp.height);
for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
  const d = Math.abs(bmp.rgba[p] - bgc[0]) + Math.abs(bmp.rgba[p + 1] - bgc[1]) + Math.abs(bmp.rgba[p + 2] - bgc[2]);
  alpha[i] = d <= 66 ? 0 : 255;
}
const lv2 = new Set();
let mn2 = 255, mx2 = 0;
for (const a of alpha) { lv2.add(a); if (a < mn2) mn2 = a; if (a > mx2) mx2 = a; }
console.log("旧路线 alpha：档位", lv2.size, "min", mn2, "max", mx2);

for (const matte of [true, false]) {
  const { bitmap } = regularizeDecorSprite(bmp, S, { matte });
  const lv = new Set();
  let white = 0, pale = 0, opaque = 0;
  for (let i = 0; i < bitmap.rgba.length; i += 4) {
    const a = bitmap.rgba[i + 3];
    lv.add(a);
    if (a > 8) opaque++;
    const mn = Math.min(bitmap.rgba[i], bitmap.rgba[i + 1], bitmap.rgba[i + 2]);
    const mx = Math.max(bitmap.rgba[i], bitmap.rgba[i + 1], bitmap.rgba[i + 2]);
    if (a > 200 && mn >= 220) white++;
    if (a > 200 && mx - mn < 38 && mn > 150) pale++;
  }
  console.log(`matte=${matte}: alpha档位 ${lv.size} 不透明 ${opaque} 近白不透明 ${white} 浅灰不透明 ${pale}`);
}
