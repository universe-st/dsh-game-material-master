/**
 * 对话调用面自检：不需要浏览器、不联网、不花钱。
 *
 *   node scripts/verify-tools.mjs
 *
 * 钉住三件事：
 *
 * ① **工具面**：`ctx.tools` 上真的注册了那 8 个 `game_material_*` 工具，
 *    schema 合法（DSH 只认 type/oneOf/properties/required/additionalProperties/
 *    items/enum/const 这个子集），并且 `game_material_call` 的 method 枚举
 *    **覆盖插件的每一个远程方法**——「所有功能都能通过对话调用」这句话靠它成立。
 *
 * ② **固定流程**：`game_material_intake` 必须先问用户关键参数与审核模式。
 *    这里直接调工具的 execute，断言：
 *      - 没配 Key 时给出 blocker；
 *      - 缺源图 / 缺提示词 / 缺素材时出现在 questions 里；
 *      - 已经有的事实（源图、提示词、素材）不再问；
 *      - reviewModeQuestion 一定是 auto / manual 两个选项。
 *
 * ③ **深链接**：宿主 links.ts 与浏览器半区 client.ts 是两份实现（经典脚本不能
 *    import），所以用文本契约把参数名、模块名、面板 id 钉成一致；再验证
 *    链接 → 意图 → 链接 的往返一致。
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const HOME = await mkdtemp(join(tmpdir(), "dsh-gmm-tools-"));
process.env.DSH_HOME = HOME;

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const links = await import("../lib/links.js");
const { METHODS } = await import("../lib/wire.js");
const { encodePng } = await import("../lib/png.js");

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

/** DSH 支持的关键字子集（见 @deepseek-ai/dsh-tools 的 checkSchemaNode）。 */
const SCHEMA_KEYWORDS = new Set([
  "type",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "description",
  "title",
  "default",
  "examples"
]);
const SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"];

/** 递归校验 schema 只用了受支持的子集（dsh-tools 会在注册时抛错，这里提前抓）。 */
function validateSchema(schema, path, problems) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    problems.push(`${path} 不是对象`);
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.has(key)) problems.push(`${path}.${key} 不是受支持的关键字`);
  }
  if (Object.hasOwn(schema, "oneOf")) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) problems.push(`${path}.oneOf 至少两个`);
    else schema.oneOf.forEach((child, index) => validateSchema(child, `${path}.oneOf[${index}]`, problems));
    return;
  }
  if (!Object.hasOwn(schema, "type")) return;
  if (!SCHEMA_TYPES.includes(schema.type)) {
    problems.push(`${path}.type 非法：${schema.type}`);
    return;
  }
  if (schema.type === "object") {
    if (Object.hasOwn(schema, "required") && !Array.isArray(schema.required)) problems.push(`${path}.required 必须是数组`);
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      validateSchema(child, `${path}.properties.${name}`, problems);
    }
  }
  if (schema.type === "array" && schema.items !== undefined) validateSchema(schema.items, `${path}.items`, problems);
  if (Object.hasOwn(schema, "enum") && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    problems.push(`${path}.enum 必须是非空数组`);
  }
}

async function main() {
  console.log(`临时 DSH_HOME: ${HOME}\n`);

  // ── 1. 挂载：提供 typert / webServer / tools / systemPrompt ──────────────
  console.log("1) 挂载插件并捕获工具面");
  const ctx = new Context();
  const captured = { manifest: null, routes: [], tools: [], sections: [] };
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
  ctx.provide("tools", {
    register: (definition) => {
      captured.tools.push(definition);

      return () => {};
    }
  });
  ctx.provide("systemPrompt", {
    section: (section) => {
      captured.sections.push(section);
      return () => {};
    }
  });
  plugin.apply(ctx);
  const studio = ctx.get("gameStudio");

  const names = captured.tools.map((tool) => tool.name);
  check(
    "注册了 8 个 game_material_* 工具",
    captured.tools.length === 8 && names.every((name) => name.startsWith("game_material_")),
    names.join("、")
  );
  check(
    "工具名逐一符合预期",
    ["call", "status", "intake", "upload", "reviewMode", "wait", "review", "approve"].every((suffix) =>
      names.includes(`game_material_${suffix}`)
    ),
    names.join("、")
  );

  const problems = [];
  for (const tool of captured.tools) {
    validateSchema(tool.parameters, `${tool.name}.parameters`, problems);
    validateSchema(tool.output?.schema, `${tool.name}.output.schema`, problems);
    if (typeof tool.output?.render !== "function") problems.push(`${tool.name}.output.render 不是函数`);
    if (typeof tool.execute !== "function") problems.push(`${tool.name}.execute 不是函数`);
  }
  check("所有工具 schema 只用受支持的关键字子集", problems.length === 0, problems.slice(0, 3).join("；"));
  check(
    "每个工具都有参数描述",
    captured.tools.every((tool) => Object.values(tool.parameters.properties ?? {}).every((node) => typeof node.description === "string")),
    ""
  );

  // ── 2. game_material_call 必须覆盖每一个远程方法 ────────────────────────
  console.log("\n2) 万能通道的方法覆盖");
  const call = captured.tools.find((tool) => tool.name === "game_material_call");
  const methodEnum = call?.parameters?.properties?.method?.enum ?? [];
  const clientOnly = METHODS.filter((spec) => spec.clientOnly === true).map((spec) => spec.method);
  const exposed = METHODS.filter((spec) => spec.clientOnly !== true).map((spec) => spec.method);
  check("method 枚举覆盖全部非 clientOnly 方法", exposed.every((method) => methodEnum.includes(method)), `枚举 ${methodEnum.length} / 期望 ${exposed.length}`);
  check("method 枚举不暴露 clientOnly 方法", clientOnly.every((method) => !methodEnum.includes(method)), clientOnly.join("、"));
  check("枚举里没有多余的方法", methodEnum.length === exposed.length);
  check("reportClientOrigin 被标成 clientOnly", clientOnly.includes("reportClientOrigin"), clientOnly.join("、"));
  check("setReviewMode 可以被模型调用", methodEnum.includes("setReviewMode"));

  // schema 里声明的 payload 情况与方法表一致（防止工具层和 wire 层漂移）。
  const paramNames = [...call.parameters.properties.method.enum];
  check("枚举顺序与方法表一致", JSON.stringify(paramNames) === JSON.stringify(exposed));

  // ── 3. 远程 payload schema 必须放行界面用到的每个字段 ───────────────────
  //
  // 这一段是为一个真实存在的坑加的：工具直接调网关方法（同进程），而界面走
  // Typert 远程网关，payload 会先过 wire.ts 的 zod schema。**schema 里漏声明
  // 一个字段，界面上的按钮就会静默失效**，而工具测试、宿主冒烟测试都绕过
  // 了 schema，一个都不会红。这里直接拿 schema 过一遍。
  console.log("\n3) 远程 payload schema");
  const specOf = (method) => METHODS.find((entry) => entry.method === method);
  const saveImage = specOf("saveImageJob").payload.parse({ jobId: "i1", approved: true, index: 0 });
  check("saveImageJob 保留 approved / index", saveImage.approved === true && saveImage.index === 0, JSON.stringify(saveImage));
  const saveSequence = specOf("saveSequenceJob").payload.parse({ jobId: "s1", approved: true, step: "frames" });
  check("saveSequenceJob 保留 approved / step", saveSequence.approved === true && saveSequence.step === "frames", JSON.stringify(saveSequence));
  const reviewMode = specOf("setReviewMode").payload.parse({ id: "p1", module: "sprite", reviewMode: "manual" });
  check("setReviewMode payload 完整", reviewMode.reviewMode === "manual" && reviewMode.module === "sprite", JSON.stringify(reviewMode));
  const originPayload = specOf("reportClientOrigin").payload.parse({ origin: "http://127.0.0.1:43120" });
  check("reportClientOrigin payload 完整", originPayload.origin === "http://127.0.0.1:43120", JSON.stringify(originPayload));
  const prompts = specOf("savePrompts").payload.parse({ projectId: "p1", suffix: "不要出现文字" });
  check("savePrompts 保留 suffix", prompts.suffix === "不要出现文字", JSON.stringify(prompts));

  // ── 4. 准备一个真实项目 / 任务，供 intake 与 review 使用 ────────────────
  console.log("\n4) 固定流程第 0 步：先问再动手");
  const tool = (name) => captured.tools.find((entry) => entry.name === name);
  const run = (name, args) => tool(name).execute(args, { signal: undefined });

  const emptyIntake = await run("game_material_intake", { module: "sprite" });
  check("没配 Key 时给出 blocker", emptyIntake.blockers.some((text) => text.includes("火山方舟")), emptyIntake.blockers.join("；"));
  check(
    "必问审核模式，且只有 auto / manual 两个选项",
    Array.isArray(emptyIntake.reviewModeQuestion?.options) &&
      emptyIntake.reviewModeQuestion.options.map((option) => option.value).join(",") === "auto,manual",
    JSON.stringify(emptyIntake.reviewModeQuestion?.options?.map((option) => option.value))
  );
  check(
    "新目标时问「新建还是继续」",
    emptyIntake.questions.some((question) => question.key === "target")
  );
  check(
    "缺源图时问源图",
    emptyIntake.questions.some((question) => question.key === "source")
  );

  // 配置一个假 Key，blocker 应当消失。
  await studio.saveConfig({ arkApiKey: "sk-verify-tools", minimaxApiKey: "mm-verify-tools" });
  const withKey = await run("game_material_intake", { module: "sprite" });
  check("配好 Key 后不再报 blocker", withKey.blockers.length === 0, withKey.blockers.join("；"));

  const { projectId } = await studio.createProject({ name: "对话调用自检项目" });
  const withProject = await run("game_material_intake", { module: "sprite", id: projectId });
  check("已有项目时不再问「新建还是继续」", !withProject.questions.some((question) => question.key === "target"));
  check("项目还没有源图，仍然要问源图", withProject.questions.some((question) => question.key === "source"));

  // 上传一张源图后，「源图」应当进入 known 而不是 questions。
  const png = encodePng(Buffer.alloc(4 * 4 * 4, 200), 4, 4);
  const sourcePath = join(HOME, "hero.png");
  await writeFile(sourcePath, png);
  await run("game_material_upload", { module: "sprite", id: projectId, kind: "source", path: sourcePath });
  const afterUpload = await run("game_material_intake", { module: "sprite", id: projectId });
  check("上传源图后不再问源图", !afterUpload.questions.some((question) => question.key === "source"));
  check("源图进入 known", typeof afterUpload.known.源图 === "string", String(afterUpload.known.源图));

  // 图片模块：提示词为空 → 必问；填好 → 不问。
  const { jobId: imageId } = await studio.createImageJob({ name: "自检图片任务" });
  const imageIntake = await run("game_material_intake", { module: "image", id: imageId });
  check("图片任务缺提示词时必问", imageIntake.questions.some((question) => question.key === "prompt"));
  await studio.saveImageJob({ jobId: imageId, prompt: "一只橘色的方块" });
  const imageIntake2 = await run("game_material_intake", { module: "image", id: imageId });
  check("填好提示词后不再问", !imageIntake2.questions.some((question) => question.key === "prompt"));

  // 序列帧模块：两种输入模式互斥，必须问。
  const { jobId: seqId } = await studio.createSequenceJob({ name: "自检序列帧任务" });
  const seqIntake = await run("game_material_intake", { module: "sequence", id: seqId });
  check("序列帧必问输入模式", seqIntake.questions.some((question) => question.key === "mode"));
  check("序列帧必问素材", seqIntake.questions.some((question) => question.key === "material"));
  check("序列帧必问提示词", seqIntake.questions.some((question) => question.key === "prompt"));
  check(
    "问过的不再重复问",
    (await run("game_material_intake", { module: "sequence", id: seqId, told: ["mode"] })).questions.every(
      (question) => question.key !== "mode"
    )
  );

  // ── 4. 审核模式：记录、读取、状态里带出来 ──────────────────────────────
  console.log("\n4) 审核模式（固定流程必问项）");
  const modeResult = await run("game_material_reviewMode", { module: "sprite", id: projectId, reviewMode: "manual" });
  check("工具能写审核模式", modeResult.reviewMode === "manual", JSON.stringify(modeResult));
  const statusManual = await run("game_material_status", { module: "sprite", id: projectId });
  check("status 里带出审核模式", statusManual.reviewMode === "manual", String(statusManual.reviewMode));
  const reIntake = await run("game_material_intake", { module: "sprite", id: projectId });
  check("已经定过审核模式就进 known", reIntake.known.审核模式 === "manual", String(reIntake.known.审核模式));

  // ── 5. status / review / approve / wait 的实际结果形状 ──────────────────
  console.log("\n5) 验收链路");
  const list = await run("game_material_status", {});
  check("不给 id 时列出三个模块的清单", Array.isArray(list.projects) && Array.isArray(list.imageJobs) && Array.isArray(list.sequenceJobs));
  check("清单里带三条模块深链接", typeof list.links?.sprite === "string" && list.links.sprite.includes("module=sprite"));

  const review = await run("game_material_review", { module: "sprite", id: projectId, stage: "images" });
  check("验收包只含指定阶段", review.stages.length === 1 && review.stages[0].stage === "images");
  check("验收包有 8 个方位", review.stages[0].cells.length === 8);
  check("验收包给出 openUrl", typeof review.openUrl === "string" && review.openUrl.includes(`project=${projectId}`));
  check("验收包给出建议动作", Array.isArray(review.nextActions) && review.nextActions.length > 0);
  check("方位过滤生效", (await run("game_material_review", { module: "sprite", id: projectId, stage: "images", direction: "front" })).stages[0].cells.length === 1);

  // 造一个假的 ready 产物，验证 approve 与 wait 的行为。
  const { patchProject } = await import("../lib/store.js");
  await patchProject(projectId, (project) => {
    project.images.front = { status: "ready", file: "images/front.png", approved: false };
  });
  const approve = await run("game_material_approve", { module: "sprite", id: projectId, stage: "images", key: "front", approved: true });
  check("approve 回执带上标的位置", approve.approved === true && approve.key === "front", JSON.stringify(approve));
  check("approve 之后 getProject 能看到已通过", (await studio.getProject({ projectId })).images.front.approved === true);
  check("approve 之后验收包里是已通过", (await run("game_material_review", { id: projectId, stage: "images", direction: "front" })).stages[0].cells[0].approved === true);

  const waited = await run("game_material_wait", { id: projectId, timeoutSeconds: 1 });
  check("没有任务在跑时 wait 立刻返回 settled", waited.settled === true && waited.timedOut === false, JSON.stringify({ settled: waited.settled, elapsedMs: waited.elapsedMs }));
  check("wait 结果里带 openUrl", typeof waited.openUrl === "string");

  const imageApproveEmpty = await tool("game_material_approve")
    .execute({ module: "image", id: imageId, approved: true }, {})
    .then(() => null, (error) => String(error?.message ?? error));
  check("空任务打通过给出可读错误", imageApproveEmpty !== null && imageApproveEmpty.includes("还没有产物"), String(imageApproveEmpty));
  await studio.addImageItem({ jobId: imageId, name: "one.png", data: png.toString("base64") });
  const imageApprove = await run("game_material_approve", { module: "image", id: imageId, approved: true });
  check("图片任务整体打通过不报错", imageApprove.approved === true, JSON.stringify(imageApprove));
  check("图片任务打通过落盘", (await studio.getImageJob({ jobId: imageId })).items[0].approved === true);
  const seqApprove = await run("game_material_approve", { module: "sequence", id: seqId, step: "video", approved: true });
  check("序列帧按步骤打通过不报错", seqApprove.step === "video", JSON.stringify(seqApprove));

  // ── 6. 错误要有可读信息 ────────────────────────────────────────────────
  console.log("\n6) 错误路径");
  const expectThrow = async (name, fn, needle) => {
    try {
      await fn();
      check(name, false, "预期抛错但没有");
    } catch (error) {
      const message = String(error?.message ?? error);
      check(name, message.includes(needle), message.slice(0, 90));
    }
  };
  await expectThrow("未知方法被拒绝", () => run("game_material_call", { method: "nope" }), "未知方法");
  await expectThrow("缺 payload 被拒绝", () => run("game_material_call", { method: "getProject" }), "payload");
  await expectThrow("上传不支持的种类被拒绝", () => run("game_material_upload", { module: "sprite", id: projectId, kind: "ref", path: sourcePath }), "不支持 kind");
  await expectThrow("不存在的文件被拒绝", () => run("game_material_upload", { module: "sprite", id: projectId, kind: "source", path: join(HOME, "nope.png") }), "读不到文件");
  await expectThrow("拿不是图片的文件当图片被拒绝", async () => {
    const textPath = join(HOME, "not-an-image.png");
    await writeFile(textPath, "definitely not a png");
    return run("game_material_upload", { module: "sprite", id: projectId, kind: "source", path: textPath });
  }, "无法识别的图片格式");
  await expectThrow("找不到的目标给出可读错误", () => run("game_material_status", { id: "pdeadbeef" }), "找不到");

  // ── 7. 深链接：宿主与浏览器半区必须用同一套常量 ─────────────────────────
  console.log("\n7) 深链接契约");
  check("查询参数名一致", links.OPEN_QUERY_KEY === "dsh-gmm", links.OPEN_QUERY_KEY);
  check("面板 id 与客户端一致", links.PANEL_KEY === "gameStudio", links.PANEL_KEY);
  check("模块名与界面一致", links.STUDIO_MODULES.join(",") === "sprite,image,sequence", links.STUDIO_MODULES.join(","));

  const link = links.buildOpenLink({ module: "sprite", projectId, stage: "videos" }, "http://127.0.0.1:43120");
  check(
    "深链接形态正确",
    link === `http://127.0.0.1:43120/?dsh-gmm=1&module=sprite&project=${projectId}&stage=videos`,
    link
  );
  check("解析回来完全一致", JSON.stringify(links.parseIntentQuery(link.split("?")[1])) === JSON.stringify({ module: "sprite", projectId, stage: "videos" }));
  check("不是深链接的查询串返回 undefined", links.parseIntentQuery("foo=1") === undefined);
  check("非法模块名被丢掉", links.parseIntentQuery("dsh-gmm=1&module=hack")?.module === undefined);
  check("未上报 origin 时退化成 http://localhost", links.originForLinks() === "http://localhost", links.originForLinks());
  check("上报后 origin 生效", links.rememberClientOrigin("http://127.0.0.1:43120") && links.originForLinks() === "http://127.0.0.1:43120");
  check("非法 origin 被拒绝", links.rememberClientOrigin("file:///x") === false && links.originForLinks() === "http://127.0.0.1:43120");

  // 浏览器半区是经典脚本（不能 import），只能靠文本契约保证两边同源。
  const clientSource = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
  const clientBundle = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
  for (const [label, text] of [
    ["src/client.ts", clientSource],
    ["lib/client.js", clientBundle]
  ]) {
    check(`${label}：含同名查询参数`, text.includes(`"${links.OPEN_QUERY_KEY}"`), links.OPEN_QUERY_KEY);
    check(`${label}：含面板 id 常量`, text.includes(`"${links.PANEL_KEY}"`), links.PANEL_KEY);
    check(`${label}：含三个模块名`, links.STUDIO_MODULES.every((module) => text.includes(`"${module}"`)), links.STUDIO_MODULES.join("、"));
    check(`${label}：注册了捕获阶段的链接拦截`, text.includes('addEventListener("click"') && text.includes("true)"), "捕获阶段");
    check(`${label}：会上报 origin`, text.includes("reportClientOrigin"), "");
    check(`${label}：读取地址栏里的深链接`, text.includes("consumeUrlIntent"), "");
  }
  check("client.ts 里没有任何 import（必须是经典脚本）", !/^\s*import\s/m.test(clientSource), "");

  // ── 8. 浏览器半区的方法清单与宿主 manifest 必须一一对应 ─────────────────
  console.log("\n8) 远程方法清单一致性");
  const listed = [...clientSource.matchAll(/^\s*\["(\w+)",\s*(true|false)\],?$/gm)].map((match) => match[1]);
  const manifestMethods = METHODS.map((spec) => spec.method);
  const missingInClient = manifestMethods.filter((method) => !listed.includes(method));
  const extraInClient = listed.filter((method) => !manifestMethods.includes(method));
  check("客户端清单覆盖全部方法", missingInClient.length === 0, missingInClient.join("、"));
  check("客户端没有多余方法", extraInClient.length === 0, extraInClient.join("、"));

  // ── 9. 系统提示词里的固定流程 ──────────────────────────────────────────
  console.log("\n9) 系统提示词的固定流程");
  check("注册了 game-material-master 提示词段", captured.sections.length === 1 && captured.sections[0].name === "game-material-master", captured.sections.map((s) => s.name).join("、"));
  const prompt = captured.sections[0]?.text ?? "";
  check("提示词要求先调 intake", /先调用 `game_material_intake`/.test(prompt), "");
  check("提示词要求问自动/人工审核", /自动审核/.test(prompt) && /人工审核/.test(prompt), "");
  check("提示词要求得到答复前不许生成", /不要调用任何生成类/.test(prompt), "");
  check("提示词要求把 openUrl 写成 Markdown 链接", /Markdown 链接/.test(prompt) && /openUrl/.test(prompt), "");
  check("提示词说明 manual 模式要停下等确认", /停下等用户回复/.test(prompt), "");
  check("提示词提醒计费", /计费/.test(prompt), "");
  check("提示词段有稳定 order（利于 KV 缓存）", Number.isFinite(captured.sections[0]?.order), String(captured.sections[0]?.order));

  await rm(HOME, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
    process.exit(1);
  }
  console.log(`共 ${checks} 项检查，全部通过。`);
}

await main();
