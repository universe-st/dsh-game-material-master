/** 列出账号可见的方舟模型（/api/v3/models）。 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(join(process.env.DSH_HOME || join(homedir(), ".dsh"), "game-material-master", "config.json"), "utf8"));
const res = await fetch(`${cfg.arkBaseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.arkApiKey}` } });
const text = await res.text();
if (!res.ok) {
  console.log(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
const data = JSON.parse(text);
const ids = (data.data || []).map((m) => m.id);
console.log(`共 ${ids.length} 个模型：`);
for (const id of ids.sort()) console.log(" ", id);
