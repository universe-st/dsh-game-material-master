/**
 * 探针批量跑：读一个 jobs.json，调 Ark 生图落盘，写 manifest。
 * jobs.json: { "calls": [ { "id", "prompt", "images"?: [path], "size"?, "model"?, "concurrency"? } ] }
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, toDataUri } from "./ark.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jobsPath = resolve(process.argv[2]);
const outDir = resolve(process.argv[3] || join(here, "..", "probe"));
const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
mkdirSync(outDir, { recursive: true });

const concurrency = jobs.concurrency || 2;
const results = [];
const started = Date.now();

async function runOne(call) {
  const images = (call.images || []).map((p) => toDataUri(resolve(p)));
  const t0 = Date.now();
  try {
    const r = await generate({
      prompt: call.prompt,
      images,
      size: call.size,
      model: call.model,
      out: join(outDir, call.id),
      aspect: call.aspect,
      background: call.background,
      extra: call.extra,
    });
    console.log(`OK   ${call.id}  ${r.dims} ${(r.bytes / 1024).toFixed(0)}KB ${r.ms}ms  model=${r.model}`);
    return { id: call.id, ok: true, ...r, prompt: call.prompt, refs: call.images || [] };
  } catch (e) {
    console.log(`FAIL ${call.id}  ${String(e.message).slice(0, 200)}`);
    return { id: call.id, ok: false, error: String(e.message), prompt: call.prompt, refs: call.images || [] };
  }
}

const queue = [...jobs.calls];
const workers = Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const call = queue.shift();
    results.push(await runOne(call));
  }
});
await Promise.all(workers);

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({
  elapsedMs: Date.now() - started,
  results,
}, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
