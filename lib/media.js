/**
 * ffmpeg / ffprobe 媒体层。
 *
 * 这里刻意只做「解码成 rawvideo rgba」和「探测时长」两类事：
 * 抠绿与合成都发生在 JS 里（见 chroma.ts），因此不需要任何图像库，
 * 也不需要中间 PNG 往返。
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
export class MediaError extends Error {
    constructor(message) {
        super(message);
        this.name = "MediaError";
    }
}
const resolvedBins = new Map();
const MISS_TTL_MS = 10000;
/** 展开 Windows 环境变量写法（%LOCALAPPDATA% 这种）。 */
function expandWindowsEnv(value) {
    return value.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
}
/**
 * 读 Windows 注册表里的环境变量。
 *
 * `setx` 只写注册表，**不会**改已经跑起来的进程的环境——进程的环境块是启动时从父进程复制的
 * 快照，而父进程往往是登录时就起的 explorer。于是「设了 FFMPEG_PATH、也重启了程序，还是找不到
 * ffmpeg」在 Windows 上很常见。直接读注册表就能拿到用户写进去的值，不必让人再去重启资源管理器。
 */
function windowsRegistryValue(name) {
    const keys = [
        "HKCU\\Environment",
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"
    ];
    for (const key of keys) {
        try {
            const output = execFileSync("reg.exe", ["query", key, "/v", name], {
                encoding: "utf8",
                timeout: 5000,
                windowsHide: true,
                stdio: ["ignore", "pipe", "ignore"]
            });
            const matched = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(output);
            const value = matched?.[1]?.trim();
            if (value !== undefined && value !== "")
                return expandWindowsEnv(value);
        }
        catch {
            // 键不存在 / reg 不可用：当作没有这一项
        }
    }
    return undefined;
}
/** Windows 上 ffmpeg 的常见落点（装了却没进 PATH 的典型情况）。 */
function windowsBinCandidates(name) {
    const exe = name + ".exe";
    const local = process.env.LOCALAPPDATA ?? "";
    const profile = process.env.USERPROFILE ?? "";
    const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES ?? "";
    const programData = process.env.ProgramData ?? "C:\\ProgramData";
    const list = [];
    if (local !== "")
        list.push(join(local, "Microsoft", "WinGet", "Links", exe));
    if (profile !== "")
        list.push(join(profile, "scoop", "shims", exe));
    if (programData !== "")
        list.push(join(programData, "chocolatey", "bin", exe));
    if (programFiles !== "")
        list.push(join(programFiles, "ffmpeg", "bin", exe));
    list.push("C:\\ffmpeg\\bin\\" + exe);
    list.push("D:\\ffmpeg\\bin\\" + exe);
    return list;
}
/**
 * 找 ffmpeg / ffprobe 的可执行文件。
 *
 * 顺序：`FFMPEG_PATH` 环境变量 → Windows 注册表里的同名变量 → Windows 常见安装位置 →
 * 裸名字（交给 PATH）。只有**确实存在**的绝对路径才会被采用；都没命中就回退裸名字，
 * 让 spawn 按 PATH 去找，出错时再提示怎么设路径。
 */
function resolveBin(name) {
    const now = Date.now();
    const cached = resolvedBins.get(name);
    if (cached !== undefined && (cached.hit || now - cached.at < MISS_TTL_MS))
        return cached.value;
    const envKey = name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
    const candidates = [];
    const fromEnv = process.env[envKey]?.trim() ?? "";
    if (fromEnv !== "")
        candidates.push(fromEnv);
    if (process.platform === "win32") {
        const fromRegistry = windowsRegistryValue(envKey)?.trim() ?? "";
        if (fromRegistry !== "")
            candidates.push(fromRegistry);
        candidates.push(...windowsBinCandidates(name));
    }
    const found = candidates.find((candidate) => isAbsolute(candidate) && existsSync(candidate));
    const value = found ?? name;
    resolvedBins.set(name, { value, hit: found !== undefined, at: now });
    return value;
}
/** 找不到 ffmpeg 时给用户的提示（Windows 与其它平台分开写，各自给可执行的下一步）。 */
function missingBinMessage(bin) {
    const suffix = process.platform === "win32"
        ? "插件也会主动去读注册表里的同名变量，以及 WinGet / Scoop / Chocolatey 的常见安装位置。"
        : "（macOS: brew install ffmpeg）";
    return "找不到 " + bin + "。请先安装 ffmpeg，或用 FFMPEG_PATH / FFPROBE_PATH 环境变量指定绝对路径。" + suffix;
}
export function ffmpegPath() {
    return resolveBin("ffmpeg");
}
export function ffprobePath() {
    return resolveBin("ffprobe");
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
                reject(new MediaError(missingBinMessage(bin)));
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
/** 通用 ffmpeg 调用（参数数组，绝不拼 shell）。音频剪辑复用同一套超时/报错。 */
export async function runFfmpeg(args, timeoutMs = 300000) {
    return run(ffmpegPath(), args, timeoutMs);
}
/** 通用 ffprobe 调用。 */
export async function runFfprobe(args, timeoutMs = 60000) {
    return run(ffprobePath(), args, timeoutMs);
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
export async function toJpegDataUri(source, jpegOut, maxEdge = 1280, quality = 3, matte) {
    // MP4 has no alpha. Explicitly matte transparent PNGs before sending to a video backend;
    // otherwise invisible source RGB can become a black halo or unpredictable background.
    const matteRgb = /^#[0-9A-Fa-f]{6}$/u.test(String(matte ?? ""))
        ? [Number.parseInt(String(matte).slice(1, 3), 16), Number.parseInt(String(matte).slice(3, 5), 16), Number.parseInt(String(matte).slice(5, 7), 16)]
        : undefined;
    const filter = matteRgb !== undefined
        ? `format=rgba,split[fg][canvas];[canvas]lutrgb=r=${matteRgb[0]}:g=${matteRgb[1]}:b=${matteRgb[2]},colorchannelmixer=aa=1[bg];[bg][fg]overlay=shortest=1:format=auto,scale='min(${maxEdge},iw)':-2:flags=lanczos`
        : matte === "white"
            ? `format=rgba,split[fg][canvas];[canvas]lutrgb=r=255:g=255:b=255,colorchannelmixer=aa=1[bg];[bg][fg]overlay=shortest=1:format=auto,scale='min(${maxEdge},iw)':-2:flags=lanczos`
            : `scale='min(${maxEdge},iw)':-2:flags=lanczos`;
    await run(ffmpegPath(), [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", source,
        "-vf", filter,
        "-frames:v", "1",
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
/**
 * 按**文件头**认一段本地视频的容器（用户自选的本地视频走这条路）。
 *
 * 为什么不看扩展名：从手机 / 剪辑软件 / 聊天工具里拿到的文件经常被改名或根本
 * 没有正确的后缀（`.mp4` 其实是 MOV、`.bin` 其实是 MP4）。这里只在本机交给
 * ffmpeg 解码，容器认错了不会当场报错，而是**抽帧时**才失败——那时用户已经
 * 以为「导入成功了」。
 *
 * 认三种，覆盖游戏素材的常见来源：
 *   - ISO BMFF（MP4 / MOV / M4V）：第 4~8 字节是 `ftyp`，再按 brand 区分 MOV 与 MP4；
 *   - Matroska / WebM：EBML 头 `1A 45 DF A3`（两者同族，统一按 webm 存）；
 *   - AVI：`RIFF` + 第 8~12 字节 `AVI `。
 *
 * 返回的 `ext` 直接当落盘后缀，所以它必须是 ffmpeg 认得的容器名。
 */
export function sniffVideo(base64) {
    // 48 字节足够覆盖三种文件头里的判别字段。
    const head = Buffer.from(base64.slice(0, 64), "base64");
    if (head.length >= 12 && head.toString("ascii", 4, 8) === "ftyp") {
        const brand = head.toString("ascii", 8, 12).trim().toLowerCase();
        if (brand === "qt")
            return { ext: "mov", mime: "video/quicktime", label: "MOV" };
        if (brand === "m4v" || brand === "m4vh")
            return { ext: "m4v", mime: "video/x-m4v", label: "M4V" };
        return { ext: "mp4", mime: "video/mp4", label: "MP4" };
    }
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
        return { ext: "webm", mime: "video/webm", label: "WebM / MKV" };
    }
    if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "AVI ") {
        return { ext: "avi", mime: "video/x-msvideo", label: "AVI" };
    }
    return undefined;
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
