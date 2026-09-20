/**
 * 火山方舟（Ark）图片生成客户端。
 *
 * 端点：`POST {baseUrl}/images/generations`
 * 参考图既可以给 http(s) URL，也可以给 `data:image/...;base64,...`（本地图片走这条）。
 * 返回的 URL 只有 24 小时有效期，所以拿到就立刻下载落盘。
 */
export class ArkError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.name = "ArkError";
        this.status = status;
        this.code = code;
    }
}
function isFiveSeries(model) {
    return /seedream-5-0/i.test(model);
}
function sniffExt(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return "png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return "jpg";
    if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
        return "webp";
    return "png";
}
async function readErrorBody(response) {
    const text = await response.text().catch(() => "");
    if (text.trim() === "")
        return { message: `HTTP ${response.status} ${response.statusText}` };
    try {
        const parsed = JSON.parse(text);
        const err = parsed?.error ?? parsed;
        const message = typeof err?.message === "string" ? err.message : text.slice(0, 500);
        const code = typeof err?.code === "string" ? err.code : undefined;
        return { message, code };
    }
    catch {
        return { message: text.slice(0, 500) };
    }
}
/**
 * 调一次生图。`images` 为空时是文生图，非空时是图生图 / 多图参考。
 * 无论远端返回 url 还是 b64_json，都统一返回图片字节。
 */
export async function generateImage(request, signal) {
    if (request.apiKey.trim() === "")
        throw new ArkError("尚未配置火山方舟 API Key（设置 → 游戏素材大师）");
    if (request.model.trim() === "")
        throw new ArkError("尚未配置生图模型 ID");
    const body = {
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        response_format: "url",
        watermark: request.watermark === true
    };
    if (request.images.length === 1)
        body.image = request.images[0];
    else if (request.images.length > 1)
        body.image = request.images;
    // output_format 只有 5.0 系列接受；4.x 传了会 400。
    if (isFiveSeries(request.model))
        body.output_format = "png";
    const timeout = AbortSignal.timeout(Math.max(10000, request.timeoutMs));
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response;
    try {
        response = await fetch(`${request.baseUrl}/images/generations`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${request.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body),
            signal: composed
        });
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (timeout.aborted)
            throw new ArkError(`生图请求超时（${Math.round(request.timeoutMs / 1000)} 秒）`);
        if (signal?.aborted === true)
            throw new ArkError("生图请求已被取消");
        throw new ArkError(`无法连接火山方舟：${reason}`);
    }
    if (!response.ok) {
        const { message, code } = await readErrorBody(response);
        throw new ArkError(`火山方舟生图失败（HTTP ${response.status}）：${message}`, response.status, code);
    }
    const payload = (await response.json().catch(() => undefined));
    const item = payload?.data?.[0];
    if (item === undefined) {
        throw new ArkError(`火山方舟返回里没有图片：${JSON.stringify(payload).slice(0, 400)}`);
    }
    if (typeof item.b64_json === "string" && item.b64_json !== "") {
        const bytes = Buffer.from(item.b64_json, "base64");
        return { bytes, ext: sniffExt(bytes), usage: payload?.usage };
    }
    if (typeof item.url === "string" && item.url !== "") {
        const download = await fetch(item.url, { signal: composed }).catch((error) => {
            throw new ArkError(`下载生成结果失败：${error instanceof Error ? error.message : String(error)}`);
        });
        if (!download.ok) {
            throw new ArkError(`下载生成结果失败（HTTP ${download.status}）`);
        }
        const bytes = Buffer.from(await download.arrayBuffer());
        return { bytes, ext: sniffExt(bytes), remoteUrl: item.url, usage: payload?.usage };
    }
    throw new ArkError(`火山方舟返回里既没有 url 也没有 b64_json：${JSON.stringify(item).slice(0, 400)}`);
}
/**
 * 连通性自检：真实生成一张 1K 小图。
 * 只有真跑一次才能同时验证「Key 有效」和「模型/接入点可用」——这是最常见的两个坑。
 */
export async function testArk(request) {
    const result = await generateImage({
        ...request,
        prompt: "一张纯绿色背景的空白测试图，画面中只有一个居中的小圆点",
        images: [],
        size: "1K",
        watermark: false
    });
    return { ok: true, model: request.model, bytes: result.bytes.length, ext: result.ext };
}
