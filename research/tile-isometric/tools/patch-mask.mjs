/** 把 jobs/batch6.json 里的 PLACEHOLDER 换成真实 mask 的 data URI。
 *
 * 作业文件入库、内联的 base64 不入库 —— 28KB 的二进制会让 diff 无法阅读。
 * 复跑顺序：mk-masks.py（生成 mask 到 probe/tpl/）→ patch-mask.mjs → run.mjs。
 * 跑完可以用 unpatch-mask.py 还原成占位符再提交。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TASK = resolve(here, "..");
const path = resolve(TASK, "jobs", "batch6.json");
const cfg = JSON.parse(readFileSync(path, "utf8"));
const uri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const M1 = uri(resolve(TASK, "probe", "tpl", "mask-t1-2048.png"));
for (const c of cfg.calls) {
  if (!c.extra?.mask) continue;
  c.extra.mask = c.extra.mask.includes("PLACEHOLDER2") ? M1 : M1;
}
writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log("patched mask into", cfg.calls.filter((c) => c.extra?.mask).map((c) => c.id).join(", "));
