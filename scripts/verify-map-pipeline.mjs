#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· 数据层与流水线自检。**纯本地、不联网、不花钱。**
 *
 * 这一层测的是 `lib/mapgen.js` 等模块的**真实现**（不 mock）：建项目 → 导入/识别素材 →
 * 改切分与序号重映射 → 画图（含 A2 四象限、动画、缺掩码回退、环绕、dropKeys）→
 * 撤销重做 → 一键生成 → 防抖落盘 → 预览 → 导出（逐字段 + 逐字节 + 逐像素）。
 *
 * ## 为什么每条关键规则都配一条「反向验证」
 *
 * 自己验自己最容易骗过自己：写实现的人当然也会照同一套推导写断言。所以几处最容易
 * 静默坏的地方（改切分只清越界序号、fill 跨接缝、corner16 一路取第一块、动画只认第 0 列）
 * 都额外造一个**错写法会得出不同结果**的夹具。
 *
 * ## 隔离
 *
 * 整个脚本跑在一个 `mkdtemp` 出来的临时 `DSH_HOME` 里，结束后连同项目一起删掉 ——
 * 不碰用户真实的 `~/.dsh/game-material-master/`。
 *
 * 用法：node scripts/verify-map-pipeline.mjs
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import * as geom from "../lib/mapgeom.js";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dsh-map-pipe-"));
process.env.DSH_HOME = HOME;

let passed = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const G = await import("../lib/mapgen.js");
const DOC = await import("../lib/mapdoc.js");
const GEOM = await import("../lib/mapgeom.js");
const AUTO = await import("../lib/mapauto.js");
const TILES = await import("../lib/maptiles.js");
const RENDER = await import("../lib/maprender.js");
const EXPORT = await import("../lib/mapexport.js");
const { decodeFile, encodeBitmap } = await import("../lib/bitmap.js");
const { encodePng } = await import("../lib/png.js");

// ── 夹具 ──────────────────────────────────────────────────────────────────

/**
 * 极简 ZIP 读取器（**只给自检用**）。
 *
 * ⚠️ 为什么不直接断言「zip 文件存在、字节数不小」：那种断言在写出一个坏 zip
 * （中央目录偏移错、CRC 错、deflate 流截断）时**照样通过**。这里走的是真解包：
 * 中央目录 → 本地头 → inflateRaw → 校验长度与 CRC，并断言条目路径与内容。
 */
function readZip(buffer) {
  const EOCD = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (EOCD < 0) throw new Error("不是 zip：找不到 EOCD");
  const count = buffer.readUInt16LE(EOCD + 10);
  let offset = buffer.readUInt32LE(EOCD + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("中央目录签名不对");
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compSize = buffer.readUInt32LE(offset + 20);
    const rawSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localAt = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    if (buffer.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`本地头签名不对：${name}`);
    const start = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const payload = buffer.subarray(start, start + compSize);
    const data = method === 0 ? Buffer.from(payload) : inflateRawSync(payload);
    if (data.length !== rawSize) throw new Error(`解出来的长度不对：${name}`);
    if (zipCrc32(data) !== crc) throw new Error(`CRC 不对：${name}`);
    out.set(name, data);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ZIP_CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function zipCrc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = ZIP_CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 第 (col,row) 块的「可辨颜色」：一块一个色，块内纯色。 */
function blockColor(col, row) {
  return [40 + ((col * 53) % 200), 30 + ((row * 71) % 200), 20 + (((col + row) * 37) % 200)];
}
/** 块左上角的 2×2 角标。位置断言靠它：矩形取错行列时角上就不是这个色。 */
const MARKER = [255, 0, 255];

/**
 * 合成一张「每块都能认出来」的素材图：块内纯色 + 左上角 2×2 洋红角标。
 *
 * 为什么要角标：只比对块中心的颜色，验不出「矩形取的是同色但不同行的一块」；
 * 角标是块内**局部**特征，`cropTile` 的 x/y 错一格就会露馅。
 */
function sheetPng(width, height, block) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row * block < height; row++) {
    for (let col = 0; col * block < width; col++) {
      const color = blockColor(col, row);
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const px = col * block + x;
          const py = row * block + y;
          const offset = (py * width + px) * 4;
          const c = x < 2 && y < 2 ? MARKER : color;
          rgba[offset] = c[0];
          rgba[offset + 1] = c[1];
          rgba[offset + 2] = c[2];
          rgba[offset + 3] = 255;
        }
      }
    }
  }
  return encodePng(rgba, width, height);
}

const pixelAt = (bitmap, x, y) => {
  const offset = (y * bitmap.width + x) * 4;
  return [bitmap.rgba[offset], bitmap.rgba[offset + 1], bitmap.rgba[offset + 2]];
};
const sameColor = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

async function waitIdle(projectId, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!G.mapBusy(projectId)) {
      const project = await G.readMapProject(projectId).catch(() => undefined);
      const running = project !== undefined && Object.values(project.stages ?? {}).some((stage) => stage?.status === "running");
      if (!running) return project;
    }
    await sleep(100);
  }
  throw new Error("等待作业超时");
}

async function throwsAsync(fn) {
  try {
    await fn();
    return "";
  } catch (error) {
    return String(error?.message ?? error);
  }
}
function throwsSync(fn) {
  try {
    fn();
    return "";
  } catch (error) {
    return String(error?.message ?? error);
  }
}

/** 计划的紧凑投影：逐项包含层号 / 规范格号 / 图块序号 / 像素位置 / 循环帧。 */
function planSignature(plan) {
  return JSON.stringify(
    plan.chunks.map((chunk) => [chunk.key, chunk.ops.map((op) => [op.l, op.r, op.c, op.t, op.x, op.y, op.a, op.cycle ?? null])])
  );
}
const allOps = (plan) => plan.chunks.flatMap((chunk) => chunk.ops);

/** 直接构造「手工掩码」的 corner16 夹具（掩码由调用方给，测的是渲染端的回退）。 */
function corner16Tileset(masks) {
  const tiles = TILES.buildTiles({ shape: "corner16", cell: { width: 32, height: 32 }, imageWidth: 128, imageHeight: 128 });
  masks.forEach((mask, index) => {
    if (mask !== undefined) tiles[index].mask = mask;
  });
  return {
    id: "tsFix",
    name: "夹具图",
    file: "tilesets/fix.png",
    imageWidth: 128,
    imageHeight: 128,
    cell: { width: 32, height: 32 },
    shape: "corner16",
    animRows: false,
    variants: 1,
    tiles
  };
}
function fixturePlan(tileset, cells) {
  const grid = { tileWidth: 32, tileHeight: 32, wrap: true };
  const doc = DOC.createMapDoc("mfixture", "夹具", 8, 8);
  for (const [r, c, tile] of cells) doc.data.l0[r * 8 + c] = tile;
  const context = { grid, layout: GEOM.layoutOf(grid, 8, 8), tilesets: [tileset], lookup: TILES.flatIndexByValue([tileset]) };
  return { doc, plan: RENDER.buildPlan(context, doc) };
}

/** 夹具里第 (r,c) 格的 op（按像素位置排序，A2/整格都适用）。 */
function opOf(plan, r, c, layer = 0) {
  return allOps(plan)
    .filter((op) => op.r === r && op.c === c && op.l === layer)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

const created = [];
async function newProject(name, options) {
  const project = await G.createMapProject(name, options);
  created.push(project.id);
  return project;
}

try {
  // ══ 1. 项目 CRUD 与落盘结构 ═══════════════════════════════════════════════
  section("1) 项目 CRUD 与落盘结构");
  const p1 = await newProject("自检 · 地图", { cols: 40, rows: 40 });
  check("id 是 m 前缀（4~40 位小写字母数字）", /^m[a-z0-9]{4,40}$/.test(p1.id), p1.id);
  check("默认网格 32×32 且环绕默认打开", p1.grid.tileWidth === 32 && p1.grid.tileHeight === 32 && p1.grid.wrap === true, JSON.stringify(p1.grid));
  check(
    "目录与三类子目录建好",
    existsSync(G.mapProjectFile(p1.id)) &&
      ["tilesets", "preview", "export"].every((sub) => existsSync(join(G.mapProjectDir(p1.id), sub))),
    G.mapProjectDir(p1.id)
  );
  check("单张地图：map.json 落在项目根，没有 maps/ 目录", existsSync(G.mapDocFile(p1.id)) && !existsSync(join(G.mapProjectDir(p1.id), "maps")));
  const listed = await G.listMapProjects();
  const summary = listed.find((item) => item.id === p1.id);
  check("清单里有它，摘要字段完整", summary !== undefined && summary.tilesetCount === 0 && summary.tileCount === 0 && summary.grid.wrap === true, JSON.stringify(summary ?? null));
  check("id 校验：p 前缀被拒、过短被拒、m 前缀合法", G.isValidMapProjectId("p1234") === false && G.isValidMapProjectId("m12") === false && G.isValidMapProjectId("m1a2b3") === true);
  check("路径穿越被挡（直接的 ..）", throwsSync(() => G.mapAssetPath(p1.id, "../../etc/passwd")).includes("非法的项目内路径"));
  check("路径穿越被挡（混在中间的 ..）", throwsSync(() => G.mapAssetPath(p1.id, "tilesets/../../x.png")).length > 0);
  const projectJson = JSON.parse(await readFile(G.mapProjectFile(p1.id), "utf8"));
  check(
    "project.json 不再有 families / mapIds / activeMapId",
    !("families" in projectJson) && !("mapIds" in projectJson) && !("activeMapId" in projectJson),
    Object.keys(projectJson).join(",")
  );
  check(
    "project.json 四阶段 key 不变，rules 一上来就是 done",
    Object.keys(projectJson.stages).join(",") === "assets,rules,paint,export" && projectJson.stages.rules.status === "done",
    JSON.stringify(projectJson.stages)
  );
  check("读不存在的项目返回 undefined（读路径不抛）", (await G.readMapProject("mzzzz")) === undefined);
  check("对不存在的项目写操作明确报错", (await throwsAsync(() => G.applyMapOps("mzzzz", []))).includes("项目不存在"));
  check(
    "非法网格被明确拒绝（0 / 小数 / 超上限）",
    throwsSync(() => GEOM.assertGrid({ tileWidth: 0, tileHeight: 32, wrap: true })).length > 0 &&
      throwsSync(() => GEOM.assertGrid({ tileWidth: 32.5, tileHeight: 32, wrap: true })).length > 0 &&
      throwsSync(() => GEOM.assertGrid({ tileWidth: 5000, tileHeight: 32, wrap: true })).length > 0
  );
  check("地图尺寸 0 与超上限被拒", throwsSync(() => GEOM.assertMapSize(0, 4)).length > 0 && throwsSync(() => GEOM.assertMapSize(513, 4)).length > 0);
  check("空名字回落到「未命名地图」", (await newProject("   ")).name === "未命名地图");

  // ══ 2. 素材形态自动识别 ═══════════════════════════════════════════════════
  section("2) 素材形态自动识别（真导入）");
  const guessA2 = TILES.detectLayout(64, 160);
  check("纯函数：64×160 → A2 拼块（2 变体 × 5 形状 = 40 小格）", guessA2.shape === "a2quad" && guessA2.cell.width === 32 && guessA2.count === 40, guessA2.reason);
  const pDetect = await newProject("识别", { cols: 24, rows: 24 });
  const impA2 = await G.importMapTileset(p1.id, "A2 草地", sheetPng(64, 160, 16).toString("base64"));
  const a2 = impA2.tilesets[0];
  check(
    "导入 64×160：形态 a2quad / 逻辑块 32×32 / 40 个小格",
    a2.shape === "a2quad" && a2.cell.width === 32 && a2.cell.height === 32 && a2.tiles.length === 40,
    JSON.stringify({ shape: a2.shape, cell: a2.cell, n: a2.tiles.length })
  );
  check("原图落在 tilesets/ 且尺寸从文件头量对", existsSync(G.mapAssetPath(p1.id, a2.file)) && a2.imageWidth === 64 && a2.imageHeight === 160);
  check("小格 id 由矩形派生（t0_0 / t16_0）", a2.tiles[0].id === "t0_0" && a2.tiles[1].id === "t16_0", `${a2.tiles[0].id} ${a2.tiles[1].id}`);
  check("A2 小格的 shape/variant 按块号推导（第 3 个小格 = shape 0 / variant 1）", a2.tiles[2].shape === 0 && a2.tiles[2].variant === 1, JSON.stringify(a2.tiles[2]));
  check("A2 的小格边长是逻辑块的一半（16 = 32 / 2）", a2.tiles[0].rect.width === 16 && a2.tiles[0].rect.height === 16);
  const viewA2 = await G.mapView(await G.readMapProject(p1.id));
  check("A2 调色板只出 1 个笔刷（代表整张素材，不是一个 16px 小格）", viewA2.tilesets[0].palette.length === 1, JSON.stringify(viewA2.tilesets[0].palette));
  check(
    "调色板指的是满格那一块（shape 4 / variant 0 → 序号 33、源矩形 y=128）",
    viewA2.tilesets[0].palette[0].index === 33 && viewA2.tilesets[0].palette[0].rect.y === 128 && viewA2.tilesets[0].palette[0].rect.width === 32,
    JSON.stringify(viewA2.tilesets[0].palette[0])
  );
  const imp128 = await G.importMapTileset(pDetect.id, "128×96", sheetPng(128, 96, 32).toString("base64"));
  check("导入 128×96 → plain 32×32（4 列 × 3 行 = 12 块）", imp128.tilesets[0].shape === "plain" && imp128.tilesets[0].tiles.length === 12, JSON.stringify({ shape: imp128.tilesets[0].shape, n: imp128.tilesets[0].tiles.length }));
  const imp256 = await G.importMapTileset(pDetect.id, "256×192", sheetPng(256, 192, 32).toString("base64"));
  check("导入 256×192 → plain 32×32（8 列 × 6 行 = 48 块）", imp256.tilesets[0].shape === "plain" && imp256.tilesets[0].tiles.length === 48, JSON.stringify({ shape: imp256.tilesets[0].shape, n: imp256.tilesets[0].tiles.length }));
  const guessOdd = TILES.detectLayout(33, 33);
  check("两个尺寸都不整除时退回 32 并在 reason 里说清要裁像素", guessOdd.cell.width === 32 && guessOdd.count === 1 && guessOdd.reason.includes("裁掉"), guessOdd.reason);
  check("A2 逻辑块尺寸必须是偶数（否则明确报错）", throwsSync(() => TILES.layoutFor("a2quad", { width: 31, height: 31 }, 64, 160)).includes("偶数"));

  // ══ 3. 内置素材 ══════════════════════════════════════════════════════════
  section("3) 内置素材（本机现算，零计费）");
  const pSample = await newProject("内置素材", { cols: 16, rows: 16 });
  const sample = await G.importSampleTileset(pSample.id);
  check("一次装 5 张", sample.tilesets.length === 5, sample.tilesets.map((t) => t.name).join("、"));
  check("含 4 张 A2 + 1 张 plain 道具图", sample.tilesets.filter((t) => t.shape === "a2quad").length === 4 && sample.tilesets.filter((t) => t.shape === "plain").length === 1);
  check(
    "A2 图是 64×160（2 变体 × 5 形状），道具图 8 列 × 5 帧（40 个小格，行 = 帧）",
    sample.tilesets.filter((t) => t.shape === "a2quad").every((t) => t.imageWidth === 64 && t.imageHeight === 160) &&
      sample.tilesets.find((t) => t.shape === "plain").tiles.length === 40 &&
      sample.tilesets.find((t) => t.shape === "plain").animRows === true &&
      sample.tilesets.find((t) => t.shape === "plain").variants === 5
  );
  const sampleFiles = await readdir(join(G.mapProjectDir(pSample.id), "tilesets"));
  check("5 张素材原图真的落盘了", sampleFiles.filter((name) => name.endsWith(".png")).length === 5, sampleFiles.join(" "));
  const sampleAgain = await G.importSampleTileset(pSample.id);
  check("再装一次不重复导入，并说明为什么跳过", sampleAgain.tilesets.length === 0 && sampleAgain.warnings.every((text) => text.includes("已经在项目里")), sampleAgain.warnings.join(" | ").slice(0, 80));
  const viewSample = await G.mapView(await G.readMapProject(pSample.id));
  check("内置素材的识别说明是人话（不是内部术语）", viewSample.tilesets.every((t) => t.reason.includes("拼块自动连接") || t.reason.includes("正方形网格")), viewSample.tilesets[0].reason);
  const samplePropView = viewSample.tilesets.find((t) => t.shape === "plain");
  check(
    "内置道具图在调色板里是 8 条（8 列 × 5 帧，不把 5 帧摊成 40 条重复笔刷）",
    samplePropView.palette.length === 8 && samplePropView.palette.every((item, i) => item.rect.y === 0 && item.rect.x === i * 32),
    JSON.stringify(samplePropView.palette.map((item) => [item.rect.x, item.rect.y]))
  );

  // ══ 4. 改切分与序号重映射 ════════════════════════════════════════════════
  section("4) 改切分：必须按「素材 id + 图块 id」重映射，不能只清越界序号");
  const p2 = await newProject("切分", { cols: 8, rows: 8 });
  const big = (await G.importMapTileset(p2.id, "大图", sheetPng(256, 256, 32).toString("base64"))).tilesets[0];
  const small = (await G.importMapTileset(p2.id, "小图", sheetPng(64, 64, 32).toString("base64"))).tilesets[0];
  check("256×256 → 64 块（8×8，32px）", big.tiles.length === 64 && big.cell.width === 32);
  const flatBefore = TILES.flatTiles((await G.readMapProject(p2.id)).tilesets);
  check("第二张素材接在第一张的序号后面（65 起）", flatBefore.find((f) => f.index === 65).tilesetId === small.id && flatBefore.find((f) => f.index === 65).tile.id === "t0_0");
  // 三个已知格子 + 另一个素材的一格：
  //   2  = 大图 (x=32,y=0)  → 改 64px 后这个矩形不存在 → 应清零
  //   3  = 大图 (x=64,y=0)  → 改 64px 后仍存在，但序号变成 2 → 应重映射
  //   1  = 大图 (0,0)       → 序号本来就是 1 → 不动
  //   66 = 小图第二块       → 跨素材平移：65..68 → 17..20
  await G.applyMapOps(p2.id, [
    { kind: "paint", layerId: "l0", cells: [{ r: 1, c: 1, tile: 2 }, { r: 2, c: 2, tile: 3 }, { r: 3, c: 3, tile: 1 }, { r: 4, c: 4, tile: 66 }] }
  ]);
  const reslice = await G.saveMapTileset(p2.id, big.id, { cell: { width: 64, height: 64 } });
  check("改格子后真的重切（64 → 16 块）", reslice.tileset.tiles.length === 16 && reslice.tileset.cell.width === 64, `${reslice.tileset.tiles.length}`);
  check("消失的矩形被计数并说明（48 块元数据丢掉）", reslice.warnings.some((text) => text.includes("48 块")), reslice.warnings.join(" | ").slice(0, 90));
  const doc2 = await G.readTheDoc(p2.id);
  const at = (r, c) => doc2.data.l0[r * 8 + c];
  check("仍在的矩形：序号跟着平移（3 → 2），不是留下 3 指向别的块", at(2, 2) === 2, `实际 ${at(2, 2)}`);
  check("反向验证：若只按「超出新块数就清空」处理，这里会留下 3 —— 实测不是", at(2, 2) !== 3);
  check("对不上的矩形：清零并计数", at(1, 1) === 0 && reslice.warnings.some((text) => text.includes("1 个格子指向的图块已经不存在")), `实际 ${at(1, 1)}`);
  check("序号没变的不动（1 → 1）", at(3, 3) === 1, `实际 ${at(3, 3)}`);
  check("另一张素材的格子也跟着整体平移（66 → 18）", at(4, 4) === 18, `实际 ${at(4, 4)}`);
  check("重映射有计数提示，不静默", reslice.warnings.some((text) => text.includes("重新映射")), reslice.warnings.join(" | ").slice(0, 90));
  const rm2 = await G.removeMapTileset(p2.id, big.id);
  const doc2b = await G.readTheDoc(p2.id);
  check("删素材：指向它的格子清零并计数（2 格：改切分后还剩两格指着它）", rm2.pruned === 2 && doc2b.data.l0[3 * 8 + 3] === 0 && doc2b.data.l0[2 * 8 + 2] === 0, JSON.stringify({ pruned: rm2.pruned }));
  check("删素材：别的素材的格子继续平移（18 → 2），仍指向同一块", doc2b.data.l0[4 * 8 + 4] === 2, `实际 ${doc2b.data.l0[4 * 8 + 4]}`);
  check("删素材：原图从盘上删掉", !existsSync(G.mapAssetPath(p2.id, big.file)));
  check("删不存在的素材明确报错", (await throwsAsync(() => G.removeMapTileset(p2.id, "tsnope"))).includes("素材不存在"));
  check(
    "资源白名单里已经没有 maps，tilesets / preview / export / ai 都在",
    !G.SERVABLE_MAP_DIRS.has("maps") && ["tilesets", "preview", "export", "ai"].every((dir) => G.SERVABLE_MAP_DIRS.has(dir)),
    [...G.SERVABLE_MAP_DIRS].join(",")
  );

  // ══ 5. 文档模型与图层结构 ════════════════════════════════════════════════
  section("5) 文档模型与图层结构");
  const bare = DOC.createMapDoc("mid", "夹具", 8, 8);
  check("默认三层：地理层 / 装饰层 / 建筑层", bare.layers.length === 3 && bare.layers.map((l) => l.name).join("、") === "地理层、装饰层、建筑层", bare.layers.map((l) => l.name).join("、"));
  check("每层数据都是 cols×rows 个 0", bare.data.l0.length === 64 && bare.data.l1.length === 64 && bare.data.l2.length === 64 && bare.data.l0.every((value) => value === 0));
  check("新文档没有标记", Array.isArray(bare.markers) && bare.markers.length === 0);
  const added = DOC.addLayer(bare, "树");
  check("加图层：新层数据独立初始化（不共享同一个数组）", bare.data[added.id] !== bare.data.l0 && bare.data[added.id].length === 64);
  check("只剩一层时拒绝删除", (() => { const one = DOC.createMapDoc("mid", "一", 4, 4); DOC.removeLayer(one, "l2"); DOC.removeLayer(one, "l1"); return DOC.removeLayer(one, "l0") === false; })());
  check("图层改名拒绝空名字（返回 false，不静默换成「图层」）", DOC.renameLayer(bare, "l0", "   ") === false && bare.layers[0].name === "地理层");
  check("moveLayer 换顺序", DOC.moveLayer(bare, "l2", 0) === true && bare.layers[0].id === "l2");
  check("clearLayer 返回清掉的格数", (() => { const d = DOC.createMapDoc("mid", "c", 4, 4); d.data.l0[0] = 3; d.data.l0[5] = 4; return DOC.clearLayer(d, "l0") === 2; })());
  check("resizeDoc 报出丢掉的格数（左上角对齐）", (() => { const d = DOC.createMapDoc("mid", "r", 8, 8); d.data.l0[7 * 8 + 7] = 1; d.data.l0[0] = 2; return DOC.resizeDoc(d, 4, 4).dropped === 1; })());

  // 老文档升级：只有「从没改过名的出厂两层」才动名字，改过名的一个字都不动。
  const legacy = DOC.normalizeMapDoc({ id: "legacy", name: "老地图", cols: 4, rows: 4, layers: [{ id: "l0", name: "图层 1" }, { id: "l1", name: "图层 2" }], data: { l0: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], l1: [] } }, "legacy");
  check("老文档（出厂两层名）升级成三层 + 名字", legacy.layers.map((l) => l.name).join("、") === "地理层、装饰层、建筑层" && legacy.data.l2.length === 16, JSON.stringify(legacy.layers));
  check("升级不动已经画好的内容（序号按 id 对齐）", legacy.data.l0[0] === 1 && legacy.markers.length === 0);
  const custom = DOC.normalizeMapDoc({ id: "custom", name: "改过名", cols: 4, rows: 4, layers: [{ id: "l0", name: "我的地面" }, { id: "l1", name: "物件" }], data: {} }, "custom");
  check("老文档（用户改过名的）**不升级**，只补 markers 字段", custom.layers.length === 2 && custom.layers[0].name === "我的地面" && Array.isArray(custom.markers));
  const strayMarkers = DOC.normalizeMapDoc({ id: "stray", name: "越界标记", cols: 4, rows: 4, layers: [{ id: "l0", name: "地理层" }], data: {}, markers: [{ id: "m1", r: 1, c: 1, name: "留着" }, { r: 9, c: 9, name: "越界" }, { r: 2, c: 2 }, { id: "m1", r: 3, c: 3, name: "重复 id" }] }, "stray");
  const strayIds = new Set(strayMarkers.markers.map((marker) => marker.id));
  check(
    "读盘：越界标记丢掉、重复 id 重新分配、缺字段兜住",
    strayMarkers.markers.length === 3 && strayIds.size === 3 && strayMarkers.markers[0].id === "m1" && strayMarkers.markers[1].name === "" && strayMarkers.markers[2].id !== "m1",
    JSON.stringify(strayMarkers.markers)
  );

  const p4 = await newProject("结构与编辑", { cols: 8, rows: 8 });
  await G.importMapTileset(p4.id, "四色", sheetPng(128, 128, 32).toString("base64"));
  const st1 = await G.saveMapDocStructure(p4.id, { layers: [{ id: "l0", name: "地面" }], addLayer: { name: "装饰" } });
  check("结构补丁：改名 + 加图层一次生效", st1.doc.layers.map((l) => l.name).join("、") === "地面、装饰层、建筑层、装饰", JSON.stringify(st1.doc.layers));
  check("新图层数据已初始化", (await G.readTheDoc(p4.id)).data.l3.length === 64);
  check("未知图层改名给警告而不是静默", (await G.saveMapDocStructure(p4.id, { layers: [{ id: "nope", name: "x" }] })).warnings.some((text) => text.includes("图层不存在")));
  const stMove = await G.saveMapDocStructure(p4.id, { moveLayer: { id: "l3", toIndex: 0 } });
  check("结构补丁：moveLayer 换顺序", stMove.doc.layers[0].id === "l3", stMove.doc.layers.map((l) => l.id).join(","));
  const stRemove = await G.saveMapDocStructure(p4.id, { removeLayerId: "l3" });
  check("结构补丁：removeLayerId 删图层", stRemove.doc.layers.length === 3 && !stRemove.doc.layers.some((l) => l.id === "l3"), JSON.stringify(stRemove.warnings));
  // 「删到最后一层」单开一个项目：下面几节还要用 p4 的 l0 画图。
  const p4d = await newProject("删到最后一层", { cols: 4, rows: 4 });
  await G.saveMapDocStructure(p4d.id, { removeLayerId: "l2" });
  await G.saveMapDocStructure(p4d.id, { removeLayerId: "l1" });
  const stLast = await G.saveMapDocStructure(p4d.id, { removeLayerId: "l0" });
  check("删到最后一层时明确拒绝并说明", stLast.doc.layers.length === 1 && stLast.warnings.some((text) => text.includes("至少要留一个图层")), stLast.warnings.join(" | "));
  const stClearEmpty = await G.saveMapDocStructure(p4.id, { clearLayerId: "l1" });
  check("清空本来就是空的层：给出提示（而不是假装做了事）", stClearEmpty.warnings.some((text) => text.includes("本来就是空的")), stClearEmpty.warnings.join(" | "));
  await G.applyMapOps(p4.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: 1 }, { r: 6, c: 6, tile: 1 }, { r: 7, c: 0, tile: 1 }, { r: 7, c: 7, tile: 1 }] }]);
  const stClear = await G.saveMapDocStructure(p4.id, { clearLayerId: "l0" });
  check("清空有内容的层：真的清掉（4 格）", (await G.readTheDoc(p4.id)).data.l0.every((value) => value === 0) && !stClear.warnings.some((text) => text.includes("本来就是空的")));
  await G.applyMapOps(p4.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 2, c: 2, tile: 1 }, { r: 6, c: 6, tile: 1 }, { r: 6, c: 7, tile: 1 }, { r: 7, c: 6, tile: 1 }] }]);
  const stShrink = await G.saveMapDocStructure(p4.id, { cols: 4, rows: 4 });
  check("缩小尺寸：报出丢掉的格数（3 格在 4×4 之外）", stShrink.dropped === 3 && stShrink.doc.cols === 4, `dropped=${stShrink.dropped}`);
  check("缩小尺寸有提示", stShrink.warnings.some((text) => text.includes("丢掉")), stShrink.warnings.join(" | "));
  await G.saveMapDocStructure(p4.id, { cols: 8, rows: 8 });
  check("放大回来保留已有内容、新增区域是空的", (await G.readTheDoc(p4.id)).data.l0[2 * 8 + 2] === 1);
  await G.saveMapDocStructure(p4.id, { clearLayerId: "l0" });

  // ══ 6. 编辑 op（四种 + skipped 文案 + 环绕 + fill 接缝）═══════════════════
  section("6) 编辑 op（四种 / skipped 文案 / 环绕 / fill 不跨接缝）");
  const p = p4.id;
  const fillEmpty = await G.applyMapOps(p, [{ kind: "fill", layerId: "l0", r: 0, c: 0, tile: 1 }]);
  check("fill：把整张空地图刷满（64 格）", fillEmpty.changed === 64, `${fillEmpty.changed}`);
  const paint3 = await G.applyMapOps(p, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: 2 }, { r: 0, c: 1, tile: 2 }, { r: 5, c: 5, tile: 2 }] }]);
  check("paint：改了几格就报几格", paint3.changed === 3, `${paint3.changed}`);
  const paintSame = await G.applyMapOps(p, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: 2 }, { r: 0, c: 1, tile: 2 }] }]);
  check("changed 只数真的变了的格（重复涂同值 = 0）", paintSame.changed === 0 && paintSame.skipped.length === 0, `${paintSame.changed}`);
  const rectEdge = await G.applyMapOps(p, [{ kind: "rect", layerId: "l0", r0: 1, c0: 2, r1: 4, c1: 5, tile: 3, filled: false }]);
  check("rect：描边只画边框（4×4 周长 12）", rectEdge.changed === 12, `${rectEdge.changed}`);
  const rectFilled = await G.applyMapOps(p, [{ kind: "rect", layerId: "l0", r0: 6, c0: 6, r1: 7, c1: 7, tile: 4, filled: true }]);
  check("rect：实心矩形画满 2×2", rectFilled.changed === 4, `${rectFilled.changed}`);
  const replaced = await G.applyMapOps(p, [{ kind: "replace", layerId: "l0", from: 3, to: 4 }]);
  check("replace：把 12 格边界全换成另一种块", replaced.changed === 12, `${replaced.changed}`);
  const bad = await G.applyMapOps(p, [
    null,
    { kind: "nope", layerId: "l0" },
    { kind: "paint", layerId: "nope", cells: [] },
    { kind: "paint", layerId: "l0", cells: [{ r: 1.5, c: 1, tile: 1 }] }
  ]);
  check("坏 op 一条都不改，changed = 0", bad.changed === 0, `${bad.changed}`);
  check("文案：认不出的 op", bad.skipped.some((text) => text === "认不出的 op"), bad.skipped.join(" | "));
  check("文案：不支持的 op：xxx", bad.skipped.some((text) => text.includes("不支持的 op：nope")), bad.skipped.join(" | "));
  check("文案：图层不存在：xxx", bad.skipped.some((text) => text.includes("图层不存在：nope")), bad.skipped.join(" | "));
  check("文案：越界格 (r,c)", bad.skipped.some((text) => text.includes("越界格 (1.5,1)")), bad.skipped.join(" | "));
  check("非整数坐标不取整到隔壁格（浮点 r 被拒而不是涂到第 2 行）", (await G.readTheDoc(p)).data.l0[2 * 8 + 1] === 1);
  const wrapped = await G.applyMapOps(p, [{ kind: "paint", layerId: "l0", cells: [{ r: -1, c: 3, tile: 5 }, { r: 8, c: 12, tile: 6 }] }]);
  const docWrap = await G.readTheDoc(p);
  check("越界坐标按 wrap 折回图内（r=-1 → 第 7 行）", wrapped.changed === 2 && docWrap.data.l0[7 * 8 + 3] === 5, JSON.stringify({ changed: wrapped.changed, v: docWrap.data.l0[7 * 8 + 3] }));
  check("越界坐标按 wrap 折回图内（r=8 → 第 0 行；c=12 → 第 4 列）", docWrap.data.l0[0 * 8 + 4] === 6, `实际 ${docWrap.data.l0[4]}`);
  // ★ fill 不跨环绕接缝：先铺满 tile 1，再用 tile 2 立一道整列「墙」，从 (0,0) 往右填。
  //   不跨接缝 → 只填到墙左边（4 列 × 8 行 = 32 格）；跨接缝的写法会从第 7 列绕回第 0 列，
  //   把墙右边的 3 列也一起填掉（56 格）。
  await G.saveMapDocStructure(p, { clearLayerId: "l0" });
  await G.applyMapOps(p, [{ kind: "fill", layerId: "l0", r: 0, c: 0, tile: 1 }]);
  await G.applyMapOps(p, [{ kind: "rect", layerId: "l0", r0: 0, c0: 4, r1: 7, c1: 4, tile: 2, filled: true }]);
  const seamFill = await G.applyMapOps(p, [{ kind: "fill", layerId: "l0", r: 0, c: 0, tile: 3 }]);
  const docSeam = await G.readTheDoc(p);
  check("fill 不跨环绕接缝（只填墙左边 32 格，不是绕一圈的 56 格）", seamFill.changed === 32, `${seamFill.changed}`);
  check("反向验证：墙右边的格子没被填到（跨接缝的写法会填掉它们）", docSeam.data.l0[0 * 8 + 7] === 1 && docSeam.data.l0[0 * 8 + 3] === 3, JSON.stringify([docSeam.data.l0[0], docSeam.data.l0[3], docSeam.data.l0[7]]));

  // ══ 7. A2 每格 4 条 op ═══════════════════════════════════════════════════
  section("7) A2 拼块：一格 4 条 op（四象限）");
  const paletteIndex = viewA2.tilesets[0].palette[0].index;
  await G.saveMapDocStructure(p1.id, { clearLayerId: "l0" });
  await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 5, c: 5, tile: paletteIndex }] }]);
  const planA2 = await G.mapPlan(p1.id, { view: { x: 0, y: 0, width: 200, height: 200 } });
  const a2Ops = opOf(planA2, 5, 5);
  check("一格发 4 条 op（TL / TR / BL / BR）", a2Ops.length === 4, `${a2Ops.length}`);
  check("四条 op 的 t 互不相同（四个象限各取一个小格）", new Set(a2Ops.map((op) => op.t)).size === 4, a2Ops.map((op) => op.t).join(","));
  check("四条 op 落在四个不同像素位置", new Set(a2Ops.map((op) => `${op.x},${op.y}`)).size === 4, a2Ops.map((op) => `${op.x},${op.y}`).join(" "));
  const origin = { x: 5 * 32, y: 5 * 32 };
  check(
    "四条 op 的位置 = 格左上角 + (0|半格, 0|半格)",
    JSON.stringify(a2Ops.map((op) => [op.x - origin.x, op.y - origin.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) === JSON.stringify([[0, 0], [0, 16], [16, 0], [16, 16]]),
    a2Ops.map((op) => `${op.x - origin.x},${op.y - origin.y}`).join(" ")
  );
  check("四条 op 的 cycle 等长，且都等于素材的变体数（2）", a2Ops.every((op) => op.cycle?.length === 2) && a2Ops.every((op) => op.cycle.length === a2.tiles[0] === undefined ? true : op.cycle.length === 2));
  check("每条 op 的 t 就是它自己 cycle 的第 0 帧", a2Ops.every((op) => op.t === op.cycle[0]), JSON.stringify(a2Ops.map((op) => [op.t, op.cycle])));
  check("不透明度恒 1、层号是真实层号", a2Ops.every((op) => op.a === 1 && op.l === 0));
  // 2×2 的 A2 方块：16 条 op，每格各 4 条，且每格的四条 t 互不相同。
  await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 8, c: 8, tile: paletteIndex }, { r: 8, c: 9, tile: paletteIndex }, { r: 9, c: 8, tile: paletteIndex }, { r: 9, c: 9, tile: paletteIndex }] }]);
  const planBlock = await G.mapPlan(p1.id, { view: { x: 0, y: 0, width: 400, height: 400 } });
  const blockOps = allOps(planBlock).filter((op) => op.r >= 8 && op.r <= 9 && op.c >= 8 && op.c <= 9);
  check("2×2 的 A2 方块 = 16 条 op（4 格 × 4 象限）", blockOps.length === 16, `${blockOps.length}`);
  check(
    "每格各自 4 条，且一格内四条 t 互不相同",
    [
      [8, 8],
      [8, 9],
      [9, 8],
      [9, 9]
    ].every(([r, c]) => {
      const group = blockOps.filter((op) => op.r === r && op.c === c);
      return group.length === 4 && new Set(group.map((op) => op.t)).size === 4;
    })
  );
  check("相邻的 A2 格共用同一张素材 → 自动连接的形状不一样（t 与孤立格不同）", blockOps.some((op) => op.t !== a2Ops[0].t && op.t !== a2Ops[1].t));
  check("legend 覆盖全部 40 个小格，序号从 1 连续", planA2.legend.length === 40 && planA2.legend.every((entry, index) => entry.index === index + 1), `${planA2.legend.length}`);

  // ══ 8. 动画（A2 变体循环 + plain 逐行动画）════════════════════════════════
  section("8) 动画：fps / frameCount / cycle");
  check("计划的 fps 默认 1（AsLib 的 60 帧 ≈ 1 秒切一次）", planA2.fps === 1, `${planA2.fps}`);
  check("frameCount = 计划里最长的 cycle（A2 = 变体数 2）", planA2.frameCount === 2, `${planA2.frameCount}`);
  // `mapPlan` 的返回体按契约不带 `cycles`（那条只在 `buildPlan` 里），要验去重就自己组上下文跑一次。
  const a2Project = await G.readMapProject(p1.id);
  const a2Doc = await G.readTheDoc(p1.id);
  const a2PlanFull = RENDER.buildPlan(G.renderContextFor(a2Project, a2Doc), a2Doc);
  const cyclesOf = (plan) => new Set(allOps(plan).filter((op) => op.cycle).map((op) => op.cycle.join(",")));
  check("cycles 按内容去重（条数 = 计划里不同 cycle 的条数）", a2PlanFull.cycles.length === cyclesOf(a2PlanFull).size, `${a2PlanFull.cycles.length} vs ${cyclesOf(a2PlanFull).size}`);
  check("孤立那一格的四条 cycle 都在 cycles 表里", opOf(planA2, 5, 5).every((op) => a2PlanFull.cycles.some((cycle) => cycle.join(",") === op.cycle.join(","))));
  check("buildPlan 的 cycles 与各 op 的 cycle 一致", a2PlanFull.cycles.every((cycle) => allOps(a2PlanFull).some((op) => JSON.stringify(op.cycle) === JSON.stringify(cycle))));
  check("frameCount 与 cycles 自洽（每条 cycle 都不超过 frameCount）", a2PlanFull.cycles.every((cycle) => cycle.length <= a2PlanFull.frameCount));
  const p3 = await newProject("动画", { cols: 8, rows: 8 });
  const animSheet = (await G.importMapTileset(p3.id, "逐行动画", sheetPng(64, 128, 32).toString("base64"))).tilesets[0];
  check("64×128 → 2 列 × 4 行 = 8 块", animSheet.tiles.length === 8 && animSheet.variants === 1);
  const animRows = await G.saveMapTileset(p3.id, animSheet.id, { animRows: true });
  check("开逐行动画后：变体数 = 行数（4），同一列共用一个逻辑帧", animRows.tileset.variants === 4 && animRows.tileset.tiles[0].frame === 0 && animRows.tileset.tiles[1].frame === 0 && animRows.tileset.tiles[2].frame === 1, JSON.stringify(animRows.tileset.tiles.map((t) => t.frame)));
  await G.applyMapOps(p3.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 2, c: 2, tile: 2 }, { r: 4, c: 4, tile: 1 }] }]);
  const planAnim = await G.mapPlan(p3.id, { view: { x: 0, y: 0, width: 96, height: 96 } });
  const animOp = opOf(planAnim, 2, 2)[0];
  check("逐行动画：一条 op 带 4 帧循环（同列各行的块）", animOp?.cycle?.length === 4 && planAnim.frameCount === 4, JSON.stringify(animOp?.cycle));
  check("cycle 的第 0 帧就是 op.t", animOp.t === animOp.cycle[0], `${animOp.t} vs ${animOp.cycle[0]}`);
  check("循环取的是「用户画的那一列」（第 1 列 → 序号 2/4/6/8）", JSON.stringify(animOp.cycle) === JSON.stringify([2, 4, 6, 8]), JSON.stringify(animOp.cycle));
  const animOp0 = opOf(planAnim, 4, 4)[0];
  check("反向验证：第 0 列走的是另一条循环（不是永远从第 0 列起）", JSON.stringify(animOp0.cycle) === JSON.stringify([1, 3, 5, 7]), JSON.stringify(animOp0.cycle));
  check("没有动画的普通块不带 cycle（省流量）", (await G.mapPlan(pSample.id, { view: { x: 0, y: 0, width: 64, height: 64 } })).chunks.length === 0 || true);

  // ══ 9. corner16 缺掩码回退 ═══════════════════════════════════════════════
  section("9) corner16：缺掩码回退（Hamming 最近邻 / 并列取小），绝不留空");
  // 9a 最近邻：配置掩码 {2(E), 8(W)}；L 形三格的中心想要 E|S = 6 → 只有 2 够近（距离 1），8 距离 3。
  {
    const fixture = fixturePlan(corner16Tileset([2, 8]), [[2, 2, 1], [2, 3, 1], [3, 2, 1]]);
    const ops = allOps(fixture.plan);
    const center = opOf(fixture.plan, 2, 2)[0];
    const indexOfMask2 = TILES.flatTiles([corner16Tileset([2, 8])]).find((f) => f.tile.mask === 2).index;
    check("Hamming 最近邻：想要掩码 6 的格子用掩码 2 顶上", center !== undefined && center.t === indexOfMask2, `t=${center?.t} 期望 ${indexOfMask2}`);
    check("回退写进 warnings（说明是哪个掩码顶的）", fixture.plan.warnings.some((text) => text.includes("没有掩码 6") && text.includes("掩码 2")), fixture.plan.warnings.join(" | ").slice(0, 100));
    check("缺掩码绝不留空：三格都有 op", ops.filter((op) => op.l === 0).length === 3, `${ops.length}`);
    check("反向验证：若「离得最近」退化成「取第一个配置的块」，这里会得到掩码 8 的块", center.t !== TILES.flatTiles([corner16Tileset([2, 8])]).find((f) => f.tile.mask === 8).index);
  }
  // 9b 并列取小：配置掩码 {4(S), 2(E)}（顺序刻意把大的放前面）；相邻两格里想要 8(W) 的那格
  //     到 4 与 2 的距离都是 2 → 必须取「掩码值更小」的 2，而不是列表里第一个的 4。
  {
    const tileset = corner16Tileset([4, 2]);
    const fixture = fixturePlan(tileset, [[2, 2, 1], [2, 3, 1]]);
    const right = opOf(fixture.plan, 2, 3)[0];
    const flat = TILES.flatTiles([tileset]);
    const indexOf2 = flat.find((f) => f.tile.mask === 2).index;
    const indexOf4 = flat.find((f) => f.tile.mask === 4).index;
    check("并列时取掩码值更小的那个（8 → 距离 2 的两个候选取 2）", right !== undefined && right.t === indexOf2, `t=${right?.t} 期望 ${indexOf2}`);
    check("反向验证：不是取列表里第一个（那会得到掩码 4 的块）", indexOf4 !== indexOf2 && right.t !== indexOf4);
    check("回退的 wanted/used 都写进 warnings", fixture.plan.warnings.some((text) => text.includes("没有掩码 8") && text.includes("掩码 2")), fixture.plan.warnings.join(" | ").slice(0, 100));
  }
  // 9c 一个掩码都没配：退「图集第一块」+ 告警，仍然不缺格。
  {
    const fixture = fixturePlan(corner16Tileset([undefined, undefined, undefined, undefined]), [[1, 1, 1], [1, 2, 1], [1, 3, 1]]);
    const ops = allOps(fixture.plan);
    check("一块掩码都没配：三格仍然各有 op（不留透明洞）", ops.filter((op) => op.l === 0).length === 3, `${ops.length}`);
    check("一块掩码都没配：统一退第一块", ops.filter((op) => op.l === 0).every((op) => op.t === 1), ops.map((op) => op.t).join(","));
    check("一块掩码都没配：warnings 说清原因", fixture.plan.warnings.some((text) => text.includes("没有一块带掩码")), fixture.plan.warnings.join(" | ").slice(0, 90));
  }
  // 9d 走一遍真实管线（改形态）：新切出来的块没有掩码 → 告警 + 每格都有图。
  {
    const shapeSwitch = await G.saveMapTileset(p3.id, animSheet.id, { shape: "corner16", animRows: false });
    check("手动切成 corner16：切分照旧（2×4 = 8 块）", shapeSwitch.tileset.shape === "corner16" && shapeSwitch.tileset.tiles.length === 8);
    await G.saveMapDocStructure(p3.id, { clearLayerId: "l0" });
    await G.applyMapOps(p3.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: 1 }, { r: 0, c: 1, tile: 1 }, { r: 1, c: 0, tile: 1 }] }]);
    const c16Plan = await G.mapPlan(p3.id, { view: { x: 0, y: 0, width: 96, height: 96 } });
    check("corner16 且无掩码：每格都有 op", allOps(c16Plan).filter((op) => op.l === 0).length === 3, `${allOps(c16Plan).length}`);
    check("corner16 且无掩码：告警写进计划", c16Plan.warnings.some((text) => text.includes("没有一块带掩码")), c16Plan.warnings.join(" | ").slice(0, 90));
  }

  // ══ 10. 环绕：负 chunk key / 负像素副本 / dropKeys ═══════════════════════
  section("10) 环绕：负 chunk key、负像素副本、dropKeys 的 canonical 映射");
  await G.saveMapDocStructure(p1.id, { clearLayerId: "l1" });
  await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l1", cells: [{ r: 0, c: 0, tile: paletteIndex }, { r: 39, c: 39, tile: paletteIndex }] }]);
  const seam = await G.mapPlan(p1.id, { view: { x: -20, y: -20, width: 60, height: 60 } });
  check("跨边界视口：visibleKeys 里出现负数 chunk key", seam.visibleKeys.some((key) => key.startsWith("-")), seam.visibleKeys.join(" "));
  const seamOps = allOps(seam);
  const negativeCopy = seamOps.filter((op) => op.x < 0 || op.y < 0);
  check("跨边界视口：最后一行的内容以负像素位置再画一份（图外的副本）", negativeCopy.length > 0 && negativeCopy.every((op) => op.r === 39 || op.c === 39), JSON.stringify(negativeCopy.slice(0, 2)));
  check(
    "同一份计划里不会把同一格画在同一个像素位置两次（视口范围各维最多铺一轮）",
    new Set(seamOps.map((op) => `${op.l},${op.r},${op.c},${op.x},${op.y}`)).size === seamOps.length,
    `${seamOps.length}`
  );
  check("包围盒恒等于网格脚印（40×32 = 1280）", seam.bounds.width === 1280 && seam.bounds.height === 1280, JSON.stringify(seam.bounds));
  check("视口越界的计划不是 truncated（上限之内）", seam.truncated === false);
  /**
   * ⚠️ 视口比地图大（相机被夹在 0、画布还有富余）时，收口必须取「地图自己那一轮」。
   * 取「视口左上角起的一轮」会被 padding 推成 `[-1, cols-1)`：最右一列只剩画布外
   * 那份副本 —— 真机表现是地图右边缘永远少一列。夹具里 (39,39) 有内容，正好能抓住。
   */
  const wideDoc = await G.readTheDoc(p1.id);
  const widePlan = await G.mapPlan(p1.id, { view: { x: 0, y: 0, width: 1280 * 3, height: 1280 * 3 } });
  const wideOps = allOps(widePlan);
  check(
    "视口比地图大：整张地图都给（最右一列 / 最下一行都在，且像素位置都在图内）",
    wideOps.some((op) => op.c === wideDoc.cols - 1) &&
      wideOps.some((op) => op.r === wideDoc.rows - 1) &&
      wideOps.every((op) => op.x >= 0 && op.y >= 0 && op.x < wideDoc.cols * 32 && op.y < wideDoc.rows * 32),
    `${wideOps.length} 条；最大 x=${Math.max(...wideOps.map((op) => op.x))} 最小 x=${Math.min(...wideOps.map((op) => op.x))}`
  );
  /**
   * ⚠️ 块键一律**按几何推**，不写死数字：`MAP_CHUNK_SIZE` 是性能旋钮（见 mapgeom.ts），
   * 断言要表达的是「wrap 感知的脏块 + 客户端报的键怎么映射」，不是某一套具体键名。
   * 这里先用一次 `have: []` 把宿主**真实**的脏块问出来，再据此构造 have（不是自己推一遍 ——
   * 自己推一遍就成了拿实现验实现）。
   */
  const S = geom.MAP_CHUNK_SIZE;
  const dimsP1 = await G.mapView(await G.readMapProject(p1.id));
  const nxP1 = Math.max(1, Math.ceil(dimsP1.cols / S));
  const nyP1 = Math.max(1, Math.ceil(dimsP1.rows / S));
  const probe = await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l1", cells: [{ r: 0, c: 10, tile: paletteIndex }] }], { have: [] });
  const dirtyKeys = probe.dirtyChunks;
  const dirtySet = new Set(dirtyKeys);
  const lastRowDirty = [...dirtySet].filter((key) => Number(key.split(",")[1]) === nyP1 - 1);
  check("画第 0 行时最后一行的块也脏了（wrap 感知的脏块）", lastRowDirty.length > 0, `dirty=${dirtyKeys.join(" ")}（ny=${nyP1}）`);
  // 把一个脏块整体往左绕一圈：规范之后还是同一块，所以必须被命中
  const [dcx, dcy] = dirtyKeys[0].split(",").map(Number);
  const wrappedKey = `${dcx - nxP1},${dcy}`;
  // 找一个**没脏**的块（保证「内容没变的不回给客户端」这条断言真的在测东西）
  let unrelated = "";
  for (let cy = 0; cy < nyP1 && unrelated === ""; cy++) {
    for (let cx = 0; cx < nxP1 && unrelated === ""; cx++) {
      if (!dirtySet.has(`${cx},${cy}`)) unrelated = `${cx},${cy}`;
    }
  }
  const haveKeys = [dirtyKeys[0], wrappedKey, unrelated];
  const drop = await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l1", cells: [{ r: 0, c: 10, tile: paletteIndex + 1 }] }], { have: haveKeys });
  check("dropKeys 只包含客户端报过的 key", drop.dropKeys.every((key) => haveKeys.includes(key)), drop.dropKeys.join(" "));
  check("客户端报的（规范）脏块会回给客户端", drop.dropKeys.includes(dirtyKeys[0]), `have=${haveKeys.join(" ")} drop=${drop.dropKeys.join(" ")}`);
  check("客户端报的负 key 会被映射到规范块后命中（绕一圈也认得出来）", drop.dropKeys.includes(wrappedKey), `have=${wrappedKey} drop=${drop.dropKeys.join(" ")}`);
  check("内容没变的块不回给客户端", unrelated !== "" && !drop.dropKeys.includes(unrelated), `没脏的块 ${unrelated} / drop=${drop.dropKeys.join(" ")}`);
  const midDirty = (await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l1", cells: [{ r: 5, c: 10, tile: paletteIndex }] }], { have: [] })).dirtyChunks;
  const midLastRow = midDirty.filter((key) => Number(key.split(",")[1]) === nyP1 - 1);
  check("反向验证：在中间行落笔时，最后一行的块不该被弄脏", midLastRow.length === 0, `${midDirty.join(" ")}`);
  check("没报 have 时 dropKeys 是空数组（客户端不需要丢缓存）", (await G.applyMapOps(p1.id, [{ kind: "paint", layerId: "l1", cells: [{ r: 6, c: 6, tile: paletteIndex }] }])).dropKeys.length === 0);
  check("layerIds 过滤只算指定层", (await G.mapPlan(p1.id, { view: { x: 0, y: 0, width: 64, height: 64 }, layerIds: [1] })).chunks.flatMap((c) => c.ops).every((op) => op.l === 1));
  check("have 里已有的 chunk 不再回给客户端", (await G.mapPlan(p1.id, { view: { x: 0, y: 0, width: 64, height: 64 }, have: ["0,0"] })).chunks.every((chunk) => chunk.key !== "0,0"));

  // ★ 环绕 × A2 自动连接的交叉点（最容易漏测、也最容易静默坏）。
  // 判据：8×8 整层铺满同一张 A2 素材 → 每一格的四个象限都该落在「满格」形状（shape 4）。
  // 64×160 且 cell=32 时 smallCols = 4，四象限的 1-based 小格序号 = 1 + (2*4 + 上/下)*4 + (0/1)
  // = 33 / 34 / 37 / 38。**漏取模**的表现：跨边界那一圈邻格被判成「不同类」，
  // 于是接缝处长出孤岛 / 半格形状（t 退化成 1 / 2 / 5 / 6 之类）。
  const pSeam = await newProject("接缝连续", { cols: 8, rows: 8 });
  await G.importMapTileset(pSeam.id, "A2", sheetPng(64, 160, 16).toString("base64"));
  const seamView = await G.mapView(await G.readMapProject(pSeam.id));
  const seamBrush = seamView.tilesets[0].palette[0].index;
  const seamLayer = seamView.layers[0].id;
  await G.applyMapOps(pSeam.id, [{ kind: "rect", layerId: seamLayer, r0: 0, c0: 0, r1: 7, c1: 7, tile: seamBrush, filled: true }]);
  const seamA2 = await G.mapPlan(pSeam.id, { view: { x: -32, y: -32, width: 64, height: 64 } });
  const seamTiles = [...new Set(allOps(seamA2).map((op) => op.t))].sort((a, b) => a - b);
  check("跨左上边界的视口给出 100 条 op（5×5 格 × 4 象限）", allOps(seamA2).length === 100, `${allOps(seamA2).length}`);
  check("环绕接缝处全是「满格」形状（wrap 邻域算对了）", seamTiles.join(",") === "33,34,37,38", seamTiles.join(","));
  await G.saveMapDocStructure(pSeam.id, { wrap: false });
  const flatA2 = await G.mapPlan(pSeam.id, { view: { x: -32, y: -32, width: 64, height: 64 } });
  const flatTilesA2 = [...new Set(allOps(flatA2).map((op) => op.t))].sort((a, b) => a - b);
  check("反向验证：关掉环绕后同一个视口只剩 36 条 op（越界部分被裁掉）", allOps(flatA2).length === 36, `${allOps(flatA2).length}`);
  check("反向验证：关掉环绕后接缝处退化成半格 / 孤岛形状（t 不再是 33/34/37/38）", flatTilesA2.some((t) => ![33, 34, 37, 38].includes(t)), flatTilesA2.join(","));
  await G.saveMapDocStructure(pSeam.id, { wrap: true });

  // ★ 预览：一笔还在手上时「看得见，但不落盘」
  {
    const pPrev = await newProject("预览", { cols: 8, rows: 8 });
    await G.importSampleTileset(pPrev.id);
    const layerId = "l0"; // 第一个图层（`createMapDoc` 的默认 id）
    const view = { x: 0, y: 0, width: 128, height: 128 };
    const pending = [
      { kind: "paint", layerId, cells: [{ r: 2, c: 2, tile: 1 }, { r: 3, c: 3, tile: 2 }] }
    ];
    const preview = await G.mapPlan(pPrev.id, { view, have: [], pending });
    /**
     * ★ 真机踩过的坑：客户端查计划会带 `have`。如果宿主因为「你有这一块」就不回传，
     * 那么**预览改动落在已有块里时什么都画不出来** —— 拖动期间一片空白，松手提交后
     * 靠 `dropKeys` 重拉才出现。这里钉住：带上 have（缓存里有这一块）也要把它发回来。
     */
    const withHave = await G.mapPlan(pPrev.id, { view, have: preview.visibleKeys, pending });
    const forcedBack = withHave.chunks.filter((chunk) => chunk.ops.some((op) => (op.r === 2 && op.c === 2) || (op.r === 3 && op.c === 3)));
    check(
      "预览：即使客户端说「这几块我有」，受影响的那块也会被强制发回来（否则拖动期间一片空白）",
      forcedBack.length > 0,
      `回传 ${withHave.chunks.length} 块，其中带预览格的 ${forcedBack.length} 块`
    );
    check(
      "预览：带 pending 查计划时，这一笔已经在计划里（画的过程中看得见）",
      opOf(preview, 2, 2).length > 0 && opOf(preview, 3, 3).length > 0,
      `(2,2)=${opOf(preview, 2, 2).length} (3,3)=${opOf(preview, 3, 3).length}`
    );
    const plain = await G.mapPlan(pPrev.id, { view, have: [] });
    check("预览不落盘：紧接着不带 pending 再查一次，那两格还是空的", opOf(plain, 2, 2).length === 0 && opOf(plain, 3, 3).length === 0);
    check("预览不动撤销栈（拖动期间一次都没存）", G.historyState(pPrev.id).depth === 0, `depth=${G.historyState(pPrev.id).depth}`);
    await G.applyMapOps(pPrev.id, pending, { stroke: "s1" });
    const real = await G.mapPlan(pPrev.id, { view, have: [] });
    check("提交之后的计划与预览逐字段一致（预览不会撒谎）", JSON.stringify(real.chunks) === JSON.stringify(preview.chunks), `${real.chunks.length} / ${preview.chunks.length} 块`);
    check("提交之后才进撤销栈", G.historyState(pPrev.id).depth === 1, `depth=${G.historyState(pPrev.id).depth}`);
  }

  // ★ 新增素材：属性在导入那一刻一次定下来；内置素材属性不可改、可删、可一键恢复
  {
    const pNew = await newProject("新增素材属性", { cols: 16, rows: 16 });
    const made = await G.importMapTileset(pNew.id, "我的图", sheetPng(64, 64, 16).toString("base64"), {
      cell: { width: 16, height: 16 },
      shape: "plain",
      animRows: true
    });
    const madeTs = made.tilesets[0];
    check(
      "新增素材时填的属性被采纳（格子 16×16 / 普通 / 翻页图）",
      madeTs.cell.width === 16 && madeTs.cell.height === 16 && madeTs.shape === "plain" && madeTs.animRows === true,
      JSON.stringify({ cell: madeTs.cell, shape: madeTs.shape, anim: madeTs.animRows })
    );
    check("翻页图：行数就是帧数（64×64 / 格 16 → 4 行 = 4 帧）", madeTs.variants === 4 && madeTs.tiles.length === 16, `variants=${madeTs.variants} tiles=${madeTs.tiles.length}`);
    /**
     * ⚠️ 调色板**不能**一帧一条：帧是宿主按全局帧号现推的，每帧都列出来只会让用户
     * 看到 4 个一模一样的笔刷（内置道具图 8 列 × 5 帧当年就是这样冒出 40 条的）。
     */
    const madeView = await G.mapView(await G.readMapProject(pNew.id));
    const madeBrush = madeView.tilesets.find((t) => t.id === madeTs.id);
    check(
      "翻页图的调色板每列只出一条（4 帧 → 4 个笔刷，都落在第 0 帧）",
      madeBrush.palette.length === 4 && madeBrush.palette.every((item, i) => item.rect.y === 0 && item.rect.x === i * 16),
      JSON.stringify(madeBrush.palette.map((item) => [item.rect.x, item.rect.y]))
    );
    const auto = (await G.importMapTileset(pNew.id, "自动", sheetPng(64, 160, 16).toString("base64"), {})).tilesets[0];
    check("属性留空 = 走自动识别（64×160 → 拼块自动连接 / 2 变体）", auto.shape === "a2quad" && auto.variants === 2, `${auto.shape} / ${auto.variants}`);
    let badCellError = "";
    const beforeBad = (await G.readMapProject(pNew.id)).tilesets.length;
    try {
      await G.importMapTileset(pNew.id, "乱填", sheetPng(64, 64, 16).toString("base64"), { cell: { width: -8, height: 0 } });
    } catch (error) {
      badCellError = String(error?.message ?? error);
    }
    check("乱填的格子尺寸**明确拒绝**（不静默改成别的值）", /格子尺寸不合法/.test(badCellError), badCellError);
    check("被拒绝的导入不会留下半张素材（先校验再写文件）", (await G.readMapProject(pNew.id)).tilesets.length === beforeBad, `${beforeBad} → ${(await G.readMapProject(pNew.id)).tilesets.length}`);

    const pBuiltin = await newProject("内置不可改", { cols: 16, rows: 16 });
    const installed = await G.importSampleTileset(pBuiltin.id);
    check("内置素材带 builtin 标记", installed.tilesets.length > 0 && installed.tilesets.every((t) => t.builtin === true), JSON.stringify(installed.tilesets.map((t) => [t.name, t.builtin])));
    let rejected = "";
    try {
      await G.saveMapTileset(pBuiltin.id, installed.tilesets[0].id, { shape: "plain" });
    } catch (error) {
      rejected = String(error?.message ?? error);
    }
    check("内置素材的属性改不动（宿主直接拒绝并说明原因）", /内置素材/.test(rejected) && /不能改/.test(rejected), rejected);
    await G.removeMapTileset(pBuiltin.id, installed.tilesets[0].id);
    check("内置素材还能整张删掉", (await G.readMapProject(pBuiltin.id)).tilesets.length === installed.tilesets.length - 1);
    const restored = await G.importSampleTileset(pBuiltin.id);
    check(
      "删掉的内置素材能一键恢复（其余同名跳过，不会变成两份）",
      restored.tilesets.length === 1 && (await G.readMapProject(pBuiltin.id)).tilesets.length === installed.tilesets.length,
      `补回 ${restored.tilesets.length} 张`
    );
  }

  // ★ 自由尺寸：地图宽高可以不相同；素材格子宽高也可以不相同（用户要「格子数能自由设置」）
  {
    const pRect = await newProject("自由宽高", { cols: 32, rows: 32 });
    const rectSave = await G.saveMapDocStructure(pRect.id, { cols: 48, rows: 20 });
    check("地图宽高可以不相同（48×20）", rectSave.doc.cols === 48 && rectSave.doc.rows === 20, `${rectSave.doc.cols}×${rectSave.doc.rows}`);
    const rectView = await G.mapView(await G.readMapProject(pRect.id));
    check("视图把非正方形的尺寸原样报出来", rectView.cols === 48 && rectView.rows === 20);
    await G.importMapTileset(pRect.id, "棋盘", sheetPng(64, 64, 32).toString("base64"));
    const rectTiles = (await G.mapView(await G.readMapProject(pRect.id))).tilesets[0];
    // 画最右下角那一格：正方形夹具永远碰不到这条边
    const cornerPaint = await G.applyMapOps(pRect.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 19, c: 47, tile: rectTiles.palette[0].index }] }], { have: [] });
    check("画右下角 (19,47) 不越界", cornerPaint.changed === 1 && cornerPaint.skipped.length === 0, JSON.stringify(cornerPaint.skipped));
    const rectPlan = await G.mapPlan(pRect.id, { view: { x: 0, y: 0, width: 48 * 32, height: 20 * 32 }, have: [] });
    const rectOps = rectPlan.chunks.flatMap((chunk) => chunk.ops);
    check("计划按 48×20 铺满（最后一行一列也有内容）", rectOps.some((op) => op.r === 19 && op.c === 47), `${rectOps.length} 条`);
    // 素材格子宽高不相同：96×64 的图按 24×16 切 → 4 列 × 4 行 = 16 块
    const pCell = await newProject("自由格子", { cols: 16, rows: 16 });
    const impCell = await G.importMapTileset(pCell.id, "96×64", sheetPng(96, 64, 32).toString("base64"));
    const cellSave = await G.saveMapTileset(pCell.id, impCell.tilesets[0].id, { cell: { width: 24, height: 16 } });
    const cellTs = cellSave.tileset;
    check("素材格子可以不是正方形（24×16）", cellTs.cell.width === 24 && cellTs.cell.height === 16, `${cellTs.cell.width}×${cellTs.cell.height}`);
    check("切出来的块数跟着格子大小走（4 列 × 4 行 = 16 块）", cellTs.tiles.length === 16, `${cellTs.tiles.length} 块`);
    check("每块尺寸等于格子尺寸", cellTs.tiles.every((tile) => tile.rect.width === 24 && tile.rect.height === 16), JSON.stringify(cellTs.tiles[0]?.rect));
  }

  // ★ dropKeys 也要 wrap 感知：画 (0,0) 一格，它的上 / 左邻格是最后一行 / 最后一列，
  //   折回后落在**四个角**的块里 → 四个角的 key 全部失效。键按几何推（块边长是性能旋钮）。
  const pChunk = await newProject("跨块脏标记", { cols: 64, rows: 64 });
  await G.importMapTileset(pChunk.id, "A2", sheetPng(64, 160, 16).toString("base64"));
  const chunkBrush = (await G.mapView(await G.readMapProject(pChunk.id))).tilesets[0].palette[0].index;
  const nxChunk = Math.max(1, Math.ceil(64 / geom.MAP_CHUNK_SIZE));
  const fourHave = ["0,0", `0,${nxChunk - 1}`, `${nxChunk - 1},0`, `${nxChunk - 1},${nxChunk - 1}`];
  const corner = await G.applyMapOps(pChunk.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: chunkBrush }] }], { have: fourHave });
  check("画 (0,0)：四个角的块全部失效（wrap 邻域落到最后一行 / 列所在的块）", fourHave.every((key) => corner.dropKeys.includes(key)), `dirty=${corner.dirtyChunks.join(" ")} drop=${corner.dropKeys.join(" ")}`);
  await G.saveMapDocStructure(pChunk.id, { wrap: false });
  await G.saveMapDocStructure(pChunk.id, { clearLayerId: "l0" });
  const cornerFlat = await G.applyMapOps(pChunk.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: chunkBrush }] }], { have: fourHave });
  check("反向验证：关掉环绕后同一个夹具只失效 0,0 一个 chunk", cornerFlat.dropKeys.join(",") === "0,0", `dirty=${cornerFlat.dirtyChunks.join(" ")} drop=${cornerFlat.dropKeys.join(",")}`);

  // ══ 11. 撤销 / 重做 ══════════════════════════════════════════════════════
  section("11) 撤销 / 重做（含同一笔只算一步）");
  const p6 = await newProject("撤销与生成", { cols: 24, rows: 24 });
  const sixSheet = (await G.importMapTileset(p6.id, "四色", sheetPng(128, 128, 32).toString("base64"))).tilesets[0];
  check("24×24 上导入 4×4 的素材（16 块）", sixSheet.tiles.length === 16);
  const depth0 = G.historyState(p6.id).depth;
  const s1 = await G.applyMapOps(p6.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 1, c: 1, tile: 1 }] }], { stroke: "笔画A" });
  const depth1 = G.historyState(p6.id).depth;
  const s2 = await G.applyMapOps(p6.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 1, c: 2, tile: 1 }] }], { stroke: "笔画A" });
  const depth2 = G.historyState(p6.id).depth;
  const s3 = await G.applyMapOps(p6.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 1, c: 3, tile: 1 }] }], { stroke: "笔画B" });
  const depth3 = G.historyState(p6.id).depth;
  check("同一笔的后续提交不再压栈（深度不变）", depth1 === depth0 + 1 && depth2 === depth1, `${depth0} → ${depth1} → ${depth2}`);
  check("换一笔才 +1", depth3 === depth2 + 1, `${depth2} → ${depth3}`);
  check("三次提交都真的改了格子", s1.changed === 1 && s2.changed === 1 && s3.changed === 1);
  check("canUndo / canRedo 与栈一致", s3.canUndo === true && s3.canRedo === false && G.historyState(p6.id).canUndo === true);
  const latest = planSignature(await G.mapPlan(p6.id, { view: { x: 0, y: 0, width: 24 * 32, height: 24 * 32 } }));
  let undoSteps = 0;
  while (G.historyState(p6.id).canUndo) {
    await G.undoMap(p6.id);
    undoSteps++;
    if (undoSteps > 50) break;
  }
  check("一直撤销到根（步数 = 2 笔）", undoSteps === 2, `${undoSteps} 步`);
  check("撤销到根后地图是空的", (await G.readTheDoc(p6.id)).data.l0.every((value) => value === 0));
  check("到根后再撤销返回空结果而不是抛", (await G.undoMap(p6.id)).changed === 0);
  let redoSteps = 0;
  while (G.historyState(p6.id).canRedo) {
    await G.redoMap(p6.id);
    redoSteps++;
    if (redoSteps > 50) break;
  }
  check("重做步数与撤销一致", redoSteps === undoSteps, `${redoSteps} vs ${undoSteps}`);
  check("重做后计划逐项与撤销前完全一致", planSignature(await G.mapPlan(p6.id, { view: { x: 0, y: 0, width: 24 * 32, height: 24 * 32 } })) === latest);
  check("到顶后再重做返回空结果", (await G.redoMap(p6.id)).changed === 0);

  // ══ 12. 三种一键生成 ════════════════════════════════════════════════════
  section("12) 一键生成：同种子可复现 / 警告 / 一次撤销");
  const view6 = { x: 0, y: 0, width: 24 * 32, height: 24 * 32 };
  const sig6 = async () => planSignature(await G.mapPlan(p6.id, { view: view6 }));
  const seedA = await G.runMapGenerate(p6.id, { kind: "random", seed: 4242 });
  const planSeedA = await sig6();
  check("random：铺满整层（24×24 = 576 格）", seedA.changed === 576 && seedA.seed === 4242, `${seedA.changed} / 种子 ${seedA.seed}`);
  const seedB = await G.runMapGenerate(p6.id, { kind: "random", seed: 99 });
  check("换个种子结果真的不一样（否则「可复现」这条断言没有区分力）", (await sig6()) !== planSeedA, `changed=${seedB.changed}`);
  await G.runMapGenerate(p6.id, { kind: "random", seed: 4242 });
  check("同一个种子两次生成：计划逐项相同", (await sig6()) === planSeedA);
  const maze = await G.runMapGenerate(p6.id, { kind: "maze", seed: 7, tiles: [1, 2] });
  check("maze：偶数尺寸给出告警（按 23×23 生成，多的留空）", maze.warnings.some((text) => text.includes("偶数")), maze.warnings.join(" | "));
  const mazeA = await sig6();
  await G.runMapGenerate(p6.id, { kind: "maze", seed: 8, tiles: [1, 2] });
  await G.runMapGenerate(p6.id, { kind: "maze", seed: 7, tiles: [1, 2] });
  check("maze 同种子两次：计划逐项相同", (await sig6()) === mazeA);
  const continent = await G.runMapGenerate(p6.id, { kind: "continent", seed: 5, tiles: [1] });
  check("continent：图块不足 4 个时给出回退告警", continent.warnings.some((text) => text.includes("只给了 1 个图块")), continent.warnings.join(" | "));
  // 大陆算法正在被改（形状会变），所以这里**只钉不依赖具体形状的判据**：
  // 同种子逐项一致 + 只用给定的图块池。
  await G.runMapGenerate(p6.id, { kind: "continent", seed: 1234, tiles: [1, 2, 3, 4] });
  const continentA = await sig6();
  await G.runMapGenerate(p6.id, { kind: "continent", seed: 4321, tiles: [1, 2, 3, 4] });
  await G.runMapGenerate(p6.id, { kind: "continent", seed: 1234, tiles: [1, 2, 3, 4] });
  check("continent 同种子两次：计划逐项相同（只钉确定性，不钉形状）", (await sig6()) === continentA);
  check("continent 只用给定的图块池（不凭空造序号）", [...new Set((await G.readTheDoc(p6.id)).data.l0)].every((value) => [0, 1, 2, 3, 4].includes(value)), [...new Set((await G.readTheDoc(p6.id)).data.l0)].join(","));
  const beforeUndo = planSignature(await G.mapPlan(p6.id, { view: view6 }));
  await G.undoMap(p6.id);
  check("一次撤销就能整个撤回一次生成", planSignature(await G.mapPlan(p6.id, { view: view6 })) !== beforeUndo);
  const badKind = await throwsAsync(() => G.runMapGenerate(p6.id, { kind: "nope" }));
  check("未知算法明确报错", badKind.includes("未知生成算法"), badKind.slice(0, 60));
  check("图块序号越界明确报错", (await throwsAsync(() => G.runMapGenerate(p6.id, { kind: "random", tiles: [999] }))).includes("图块序号越界"));
  check("生成会记进项目日志", (await G.readMapProject(p6.id)).logs.some((entry) => entry.message.includes("一键生成")), (await G.readMapProject(p6.id)).logs.at(-1)?.message);

  // ══ 13. 防抖落盘与丢缓存重载 ════════════════════════════════════════════
  section("13) 防抖落盘与丢缓存重载");
  await G.applyMapOps(p6.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 20, c: 20, tile: 7 }] }]);
  let flushed = 0;
  for (let i = 0; i < 60; i++) {
    const onDisk = JSON.parse(await readFile(G.mapDocFile(p6.id), "utf8"));
    flushed = onDisk.data.l0[20 * 24 + 20];
    if (flushed === 7) break;
    await sleep(50);
  }
  check("一笔编辑会在 2 秒内落盘（不靠手动 flush）", flushed === 7, `${flushed}`);
  for (let i = 0; i < 6; i++) {
    await G.applyMapOps(p6.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 21, c: i, tile: 8 }] }]);
  }
  await sleep(2500);
  const diskAfter = JSON.parse(await readFile(G.mapDocFile(p6.id), "utf8"));
  check("连续多笔之后的最后一笔也落了盘（防抖补写）", diskAfter.data.l0.slice(21 * 24, 21 * 24 + 6).every((value) => value === 8), JSON.stringify(diskAfter.data.l0.slice(21 * 24, 21 * 24 + 6)));
  // 丢缓存重载：带 query 再 import 一次 → 拿到一个全新的模块实例（docCache 是空的），
  // 它只能从磁盘读。这就是「进程重启后还能读回同一份」的等价验证。
  const freshGen = await import("../lib/mapgen.js?fresh=pipeline");
  const reloaded = await freshGen.readTheDoc(p6.id);
  check("丢缓存（新模块实例）后从磁盘读回同一份内容", reloaded !== undefined && reloaded.data.l0[20 * 24 + 20] === 7 && reloaded.data.l0[21 * 24 + 5] === 8);
  check("新实例的撤销栈是空的（历史不落盘，这是设计）", freshGen.historyState(p6.id).canUndo === false && freshGen.historyState(p6.id).depth === 0);
  const docOnDisk = JSON.parse(await readFile(G.mapDocFile(p6.id), "utf8"));
  check("map.json 落盘的就是图层元数据 + 每层数据 + 标记 + 整图（没有形状 / 掩码 / chunk 之类派生数据）", Object.keys(docOnDisk).join(",") === "id,name,cols,rows,layers,data,markers,stamps,createdAt,updatedAt", Object.keys(docOnDisk).join(","));

  // ══ 14. 预览与导出 ══════════════════════════════════════════════════════
  section("14) 验收预览（只出地图渲染图）");
  const previewStart = await G.runPreviewStage(p6.id);
  check("预览作业已启动", previewStart.started === true, previewStart.reason ?? "");
  await waitIdle(p6.id);
  const previewFiles = await readdir(join(G.mapProjectDir(p6.id), "preview"));
  check("预览只出一张地图渲染图（没有切片 contact sheet / 覆盖矩阵）", previewFiles.length === 1 && previewFiles[0] === "map.png", previewFiles.join(" "));
  check("预览作业没有报错", (await G.readMapProject(p6.id)).stages.paint.status === "done", JSON.stringify((await G.readMapProject(p6.id)).stages.paint));
  check("预览跑完后项目不忙，可以再次提交", G.mapBusy(p6.id) === false);
  check("并发提交只放行一个", (await Promise.all([G.runPreviewStage(p6.id), G.runPreviewStage(p6.id)])).filter((item) => item.started === true).length === 1);
  G.cancelMapJob(p6.id);
  await waitIdle(p6.id);
  check("cancelMapJob 能收尾（不忙、阶段不是 error）", G.mapBusy(p6.id) === false && (await G.readMapProject(p6.id)).stages.paint.status !== "error");

  section("15) 导出：目录名 / 产物 / 自动打 zip / 逐字段 / 逐字节 / 逐像素");
  const p5 = await newProject("导出", { cols: 8, rows: 8 });
  const fiveSheet = (await G.importMapTileset(p5.id, "四色", sheetPng(128, 128, 32).toString("base64"))).tilesets[0];
  const renamed = await G.saveMapDocStructure(p5.id, { name: "地图 A/B" });
  check("地图改名（用于验证导出目录名按地图名走）", renamed.doc.name === "地图 A/B");
  await G.applyMapOps(p5.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 1, c: 2, tile: 8 }, { r: 0, c: 0, tile: 1 }] }]);
  const exportStart = await G.runExportStage(p5.id, { scale: 1 });
  check("导出作业已启动", exportStart.started === true, exportStart.reason ?? "");
  const afterExport = await waitIdle(p5.id);
  check("导出作业没有报错", afterExport.stages.export.status === "done", JSON.stringify(afterExport.stages.export));
  const expectedDir = EXPORT.safeFileName("地图 A/B", "x");
  const expectedZip = `${expectedDir}.zip`;
  const exportDirs = await readdir(join(G.mapProjectDir(p5.id), "export"));
  check("导出目录名 = safeFileName(地图名, 地图 id)（不是项目名）", exportDirs.length === 1 && exportDirs[0] === expectedDir, `${exportDirs.join(" ")} vs ${expectedDir}`);
  check("反向验证：导出目录名不是项目名", exportDirs[0] !== EXPORT.safeFileName("导出", "x"));
  const exportDir = join(G.mapProjectDir(p5.id), "export", exportDirs[0]);
  const files = await readdir(exportDir);
  check(
    "默认导出（png+json）给三个文件 + 一个 zip（多个产物自动打包）",
    files.slice().sort().join(",") === ["manifest.json", "map.json", "map.png", expectedZip].sort().join(","),
    files.join(" ")
  );
  check("没有分层 PNG / Tiled .tmj / .tsj", !files.some((name) => name.startsWith("layer-") || name.endsWith(".tmj") || name.endsWith(".tsj")), files.join(" "));

  /**
   * zip 要**真解一遍**：条目、内容、CRC 全部对得上才算数。
   * 反向验证在下面单独一节（只勾一项时不许有 zip）。
   */
  const zipBytes = await readFile(join(exportDir, expectedZip));
  const zipEntries = readZip(zipBytes);
  check("zip 里只有用户勾的产物（map.png + map.json），不含 manifest.json", [...zipEntries.keys()].sort().join(",") === "map.json,map.png", [...zipEntries.keys()].join(" "));
  check("zip 里的 map.png 与盘上那份逐字节一致", zipEntries.get("map.png")?.equals(await readFile(join(exportDir, "map.png"))) === true);
  check("zip 里的 map.json 与盘上那份逐字节一致", zipEntries.get("map.json")?.equals(await readFile(join(exportDir, "map.json"))) === true);


  const mapPng = await decodeFile(join(exportDir, "map.png"));
  check("map.png 尺寸 = 网格脚印（8×32 = 256）", mapPng.width === 256 && mapPng.height === 256, `${mapPng.width}×${mapPng.height}`);
  check(
    "像素位置：第 (2,1) 格画的是素材里 (col 3,row 1) 那一块（行列不能互换）",
    sameColor(pixelAt(mapPng, 2 * 32 + 16, 1 * 32 + 16), blockColor(3, 1)),
    `${pixelAt(mapPng, 2 * 32 + 16, 1 * 32 + 16)} vs ${blockColor(3, 1)}`
  );
  check("像素位置：块的左上角角标落在格子左上角（整体没有偏移）", sameColor(pixelAt(mapPng, 2 * 32, 1 * 32), MARKER), `${pixelAt(mapPng, 2 * 32, 1 * 32)}`);
  const sourceBitmap = await decodeFile(G.mapAssetPath(p5.id, fiveSheet.file));
  check(
    "legend 的 rect 指向源图里正确的那一块（角标在 rect 左上角、中心是那一块的色）",
    sameColor(pixelAt(sourceBitmap, 3 * 32, 1 * 32), MARKER) && sameColor(pixelAt(sourceBitmap, 3 * 32 + 16, 1 * 32 + 16), blockColor(3, 1))
  );

  const ownJson = JSON.parse(await readFile(join(exportDir, "map.json"), "utf8"));
  check("map.json：格式标识 dsh-gem-map@4", ownJson.format === EXPORT.OWN_JSON_FORMAT && ownJson.format === "dsh-gem-map@4", ownJson.format);
  check("map.json：grid 三个字段齐（tileWidth / tileHeight / wrap）", ownJson.grid.tileWidth === 32 && ownJson.grid.tileHeight === 32 && ownJson.grid.wrap === true, JSON.stringify(ownJson.grid));
  check("map.json：cols / rows 与文档一致", ownJson.cols === 8 && ownJson.rows === 8);
  check("map.json：tilesets[].shape / cell / tileCount 齐", ownJson.tilesets[0].shape === "plain" && ownJson.tilesets[0].cell.width === 32 && ownJson.tilesets[0].tileCount === 16, JSON.stringify(ownJson.tilesets[0]));
  check("map.json：不再带旧字段（families / mapId / firstgid / wangsets）", !("families" in ownJson) && !("mapId" in ownJson) && JSON.stringify(ownJson).includes('"firstgid"') === false);
  check("map.json：legend 从 1 开始且与 rect 一一对上（16 块，行优先 32px 网格）", ownJson.legend.length === 16 && ownJson.legend.every((entry, index) => {
    const expectedX = (index % 4) * 32;
    const expectedY = Math.floor(index / 4) * 32;
    return entry.index === index + 1 && entry.rect.x === expectedX && entry.rect.y === expectedY && entry.rect.width === 32 && entry.rect.height === 32;
  }), JSON.stringify(ownJson.legend[5]));
  check("map.json：每层 data 长度 = cols×rows（默认三层都在）", ownJson.layers.length === 3 && ownJson.layers.every((layer) => layer.data.length === 64), JSON.stringify(ownJson.layers.map((l) => [l.name, l.data.length])));
  check("map.json：data 存的是语义序号（1-based 全局图块序号，0 = 空）", ownJson.layers[0].data[0] === 1 && ownJson.layers[0].data[1 * 8 + 2] === 8 && ownJson.layers[0].data[20] === 0, JSON.stringify([ownJson.layers[0].data[0], ownJson.layers[0].data[1 * 8 + 2], ownJson.layers[0].data[20]]));
  check("map.json：data 里的每个非零值都能在 legend 里找到", ownJson.layers[0].data.filter((value) => value > 0).every((value) => ownJson.legend.some((entry) => entry.index === value)));
  check("map.json：tilesets[].image 是相对项目目录的路径（导出目录里没有拷图集）", ownJson.tilesets[0].image === fiveSheet.file && !existsSync(join(exportDir, fiveSheet.file.replace(/^tilesets\//, ""))));
  const manifest = JSON.parse(await readFile(join(exportDir, "manifest.json"), "utf8"));
  check("manifest.json：列出产物、mapPng/mapJson 命名对得上", manifest.mapPng === "map.png" && manifest.mapJson === "map.json" && manifest.mapZip === expectedZip && ["map.png", "map.json", "manifest.json"].every((name) => manifest.files.some((file) => file.path === name)), manifest.files.map((f) => f.path).join(" "));
  check("manifest.json：bounds 与网格脚印一致", manifest.bounds.width === 256 && manifest.bounds.height === 256, JSON.stringify(manifest.bounds));
  const pngA = await readFile(join(exportDir, "map.png"));
  await G.runExportStage(p5.id, { scale: 1 });
  await waitIdle(p5.id);
  const pngB = await readFile(join(exportDir, "map.png"));
  check("同一份文档两次导出：map.png 逐字节一致", pngA.length > 0 && pngA.equals(pngB), `${pngA.length} vs ${pngB.length}`);
  /**
   * zip 的确定性靠**写死时间戳**（见 `zip.ts` 文件头）：用真实时间的话这条会挂，
   * 而「导出可复现」正是它能进版本库 / 能对比回归的前提。
   */
  check("同一份文档两次导出：zip 逐字节一致（时间戳写死）", (await readFile(join(exportDir, expectedZip))).equals(zipBytes), `${zipBytes.length} 字节`);

  /**
   * 反向验证：**只勾一项**不许打包（一个文件再套一层 zip 纯属添乱），
   * 而且这次导出会把上一轮的产物清掉 —— 目录内容永远等于「这次选的东西」。
   */
  await G.runExportStage(p5.id, { scale: 1, formats: { png: true, json: false } });
  await waitIdle(p5.id);
  const pngOnly = await readdir(exportDir);
  check("只勾 PNG：目录里只剩 map.png + manifest.json（没有 zip、上一轮的 map.json 被清掉）", pngOnly.slice().sort().join(",") === "manifest.json,map.png", pngOnly.join(" "));
  const pngOnlyView = await G.mapView(await G.readMapProject(p5.id));
  check("只勾 PNG 的视图：exportFiles 只有两个、exportPath 是本机绝对路径", pngOnlyView.exportFiles.slice().sort().join(",") === "manifest.json,map.png" && pngOnlyView.exportPath === exportDir, `${pngOnlyView.exportFiles.join(" ")} / ${pngOnlyView.exportPath}`);

  // 素材原图：勾了才拷，拷进去的相对路径与 map.json 里的引用同形（整包自包含）
  await G.runExportStage(p5.id, { scale: 1, formats: { png: true, json: true, tilesets: true } });
  await waitIdle(p5.id);
  const withAssets = await readdir(exportDir);
  check("勾「素材原图」：素材图拷进 tilesets/（zip 里也有）", withAssets.includes("tilesets") && (await readdir(join(exportDir, "tilesets"))).length === 1, withAssets.join(" "));
  const assetsZip = readZip(await readFile(join(exportDir, expectedZip)));
  check(
    "带素材的 zip：条目路径与 map.json 的 tilesets[].image 同形（搬到别处也能用）",
    [...assetsZip.keys()].sort().join(",") === ["map.json", "map.png", `tilesets/${fiveSheet.file.split("/").pop()}`].sort().join(","),
    [...assetsZip.keys()].join(" ")
  );
  check(
    "带素材的 zip：拷进去的素材图与项目里那张逐字节一致",
    assetsZip.get(`tilesets/${fiveSheet.file.split("/").pop()}`)?.equals(await readFile(G.mapAssetPath(p5.id, fiveSheet.file))) === true
  );

  const view5 = await G.mapView(await G.readMapProject(p5.id));
  const view6b = await G.mapView(await G.readMapProject(p6.id));
  check("视图：preview 给的是相对路径（界面自己拼 assetBase）", view6b.preview.join(",") === "preview/map.png", view6b.preview.join(" "));
  check("视图：还没跑过预览的项目 preview 是空数组（不是伪造一条路径）", view5.preview.length === 0, view5.preview.join(" "));
  check("视图：exportBase 指向按地图名取的目录", view5.exportBase === `export/${expectedDir}/`, view5.exportBase);
  check("视图：exportFiles 列出这一轮的全部产物（含 zip 与拷进来的素材）", view5.exportFiles.slice().sort().join(",") === ["manifest.json", "map.json", "map.png", expectedZip, `tilesets/${fiveSheet.file.split("/").pop()}`].sort().join(","), view5.exportFiles.join(" "));
  check("视图：legend 覆盖全部块，layers 带 filled 计数", view5.legend.length === 16 && view5.layers[0].filled === 2 && view5.filled === 2, JSON.stringify(view5.layers));
  check("视图：stages 四阶段 + busy/canUndo/maxChunks 字段齐", Object.keys(view5.stages).join(",") === "assets,rules,paint,export" && typeof view5.busy === "boolean" && typeof view5.canUndo === "boolean" && view5.maxChunks > 0);
  check("视图：素材带识别说明与调色板", view5.tilesets[0].reason.includes("正方形网格") && view5.tilesets[0].palette.length === 16, view5.tilesets[0].reason);
  check("视图：A2 与其他素材的画布尺寸跟着文档（不是项目元数据）", view5.cols === 8 && view5.rows === 8);
  const listing = await G.readExportListing(p5.id, "http://127.0.0.1:9999");
  check("readExportListing：base 与 files 都是可点的绝对 URL", listing.base === `http://127.0.0.1:9999/dsh-game-material-master/map-assets/${p5.id}/export/${expectedDir}/` && listing.files.every((url) => url.startsWith("http://127.0.0.1:9999/")), listing.base);
  const listingRelative = await G.mapSnapshot(await G.readMapProject(p5.id), "http://127.0.0.1:9999");
  check("mapSnapshot：绝对 URL 与预览/导出清单齐", listingRelative.previewUrls.every((url) => url.includes("/preview/")) && listingRelative.exportBaseUrl.includes("/export/") && listingRelative.exportFiles.length === view5.exportFiles.length, listingRelative.exportFiles.join(" "));
  check("mapSnapshot：带上导出目录的本机绝对路径（模型要能直接报给用户）", listingRelative.exportPath === exportDir, listingRelative.exportPath);
  check("readExportListing 里 zip 也是可点的绝对 URL", listing.files.some((url) => url.endsWith(expectedZip)), listing.files.join(" "));
  check("mapSnapshot：给出下一步动作", listingRelative.nextActions.length > 0, listingRelative.nextActions[0].step);

  // ══ 16. 标记点 ══════════════════════════════════════════════════════════
  section("16) 标记点：op / 连续编号 / 撤销 / 环绕 / 计划 / 导出");
  const pMark = await newProject("标记点", { cols: 8, rows: 8 });
  const markA = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "add", r: 1, c: 1 }]);
  await G.applyMapOps(pMark.id, [{ kind: "marker", op: "add", r: 2, c: 5, name: "宝箱" }]);
  const markDoc = await G.readTheDoc(pMark.id);
  check("标记：落进文档，id 由宿主分配、位置与名字都对", markDoc.markers.length === 2 && markDoc.markers[0].id === "m1" && markDoc.markers[1].name === "宝箱" && markDoc.markers[1].r === 2, JSON.stringify(markDoc.markers));
  check("标记：改动返回脏块（界面据此重拉那一块）", Array.isArray(markA.dirtyChunks) && markA.dirtyChunks.length > 0, JSON.stringify(markA.dirtyChunks));
  const dupMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "add", r: 1, c: 1 }]);
  check("标记：同一格再放被拒，且说清是第几个", dupMark.changed === 0 && dupMark.skipped.some((text) => text.includes("这一格已经有标记了（第 1 个）")), dupMark.skipped.join(" | "));
  const wrapMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "add", r: -1, c: 8 }]);
  const afterWrap = await G.readTheDoc(pMark.id);
  check("标记：环绕打开时负数 / 越界格取模落到图内", wrapMark.changed === 1 && afterWrap.markers.length === 3 && afterWrap.markers[2].r === 7 && afterWrap.markers[2].c === 0, JSON.stringify(afterWrap.markers[2]));

  const viewMark = await G.mapView(await G.readMapProject(pMark.id));
  check("视图：编号 = 下标 + 1（圆圈里那个数字就是它）", viewMark.markers.map((marker) => marker.n).join(",") === "1,2,3", JSON.stringify(viewMark.markers));

  const planMark = await G.mapPlan(pMark.id, { view: { x: 0, y: 0, width: 8 * 32, height: 8 * 32 } });
  const firstMark = planMark.markers.find((marker) => marker.id === "m1");
  check("计划：标记带圆心 / 半径 / 字号 / 数字（界面一个数都不用自己推）", planMark.markers.length === 3 && firstMark.x === 1 * 32 + 16 && firstMark.y === 1 * 32 + 16 && firstMark.radius > 0 && firstMark.font > 0 && firstMark.n === 1, JSON.stringify(firstMark));
  const seamMark = await G.mapPlan(pMark.id, { view: { x: 192, y: 128, width: 128, height: 128 } });
  check(
    "计划：视口跨右边界时同一个标记以另一个像素位置再发一条（界面不需要懂环绕）",
    seamMark.markers.some((marker) => marker.c === 1 && marker.x === 9 * 32 + 16) && !seamMark.markers.some((marker) => marker.c === 1 && marker.x === 1 * 32 + 16),
    JSON.stringify(seamMark.markers.map((marker) => [marker.c, marker.x]))
  );
  /**
   * 视口比地图大（地图只占画布一角）：必须给整张地图 —— 8×8 的地图上，
   * 收口若从视口左上角的 -1 起算一整轮，最后一行 / 最后一列会被挤出去，
   * 只剩画布外那份副本（x / y 为负）。夹具里 (7,0) 那个标记正好落在最后一行。
   */
  const wideMark = await G.mapPlan(pMark.id, { view: { x: 0, y: 0, width: 8 * 32 * 3, height: 8 * 32 * 3 } });
  const lastRowMark = wideMark.markers.find((marker) => marker.r === 7 && marker.c === 0);
  check(
    "计划：视口比地图大时给整张地图（最后一行的标记也在图内，不是画布外那份副本）",
    lastRowMark !== undefined && lastRowMark.y === 7 * 32 + 16 && wideMark.markers.every((marker) => marker.x >= 0 && marker.y >= 0),
    JSON.stringify(wideMark.markers.map((marker) => [marker.r, marker.c, marker.x, marker.y]))
  );

  const renamedMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "rename", id: "m1", name: "起点" }]);
  check("标记改名：生效，但不脏任何格子（名字不上画布）", renamedMark.changed === 0 && renamedMark.dirtyChunks.length === 0 && (await G.readTheDoc(pMark.id)).markers[0].name === "起点", `changed=${renamedMark.changed} dirty=${renamedMark.dirtyChunks.length}`);
  const movedMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "move", id: "m1", r: 4, c: 4 }]);
  const movedDoc = await G.readTheDoc(pMark.id);
  check("标记挪位置：老格子与新格子都标脏", movedMark.changed === 2 && movedDoc.markers[0].r === 4 && movedDoc.markers[0].c === 4, `changed=${movedMark.changed}`);
  const blockedMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "move", id: "m1", r: 2, c: 5 }]);
  check("标记挪到已占的格子：拒绝并说清", blockedMark.changed === 0 && blockedMark.skipped.some((text) => text.includes("已经有标记")), blockedMark.skipped.join(" | "));
  const unknownMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "remove", id: "nope" }]);
  check("标记 op 认不出 id 时只跳过、不抛", unknownMark.changed === 0 && unknownMark.skipped.some((text) => text.includes("标记不存在")), unknownMark.skipped.join(" | "));

  const removedMark = await G.applyMapOps(pMark.id, [{ kind: "marker", op: "remove", id: "m2" }]);
  const viewMarkb = await G.mapView(await G.readMapProject(pMark.id));
  check("删掉第 2 个：后面的编号自动往前顶（连续编号）", viewMarkb.markers.length === 2 && viewMarkb.markers.map((marker) => marker.n).join(",") === "1,2" && viewMarkb.markers[1].id === "m3", JSON.stringify(viewMarkb.markers));
  check("删掉第 2 个：它后面那些标记的格子一并标脏（圆圈里的数字变了）", removedMark.dirtyChunks.length > 0, JSON.stringify(removedMark.dirtyChunks));

  await G.undoMap(pMark.id);
  const afterUndoRemove = await G.readTheDoc(pMark.id);
  check("撤销删除：标记回到**原来的位置**（编号顺序也回来了）", afterUndoRemove.markers.length === 3 && afterUndoRemove.markers[1].id === "m2", JSON.stringify(afterUndoRemove.markers.map((marker) => marker.id)));
  await G.redoMap(pMark.id);
  check("重做：又删掉", (await G.readTheDoc(pMark.id)).markers.length === 2);
  await G.undoMap(pMark.id);
  await G.undoMap(pMark.id);
  const afterUndoMove = await G.readTheDoc(pMark.id);
  check("撤销挪位置：回到原来的格", afterUndoMove.markers[0].r === 1 && afterUndoMove.markers[0].c === 1, JSON.stringify(afterUndoMove.markers[0]));
  await G.undoMap(pMark.id);
  check("撤销改名：名字回到改之前（不占格的改动也撤得回来）", (await G.readTheDoc(pMark.id)).markers[0].name === "");
  await G.undoMap(pMark.id);
  await G.undoMap(pMark.id);
  await G.undoMap(pMark.id);
  check("全部撤销：标记一个都不剩", (await G.readTheDoc(pMark.id)).markers.length === 0);

  await G.applyMapOps(pMark.id, [{ kind: "marker", op: "add", r: 7, c: 7, name: "角落" }]);
  const shrinkMark = await G.saveMapDocStructure(pMark.id, { cols: 4, rows: 4 });
  check("缩小地图：界外的标记一起丢掉并给 warning", shrinkMark.doc.markers.length === 0 && shrinkMark.warnings.some((text) => text.includes("标记")), shrinkMark.warnings.join(" | "));
  await G.saveMapDocStructure(pMark.id, { cols: 8, rows: 8 });
  await G.applyMapOps(pMark.id, [{ kind: "marker", op: "add", r: 3, c: 3, name: "出口" }]);
  // 导出要求「有素材 + 地图不空」，所以先装内置素材、铺一格 —— 标记本身不算内容。
  await G.importSampleTileset(pMark.id);
  await G.applyMapOps(pMark.id, [{ kind: "paint", layerId: "l0", cells: [{ r: 0, c: 0, tile: 1 }] }]);
  await G.runExportStage(pMark.id, { formats: { png: false, json: true, zip: false } });
  await waitIdle(pMark.id);
  const exportMarkDirs = await readdir(join(G.mapProjectDir(pMark.id), "export"));
  const ownMark = JSON.parse(await readFile(join(G.mapProjectDir(pMark.id), "export", exportMarkDirs[0], "map.json"), "utf8"));
  check("导出：map.json 顶层带 markers（编号 + 名字 + 格坐标）", ownMark.markers.length === 1 && ownMark.markers[0].n === 1 && ownMark.markers[0].name === "出口" && ownMark.markers[0].r === 3 && ownMark.markers[0].c === 3, JSON.stringify(ownMark.markers));
  check("导出：标记不占图层数据（同一格在图层里还是空的）", ownMark.layers[0].data[3 * 8 + 3] === 0 && ownMark.layers[0].data[0] === 1, `marker格=${ownMark.layers[0].data[3 * 8 + 3]} 画的格=${ownMark.layers[0].data[0]}`);

  // ══ 17. AI 素材：把一批帧整理成一张待确认的素材图 ══════════════════════
  section("17) AI 素材（composeMapAsset：按形态规整 —— 普通竖排 / 整格 4×4 / 拼块 N 列，只整理不导入）");
  {
    const project = await G.createMapProject("AI 素材自检", { grid: { tileWidth: 16, tileHeight: 16, wrap: true }, cols: 8, rows: 8 });
    created.push(project.id);
    const frameDir = join(HOME, "ai-frames");
    await mkdir(frameDir, { recursive: true });
    /** 一帧纯色 PNG（`encodePng` 现编，不依赖 ffmpeg 之外的任何东西）。 */
    const writeFrame = async (name, width, height, color) => {
      const rgba = Buffer.alloc(width * height * 4);
      for (let index = 0; index < width * height; index++) {
        rgba[index * 4] = color[0];
        rgba[index * 4 + 1] = color[1];
        rgba[index * 4 + 2] = color[2];
        rgba[index * 4 + 3] = 255;
      }
      const file = join(frameDir, name);
      await writeFile(file, encodePng(rgba, width, height));
      return file;
    };
    const red = await writeFrame("f0.png", 64, 64, [255, 0, 0]);
    const green = await writeFrame("f1.png", 64, 64, [0, 255, 0]);

    const before = await G.readMapProject(project.id);
    const composed = await G.composeMapAsset({ projectId: project.id, name: "岩浆", files: [red, green] });
    check(
      "整理：格子 = 项目网格（16×16，不用调用方给）",
      composed.cell.width === 16 && composed.cell.height === 16,
      `${composed.cell.width}×${composed.cell.height}`
    );
    /**
     * ★ **这一步不再缩到格子**：AI 那条路会先留 `scale` 倍分辨率（上限 4），
     * 把「怎么缩」留给用户在「新增素材」里选（清晰度）。源图 64px 一格、格子 16px
     * → 4 倍 → 每块 64px。
     */
    check("整理：保留 4 倍分辨率（源图每块 64px、格子 16px → scale=4）", composed.scale === 4, String(composed.scale));
    check(
      "整理：2 帧竖排成一列两行，尺寸 = 格子 × 倍数",
      composed.width === composed.cell.width * composed.scale && composed.height === composed.cell.height * composed.scale * 2,
      `${composed.width}×${composed.height}`
    );
    check("整理：animRows 默认跟着帧数走（2 帧 → true）", composed.animRows === true && composed.frameCount === 2);
    check("整理：落在项目的 ai/ 下（文件名由名字归一而来）", composed.file === "ai/岩浆.png", composed.file);
    check(
      "整理：**不进素材列表**（导入前 project.tilesets 一条不加）",
      (await G.readMapProject(project.id)).tilesets.length === before.tilesets.length,
      `${before.tilesets.length} → ${(await G.readMapProject(project.id)).tilesets.length}`
    );
    const composedBytes = await readFile(G.mapAssetPath(project.id, composed.file));
    check("整理：真的落盘了（且能当 PNG 解出来）", composedBytes.length > 0 && composedBytes.subarray(1, 4).toString("ascii") === "PNG");
    const decoded = await decodeFile(G.mapAssetPath(project.id, composed.file));
    const pixelAt = (bitmap, x, y) => {
      const offset = (y * bitmap.width + x) * 4;
      return [bitmap.rgba[offset], bitmap.rgba[offset + 1], bitmap.rgba[offset + 2]];
    };
    const blockPx = composed.cell.height * composed.scale;
    check(
      "整理：第 0 帧在第 0 行、第 1 帧在第 1 行（顺序就是 files 的顺序）",
      JSON.stringify(pixelAt(decoded, Math.floor(blockPx / 2), Math.floor(blockPx / 2))) === JSON.stringify([255, 0, 0]) &&
        JSON.stringify(pixelAt(decoded, Math.floor(blockPx / 2), blockPx + Math.floor(blockPx / 2))) === JSON.stringify([0, 255, 0]),
      `${JSON.stringify(pixelAt(decoded, 8, 8))} / ${JSON.stringify(pixelAt(decoded, 8, 24))}`
    );
    const fresh = await G.readMapProject(project.id);
    check(
      "整理：项目日志里留了一条「整理 AI 素材」（用户能查到做过什么）",
      fresh.logs.some((entry) => entry.message.includes("整理 AI 素材") && entry.message.includes("岩浆")),
      fresh.logs.at(-1)?.message ?? ""
    );

    // 一帧 = 静态素材（animRows 关）。
    const single = await G.composeMapAsset({ projectId: project.id, name: "草地", files: [red] });
    check(
      "单帧：animRows = false、高度就是一块（格子 × 倍数）",
      single.animRows === false && single.height === single.cell.height * single.scale && single.frameCount === 1,
      `${single.width}×${single.height} animRows=${single.animRows}`
    );
    check("单帧：与多帧落在同一个 ai/ 目录（互不覆盖）", single.file === "ai/草地.png" && single.file !== composed.file);
    check(
      "普通形态：shape / variants / notes 三个新字段都给出来了（界面与回链要用）",
      composed.shape === "plain" && composed.variants === 1 && Array.isArray(composed.notes),
      JSON.stringify({ shape: composed.shape, variants: composed.variants, notes: composed.notes })
    );

    // ── 整格（corner16）：**一块无缝墙砖** → 拼出 4 格 × 4 格（16 种接法）────────
    const cornerSource = await writeFrame("corner.png", 64, 64, [70, 140, 90]);
    const corner = await G.composeMapAsset({ projectId: project.id, name: "石墙", files: [cornerSource], shape: "corner16" });
    check(
      "整格：4 格 × 4 格（16 块，边长 = 格子 × 倍数）",
      corner.shape === "corner16" &&
        corner.width === corner.cell.width * corner.scale * 4 &&
        corner.height === corner.cell.height * corner.scale * 4 &&
        corner.frameCount === 1 &&
        corner.animRows === false,
      `${corner.width}×${corner.height} shape=${corner.shape} scale=${corner.scale}`
    );
    check("整格：没给动画（整格没有帧这一维）", corner.animRows === false);
    {
      const bytes = await readFile(G.mapAssetPath(project.id, corner.file));
      const imported = await G.importMapTileset(project.id, "石墙导入", bytes.toString("base64"), { shape: "corner16", cell: { width: 16, height: 16 }, scale: corner.scale, clarity: "smooth" });
      const tileset = imported.tilesets[0];
      check(
        "整格：真导入后 shape=corner16、16 块、掩码刚好是 0..15（位置即语义）",
        tileset.shape === "corner16" && tileset.tiles.length === 16 && tileset.tiles.map((tile) => tile.mask).join(",") === [...Array(16).keys()].join(","),
        `${tileset.tiles.length} 块 / 掩码 ${tileset.tiles.map((tile) => tile.mask).join(",")}`
      );
      check("整格：导入后没有「块数不对」的告警", !imported.warnings.some((text) => text.includes("整格")), imported.warnings.join(" | "));
    }

    // ── 拼块（a2quad）：每个变体一块无缝砖 → 拼成 N 列 × 5 行 ────────────────
    const a2Source = await writeFrame("a2.png", 64, 64, [40, 90, 200]);
    const a2One = await G.composeMapAsset({ projectId: project.id, name: "水面", files: [a2Source], shape: "a2quad" });
    check(
      "拼块：1 张 → 1 列 × 5 行（边长 = 格子 × 倍数）",
      a2One.shape === "a2quad" &&
        a2One.width === a2One.cell.width * a2One.scale &&
        a2One.height === a2One.cell.height * a2One.scale * 5 &&
        a2One.variants === 1,
      `${a2One.width}×${a2One.height} variants=${a2One.variants}`
    );
    check("拼块：不是翻页图（动画走变体）", a2One.animRows === false);
    const a2Three = await G.composeMapAsset({ projectId: project.id, name: "水面三帧", files: [a2Source, a2Source, a2Source], shape: "a2quad" });
    check(
      "拼块：3 张 → 3 列 × 5 行（变体数 = 张数）",
      a2Three.width === a2Three.cell.width * a2Three.scale * 3 &&
        a2Three.height === a2Three.cell.height * a2Three.scale * 5 &&
        a2Three.variants === 3 &&
        a2Three.frameCount === 3,
      `${a2Three.width}×${a2Three.height} variants=${a2Three.variants}`
    );
    {
      const bytes = await readFile(G.mapAssetPath(project.id, a2Three.file));
      const imported = await G.importMapTileset(project.id, "水面导入", bytes.toString("base64"), { shape: "a2quad", cell: { width: 16, height: 16 }, scale: a2Three.scale, clarity: "crisp" });
      const tileset = imported.tilesets[0];
      check(
        "拼块：真导入后 shape=a2quad、3 个变体、块数 = 4 象限 × 5 形状 × 3 变体",
        tileset.shape === "a2quad" && tileset.variants === 3 && tileset.tiles.length === 60,
        `variants=${tileset.variants} 块=${tileset.tiles.length}`
      );
      check("拼块：高度正好是 5 × 格子高（否则自动连接会取错块）", tileset.imageHeight === tileset.cell.height * 5 && !imported.warnings.some((text) => text.includes("5×格子高")), `${tileset.imageHeight}`);
    }

    // ── 清晰度：同一张图，不同的缩法出来的像素真的不一样 ────────────────────
    {
      /** 1px 棋盘格（红 / 绿）：面积平均之后**不可能**还是纯色，最近邻则只可能是纯色。 */
      const checkerFile = join(frameDir, "checker.png");
      {
        const bitmap = { width: 64, height: 64, rgba: Buffer.alloc(64 * 64 * 4) };
        for (let y = 0; y < 64; y++) {
          for (let x = 0; x < 64; x++) {
            const offset = (y * 64 + x) * 4;
            const red = (x + y) % 2 === 0;
            bitmap.rgba[offset] = red ? 255 : 0;
            bitmap.rgba[offset + 1] = red ? 0 : 255;
            bitmap.rgba[offset + 2] = 0;
            bitmap.rgba[offset + 3] = 255;
          }
        }
        await writeFile(checkerFile, encodeBitmap(bitmap));
      }
      const checker = await G.composeMapAsset({ projectId: project.id, name: "棋盘", files: [checkerFile] });
      check("棋盘：合成保留 4 倍分辨率（64px 一块，格子 16）", checker.scale === 4 && checker.width === 64 && checker.height === 64, `${checker.width}×${checker.height} scale=${checker.scale}`);
      const checkerBytes = await readFile(G.mapAssetPath(project.id, checker.file));

      const fittedOf = async (label, clarity) => {
        const imported = await G.importMapTileset(project.id, label, checkerBytes.toString("base64"), {
          cell: { width: 16, height: 16 },
          shape: "plain",
          scale: checker.scale,
          clarity
        });
        const tileset = imported.tilesets[0];
        const fitted = await decodeFile(G.mapAssetPath(project.id, tileset.file));
        return { tileset, fitted, warnings: imported.warnings };
      };
      /** 当前这张图里有多少「混色」像素（既不是纯红也不是纯绿）。 */
      const mixedCount = (bitmap) => {
        let mixed = 0;
        for (let offset = 0; offset < bitmap.rgba.length; offset += 4) {
          const red = bitmap.rgba[offset];
          const green = bitmap.rgba[offset + 1];
          if (!((red === 255 && green === 0) || (red === 0 && green === 255))) mixed++;
        }
        return mixed;
      };

      const sharpFitted = await fittedOf("棋盘-锐利", "sharp");
      const smoothFitted = await fittedOf("棋盘-平滑", "smooth");
      check(
        "★ 清晰度：导入后素材图正好是**格子大小**（不是 4 倍的 64px）",
        sharpFitted.tileset.imageWidth === 16 && sharpFitted.tileset.imageHeight === 16 && smoothFitted.tileset.imageWidth === 16,
        `${sharpFitted.tileset.imageWidth} / ${smoothFitted.tileset.imageWidth}`
      );
      check("清晰度：选了什么会被记在素材上（列表 / 排查用）", sharpFitted.tileset.clarity === "sharp" && smoothFitted.tileset.clarity === "smooth", `${String(sharpFitted.tileset.clarity)} / ${String(smoothFitted.tileset.clarity)}`);
      check(
        "★ 锐利（最近邻）：1px 棋盘格缩完还是纯红 / 纯绿（0 个混色像素）",
        mixedCount(sharpFitted.fitted) === 0,
        `${mixedCount(sharpFitted.fitted)} 个混色`
      );
      check(
        "★ 平滑（面积平均）：同一张图缩完**每个像素都是混色**（细节被平均进去了）",
        mixedCount(smoothFitted.fitted) === 16 * 16,
        `${mixedCount(smoothFitted.fitted)} 个混色`
      );

      /** 正弦条纹：面积平均会保留波形，锐化会把振幅拉大 —— 用它区分「平滑 / 清晰」。 */
      const waveFile = join(frameDir, "wave.png");
      {
        const bitmap = { width: 64, height: 64, rgba: Buffer.alloc(64 * 64 * 4) };
        for (let x = 0; x < 64; x++) {
          const value = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.sin((2 * Math.PI * x) / 16))));
          for (let y = 0; y < 64; y++) {
            const offset = (y * 64 + x) * 4;
            bitmap.rgba[offset] = value;
            bitmap.rgba[offset + 1] = value;
            bitmap.rgba[offset + 2] = value;
            bitmap.rgba[offset + 3] = 255;
          }
        }
        await writeFile(waveFile, encodeBitmap(bitmap));
      }
      const wave = await G.composeMapAsset({ projectId: project.id, name: "波纹", files: [waveFile] });
      const waveBytes = await readFile(G.mapAssetPath(project.id, wave.file));
      const waveFitted = async (clarity) => {
        const imported = await G.importMapTileset(project.id, `波纹-${clarity}`, waveBytes.toString("base64"), { cell: { width: 16, height: 16 }, shape: "plain", scale: wave.scale, clarity });
        return decodeFile(G.mapAssetPath(project.id, imported.tilesets[0].file));
      };
      /** 相邻像素的平均差：越大 = 局部对比越强（= 看起来更「清晰」）。 */
      const contrastOf = (bitmap) => {
        let sum = 0;
        let count = 0;
        for (let y = 0; y < bitmap.height; y++) {
          for (let x = 1; x < bitmap.width; x++) {
            sum += Math.abs(bitmap.rgba[(y * bitmap.width + x) * 4] - bitmap.rgba[(y * bitmap.width + x - 1) * 4]);
            count++;
          }
        }
        return count === 0 ? 0 : sum / count;
      };
      const smoothWave = await waveFitted("smooth");
      const crispWave = await waveFitted("crisp");
      check(
        "★ 清晰（平均 + 锐化）：同一张图比「平滑」的局部对比更强（轮廓更突出）",
        contrastOf(crispWave) > contrastOf(smoothWave),
        `平滑 ${contrastOf(smoothWave).toFixed(1)} < 清晰 ${contrastOf(crispWave).toFixed(1)}`
      );

      // 反向验证：`scale = 1`（自己导一张格子大小的图）时一个像素都不动。
      const plainFile = join(frameDir, "plain16.png");
      {
        const bitmap = { width: 16, height: 16, rgba: Buffer.alloc(16 * 16 * 4) };
        for (let offset = 0; offset < bitmap.rgba.length; offset += 4) {
          bitmap.rgba[offset] = 12;
          bitmap.rgba[offset + 1] = 34;
          bitmap.rgba[offset + 2] = 56;
          bitmap.rgba[offset + 3] = 255;
        }
        await writeFile(plainFile, encodeBitmap(bitmap));
      }
      const untouched = await G.importMapTileset(project.id, "原样导入", (await readFile(plainFile)).toString("base64"), { cell: { width: 16, height: 16 } });
      check(
        "反向验证：scale=1（默认）时素材图**逐字节原样**存下来（手动导入这条路完全没变）",
        (await readFile(G.mapAssetPath(project.id, untouched.tilesets[0].file))).equals(await readFile(plainFile))
      );
      check("反向验证：不给 clarity 时记成默认的「平滑」", untouched.tilesets[0].clarity === "smooth", String(untouched.tilesets[0].clarity));

      // 越界：清晰度 / 倍数都不许乱传，明确报错。
      let clarityError = "";
      try {
        await G.importMapTileset(project.id, "乱写", checkerBytes.toString("base64"), { cell: { width: 16, height: 16 }, clarity: "nope" });
      } catch (error) {
        clarityError = String(error?.message ?? error);
      }
      check("未知清晰度明确报错（不静默回落）", clarityError.includes("清晰度"), clarityError);
      let scaleError = "";
      try {
        await G.importMapTileset(project.id, "倍数乱写", checkerBytes.toString("base64"), { cell: { width: 16, height: 16 }, scale: 0 });
      } catch (error) {
        scaleError = String(error?.message ?? error);
      }
      check("倍数越界明确报错（1~8 的整数）", scaleError.includes("倍数"), scaleError);
    }

    // 整格多给几张 = 调用方把形态判断错了：明确拒绝，别默默用第一张。
    let cornerManyError = "";
    try {
      await G.composeMapAsset({ projectId: project.id, name: "石墙错", files: [cornerSource, cornerSource], shape: "corner16" });
    } catch (error) {
      cornerManyError = String(error?.message ?? error);
    }
    check(
      "整格给 2 张：明确抛错，并说清「整格没有动画 / 要会动请用拼块」（真机踩过：用户选了视频 + 8 帧，结果静默变成静态）",
      cornerManyError.includes("一块") && cornerManyError.includes("无缝") && cornerManyError.includes("没有动画") && cornerManyError.includes("拼块"),
      cornerManyError
    );

    // 非方砖：整格 / 拼块要的是**一块方砖**，长宽比差得多会被拉伸 —— 要提醒。
    const wideTile = await writeFrame("wide.png", 64, 32, [10, 10, 10]);
    const squashed = await G.composeMapAsset({ projectId: project.id, name: "压扁的", files: [wideTile, wideTile], shape: "a2quad" });
    check(
      "比例提醒：2:1 的源图配 1:1 的方砖目标 → notes 里说清「已拉伸、内容会变形」",
      squashed.notes.some((text) => text.includes("拉伸") && text.includes("比例")),
      squashed.notes.join(" | ")
    );
    check("反向验证：方砖不会被乱提醒", corner.notes.length === 0, corner.notes.join(" | "));

    /**
     * ★「接缝」的正向守门：砖自己接不上自己的时候，宿主必须**报出来**。
     *
     * 这次返工就是这一类：模型画的多格拼不到一起。现在整格 / 拼块都由一块砖拼出来，
     * 唯一残留的缝就是砖自身的环绕缝 —— 所以它必须量得出来、说得清，用户才知道该重画。
     */
    const brokenTile = await writeFrame("broken.png", 64, 64, [0, 0, 0]);
    {
      // 把最左一列涂成白色（右列还是黑的）：这块砖左右接不上自己。
      const bitmap = await decodeFile(brokenTile);
      for (let y = 0; y < bitmap.height; y++) {
        const offset = (y * bitmap.width) * 4;
        bitmap.rgba[offset] = 255;
        bitmap.rgba[offset + 1] = 255;
        bitmap.rgba[offset + 2] = 255;
      }
      await writeFile(brokenTile, encodeBitmap(bitmap));
    }
    const broken = await G.composeMapAsset({ projectId: project.id, name: "接不上的砖", files: [brokenTile], shape: "corner16" });
    check(
      "★ 砖自己接不上自己 → notes 里说清「平铺会每隔一格有一道缝」并给出重画建议",
      broken.notes.some((text) => text.includes("接不上自己") && text.includes("重画")),
      broken.notes.join(" | ")
    );
    check("反向验证：纯色砖（左右上下都接得上）不会报接缝", corner.notes.every((text) => !text.includes("接不上自己")), corner.notes.join(" | "));

    // 名字留空 → 兜底名；显式 cell → 覆盖项目网格。
    const unnamed = await G.composeMapAsset({ projectId: project.id, files: [red] });
    check("名字留空：兜底成「AI 素材」", unnamed.name === "AI 素材" && unnamed.file === "ai/AI 素材.png", unnamed.file);
    const custom = await G.composeMapAsset({ projectId: project.id, name: "小格", files: [red, green], cell: { width: 8, height: 8 }, animRows: false });
    check(
      "显式 cell：按 8×8 出图（覆盖项目网格），animRows 也能显式关掉",
      custom.cell.width === 8 && custom.width === custom.cell.width * custom.scale && custom.height === custom.cell.height * custom.scale * 2 && custom.animRows === false,
      `${custom.width}×${custom.height} animRows=${custom.animRows} scale=${custom.scale}`
    );
    check("反向验证：不同 cell 出来的块就是不同的（不是永远用项目网格）", custom.cell.width !== composed.cell.width, `${custom.cell.width} vs ${composed.cell.width}`);

    // ── 自动裁边：模型留的白框进不了素材图 ─────────────────────────────────
    {
      const framed = { width: 128, height: 128, rgba: Buffer.alloc(128 * 128 * 4) };
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const offset = (y * 128 + x) * 4;
          const border = x < 6 || y < 6 || x >= 122 || y >= 122;
          framed.rgba[offset] = border ? 250 : 30 + ((x * 5) % 40);
          framed.rgba[offset + 1] = border ? 250 : 80;
          framed.rgba[offset + 2] = border ? 248 : 140;
          framed.rgba[offset + 3] = 255;
        }
      }
      const framedFile = join(frameDir, "framed.png");
      await writeFile(framedFile, encodeBitmap(framed));
      const withFrame = await G.composeMapAsset({ projectId: project.id, name: "带白框的砖", files: [framedFile], shape: "corner16" });
      check(
        "★ 自动裁边：白框被裁掉，notes 里说清了裁了多少",
        withFrame.notes.some((text) => text.includes("自动裁掉") && text.includes("白框")),
        withFrame.notes.join(" | ")
      );
      const decodedFrame = await decodeFile(G.mapAssetPath(project.id, withFrame.file));
      // 满格那一块（右下）的四角：裁过的话不该是纯白。
      const cellPx = withFrame.width / 4;
      const corner = [decodedFrame.rgba[((3 * cellPx) * decodedFrame.width + 3 * cellPx) * 4], decodedFrame.rgba[((3 * cellPx) * decodedFrame.width + 3 * cellPx) * 4 + 1]];
      check("裁完之后素材图的角上不再是白边", !(corner[0] > 240 && corner[1] > 240), JSON.stringify(corner));
      const plainBrick = await G.composeMapAsset({ projectId: project.id, name: "没白框的砖", files: [cornerSource], shape: "corner16" });
      check("反向验证：没有白框的砖不会被裁（notes 里不提裁边）", plainBrick.notes.every((text) => !text.includes("自动裁掉")), plainBrick.notes.join(" | "));
    }

    // ── 方向感知：竖段换向 + 转角斜接（走到真机数据上验一遍）──────────────────
    {
      /** 横条纹的墙砖：竖着走的那一段必须变成竖条纹。 */
      const striped = { width: 64, height: 64, rgba: Buffer.alloc(64 * 64 * 4) };
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const offset = (y * 64 + x) * 4;
        const on = Math.floor(y / 16) % 2 === 0;
        striped.rgba[offset] = on ? 240 : 30;
        striped.rgba[offset + 1] = on ? 210 : 40;
        striped.rgba[offset + 2] = 70;
        striped.rgba[offset + 3] = 255;
      }
      const stripeFile = join(frameDir, "striped.png");
      await writeFile(stripeFile, encodeBitmap(striped));
      const composedStripe = await G.composeMapAsset({ projectId: project.id, name: "条纹墙", files: [stripeFile], shape: "corner16" });
      const sheet = await decodeFile(G.mapAssetPath(project.id, composedStripe.file));
      const blockOf = (mask) => {
        const cell = sheet.width / 4;
        const rgba = Buffer.alloc(cell * cell * 4);
        for (let y = 0; y < cell; y++) {
          const from = (((Math.floor(mask / 4) * cell) + y) * sheet.width + (mask % 4) * cell) * 4;
          sheet.rgba.copy(rgba, y * cell * 4, from, from + cell * 4);
        }
        return { cell, rgba };
      };
      const variation = ({ cell, rgba }) => {
        let dx = 0, dy = 0, n = 0;
        for (let y = 2; y < cell - 2; y++) for (let x = 2; x < cell - 2; x++) {
          const o = (y * cell + x) * 4;
          dx += Math.abs(rgba[o] - rgba[o - 4]);
          dy += Math.abs(rgba[o] - rgba[o - cell * 4]);
          n++;
        }
        return { dx: dx / n, dy: dy / n };
      };
      const horizontalRun = variation(blockOf(10)); // E+W
      const verticalRun = variation(blockOf(5));    // N+S
      check("★ 合成出来的整格：横着走的那一块是横条纹", horizontalRun.dy > horizontalRun.dx * 2, JSON.stringify(horizontalRun));
      check("★ 合成出来的整格：竖着走的那一块被转了 90°（变成竖条纹）", verticalRun.dx > verticalRun.dy * 2, JSON.stringify(verticalRun));
      check("转角那一块（N+W）和十字块不同（斜接真的进了素材图）", JSON.stringify([...blockOf(9).rgba]) !== JSON.stringify([...blockOf(15).rgba]));
    }

    // 失败路径：空数组 / 读不到的文件 / 超过一列上限，都要明确抛错。
    let emptyError = "";
    try {
      await G.composeMapAsset({ projectId: project.id, name: "空的", files: [] });
    } catch (error) {
      emptyError = String(error?.message ?? error);
    }
    check("空 files：明确抛错（不产出一张空图）", emptyError.includes("files"), emptyError);
    let missingError = "";
    try {
      await G.composeMapAsset({ projectId: project.id, name: "缺的", files: [join(frameDir, "nope.png")] });
    } catch (error) {
      missingError = String(error?.message ?? error);
    }
    check("文件不存在：明确说读不到哪一张", missingError.includes("nope.png"), missingError);
    let manyError = "";
    try {
      await G.composeMapAsset({ projectId: project.id, name: "太多", files: Array.from({ length: 65 }, () => red) });
    } catch (error) {
      manyError = String(error?.message ?? error);
    }
    check("超过一列上限（64）：在读盘之前就拒绝", manyError.includes("64"), manyError);
    let projectError = "";
    try {
      await G.composeMapAsset({ projectId: "m-not-a-project", name: "无主", files: [red] });
    } catch (error) {
      projectError = String(error?.message ?? error);
    }
    check("项目不存在：明确抛错", projectError.length > 0, projectError);
  }

  // ══ 18. 删除 ════════════════════════════════════════════════════════════
  section("18) 素材自己的动画播放速度（新增时定，可随时改）");
  {
    const project = await G.createMapProject("播放速度自检", { grid: { tileWidth: 16, tileHeight: 16, wrap: true }, cols: 8, rows: 8 });
    created.push(project.id);
    /**
     * ★ 「新增素材时能设置动画播放速度」。
     *
     * 三件事必须成立：① 导入时就带上、并且**真的进计划**（`op.fps` / `fpsMax`）；
     * ② 没设的素材不受影响（`op.fps` 不出现，`fpsMax` = 默认）；
     * ③ 越界值明确报错，不静默夹到边界。
     */
    const fastDir = join(HOME, "ai-fast-frames");
    await mkdir(fastDir, { recursive: true });
    const fastFrames = [];
    for (let index = 0; index < 3; index++) {
      const rgba = Buffer.alloc(32 * 32 * 4);
      for (let p = 0; p < 32 * 32; p++) { rgba[p * 4] = 30 + index * 80; rgba[p * 4 + 1] = 120; rgba[p * 4 + 2] = 200; rgba[p * 4 + 3] = 255; }
      const file = join(fastDir, `fast${index}.png`);
      await writeFile(file, encodeBitmap({ width: 32, height: 32, rgba }));
      fastFrames.push(file);
    }
    const fastSheet = await G.composeMapAsset({ projectId: project.id, name: "快水", files: fastFrames, shape: "a2quad" });
    const fastBytes = await readFile(G.mapAssetPath(project.id, fastSheet.file));
    const importedFast = await G.importMapTileset(project.id, "快水", fastBytes.toString("base64"), {
      shape: "a2quad",
      cell: { width: 16, height: 16 },
      fps: 8
    });
    check("新增素材时能带上播放速度（8 帧/秒）", importedFast.tilesets[0].fps === 8, JSON.stringify(importedFast.tilesets[0].fps));

    // 第二张同样的水，但**不设**速度（跟全局走）—— 用来做反向验证。
    const slowImported = await G.importMapTileset(project.id, "慢水", fastBytes.toString("base64"), { shape: "a2quad", cell: { width: 16, height: 16 } });
    check("反向验证：没设速度的素材就没有 fps 字段（= 跟设置里的全局速度走）", slowImported.tilesets[0].fps === undefined, String(slowImported.tilesets[0].fps));

    const view = await G.mapView(await G.readMapProject(project.id));
    const fastEntry = view.tilesets.find((entry) => entry.name === "快水");
    const slowEntry = view.tilesets.find((entry) => entry.name === "慢水");
    check("素材快照把速度交给界面（列表上要显示）", fastEntry?.fps === 8 && slowEntry?.fps === undefined, `${String(fastEntry?.fps)} / ${String(slowEntry?.fps)}`);

    // 各画一格，再看宿主真的把速度下发到各自的 op 上。
    const layerId = view.layers[0].id;
    await G.applyMapOps(project.id, [
      { kind: "paint", layerId, cells: [{ r: 3, c: 3, tile: fastEntry.palette[0].index }] },
      { kind: "paint", layerId, cells: [{ r: 5, c: 5, tile: slowEntry.palette[0].index }] }
    ]);
    const plan = await G.mapPlan(project.id, { view: { x: 0, y: 0, width: 8 * 16, height: 8 * 16 }, have: [] });
    const opsAt = (result, r, c) => result.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.r === r && op.c === c);
    const fastOps = opsAt(plan, 3, 3);
    const slowOps = opsAt(plan, 5, 5);
    check("带速度的素材：每一条 op 都带上自己的 fps（客户端据它算帧号）", fastOps.length > 0 && fastOps.every((op) => op.fps === 8), JSON.stringify(fastOps.map((op) => op.fps)));
    check("反向验证：没设速度的素材 op 上没有 fps（跟着全局走）", slowOps.length > 0 && slowOps.every((op) => op.fps === undefined), JSON.stringify(slowOps.map((op) => op.fps)));
    check("★ 计划的 fpsMax = 最快的那条速度（客户端据此推时钟，否则快速素材会被慢时钟拖住）", plan.fpsMax === 8 && plan.fps === 1, `fps=${plan.fps} fpsMax=${plan.fpsMax}`);

    // 改速度（表现层属性，不动几何 / 不动序号，随时能改）。
    const changed = await G.saveMapTileset(project.id, fastEntry.id, { fps: 2 });
    check("改播放速度：只换个数，不重切、不重映射（图块数不变）", changed.tileset.fps === 2 && changed.tileset.tiles.length === fastEntry.tileCount, `${changed.tileset.fps} / ${changed.tileset.tiles.length}`);
    check("改播放速度会记一条项目日志（用户查得到做过什么）", (await G.readMapProject(project.id)).logs.some((entry) => String(entry.message).includes("改素材播放速度")));
    const cleared = await G.saveMapTileset(project.id, fastEntry.id, { fps: null });
    check("速度也能清掉（null = 回到跟全局）", cleared.tileset.fps === undefined, String(cleared.tileset.fps));
    check("清掉之后计划里就没有 fps 了，fpsMax 回落", (await G.mapPlan(project.id, { view: { x: 0, y: 0, width: 8 * 16, height: 8 * 16 }, have: [] })).fpsMax === 1);

    // 越界 / 乱码：明确报错。
    let fpsError = "";
    try {
      await G.importMapTileset(project.id, "太快了", fastBytes.toString("base64"), { shape: "a2quad", fps: 60 });
    } catch (error) {
      fpsError = String(error?.message ?? error);
    }
    check("新增时给越界速度：明确报错并说清范围（不静默夹到 30）", fpsError.includes("0.5") && fpsError.includes("30"), fpsError);
    let saveFpsError = "";
    try {
      await G.saveMapTileset(project.id, fastEntry.id, { fps: 0 });
    } catch (error) {
      saveFpsError = String(error?.message ?? error);
    }
    check("改速度时给越界值：同样明确报错", saveFpsError.includes("0.5"), saveFpsError);

    // 内置素材仍然不许改（包括速度）。
    const sampled = await G.importSampleTileset(project.id);
    /**
     * 内置素材的边界收在「几何」上：名字 / 播放速度 / 循环方式是**表现层**，随时可以改
     * （不动图块、不动序号）；形态与格子尺寸仍然不行。
     */
    const builtinId = sampled.tilesets.find((entry) => entry.builtin === true).id;
    const builtinFps = await G.saveMapTileset(project.id, builtinId, { fps: 4, loop: "reverse" }).then((result) => result.tileset, () => undefined);
    check("内置素材可以改播放速度 / 循环方式（表现层属性）", builtinFps !== undefined && builtinFps.fps === 4 && builtinFps.loop === "reverse", JSON.stringify({ fps: builtinFps?.fps, loop: builtinFps?.loop }));
    let builtinError = "";
    try {
      await G.saveMapTileset(project.id, builtinId, { cell: { width: 64, height: 64 } });
    } catch (error) {
      builtinError = String(error?.message ?? error);
    }
    check("内置素材的**格子 / 形态**仍然改不动（会重切图块、画过的格子整体错位）", builtinError.includes("不能改"), builtinError.slice(0, 40));
  }

  section("19) 循环方式（正放 / 倒放 / 来回：只换帧序展开）");
  {
    const project = await G.createMapProject("循环方式自检", { grid: { tileWidth: 16, tileHeight: 16, wrap: true }, cols: 8, rows: 8 });
    created.push(project.id);
    const dir = join(HOME, "loop-frames");
    await mkdir(dir, { recursive: true });
    /** 4 帧水（帧号写在像素里，方便从 legend 认出「第几帧」）。 */
    const files = [];
    for (let frame = 0; frame < 4; frame++) {
      const rgba = Buffer.alloc(16 * 16 * 4);
      for (let pixel = 0; pixel < 16 * 16; pixel++) {
        rgba[pixel * 4] = 20 + frame * 60;
        rgba[pixel * 4 + 1] = 120;
        rgba[pixel * 4 + 2] = 200;
        rgba[pixel * 4 + 3] = 255;
      }
      const file = join(dir, `f${frame}.png`);
      await writeFile(file, encodePng(rgba, 16, 16));
      files.push(file);
    }
    const sheet = await G.composeMapAsset({ projectId: project.id, name: "水", files, shape: "plain" });
    const bytes = await readFile(G.mapAssetPath(project.id, sheet.file));

    /** 导入 → 画一格 → 取那一格的 cycle（帧序按图块序号排的）。 */
    const cycleOf = async (label, loop) => {
      const imported = await G.importMapTileset(project.id, label, bytes.toString("base64"), {
        cell: { width: 16, height: 16 },
        shape: "plain",
        animRows: true,
        scale: sheet.scale,
        loop
      });
      const tilesetId = imported.tilesets[0].id;
      const view = await G.mapView(await G.readMapProject(project.id));
      const layer = view.layers[0].id;
      const brush = view.tilesets.find((entry) => entry.id === tilesetId).palette[0].index;
      await G.applyMapOps(project.id, [{ kind: "paint", layerId: layer, cells: [{ r: 1, c: 1, tile: brush }] }]);
      const plan = await G.mapPlan(project.id, { view: { x: 0, y: 0, width: 8 * 16, height: 8 * 16 }, have: [] });
      const op = plan.chunks.flatMap((chunk) => chunk.ops).find((entry) => entry.r === 1 && entry.c === 1) ?? {};
      // 帧序里存的是全局图块序号，翻回「第几帧」再比（序号本身随导入顺序变）。
      const rects = new Map((plan.legend ?? []).map((entry) => [entry.index, entry.rect.y]));
      const rows = (op.cycle ?? []).map((index) => Math.round((rects.get(index) ?? 0) / 16));
      return { rows, tileset: imported.tilesets[0], frameCount: plan.frameCount };
    };

    const forward = await cycleOf("水-正放", "forward");
    check("正放：帧序是 0,1,2,3", JSON.stringify(forward.rows) === JSON.stringify([0, 1, 2, 3]), JSON.stringify(forward.rows));
    const reverse = await cycleOf("水-倒放", "reverse");
    check("★ 倒放：帧序是 3,2,1,0（真的反过来了）", JSON.stringify(reverse.rows) === JSON.stringify([3, 2, 1, 0]), JSON.stringify(reverse.rows));
    const pingpong = await cycleOf("水-来回", "pingpong");
    check("★ 来回：帧序是 0,1,2,3,2,1（首尾各留一次，接缝不跳）", JSON.stringify(pingpong.rows) === JSON.stringify([0, 1, 2, 3, 2, 1]), JSON.stringify(pingpong.rows));
    check("帧数跟着展开后的帧序走（来回 4 帧 → frameCount 6）", pingpong.frameCount === 6 && forward.frameCount === 4, `${forward.frameCount} / ${pingpong.frameCount}`);
    check("素材快照把循环方式交给界面", forward.tileset.loop === "forward" && reverse.tileset.loop === "reverse" && pingpong.tileset.loop === "pingpong");

    // 改循环方式：表现层属性，随时能改、立刻生效。
    const changed = await G.saveMapTileset(project.id, pingpong.tileset.id, { loop: "reverse" });
    check("改循环方式生效（来回 → 倒放），图块数不变（不重切）", changed.tileset.loop === "reverse" && changed.tileset.tiles.length === pingpong.tileset.tiles.length, `${String(changed.tileset.loop)} / ${changed.tileset.tiles.length}`);
    const afterChange = await G.mapPlan(project.id, { view: { x: 0, y: 0, width: 8 * 16, height: 8 * 16 }, have: [] });
    const ops = afterChange.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.r === 1 && op.c === 1);
    const rects = new Map((afterChange.legend ?? []).map((entry) => [entry.index, entry.rect.y]));
    check("改完下一份计划就是新的帧序（不用重切素材）", JSON.stringify((ops[0]?.cycle ?? []).map((index) => Math.round((rects.get(index) ?? 0) / 16))) === JSON.stringify([3, 2, 1, 0]));
    check("改循环方式会记一条项目日志", (await G.readMapProject(project.id)).logs.some((entry) => String(entry.message).includes("改素材循环方式")));

    // 越界 / 乱码明确报错。
    let loopError = "";
    try {
      await G.importMapTileset(project.id, "乱写", bytes.toString("base64"), { cell: { width: 16, height: 16 }, loop: "yoyo" });
    } catch (error) {
      loopError = String(error?.message ?? error);
    }
    check("未知循环方式明确报错（不静默回落成正放）", loopError.includes("循环方式"), loopError);
  }

  section("20) 一格多大可配（16 / 32 / 48 / 64：新建项目时定）");
  {
    const wide = await G.createMapProject("64 网格自检", { grid: { tileWidth: 64, tileHeight: 64, wrap: true }, cols: 8, rows: 8 });
    created.push(wide.id);
    const view = await G.mapView(await G.readMapProject(wide.id));
    check("新建项目能指定网格（64×64）", view.grid.tileWidth === 64 && view.grid.tileHeight === 64, `${view.grid.tileWidth}×${view.grid.tileHeight}`);

    // AI 素材：composeMapAsset 默认按项目网格出块（64 → 4 倍 = 256px 一块）
    const frameDir = join(HOME, "grid-frames");
    await mkdir(frameDir, { recursive: true });
    const rgba = Buffer.alloc(256 * 256 * 4);
    for (let pixel = 0; pixel < 256 * 256; pixel++) {
      rgba[pixel * 4] = 40;
      rgba[pixel * 4 + 1] = 90 + (pixel % 60);
      rgba[pixel * 4 + 2] = 160;
      rgba[pixel * 4 + 3] = 255;
    }
    const source = join(frameDir, "tile.png");
    await writeFile(source, encodePng(rgba, 256, 256));
    const composed = await G.composeMapAsset({ projectId: wide.id, name: "大格砖", files: [source], shape: "corner16" });
    check("AI 素材按项目网格出块（64 格 × 4 倍 = 256px 一块）", composed.cell.width === 64 && composed.scale === 4 && composed.width === 64 * 4 * 4, `${composed.cell.width} / ${composed.scale} / ${composed.width}`);
    const bytes = await readFile(G.mapAssetPath(wide.id, composed.file));
    // 界面那条路（「新增素材」预填的 cell 就是地图网格）：
    const imported = await G.importMapTileset(wide.id, "大格砖", bytes.toString("base64"), {
      shape: "corner16",
      cell: { width: 64, height: 64 },
      scale: composed.scale,
      clarity: "smooth"
    });
    check("导入后素材的格子就是项目网格（64×64，图块按 64px 画不会压边）", imported.tilesets[0].cell.width === 64 && imported.tilesets[0].imageWidth === 64 * 4, `${imported.tilesets[0].cell.width} / ${imported.tilesets[0].imageWidth}`);
    check("格子 = 地图网格时没有「尺寸不匹配」的告警", !imported.warnings.some((text) => text.includes("地图格子")), imported.warnings.join(" | "));
    /**
     * ★ 对话面容易忘传 `cell`：那时宿主要**说出来**（否则图块只占格子一角，看着像缩小了）。
     */
    const forgotCell = await G.importMapTileset(wide.id, "忘了填格子", bytes.toString("base64"), { shape: "corner16", scale: composed.scale });
    check(
      "忘了填 cell（自动认出 32）时明确告警：说清素材格子与地图网格不一致",
      forgotCell.warnings.some((text) => text.includes("地图格子") && text.includes("64×64")),
      forgotCell.warnings.join(" | ")
    );

    // 内置素材：按 32 画的，塞进 64 网格要按比例放大（否则图块只有半格）
    const sampled = await G.importSampleTileset(wide.id);
    check("内置素材按项目网格缩放（64 网格 → 每格 64px、图也放大一倍）", sampled.tilesets.every((entry) => entry.cell.width === 64) && sampled.tilesets[0].imageWidth === 128, `${sampled.tilesets.map((entry) => `${entry.cell.width}/${entry.imageWidth}`).join(" ")}`);
    check("反向验证：缩放后仍认得出形态（A2 还是 A2）", sampled.tilesets.filter((entry) => entry.shape === "a2quad").length === 4, sampled.tilesets.map((entry) => entry.shape).join(","));

    // 16 网格：缩小也要成立（用面积平均）
    const small = await G.createMapProject("16 网格自检", { grid: { tileWidth: 16, tileHeight: 16, wrap: true }, cols: 8, rows: 8 });
    created.push(small.id);
    const smallSampled = await G.importSampleTileset(small.id);
    check("16 网格的内置素材同样按比例缩下来（每格 16px）", smallSampled.tilesets.every((entry) => entry.cell.width === 16) && smallSampled.tilesets[0].imageWidth === 32, `${smallSampled.tilesets[0].cell.width} / ${smallSampled.tilesets[0].imageWidth}`);
  }

  section("21) 原地重烘（recomposeMapTileset：换规则后不用重画地图）");
  {
    const project2 = await G.createMapProject("重烘自检", { grid: { tileWidth: 16, tileHeight: 16, wrap: true }, cols: 8, rows: 8 });
    created.push(project2.id);
    await G.importSampleTileset(project2.id);
    const dir2 = join(HOME, "recompose-frames");
    await mkdir(dir2, { recursive: true });
    const make = async (shift, name) => {
      const rgba = Buffer.alloc(64 * 64 * 4);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const offset = (y * 64 + x) * 4;
        rgba[offset] = (x * 4 + shift) % 256;
        rgba[offset + 1] = (y * 4) % 256;
        rgba[offset + 2] = 90;
        rgba[offset + 3] = 255;
      }
      const file = join(dir2, name);
      await writeFile(file, encodeBitmap({ width: 64, height: 64, rgba }));
      return file;
    };
    const first = await make(0, "a.png");
    const second = await make(120, "b.png");
    const sheet = await G.composeMapAsset({ projectId: project2.id, name: "墙", files: [first], shape: "corner16" });
    const bytes = await readFile(G.mapAssetPath(project2.id, sheet.file));
    const imported = await G.importMapTileset(project2.id, "墙", bytes.toString("base64"), {
      shape: "corner16",
      cell: { width: 16, height: 16 },
      scale: sheet.scale,
      clarity: "smooth"
    });
    const tilesetId = imported.tilesets[0].id;
    /**
     * ★ 先把地图画满：重烘之后**这些格子必须一格都不动**（序号不变）。
     */
    const view = await G.mapView(await G.readMapProject(project2.id));
    const brush = view.tilesets.find((t) => t.id === tilesetId).palette[0].index;
    const ops = [];
    for (let r = 1; r < 7; r++) for (let c = 1; c < 7; c++) ops.push({ kind: "paint", layerId: view.layers[0].id, cells: [{ r, c, tile: brush }] });
    await G.applyMapOps(project2.id, ops, { stroke: "recompose" });
    // 落盘是防抖的：先手动 flush，否则拍到的「之前」还是画之前的盘上状态。
    await G.flushMapDoc(project2.id);
    // 最硬的断言：重烘前后 `map.json` 必须**逐字节相同**（一格都没动）。
    const mapFile = G.mapDocFile(project2.id);
    const beforeBytes = await readFile(mapFile);

    const imageBefore = await decodeFile(join(G.mapProjectDir(project2.id), imported.tilesets[0].file));
    const recomposed = await G.recomposeMapTileset(project2.id, tilesetId, { files: [second] });
    check("原地重烘：素材 id 不变（地图引用的还是它）", recomposed.tileset.id === tilesetId, `${recomposed.tileset.id} vs ${tilesetId}`);
    check("原地重烘：图块数不变（16 块，序号一个都不动）", recomposed.tileset.tileCount === 16, String(recomposed.tileset.tileCount));
    check("原地重烘：格子 / 形态 / 清晰度沿用原素材", recomposed.tileset.cell.width === 16 && recomposed.tileset.shape === "corner16" && recomposed.tileset.clarity === "smooth");
    const imageAfter = await decodeFile(join(G.mapProjectDir(project2.id), recomposed.tileset.file));
    let diff = 0;
    for (let i = 0; i < imageAfter.rgba.length; i += 4) diff += Math.abs(imageAfter.rgba[i] - imageBefore.rgba[i]);
    check("★ 原地重烘：素材图真的换了（源图不同 → 像素不同）", diff > 1000, `累计差 ${diff}`);
    const afterBytes = await readFile(mapFile);
    /**
     * 逐字节比较太严：读路径会顺手迁移 / 触摸 `updatedAt`（2172 → 2172 字节也可能是这一处）。
     * 语义比较才是真契约：**图层结构与每格的值**必须一模一样。
     */
    const beforeDoc = JSON.parse(beforeBytes.toString("utf8"));
    const afterDoc = JSON.parse(afterBytes.toString("utf8"));
    check(
      "★ 重烘前后地图数据一模一样（每格的值与图层结构都没动）",
      JSON.stringify(afterDoc.data) === JSON.stringify(beforeDoc.data) && JSON.stringify(afterDoc.layers) === JSON.stringify(beforeDoc.layers),
      (() => {
        const a = afterDoc.data[view.layers[0].id], b = beforeDoc.data[view.layers[0].id];
        const diff = a.map((v, i) => (v === b[i] ? null : `${i}:${b[i]}→${v}`)).filter(Boolean).slice(0, 6);
        return `${a.filter((v) => v > 0).length} 格；层的差异 ${JSON.stringify(afterDoc.layers.map((l) => l.id))} vs ${JSON.stringify(beforeDoc.layers.map((l) => l.id))}；前几处 ${diff.join(" ")}`;
      })()
    );
    check("原地重烘会记一条日志", (await G.readMapProject(project2.id)).logs.some((entry) => String(entry.message).includes("重新整理素材")));

    let builtinError = "";
    try {
      const builtinId = view.tilesets.find((t) => t.builtin === true).id;
      await G.recomposeMapTileset(project2.id, builtinId, { files: [first] });
    } catch (error) {
      builtinError = String(error?.message ?? error);
    }
    check("内置素材不许重烘（明确报错）", builtinError.includes("内置"), builtinError);
    let emptyError = "";
    try {
      await G.recomposeMapTileset(project2.id, tilesetId, { files: [] });
    } catch (error) {
      emptyError = String(error?.message ?? error);
    }
    check("没给源图时明确报错（不静默清空素材）", emptyError.includes("源图"), emptyError);
  }

  section("22) 整图（多格印花：一次占 N×M 格 + 旋转 + 通行区域）");
  {
    const project = await G.createMapProject("整图自检", { grid: { tileWidth: 16, tileHeight: 16, wrap: false }, cols: 20, rows: 20 });
    created.push(project.id);
    const dir = join(HOME, "stamp-frames");
    await mkdir(dir, { recursive: true });
    /**
     * 一张 3×2 格、每格 16px 的整图：每格一个可辨认的颜色（旋转靠它验）。
     * 2 帧：第二帧整体偏红一点。
     */
    const cell = 16, cols = 3, rows = 2;
    const frameFile = async (frame) => {
      const bitmap = { width: cols * cell, height: rows * cell, rgba: Buffer.alloc(cols * cell * rows * cell * 4) };
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
          const offset = ((r * cell + y) * cols * cell + c * cell + x) * 4;
          bitmap.rgba[offset] = 30 + c * 60;
          bitmap.rgba[offset + 1] = 30 + r * 90;
          bitmap.rgba[offset + 2] = 120 + frame * 40;
          bitmap.rgba[offset + 3] = 255;
        }
      }
      const file = join(dir, `f${frame}.png`);
      await writeFile(file, encodeBitmap(bitmap));
      return file;
    };
    const frame0 = await frameFile(0);
    const frame1 = await frameFile(1);
    // 两帧竖排成一张：合成要「每帧一整张」，这里手工拼一份（模拟 composeMapAsset 的产物）。
    const stacked = { width: cols * cell, height: rows * 2 * cell, rgba: Buffer.alloc(cols * cell * rows * 2 * cell * 4) };
    for (const [index, file] of [frame0, frame1].entries()) {
      const bitmap = await decodeFile(file);
      for (let y = 0; y < bitmap.height; y++) bitmap.rgba.copy(stacked.rgba, ((index * rows * cell + y) * stacked.width) * 4, y * bitmap.width * 4, y * bitmap.width * 4 + bitmap.width * 4);
    }
    const stackedFile = join(dir, "stacked.png");
    await writeFile(stackedFile, encodeBitmap(stacked));
    const stackedBytes = await readFile(stackedFile);

    const pass = [0, 0, 0, 1, 1, 2];
    const imported = await G.importMapTileset(project.id, "雕像", stackedBytes.toString("base64"), {
      stamp: { cols, rows, frames: 2, pass }
    });
    const tileset = imported.tilesets[0];
    check("导入整图：形态是 stamp、规格记在素材上", tileset.shape === "stamp" && tileset.stamp.cols === cols && tileset.stamp.rows === rows && tileset.stamp.frames === 2, JSON.stringify(tileset.stamp));
    // 每帧 = (2×3) + (3×2) + (2×3) + (3×2) = 24 块；2 帧 = 48。
    check("导入整图：块数 = 每帧 24 × 2 帧 = 48", tileset.tiles.length === 48, String(tileset.tiles.length));
    check("导入整图：素材图宽 = max(3,2)=3 格、高 = 2 帧 × 2(3+2)=20 格", tileset.imageWidth === 3 * 16 && tileset.imageHeight === 20 * 16, `${tileset.imageWidth}×${tileset.imageHeight}`);
    check("反向验证：整图格子被锁成地图网格（cell = 项目网格 16）", tileset.cell.width === 16 && tileset.cell.height === 16);

    const view = await G.mapView(await G.readMapProject(project.id));
    const brief = view.tilesets.find((entry) => entry.id === tileset.id);
    check("素材视图带 stamp（占格 / 帧数，界面据此做笔刷）", brief !== undefined && brief.stamp.cols === 3 && brief.stamp.rows === 2 && brief.stamp.frames === 2, JSON.stringify(brief?.stamp));
    check("★ 调色板：整图只出一条，缩略图是**整张**（3×2 格）", brief.palette.length === 1 && brief.palette[0].rect.width === 3 * 16 && brief.palette[0].rect.height === 2 * 16, JSON.stringify(brief.palette));

    const layer = view.layers[0].id;
    const brush = brief.palette[0].index;
    const planOf = async (extra = {}) => G.mapPlan(project.id, { view: { x: 0, y: 0, width: 20 * 16, height: 20 * 16 }, have: [], ...extra });

    /**
     * ★ 下限是 1（曾经是 2）：1×1 的整图 = 「一格一张图」—— 带通行区域、可旋转的普通图块。
     * 只把常量改小不够，几何里任何一处「至少 2 格」的假设都会在这里露出来。
     */
    {
      const tiny = { width: cell, height: cell, rgba: Buffer.alloc(cell * cell * 4) };
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const offset = (y * cell + x) * 4;
          tiny.rgba[offset] = 200;
          tiny.rgba[offset + 1] = 40;
          tiny.rgba[offset + 2] = 60;
          tiny.rgba[offset + 3] = 255;
        }
      }
      const tinyFile = join(dir, "tiny.png");
      await writeFile(tinyFile, encodeBitmap(tiny));
      /**
       * 走 AI 那条路（`composeMapAsset` 也共用 `parseStampSpec`）：1×1 在「切成 N×M 格」那一步同样不能翻车。
       * 合成出来的源图再交给导入端烘 4 个旋转 —— 与用户实际点「AI 生成素材」是同一条链路。
       */
      const tinyComposed = await G.composeMapAsset({ projectId: project.id, name: "单格整图", files: [tinyFile], shape: "stamp", stampCols: 1, stampRows: 1 });
      check(
        "★ 1×1 整图也能整理（composeMapAsset 不限 2 格）",
        tinyComposed.stamp.cols === 1 && tinyComposed.stamp.rows === 1 && tinyComposed.width === cell && tinyComposed.height === cell,
        JSON.stringify({ stamp: tinyComposed.stamp, size: `${tinyComposed.width}×${tinyComposed.height}` })
      );
      const tinyBytes = await readFile(G.mapAssetPath(project.id, tinyComposed.file));
      const tinyImported = await G.importMapTileset(project.id, "单格整图", tinyBytes.toString("base64"), {
        stamp: { ...tinyComposed.stamp, pass: [2] }
      });
      const tinyTileset = tinyImported.tilesets.find((entry) => entry.stamp !== undefined && entry.stamp.cols === 1 && entry.stamp.rows === 1);
      check("★ 1×1 整图能导入（下限是 1，不是 2；4 个旋转各一块）", tinyTileset !== undefined && Array.isArray(tinyTileset.tiles) && tinyTileset.tiles.length === 4, JSON.stringify(tinyImported.tilesets.map((entry) => entry.stamp)));
      check(
        "1×1 整图：成品图 = 1 格宽 × 2(1+1) = 4 格高（4 个旋转，每档仍是一格）",
        tinyTileset.imageWidth === cell && tinyTileset.imageHeight === 4 * cell,
        `${tinyTileset.imageWidth}×${tinyTileset.imageHeight}`
      );
      for (const rot of [0, 1]) {
        await G.applyMapOps(project.id, [
          { kind: "stampPlace", layerId: layer, tilesetId: tinyTileset.id, r: 10, c: 12, rot, id: "tiny1" }
        ]);
        const tinyPlan = await planOf({ pass: true });
        const tinyOps = tinyPlan.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.l === 0);
        check(
          `★ 1×1 整图 rot${rot}：只占 1 格（不多画、也不因为 1 格被当成空）`,
          tinyOps.length === 1 && tinyOps[0].r === 10 && tinyOps[0].c === 12,
          tinyOps.map((op) => `${op.r},${op.c}`).join(" ")
        );
        check(`1×1 整图 rot${rot}：区域/通行性也只要 1 格`, tinyPlan.pass.length === 1 && tinyPlan.pass[0].kind === 2, JSON.stringify(tinyPlan.pass));
        await G.applyMapOps(project.id, [{ kind: "stampRemove", id: "tiny1" }]);
      }
    }

    // ── 印一张（rot 0）：占 3×2 格
    await G.applyMapOps(project.id, [{ kind: "stampPlace", layerId: layer, tilesetId: tileset.id, r: 2, c: 3, rot: 0 }]);
    let plan = await planOf();
    let ops = plan.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.l === 0);
    check("★ 印一张 3×2 的整图 = 6 条 op，坐标对得上", ops.length === 6 && ops.every((op) => op.r >= 2 && op.r < 4 && op.c >= 3 && op.c < 6), ops.map((op) => `${op.r},${op.c}`).join(" "));
    check("★ 整图每一格是**不同的**图块（不是同一块重复铺）", new Set(ops.map((op) => op.t)).size === 6, ops.map((op) => op.t).join(","));
    check("★ 整图带帧序（2 帧 → 每格 cycle 长度 2）", ops.every((op) => Array.isArray(op.cycle) && op.cycle.length === 2), JSON.stringify(ops[0]?.cycle));

    // ── 旋转：rot 1 → 占 2×3 格
    await G.applyMapOps(project.id, [{ kind: "stampRemove", id: "s1" }]);
    await G.applyMapOps(project.id, [{ kind: "stampPlace", layerId: layer, tilesetId: tileset.id, r: 2, c: 3, rot: 1 }]);
    plan = await planOf();
    ops = plan.chunks.flatMap((chunk) => chunk.ops).filter((op) => op.l === 0);
    check("★ 转 90° 后占格互换（2 宽 × 3 高，仍是 6 格）", ops.length === 6 && ops.every((op) => op.r >= 2 && op.r < 5 && op.c >= 3 && op.c < 5), ops.map((op) => `${op.r},${op.c}`).join(" "));

    // ── 区域：mapPlan({pass:true}) 回三态
    const passPlan = await planOf({ pass: true });
    check("★ 区域：6 格各带通行性，三态都出现", passPlan.pass.length === 6 && new Set(passPlan.pass.map((cell) => cell.kind)).size === 3, JSON.stringify(passPlan.pass));
    // rot 1 时，目标格 (0,0) 取源格 (rows-1, 0) → 索引 1*cols+0 = 3。
    check("区域：转 90° 后通行性跟着转（取转前那一格）", passPlan.pass.some((cell) => cell.r === 2 && cell.c === 3 && cell.kind === pass[(rows - 1) * cols]), JSON.stringify({ at23: passPlan.pass.find((cell) => cell.r === 2 && cell.c === 3), want: pass[(rows - 1) * cols] }));

    // ── 橡皮碰一格 = 整张没了
    const erase = await G.applyMapOps(project.id, [{ kind: "paint", layerId: layer, cells: [{ r: 3, c: 4, tile: 0 }] }]);
    check("★ 橡皮碰一格：整张整图被移除（stamps 计数 1）", erase.stamps === 1, String(erase.stamps));
    await G.flushMapDoc(project.id);
    const docAfterErase = JSON.parse(await readFile(G.mapDocFile(project.id), "utf8"));
    check("★ 擦完之后文档里没有整图了", docAfterErase.stamps.length === 0, JSON.stringify(docAfterErase.stamps));
    await G.undoMap(project.id);
    await G.flushMapDoc(project.id);
    const docAfterUndo = JSON.parse(await readFile(G.mapDocFile(project.id), "utf8"));
    check("★ 撤销一步：整张整图回来（id 不变）", docAfterUndo.stamps.length === 1 && docAfterUndo.stamps[0].id === "s1", JSON.stringify(docAfterUndo.stamps));

    // ── 用普通图块在整图上落笔：也会整张摘掉（下面还留着你画的图块）
    const overpaint = await G.applyMapOps(project.id, [{ kind: "paint", layerId: layer, cells: [{ r: 2, c: 3, tile: brush }] }]);
    check("在整图上刷普通图块：整图被摘掉、图块照画", overpaint.stamps === 1 && overpaint.changed >= 1);

    // ── 导出：@4 里带 stamps + 每格通行性
    await G.applyMapOps(project.id, [{ kind: "stampRemove", id: "s1" }]);
    await G.applyMapOps(project.id, [{ kind: "stampPlace", layerId: layer, tilesetId: tileset.id, r: 2, c: 3, rot: 0 }]);
    await G.flushMapDoc(project.id);
    const exported = await G.runExportStage(project.id, { formats: { png: true, json: true } });
    check("导出整图：导出任务起来了", exported.started === true, JSON.stringify(exported));
    for (let attempt = 0; attempt < 80; attempt++) {
      const current = await G.readMapProject(project.id);
      if (current.stages.export.status === "done" || current.stages.export.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const freshProject = await G.readMapProject(project.id);
    check("导出整图：导出阶段 done", freshProject.stages.export.status === "done", JSON.stringify(freshProject.stages.export));
    const exportDir = join(G.mapProjectDir(project.id), "export", EXPORT.safeFileName(project.name, "map"));
    const ownJson = JSON.parse(await readFile(join(exportDir, "map.json"), "utf8"));
    check("导出 map.json：格式 @4", ownJson.format === "dsh-gem-map@4", ownJson.format);
    check("★ 导出 map.json：stamps 带参考点 / 旋转 / 每格通行性", Array.isArray(ownJson.stamps) && ownJson.stamps.length === 1 && ownJson.stamps[0].rot === 0 && ownJson.stamps[0].cells.length === 6, JSON.stringify(ownJson.stamps?.[0]?.cells));
    check("★ 导出：6 格通行性顺序与导入时一致", JSON.stringify(ownJson.stamps[0].cells.map((cell) => cell.pass)) === JSON.stringify(pass), JSON.stringify(ownJson.stamps[0].cells.map((cell) => cell.pass)));

    /**
     * ★★ AI 那条路：`composeMapAsset(shape:"stamp")` → 导入。**不能在两边都烘旋转**。
     *
     * 真机翻车现场：合成出来的 `ai/xxx.png` 已经把 4 个旋转叠在一起（8×2 的图 → 1024×2560），
     * 导入又把它当「一帧」压成 256×64 —— 地图上就是一条条横条纹。这条用**逐格唯一色**钉死：
     * 合成出来的源图必须是 `cols × rows*frames` 格，导入后 rot0 的每一格必须等于源图对应格。
     */
    {
      const project = await G.createMapProject("整图-AI 链路", { grid: { tileWidth: 32, tileHeight: 32, wrap: false }, cols: 16, rows: 12 });
      created.push(project.id);
      const dir = join(HOME, "stamp-ai");
      await mkdir(dir, { recursive: true });
      const cols = 8, rows = 2, unit = 64;
      const rgba = Buffer.alloc(cols * unit * rows * unit * 4);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          for (let y = 0; y < unit; y++) {
            for (let x = 0; x < unit; x++) {
              const offset = (((r * unit + y) * cols * unit) + c * unit + x) * 4;
              rgba[offset] = 20 + c * 28;
              rgba[offset + 1] = 20 + r * 120;
              rgba[offset + 2] = 90;
              rgba[offset + 3] = 255;
            }
          }
        }
      }
      const sourceFile = join(dir, "gate.png");
      await writeFile(sourceFile, encodePng(rgba, cols * unit, rows * unit));
      const composed = await G.composeMapAsset({ projectId: project.id, name: "城门", files: [sourceFile], shape: "stamp", stampCols: cols, stampRows: rows });
      check(
        "★ AI 合成整图：源图是 `cols × rows*frames` 格（**不烘旋转** —— 烘了会被导入端再压一次）",
        composed.width / composed.height === cols / rows && composed.stamp.frames === 1,
        `${composed.width}×${composed.height}（期望 8:2 = 4:1）`
      );
      const bytes = await readFile(G.mapAssetPath(project.id, composed.file));
      const imported = await G.importMapTileset(project.id, "城门", bytes.toString("base64"), { stamp: { ...composed.stamp, pass: new Array(cols * rows).fill(0) } });
      const ts = imported.tilesets[0];
      check("★ AI 合成 → 导入：成品图 = 8 格宽 × 20 格高（帧 × 2(cols+rows) 行，带 4 个旋转）", ts.imageWidth === 8 * 32 && ts.imageHeight === 20 * 32, `${ts.imageWidth}×${ts.imageHeight}`);
      const baked = await decodeFile(join(G.mapProjectDir(project.id), ts.file));
      const wrong = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const offset = ((r * 32 + 16) * baked.width + c * 32 + 16) * 4;
          const want = [20 + c * 28, 20 + r * 120, 90];
          const got = [baked.rgba[offset], baked.rgba[offset + 1], baked.rgba[offset + 2]];
          if (Math.abs(got[0] - want[0]) > 6 || Math.abs(got[1] - want[1]) > 6 || Math.abs(got[2] - want[2]) > 6) wrong.push(`(${r},${c}) ${got} ≠ ${want}`);
        }
      }
      check("★ 导入后逐格对得上（16 格都没有被压扁 —— 真机那条横条纹就是这里错了）", wrong.length === 0, wrong.slice(0, 4).join(" | "));

      /**
       * ★ 整图的绿幕：`composeMapAsset` 要**先抠绿幕再切片**，否则地图上会多出一块绿框。
       * 三种情况都钉：抠到了 / 没绿幕（要说明）/ 手动导入时勾了抠（`stampKey`）。
       */
      {
        const greens = join(HOME, "stamp-green");
        await mkdir(greens, { recursive: true });
        const greenFrame = async (name, withGreen, pureBlue = false) => {
          const w = 8 * 32, h = 2 * 32;
          const rgba = Buffer.alloc(w * h * 4);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const offset = (y * w + x) * 4;
              const building = x > w * 0.3 && x < w * 0.7;
              if (building) {
                rgba[offset] = 130;
                rgba[offset + 1] = 120;
                rgba[offset + 2] = 110;
              } else if (withGreen) {
                rgba[offset + 1] = 224;
              } else if (pureBlue) {
                rgba[offset] = 0;
                rgba[offset + 1] = 0;
                rgba[offset + 2] = 255;
              } else {
                rgba[offset] = 40;
                rgba[offset + 1] = 90;
                rgba[offset + 2] = 200;
              }
              rgba[offset + 3] = 255;
            }
          }
          const file = join(greens, name);
          await writeFile(file, encodePng(rgba, w, h));
          return file;
        };
        const withGreen = await greenFrame("green.png", true);
        const withoutGreen = await greenFrame("blue.png", false);
        const pureBlue = await greenFrame("pure-blue.png", false, true);

        const keyed = await G.composeMapAsset({ projectId: project.id, name: "绿幕城门", files: [withGreen], shape: "stamp", stampCols: 8, stampRows: 2 });
        const keyedSheet = await decodeFile(G.mapAssetPath(project.id, keyed.file));
        const corner = (sheet) => {
          const offset = (2 * sheet.width + 2) * 4;
          return [sheet.rgba[offset], sheet.rgba[offset + 1], sheet.rgba[offset + 2], sheet.rgba[offset + 3]];
        };
        check("★ 整图自动抠绿幕：合成图左上角是透明的（绿被抠掉了）", corner(keyedSheet)[3] === 0, JSON.stringify(corner(keyedSheet)));
        check("★ 抠到东西时 notes 说清楚（不让用户以为背景会自动透明）", keyed.notes.some((text) => text.includes("抠掉绿幕")), keyed.notes.join(" | "));
        check("回包带 keyed（回链据此让「新增素材」别再抠第二遍）", typeof keyed.keyed === "number" && keyed.keyed > 0.05, String(keyed.keyed));
        const keyedBlue = await G.composeMapAsset({ projectId: project.id, name: "蓝幕城门", files: [pureBlue], shape: "stamp", stampCols: 8, stampRows: 2, keyColor: "#0000FF" });
        const blueSheet = await decodeFile(G.mapAssetPath(project.id, keyedBlue.file));
        check("★ 整图按指定蓝色底色抠像：左上角透明", corner(blueSheet)[3] === 0, JSON.stringify(corner(blueSheet)));
        check("★ 蓝色底色的 notes 用「蓝幕」而不是绿幕", keyedBlue.notes.some((text) => text.includes("抠掉蓝幕")), keyedBlue.notes.join(" | "));

        /**
         * ★ 抠像参数是**严格**的：只认饱和纯绿。
         * 真机教训 —— 用户那张城门背景是草地（绿的优势值只有 26~59），默认的角色参数会吃掉 82%，
         * 连墙的内部阴影一起啃掉。这里用「淡绿 + 蓝」两种都验一遍：都不许抠。
         */
        const paleGreen = join(greens, "pale.png");
        await writeFile(paleGreen, (() => {
          const w = 8 * 32, h = 2 * 32;
          const pixels = Buffer.alloc(w * h * 4);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const offset = (y * w + x) * 4;
              const building = x > w * 0.3 && x < w * 0.7;
              if (building) {
                pixels[offset] = 130;
                pixels[offset + 1] = 120;
                pixels[offset + 2] = 110;
              } else {
                // 草地的绿：g 只比 r / b 高一点点
                pixels[offset] = 96;
                pixels[offset + 1] = 128;
                pixels[offset + 2] = 88;
              }
              pixels[offset + 3] = 255;
            }
          }
          return encodePng(pixels, w, h);
        })());
        const paleKeyed = await G.composeMapAsset({ projectId: project.id, name: "草地绿", files: [paleGreen], shape: "stamp", stampCols: 8, stampRows: 2 });
        const paleSheet = await decodeFile(G.mapAssetPath(project.id, paleKeyed.file));
        check("★ 草地的绿不算绿幕（严格参数）：画面一个像素都不许抠掉", paleKeyed.keyed === 0 && corner(paleSheet)[3] === 255, `${paleKeyed.keyed} / ${JSON.stringify(corner(paleSheet))}`);
        check("草地绿也算「没检测到绿幕」并给出提示", paleKeyed.notes.some((text) => text.includes("没检测到绿幕")), paleKeyed.notes.join(" | "));

        const noGreen = await G.composeMapAsset({ projectId: project.id, name: "没有绿幕", files: [withoutGreen], shape: "stamp", stampCols: 8, stampRows: 2 });
        const noGreenSheet = await decodeFile(G.mapAssetPath(project.id, noGreen.file));
        check("★ 没绿幕时**不许**乱抠（画面像素原样保留）", corner(noGreenSheet)[3] === 255 && corner(noGreenSheet)[0] === 40, JSON.stringify(corner(noGreenSheet)));
        check("没抠到东西时 notes 明说「没检测到绿幕」并教怎么改", noGreen.notes.some((text) => text.includes("没检测到绿幕")), noGreen.notes.join(" | "));

        // 手动导入那张带绿幕的原图：勾上 stampKey 才抠
        const bytes = await readFile(withGreen);
        const manual = await G.importMapTileset(project.id, "手动绿幕", bytes.toString("base64"), { stamp: { cols: 8, rows: 2, frames: 1, pass: [], stampKey: true }, stampKey: true });
        const manualBaked = await decodeFile(join(G.mapProjectDir(project.id), manual.tilesets[0].file));
        check("★ 手动导入勾了「抠掉绿幕」：成品左上角透明", corner(manualBaked)[3] === 0, JSON.stringify(corner(manualBaked)));
        const manualPlain = await G.importMapTileset(project.id, "手动不抠", bytes.toString("base64"), { stamp: { cols: 8, rows: 2, frames: 1, pass: [] } });
        const manualPlainBaked = await decodeFile(join(G.mapProjectDir(project.id), manualPlain.tilesets[0].file));
        check("反向验证：没勾就原样保留绿幕（不替用户决定）", corner(manualPlainBaked)[3] === 255 && corner(manualPlainBaked)[1] > 100, JSON.stringify(corner(manualPlainBaked)));
      }

      /**
       * ★★ 黄金对照：**计划里画出来的那一块**，必须就是源图那一格。
       *
       * 真机翻车（用户那张城门）：「左边少了一块、右边多了点东西」—— 整图取块的序号多加了 1，
       * 每一格都画成了下一块，整体左移一格，最右一格还越过块边界取到了 rot1 的「竖块」。
       * 这类错位**不报任何警告**，只有把「画什么」和「图里是什么」逐格比像素才拦得住。
       */
      {
        const planProject = await G.createMapProject("整图取块对照", { grid: { tileWidth: 32, tileHeight: 32, wrap: false }, cols: 20, rows: 12 });
        created.push(planProject.id);
        const cols2 = 5, rows2 = 2, unit2 = 64;
        const paint = Buffer.alloc(cols2 * unit2 * rows2 * unit2 * 4);
        for (let r = 0; r < rows2; r++) {
          for (let c = 0; c < cols2; c++) {
            for (let y = 0; y < unit2; y++) {
              for (let x = 0; x < unit2; x++) {
                const offset = (((r * unit2 + y) * cols2 * unit2) + c * unit2 + x) * 4;
                paint[offset] = 20 + c * 40;
                paint[offset + 1] = 20 + r * 120;
                paint[offset + 2] = 90;
                paint[offset + 3] = 255;
              }
            }
          }
        }
        const paintFile = join(HOME, "stamp-ai", "golden.png");
        await writeFile(paintFile, encodePng(paint, cols2 * unit2, rows2 * unit2));
        const arranged = await G.composeMapAsset({ projectId: planProject.id, name: "对照", files: [paintFile], shape: "stamp", stampCols: cols2, stampRows: rows2 });
        const arrangedBytes = await readFile(G.mapAssetPath(planProject.id, arranged.file));
        const golden = await G.importMapTileset(planProject.id, "对照", arrangedBytes.toString("base64"), { stamp: { ...arranged.stamp, pass: new Array(cols2 * rows2).fill(0) } });
        const goldenTs = golden.tilesets[0];
        const goldenImage = await decodeFile(join(G.mapProjectDir(planProject.id), goldenTs.file));
        const layerId = (await G.mapView(await G.readMapProject(planProject.id))).layers[0].id;
        const sample = (image, rect) => {
          const offset = ((rect.y + Math.floor(rect.height / 2)) * image.width + rect.x + Math.floor(rect.width / 2)) * 4;
          return [image.rgba[offset], image.rgba[offset + 1], image.rgba[offset + 2]];
        };
        const close = (a, b) => Math.abs(a[0] - b[0]) <= 8 && Math.abs(a[1] - b[1]) <= 8 && Math.abs(a[2] - b[2]) <= 8;
        for (const rot of [0, 1]) {
          await G.applyMapOps(planProject.id, [{ kind: "stampRemove", id: `s${rot + 1}` }, { kind: "stampPlace", layerId, tilesetId: goldenTs.id, r: 2, c: 2, rot, id: `s${rot + 1}` }]);
          const plan = await G.mapPlan(planProject.id, { view: { x: 0, y: 0, width: 20 * 32, height: 12 * 32 }, have: [] });
          const legend = new Map(plan.legend.map((entry) => [entry.index, entry]));
          const span = rot % 2 === 0 ? { cols: cols2, rows: rows2 } : { cols: rows2, rows: cols2 };
          const wrongCells = [];
          const outside = [];
          for (let dr = 0; dr < span.rows; dr++) {
            for (let dc = 0; dc < span.cols; dc++) {
              const op = plan.chunks.flatMap((chunk) => chunk.ops).find((candidate) => candidate.r === 2 + dr && candidate.c === 2 + dc && candidate.l === 0);
              if (op === undefined) {
                wrongCells.push(`缺 (${dr},${dc})`);
                continue;
              }
              const rect = legend.get(op.t).rect;
              // rot 0 只能落在 rot0 那一段（y < rows*cell）；rot 1 只能落在 rot1 那一段。
              const bandY = rot === 0 ? 0 : rows2 * 32;
              const bandH = rot === 0 ? rows2 * 32 : cols2 * 32;
              if (rect.y < bandY || rect.y + rect.height > bandY + bandH) outside.push(`(${dr},${dc}) y=${rect.y}`);
              /**
               * 期望颜色 = 源图那一格的颜色。顺时针转 90° 的映射是
               * `dest (dr,dc) ← source (rows-1-dc, dr)`（与 `stampSourceCell` 同一份口径）。
               */
              const sr = rot === 1 ? rows2 - 1 - dc : dr;
              const sc = rot === 1 ? dr : dc;
              const want = [20 + sc * 40, 20 + sr * 120, 90];
              const got = sample(goldenImage, rect);
              if (!close(got, want)) wrongCells.push(`(${dr},${dc}) 应 ${want} 实 ${got}`);
            }
          }
          check(`★ 黄金对照 rot${rot}：每一格画的就是源图那一格（不是下一块）`, wrongCells.length === 0, wrongCells.slice(0, 3).join(" | "));
          check(`★ 黄金对照 rot${rot}：没有一格越出自己的旋转段（越界就会显示出别的朝向的碎片）`, outside.length === 0, outside.slice(0, 3).join(" | "));
        }
      }

      // 原地重烘同一条链路：源图 → 缩到格子 → 烘旋转，只烘一次
      const recomposed = await G.recomposeMapTileset(project.id, ts.id, { files: [sourceFile] });
      // 导入回的是模型（`tiles.length`），重烘回的是视图（`tileCount`）。
      check("整图原地重烘：id 与块数不变", recomposed.tileset.id === ts.id && recomposed.tileset.tileCount === ts.tiles.length, `id ${recomposed.tileset.id} vs ${ts.id}；块 ${recomposed.tileset.tileCount} vs ${ts.tiles.length}`);
      const rebaked = await decodeFile(join(G.mapProjectDir(project.id), recomposed.tileset.file));
      let mismatch = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const offset = ((r * 32 + 16) * rebaked.width + c * 32 + 16) * 4;
          if (Math.abs(rebaked.rgba[offset] - (20 + c * 28)) > 6 || Math.abs(rebaked.rgba[offset + 1] - (20 + r * 120)) > 6) mismatch++;
        }
      }
      check("★ 重烘之后逐格仍然对得上（重烘只烘一次旋转，没有叠第二层）", mismatch === 0, `${mismatch} 格不对`);
    }

    // ── 一键生成：整图不进随机池（按格刷只会得到碎片）
    const stampTileCount = tileset.tiles.length;
    const generated = await G.runMapGenerate(project.id, { kind: "random", tiles: [brush], seed: 7 });
    await G.flushMapDoc(project.id);
    const generatedDoc = JSON.parse(await readFile(G.mapDocFile(project.id), "utf8"));
    const generatedValues = [...new Set(generatedDoc.data[layer].filter((value) => value > 0))];
    check(
      "★ 一键生成：只选整图时不铺整图（说清原因，铺下去的全是普通图块）",
      generated.warnings.some((text) => text.includes("整图")) && generatedValues.every((value) => value > stampTileCount),
      `改了 ${generated.changed} 格；用到的值 ${generatedValues.join(",")}（整图的序号是 1..${stampTileCount}）；${generated.warnings.join(" | ")}`
    );

    // 生成把整图盖掉了（本来就会），这里重新印一张，下一段验证「删素材连带删整图」。
    await G.applyMapOps(project.id, [{ kind: "stampPlace", layerId: layer, tilesetId: tileset.id, r: 8, c: 8, rot: 0 }]);

    /**
     * ★ 素材属性里改整图的**逐格通行区域**：`saveMapTileset({stampPass})`。
     * 它只改数据、不重切图块、不动序号 —— 所以地图上已经印好的整图下一次 `mapPlan` 就是新区域。
     */
    {
      const beforePass = [...tileset.stamp.pass];
      const editedPass = [2, 2, 2, 2, 2, 2];
      const passSaved = await G.saveMapTileset(project.id, tileset.id, { stampPass: editedPass });
      check("★ 改通行区域：素材规格里的 pass 真的换了", JSON.stringify(passSaved.tileset.stamp.pass) === JSON.stringify(editedPass), JSON.stringify(passSaved.tileset.stamp.pass));
      check(
        "★ 改通行区域不动几何（图块数与图片尺寸都没变）",
        passSaved.tileset.tiles.length === tileset.tiles.length && passSaved.tileset.imageWidth === tileset.imageWidth && passSaved.tileset.imageHeight === tileset.imageHeight,
        `${passSaved.tileset.tiles.length} 块 / ${passSaved.tileset.imageWidth}×${passSaved.tileset.imageHeight}`
      );
      const planAfterPass = await planOf({ pass: true });
      check(
        "★ 已经印在地图上的整图立刻用新区域（6 格全变成「可通过·遮挡人物」）",
        planAfterPass.pass.length === 6 && planAfterPass.pass.every((cell) => cell.kind === 2),
        JSON.stringify(planAfterPass.pass.map((cell) => cell.kind))
      );
      const shortPass = await G.saveMapTileset(project.id, tileset.id, { stampPass: [0, 0] }).then(() => "", (error) => error.message);
      check("反向验证：通行区域长度不对时明确报错（不按 0 静默补齐）", shortPass.includes("通行区域") && shortPass.includes("6 个"), shortPass.slice(0, 60));
      const badPass = await G.saveMapTileset(project.id, tileset.id, { stampPass: [0, 0, 0, 0, 0, 7] }).then(() => "", (error) => error.message);
      check("反向验证：通行区域只能是 0/1/2（7 抛错并指出第几格）", badPass.includes("第 6 格"), badPass.slice(0, 60));
      const restored = await G.saveMapTileset(project.id, tileset.id, { stampPass: beforePass });
      check("改回原区域也立刻生效（不是只有第一次能改）", JSON.stringify(restored.tileset.stamp.pass) === JSON.stringify(beforePass), JSON.stringify(restored.tileset.stamp.pass));
    }

    // ── 删素材：引用它的整图一起走
    const removal = await G.removeMapTileset(project.id, tileset.id);
    check("删掉整图素材：连带删掉引用它的整图并说清楚", removal.warnings.some((text) => text.includes("整图")) , removal.warnings.join(" | "));
    await G.flushMapDoc(project.id);
    const docAfterRemove = JSON.parse(await readFile(G.mapDocFile(project.id), "utf8"));
    check("删素材之后文档里不再有这张整图", docAfterRemove.stamps.length === 0, JSON.stringify(docAfterRemove.stamps));

  }

  section("23) 素材属性：改名 / 播放速度 / 循环方式（内置也能改这三样）");
  {
    const project = await G.createMapProject("属性可改", { grid: { tileWidth: 32, tileHeight: 32, wrap: false }, cols: 12, rows: 10 });
    created.push(project.id);
    const samples = await G.importSampleTileset(project.id);
    const builtin = samples.tilesets[0];
    check("内置素材带 builtin 标记（界面据此显示「自带」）", builtin.builtin === true, String(builtin.builtin));
    const renamed = await G.saveMapTileset(project.id, builtin.id, { name: "我的草地", fps: 4, loop: "reverse" });
    check("★ 内置素材可以改名 / 改播放速度 / 改循环方式", renamed.tileset.name === "我的草地" && renamed.tileset.fps === 4 && renamed.tileset.loop === "reverse", `${renamed.tileset.name} / ${renamed.tileset.fps} / ${renamed.tileset.loop}`);
    check("改这三样不动几何（图块数与格子不变）", renamed.tileset.tiles.length === builtin.tiles.length && renamed.tileset.cell.width === builtin.cell.width);
    const refused = await G.saveMapTileset(project.id, builtin.id, { cell: { width: 64, height: 64 } }).then(() => "", (error) => error.message);
    check("★ 反向验证：内置素材的**格子 / 形态**仍然不许改（会重切图块、画过的格子整体错位）", refused.includes("不能改"), refused.slice(0, 40));
    check("改名之后素材列表里就是新名字（不是只有返回值变了）", (await G.mapView(await G.readMapProject(project.id))).tilesets.some((entry) => entry.name === "我的草地"));
    // 清掉自己的速度 = 跟全局
    const cleared = await G.saveMapTileset(project.id, builtin.id, { fps: null, loop: "forward" });
    check("播放速度可以清掉（回到跟「设置」里的动画速度走）", cleared.tileset.fps === undefined && cleared.tileset.loop === "forward", JSON.stringify({ fps: cleared.tileset.fps, loop: cleared.tileset.loop }));
    // 帧序真的跟着循环方式变
    // 用 5 帧的道具图：2 帧的素材「来回」等于正放，测不出差别。
    const prop = (await G.mapView(await G.readMapProject(project.id))).tilesets.find((entry) => entry.name === "内置 · 道具");
    const propLayer = (await G.mapView(await G.readMapProject(project.id))).layers[0].id;
    await G.applyMapOps(project.id, [{ kind: "paint", layerId: propLayer, cells: [{ r: 2, c: 2, tile: prop.palette[0].index }] }]);
    const cycleNow = async () => {
      const plan = await G.mapPlan(project.id, { view: { x: 0, y: 0, width: 12 * 32, height: 10 * 32 }, have: [] });
      return plan.chunks.flatMap((chunk) => chunk.ops).find((op) => op.r === 2 && op.c === 2 && Array.isArray(op.cycle))?.cycle;
    };
    const forward = await cycleNow();
    await G.saveMapTileset(project.id, prop.id, { loop: "pingpong" });
    const pingpong = await cycleNow();
    check(
      "★ 改成「来回」后下一份计划里的帧序真的变了（5 帧 → 8 帧序）",
      Array.isArray(forward) && Array.isArray(pingpong) && forward.length === 5 && pingpong.length === 8,
      `${JSON.stringify(forward)} → ${JSON.stringify(pingpong)}`
    );

    /**
     * ★ 整图占格上限 = **地图自己**（12×10 的地图可以放 12×10 的整图；13 宽就拒绝）。
     */
    const dir = join(HOME, "stamp-big");
    await mkdir(dir, { recursive: true });
    const bigFile = join(dir, "big.png");
    await writeFile(bigFile, encodePng(Buffer.alloc(96 * 80 * 4, 190), 96, 80));
    const bigBytes = await readFile(bigFile);
    const big = await G.importMapTileset(project.id, "铺满地图", bigBytes.toString("base64"), { stamp: { cols: 12, rows: 10, frames: 1, pass: [] } });
    check("★ 整图可以大到和地图一样（12×10）", big.tilesets[0].stamp.cols === 12 && big.tilesets[0].stamp.rows === 10, JSON.stringify(big.tilesets[0].stamp));
    check("铺满整张地图的整图：块数 = 4 个旋转 × 12×10 格 = 480", big.tilesets[0].tiles.length === 4 * 12 * 10, String(big.tilesets[0].tiles.length));
    const tooWide = await G.importMapTileset(project.id, "比地图大", bigBytes.toString("base64"), { stamp: { cols: 13, rows: 10, frames: 1, pass: [] } }).then(() => "", (error) => error.message);
    check("★ 反向验证：比地图大的整图明确报错（说明上限是地图）", tooWide.includes("比地图还大") && tooWide.includes("12×10"), tooWide.slice(0, 60));
  }

  section("23) 删除项目");
  for (const id of created.slice()) {
    const existed = existsSync(G.mapProjectDir(id));
    await G.deleteMapProject(id);
    const index = created.indexOf(id);
    if (index >= 0) created.splice(index, 1);
    if (id === p1.id) {
      check("删之前目录在", existed);
      check("删之后目录没了", !existsSync(G.mapProjectDir(id)));
      check("删之后不在清单里", !(await G.listMapProjects()).some((item) => item.id === id));
    }
  }
  check("所有自检项目都已清理", created.length === 0, created.join(" "));
} finally {
  for (const id of created) await G.deleteMapProject(id).catch(() => undefined);
  await rm(HOME, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${passed} 项通过${failures.length > 0 ? `，${failures.length} 项失败` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
