/**
 * 从 src/client.ts 里抽出所有 T("…") 的原文，找出**还没进词条表**的那些。
 *
 * 漏译在界面上只表现为「这一条一直是中文」，不会报错，所以必须靠工具抓。
 * 输出格式直接可以贴进 src/client.ts 的词条表。
 */
import { readFileSync } from "node:fs";

const text = readFileSync("src/client.ts", "utf8");
const found = new Map();
for (const match of text.matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)) {
  found.set(match[1], (found.get(match[1]) ?? 0) + 1);
}

// 词条表：`const EN: Record<string,string> = { … }`，到 `const ZH` 之前结束
// （`ZH` 是 EN 的 key 恒等映射，不用管）
const start = text.indexOf("const EN: Record<string, string> = {");
if (start < 0) throw new Error("找不到词条表 EN");
const end = text.indexOf("const ZH: Record<string, string>", start);
if (end < 0) throw new Error("找不到词条表 EN 的结尾（下一个顶层 const）");
const table = text.slice(start, end);

const missing = [...found.keys()].filter((key) => !table.includes(JSON.stringify(key) + ":"));
console.log(`T() 原文共 ${found.size} 条；词条表里没有的 ${missing.length} 条`);
if (missing.length > 0) {
  console.log("\n// ── 待补词条（填上英文后贴进 EN）──");
  for (const key of missing) console.log(`  ${JSON.stringify(key)}: "",`);
}
const withPlaceholder = [...found.keys()].filter((key) => /\{\w+\}/.test(key));
if (withPlaceholder.length > 0) {
  console.log("\n// ── 带占位符的（英文里必须保留同名占位符）──");
  for (const key of withPlaceholder) console.log(`  ${JSON.stringify(key)}`);
}
