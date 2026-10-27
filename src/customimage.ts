/**
 * 自定义生图后端：OpenAI API / ComfyUI API / Stable Diffusion WebUI API。
 *
 * 三个协议的共同点是「都返回图片字节」，差异全在**怎么问**：
 *
 * | 协议 | 生图 | 带参考图 | 取结果 |
 * |---|---|---|---|
 * | `openai` | `POST {base}/images/generations` | `POST {base}/images/edits`（multipart），
 *   端点不存在时退回 generations 的 `image` 字段 | `data[0].b64_json` 或 `data[0].url` |
 * | `sdwebui` | `POST {base}/sdapi/v1/txt2img` | `POST {base}/sdapi/v1/img2img`（`init_images`） | `images[0]`（base64） |
 * | `comfyui` | `POST {base}/prompt` + 轮询 `/history` + `GET /view` | 先 `POST {base}/upload/image`，把文件名写进工作流 | `/view` 返回的图片字节 |
 *
 * 这里**只负责一次调用**，不做重试、不碰落盘：重试与产物管理在各自的模块里。
 */

import { sniffExt } from "./ark.js";
import { CUSTOM_PROTOCOL_DEFAULTS, type CustomProtocol } from "./config.js";

export interface CustomImageRequest {
  protocol: CustomProtocol;
  /** 主机根地址（不含具体端点），末尾斜杠由调用方去掉。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  /**
   * 参考图。元素是 `data:image/...;base64,...` 或 http(s) URL —— 与 Ark 那条路**同形**，
   * 所以调用点不必为「换了后端」分叉。各协议自己决定怎么把它变成对方要的形态。
   */
  images: string[];
  /** `1024x1024` / `1024×1024` / `1K` / `2K` / `4K`，或空串（交给服务端默认）。 */
  size: string;
  timeoutMs: number;
  negativePrompt: string;
  steps: number;
  cfgScale: number;
  sampler: string;
  /** 图生图重绘强度 0~1。 */
  denoising: number;
  /** `-1` = 每次随机。 */
  seed: number;
  /** ComfyUI 的 API 格式工作流 JSON（文本）。 */
  workflow: string;
}

export interface CustomImageResult {
  bytes: Buffer;
  /** 落盘用的扩展名，由实际内容嗅探得到。 */
  ext: string;
  remoteUrl?: string;
  /** 远端返回的元信息，便于排错。 */
  usage?: unknown;
}

export class CustomImageError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CustomImageError";
    this.status = status;
  }
}

function protocolLabel(protocol: CustomProtocol): string {
  return CUSTOM_PROTOCOL_DEFAULTS[protocol]?.label ?? protocol;
}

/** 拼端点：容忍用户把末尾斜杠写多了。 */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * 鉴权头。
 *
 * 三种情况都要照顾到：没有 Key（本地服务，最常见）、`user:pass`（A1111 的 `--api-auth`
 * 是 HTTP Basic）、以及普通 Bearer Token（云端 OpenAI 兼容服务）。
 */
function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (key === "") return {};
  if (key.includes(":")) {
    return { Authorization: `Basic ${Buffer.from(key, "utf8").toString("base64")}` };
  }
  return { Authorization: `Bearer ${key}` };
}

interface SignalContext {
  composed: AbortSignal;
  timeout: AbortSignal;
  signal: AbortSignal | undefined;
  protocol: CustomProtocol;
  timeoutMs: number;
}

function makeSignalContext(protocol: CustomProtocol, timeoutMs: number, signal: AbortSignal | undefined): SignalContext {
  const timeout = AbortSignal.timeout(Math.max(10000, timeoutMs));
  return {
    protocol,
    timeoutMs,
    signal,
    timeout,
    composed: signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  };
}

/** 统一的网络错误翻译：超时 / 主动取消 / 连不上，三种要给用户完全不同的提示。 */
function networkError(context: SignalContext, error: unknown): CustomImageError {
  const label = protocolLabel(context.protocol);
  if (context.timeout.aborted) {
    return new CustomImageError(`${label} 请求超时（${Math.round(context.timeoutMs / 1000)} 秒）`);
  }
  if (context.signal?.aborted === true) return new CustomImageError(`${label} 请求已被取消`);
  return new CustomImageError(`无法连接 ${label}：${error instanceof Error ? error.message : String(error)}`);
}

async function fetchOrThrow(url: string, init: RequestInit, context: SignalContext): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: context.composed });
  } catch (error) {
    throw networkError(context, error);
  }
}

/** 读错误体：不同后端给的字段名差很远，能捞到一句人话就够。 */
async function errorMessageOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text.trim() === "") return `HTTP ${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as any;
    const candidate = parsed?.error ?? parsed;
    const message =
      typeof candidate?.message === "string"
        ? candidate.message
        : typeof candidate?.error === "string"
          ? candidate.error
          : typeof parsed?.detail === "string"
            ? JSON.stringify(parsed.detail)
            : text.slice(0, 400);
    return message;
  } catch {
    return text.slice(0, 400);
  }
}

async function ensureOk(response: Response, context: SignalContext, what: string): Promise<void> {
  if (response.ok) return;
  const detail = await errorMessageOf(response);
  throw new CustomImageError(`${protocolLabel(context.protocol)} ${what}失败（HTTP ${response.status}）：${detail}`, response.status);
}

// ── 尺寸 ──────────────────────────────────────────────────────────────

/**
 * 把尺寸写成 `宽x高`。
 *
 * 三种写法都认：`1024x1024` / `1024×1024` / `1K`(→1024) `2K`(→2048) `4K`(→4096)。
 * 认不出来返回 undefined —— 各协议据此决定「不传尺寸、用服务端默认」，
 * 而不是硬塞一个可能让请求 400 的值。
 */
export function parseSizeSpec(size: string): { width: number; height: number } | undefined {
  const text = size.trim().toLowerCase().replace("×", "x");
  const explicit = /^(\d{2,5})\s*x\s*(\d{2,5})$/.exec(text);
  if (explicit !== null) {
    const width = Number.parseInt(explicit[1], 10);
    const height = Number.parseInt(explicit[2], 10);
    if (width > 0 && height > 0) return { width, height };
  }
  const bucket = /^(\d)\s*k$/.exec(text);
  if (bucket !== null) {
    const side = Number.parseInt(bucket[1], 10) * 1024;
    return { width: side, height: side };
  }
  return undefined;
}

/** 把 data URI / http URL 统一取成字节。 */
async function readBytes(source: string, context: SignalContext): Promise<Buffer> {
  const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(source);
  if (match !== null) return Buffer.from(match[2], "base64");
  if (/^https?:/i.test(source)) {
    const response = await fetchOrThrow(source, { method: "GET" }, context);
    await ensureOk(response, context, "下载参考图");
    return Buffer.from(await response.arrayBuffer());
  }
  throw new CustomImageError("参考图既不是 data URI 也不是 http(s) 地址，无法发送给自定义后端");
}

function mimeOfBytes(bytes: Buffer, fallback: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return fallback;
}

/** data URI / URL → Blob（multipart 上传要用）。 */
async function toBlob(source: string, context: SignalContext, name: string): Promise<{ blob: Blob; filename: string }> {
  const bytes = await readBytes(source, context);
  const mime = mimeOfBytes(bytes, "image/png");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const filename = /\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.${ext}`;
  return { blob: new Blob([new Uint8Array(bytes)], { type: mime }), filename };
}

/** data URI / URL → 纯 base64（A1111 的 `init_images` 要这个形态）。 */
async function toBase64(source: string, context: SignalContext): Promise<string> {
  const bytes = await readBytes(source, context);
  return bytes.toString("base64");
}

/** 结果字节里的 base64 可能带 data URI 前缀，剥掉再解码。 */
function decodeBase64Image(value: string): Buffer {
  return Buffer.from(value.replace(/^data:[^;]+;base64,/, ""), "base64");
}

// ── OpenAI 协议 ────────────────────────────────────────────────────────

interface OpenAiItem {
  b64_json?: string;
  url?: string;
}

async function readOpenAiPayload(payload: any, context: SignalContext): Promise<CustomImageResult> {
  const item = (payload?.data?.[0] ?? undefined) as OpenAiItem | undefined;
  if (item === undefined) {
    throw new CustomImageError(`OpenAI 兼容接口的返回里没有图片：${JSON.stringify(payload).slice(0, 400)}`);
  }
  if (typeof item.b64_json === "string" && item.b64_json !== "") {
    const bytes = decodeBase64Image(item.b64_json);
    return { bytes, ext: sniffExt(bytes), usage: payload?.usage };
  }
  if (typeof item.url === "string" && item.url !== "") {
    const download = await fetchOrThrow(item.url, { method: "GET" }, context);
    await ensureOk(download, context, "下载生成结果");
    const bytes = Buffer.from(await download.arrayBuffer());
    return { bytes, ext: sniffExt(bytes), remoteUrl: item.url, usage: payload?.usage };
  }
  throw new CustomImageError(`OpenAI 兼容接口返回里既没有 url 也没有 b64_json：${JSON.stringify(item).slice(0, 400)}`);
}

async function generateOpenAi(request: CustomImageRequest, context: SignalContext): Promise<CustomImageResult> {
  const auth = authHeaders(request.apiKey);
  const size = parseSizeSpec(request.size);
  const base = request.baseUrl;

  /**
   * 带参考图时先走官方的 `images/edits`。
   *
   * ⚠️ 这条**只在端点真的不存在时**退回：404 / 405 说明对方是「纯 generations」的
   * 兼容实现（很多自建网关就是这样），退回时把参考图塞进 generations 的 `image`
   * 字段（火山方舟 / DashScope 那一系的写法）。用 400 当信号是不行的 ——
   * 400 往往意味着模型不接受参考图，静默退回只会把一个真实错误变成一次「没带参考图
   * 的生成」，用户拿到的是丢弃了设定的图。
   */
  if (request.images.length > 0) {
    const form = new FormData();
    form.set("model", request.model);
    form.set("prompt", request.prompt);
    form.set("n", "1");
    if (size !== undefined) form.set("size", `${size.width}x${size.height}`);
    for (const [index, image] of request.images.entries()) {
      const { blob, filename } = await toBlob(image, context, `reference-${index + 1}.png`);
      form.append(index === 0 ? "image" : "image[]", blob, filename);
    }
    const edits = await fetchOrThrow(joinUrl(base, "/images/edits"), { method: "POST", headers: auth, body: form }, context);
    if (edits.status !== 404 && edits.status !== 405) {
      await ensureOk(edits, context, "图生图（images/edits）");
      const payload = (await edits.json().catch(() => undefined)) as any;
      return readOpenAiPayload(payload, context);
    }
  }

  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt, n: 1 };
  if (size !== undefined) body.size = `${size.width}x${size.height}`;
  // 不主动写 response_format：`gpt-image-1` 固定回 b64_json，写了反而可能被拒；
  // 下面两种返回形态都处理了。
  if (request.images.length === 1) body.image = request.images[0];
  else if (request.images.length > 1) body.image = request.images;

  const response = await fetchOrThrow(
    joinUrl(base, "/images/generations"),
    { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    context
  );
  await ensureOk(response, context, "生图");
  const payload = (await response.json().catch(() => undefined)) as any;
  return readOpenAiPayload(payload, context);
}

// ── Stable Diffusion WebUI（A1111）协议 ────────────────────────────────

async function generateSdWebui(request: CustomImageRequest, context: SignalContext): Promise<CustomImageResult> {
  const size = parseSizeSpec(request.size) ?? { width: 512, height: 512 };
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt,
    width: size.width,
    height: size.height,
    steps: request.steps,
    cfg_scale: request.cfgScale,
    sampler_name: request.sampler,
    // A1111 的约定：-1 = 每次随机。
    seed: request.seed < 0 ? -1 : request.seed,
    batch_size: 1,
    n_iter: 1,
    save_images: false
  };

  let path = "/sdapi/v1/txt2img";
  if (request.images.length > 0) {
    path = "/sdapi/v1/img2img";
    body.init_images = await Promise.all(request.images.map((image) => toBase64(image, context)));
    body.denoising_strength = request.denoising;
  }

  const response = await fetchOrThrow(
    joinUrl(request.baseUrl, path),
    {
      method: "POST",
      headers: { ...authHeaders(request.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    context
  );
  if (!response.ok) {
    const detail = await errorMessageOf(response);
    // 最常见的两个坑：没加 --api、或者 /sdapi 被禁用（`--nowebui` / 只开了 webui 端口）。
    const hint =
      response.status === 404
        ? "（确认 WebUI 是用 `--api` 启动的，且地址是 API 端口）"
        : "";
    throw new CustomImageError(
      `${protocolLabel("sdwebui")} 生图失败（HTTP ${response.status}）：${detail}${hint}`,
      response.status
    );
  }

  const payload = (await response.json().catch(() => undefined)) as any;
  const first = payload?.images?.[0];
  if (typeof first !== "string" || first === "") {
    throw new CustomImageError(`WebUI 返回里没有图片：${JSON.stringify(payload).slice(0, 400)}`);
  }
  const bytes = decodeBase64Image(first);
  // `info` 是一串 JSON 文本，里面是本次实际用的参数（种子、模型），排错时非常有用。
  let usage: unknown;
  if (typeof payload?.info === "string") {
    try {
      usage = JSON.parse(payload.info);
    } catch {
      usage = payload.info.slice(0, 400);
    }
  }
  return { bytes, ext: sniffExt(bytes), usage };
}

// ── ComfyUI 协议 ───────────────────────────────────────────────────────

/** 占位符 → 值。数值类会**按数字写进 JSON**（写成字符串 ComfyUI 的 int 输入会报错）。 */
function workflowValues(request: CustomImageRequest, seed: number, imageNames: string[]): Record<string, string | number> {
  const size = parseSizeSpec(request.size) ?? { width: 1024, height: 1024 };
  const values: Record<string, string | number> = {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt,
    width: size.width,
    height: size.height,
    seed,
    steps: request.steps,
    cfg: request.cfgScale,
    sampler: request.sampler,
    denoising: request.denoising,
    model: request.model,
    batch: 1
  };
  if (imageNames.length > 0) values.image = imageNames[0];
  imageNames.forEach((name, index) => {
    values[`image${index + 1}`] = name;
  });
  return values;
}

/**
 * 按 **JSON 树**替换占位符，而不是在 JSON 文本上做字符串替换。
 *
 * 文本替换的坑很实在：提示词里带一个引号就能把整份工作流变成非法 JSON，
 * 而 `"{{width}}"` 这种写在引号里的占位符会变成字符串 —— ComfyUI 的
 * `EmptyLatentImage.width` 是 int，收到 `"1024"` 直接报 type 错误。
 * 走树替换时：整个字符串恰好等于一个占位符 → 取原始类型（数字就是数字）；
 * 嵌在字符串中间 → 取文本形态。
 */
function substituteWorkflow(node: unknown, values: Record<string, string | number>, used: Set<string>): unknown {
  if (typeof node === "string") {
    const exact = /^\{\{(\w+)\}\}$/.exec(node);
    if (exact !== null && Object.prototype.hasOwnProperty.call(values, exact[1])) {
      used.add(exact[1]);
      return values[exact[1]];
    }
    return node.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) return whole;
      used.add(key);
      return String(values[key]);
    });
  }
  if (Array.isArray(node)) return node.map((item) => substituteWorkflow(item, values, used));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = substituteWorkflow(value, values, used);
    }
    return out;
  }
  return node;
}

/**
 * 没写 `{{image}}` 时的兜底：直接把第一个 `LoadImage` 节点的文件名换掉。
 *
 * 用户从 ComfyUI 界面「导出（API）」拿到的默认工作流里，加载图片的节点就叫
 * `LoadImage`、输入名就叫 `image` —— 这是 ComfyUI 自己的约定，不会变。
 */
function patchLoadImage(node: unknown, name: string): boolean {
  if (Array.isArray(node)) return node.some((item) => patchLoadImage(item, name));
  if (node === null || typeof node !== "object") return false;
  const record = node as Record<string, any>;
  let touched = false;
  if (record.class_type === "LoadImage" && record.inputs !== null && typeof record.inputs === "object") {
    record.inputs.image = name;
    touched = true;
  }
  for (const value of Object.values(record)) {
    if (patchLoadImage(value, name)) touched = true;
  }
  return touched;
}

/**
 * 没写 `{{width}}` / `{{height}}` 时的兜底：直接改空 latent 节点的宽高。
 *
 * 这是「改了尺寸也不生效」的常见原因：用户从 ComfyUI 导出的 API 工作流里，
 * `EmptyLatentImage` 的宽高是写死的数字，而插件只替换占位符、不碰写死的值。
 * 只改**本身是数字**的输入（连线的输入是数组，跳过），并且只认 `Empty*`
 * 这一类节点，避免把放大节点 / 参考图尺寸一起改掉。
 */
function patchLatentSize(node: unknown, width: number, height: number): boolean {
  if (Array.isArray(node)) return node.some((item) => patchLatentSize(item, width, height));
  if (node === null || typeof node !== "object") return false;
  const record = node as Record<string, any>;
  let touched = false;
  const classType = typeof record.class_type === "string" ? record.class_type : "";
  const inputs = record.inputs;
  if (/empty/i.test(classType) && inputs !== null && typeof inputs === "object") {
    if (typeof inputs.width === "number" || (typeof inputs.width === "string" && /^\d+$/.test(inputs.width))) {
      inputs.width = width;
      touched = true;
    }
    if (typeof inputs.height === "number" || (typeof inputs.height === "string" && /^\d+$/.test(inputs.height))) {
      inputs.height = height;
      touched = true;
    }
  }
  for (const value of Object.values(record)) {
    if (patchLatentSize(value, width, height)) touched = true;
  }
  return touched;
}

function comfyOutputImages(outputs: unknown): Array<{ filename: string; subfolder: string; type: string }> {
  const found: Array<{ filename: string; subfolder: string; type: string }> = [];
  if (outputs === null || typeof outputs !== "object") return found;
  for (const node of Object.values(outputs as Record<string, any>)) {
    const images = node?.images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (typeof image?.filename === "string") {
        found.push({
          filename: image.filename,
          subfolder: typeof image.subfolder === "string" ? image.subfolder : "",
          type: typeof image.type === "string" ? image.type : "output"
        });
      }
    }
  }
  return found;
}

/** 从 `/history` 的 status 里捞执行错误（节点名 + 异常），这是排错的唯一线索。 */
function comfyStatusError(status: any): string | undefined {
  if (status === null || typeof status !== "object") return undefined;
  const messages = status.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (Array.isArray(message) && message[0] === "execution_error" && typeof message[1]?.exception_message === "string") {
        const node = message[1]?.node_type ?? message[1]?.node_id ?? "未知节点";
        return `${node}：${message[1].exception_message}`;
      }
    }
  }
  if (typeof status.status_str === "string" && status.status_str === "error") return "执行失败（工作流里某个节点报错）";
  return undefined;
}

async function generateComfyUi(request: CustomImageRequest, context: SignalContext): Promise<CustomImageResult> {
  if (request.workflow.trim() === "") {
    throw new CustomImageError("ComfyUI 需要一个 API 格式的工作流 JSON：在 ComfyUI 里点「导出（API）」，把那份 JSON 整段粘进设置页");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.workflow);
  } catch (error) {
    throw new CustomImageError(`工作流 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CustomImageError("工作流 JSON 必须是一个对象（API 格式），不是数组或裸值");
  }

  const auth = authHeaders(request.apiKey);
  const base = request.baseUrl;
  const seed = request.seed < 0 ? Math.floor(Math.random() * 2147483647) : request.seed;

  // 参考图先传上去，拿到文件名再替换进工作流。
  const imageNames: string[] = [];
  for (const [index, image] of request.images.entries()) {
    const { blob, filename } = await toBlob(image, context, `gmm-ref-${Date.now()}-${index + 1}.png`);
    const form = new FormData();
    form.set("image", blob, filename);
    form.set("overwrite", "true");
    const uploaded = await fetchOrThrow(joinUrl(base, "/upload/image"), { method: "POST", headers: auth, body: form }, context);
    await ensureOk(uploaded, context, "上传参考图");
    const info = (await uploaded.json().catch(() => undefined)) as any;
    const name = typeof info?.name === "string" && info.name !== "" ? info.name : filename;
    const subfolder = typeof info?.subfolder === "string" ? info.subfolder : "";
    imageNames.push(subfolder === "" ? name : `${subfolder}/${name}`);
  }

  const used = new Set<string>();
  const workflow = substituteWorkflow(parsed, workflowValues(request, seed, imageNames), used) as Record<string, unknown>;
  if (imageNames.length > 0 && !used.has("image")) {
    patchLoadImage(workflow, imageNames[0]);
  }
  /**
   * 工作流里没写 width / height 占位符时，把尺寸写进空 latent 节点 —— 否则
   * 用户在设置里改输出尺寸，ComfyUI 仍然按工作流里写死的值出图（典型表现：
   * 「改了也不行，永远 1254×1254」）。
   */
  if (!used.has("width") || !used.has("height")) {
    const size = parseSizeSpec(request.size);
    if (size !== undefined) patchLatentSize(workflow, size.width, size.height);
  }

  const clientId = `gmm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const queued = await fetchOrThrow(
    joinUrl(base, "/prompt"),
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    },
    context
  );
  if (!queued.ok) {
    const detail = await errorMessageOf(queued);
    throw new CustomImageError(
      `${protocolLabel("comfyui")} 提交工作流失败（HTTP ${queued.status}）：${detail}` +
        (queued.status === 400 ? "（多半是工作流里有节点参数不合法，先在 ComfyUI 里跑通再导出 API 格式）" : ""),
      queued.status
    );
  }
  const queuedPayload = (await queued.json().catch(() => undefined)) as any;
  const promptId = queuedPayload?.prompt_id;
  if (typeof promptId !== "string" || promptId === "") {
    throw new CustomImageError(`ComfyUI 没有返回 prompt_id：${JSON.stringify(queuedPayload).slice(0, 400)}`);
  }
  const nodeErrors = queuedPayload?.node_errors;
  if (nodeErrors !== null && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0) {
    throw new CustomImageError(`工作流校验不通过：${JSON.stringify(nodeErrors).slice(0, 600)}`);
  }

  // 轮询历史。本地跑一张图几十秒起步，所以间隔取 1 秒、整体受 timeout 控制。
  let entry: any;
  for (;;) {
    if (context.composed.aborted) throw networkError(context, new Error("aborted"));
    await sleep(1000, context);
    const history = await fetchOrThrow(joinUrl(base, `/history/${encodeURIComponent(promptId)}`), { method: "GET", headers: auth }, context);
    await ensureOk(history, context, "查询任务状态");
    const payload = (await history.json().catch(() => undefined)) as any;
    const candidate = payload?.[promptId];
    if (candidate !== undefined) {
      // 有的实现是「先出现条目、再补 outputs」，所以还要等到有产出或明确报错。
      const failure = comfyStatusError(candidate?.status);
      if (failure !== undefined) throw new CustomImageError(`ComfyUI 执行失败：${failure}`);
      const images = comfyOutputImages(candidate?.outputs);
      if (images.length > 0) {
        entry = { ...candidate, __images: images };
        break;
      }
      const completed = candidate?.status?.completed === true || candidate?.status?.status_str === "success";
      if (completed) throw new CustomImageError("ComfyUI 执行完成，但没有任何图片输出（工作流最后接的不是 SaveImage / PreviewImage？）");
    }
  }

  const first = entry.__images[0] as { filename: string; subfolder: string; type: string };
  const query = new URLSearchParams({ filename: first.filename, subfolder: first.subfolder, type: first.type });
  const view = await fetchOrThrow(joinUrl(base, `/view?${query.toString()}`), { method: "GET", headers: auth }, context);
  await ensureOk(view, context, "下载生成结果");
  const bytes = Buffer.from(await view.arrayBuffer());
  return { bytes, ext: sniffExt(bytes), remoteUrl: joinUrl(base, `/view?${query.toString()}`), usage: { seed, promptId, filename: first.filename } };
}

function sleep(ms: number, context: SignalContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      context.composed.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(networkError(context, new Error("aborted")));
    }
    if (context.composed.aborted) {
      onAbort();
      return;
    }
    context.composed.addEventListener("abort", onAbort, { once: true });
  });
}

// ── 入口 ───────────────────────────────────────────────────────────────

/** 调一次自定义后端。`images` 为空时是文生图，非空时按各协议的做法带上参考图。 */
export async function generateCustomImage(request: CustomImageRequest, signal?: AbortSignal): Promise<CustomImageResult> {
  if (request.baseUrl.trim() === "") {
    throw new CustomImageError("尚未配置自定义生图服务的地址（设置 → 游戏素材大师 → 自定义生图模型）");
  }
  if (request.prompt.trim() === "" && request.protocol !== "comfyui") {
    throw new CustomImageError("提示词为空");
  }
  const context = makeSignalContext(request.protocol, request.timeoutMs, signal);
  if (request.protocol === "openai") return generateOpenAi(request, context);
  if (request.protocol === "sdwebui") return generateSdWebui(request, context);
  return generateComfyUi(request, context);
}
