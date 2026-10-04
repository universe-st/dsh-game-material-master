/** 用最小请求探测每个模型可用性 + 支持的参数。 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(join(process.env.DSH_HOME || join(homedir(), ".dsh"), "game-material-master", "config.json"), "utf8"));
const models = process.argv.slice(2);
const results = [];
for (const model of models) {
  const body = { model, prompt: "一个红色圆点", size: "1K", response_format: "url", watermark: false };
  if (/seedream-5-0|seededit-3-0/i.test(model)) body.output_format = "png";
  try {
    const res = await fetch(`${cfg.arkBaseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.arkApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const t = await res.text();
    if (res.ok) {
      const p = JSON.parse(t);
      const item = p.data?.[0] || {};
      let size = "";
      if (item.url) {
        const head = await fetch(item.url, { headers: { Range: "bytes=0-33" } });
        const buf = Buffer.from(await head.arrayBuffer());
        if (buf[0] === 0x89) size = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
      }
      results.push({ model, ok: true, size, usage: p.usage });
      console.log(`OK   ${model.padEnd(32)} ${size}  ${JSON.stringify(p.usage || {})}`);
    } else {
      let msg = t.slice(0, 200);
      try { msg = JSON.parse(t).error?.message?.slice(0, 150) ?? msg; } catch {}
      console.log(`FAIL ${model.padEnd(32)} HTTP ${res.status} ${msg}`);
      results.push({ model, ok: false, status: res.status, msg });
    }
  } catch (e) {
    console.log(`ERR  ${model.padEnd(32)} ${String(e.message).slice(0, 150)}`);
    results.push({ model, ok: false, msg: String(e.message) });
  }
}
