/**
 * ffmpeg / ffprobe 媒体层。
 *
 * 这里刻意只做「解码成 rawvideo rgba」和「探测时长」两类事：
 * 抠绿与合成都发生在 JS 里（见 chroma.ts），因此不需要任何图像库，
 * 也不需要中间 PNG 往返。
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
export class MediaError extends Error {
    constructor(message) {
        super(message);
        this.name = "MediaError";
    }
}
export function ffmpegPath() {
    return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}
export function ffprobePath() {
    return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}
/** 跑一次 ffmpeg/ffprobe，stdout 收成 Buffer，stderr 收成字符串。 */
function run(bin, args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        }
        catch (error) {
            reject(new MediaError(`无法启动 ${bin}：${error instanceof Error ? error.message : String(error)}`));
            return;
        }
        const out = [];
        let err = "";
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            child.kill("SIGKILL");
            reject(new MediaError(`${bin} 执行超时（${Math.round(timeoutMs / 1000)} 秒）`));
        }, timeoutMs);
        child.stdout.on("data", (chunk) => out.push(chunk));
        child.stderr.on("data", (chunk) => {
            err += chunk.toString("utf8");
            if (err.length > 20000)
                err = err.slice(-20000);
        });
        child.on("error", (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error.code === "ENOENT") {
                reject(new MediaError(`找不到 ${bin}。请先安装 ffmpeg（macOS: brew install ffmpeg），或用 FFMPEG_PATH / FFPROBE_PATH 环境变量指定绝对路径。`));
                return;
            }
            reject(new MediaError(`${bin} 启动失败：${error.message}`));
        });
        child.on("close", (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                reject(new MediaError(`${bin} 退出码 ${code}：${err.trim().split("\n").slice(-6).join(" | ") || "无输出"}`));
                return;
            }
            resolve({ stdout: Buffer.concat(out), stderr: err });
        });
    });
}
/** 探测媒体时长（秒）。 */
export async function probeDuration(file) {
    const { stdout } = await run(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], 60000);
    const seconds = Number.parseFloat(stdout.toString("utf8").trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new MediaError(`无法读取视频时长：${file}`);
    }
    return seconds;
}
/** 读取图片/视频的像素尺寸（取第一条视频流）。 */
export async function probeSize(file) {
    const { stdout } = await run(ffprobePath(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], 60000);
    const [w, h] = stdout.toString("utf8").trim().split("x").map((v) => Number.parseInt(v, 10));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        throw new MediaError(`无法读取尺寸：${file}`);
    }
    return { width: w, height: h };
}
function buildVideoFilter(options, duration, width, height) {
    const chain = [];
    const inset = Math.max(0, Math.min(0.2, options.cropInset));
    if (inset > 0) {
        chain.push(`crop=iw*${(1 - 2 * inset).toFixed(4)}:ih*${(1 - 2 * inset).toFixed(4)}`);
    }
    chain.push(`scale=${width}:${height}:flags=lanczos`);
    // fps 滤镜按「时长 / 帧数」取样，正好实现「按时长平均提取 N 张」。
    chain.push(`fps=${options.frameCount}/${duration.toFixed(6)}`);
    chain.push("format=rgba");
    return chain.join(",");
}
/** 按长边上限与原始比例算出工作尺寸；宽高都取偶数，规避编码器的奇数尺寸问题。 */
export function workingSize(sourceWidth, sourceHeight, longEdge) {
    const longest = Math.max(sourceWidth, sourceHeight);
    const scale = longest > longEdge ? longEdge / longest : 1;
    const even = (value) => Math.max(2, Math.round((value * scale) / 2) * 2);
    return { width: even(sourceWidth), height: even(sourceHeight) };
}
/**
 * 从视频里按时长平均抽取 frameCount 帧，直接输出成 rawvideo RGBA。
 * 结果按顺序返回，每帧 `width * height * 4` 字节。
 */
export async function extractFrames(options) {
    const duration = await probeDuration(options.video);
    const source = await probeSize(options.video);
    const size = workingSize(source.width, source.height, Math.max(64, options.longEdge));
    const { stdout } = await run(ffmpegPath(), [
        "-hide_banner",
        "-loglevel", "error",
        "-i", options.video,
        "-vf", buildVideoFilter(options, duration, size.width, size.height),
        "-frames:v", String(options.frameCount),
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "-"
    ], options.timeoutMs ?? 300000);
    const frameBytes = size.width * size.height * 4;
    const frames = [];
    for (let i = 0; i < options.frameCount; i++) {
        const start = i * frameBytes;
        if (start + frameBytes > stdout.length)
            break;
        frames.push(Buffer.from(stdout.subarray(start, start + frameBytes)));
    }
    if (frames.length === 0) {
        throw new MediaError(`从视频里没有抽到任何帧：${options.video}`);
    }
    return { frames, width: size.width, height: size.height, duration };
}
/**
 * 把一张静态图解码成 RGBA。
 * 抠像只需要像素，不需要 PNG 解码器，所以统一交给 ffmpeg。
 * `maxEdge > 0` 时长边会被限制到该值（等比、取偶数）。
 */
export async function decodeToRgba(file, maxEdge = 0) {
    const source = await probeSize(file);
    const size = maxEdge > 0 ? workingSize(source.width, source.height, maxEdge) : workingSize(source.width, source.height, Math.max(source.width, source.height));
    const { stdout } = await run(ffmpegPath(), [
        "-hide_banner", "-loglevel", "error",
        "-i", file,
        "-vf", `scale=${size.width}:${size.height}:flags=lanczos,format=rgba`,
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "-"
    ], 120000);
    const expected = size.width * size.height * 4;
    if (stdout.length < expected)
        throw new MediaError(`解码后字节数不足：期望 ${expected}，实际 ${stdout.length}`);
    return { rgba: Buffer.from(stdout.subarray(0, expected)), width: size.width, height: size.height };
}
/** 参考视频要转成 data URI 传给 MiniMax，请求体上限 64MB，所以先卡一道大小。 */
export async function fileSize(file) {
    const { stdout } = await run(ffprobePath(), ["-v", "error", "-show_entries", "format=size", "-of", "default=noprint_wrappers=1:nokey=1", file], 30000);
    const n = Number.parseInt(stdout.toString("utf8").trim(), 10);
    return Number.isFinite(n) ? n : 0;
}
/**
 * 把一张图转成 JPEG data URI，给 MiniMax 当首帧图用。
 * 同时落一份 JPEG 到 `jpegOut`，方便排查「模型到底看到了什么」。
 */
export async function toJpegDataUri(source, jpegOut, maxEdge = 1280, quality = 3) {
    await run(ffmpegPath(), [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", source,
        "-vf", `scale='min(${maxEdge},iw)':-2:flags=lanczos`,
        "-q:v", String(quality),
        "-f", "image2",
        jpegOut
    ], 120000);
    const bytes = await readFile(jpegOut);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
/** 用 ffmpeg 生成一张等比缩放的 PNG 预览图（用于大幅整图的缩略预览）。 */
export async function makeThumbnail(source, dest, maxEdge = 768) {
    await run(ffmpegPath(), [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", source,
        "-vf", `scale='min(${maxEdge},iw)':'min(${maxEdge},ih)':force_original_aspect_ratio=decrease:flags=lanczos`,
        "-pix_fmt", "rgba",
        dest
    ], 120000);
}
/** 读取文件并组装成 data URI（Ark 参考图用）。 */
export async function toDataUri(file, mime) {
    const bytes = await readFile(file);
    return `data:${mime};base64,${bytes.toString("base64")}`;
}
/** 按扩展名猜 mime。 */
export function mimeOf(file) {
    const lower = file.toLowerCase();
    if (lower.endsWith(".png"))
        return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
        return "image/jpeg";
    if (lower.endsWith(".webp"))
        return "image/webp";
    if (lower.endsWith(".gif"))
        return "image/gif";
    if (lower.endsWith(".bmp"))
        return "image/bmp";
    if (lower.endsWith(".mp4"))
        return "video/mp4";
    return "application/octet-stream";
}
/** 写文件的小工具（保持原子替换语义）。 */
export async function writeBinary(file, bytes) {
    await writeFile(file, bytes);
}
/** ffmpeg 是否可用；不可用时给出可读原因。 */
export async function checkFfmpeg() {
    try {
        const { stdout } = await run(ffmpegPath(), ["-hide_banner", "-version"], 20000);
        const first = stdout.toString("utf8").split("\n")[0]?.trim() ?? "";
        return { ok: true, version: first };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
