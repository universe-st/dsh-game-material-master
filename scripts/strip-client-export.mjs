// 构建后处理：TypeScript 会给出浏览器束追加 `export {};`，使经典脚本在浏览器里
// 抛 SyntaxError。客户端束必须保持为不带 import/export 的普通脚本。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const src = readFileSync(file, "utf8");
const stripped = src.replace(/\nexport \{\};\s*$/, "\n");
if (stripped === src) {
  console.error("strip-client-export: 未找到结尾的 'export {};' —— 束形态已变化，请检查");
  process.exit(1);
}
writeFileSync(file, stripped);
console.log("stripped trailing export from lib/client.js");
