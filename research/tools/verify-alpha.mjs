/** 验证透明输出：同一张图，各模型 background 处理有何差异。 */
import { writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(process.env.DSH_HOME || join(homedir(), ".dsh"), "game-material-master", "config.json"), "utf8"));
const tpl = `data:image/png;base64,${readFileSync(resolve(here, "..", "probe", "tpl", "t1-2048.png")).toString("base64")}`;
const outDir = resolve(here, "..", "probe", "b7");

const cases = [
  { id: "V1-lite-bg", model: "doubao-seedream-5-0-260128", background: "transparent" },
  { id: "V2-flash-bg", model: "doubao-seedream-5-0-flash-260915", background: "transparent" },
  { id: "V3-pro-bg", model: "doubao-seedream-5-0-pro-260628", background: "transparent" },
  { id: "V4-lite-nobg", model: "doubao-seedream-5-0-260128" },
  { id: "V5-40", model: "doubao-seedream-4-0-250828" },
];

for (const c of cases) {
  const body = {
    model: c.model,
    prompt: "把参考图里洋红色菱形内部填成鲜绿色短草地，菱形外完全透明。像素画风。",
    size: "2K",
    response_format: "url",
    watermark: false,
    image: tpl,
  };
  if (c.model.includes("5-0")) body.output_format = "png";
  if (c.background) body.background = c.background;
  try {
    const res = await fetch(`${cfg.arkBaseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.arkApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(200000),
    });
    const t = await res.text();
    if (!res.ok) {
      console.log(`FAIL ${c.id}: HTTP ${res.status} ${t.slice(0, 200)}`);
      continue;
    }
    const p = JSON.parse(t);
    const item = p.data?.[0] ?? {};
    let buf;
    if (item.b64_json) buf = Buffer.from(item.b64_json, "base64");
    else buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
    const sig = buf.toString("ascii", 1, 4);
    writeFileSync(resolve(outDir, `${c.id}.${sig === "PNG" ? "png" : "jpg"}`), buf);
    console.log(`OK   ${c.id.padEnd(14)} ${sig} ${(buf.length / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.log(`ERR  ${c.id}: ${String(e.message).slice(0, 200)}`);
  }
}
