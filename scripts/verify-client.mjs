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
  // 说明文字只在**失败**时打印：通过时还挂一句「缺少 rig-bones-db 区块」会让人以为出事了。
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? ` — ${detail}` : ""}`);
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
  checkRigContracts(text, label);

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

// ── 宿主后台任务 key：浏览器半区与宿主是两份实现，只能靠文本契约对齐 ──────
//
// 界面判断「这一批还在跑」靠宿主运行表里的任务（`project.jobs[].targets`）：
// 批量抽帧是 kick 型调用，远程调用立刻返回，真正的活在后台一个方向一个方向地做，
// 本地 pending 表那 700ms 撑不住——实测表现就是点「提取全部序列帧」后八个方向
// 先一起转圈，紧接着还没轮到的变回「尚未抽帧」，过一阵才出结果。
//
// 任务 key 写错一个字不会有任何报错，只是这条路静默失效，所以两边一起核对：
// 浏览器半区点了名的 key，宿主必须真有这个任务，而且必须公布覆盖面。
{
  const clientText = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
  const hostText = readFileSync(fileURLToPath(new URL("../src/pipeline.ts", import.meta.url)), "utf8");

  const clientKeys = [...new Set(
    [...clientText.matchAll(/hostJob\(\s*project\s*,\s*"([^"]+)"\s*\)/g)].map((match) => match[1])
  )];
  const kicked = new Set([...hostText.matchAll(/kick\(\s*projectId\s*,\s*"([^"]+)"/g)].map((match) => match[1]));
  const published = new Set(
    [...hostText.matchAll(/(?:setJobTargets|addJobTargets)\(\s*projectId\s*,\s*"([^"]+)"/g)].map((match) => match[1])
  );

  check("浏览器半区按宿主任务 key 判断批量进度", clientKeys.length >= 3, clientKeys.join("、") || "(一个都没有)");
  for (const key of clientKeys) {
    check(`宿主存在后台任务 ${key}`, kicked.has(key), [...kicked].join("、"));
    check(`后台任务 ${key} 公布覆盖面 targets`, published.has(key), [...published].join("、"));
  }
}

console.log("");
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
  console.error("阶段渲染函数少拿到 ctx 键时，界面渲染看不出来，只有点按钮才会报 TypeError。请把调用点补齐。");
  console.error("宿主任务 key / targets 对不上时同样看不出来，只是批量任务中途会退回空态。请把两边对齐。");
  process.exit(1);
}

console.log(`共 ${checks} 项检查，全部通过。`);

/**
 * 骨骼动画模块的文本契约。
 *
 * 浏览器半区是经典脚本，不能 import 宿主的常量，两边只能靠**同名文本**对齐：
 * 模块 key、深链接白名单、远程方法名、四个阶段标题。任一侧改名都会让这里失败。
 */
function checkRigContracts(text, label) {
  check(`${label}：注册了 RigModule`, text.includes("function RigModule"));
  check(`${label}：模块导航含骨骼动画生成`, text.includes("骨骼动画生成"));
  check(`${label}：深链接允许 rig 模块`, text.includes('new Set(["sprite", "image", "sequence", "rig"])'));
  for (const method of [
    "listRigJobs",
    "createRigJob",
    "getRigJob",
    "deleteRigJob",
    "saveRigJob",
    "uploadRigSource",
    "uploadRigPart",
    "removeRigPart",
    "renameRigPart",
    "setRigPartVisibility",
    "saveRigLayoutItem",
    "runRigSheet",
    "runRigSegment",
    "runRigLayout",
    "runRigBones",
    "runRigAtlas"
  ]) {
    check(`${label}：声明了远程方法 ${method}`, text.includes(`["${method}"`));
  }
  check(
    `${label}：四个阶段标题齐全`,
    ["① 拆件", "② 装配定位", "③ 骨骼与动画", "④ 图集"].every((entry) => text.includes(entry))
  );
  check(`${label}：装配结果可拖动微调`, text.includes("SPR_rigBox"));
  // 手动装配编辑器：拖拽 / 缩放 / 键盘 / 吸附 / 撤销 / 图层 / 部件栏，缺一样就是残的。
  for (const [feature, token] of [
    ["画布是客户端自己叠的分层", ".SPR_asmLayer"],
    ["选中后有缩放手柄", ".SPR_asmHandle"],
    ["未放置部件有部件栏（可拖进画布）", ".SPR_asmPalette"],
    ["有图层列表", ".SPR_asmLayers"],
    ["有对齐参考线", ".SPR_asmGuide"],
    ["键盘方向键微调", "ArrowLeft"],
    ["Delete 收回部件", "Delete"],
    ["Ctrl/Cmd+Z 撤销", 'toLowerCase() === "z"'],
    ["吸附开关", "吸附"],
    ["锁等比开关", "锁等比"],
    ["撤销/重做", "重做"],
    ["参考图做底图对位", "参考图底图"],
    ["图层置顶置底", "置顶"],
    ["滚轮缩放（以光标为锚）", "zoomAt"],
    ["空格/中键拖动平移", "data-panning"],
    ["Ctrl/Cmd+0 适应窗口", 'event.key === "0"']
  ]) {
    check(`${label}：手动装配有${feature}`, text.includes(token));
  }
  // 滚轮缩放必须用**非被动**监听：React 的 onWheel 是被动注册的，在里面
  // preventDefault 无效（浏览器照旧滚动，还会打警告），缩放会被页面滚动吃掉。
  check(
    `${label}：滚轮监听是非被动的`,
    text.includes('addEventListener("wheel"') && text.includes("{ passive: false }"),
    ""
  );
  // 画布居中必须用 margin:auto，不能靠父级 justify-content:center——
  // 后者在「内容比容器宽」时会裁掉左侧且滚不到，一放大就够不着左边那块。
  check(
    `${label}：画布用 margin:auto 居中（放大后左边够得着）`,
    /\.SPR_asmCanvas\{[^}]*margin:auto/.test(text),
    /\.SPR_asmCanvas\{([^}]*)\}/.exec(text)?.[1]?.slice(0, 80) ?? ""
  );
  // 舞台高度必须是固定的。用 max-height 让它被内容撑着的话，一缩放面板就跟着
  // 长高（实测 100% 时 605px、176% 时 681px），画面抽动、光标锚点也算不准。
  check(
    `${label}：装配舞台高度固定（缩放时面板不抽动）`,
    /\.SPR_asmStage\{[^}]*height:70vh/.test(text) && !/\.SPR_asmStage\{[^}]*max-height:70vh/.test(text),
    /\.SPR_asmStage\{([^}]*)\}/.exec(text)?.[1]?.slice(0, 90) ?? ""
  );
  // 两条导出路径都必须能在界面上拿到：Spine 的 skeleton.json / .atlas 是主路径，
  // DragonBones 的 _ske.json / _tex.json 是给 Cocos / Egret / Laya 用的第二条。
  // 宿主已经返回了这两组字段，界面不渲染就等于「产物生成了但用户不知道去哪拿」。
  check(
    `${label}：③ 阶段给出 DragonBones 骨架链接`,
    text.includes('data-testid": "rig-bones-db"') && text.includes("job.rig?.dragonBones?.skeleton"),
    "缺少 rig-bones-db 区块"
  );
  check(
    `${label}：④ 阶段逐页给出 DragonBones 贴图描述`,
    text.includes('data-testid": "rig-atlas-db"') && text.includes("job.atlas.dragonBones.map"),
    "缺少 rig-atlas-db 区块"
  );
  // 时间轴编辑器（M3）：动画从「参数」变成「可编辑数据」的界面落点。
  for (const [feature, token] of [
    ["时间轴面板", 'data-testid": "rig-timeline"'],
    ["关键帧轨道", 'data-testid": "rig-tl-track"'],
    ["选中帧的编辑区", 'data-testid": "rig-tl-edit"'],
    ["播放/擦洗之外还能加轨道", '`rig-tl-add-${kind}`'],
    ["缩放轨道（scale 轨道是 M3 新增的）", '["rotate", "translate", "scale"]'],
    ["还原到预设", 'data-testid": "rig-tl-revert"'],
    ["缓动预设按钮", '`rig-tl-ease-${preset.id}`'],
    ["拖动关键帧（松手才提交）", "dragRef"]
  ]) {
    check(`${label}：时间轴有${feature}`, text.includes(token), token);
  }
  // 拆件质检面板：**装配之前**就该告诉用户「这批拆件能不能信」。
  check(
    `${label}：有拆件质检面板`,
    text.includes('data-testid": "rig-qa"') && text.includes("job.qa"),
    "缺少 rig-qa 面板"
  );
  check(
    `${label}：质检支持重跑与「参考图大约几个部位」`,
    text.includes('data-testid": "rig-qa-rerun"') && text.includes('data-testid": "rig-qa-expected"'),
    "缺少质检操作入口"
  );
  check(
    `${label}：质检面板列出 message 与 suggestion`,
    text.includes("issue.suggestion") && text.includes("SPR_qaFix"),
    "建议没渲染出来"
  );  // 撤销/重做的两处时序陷阱，都是实测撞出来的：  //  ① 把 setHistory([]) 挂在 [job.id, job.updatedAt] 上 —— commit 自己就会改
  //     updatedAt，于是每提交一次就清空撤销栈，撤销按钮永远是灰的；
  //  ② undo 把「改动前」的快照塞进重做栈 —— 重做还原的还是改动前那份，点了没反应。
  check(
    `${label}：清空撤销栈只跟着任务 id，不跟着 updatedAt`,
    /setHistory\(\[\]\)[\s\S]{0,80}?\}, \[job\.id\]\)/.test(text),
    "把 setHistory([]) 和 setDraft({}) 拆成两个 effect：前者只依赖 job.id"
  );
  check(
    `${label}：撤销时先把当前状态抓进重做栈`,
    /const undo = \(\) => \{[\s\S]{0,400}?captureSnapshot\(Object\.keys\(last\)\)/.test(text),
    "undo 里要 captureSnapshot 当前状态再 applySnapshot(last)"
  );
  check(`${label}：骨骼预览内联在 iframe 里`, text.includes("SPR_rigPreview"));
  check(`${label}：低置信度部件有提示`, text.includes("相似度偏低"));
  // 面板根必须自己是滚动容器。SPR_root 是定高 flex 列，子元素默认不滚动，
  // 内容一多就被裁掉——实测表现是「骨骼动画生成这一页没法下滑」。
  check(
    `${label}：骨骼动画面板自带滚动`,
    /\.SPR_rigPanel\{[^}]*overflow:auto/.test(text),
    /\.SPR_rigPanel\{([^}]*)\}/.exec(text)?.[1] ?? "(找不到 .SPR_rigPanel)"
  );

  // 最容易漏的一条：REMOTE_METHODS 只是「向宿主声明方法名」，真正的方法体要
  // 在下面那个 api 对象里逐条挂上去。只加声明不加实现，界面一点就报
  // “api.xxx is not a function”——编译期完全看不出来（api 是隐式 any）。
  const declared = [...text.matchAll(/\["([A-Za-z0-9_]+)",\s*(?:true|false)\]/g)].map((m) => m[1]);
  const unique = [...new Set(declared)];
  // 实现侧的判据是「出现了 call("方法名")」，与缩进无关（src 与打包后的 lib 缩进不同）。
  const missing = unique.filter((name) => !text.includes(`call("${name}"`));
  check(
    `${label}：REMOTE_METHODS 的每个方法都有 api 实现（共 ${unique.length} 个）`,
    missing.length === 0,
    missing.length === 0 ? "" : `缺实现：${missing.join("、")}`
  );
  // 「从部件栏拖进画布」必须由**它自己**那个 mouseup 收尾，不能被更早注册的
  // 移动/缩放 mouseup 抢走：那个 effect 先跑、把 drag 置空，React 同步重渲染后
  // 就把后面的监听器当清理函数摘掉了——实测表现是拖进去毫无反应、撤销也不亮。
  check(
    `${label}：移动/缩放 effect 不吞「拖进画布」`,
    /drag\.kind !== "move"\s*&&\s*drag\.kind !== "resize"/.test(text) && /drag\.kind !== "place"/.test(text),
    "移动/缩放 mouseup 必须过滤 kind，否则 place 拖放不生效"
  );
  // 本地草稿写的是 `placed`（操作意图），而图层显隐/已放置计数读的是 `matched`
  // （宿主也是读 placed 写 matched 的）。合并时不把两个键对齐，Delete 收回、
  // 部件栏拖入这类纯本地改动就要等宿主回包才看得见——通信一失败界面就一动不动，
  // 实测会被当成「整个手动装配是坏的」。
  check(
    `${label}：本地草稿把 placed 折算成 matched`,
    /matched:\s*local\.placed !== false/.test(text),
    "items 合并处必须由 placed 推导 matched"
  );
  check(
    `${label}：生成类调用都带 loading 文案`,
    [
      /runRigSheet\s*\(/,
      /runRigSegment\s*\(/,
      /runRigLayout\s*\(/,
      /runRigBones\s*\(/,
      /runRigAtlas\s*\(/
    ].every((pattern) => pattern.test(text))
  );
}
