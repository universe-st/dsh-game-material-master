#!/usr/bin/env node
/**
 * 自定义生图后端自检：OpenAI / ComfyUI / Stable Diffusion WebUI 三种协议。
 *
 * 起一个**本地假服务端**把三种协议都模拟出来，全程离线、零计费：
 *   · OpenAI：`/images/generations` 与 `/images/edits`（含「端点不存在」的退回路径）；
 *   · SD WebUI：`/sdapi/v1/txt2img` 与 `/sdapi/v1/img2img`；
 *   · ComfyUI：`/upload/image` → `/prompt` → `/history/:id`（**第一次故意返回空**，
 *     逼出轮询）→ `/view`。
 *
 * 重点不是「跑通」而是**请求真的长对了**：URL、body 字段、参考图的形态
 * （multipart / base64 / 文件名）、占位符的 JSON 类型（数字必须是数字，
 * 写成字符串 ComfyUI 会直接报 type 错误）。这些都是「跑通了但结果不对」
 * 的高发区，只看返回有没有字节是发现不了的。
 *
 * 用法：node scripts/verify-custom-image.mjs
 */

import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 配置落在临时 DSH_HOME 里，绝不碰用户真实的 config.json。
const HOME = await mkdtemp(join(tmpdir(), "gmm-custom-image-"));
process.env.DSH_HOME = HOME;

const { generateCustomImage, parseSizeSpec } = await import("../lib/customimage.js");
const { generateImageWithProvider, imageProviderBlocker, imageProviderSummary, isCustomProvider, customImageBlocker } = await import("../lib/imageprovider.js");
const { loadConfig, saveConfig, normalizeConfig } = await import("../lib/config.js");
const { encodePng } = await import("../lib/png.js");

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}
function section(title) {
  console.log(`\n${title}`);
}

/** 2×2 的小 PNG，三个协议都拿它当「模型生成的结果」。 */
const PNG = encodePng(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]), 2, 2);
const PNG_B64 = PNG.toString("base64");
/** 一张不同的图，用于区分「参考图」与「产出」。 */
const REF_PNG = encodePng(Buffer.alloc(4 * 4 * 4, 200), 4, 4);
const REF_DATA_URI = `data:image/png;base64,${REF_PNG.toString("base64")}`;

/** 记录假服务端收到的每一次请求。 */
const received = [];
let openaiEditsStatus = 200;
let comfyHistoryCalls = 0;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const body = await readBody(req);
  const record = {
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    contentType: req.headers["content-type"] ?? "",
    authorization: req.headers.authorization ?? "",
    body
  };
  received.push(record);
  const json = (payload, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  // ── OpenAI 兼容 ───────────────────────────────────────────────────────
  if (url.pathname.endsWith("/images/generations")) {
    return json({ data: [{ b64_json: PNG_B64 }], usage: { generated_images: 1 } });
  }
  if (url.pathname.endsWith("/images/edits")) {
    if (openaiEditsStatus !== 200) return json({ error: { message: "no such endpoint" } }, openaiEditsStatus);
    return json({ data: [{ b64_json: PNG_B64 }] });
  }
  // ── SD WebUI ──────────────────────────────────────────────────────────
  if (url.pathname.endsWith("/sdapi/v1/txt2img") || url.pathname.endsWith("/sdapi/v1/img2img")) {
    return json({ images: [PNG_B64], info: JSON.stringify({ seed: 1234, sampler_name: "DPM++ 2M Karras" }) });
  }
  // ── ComfyUI ───────────────────────────────────────────────────────────
  if (url.pathname.endsWith("/upload/image")) {
    return json({ name: "gmm-uploaded.png", subfolder: "sub", type: "input" });
  }
  if (url.pathname.endsWith("/prompt")) {
    return json({ prompt_id: "pid-1", number: 1, node_errors: {} });
  }
  if (url.pathname.includes("/history/")) {
    comfyHistoryCalls++;
    // 第一次故意空：真实 ComfyUI 也是这样，先有条目、后面才有 outputs。
    if (comfyHistoryCalls === 1) return json({});
    return json({
      "pid-1": {
        status: { completed: true, status_str: "success" },
        outputs: { "9": { images: [{ filename: "ComfyUI_00001_.png", subfolder: "", type: "output" }] } }
      }
    });
  }
  if (url.pathname.endsWith("/view")) {
    res.writeHead(200, { "Content-Type": "image/png" });
    return res.end(PNG);
  }
  return json({ error: { message: `unexpected path ${url.pathname}` } }, 404);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const lastRequest = () => received[received.length - 1];
const pathHits = (fragment) => received.filter((entry) => entry.path.includes(fragment));
const textOf = (entry) => entry.body.toString("utf8");
const jsonOf = (entry) => JSON.parse(entry.body.toString("utf8"));

const base = {
  prompt: "一只像素猫",
  images: [],
  size: "1024x768",
  timeoutMs: 30000,
  negativePrompt: "模糊",
  steps: 24,
  cfgScale: 6.5,
  sampler: "Euler a",
  denoising: 0.55,
  seed: 7,
  workflow: ""
};

console.log(`本地假服务端：${ORIGIN}（DSH_HOME=${HOME}）`);

// ══ 1. 尺寸解析 ══════════════════════════════════════════════════════════
section("1) 尺寸解析（三种写法 + 认不出来时交给服务端）");
check("`1024x1024` 解析成宽高", JSON.stringify(parseSizeSpec("1024x1024")) === '{"width":1024,"height":1024}');
check("`1024×768` 的全角乘号也认", JSON.stringify(parseSizeSpec("1024×768")) === '{"width":1024,"height":768}');
check("`2K` 解析成 2048 见方", JSON.stringify(parseSizeSpec("2K")) === '{"width":2048,"height":2048}');
check("认不出来的值返回 undefined（不硬塞一个会 400 的尺寸）", parseSizeSpec("随便写点啥") === undefined);

// ══ 2. OpenAI 协议 ══════════════════════════════════════════════════════
section("2) OpenAI 协议：文生图 / 图生图 / 端点不存在时退回");
{
  received.length = 0;
  const result = await generateCustomImage({
    ...base,
    protocol: "openai",
    baseUrl: `${ORIGIN}/custom`,
    apiKey: "sk-test",
    model: "gpt-image-1",
    images: []
  });
  const entry = lastRequest();
  check("打到 /images/generations", entry.path === "/custom/images/generations", entry.path);
  const payload = jsonOf(entry);
  check("body 带 model / prompt / size", payload.model === "gpt-image-1" && payload.prompt === "一只像素猫" && payload.size === "1024x768", JSON.stringify(payload));
  check("不主动写 response_format（gpt-image-1 写了会被拒）", payload.response_format === undefined);
  check("文生图不带 image 字段", payload.image === undefined);
  check("返回的 b64_json 被解码成图片字节", result.bytes.equals(PNG) && result.ext === "png", `${result.bytes.length} 字节 / ${result.ext}`);
  check("Authorization 走 Bearer", entry.authorization === "Bearer sk-test", entry.authorization);
}
{
  received.length = 0;
  await generateCustomImage({
    ...base,
    protocol: "openai",
    baseUrl: `${ORIGIN}/custom`,
    apiKey: "sk-test",
    model: "gpt-image-1",
    images: [REF_DATA_URI]
  });
  const entry = lastRequest();
  check("带参考图时先走 /images/edits", entry.path === "/custom/images/edits", entry.path);
  const raw = textOf(entry);
  check("edits 用 multipart 提交", entry.contentType.startsWith("multipart/form-data"), entry.contentType);
  check("edits 的表单里有 image 字段与文件名", raw.includes('name="image"') && raw.includes("filename="), raw.slice(0, 80));
  check("edits 的表单里带上了 model / prompt", raw.includes("gpt-image-1") && raw.includes("一只像素猫"));
}
{
  // ★ 退回路径：edits 端点不存在（404）时改用 generations 的 image 字段。
  received.length = 0;
  openaiEditsStatus = 404;
  const result = await generateCustomImage({
    ...base,
    protocol: "openai",
    baseUrl: `${ORIGIN}/custom`,
    apiKey: "",
    model: "flux-dev",
    images: [REF_DATA_URI]
  });
  openaiEditsStatus = 200;
  check("edits 404 → 退回 generations（两条路径都试过）", pathHits("/custom/images/edits").length === 1 && pathHits("/custom/images/generations").length === 1, received.map((e) => e.path).join(" , "));
  const fallback = jsonOf(lastRequest());
  check("退回时参考图进 `image` 字段（火山方舟 / DashScope 那一系的写法）", typeof fallback.image === "string" && fallback.image.startsWith("data:image/png;base64,"));
  check("退回后照样拿到图片", result.bytes.equals(PNG));
}

// ══ 3. Stable Diffusion WebUI 协议 ══════════════════════════════════════
section("3) SD WebUI 协议：txt2img / img2img / 参数映射");
{
  received.length = 0;
  const result = await generateCustomImage({
    ...base,
    protocol: "sdwebui",
    baseUrl: ORIGIN,
    apiKey: "user:pass",
    model: "",
    images: []
  });
  const entry = lastRequest();
  check("文生图打 /sdapi/v1/txt2img", entry.path === "/sdapi/v1/txt2img", entry.path);
  const payload = jsonOf(entry);
  check("宽高来自 size 解析", payload.width === 1024 && payload.height === 768, `${payload.width}x${payload.height}`);
  check("提示词 / 负面提示词都在 body 上", payload.prompt === "一只像素猫" && payload.negative_prompt === "模糊");
  check("步数 / CFG / 采样器映射到 A1111 的字段名", payload.steps === 24 && payload.cfg_scale === 6.5 && payload.sampler_name === "Euler a", JSON.stringify({ steps: payload.steps, cfg: payload.cfg_scale }));
  check("种子直传", payload.seed === 7);
  check("`user:pass` 形式的 Key 走 HTTP Basic（A1111 的 --api-auth）", entry.authorization === `Basic ${Buffer.from("user:pass").toString("base64")}`, entry.authorization);
  check("返回的 base64 被解码成图片字节", result.bytes.equals(PNG));
}
{
  received.length = 0;
  await generateCustomImage({
    ...base,
    protocol: "sdwebui",
    baseUrl: ORIGIN,
    apiKey: "",
    model: "",
    images: [REF_DATA_URI, REF_DATA_URI]
  });
  const entry = lastRequest();
  check("带参考图时走 /sdapi/v1/img2img", entry.path === "/sdapi/v1/img2img", entry.path);
  const payload = jsonOf(entry);
  check("init_images 是**纯 base64**（A1111 不吃 data URI 前缀）", Array.isArray(payload.init_images) && payload.init_images.length === 2 && !payload.init_images[0].startsWith("data:"), String(payload.init_images?.[0]?.slice(0, 12)));
  check("img2img 带 denoising_strength", payload.denoising_strength === 0.55, String(payload.denoising_strength));
}
{
  // 种子 -1 = 每次随机，A1111 的约定也是 -1。
  received.length = 0;
  await generateCustomImage({ ...base, protocol: "sdwebui", baseUrl: ORIGIN, apiKey: "", model: "", seed: -1, images: [] });
  check("种子 -1 原样传（A1111 语义就是随机）", jsonOf(lastRequest()).seed === -1);
}

// ══ 4. ComfyUI 协议 ═════════════════════════════════════════════════════
section("4) ComfyUI 协议：上传参考图 → 提交工作流 → 轮询 → 取图");
{
  received.length = 0;
  comfyHistoryCalls = 0;
  const workflow = JSON.stringify({
    "3": {
      class_type: "KSampler",
      inputs: { seed: "{{seed}}", steps: "{{steps}}", cfg: "{{cfg}}", sampler_name: "{{sampler}}", denoise: "{{denoising}}", text: "前缀-{{prompt}}-后缀" }
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{model}}" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}" } },
    "6": { class_type: "LoadImage", inputs: { image: "{{image}}" } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "{{negative_prompt}}" } }
  });
  const result = await generateCustomImage({
    ...base,
    protocol: "comfyui",
    baseUrl: `${ORIGIN}/comfy`,
    apiKey: "",
    model: "sdxl.safetensors",
    images: [REF_DATA_URI],
    workflow
  });
  check("先 POST /comfy/upload/image", pathHits("/comfy/upload/image").length === 1, received.map((e) => e.path).join(" , "));
  check("再 POST /comfy/prompt", pathHits("/comfy/prompt").length === 1);
  check("轮询 /history 至少两次（第一次空、第二次才有 outputs）", pathHits("/comfy/history/").length >= 2, `${pathHits("/comfy/history/").length} 次`);
  check("最后 GET /comfy/view 取图", pathHits("/comfy/view").length === 1);
  check("view 的查询参数带 filename / type", lastRequest().query.filename === "ComfyUI_00001_.png" && lastRequest().query.type === "output", JSON.stringify(lastRequest().query));

  const submitted = jsonOf(pathHits("/comfy/prompt")[0]);
  const nodes = submitted.prompt;
  check("提交体是 {prompt, client_id}", typeof submitted.client_id === "string" && typeof nodes === "object");
  check("{{width}}/{{height}} 替换成**数字**（字符串会让 EmptyLatentImage 报 type 错）", nodes["5"].inputs.width === 1024 && nodes["5"].inputs.height === 768, JSON.stringify(nodes["5"].inputs));
  check("{{seed}}/{{steps}}/{{cfg}}/{{denoising}} 也都是数字", [nodes["3"].inputs.seed, nodes["3"].inputs.steps, nodes["3"].inputs.cfg, nodes["3"].inputs.denoise].every((value) => typeof value === "number"), JSON.stringify(nodes["3"].inputs));
  check("{{sampler}}/{{model}}/{{negative_prompt}} 替换成字符串", nodes["3"].inputs.sampler_name === "Euler a" && nodes["4"].inputs.ckpt_name === "sdxl.safetensors" && nodes["7"].inputs.text === "模糊");
  check("嵌在长字符串里的 {{prompt}} 按文本替换", nodes["3"].inputs.text === "前缀-一只像素猫-后缀", nodes["3"].inputs.text);
  check("{{image}} 用的是 upload 回来的「子目录/文件名」", nodes["6"].inputs.image === "sub/gmm-uploaded.png", nodes["6"].inputs.image);
  check("拿到的字节来自 /view", result.bytes.equals(PNG) && result.ext === "png");
}
{
  // 没写 {{image}} → 直接改第一个 LoadImage 节点。
  received.length = 0;
  comfyHistoryCalls = 0;
  const workflow = JSON.stringify({
    "1": { class_type: "LoadImage", inputs: { image: "旧的.png", upload: "image" } },
    "2": { class_type: "KSampler", inputs: { seed: "{{seed}}" } }
  });
  await generateCustomImage({ ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", model: "", images: [REF_DATA_URI], workflow });
  const nodes = jsonOf(pathHits("/prompt")[0]).prompt;
  check("没写 {{image}} 时自动改 LoadImage 的文件名（ComfyUI 自己的约定）", nodes["1"].inputs.image === "sub/gmm-uploaded.png", nodes["1"].inputs.image);
}
{
  // 没写 {{width}} / {{height}} → 直接把尺寸写进空 latent 节点。
  // 这是「改了尺寸也不行」的典型原因：用户从 ComfyUI 导出的工作流把宽高写死了。
  received.length = 0;
  comfyHistoryCalls = 0;
  const workflow = JSON.stringify({
    "1": { class_type: "EmptyLatentImage", inputs: { width: 1254, height: 1254, batch_size: 1 } },
    "2": { class_type: "KSampler", inputs: { seed: "{{seed}}" } }
  });
  await generateCustomImage({ ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", model: "", images: [], workflow, size: "1024x768" });
  const nodes = jsonOf(pathHits("/prompt")[0]).prompt;
  check(
    "没写 width/height 占位符时，自动改 EmptyLatentImage 的宽高",
    nodes["1"].inputs.width === 1024 && nodes["1"].inputs.height === 768,
    JSON.stringify(nodes["1"].inputs)
  );
}
{
  // 一个占位符都不写 = 原样跑（合法用法：固定工作流）。
  received.length = 0;
  comfyHistoryCalls = 0;
  const workflow = JSON.stringify({ "1": { class_type: "KSampler", inputs: { seed: 5, text: "固定提示词" } } });
  await generateCustomImage({ ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", model: "", images: [], workflow });
  const nodes = jsonOf(pathHits("/prompt")[0]).prompt;
  check("没有占位符时工作流原样提交", nodes["1"].inputs.seed === 5 && nodes["1"].inputs.text === "固定提示词", JSON.stringify(nodes));
}
{
  // 提示词里带引号 / 换行也不能破坏 JSON —— 这是「在 JSON 文本上做字符串替换」的经典翻车点。
  received.length = 0;
  comfyHistoryCalls = 0;
  const workflow = JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } } });
  const tricky = '一只 "带引号" 的猫\n第二行';
  await generateCustomImage({ ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", model: "", prompt: tricky, images: [], workflow });
  const nodes = jsonOf(pathHits("/prompt")[0]).prompt;
  check("提示词里的引号 / 换行不会破坏工作流 JSON", nodes["1"].inputs.text === tricky, JSON.stringify(nodes["1"].inputs.text));
}

// ══ 5. 错误信息 ═════════════════════════════════════════════════════════
section("5) 错误信息（要能直接告诉用户改哪里）");
{
  const cases = [
    ["ComfyUI 没填工作流", { ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", images: [], workflow: "" }, /工作流 JSON/],
    ["ComfyUI 工作流不是合法 JSON", { ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", images: [], workflow: "{不是 json" }, /解析失败/],
    ["ComfyUI 工作流不是对象", { ...base, protocol: "comfyui", baseUrl: ORIGIN, apiKey: "", images: [], workflow: "[1,2,3]" }, /必须是一个对象/],
    ["地址为空", { ...base, protocol: "openai", baseUrl: "", apiKey: "", images: [] }, /尚未配置自定义生图服务的地址/],
    ["连不上", { ...base, protocol: "openai", baseUrl: "http://127.0.0.1:1", apiKey: "", images: [], timeoutMs: 12000 }, /无法连接/]
  ];
  for (const [name, request, pattern] of cases) {
    let message = "";
    try {
      await generateCustomImage(request);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    check(`报错讲清楚：${name}`, pattern.test(message), message.slice(0, 90));
  }
}

// ══ 6. 后端分发与配置 ═══════════════════════════════════════════════════
section("6) 后端分发：换 imageProvider 一个字段，所有生图调用点跟着走");
{
  await mkdir(join(HOME, "game-material-master"), { recursive: true });
  await saveConfig({ arkApiKey: "ark-key", arkBaseUrl: `${ORIGIN}/ark`, arkModel: "ark-model" });
  received.length = 0;
  await generateImageWithProvider({ prompt: "分发测试", images: [], size: "1K", watermark: false });
  check("imageProvider=ark 时走火山方舟端点", lastRequest().path === "/ark/images/generations", lastRequest().path);

  await saveConfig({ imageProvider: "custom", customProtocol: "openai", customBaseUrl: `${ORIGIN}/custom`, customApiKey: "sk-x", customModel: "my-model" });
  received.length = 0;
  const dispatched = await generateImageWithProvider({ prompt: "分发测试", images: [], size: "1024x1024", watermark: false });
  check("imageProvider=custom 时走自定义端点（Ark 那边一次都没打）", lastRequest().path === "/custom/images/generations" && pathHits("/ark/").length === 0, received.map((e) => e.path).join(" , "));
  check("自定义端点拿到的是 customModel", jsonOf(lastRequest()).model === "my-model");
  check("返回字节照常落盘用", dispatched.bytes.equals(PNG));
  check("isCustomProvider 跟着配置走", isCustomProvider(await loadConfig()) === true);

  const config = await loadConfig();
  check("摘要写了协议与地址", imageProviderSummary(config).includes("自定义") && imageProviderSummary(config).includes("127.0.0.1"), imageProviderSummary(config));
  check("配置齐全时没有阻塞", imageProviderBlocker(config) === undefined, imageProviderBlocker(config) ?? "");

  await saveConfig({ customProtocol: "comfyui", customWorkflow: "" });
  check("ComfyUI 没填工作流时拦住（不等到几十秒后才报错）", /工作流 JSON/.test(imageProviderBlocker(await loadConfig()) ?? ""), imageProviderBlocker(await loadConfig()) ?? "");
  await saveConfig({ customWorkflow: "{}" });
  check("填上工作流后放行", imageProviderBlocker(await loadConfig()) === undefined);

  await saveConfig({ customBaseUrl: "" });
  check("地址为空时拦住并说明去哪里配", /设置 → 游戏素材大师/.test(customImageBlocker(await loadConfig()) ?? ""), customImageBlocker(await loadConfig()) ?? "");

  await saveConfig({ imageProvider: "ark", arkApiKey: "" });
  check("切回 ark 且没有 Key 时，拦的是火山方舟那一句", /火山方舟/.test(imageProviderBlocker(await loadConfig()) ?? ""), imageProviderBlocker(await loadConfig()) ?? "");
}

// ══ 7. 配置归一化 ═══════════════════════════════════════════════════════
section("7) 配置归一化（脏数据不能让设置页起不来）");
{
  const normalized = normalizeConfig({
    imageProvider: "别的",
    customProtocol: "nope",
    customSteps: 9999,
    customCfgScale: -5,
    customDenoising: 9,
    customSeed: -999,
    customTimeoutMs: 1,
    customBaseUrl: "http://127.0.0.1:8188///"
  });
  check("认不出的 imageProvider 回落 ark", normalized.imageProvider === "ark", normalized.imageProvider);
  check("认不出的协议回落 openai", normalized.customProtocol === "openai", normalized.customProtocol);
  check("步数被夹到 1~150", normalized.customSteps === 150, String(normalized.customSteps));
  check("CFG 被夹到 0~30", normalized.customCfgScale === 0, String(normalized.customCfgScale));
  check("重绘强度被夹到 0~1", normalized.customDenoising === 1, String(normalized.customDenoising));
  check("种子下限是 -1（不能变成 -999）", normalized.customSeed === -1, String(normalized.customSeed));
  check("超时有下限", normalized.customTimeoutMs === 10000, String(normalized.customTimeoutMs));
  check("Base URL 末尾斜杠被去掉", normalized.customBaseUrl === "http://127.0.0.1:8188", normalized.customBaseUrl);
  const clean = normalizeConfig({});
  check("缺项一律回落默认值", clean.imageProvider === "ark" && clean.customProtocol === "openai" && clean.customSize === "1024x1024", JSON.stringify({ p: clean.imageProvider, proto: clean.customProtocol, size: clean.customSize }));
}

server.close();
await rm(HOME, { recursive: true, force: true });

console.log("");
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
  console.error("自定义生图后端的协议细节一旦跑偏，表现是「请求发出去了、图也回来了，但参数全不对」——很难从界面上看出来。");
  process.exit(1);
}
console.log(`共 ${checks} 项检查，全部通过。`);
