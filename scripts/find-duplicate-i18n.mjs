/**
 * 找出 `src/client.ts` 词条表里的**重复 key**。
 *
 * 为什么值得单独一个工具：TS 会报 `TS1117: An object literal cannot have multiple
 * properties with the same name`，但报的是**行号**，在一个上千行的表里不好找；
 * 而且新加一条时很容易撞上已有的（「保存」「删除」这种短词尤其容易）。
 */
import { readFileSync } from "node:fs";

const text = readFileSync("src/client.ts", "utf8");
const start = text.indexOf("const EN: Record<string, string> = {");
const end = text.indexOf("const ZH: Record<string, string>", start);
if (start < 0 || end < 0) throw new Error("找不到词条表 EN");
const table = text.slice(start, end);
const tableStartLine = text.slice(0, start).split("\n").length;

const seen = new Map();
const lines = table.split("\n");
for (let i = 0; i < lines.length; i++) {
  const match = /^\s{6}"((?:[^"\\]|\\.)*)":/.exec(lines[i]);
  if (match === null) continue;
  const key = match[1];
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(tableStartLine + i);
}

const dups = [...seen.entries()].filter(([, where]) => where.length > 1);
console.log(`词条 ${seen.size} 条，重复 ${dups.length} 条`);
for (const [key, where] of dups) {
  console.log(`  x${where.length} L${where.join(",L")}  ${JSON.stringify(key)}`);
}
if (dups.length > 0) process.exit(1);
