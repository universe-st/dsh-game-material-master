/**
 * 生图后端的分发层。
 *
 * 插件支持两类生图后端（`config.imageProvider`）：
 *
 *   · `ark`（默认）—— 火山方舟 Seedream，走 `ark.generateImage`；
 *   · `custom` —— 用户自己的服务，协议见 `customimage.ts`（OpenAI / ComfyUI / SD WebUI）。
 *
 * 所有生图调用点（八方向图 / 图片生成 / 骨骼动画 / 地图地块）都只经过这里。
 * 这样「换生图后端」只改一处，各模块不必各判一次 provider —— 历史教训是
 * 这种「每处判一次」的分叉迟早会漏一处，而漏掉的那一处**不报错**，
 * 只是偷偷还在用另一家模型。
 */
import { assertToapisReady, generateToapisImage } from "./toapis.js";
import { generateImage } from "./ark.js";
import { CUSTOM_PROTOCOL_DEFAULTS, loadConfig } from "./config.js";
import { CustomImageError, generateCustomImage } from "./customimage.js";
/**
 * 所有后端都使用同一份全局输出尺寸。
 *
 * 历史行为是「Ark 保留任务级尺寸、自定义后端只读全局」，导致同一个设置页里
 * 改尺寸时好时坏；现在统一成全局参数。保留这个函数是为了兼容旧的调用方 / 自检。
 */
export function imageUsesConfiguredSize(_config) { return true; }
/** Only Ark supports a separate redraw model; other backends retain their selected model. */
export function imageRedrawModelOf(config) {
    return config.imageProvider === "ark" ? config.arkRedrawModel.trim() || config.arkModel : imageModelOf(config);
}
export function isCustomProvider(config) {
    return config.imageProvider === "custom";
}
/** 当前生图模型（Ark 是 `arkModel`，自定义是 `customModel`）。 */
export function imageModelOf(config) {
    if (config.imageProvider === "toapis")
        return config.toapisImageModel;
    return isCustomProvider(config) ? config.customModel : config.arkModel;
}
/** 当前输出尺寸。 */
export function imageSizeOf(config) {
    if (config.imageProvider === "toapis")
        return config.toapisImageSize;
    return isCustomProvider(config) ? config.customSize : config.arkSize;
}
/** 当前水印开关。水印是火山方舟特有的参数，自定义后端一律不带。 */
export function imageWatermarkOf(config) {
    if (config.imageProvider === "toapis")
        return false;
    return isCustomProvider(config) ? false : config.arkWatermark;
}
/** 当前请求超时。 */
export function imageTimeoutOf(config) {
    if (config.imageProvider === "toapis")
        return config.toapisTimeoutMs;
    return isCustomProvider(config) ? config.customTimeoutMs : config.arkTimeoutMs;
}
/** 自定义后端自己的必填项检查（不看 `imageProvider`，供「测试连接」按钮用）。 */
export function customImageBlocker(config) {
    if (config.customBaseUrl.trim() === "") {
        return "尚未配置自定义生图服务的地址（设置 → 游戏素材大师 → 生图后端 → 自定义生图模型）";
    }
    if (config.customProtocol === "comfyui" && config.customWorkflow.trim() === "") {
        return "选了 ComfyUI 协议，但还没填工作流 JSON（在 ComfyUI 里「导出（API）」拿到那份 JSON，整段粘贴）";
    }
    if (config.customProtocol === "openai" && config.customModel.trim() === "") {
        return "选了 OpenAI 协议，但还没填模型名";
    }
    return undefined;
}
/**
 * 当前后端「能不能开跑」。返回 undefined = 可以。
 *
 * 错误文案里必须写清**去哪里配**：两种后端的用户不是同一批人，
 * 只说「未配置」会让人在设置页里来回找。
 */
export function imageProviderBlocker(config) {
    if (config.imageProvider === "toapis") {
        try {
            assertToapisReady(config);
            return undefined;
        }
        catch (error) {
            return String(error.message);
        }
    }
    if (!isCustomProvider(config)) {
        if (config.arkApiKey.trim() === "") {
            return "尚未配置火山方舟 API Key（设置 → 游戏素材大师 → 生图后端 → 火山方舟）";
        }
        if (config.arkModel.trim() === "")
            return "尚未配置火山方舟的生图模型 ID";
        return undefined;
    }
    return customImageBlocker(config);
}
export function assertImageProviderReady(config) {
    const blocker = imageProviderBlocker(config);
    if (blocker !== undefined)
        throw new Error(blocker);
}
/** 一句话摘要（界面角标与工具面共用）。 */
export function imageProviderSummary(config) {
    if (config.imageProvider === "toapis")
        return `ToAPIs · ${config.toapisImageModel}`;
    if (!isCustomProvider(config))
        return `火山方舟 · ${config.arkModel}`;
    const label = CUSTOM_PROTOCOL_DEFAULTS[config.customProtocol]?.label ?? config.customProtocol;
    const model = config.customModel.trim() === "" ? "" : ` · ${config.customModel}`;
    return `自定义 · ${label} · ${config.customBaseUrl}${model}`;
}
/** 调一次生图，自动按当前后端分发。 */
export async function generateImageWithProvider(request, signal) {
    const config = await loadConfig();
    assertImageProviderReady(config);
    if (config.imageProvider === "toapis")
        return generateToapisImage(config, request, signal);
    if (isCustomProvider(config)) {
        return generateCustomImage({
            protocol: config.customProtocol,
            baseUrl: config.customBaseUrl,
            apiKey: config.customApiKey,
            model: request.model?.trim() || config.customModel,
            prompt: request.prompt,
            images: request.images,
            size: request.size,
            timeoutMs: request.timeoutMs ?? config.customTimeoutMs,
            negativePrompt: config.customNegativePrompt,
            steps: config.customSteps,
            cfgScale: config.customCfgScale,
            sampler: config.customSampler,
            denoising: config.customDenoising,
            seed: config.customSeed,
            workflow: config.customWorkflow
        }, signal);
    }
    return generateImage({
        baseUrl: config.arkBaseUrl,
        apiKey: config.arkApiKey,
        model: request.model?.trim() || config.arkModel,
        prompt: request.prompt,
        images: request.images,
        size: request.size,
        watermark: request.watermark,
        timeoutMs: request.timeoutMs ?? config.arkTimeoutMs
    }, signal);
}
/**
 * 连通性自检：对**自定义后端**真实生成一张小图。
 *
 * 与 `testArk` 对称：各自测各自那一组配置，所以「当前用哪家」不影响按钮能不能点
 * —— 用户经常是先把两边的地址都填好、各测一次，再决定切哪个。
 * 只有真跑一次才能同时验证「地址对不对」和「服务端真的能出图」，看配置看不出来。
 */
export async function testCustomImage() {
    const config = await loadConfig();
    const blocker = customImageBlocker(config);
    if (blocker !== undefined)
        throw new Error(blocker);
    const result = await generateCustomImage({
        protocol: config.customProtocol,
        baseUrl: config.customBaseUrl,
        apiKey: config.customApiKey,
        model: config.customModel,
        prompt: "一张纯绿色背景的空白测试图，画面中只有一个居中的小圆点",
        images: [],
        size: config.customSize,
        timeoutMs: config.customTimeoutMs,
        negativePrompt: config.customNegativePrompt,
        steps: config.customSteps,
        cfgScale: config.customCfgScale,
        sampler: config.customSampler,
        denoising: config.customDenoising,
        // 测试图固定种子，便于对比两次测试的结果是否一致（排查缓存 / 没真跑的问题）。
        seed: 20261016,
        workflow: config.customWorkflow
    });
    return {
        ok: true,
        provider: `自定义 · ${CUSTOM_PROTOCOL_DEFAULTS[config.customProtocol]?.label ?? config.customProtocol}`,
        model: config.customModel,
        bytes: result.bytes.length,
        ext: result.ext
    };
}
export { CustomImageError };
