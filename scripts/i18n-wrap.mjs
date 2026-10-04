#!/usr/bin/env node
/**
 * 把 `src/client.ts` 里所有「含中日韩字符的字符串字面量」包成 `T(...)` 调用，
 * 并据此生成英文词条表要用的 key 清单。
 *
 * 为什么要有这个脚本：
 *   - 浏览器半区是**经典脚本**，不能 import，词条只能内联；可是 800+ 条 UI 文案
 *     靠手改必然漏，所以用词法扫描器机械地包一层，人工只负责写英文译文。
 *   - TypeScript 7 是原生编译器，没有可用的 JS 编译器 API；这里也只需要
 *     「字符串 / 模板 / 注释 / 正则」四种状态，不需要语法树。
 *
 * 生成规则（中文原文就是 key，省掉一层人造 key 表）：
 *   1. `"中文"`            → `T("中文")`
 *   2. `` `前${expr}后` `` → `T("前{n0}后", { n0: expr })`   ← 占位符让英文可以换语序
 *   3. 已经是 `T(...)` 第一个实参的字面量会被跳过（幂等：可以反复跑）。
 *   4. 只有注释里出现中文的模板（内联 CSS）跳过——那是给开发看的，不是 UI 文案。
 *
 * 用法：
 *   node scripts/i18n-wrap.mjs src/client.ts --keys .i18n-keys.json   # 只出清单（不改文件）
 *   node scripts/i18n-wrap.mjs src/client.ts --write                  # 真正改写文件
 */
import { readFileSync, writeFileSync } from "node:fs";

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
/** `T(` 之前的最后一个非空白字符序列，用来识别「这个字面量已经是 key 了」。 */
const T_CALL = /\bT\($/u;

/** 拆出模板字面量里的准字面量（quasi）与表达式源码。 */
function splitTemplate(raw) {
  // raw 含首尾反引号。
  const quasis = [];
  const expressions = [];
  let current = "";
  let i = 1;
  const end = raw.length - 1;
  while (i < end) {
    const c = raw[i];
    if (c === "\\") {
      const next = raw[i + 1];
      current += decodeEscape(next, raw[i + 2]);
      i += next === "u" || next === "x" ? (next === "u" ? 5 : 3) : 2;
      continue;
    }
    if (c === "$" && raw[i + 1] === "{") {
      quasis.push(current);
      current = "";
      let depth = 1;
      let j = i + 2;
      let expr = "";
      while (j < end && depth > 0) {
        const ch = raw[j];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        } else if (ch === "\\") {
          expr += ch + raw[j + 1];
          j += 2;
          continue;
        } else if (ch === "`" || ch === '"' || ch === "'") {
          // 表达式里的嵌套字符串：整段照抄，别把里面的 } 当成收尾。
          const quote = ch;
          let k = j + 1;
          expr += ch;
          while (k < end) {
            if (raw[k] === "\\") {
              expr += raw[k] + raw[k + 1];
              k += 2;
              continue;
            }
            expr += raw[k];
            if (raw[k] === quote) break;
            k++;
          }
          j = k + 1;
          continue;
        }
        expr += ch;
        j++;
      }
      expressions.push(expr);
      i = j + 1;
      continue;
    }
    current += c;
    i++;
  }
  quasis.push(current);
  return { quasis, expressions };
}

function decodeEscape(char, unicodeDigits) {
  switch (char) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "v":
      return "\v";
    case "0":
      return "\0";
    case "`":
      return "`";
    case "$":
      return "$";
    case "u":
      return unicodeDigits === undefined ? "u" : String.fromCharCode(Number.parseInt(unicodeDigits.slice(1), 16));
    case "x":
      return unicodeDigits === undefined ? "x" : String.fromCharCode(Number.parseInt(unicodeDigits.slice(1), 16));
    default:
      return char;
  }
}

/** 去掉模板里的 CSS / JS 注释，用来判断「中文是不是只出现在注释里」。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

function regexAllowed(prev) {
  if (prev === undefined) return true;
  return !/[\w$)\]]/u.test(prev);
}

/**
 * 扫一遍源码，返回所有需要包 `T(...)` 的字面量。
 * @returns {{line:number,start:number,end:number,kind:string,key:string,code:string}[]}
 */
function scanLiterals(source) {
  const found = [];
  let i = 0;
  let line = 1;
  let prev = undefined;
  const n = source.length;
  // 词条表本身用中文原文当 key，绝不能被包成 `T("中文"): "English"`（那是语法错误）。
  // 所以支持一对显式标记把整段划出去。
  const SKIP_START = "i18n-ignore-start";
  const SKIP_END = "i18n-ignore-end";
  const skipRanges = [];
  {
    let at = 0;
    while (true) {
      const from = source.indexOf(SKIP_START, at);
      if (from === -1) break;
      const to = source.indexOf(SKIP_END, from);
      if (to === -1) break;
      const lineOf = (index) => source.slice(0, index).split("\n").length;
      skipRanges.push([from, to + SKIP_END.length]);
      // 跳过区间里可能有换行，行号要把它们算进去。
      line += source.slice(at, to).split("\n").length - 1;
      at = to + SKIP_END.length;
    }
  }
  const skipped = (at) => skipRanges.some(([from, to]) => at >= from && at < to);
  /** 上一个「有意义字符」在源码里的下标，用来判断字面量前面是不是 `T(`。 */
  const looksLikeTKey = (at) => T_CALL.test(source.slice(Math.max(0, at - 4), at));

  while (i < n) {
    const c = source[i];
    if (skipped(i)) {
      i++;
      continue;
    }
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      const startLine = line;
      i++;
      let raw = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          raw += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (source[i] === "\n") break;
        raw += source[i];
        i++;
      }
      i++;
      const value = decodeStringBody(raw);
      if (CJK.test(value) && !looksLikeTKey(start)) {
        found.push({ line: startLine, start, end: i, kind: "string", key: value, code: `T(${JSON.stringify(value)})` });
      }
      prev = quote;
      continue;
    }
    if (c === "`") {
      const startLine = line;
      const start = i;
      i++;
      let depth = 0;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "\n") line++;
        if (ch === "$" && source[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0) {
          if (ch === "}") depth--;
          i++;
          continue;
        }
        if (ch === "`") break;
        i++;
      }
      const end = i + 1;
      const raw = source.slice(start, end);
      i = end;
      prev = "`";
      const body = raw.slice(1, -1);
      if (!CJK.test(body) || !CJK.test(stripComments(body))) continue;
      if (looksLikeTKey(start)) continue;
      const { quasis, expressions } = splitTemplate(raw);
      const params = expressions.map((expression, index) => `n${index}`);
      let key = quasis[0];
      for (let index = 0; index < expressions.length; index++) key += `{${params[index]}}${quasis[index + 1]}`;
      const code =
        expressions.length === 0
          ? `T(${JSON.stringify(key)})`
          : `T(${JSON.stringify(key)}, { ${params.map((name, index) => `${name}: ${expressions[index]}`).join(", ")} })`;
      found.push({ line: startLine, start, end, kind: expressions.length === 0 ? "template" : "interp", key, code });
      continue;
    }
    if (c === "/" && regexAllowed(prev)) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n && source[j] !== "\n") {
        const ch = source[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) {
          ok = true;
          break;
        }
        j++;
      }
      if (ok) {
        i = j + 1;
        while (i < n && /[a-z]/u.test(source[i])) i++;
        prev = "/";
        continue;
      }
    }
    if (!/\s/u.test(c)) prev = c;
    i++;
  }
  return found;
}

function decodeStringBody(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") {
      out += raw[i];
      continue;
    }
    const next = raw[i + 1];
    if (next === "u" || next === "x") {
      const width = next === "u" ? 5 : 3;
      out += decodeEscape(next, raw.slice(i, i + width));
      i += width - 1;
      continue;
    }
    out += decodeEscape(next, undefined);
    i++;
  }
  return out;
}

const args = process.argv.slice(2);
const file = args.find((item) => !item.startsWith("--"));
const write = args.includes("--write");
const keysIndex = args.indexOf("--keys");
const keysPath = keysIndex === -1 ? undefined : args[keysIndex + 1];

const source = readFileSync(file, "utf8");
const literals = scanLiterals(source);

if (keysPath !== undefined) {
  const byKey = new Map();
  for (const item of literals) {
    if (!byKey.has(item.key)) byKey.set(item.key, []);
    byKey.get(item.key).push(item.line);
  }
  const keys = [...byKey.entries()]
    .map(([key, lines]) => ({ key, lines, count: lines.length }))
    .sort((a, b) => a.lines[0] - b.lines[0]);
  writeFileSync(keysPath, `${JSON.stringify({ total: literals.length, unique: keys.length, keys }, null, 1)}\n`, "utf8");
  console.log(`字面量 ${literals.length} 处，去重后 ${keys.length} 条 key → ${keysPath}`);
}

const dumpIndex = args.indexOf("--dump");
if (dumpIndex !== -1) {
  // 从**已经包好**的文件里回收 key：找所有 `T(<字符串字面量>` 的第一个实参。
  const dumpPath = args[dumpIndex + 1];
  const wrapped = readFileSync(file, "utf8");
  const pattern = /\bT\(("(?:[^"\\]|\\.)*")/gu;
  const seen = new Map();
  let match;
  while ((match = pattern.exec(wrapped)) !== null) {
    const key = JSON.parse(match[1]);
    const line = wrapped.slice(0, match.index).split("\n").length;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(line);
  }
  const keys = [...seen.entries()].map(([key, lines]) => ({ key, lines })).sort((a, b) => a.lines[0] - b.lines[0]);
  writeFileSync(dumpPath, `${JSON.stringify({ unique: keys.length, keys }, null, 1)}\n`, "utf8");
  console.log(`回收 key ${keys.length} 条 → ${dumpPath}`);
}

if (write) {
  let out = "";
  let cursor = 0;
  for (const item of literals) {
    out += source.slice(cursor, item.start) + item.code;
    cursor = item.end;
  }
  out += source.slice(cursor);
  writeFileSync(file, out, "utf8");
  console.log(`已改写 ${file}：包装 ${literals.length} 处字面量`);
}
