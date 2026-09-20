/**
 * 浏览器半区契约自检：不需要浏览器、不联网，就能验证
 *   「阶段渲染函数从 ctx 里取哪些键，调用点就必须原样转发哪些键」，
 *   以及「所有会出素材的接口调用都带了 loading 反馈」。
 *
 *   node scripts/verify-client.mjs                 # 默认检查 src/client.ts 与 lib/client.js
 *   node scripts/verify-client.mjs <文件…>          # 只检查指定文件（用于回归验证）
 *
 * 这个检查是为一个实测 bug 加的：`renderVideoStage(ctx)` 内部
 * `const { project, api, … } = ctx`，但 `StudioPanel` 里的调用点漏传了 `api`，
 * 于是界面渲染完全正常，**一点「生成视频」就炸**：
 *   Cannot read properties of undefined (reading 'runVideos')
 * 同样的漏传还波及第 3 步抽帧（`runFrames`）与第 4 步合成（`compose`）。
 *
 * 为什么编译器没拦住：`src/client.ts` 虽然是 TS，但这些渲染函数的 `ctx` 参数是隐式
 * any（tsconfig 里 `noImplicitAny: false`，与整份文件的 JS 风格一致），
 * 少传一个键不会有任何提示。所以这里用文本解析把契约钉死。
 *
 * 第二类检查同样是为实测问题加的：生图 / 生视频 / 抽帧 / 抠像 / 合成这些调用
 * 动辄几秒到几分钟，**调用期间界面没有任何变化**，用户会以为按钮没生效而反复点。
 * 现在每个生成类调用点都必须把 pending 的 key 与文案传下去，且界面必须真的
 * 用上遮罩 / 转圈组件；漏一个就是「点了没反应」。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

const DEFAULT_FILES = ["../src/client.ts", "../lib/client.js"].map((rel) =>
  fileURLToPath(new URL(rel, import.meta.url))
);

/** 从 `open` 处的 `{` 开始，返回与它配对的 `}` 之间的文本。 */
function bracedBody(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * 取出对象字面量的顶层键名：`{ a, b, c: 1 }` → ["a", "b", "c"]。
 * 展开运算符（`...x`）无法静态判定，返回 null 让调用方跳过。
 */
function objectKeys(body) {
  if (body.includes("...")) return null;
  const parts = [];
  let depth = 0;
  let current = "";
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote !== null) {
      current += ch;
      if (ch === quote && body[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if ("{[(".includes(ch)) depth++;
    else if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts
    .map((part) => {
      const text = part.trim();
      if (text === "") return null;
      const withValue = /^([A-Za-z_$][\w$]*)\s*:/.exec(text);
      if (withValue !== null) return withValue[1];
      const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(text);
      return shorthand === null ? null : shorthand[1];
    })
    .filter((key) => key !== null);
}

/** 找 `function NAME(ctx) {` 的函数体，并读出它从 ctx 解构出来的键。 */
function renderersIn(text) {
  const found = new Map();
  const re = /function\s+(\w+)\s*\(\s*ctx\s*\)\s*\{/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const body = bracedBody(text, match.index + match[0].length - 1);
    if (body === null) continue;
    const destructured = /const\s*\{([\s\S]*?)\}\s*=\s*ctx\s*;/.exec(body);
    if (destructured === null) continue;
    const keys = objectKeys(destructured[1]);
    if (keys === null) continue;
    found.set(match[1], keys);
  }
  return found;
}

/** 找 `NAME({ … })` 形式、带对象字面量实参的调用点。 */
function callSitesIn(text, name) {
  const sites = [];
  const re = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g");
  let match;
  while ((match = re.exec(text)) !== null) {
    let cursor = re.lastIndex;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (text[cursor] !== "{") continue;
    const body = bracedBody(text, cursor);
    if (body === null) continue;
    sites.push({
      line: text.slice(0, match.index).split("\n").length,
      keys: objectKeys(body) ?? [],
      spread: body.includes("...")
    });
  }
  return sites;
}

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_FILES;

// ── 第二类检查：所有「出素材」的接口调用都要有 loading 反馈 ─────────────
/**
 * 必须带 pending 反馈的调用（key = 方法名，value = 这类调用的产物）。
 * 判定标准：调用点所属的那次 `start(...)` / `run(...)` / `kickAndWatch(...)`
 * 调用必须给出 `{ key: …, label: … }` 作为最后一个实参。
 */
const FEEDBACK_REQUIRED = {
  runImages: "批量生图",
  runImage: "单方向生图",
  runVideos: "生视频",
  runFrames: "抽帧",
  rekey: "重跑抠像",
  compose: "合成整图",
  runImageJob: "图片生成",
  keyImageJob: "图片抠像",
  runSequenceVideo: "序列帧：生视频",
  runSequenceFrames: "序列帧：抽帧",
  keySequenceFrames: "序列帧：抠像",
  composeSequence: "序列帧：合成",
  pollVideos: "刷新视频进度",
  pollSequenceVideo: "刷新序列帧视频进度"
};

/** 必须在样式里出现、且被 render 真用到的反馈组件 / 类名。 */
const FEEDBACK_PIECES = [
  ["usePendingTasks", "pending 记账 hook"],
  ["LoadingOverlay", "预览区 loading 遮罩"],
  ["BusyBtn", "按钮级转圈"],
  ["BusyBadge", "工具栏状态徽章"],
  ["data-busy", "遮罩/按钮的忙碌标记"],
  [".SPR_ovl{", "遮罩样式"],
  [".SPR_spin{", "转圈动画"],
  ["@keyframes SPR_spin", "动画关键帧"],
  ["prefers-reduced-motion", "减少动画偏好"]
];

/** 从 `open` 处的 `{` 开始，返回与它配对的 `}` 的下标（文本已去掉字符串与注释）。 */
function matchingBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 用等长空白替换注释与字符串，保证下标与原文一一对应。 */
function blankOut(text) {
  const out = text.split("");
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && text[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out[i++] = " ";
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\") {
          out[i] = " ";
          i++;
        }
        if (i < n && text[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) out[i++] = " ";
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * 找出每个「wrapper(fn, …, { key, label })」调用点里，作为最后实参的反馈对象。
 * 这里不解析语法树，只按括号配对切分实参，够用且不引入依赖。
 */
function callsWithFeedback(code, wrapperNames) {
  const results = [];
  for (const wrapper of wrapperNames) {
    const re = new RegExp(`(?<![\\w$.])${wrapper}\\s*\\(`, "g");
    let match;
    while ((match = re.exec(code)) !== null) {
      const open = code.indexOf("(", match.index);
      let depth = 0;
      let end = -1;
      for (let i = open; i < code.length; i++) {
        if (code[i] === "(") depth++;
        else if (code[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) continue;
      const body = code.slice(open + 1, end);
      // 顶层实参切分
      const args = [];
      let depth2 = 0;
      let cur = "";
      for (const ch of body) {
        if ("([{".includes(ch)) depth2++;
        else if (")]}".includes(ch)) depth2--;
        if (ch === "," && depth2 === 0) {
          args.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      args.push(cur);
      const last = args[args.length - 1].trim();
      const line = code.slice(0, match.index).split("\n").length;
      // 反馈对象出现在**任意一个**实参里都算（有的调用点把 feedback 放在中间，
      // 例如 kickAndWatch(() => run(...), undefined, { key, label })）。
      const hasKey = args.some((arg) => /\bkey\s*:/.test(arg));
      const hasLabel = args.some((arg) => /\blabel\s*:/.test(arg));
      results.push({ wrapper, line, at: match.index, end, hasKey, hasLabel, raw: last });
    }
  }
  return results.sort((a, b) => a.at - b.at);
}

for (const file of files) {
  const label = file.replace(/\\/g, "/").split("/").slice(-2).join("/");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    check(`${label}：可读取`, false, file);
    continue;
  }

  const renderers = renderersIn(text);
  check(`${label}：找到阶段渲染函数`, renderers.size > 0, [...renderers.keys()].join("、"));
  if (renderers.size === 0) continue;

  for (const [name, needed] of renderers) {
    const sites = callSitesIn(text, name);
    check(`${label}：${name} 有调用点`, sites.length > 0, `${sites.length} 处`);
    for (const site of sites) {
      if (site.spread) {
        check(`${label}：${name} 第 ${site.line} 行转发 ctx`, true, "实参含展开运算符，跳过静态判定");
        continue;
      }
      const missing = needed.filter((key) => !site.keys.includes(key));
      check(
        `${label}：${name} 第 ${site.line} 行转发全部 ctx 键`,
        missing.length === 0,
        missing.length === 0 ? `${needed.length} 个键` : `漏传 ${missing.join("、")}（函数需要 ${needed.join("、")}）`
      );
    }
  }

  // ── loading 反馈：组件与样式必须在 ────────────────────────────────────
  for (const [piece, why] of FEEDBACK_PIECES) {
    check(`${label}：存在「${why}」`, text.includes(piece), piece);
  }

  // ── 单方向「重新生成」视频必须显式带 regenerate ──────────────────────
  // 不带这个标记时宿主会把 ready 的方向当成「已完成」跳过：界面转一圈就结束，
  // 真正的失败只留在日志里（实测报错：「没有可提交的方向：请先生成绿幕图，
  // 或先清掉已完成的视频」）。所以调用点必须自己声明这是一次「重新生成」。
  check(
    `${label}：单方向「重新生成」视频带 regenerate 标记`,
    /keys:\s*\[direction\.key\][\s\S]{0,400}?regenerate:/.test(text),
    "runVideos({ keys: [direction.key], regenerate: … })"
  );

  // ── loading 反馈：每个生成类调用点都要带 key + label ──────────────────
  const code = blankOut(text);
  const calls = callsWithFeedback(code, ["start", "run", "kickAndWatch"]);
  const broken = [];
  const seen = new Set();
  for (const [method, what] of Object.entries(FEEDBACK_REQUIRED)) {
    const re = new RegExp(`api\\.${method}\\s*\\(`, "g");
    let match;
    let found = 0;
    while ((match = re.exec(code)) !== null) {
      found++;
      const line = code.slice(0, match.index).split("\n").length;
      // 负责这次 api 调用的 wrapper：起点在它之前、且包住它的**最外层**那一个。
      // 只看行号会挑错——`kickAndWatch(() => run(() => api.x()), …)` 全在同一行；
      // 只看最近的一个也会挑错——那样挑到内层的 run，而 feedback 在外层。
      const owners = calls.filter((call) => call.at <= match.index && call.end >= match.index);
      const owner = owners[0];
      if (owner === undefined) {
        broken.push(`${what}（第 ${line} 行 api.${method}）没有被 start/run/kickAndWatch 包住`);
        continue;
      }
      if (!owner.hasKey || !owner.hasLabel) {
        broken.push(`${what}（第 ${line} 行 api.${method}）经由 ${owner.wrapper}（第 ${owner.line} 行）但没传 { key, label }`);
      }
    }
    check(`${label}：${what} 的调用点都带 loading 反馈`, found > 0 && !broken.some((item) => item.includes(what)), found === 0 ? "没找到调用点" : `${found} 处`);
    seen.add(method);
  }
  if (broken.length > 0) {
    console.log(`     ↳ ${broken.join("\n     ↳ ")}`);
  }
}

console.log("");
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
  console.error("阶段渲染函数少拿到 ctx 键时，界面渲染看不出来，只有点按钮才会报 TypeError。请把调用点补齐。");
  process.exit(1);
}
console.log(`共 ${checks} 项检查，全部通过。`);
