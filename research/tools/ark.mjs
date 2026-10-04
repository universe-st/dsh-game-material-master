/**
 * 研究用：直接调火山方舟 images/generations，把结果落盘。
 * Key 从 DSH 插件配置里读（$DSH_HOME/game-material-master/config.json），不写在代码里。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const CONFIG_PATH = join(DSH_HOME, "game-material-master", "config.json");

export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function sniffExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF") return "webp";
  return "bin";
}

/**
 * @param {{prompt:string, images?:string[], size?:string, model?:string, out:string, watermark?:boolean, extra?:object}} opts
 */
export async function generate(opts) {
  const cfg = loadConfig();
  const baseUrl = cfg.arkBaseUrl;
  const model = opts.model || cfg.arkModel;
  const body = {
    model,
    prompt: opts.prompt,
    size: opts.size || cfg.arkSize || "2K",
    response_format: "url",
    watermark: opts.watermark === true,
  };
  if (opts.images && opts.images.length === 1) body.image = opts.images[0];
  else if (opts.images && opts.images.length > 1) body.image = opts.images;
  if (/seedream-5-0/i.test(model)) body.output_format = "png";
  if (opts.aspect) body.aspect_ratio = opts.aspect; // 5.0 系列
  if (opts.background !== undefined) body.background = opts.background; // 5.0 系列: "transparent"
  if (opts.mask) body.mask = opts.mask; // 局部重绘
  if (opts.sequential) body.sequential_image_generation = opts.sequential;
  if (opts.maxImages) body.sequential_image_generation_options = { max_images: opts.maxImages };
  if (opts.extra) Object.assign(body, opts.extra);

  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.arkApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ark HTTP ${res.status}: ${text.slice(0, 600)}`);
  const payload = JSON.parse(text);
  const item = payload?.data?.[0];
  if (!item) throw new Error(`no image: ${text.slice(0, 400)}`);

  let bytes;
  if (item.b64_json) bytes = Buffer.from(item.b64_json, "base64");
  else {
    const dl = await fetch(item.url, { signal: AbortSignal.timeout(300000) });
    bytes = Buffer.from(await dl.arrayBuffer());
  }
  const ext = sniffExt(bytes);
  const target = opts.out.endsWith("." + ext) ? opts.out : `${opts.out}.${ext}`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  // 记下实际使用的 size（usage 里可能有）
  let dims = "";
  try {
    dims = `${readPngSize(bytes)?.w}x${readPngSize(bytes)?.h}`;
  } catch {}
  return {
    path: target,
    bytes: bytes.length,
    ext,
    ms: Date.now() - t0,
    dims,
    usage: payload?.usage,
    model,
    size: body.size,
  };
}

export function readPngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function toDataUri(path, mime = "image/png") {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}
