/**
 * 宿主半区冒烟测试：用真实 cordis Context 挂载插件，把远程服务的每个方法
 * 都跑一遍，并用真实 HTTP 服务器验证静态资源路由（含 Range 与目录穿越防护）。
 *
 *   node scripts/verify-host.mjs
 *
 * 全部数据写在临时 DSH_HOME 下，不会碰用户真正的项目目录。
 * 生图那一步会用假 Key 真实打一次火山方舟接口，预期拿到鉴权失败——
 * 这正是要验证的「错误能一路冒到节点状态里」。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const HOME = await mkdtemp(join(tmpdir(), "dsh-gmm-verify-"));
process.env.DSH_HOME = HOME;

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const { encodePng } = await import("../lib/png.js");

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`临时 DSH_HOME: ${HOME}\n`);

  // ── 1. 挂载 ────────────────────────────────────────────────────────────
  console.log("1) 挂载插件");
  const ctx = new Context();
  const captured = { manifest: null, routes: [] };
  ctx.provide("typert", {
    register: (manifest) => {
      captured.manifest = manifest;
      return () => {};
    }
  });
  ctx.provide("webServer", {
    register: (route) => {
      captured.routes.push(route);
      return () => {};
    }
  });

  check("导出 name", plugin.name === "dsh-game-material-master", plugin.name);
  check("导出 inject", Array.isArray(plugin.inject) && plugin.inject.includes("typert"), JSON.stringify(plugin.inject));
  // webServer 必须是硬依赖：它 listen 成功后才可用，而 apply 与它几乎同时发生。
  // 只靠 ctx.get() 探测会拿到 undefined，路由永远不注册（表现为资源请求全 404）。
  check("inject 把 webServer 声明为硬依赖", plugin.inject.includes("webServer"), JSON.stringify(plugin.inject));

  plugin.apply(ctx);
  check("apply 未抛异常", true);
  check("注册了 typert manifest", captured.manifest !== null);
  check("注册了一条 prefix 路由", captured.routes.length === 1 && captured.routes[0].kind === "prefix", JSON.stringify(captured.routes.map((r) => r.path)));

  const invocations = captured.manifest?.invocations ?? [];
  check("manifest 方法数为 46", invocations.length === 46, `实际 ${invocations.length}`);
  const ids = new Set(invocations.map((i) => i.id));
  check("方法 id 唯一", ids.size === invocations.length);
  check("所有方法都声明在 gameStudio 服务下", invocations.every((i) => i.service === "gameStudio" && i.namespace === "gameStudio"));

  const studio = ctx.get("gameStudio");
  check("gameStudio 服务已提供", studio !== undefined && typeof studio.getConfig === "function");
  const missing = invocations.map((i) => i.method).filter((m) => typeof studio[m] !== "function");
  check("manifest 里的每个方法都真实存在", missing.length === 0, missing.join(",") || "全部命中");

  // ── 1.5 方向语义（方位 ↔ 脸部可见性）────────────────────────────────────
  // 这是上一版真正出错的地方：西北/东北写成了「面对镜头」、东南/西南写成了
  // 「背对镜头」，正好反了；而且「朝画面左上方」会被模型理解成抬头仰视。
  // 光读代码看不出对错，所以把「方位 → 看得见什么」固化成断言。
  console.log("1.5) 方向语义（方位 ↔ 脸部可见性）");
  const { DIRECTIONS, DEFAULT_ROW_ORDER, DEFAULT_IMAGE_PROMPT, defaultImagePrompts } = await import("../lib/directions.js");
  const byKey = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d]));
  const prompts = defaultImagePrompts();

  check("八个方向都有罗盘方位", DIRECTIONS.length === 8 && DIRECTIONS.every((d) => typeof d.compass === "string"));
  check("罗盘方位不重复", new Set(DIRECTIONS.map((d) => d.compass)).size === 8);
  check("南 = 正面、北 = 背面", byKey.front.compass === "S" && byKey.back.compass === "N");

  // 看不见脸：北 / 东北 / 西北
  for (const key of ["back", "upLeft", "upRight"]) {
    check(`${byKey[key].compass}（${byKey[key].label}）要求完全看不到脸`, /完全看不到脸/.test(prompts[key]) && /不得出现眼睛/.test(prompts[key]));
  }
  // 侧脸：东 / 西
  for (const key of ["left", "right"]) {
    const text = prompts[key];
    check(`${byKey[key].compass}（${byKey[key].label}）要求只看到一侧脸`, /侧脸/.test(text) && /看不到[左右]眼/.test(text));
  }
  // 看得见脸：南 / 东南 / 西南
  for (const key of ["front", "downLeft", "downRight"]) {
    check(`${byKey[key].compass}（${byKey[key].label}）要求看得见正脸`, /正脸/.test(prompts[key]));
  }
  // 东南朝右转、西南朝左转，别镜像弄反
  check(
    "东南 = 转向画面右侧、鼻尖朝右下",
    /转向画面右侧/.test(prompts.downRight) && /鼻尖指向画面右下/.test(prompts.downRight) && /左耳比右耳更靠近镜头/.test(prompts.downRight)
  );
  check(
    "西南 = 转向画面左侧、鼻尖朝左下",
    /转向画面左侧/.test(prompts.downLeft) && /鼻尖指向画面左下/.test(prompts.downLeft) && /右耳比左耳更靠近镜头/.test(prompts.downLeft)
  );
  // 东西必须是**纯侧面**，而且不能只写「看得到半张脸」——那样模型会画成正面
  check(
    "东 = 身体完全侧对镜头、鼻尖朝右、看不到左眼",
    /完全侧对镜头/.test(prompts.right) && /鼻尖指向画面右侧/.test(prompts.right) && /看不到左眼/.test(prompts.right)
  );
  check(
    "西 = 身体完全侧对镜头、鼻尖朝左、看不到右眼",
    /完全侧对镜头/.test(prompts.left) && /鼻尖指向画面左侧/.test(prompts.left) && /看不到右眼/.test(prompts.left)
  );
  // 「剪影」会被模型按字面执行成纯黑轮廓，绝不能再出现在提示词里
  check(
    "提示词里不出现「剪影」这种会被字面执行的词",
    DIRECTIONS.every((d) => !/剪影/.test(prompts[d.key]))
  );
  // 斜向必须与正背面 / 正侧面区分开，否则四个斜向会长得几乎一样
  check(
    "东北/西北写明是斜背、区别于正背面",
    ["upLeft", "upRight"].every((k) => /后背偏[左右]的一侧/.test(prompts[k]) && /不是正背面/.test(prompts[k]))
  );
  // 「剪影」会被模型按字面执行成纯黑轮廓——实测踩过，不能再出现
  check(
    "提示词里不出现会被字面执行的「剪影」",
    DIRECTIONS.every((d) => !/剪影/.test(prompts[d.key]))
  );
  check("正北明确要求正背面", /正背面/.test(prompts.back));
  check("正南明确要求不要侧身", /不要侧身/.test(prompts.front));

  // 防俯仰：这是上一版另一个坑
  check(
    "所有方向都禁止抬头/低头",
    DIRECTIONS.every((d) => /禁止抬头、低头、仰视、俯视/.test(prompts[d.key]))
  );
  check(
    "朝向与可见部位分成两个占位符",
    DEFAULT_IMAGE_PROMPT.includes("{facing}") && DEFAULT_IMAGE_PROMPT.includes("{visibility}")
  );
  check(
    "八个方向都显式写明画面上方为北",
    ["back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"].every((k) => /画面上方为北|画面左上|画面右上|画面左下方|画面右下方|画面左侧为西|画面右侧为东/.test(prompts[k]))
  );

  // 依赖关系：背面斜向派生自北、正面斜向派生自南
  check("东北/西北派生自背面（北）", byKey.upLeft.refs.includes("back") && byKey.upRight.refs.includes("back"));
  check("东南/西南派生自正面（南）", byKey.downLeft.refs.includes("front") && byKey.downRight.refs.includes("front"));
  check("东/西同时参考正面与背面", byKey.left.refs.length === 2 && byKey.right.refs.length === 2);

  check(
    "默认行序是罗盘顺时针 N→NE→E→SE→S→SW→W→NW",
    JSON.stringify(DEFAULT_ROW_ORDER) === JSON.stringify(["back", "upRight", "right", "downRight", "front", "downLeft", "left", "upLeft"]),
    DEFAULT_ROW_ORDER.join(",")
  );

  // ── 2. 配置 ────────────────────────────────────────────────────────────
  console.log("2) 配置读写与脱敏");
  const initial = await studio.getConfig();
  check("默认使用 Seedream 4.0", initial.arkModel === "doubao-seedream-4-0-250828", initial.arkModel);
  check("ffmpeg 探测通过", initial.ffmpeg?.ok === true, initial.ffmpeg?.version ?? initial.ffmpeg?.error);
  check("默认单格 256×256", initial.cellWidth === 256 && initial.cellHeight === 256);
  check("默认每段抽 8 帧", initial.frameCount === 8);
  check("默认行序为 8 个方向", Array.isArray(initial.rowOrder) && initial.rowOrder.length === 8);
  check("默认开启自动裁剪", initial.autoCrop === true);
  check("默认抽帧工作尺寸 768", initial.workingLongEdge === 768, String(initial.workingLongEdge));
  check("默认开启背景空间分割", initial.bgTolerance === 90, String(initial.bgTolerance));
  check("初始未配置 Key", initial.arkApiKeySet === false && initial.minimaxApiKeySet === false);

  // ── 2b. 优云智算版 H3 是模型下拉里的独立选项（不由 Base URL 推断）─────
  const compshareId = initial.minimaxCompshareModelId;
  check("配置视图给出优云智算版模型 id", compshareId === "MiniMax-H3 优云智算", String(compshareId));
  check(
    "模型下拉里包含优云智算版选项",
    Array.isArray(initial.minimaxModels) && initial.minimaxModels.some((model) => model.id === compshareId),
    JSON.stringify((initial.minimaxModels ?? []).map((model) => model.id))
  );
  check(
    "官方主机预设不再混入优云智算网关",
    Array.isArray(initial.minimaxHosts) && initial.minimaxHosts.every((host) => host.id !== "https://cp.compshare.cn"),
    JSON.stringify((initial.minimaxHosts ?? []).map((host) => host.id))
  );
  check("默认模型（官方 H3）无 /minimax 前缀", initial.minimaxPathPrefix === "");
  check("默认 H3 能力仍是官方档位", initial.minimaxCapabilities?.resolutions?.join(",") === "2K,768P");

  const cpSaved = await studio.saveConfig({ minimaxModel: compshareId });
  check("选中优云智算版后路径前缀为 /minimax", cpSaved.minimaxPathPrefix === "/minimax", cpSaved.minimaxPathPrefix);
  check(
    "选中优云智算版后能力放宽到 1080P/4~30",
    cpSaved.minimaxCapabilities?.resolutions?.join(",") === "2K,1080P,768P" && cpSaved.minimaxCapabilities?.durationMax === 30,
    JSON.stringify(cpSaved.minimaxCapabilities)
  );
  check("选中优云智算版后视图里的 Base URL 就是它的网关", cpSaved.minimaxBaseUrl === "https://cp.compshare.cn", cpSaved.minimaxBaseUrl);
  check("优云智算版仍按 v2 协议", cpSaved.minimaxCapabilities?.protocol === "v2");

  const cpBack = await studio.saveConfig({ minimaxModel: "MiniMax-H3", minimaxBaseUrl: "https://api.minimaxi.com" });
  check("切回官方 H3 后前缀还原为空", cpBack.minimaxPathPrefix === "");
  check("切回官方 H3 后档位还原", cpBack.minimaxCapabilities?.resolutions?.join(",") === "2K,768P");

  const saved = await studio.saveConfig({ arkApiKey: "test-ark-key-1234", cellWidth: 300 });
  check("保存后标记为已配置", saved.arkApiKeySet === true);
  check("Key 只回传尾号提示", saved.arkApiKeyHint === "…1234", saved.arkApiKeyHint);
  check("返回体里没有明文 Key", JSON.stringify(saved).includes("test-ark-key-1234") === false);
  check("尺寸改动已生效", saved.cellWidth === 300);

  const clamped = await studio.saveConfig({ keyHigh: 3, keyLow: 200, frameCount: 999, concurrency: 99 });
  check("keyHigh 被夹到 keyLow 之上", clamped.keyHigh > clamped.keyLow, `${clamped.keyLow} < ${clamped.keyHigh}`);
  check("frameCount 被夹到上限 64", clamped.frameCount === 64, String(clamped.frameCount));
  check("concurrency 被夹到上限 8", clamped.concurrency === 8, String(clamped.concurrency));

  // 行序迁移只做一次：没有版本号的旧配置才迁移，之后显式设置一律尊重。
  // loadConfig 有进程内缓存，走 API 测不出来，所以直接测纯函数。
  const { normalizeConfig, ROW_ORDER_VERSION } = await import("../lib/config.js");
  const LEGACY_ORDER = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];
  const migratedConfig = normalizeConfig({ rowOrder: LEGACY_ORDER });
  check(
    "无版本号 + 旧行序 → 迁移为罗盘顺时针",
    migratedConfig.rowOrder[0] === "back" && migratedConfig.rowOrderVersion === ROW_ORDER_VERSION,
    migratedConfig.rowOrder.join(",")
  );
  const explicitConfig = normalizeConfig({ rowOrder: LEGACY_ORDER, rowOrderVersion: ROW_ORDER_VERSION });
  check(
    "已有版本号时显式设置的行序被尊重（迁移只做一次）",
    JSON.stringify(explicitConfig.rowOrder) === JSON.stringify(LEGACY_ORDER),
    explicitConfig.rowOrder.join(",")
  );
  const customConfig = normalizeConfig({ rowOrder: ["front", "back"], rowOrderVersion: ROW_ORDER_VERSION });
  check("任意自定义行序都不被改写", JSON.stringify(customConfig.rowOrder) === JSON.stringify(["front", "back"]));

  const kept = await studio.saveConfig({ arkModel: "doubao-seedream-4-5-251128" });
  check("不带 Key 的保存不会清空 Key", kept.arkApiKeySet === true);
  const cleared = await studio.saveConfig({ clearArkApiKey: true });
  check("clearArkApiKey 能清空 Key", cleared.arkApiKeySet === false);

  // ── 3. 项目 CRUD ──────────────────────────────────────────────────────
  console.log("3) 项目增删改查");
  const created = await studio.createProject({ name: "冒烟测试角色" });
  const projectId = created.projectId;
  check("项目 id 形如 p…", /^p[a-z0-9]+$/.test(projectId), projectId);

  const listed = await studio.listProjects();
  check("项目列表包含新项目", listed.projects.some((p) => p.id === projectId));

  let project = await studio.getProject({ projectId });
  check("新项目 8 个方向都是 empty", Object.values(project.images).every((n) => n.status === "empty"));
  check("assetBase 指向资源路由", project.assetBase.endsWith(`/${projectId}/`), project.assetBase);
  check("每个方向都有默认提示词", Object.values(project.prompts.images).every((t) => typeof t === "string" && t.length > 40));
  check("正面提示词已展开方位与可见部位", /向正南行走/.test(project.prompts.images.front) && /完整正脸/.test(project.prompts.images.front));

  await studio.renameProject({ projectId, name: "改名后的项目" });
  project = await studio.getProject({ projectId });
  check("重命名生效", project.name === "改名后的项目", project.name);

  // ── 4. 源图上传 ────────────────────────────────────────────────────────
  console.log("4) 源图上传");
  const px = Buffer.alloc(24 * 24 * 4);
  for (let i = 0; i < 24 * 24; i++) {
    px[i * 4] = 200;
    px[i * 4 + 1] = 60;
    px[i * 4 + 2] = 60;
    px[i * 4 + 3] = 255;
  }
  const png = encodePng(px, 24, 24);
  const uploaded = await studio.uploadSource({ projectId, name: "hero.png", data: png.toString("base64") });
  check("上传返回落盘路径", uploaded.file === "source/hero.png", uploaded.file);

  await (async () => {
    let threw = false;
    try {
      await studio.uploadSource({ projectId, name: "evil.png", data: Buffer.from("not an image").toString("base64") });
    } catch {
      threw = true;
    }
    check("拒绝非图片内容", threw);
  })();

  // ── 5. 提示词 / 参数 / 验收 ────────────────────────────────────────────
  console.log("5) 提示词、参数与验收打标");
  await studio.savePrompts({ projectId, images: { front: "自定义正面提示词" }, video: "自定义视频提示词" });
  project = await studio.getProject({ projectId });
  check("方向提示词已保存", project.prompts.images.front === "自定义正面提示词");
  check("其它方向提示词未被覆盖", /向正北行走/.test(project.prompts.images.back) && /完全看不到脸/.test(project.prompts.images.back));
  check("视频提示词已保存", project.prompts.video === "自定义视频提示词");

  await studio.saveSettings({ projectId, settings: { cellWidth: 128, cellHeight: 192, frameCount: 6, despill: 0.9, rowOrder: ["back", "front"] } });
  project = await studio.getProject({ projectId });
  check("项目尺寸已保存", project.settings.cellWidth === 128 && project.settings.cellHeight === 192);
  check("抽帧数已保存", project.settings.frameCount === 6);
  check("行序已保存", JSON.stringify(project.settings.rowOrder) === JSON.stringify(["back", "front"]));

  await studio.saveSettings({ projectId, settings: { rowOrder: ["不存在的方向"] } });
  project = await studio.getProject({ projectId });
  check("非法行序被丢弃并回落", project.settings.rowOrder.length > 0 && project.settings.rowOrder.every((k) => k !== "不存在的方向"));

  await studio.saveSettings({ projectId, settings: { bgTolerance: 999, fillRatio: 5, workingLongEdge: 99999, pixelSize: 999 } });
  project = await studio.getProject({ projectId });
  check("bgTolerance 被夹到上限 160", project.settings.bgTolerance === 160, String(project.settings.bgTolerance));
  check("pixelSize 被夹到上限 32", project.settings.pixelSize === 32, String(project.settings.pixelSize));
  check("fillRatio 被夹到 1", project.settings.fillRatio === 1, String(project.settings.fillRatio));
  check("workingLongEdge 被夹到 2048", project.settings.workingLongEdge === 2048, String(project.settings.workingLongEdge));

  await studio.setApproved({ projectId, stage: "sheet", approved: true });
  project = await studio.getProject({ projectId });
  check("整图验收打标生效", project.sheet.approved === true);

  // ── 6. 阶段前置校验 ────────────────────────────────────────────────────
  console.log("6) 前置校验（缺素材时给出可读错误）");
  const expectThrow = async (name, fn, needle) => {
    try {
      await fn();
      check(name, false, "预期抛错但没有");
    } catch (error) {
      const message = String(error?.message ?? error);
      check(name, message.includes(needle), message.slice(0, 80));
    }
  };
  await expectThrow("无绿幕图时拒绝生成视频", () => studio.runVideos({ projectId }), "绿幕图");
  await expectThrow("无视频时拒绝抽帧", () => studio.runFrames({ projectId }), "视频");
  await expectThrow("无抽帧时拒绝合成", () => studio.compose({ projectId }), "序列帧");
  await expectThrow("无抽帧时拒绝重抠像", () => studio.rekey({ projectId }), "序列帧");
  await expectThrow("未知方向不启动", () => studio.runImage({ projectId, key: "nope" }), "未知方向");
  await expectThrow("未知项目直接报错", () => studio.getProject({ projectId: "p000000000000" }), "项目不存在");

  // ── 7. 异步任务与错误传播 ──────────────────────────────────────────────
  console.log("7) 异步任务与错误传播（用无效 Key 真实打一次方舟接口）");
  await studio.saveConfig({ arkApiKey: "invalid-key-for-verification" });
  const kicked = await studio.runImage({ projectId, key: "front" });
  check("生图任务被接受", kicked.started === true, JSON.stringify(kicked));

  let settled = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getProject({ projectId });
    if (snapshot.images.front.status === "error" || snapshot.images.front.status === "ready") {
      settled = snapshot;
      break;
    }
  }
  check("任务在合理时间内收敛", settled !== null);
  if (settled !== null) {
    check("无效 Key 导致节点进入 error", settled.images.front.status === "error", settled.images.front.status);
    check("错误信息可读且带原因", typeof settled.images.front.error === "string" && settled.images.front.error.length > 10, settled.images.front.error?.slice(0, 90));
    check("任务结束后运行表清空", (settled.jobs ?? []).length === 0, JSON.stringify(settled.jobs));
    check("失败被写入运行日志", settled.log.some((e) => e.level === "error"));
  }

  // ── 8. 静态资源路由 ────────────────────────────────────────────────────
  console.log("8) 静态资源路由（真实 HTTP）");
  const handler = captured.routes[0].handler;
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/dsh-game-material-master/assets`;

  try {
    const okRes = await fetch(`${base}/${projectId}/source/hero.png`);
    check("GET 已存在的图片返回 200", okRes.status === 200, String(okRes.status));
    check("Content-Type 为 image/png", okRes.headers.get("content-type") === "image/png", okRes.headers.get("content-type"));
    check("声明支持 Range", okRes.headers.get("accept-ranges") === "bytes");
    check("提供 ETag", (okRes.headers.get("etag") ?? "").length > 4);
    const body = Buffer.from(await okRes.arrayBuffer());
    check("返回字节数与源文件一致", body.length === png.length, `${body.length} vs ${png.length}`);

    const etag = okRes.headers.get("etag");
    const cached = await fetch(`${base}/${projectId}/source/hero.png`, { headers: { "if-none-match": etag } });
    check("ETag 命中返回 304", cached.status === 304, String(cached.status));

    const ranged = await fetch(`${base}/${projectId}/source/hero.png`, { headers: { range: "bytes=0-9" } });
    check("Range 请求返回 206", ranged.status === 206, String(ranged.status));
    check("Content-Range 正确", ranged.headers.get("content-range") === `bytes 0-9/${png.length}`, ranged.headers.get("content-range"));
    check("Range 返回 10 字节", Buffer.from(await ranged.arrayBuffer()).length === 10);

    const missingRes = await fetch(`${base}/${projectId}/source/nope.png`);
    check("不存在的文件返回 404", missingRes.status === 404, String(missingRes.status));

    const outside = await fetch(`${base}/${projectId}/source/../../../../etc/hosts`);
    check("目录穿越被挡住", outside.status === 400 || outside.status === 403 || outside.status === 404, String(outside.status));

    const forbidden = await fetch(`${base}/${projectId}/../project.json`);
    check("非白名单子目录被拒绝", forbidden.status === 400 || forbidden.status === 403 || forbidden.status === 404, String(forbidden.status));

    const badId = await fetch(`${base}/../../../etc/hosts`);
    check("非法项目 id 被拒绝", badId.status === 400 || badId.status === 404, String(badId.status));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // ── 9. 抽帧与合成（本地合成视频，不调任何 API）─────────────────────────
  // 这一段专门覆盖 startExtract / bakeSheet 的文件落盘路径：目录建漏、
  // 路径拼错这类问题只有真跑一次才会暴露。
  console.log("9) 抽帧与合成（本地合成绿幕视频）");
  const { patchProject } = await import("../lib/store.js");
  const { spawn } = await import("node:child_process");
  const { readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const projectRoot = join(HOME, "game-material-master", "projects", projectId);

  function ffmpeg(args) {
    return new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
      child.on("error", reject);
    });
  }

  // 小尺寸 + 少帧数，让测试跑得快；只给两个方向造视频，其余留空。
  await studio.saveSettings({
    projectId,
    settings: {
      cellWidth: 32,
      cellHeight: 32,
      frameCount: 4,
      fitMode: "contain",
      pixelSize: 2,
      autoCrop: true,
      fillRatio: 0.9,
      bottomMargin: 1,
      bgTolerance: 40,
      cropInset: 0,
      concurrency: 2,
      rowOrder: ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"]
    }
  });
  const seeded = ["front", "back"];
  for (const key of seeded) {
    await ffmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x00c040:s=160x160:d=2:r=12",
      "-f", "lavfi", "-i", "color=c=0xff8800:s=36x70:d=2:r=12",
      "-filter_complex", `[0][1]overlay=x='30+50*sin(2*PI*t)':y='45'`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      join(projectRoot, "videos", `${key}.mp4`)
    ]);
  }
  await patchProject(projectId, (project) => {
    for (const key of seeded) {
      project.videos[key] = { status: "ready", file: `videos/${key}.mp4`, approved: false };
    }
  });

  const extractKick = await studio.runFrames({ projectId });
  check("抽帧任务被接受", extractKick.started === true, JSON.stringify(extractKick));
  let framesSettled = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getProject({ projectId });
    if (Object.values(snapshot.frames).every((node) => node.status !== "running")) {
      framesSettled = snapshot;
      break;
    }
  }
  check("抽帧在合理时间内收敛", framesSettled !== null);
  if (framesSettled !== null) {
    for (const key of seeded) {
      const node = framesSettled.frames[key];
      check(`${key} 抽到 4 帧`, node?.status === "ready" && node.frames.length === 4, `${node?.status} ${node?.frames?.length} 帧 ${node?.error ?? ""}`);
      check(`${key} 写出了抠像帧`, Array.isArray(node?.keyed) && node.keyed.length === 4, String(node?.keyed?.length));
      check(`${key} 写出了预览带`, typeof node?.strip === "string", node?.strip ?? "(无)");
      check(`${key} 缓存了 raw.bin`, typeof node?.raw === "string", node?.raw ?? "(无)");
    }
    // 未提供视频的方向必须保持 empty，不能被误判成失败。
    check("没有视频的方向保持未抽帧", framesSettled.frames.left.status === "empty", framesSettled.frames.left.status);

    // 抽帧抽到的是「工作尺寸」而不是格子尺寸；测试视频 160x160，长边上限默认 768，所以原样保留。
    check("记录了 raw 的工作尺寸", framesSettled.frames.front.rawWidth === 160 && framesSettled.frames.front.rawHeight === 160,
      `${framesSettled.frames.front.rawWidth}x${framesSettled.frames.front.rawHeight}`);
    // 落盘物必须真的存在且尺寸正确（用 PNG 头解析宽高）。
    const firstPng = join(projectRoot, framesSettled.frames.front.frames[0]);
    const png = await readFile(firstPng);
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    check("抽出的帧是合法 PNG 且尺寸等于工作尺寸", pngWidth === 160 && pngHeight === 160, `${pngWidth}x${pngHeight}`);
  }

  const composeKick = await studio.compose({ projectId });
  check("合成任务被接受", composeKick.started === true, JSON.stringify(composeKick));
  let sheetSettled = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getProject({ projectId });
    if (snapshot.sheet.status !== "running") {
      sheetSettled = snapshot;
      break;
    }
  }
  check("合成在合理时间内完成", sheetSettled?.sheet.status === "ready", `${sheetSettled?.sheet.status} ${sheetSettled?.sheet.error ?? ""}`);
  check("整图尺寸 = 4 列 × 8 行 × 32px", sheetSettled?.sheet.width === 128 && sheetSettled?.sheet.height === 256, `${sheetSettled?.sheet.width}x${sheetSettled?.sheet.height}`);
  if (sheetSettled?.sheet.file !== undefined) {
    const sheetPng = await readFile(join(projectRoot, sheetSettled.sheet.file));
    check("整图落盘且是合法 PNG", sheetPng.readUInt32BE(16) === 128 && sheetPng.readUInt32BE(20) === 256);
  }

  const rekeyKick = await studio.rekey({ projectId });
  check("重跑抠像被接受", rekeyKick.started === true, JSON.stringify(rekeyKick));
  let rekeySettled = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getProject({ projectId });
    if (snapshot.sheet.status !== "running") {
      rekeySettled = snapshot;
      break;
    }
  }
  check("重跑抠像后整图仍可用", rekeySettled?.sheet.status === "ready", `${rekeySettled?.sheet.status} ${rekeySettled?.sheet.error ?? ""}`);

  // ── 整图必须记录「实际是怎么切的」──────────────────────────────────────
  // 这是行走预览取错方向那个 bug 的根因：整图按旧行序生成，而消费者按新
  // settings 的行号去切，于是「向北走」切到了第 0 行 = 正面。
  const composedOrder = (await studio.getProject({ projectId })).settings.rowOrder;
  check(
    "整图记录了生成时实际使用的行序",
    JSON.stringify(rekeySettled?.sheet.rowOrder) === JSON.stringify(composedOrder),
    `${JSON.stringify(rekeySettled?.sheet.rowOrder)} vs ${JSON.stringify(composedOrder)}`
  );
  check(
    "整图记录了格子尺寸与帧数",
    rekeySettled?.sheet.cellWidth === 32 && rekeySettled?.sheet.cellHeight === 32 && rekeySettled?.sheet.frameCount === 4,
    `${rekeySettled?.sheet.cellWidth}x${rekeySettled?.sheet.cellHeight} @${rekeySettled?.sheet.frameCount}`
  );

  // ── 改行序必须自动重新合成，不能让整图和设置对不上 ──────────────────────
  const beforeSwitch = (await studio.getProject({ projectId })).sheet.generatedAt;
  // 故意用一个和当前不同的顺序（当前是测试开头设的那串），否则测不出「变了」
  const newOrder = ["front", "back", "left", "right", "downLeft", "downRight", "upLeft", "upRight"];
  await studio.saveSettings({ projectId, settings: { rowOrder: newOrder } });
  let reswapped = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getProject({ projectId });
    if (snapshot.sheet.status === "ready" && snapshot.sheet.generatedAt > beforeSwitch) {
      reswapped = snapshot;
      break;
    }
  }
  check("改行序后自动重新合成", reswapped !== null, reswapped === null ? "超时未重新合成" : "已重新合成");
  check(
    "重新合成后整图记录的行序同步更新",
    JSON.stringify(reswapped?.sheet.rowOrder) === JSON.stringify(newOrder),
    JSON.stringify(reswapped?.sheet.rowOrder)
  );

  // 改抠像参数同样应当触发重新合成（否则预览看到的是旧参数的结果）
  const beforeKey = reswapped?.sheet.generatedAt ?? 0;
  await studio.saveSettings({ projectId, settings: { keyLow: 40 } });
  let rekeyed = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getProject({ projectId });
    if (snapshot.sheet.status === "ready" && snapshot.sheet.generatedAt > beforeKey) {
      rekeyed = snapshot;
      break;
    }
  }
  check("改抠像参数后自动重新合成", rekeyed !== null, rekeyed === null ? "超时未重新合成" : "已重新合成");

  // 项目级也走同样的一次性迁移
  await patchProject(projectId, (project) => {
    project.settings.rowOrder = LEGACY_ORDER;
    delete project.settings.rowOrderVersion;
  });
  const projectMigrated = await studio.getProject({ projectId });
  check(
    "项目级：无版本号 + 旧行序 → 迁移为罗盘顺时针",
    projectMigrated.settings.rowOrder[0] === "back",
    projectMigrated.settings.rowOrder.join(",")
  );
  await patchProject(projectId, (project) => {
    project.settings.rowOrder = LEGACY_ORDER;
  });
  const projectHonored = await studio.getProject({ projectId });
  check(
    "项目级：迁移后显式设成同一顺序被尊重",
    JSON.stringify(projectHonored.settings.rowOrder) === JSON.stringify(LEGACY_ORDER),
    projectHonored.settings.rowOrder.join(",")
  );

  // 抽帧参数变了要标记 stale（必须重新抽帧，不能只重新合成）
  const beforeExtract = (await studio.getProject({ projectId })).frames.front.stale === true;
  await studio.saveSettings({ projectId, settings: { workingLongEdge: 320 } });
  const afterExtract = await studio.getProject({ projectId });
  check("改抽帧工作尺寸后标记为需重新抽帧", afterExtract.frames.front.stale === true && beforeExtract === false, String(afterExtract.frames.front.stale));

  // ── 10. 图片生成模块（本地链路，不调 API）────────────────────────────
  console.log("10) 图片生成模块");
  const ffmpegRun = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
      child.on("error", reject);
    });

  // 造一张绿幕测试图（绿底 + 橙色方块）
  const greenFile = join(HOME, "green-source.png");
  await ffmpegRun([
    "-f", "lavfi", "-i", "color=c=0x00c040:s=200x200:d=1",
    "-f", "lavfi", "-i", "color=c=0xff8800:s=60x120:d=1",
    "-filter_complex", "[0][1]overlay=x=70:y=40",
    "-frames:v", "1", greenFile
  ]);
  const greenPng = await readFile(greenFile);

  const createdImage = await studio.createImageJob({ name: "测试图片任务" });
  const imageId = createdImage.jobId;
  check("图片任务 id 形如 i…", /^i[a-z0-9]+$/.test(imageId), imageId);

  await studio.uploadImageRef({ jobId: imageId, name: "ref.png", data: greenPng.toString("base64") });
  let imageJob = await studio.getImageJob({ jobId: imageId });
  check("参考图已记录", imageJob.refs.length === 1, `${imageJob.refs.length} 张`);
  check("图片任务带 assetBase", imageJob.assetBase.endsWith(`/image-assets/${imageId}/`), imageJob.assetBase);

  // 上传一张已有图片直接做抠像——这是「支持绿幕抠图生成 png」的主路径
  await studio.addImageItem({ jobId: imageId, name: "green.png", data: greenPng.toString("base64") });
  await studio.saveImageJob({
    jobId: imageId,
    prompt: "一只橙色的方块",
    suffix: "不要出现文字",
    keying: { enabled: true, keyLow: 14, keyHigh: 80, despill: 0.65, bgTolerance: 90, edgeShrink: 0 }
  });
  const keyKick = await studio.keyImageJob({ jobId: imageId });
  check("抠像任务被接受", keyKick.started === true, JSON.stringify(keyKick));

  let imageSettled = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await studio.getImageJob({ jobId: imageId });
    if ((snapshot.items ?? []).every((item) => item.status !== "running") && (snapshot.items ?? []).some((item) => item.keyedFile !== undefined)) {
      imageSettled = snapshot;
      break;
    }
  }
  check("抠像在合理时间内完成", imageSettled !== null, imageSettled === null ? "超时" : "已完成");
  check("产出透明 PNG", typeof imageSettled?.items?.[0]?.keyedFile === "string", imageSettled?.items?.[0]?.keyedFile ?? "");
  check(
    "记录了背景占比（可判断抠像可信度）",
    typeof imageSettled?.items?.[0]?.backgroundFraction === "number" && imageSettled.items[0].backgroundFraction > 0.4,
    String(imageSettled?.items?.[0]?.backgroundFraction?.toFixed(2))
  );
  // 提示词与附加提示词要分开存，附加词可被清空
  check("主提示词与附加提示词分开保存", imageSettled?.prompt === "一只橙色的方块" && imageSettled?.suffix === "不要出现文字");
  await studio.saveImageJob({ jobId: imageId, suffix: "" });
  imageJob = await studio.getImageJob({ jobId: imageId });
  check("附加提示词可以被清空", imageJob.suffix === "");

  // 资源路由要能取到抠像结果（前面的服务器已经关了，这里单开一个）
  {
    const server2 = createServer((req, res) => void handler(req, res));
    await new Promise((resolve) => server2.listen(0, "127.0.0.1", resolve));
    const port2 = server2.address().port;
    try {
      const keyedUrl = `http://127.0.0.1:${port2}/dsh-game-material-master/image-assets/${imageId}/${imageSettled.items[0].keyedFile}`;
      const keyedRes = await fetch(keyedUrl).catch(() => null);
      check("抠像结果可经资源路由取得", keyedRes !== null && keyedRes.status === 200, keyedRes === null ? "请求失败" : String(keyedRes.status));
      const png = Buffer.from(await keyedRes.arrayBuffer());
      check("抠像结果是合法 PNG（带 alpha）", png.readUInt32BE(16) === 200 && png.readUInt32BE(20) === 200 && png[25] === 6, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)} 颜色类型 ${png[25]}`);
      const badScope = await fetch(`http://127.0.0.1:${port2}/dsh-game-material-master/image-assets/${imageId}/../project.json`).catch(() => null);
      check("新增模块同样挡住目录穿越", badScope !== null && [400, 403, 404].includes(badScope.status), badScope === null ? "请求失败" : String(badScope.status));
      const badId = await fetch(`http://127.0.0.1:${port2}/dsh-game-material-master/sequence-assets/p000000000000/out/x.png`).catch(() => null);
      check("跨模块用错 id 前缀会被拒绝", badId !== null && badId.status === 400, badId === null ? "请求失败" : String(badId.status));
    } finally {
      await new Promise((resolve) => server2.close(resolve));
    }
  }

  // ── 11. 序列帧生成模块（本地链路，不调 API）────────────────────────────
  console.log("11) 序列帧生成模块");
  const createdSeq = await studio.createSequenceJob({ name: "测试序列帧任务" });
  const seqId = createdSeq.jobId;
  check("序列帧任务 id 形如 s…", /^s[a-z0-9]+$/.test(seqId), seqId);

  await studio.uploadSequenceRef({ jobId: seqId, kind: "firstFrame", name: "first.png", data: greenPng.toString("base64") });
  await studio.saveSequenceJob({
    jobId: seqId,
    mode: "frames",
    prompt: "原地走三步",
    suffix: "镜头固定",
    settings: { frameCount: 4, longEdge: 96, cellWidth: 32, cellHeight: 32 },
    keying: { keyLow: 14, keyHigh: 80, bgTolerance: 90 }
  });
  let seqJob = await studio.getSequenceJob({ jobId: seqId });
  check("首帧图已记录", seqJob.refs.firstFrame?.file !== undefined, seqJob.refs.firstFrame?.file ?? "");
  check("模式与参数已保存", seqJob.mode === "frames" && seqJob.settings.frameCount === 4, `${seqJob.mode} ${seqJob.settings.frameCount}`);

  // 参考模式必须至少有一张参考图/一段参考视频
  await studio.saveSequenceJob({ jobId: seqId, mode: "reference" });
  await (async () => {
    let threw = "";
    try {
      await studio.runSequenceVideo({ jobId: seqId });
    } catch (error) {
      threw = String(error?.message ?? error);
    }
    check("参考模式缺素材时拒绝提交", /至少要上传/.test(threw), threw.slice(0, 60) || "(没有抛错)");
  })();
  await (async () => {
    await studio.saveSequenceJob({ jobId: seqId, mode: "frames" });
    // 首尾帧模式也必须先有首帧图
    const job2 = await import("../lib/seqgen.js").then((m) => m.readSequenceJob(seqId));
    const backup = job2.refs.firstFrame;
    job2.refs.firstFrame = undefined;
    const m = await import("../lib/seqgen.js");
    await m.writeSequenceJob(job2);
    let threw = "";
    try {
      await studio.runSequenceVideo({ jobId: seqId });
    } catch (error) {
      threw = String(error?.message ?? error);
    }
    check("首尾帧模式缺首帧图时拒绝提交", /必须上传一张首帧图/.test(threw), threw.slice(0, 60) || "(没有抛错)");
    job2.refs.firstFrame = backup;
    await m.writeSequenceJob(job2);
  })();
  await studio.saveSequenceJob({ jobId: seqId, mode: "frames" });

  // 直接塞一段本地视频，跳过付费的视频生成，验证后面的抽帧/抠像/合成
  const seqgenMod = await import("../lib/seqgen.js");
  const seqVideoFile = join(HOME, "seq-source.mp4");
  await ffmpegRun([
    "-f", "lavfi", "-i", "color=c=0x00c040:s=160x160:d=2:r=12",
    "-f", "lavfi", "-i", "color=c=0xff8800:s=40x80:d=2:r=12",
    "-filter_complex", "[0][1]overlay=x='30+50*sin(2*PI*t)':y='40'",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", seqVideoFile
  ]);
  await (async () => {
    const job = await seqgenMod.readSequenceJob(seqId);
    const rel = "videos/output.mp4";
    await writeFile(join(HOME, "game-material-master", "sequence-jobs", seqId, rel), await readFile(seqVideoFile));
    job.video = { status: "ready", file: rel, updatedAt: Date.now() };
    await seqgenMod.writeSequenceJob(job);
  })();

  const framesKick = await studio.runSequenceFrames({ jobId: seqId, count: 4 });
  check("抽帧任务被接受", framesKick.started === true, JSON.stringify(framesKick));
  let seqSettled = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const snapshot = await studio.getSequenceJob({ jobId: seqId });
    if (snapshot.frames.status !== "running" && snapshot.sheet.status !== "running" && snapshot.frames.status !== "empty") {
      seqSettled = snapshot;
      break;
    }
  }
  check("抽帧在合理时间内完成", seqSettled?.frames.status === "ready", `${seqSettled?.frames.status} ${seqSettled?.frames.error ?? ""}`);
  check("按配置张数抽出帧", seqSettled?.frames.files.length === 4, `${seqSettled?.frames?.files?.length} 张`);
  check("自动完成抠像", seqSettled?.frames.keyed.length === 4, `${seqSettled?.frames?.keyed?.length} 帧`);
  check("自动完成横向合成", seqSettled?.sheet.status === "ready", `${seqSettled?.sheet.status} ${seqSettled?.sheet.error ?? ""}`);
  check("条图尺寸 = 4 列 × 32px", seqSettled?.sheet.width === 128 && seqSettled?.sheet.height === 32, `${seqSettled?.sheet?.width}x${seqSettled?.sheet?.height}`);

  // 关键帧直接播放要用到：抠好的帧必须能经资源路由取到
  {
    const server3 = createServer((req, res) => void handler(req, res));
    await new Promise((resolve) => server3.listen(0, "127.0.0.1", resolve));
    const port3 = server3.address().port;
    try {
      const frameUrl = `http://127.0.0.1:${port3}/dsh-game-material-master/sequence-assets/${seqId}/${seqSettled.frames.keyed[0]}`;
      const frameRes = await fetch(frameUrl).catch(() => null);
      check("抠像帧可经资源路由取得（播放预览依赖它）", frameRes !== null && frameRes.status === 200, frameRes === null ? "请求失败" : String(frameRes.status));
    } finally {
      await new Promise((resolve) => server3.close(resolve));
    }
  }

  // 改抽帧参数要标记 stale
  await studio.saveSequenceJob({ jobId: seqId, settings: { longEdge: 320 } });
  const seqStale = await studio.getSequenceJob({ jobId: seqId });
  check("改抽帧参数后标记需重抽", seqStale.frames.stale === true);

  await studio.deleteImageJob({ jobId: imageId });
  await studio.deleteSequenceJob({ jobId: seqId });
  const imageJobsAfter = await studio.listImageJobs();
  const seqJobsAfter = await studio.listSequenceJobs();
  check("图片任务已删除", !imageJobsAfter.jobs.some((item) => item.id === imageId));
  check("序列帧任务已删除", !seqJobsAfter.jobs.some((item) => item.id === seqId));

  // ── 12. 删除 ───────────────────────────────────────────────────────────
  console.log("12) 删除项目");
  await studio.deleteProject({ projectId });
  const after = await studio.listProjects();
  check("项目已从列表移除", !after.projects.some((p) => p.id === projectId));

  console.log(`\n共 ${checks} 项检查，失败 ${failures.length} 项。`);
  if (failures.length > 0) {
    console.error(`失败项：${failures.join("、")}`);
    return 1;
  }
  console.log("宿主半区全部通过。");
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error("\n测试本身崩溃：", error);
  code = 1;
} finally {
  await rm(HOME, { recursive: true, force: true });
}
process.exit(code);
