/**
 * 把本机正在用的生图模型切到新的默认值。
 *
 * 为什么需要它：`DEFAULT_CONFIG` 只影响**新装**的用户；已经跑过的机器上
 * `config.json` 里存着旧模型，而 `doubao-seedream-4-0-*` 会把等距菱形画变形
 * （实测比例 1.058，应该 2.0），地图地块模块用它必然只能回退模板几何。
 *
 *   node scripts/set-ark-model.mjs [model]
 */
import { readFile, writeFile } from "node:fs/promises";

const { configPath, DEFAULT_CONFIG, loadConfig } = await import("../lib/config.js");

const target = process.argv[2] ?? DEFAULT_CONFIG.arkModel;
const file = configPath();
const raw = JSON.parse(await readFile(file, "utf8"));
const before = raw.arkModel;
if (before === target) {
  console.log(`已经是 ${target}，不用改。`);
  process.exit(0);
}
raw.arkModel = target;
await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
const after = await loadConfig();
console.log(`${file}`);
console.log(`  arkModel: ${before} → ${after.arkModel}`);
