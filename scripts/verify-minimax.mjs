/**
 * MiniMax 协议层单元测试（纯本地，不联网）。
 *
 *   node scripts/verify-minimax.mjs
 *
 * 重点覆盖 v1/v2 的切换、历史 baseUrl 的迁移，以及「参数跟着模型收敛」——
 * 这几处一旦出错，表现是远端 400，很难从错误信息反推。
 */

const { protocolOf, capabilityOf, rootOf, normalizeDuration, normalizeResolution, MODEL_CAPABILITIES } = await import(
  "../lib/minimax.js"
);

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

console.log("1) 协议选择");
check("MiniMax-H3 → v2", protocolOf("MiniMax-H3") === "v2");
check("MiniMax-H3-Max → v2", protocolOf("MiniMax-H3-Max") === "v2");
check("大小写无关", protocolOf("minimax-h3") === "v2");
check("Hailuo → v1", protocolOf("MiniMax-Hailuo-02") === "v1");
check("I2V-01 → v1", protocolOf("I2V-01") === "v1");
check("未知模型 → v1（保守）", protocolOf("some-future-model") === "v1");

console.log("2) baseUrl 收敛（历史配置存的是 …/v1）");
check("剥掉结尾的 /v1", rootOf("https://api.minimaxi.com/v1") === "https://api.minimaxi.com");
check("剥掉结尾的 /v2", rootOf("https://api.minimaxi.com/v2") === "https://api.minimaxi.com");
check("剥掉结尾斜杠", rootOf("https://api.minimax.cn/") === "https://api.minimax.cn");
check("已是主机根则原样", rootOf("https://api.minimax.cn") === "https://api.minimax.cn");
check("不会误伤路径里的 v1", rootOf("https://proxy.example.com/api/v1") === "https://proxy.example.com/api");
check("前后空格被裁掉", rootOf("  https://api.minimax.cn/v1  ") === "https://api.minimax.cn");

console.log("3) 模型能力");
const h3 = capabilityOf("MiniMax-H3");
check("H3 支持 2K 与 768P", h3.resolutions.join(",") === "2K,768P", h3.resolutions.join(","));
check("H3 时长区间 4~15", h3.durationMin === 4 && h3.durationMax === 15);
check("H3 无定值档位", h3.durations === undefined);
const h3max = capabilityOf("MiniMax-H3-Max");
check("H3-Max 不支持 2K", !h3max.resolutions.includes("2K"), h3max.resolutions.join(","));
check("H3-Max 时长从 5 起", h3max.durationMin === 5);
const hailuo = capabilityOf("MiniMax-Hailuo-02");
check("Hailuo 只有 6/10 两档", JSON.stringify(hailuo.durations) === "[6,10]");
check("预置表里的每个模型都有能力定义", Object.keys(MODEL_CAPABILITIES).length >= 6, String(Object.keys(MODEL_CAPABILITIES).length));

console.log("4) 参数跟着模型收敛");
check("H3 时长 6 保持 6", normalizeDuration("MiniMax-H3", 6) === 6);
check("H3 时长上溢收到 15", normalizeDuration("MiniMax-H3", 99) === 15);
check("H3 时长下溢收到 4", normalizeDuration("MiniMax-H3", 1) === 4);
check("Hailuo 时长 7 归到最近的 6", normalizeDuration("MiniMax-Hailuo-02", 7) === 6, String(normalizeDuration("MiniMax-Hailuo-02", 7)));
check("Hailuo 时长 8 归到最近的 10", normalizeDuration("MiniMax-Hailuo-02", 8) === 10, String(normalizeDuration("MiniMax-Hailuo-02", 8)));
check("H3-Max 时长 4 抬到 5", normalizeDuration("MiniMax-H3-Max", 4) === 5);
check("非数字回落最小值", normalizeDuration("MiniMax-H3", "abc") === 4);

check("H3 保留合法的 768P", normalizeResolution("MiniMax-H3", "768P") === "768P");
check("H3 收到非法的 1080P → 回落到 2K", normalizeResolution("MiniMax-H3", "1080P") === "2K", normalizeResolution("MiniMax-H3", "1080P"));
check("H3-Max 收到 2K → 回落到 768P", normalizeResolution("MiniMax-H3-Max", "2K") === "768P", normalizeResolution("MiniMax-H3-Max", "2K"));
check("Hailuo 保留 1080P", normalizeResolution("MiniMax-Hailuo-02", "1080P") === "1080P");

// ── 5. 请求体构造（拦截 fetch，不产生任何费用）────────────────────────
console.log("5) 请求体构造与响应解析（假 fetch 拦截）");
const { submitVideo, queryVideo, retrieveFile } = await import("../lib/minimax.js");

let calls = [];
let nextPayload = {};
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
  return new Response(JSON.stringify(nextPayload), { status: 200, headers: { "content-type": "application/json" } });
};

const BASE = { baseUrl: "https://api.minimaxi.com/v1", apiKey: "test-key", timeoutMs: 10000 };

calls = []; nextPayload = { task_id: "task-abc" };
const v2Task = await submitVideo({
  ...BASE,
  model: "MiniMax-H3",
  prompt: "原地走三步",
  firstFrameImage: "data:image/jpeg;base64,AAAA",
  duration: 5,
  resolution: "768P",
  promptOptimizer: true
});
const v2 = calls[0];
check("H3 打到 /v2/video_generation（历史 …/v1 已迁移）", v2.url === "https://api.minimaxi.com/v2/video_generation", v2.url);
check("H3 用 POST", v2.method === "POST");
check("H3 的 content[0] 是 text", v2.body.content?.[0]?.type === "text" && v2.body.content[0].text === "原地走三步");
check("H3 的 content[1] 是 first_frame 图片", v2.body.content?.[1]?.type === "image_url" && v2.body.content[1].role === "first_frame");
check("H3 图片走 data URI 放进 image_url.url", String(v2.body.content?.[1]?.image_url?.url).startsWith("data:image/jpeg;base64,"));
check("H3 带 resolution / duration / ratio", v2.body.resolution === "768P" && v2.body.duration === 5 && v2.body.ratio === "adaptive");
check("H3 不携带 v1 专属字段", v2.body.first_frame_image === undefined && v2.body.prompt === undefined && v2.body.prompt_optimizer === undefined);
check("H3 不携带 H3-Max 专属 extra", v2.body.extra === undefined);
check("能从响应里取到 task_id", v2Task === "task-abc", v2Task);

calls = []; nextPayload = { task_id: "task-max" };
await submitVideo({
  ...BASE,
  model: "MiniMax-H3-Max",
  prompt: "x",
  firstFrameImage: "data:image/jpeg;base64,AAAA",
  duration: 4,
  resolution: "2K",
  promptOptimizer: false
});
check("H3-Max 时长 4 被抬到 5", calls[0].body.duration === 5, String(calls[0].body.duration));
check("H3-Max 的 2K 被回落到 768P", calls[0].body.resolution === "768P", calls[0].body.resolution);
check("H3-Max 带 extra.prompt_expansion_mode=disabled", calls[0].body.extra?.prompt_expansion_mode === "disabled");

calls = []; nextPayload = { task_id: "task-v1" };
await submitVideo({
  ...BASE,
  model: "MiniMax-Hailuo-02",
  prompt: "原地走三步",
  firstFrameImage: "data:image/jpeg;base64,AAAA",
  duration: 6,
  resolution: "1080P",
  promptOptimizer: true
});
const v1 = calls[0];
check("Hailuo 仍打到 /v1/video_generation", v1.url === "https://api.minimaxi.com/v1/video_generation", v1.url);
check("Hailuo 用扁平 first_frame_image", String(v1.body.first_frame_image).startsWith("data:image/jpeg"));
check("Hailuo 带 prompt 与 prompt_optimizer", v1.body.prompt === "原地走三步" && v1.body.prompt_optimizer === true);
check("Hailuo 不携带 v2 的 content 数组", v1.body.content === undefined);

calls = []; nextPayload = { task: { status: "succeeded", content: { url: "https://cdn.example.com/out.mp4" } } };
const q2 = await queryVideo({ ...BASE, model: "MiniMax-H3", taskId: "task abc" });
check("v2 查询走路径参数并做转义", calls[0].url === "https://api.minimaxi.com/v2/query/video_generation/task%20abc", calls[0].url);
check("v2 succeeded → status=succeeded", q2.status === "succeeded");
check("v2 直接拿到视频地址", q2.videoUrl === "https://cdn.example.com/out.mp4");

nextPayload = { task: { status: "running" } };
check("v2 running → status=running", (await queryVideo({ ...BASE, model: "MiniMax-H3", taskId: "t" })).status === "running");
nextPayload = { task: { status: "queued" } };
check("v2 queued → status=pending", (await queryVideo({ ...BASE, model: "MiniMax-H3", taskId: "t" })).status === "pending");
nextPayload = { task: { status: "cancelled" } };
check("v2 cancelled → status=failed", (await queryVideo({ ...BASE, model: "MiniMax-H3", taskId: "t" })).status === "failed");
nextPayload = { task: { status: "failed", error: { code: "1026", message: "内容审核不通过" } } };
const qErr = await queryVideo({ ...BASE, model: "MiniMax-H3", taskId: "t" });
check("v2 failed 带出失败原因", qErr.status === "failed" && /内容审核不通过/.test(qErr.error ?? ""), qErr.error);

calls = []; nextPayload = { status: "Success", file_id: "file-9" };
const q1 = await queryVideo({ ...BASE, model: "MiniMax-Hailuo-02", taskId: "t1" });
check("v1 查询走 query string", calls[0].url === "https://api.minimaxi.com/v1/query/video_generation?task_id=t1", calls[0].url);
check("v1 Success → status=succeeded 且带 file_id", q1.status === "succeeded" && q1.fileId === "file-9");
nextPayload = { status: "Fail" };
check("v1 Fail → status=failed", (await queryVideo({ ...BASE, model: "MiniMax-Hailuo-02", taskId: "t" })).status === "failed");
nextPayload = { status: "Processing" };
check("v1 Processing → status=running", (await queryVideo({ ...BASE, model: "MiniMax-Hailuo-02", taskId: "t" })).status === "running");

calls = []; nextPayload = { file: { download_url: "https://cdn.example.com/v1.mp4" } };
const dl = await retrieveFile({ ...BASE, model: "MiniMax-Hailuo-02", fileId: "file-9" });
check("v1 取件走 /v1/files/retrieve", calls[0].url === "https://api.minimaxi.com/v1/files/retrieve?file_id=file-9", calls[0].url);
check("v1 取件拿到下载地址", dl === "https://cdn.example.com/v1.mp4");

// 鉴权失败必须被认出来
globalThis.fetch = async () =>
  new Response(JSON.stringify({ type: "error", error: { type: "authorized_error", message: "invalid api key (2049)" } }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });
let authThrew = "";
try {
  await queryVideo({ ...BASE, model: "MiniMax-H3", taskId: "t" });
} catch (error) {
  authThrew = String(error.message);
}
check("401 鉴权失败抛错并带上原因", /401|2049|invalid api key/i.test(authThrew), authThrew.slice(0, 70));

console.log(`\n共 ${checks} 项检查，失败 ${failures.length} 项。`);
if (failures.length > 0) {
  console.error(`失败项：${failures.join("、")}`);
  process.exit(1);
}
console.log("MiniMax 协议层全部通过。");
