#!/usr/bin/env node
/**
 * 多语言（中 / 英）契约自检 —— 纯本地，不联网、不花钱。
 *
 * 检查的是「词条表」这件事本身，而不是某段文案长什么样：
 *   1. `src/client.ts` 里每个 `T("…")` 的 key 都在英文表里 ——— 漏译会在界面上露出中文，
 *      而不是报错，所以必须由自检兜住；
 *   2. 英文表里没有没人用的死条目；
 *   3. key 与译文里的 `{nN}` 占位符集合一一对应 ——— 少一个就是界面上少一段文字；
 *   4. 英文译文里不残留全角标点 / 汉字（`·`、箭头、圈码这些故意保留的除外）；
 *   5. `lib/client.js` 与 `src/client.ts` 的词条表一致 ——— 忘了 build 就发版，界面会退回中文。
 *
 * 用法：node scripts/verify-i18n.mjs
 */
import { readFileSync, existsSync } from "node:fs";

let passed = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}

const CLIENT = "src/client.ts";
const BUNDLE = "lib/client.js";
/** 词条表的起止标记（`scripts/i18n-wrap.mjs` 靠它把词条表划出自动包装之外）。 */
const START = "i18n-ignore-start";
const END = "i18n-ignore-end";

/**
 * 从源码里抽出 `const EN = { "key": "value", … }` 那段。
 * @returns {{keys:string[], table:Map<string,string>}|null}
 */
function readDictionary(source) {
  const from = source.indexOf(START);
  const to = source.indexOf(END, from === -1 ? 0 : from);
  if (from === -1 || to === -1) return null;
  const block = source.slice(from, to);
  const pattern = /^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/gmu;
  const keys = [];
  const table = new Map();
  let match;
  while ((match = pattern.exec(block)) !== null) {
    const key = JSON.parse(match[1]);
    const value = JSON.parse(match[2]);
    keys.push(key);
    table.set(key, value);
  }
  return { keys, table };
}

/** 源码里所有 `T("…")` 的第一个实参（去重）。 */
function readUsedKeys(source) {
  const pattern = /\bT\(("(?:[^"\\]|\\.)*")/gu;
  const used = new Map();
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const key = JSON.parse(match[1]);
    const line = source.slice(0, match.index).split("\n").length;
    if (!used.has(key)) used.set(key, line);
  }
  return used;
}

/** 故意保留的非 ASCII 字符：它们是排版符号 / 货币符号，不是漏翻的汉字。 */
const ALLOWED_NON_ASCII = /[·…←→↑↓①②③④⑤×✓✗—–▲▼¥≤≥±°]/gu;
function offendingChars(text) {
  const stripped = text.replace(ALLOWED_NON_ASCII, "").replace(/[\n\r\t]/gu, "");
  return [...new Set(stripped.match(/[^\x20-\x7e]/gu) ?? [])];
}

const source = readFileSync(CLIENT, "utf8");
const dictionary = readDictionary(source);
if (dictionary === null) {
  console.error(`✗ 在 ${CLIENT} 里找不到词条表（${START} / ${END} 标记）`);
  process.exit(1);
}

section("词条表");
check("词条表非空", dictionary.keys.length > 0, `${dictionary.keys.length} 条`);
check("词条表没有重复 key", new Set(dictionary.keys).size === dictionary.keys.length);

const used = readUsedKeys(source);

section("覆盖");
{
  const missing = [...used.keys()].filter((key) => !dictionary.table.has(key));
  check(
    "每个 T(...) 都在英文表里有条目",
    missing.length === 0,
    missing.length === 0 ? `${used.size} 处调用` : `缺 ${missing.length} 条：${missing.slice(0, 5).map((k) => `第 ${used.get(k)} 行 ${JSON.stringify(k)}`).join("；")}`
  );
  const dead = dictionary.keys.filter((key) => !used.has(key));
  check("英文表里没有没人用的死条目", dead.length === 0, dead.length === 0 ? "" : `${dead.length} 条：${dead.slice(0, 5).map((k) => JSON.stringify(k)).join("；")}`);
}

section("占位符");
{
  const placeholders = (text) => [...new Set(text.match(/\{\w+\}/gu) ?? [])].sort().join(",");
  const mismatched = dictionary.keys.filter((key) => placeholders(key) !== placeholders(dictionary.table.get(key)));
  check(
    "中英两侧的 {nN} 占位符一致",
    mismatched.length === 0,
    mismatched.length === 0 ? "" : mismatched.slice(0, 5).map((k) => `${JSON.stringify(k)} → ${JSON.stringify(dictionary.table.get(k))}`).join("；")
  );
}

section("英文译文");
{
  const leaks = dictionary.keys.filter((key) => offendingChars(dictionary.table.get(key)).length > 0);
  check(
    "译文里没有残留汉字 / 全角标点",
    leaks.length === 0,
    leaks.length === 0 ? "" : leaks.slice(0, 5).map((k) => `${JSON.stringify(dictionary.table.get(k))} (${offendingChars(dictionary.table.get(k)).join("")})`).join("；")
  );
  const empty = dictionary.keys.filter((key) => dictionary.table.get(key).trim() === "");
  check("译文没有空字符串", empty.length === 0, empty.join("；"));
}

section("产物同步");
if (!existsSync(BUNDLE)) {
  check(`${BUNDLE} 存在`, false, "先跑 npm run build");
} else {
  const bundle = readDictionary(readFileSync(BUNDLE, "utf8"));
  check(`${BUNDLE} 里也有词条表`, bundle !== null && bundle.keys.length > 0, bundle === null ? "" : `${bundle?.keys.length ?? 0} 条`);
  check(
    `${BUNDLE} 与 ${CLIENT} 的词条表一致（build 过了吗）`,
    bundle !== null && bundle.keys.length === dictionary.keys.length && dictionary.keys.every((key) => bundle.table.get(key) === dictionary.table.get(key))
  );
}

console.log(`\n共 ${passed + failures.length} 项检查，失败 ${failures.length} 项。`);
if (failures.length > 0) {
  console.log("漏译在界面上只表现为「这一条还是中文」，不会报错——所以这里必须过。");
  process.exit(1);
}
console.log("多语言契约全部通过。");
