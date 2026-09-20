/**
 * MiniMax 视频生成客户端（图生视频）。
 *
 * 两套协议并存，按模型名自动选择：
 *
 * **v2（MiniMax-H3 / H3-Max）** —— 平台新的统一入口，多模态 content 数组：
 *   1. `POST {root}/v2/video_generation`              → task_id
 *   2. `GET  {root}/v2/query/video_generation/{id}`   → status + content.url
 *   查询接口**直接返回视频地址**，不需要再走一次取件。
 *
 * **v1（Hailuo / I2V 系列）** —— 老的三步走：
 *   1. `POST {root}/v1/video_generation`              → task_id
 *   2. `GET  {root}/v1/query/video_generation`        → status / file_id
 *   3. `GET  {root}/v1/files/retrieve`                → download_url
 *
 * **优云智算（cp.compshare.cn）** —— H3 的第三方网关，请求体与官方 v2 完全一致，
 * 只是路径多一层 `/minimax` 前缀（`{root}/minimax/v2/...`），模型名仍是
 * `MiniMax-H3`；分辨率多支持 1080P/4K 后置超分，时长放宽到 4~30 秒。
 *
 * 提交与轮询分开，是因为 8 个视频要并发提交、统一轮询；一次生成通常需要
 * 1~6 分钟，绝不能同步阻塞一次远程调用。
 */
export const MODEL_CAPABILITIES = {
    "MiniMax-H3": {
        protocol: "v2",
        resolutions: ["2K", "768P"],
        durationMin: 4,
        durationMax: 15,
        note: "v2 · 768P/2K · 4~15 秒"
    },
    "MiniMax-H3-Max": {
        protocol: "v2",
        resolutions: ["768P", "480P"],
        durationMin: 5,
        durationMax: 15,
        note: "v2 极速 · 480P/768P · 5~15 秒"
    },
    "MiniMax-Hailuo-02": {
        protocol: "v1",
        resolutions: ["768P", "1080P"],
        durations: [6, 10],
        durationMin: 6,
        durationMax: 10,
        note: "v1 · 6/10 秒"
    },
    "I2V-01-Director": {
        protocol: "v1",
        resolutions: ["720P"],
        durations: [6],
        durationMin: 6,
        durationMax: 6,
        note: "v1 · 支持运镜指令"
    },
    "I2V-01": { protocol: "v1", resolutions: ["720P"], durations: [6], durationMin: 6, durationMax: 6, note: "v1" },
    "I2V-01-live": { protocol: "v1", resolutions: ["720P"], durations: [6], durationMin: 6, durationMax: 6, note: "v1" }
};
export class MiniMaxError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.name = "MiniMaxError";
        this.status = status;
        this.code = code;
    }
}
/** 从模型名判断走哪套协议。 */
export function protocolOf(model) {
    return /^MiniMax-H3/i.test(model.trim()) ? "v2" : "v1";
}
/** 优云智算（Compshare）MiniMax H3 网关主机，请求路径要多一层 `/minimax`。 */
export const COMP_SHARE_HOST = "cp.compshare.cn";
export const COMP_SHARE_PATH_PREFIX = "/minimax";
/** 判断某个主机是不是优云智算网关。 */
export function isCompshareHost(baseUrl) {
    const host = /^https?:\/\/([^/:]+)/i.exec(baseUrl.trim())?.[1]?.toLowerCase() ?? "";
    return host === COMP_SHARE_HOST;
}
/**
 * 依据主机返回 MiniMax 网关的路径前缀。
 * 官方站（api.minimaxi.com / api.minimax.cn）直接挂 `/v1`、`/v2`；
 * 优云智算（cp.compshare.cn）把 MiniMax 的接口放在 `/minimax/v1`、`/minimax/v2` 下。
 */
export function pathPrefixOf(baseUrl) {
    return isCompshareHost(baseUrl) ? COMP_SHARE_PATH_PREFIX : "";
}
/** 某个模型的能力；未知模型按协议给一套宽松区间。baseUrl 用于识别优云智算网关。 */
export function capabilityOf(model, baseUrl) {
    const trimmed = model.trim();
    const known = MODEL_CAPABILITIES[trimmed];
    if (known !== undefined) {
        // 优云智算的 H3：分辨率多支持 1080P（后置超分），时长放宽到 4~30 秒。
        if (baseUrl !== undefined && isCompshareHost(baseUrl) && /^MiniMax-H3$/i.test(trimmed)) {
            return {
                protocol: "v2",
                resolutions: ["2K", "1080P", "768P"],
                durationMin: 4,
                durationMax: 30,
                note: "v2（优云智算）· 768P/1080P/2K · 4~30 秒"
            };
        }
        return known;
    }
    const protocol = protocolOf(trimmed);
    return protocol === "v2"
        ? { protocol, resolutions: ["2K", "768P"], durationMin: 4, durationMax: 15, note: "v2（自定义模型）" }
        : { protocol, resolutions: ["1080P", "768P"], durationMin: 6, durationMax: 10, note: "v1（自定义模型）" };
}
/**
 * 把 baseUrl 收敛成主机根。
 * 历史配置里存的是 `.../v1`，所以这里顺手把结尾的 `/v1`、`/v2` 剥掉——
 * 路径一律由本模块按协议拼，避免出现 `/v1/v2/...` 这种组合。
 */
export function rootOf(baseUrl) {
    return baseUrl
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/(v1|v2)$/i, "");
}
/** 按模型能力把时长收敛到合法值。 */
export function normalizeDuration(model, value, baseUrl) {
    const capability = capabilityOf(model, baseUrl);
    const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    const wanted = Number.isFinite(n) ? Math.round(n) : capability.durationMin;
    if (capability.durations !== undefined && capability.durations.length > 0) {
        // 定值档位：取最接近的一档。距离相同时取更长的那一档——片段越长，
        // 「走三步」越容易完整落进画面，而这个插件要的正是步伐帧。
        let best = capability.durations[0];
        for (const candidate of capability.durations) {
            const candidateGap = Math.abs(candidate - wanted);
            const bestGap = Math.abs(best - wanted);
            if (candidateGap < bestGap || (candidateGap === bestGap && candidate > best))
                best = candidate;
        }
        return best;
    }
    return Math.min(capability.durationMax, Math.max(capability.durationMin, wanted));
}
/** 按模型能力把分辨率收敛到合法档位。 */
export function normalizeResolution(model, value, baseUrl) {
    const capability = capabilityOf(model, baseUrl);
    const wanted = String(value ?? "").trim();
    return capability.resolutions.includes(wanted) ? wanted : capability.resolutions[0];
}
function headers(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    };
}
function assertKey(apiKey) {
    if (apiKey.trim() === "")
        throw new MiniMaxError("尚未配置 MiniMax API Key（设置 → 游戏素材大师）");
}
/**
 * 解析错误响应。平台上有两种风格：
 *  - v1：`{ base_resp: { status_code, status_msg } }`
 *  - v2：`{ type: "error", error: { type, message, http_code } }`（OpenAI 风格）
 */
async function readError(response) {
    const text = await response.text().catch(() => "");
    if (text.trim() === "")
        return { message: `HTTP ${response.status} ${response.statusText}` };
    try {
        const parsed = JSON.parse(text);
        const base = parsed?.base_resp;
        if (base !== undefined && base.status_code !== undefined && base.status_code !== 0) {
            return { message: `[${base.status_code}] ${base.status_msg}`, code: String(base.status_code) };
        }
        const err = parsed?.error ?? parsed;
        const message = typeof err?.message === "string"
            ? err.message
            : typeof parsed?.message === "string"
                ? parsed.message
                : text.slice(0, 500);
        const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : undefined;
        return { message, code };
    }
    catch {
        return { message: text.slice(0, 500) };
    }
}
async function requestJson(url, init, timeoutMs, what) {
    const timeout = AbortSignal.timeout(Math.max(10000, timeoutMs));
    let response;
    try {
        response = await fetch(url, { ...init, signal: timeout });
    }
    catch (error) {
        if (timeout.aborted)
            throw new MiniMaxError(`${what}超时（${Math.round(timeoutMs / 1000)} 秒）`);
        throw new MiniMaxError(`无法连接 MiniMax：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
        const { message, code } = await readError(response);
        throw new MiniMaxError(`${what}失败（HTTP ${response.status}）：${message}`, response.status, code);
    }
    const payload = (await response.json().catch(() => undefined));
    const base = payload?.base_resp;
    if (base !== undefined && base.status_code !== 0) {
        throw new MiniMaxError(`${what}失败：[${base.status_code}] ${base.status_msg}`, response.status, String(base.status_code));
    }
    return payload;
}
/** 判断这次请求是「首尾帧模式」还是「多模态参考模式」。 */
export function mediaModeOf(input) {
    const hasFrame = (input.firstFrameImage ?? "") !== "" || (input.lastFrameImage ?? "") !== "";
    const hasRef = (input.referenceImages?.length ?? 0) > 0 || (input.referenceVideos?.length ?? 0) > 0;
    if (hasFrame && hasRef) {
        throw new MiniMaxError("首帧/尾帧模式与多模态参考模式不能混用：请二选一");
    }
    if (hasFrame)
        return "frames";
    if (hasRef)
        return "reference";
    return "text";
}
/** v2：多模态 content 数组。 */
function buildV2Body(input) {
    const mode = mediaModeOf(input);
    const content = [{ type: "text", text: input.prompt }];
    if (mode === "frames") {
        if ((input.firstFrameImage ?? "") !== "") {
            content.push({ type: "image_url", image_url: { url: input.firstFrameImage }, role: "first_frame" });
        }
        if ((input.lastFrameImage ?? "") !== "") {
            content.push({ type: "image_url", image_url: { url: input.lastFrameImage }, role: "last_frame" });
        }
    }
    else if (mode === "reference") {
        for (const url of input.referenceImages ?? []) {
            content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
        }
        for (const url of input.referenceVideos ?? []) {
            content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
        }
    }
    const body = {
        model: input.model,
        content,
        resolution: normalizeResolution(input.model, input.resolution, input.baseUrl),
        duration: normalizeDuration(input.model, input.duration, input.baseUrl),
        // 首尾帧模式的宽高比由首帧图决定，官方规定恒为 adaptive；
        // 参考模式可选；纯文生视频必须给具体比例（默认 16:9）。
        ratio: input.ratio ?? (mode === "text" ? "16:9" : "adaptive")
    };
    // extra 只有 H3-Max 认；别的模型传了会被判为未声明字段。
    if (/H3-Max/i.test(input.model) && input.promptOptimizer !== undefined) {
        body.extra = { prompt_expansion_mode: input.promptOptimizer ? "balanced" : "disabled" };
    }
    return body;
}
/** v1：扁平参数，只支持首帧图；参考模式是 v2 才有的能力。 */
function buildV1Body(input) {
    const mode = mediaModeOf(input);
    if (mode === "reference") {
        throw new MiniMaxError("参考图 / 参考视频模式需要 MiniMax-H3 系列（v2 协议），当前模型不支持");
    }
    if (mode === "text") {
        throw new MiniMaxError("v1 协议只支持图生视频，请提供一张首帧图");
    }
    const body = {
        model: input.model,
        prompt: input.prompt,
        first_frame_image: input.firstFrameImage
    };
    // duration / resolution 是 Hailuo 系列的参数，I2V-01 传了会报错。
    if (/hailuo/i.test(input.model)) {
        if (input.duration !== undefined)
            body.duration = normalizeDuration(input.model, input.duration, input.baseUrl);
        if (input.resolution !== undefined)
            body.resolution = normalizeResolution(input.model, input.resolution, input.baseUrl);
    }
    if (input.promptOptimizer !== undefined)
        body.prompt_optimizer = input.promptOptimizer;
    return body;
}
/** 提交一个图生视频任务，返回 task_id。 */
export async function submitVideo(input) {
    assertKey(input.apiKey);
    if ((input.prompt ?? "").trim() === "")
        throw new MiniMaxError("提示词不能为空");
    const root = rootOf(input.baseUrl);
    const prefix = pathPrefixOf(root);
    const isV2 = protocolOf(input.model) === "v2";
    const url = isV2 ? `${root}${prefix}/v2/video_generation` : `${root}${prefix}/v1/video_generation`;
    const body = isV2 ? buildV2Body(input) : buildV1Body(input);
    const payload = await requestJson(url, { method: "POST", headers: headers(input.apiKey), body: JSON.stringify(body) }, input.timeoutMs, "提交视频任务");
    const taskId = payload?.task_id ?? payload?.task?.id;
    if (typeof taskId !== "string" || taskId === "") {
        throw new MiniMaxError(`MiniMax 未返回 task_id：${JSON.stringify(payload).slice(0, 400)}`);
    }
    return taskId;
}
function mapV2Status(raw) {
    switch (raw) {
        case "succeeded":
            return "succeeded";
        case "failed":
        case "cancelled":
            return "failed";
        case "running":
            return "running";
        default:
            return "pending";
    }
}
function mapV1Status(raw) {
    switch (raw) {
        case "Success":
            return "succeeded";
        case "Fail":
            return "failed";
        case "Processing":
        case "Preparing":
        case "Queueing":
            return "running";
        default:
            return "pending";
    }
}
export async function queryVideo(input) {
    assertKey(input.apiKey);
    const root = rootOf(input.baseUrl);
    const prefix = pathPrefixOf(root);
    if (protocolOf(input.model) === "v2") {
        const payload = await requestJson(`${root}${prefix}/v2/query/video_generation/${encodeURIComponent(input.taskId)}`, { method: "GET", headers: headers(input.apiKey) }, input.timeoutMs, "查询视频任务");
        const task = payload?.task ?? payload;
        const remoteStatus = String(task?.status ?? "");
        const videoUrl = typeof task?.content?.url === "string" && task.content.url !== "" ? task.content.url : undefined;
        const errorMessage = task?.error !== undefined
            ? [task.error.code, task.error.message].filter((v) => typeof v === "string" && v !== "").join("：")
            : undefined;
        return { status: mapV2Status(remoteStatus), remoteStatus, videoUrl, error: errorMessage, raw: payload };
    }
    const payload = await requestJson(`${root}${prefix}/v1/query/video_generation?task_id=${encodeURIComponent(input.taskId)}`, { method: "GET", headers: headers(input.apiKey) }, input.timeoutMs, "查询视频任务");
    const remoteStatus = String(payload?.status ?? "");
    const fileId = typeof payload?.file_id === "string" && payload.file_id !== "" ? payload.file_id : undefined;
    return { status: mapV1Status(remoteStatus), remoteStatus, fileId, raw: payload };
}
/** v1 专用：用 file_id 换取下载地址。v2 直接给 content.url，不需要这一步。 */
export async function retrieveFile(input) {
    assertKey(input.apiKey);
    const payload = await requestJson(`${rootOf(input.baseUrl)}${pathPrefixOf(input.baseUrl)}/v1/files/retrieve?file_id=${encodeURIComponent(input.fileId)}`, { method: "GET", headers: headers(input.apiKey) }, input.timeoutMs, "获取视频下载地址");
    const url = payload?.file?.download_url;
    if (typeof url !== "string" || url === "") {
        throw new MiniMaxError(`MiniMax 未返回下载地址：${JSON.stringify(payload).slice(0, 400)}`);
    }
    return url;
}
/** 把视频下载到本地。 */
export async function downloadVideo(url, timeoutMs) {
    const timeout = AbortSignal.timeout(Math.max(30000, timeoutMs));
    const response = await fetch(url, { signal: timeout });
    if (!response.ok)
        throw new MiniMaxError(`下载视频失败（HTTP ${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
}
/**
 * 连通性自检：查一个不存在的任务。
 * 免费，且能精确区分「Key 无效」与「Key 有效但任务不存在」。
 */
export async function testMiniMax(input) {
    assertKey(input.apiKey);
    const protocol = protocolOf(input.model);
    try {
        await queryVideo({ ...input, taskId: "00000000000000000000000000000000" });
    }
    catch (error) {
        const status = error instanceof MiniMaxError ? error.status : undefined;
        const code = error instanceof MiniMaxError ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        // 2049 / 1004 = 鉴权失败；401 同理。
        if (status === 401 || code === "2049" || code === "1004" || /invalid api key|authorized_error/i.test(message)) {
            throw new MiniMaxError(`MiniMax API Key 无效：${message}`, status, code);
        }
        // 任务不存在（v2 的 record not found / v1 的内部错误）说明鉴权已经通过。
    }
    return { ok: true, model: input.model, protocol };
}
