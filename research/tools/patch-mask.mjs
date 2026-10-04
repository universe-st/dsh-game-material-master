/** 把 batch6.json 里的 PLACEHOLDER 换成真实 mask 的 data URI。 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, "..", "probe", "batch6.json");
const cfg = JSON.parse(readFileSync(path, "utf8"));
const uri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const M1 = uri(resolve(here, "..", "probe", "tpl", "mask-t1-2048.png"));
for (const c of cfg.calls) {
  if (!c.extra?.mask) continue;
  c.extra.mask = c.extra.mask.includes("PLACEHOLDER2") ? M1 : M1;
}
writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log("patched mask into", cfg.calls.filter((c) => c.extra?.mask).map((c) => c.id).join(", "));
