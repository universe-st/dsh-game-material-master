/**
 * 「调用接口时的视觉反馈」真机自检：不需要浏览器、不联网。
 *
 *   node scripts/verify-feedback.mjs                # 默认加载 lib/client.js 真跑渲染
 *   node scripts/verify-feedback.mjs <bundle.js>    # 指定别的产物
 *
 * 为什么单独写一份：`verify-client.mjs` 只做**文本层面**的契约检查（调用点有没有
 * 传 key/label），证明不了「传了之后界面真的会长出遮罩」。这份脚本把产物真正加载
 * 起来，用假的 `window.__ModuleLoader__` 抓住插件体、用假的 React 抓住 Hook 槽位，
 * 再用桩数据渲染出元素树，逐个断言遮罩真的出现了：
 *
 *   - 点「重新生成」时那个方向的缩略图外面必须有 loading 遮罩，文案带方向名；
 *   - 批量生成时还没轮到的方向也要盖住（否则旧图看着像「没反应」）；
 *   - 宿主侧状态是 running（而不是本地 pending）时同样要有遮罩；
 *   - **没有任务在跑时一个遮罩都不能有**（否则界面永远糊着一层黑）。
 *
 * 这类 bug 实测很难靠肉眼发现：不盖遮罩时界面看起来完全正常，只是「点了没反应」，
 * 用户会以为按钮失效而反复点击——而每次点击都是一次真实计费的生图 / 生视频。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const failures = [];
let checks = 0;
/** Hook 槽位越界的证据，随渲染结果一起返回，而不是打日志。 */
let hookOverflow = false;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}
function section(title) {
  console.log(`\n${title}`);
}

const target = process.argv[2] ?? fileURLToPath(new URL("../lib/client.js", import.meta.url));

// ── 假 React：createElement 产出纯对象，Hook 按槽位取值 ──────────────────
const HOOK = { slots: [], cursor: 0, overflow: false };

const ReactStub = {
  Fragment: Symbol.for("react.fragment"),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    const index = HOOK.cursor++;
    const value = HOOK.slots[index];
    return [value === undefined ? (typeof initial === "function" ? initial() : initial) : value, () => {}];
  },
  useRef(initial) {
    HOOK.cursor++;
    return { current: initial };
  },
  useEffect() {},
  useLayoutEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  useContext() {
    return undefined;
  }
};

// ── 加载产物 ─────────────────────────────────────────────────────────────
const source = readFileSync(target, "utf8");
const LOADED = [];
const windowStub = {
  __ModuleLoader__: {
    load(registration) {
      LOADED.push(registration);
    }
  },
  // 深链接用到的最小 location/history 面（默认没有深链接参数）。
  location: { origin: "http://127.0.0.1:43120", search: "", href: "http://127.0.0.1:43120/" },
  history: {
    // 真浏览器的 replaceState 会同步地址栏；桩里手动把 Location 的两处一起改，
    // 否则「参数被清掉」这条断言永远测不到东西。
    replaceState(_state, _title, url) {
      const next = new URL(url, windowStub.location.href);
      windowStub.location.href = next.toString();
      windowStub.location.search = next.search;
    }
  },
  setTimeout: (fn) => {
    fn();
    return 0;
  }
};

/** 捕获 document 上的点击监听器（深链接拦截器就装在这里）。 */
const CLICK_LISTENERS = [];
globalThis.document = {
  head: { appendChild() {}, removeChild() {} },
  // 插件用 <style> 注入自己的 CSS；这里只要求它不炸，样式内容由 verify-client 检查。
  createElement: () => ({
    setAttribute() {},
    remove() {},
    style: {},
    textContent: ""
  }),
  addEventListener(type, listener) {
    if (type === "click") CLICK_LISTENERS.push(listener);
  },
  removeEventListener(type, listener) {
    const index = CLICK_LISTENERS.indexOf(listener);
    if (index >= 0) CLICK_LISTENERS.splice(index, 1);
  }
};

function report() {
  console.log("");
  if (failures.length > 0) {
    console.error(`失败 ${failures.length} 项：${failures.join("、")}`);
    process.exit(1);
  }
  console.log(`共 ${checks} 项检查，全部通过。`);
  process.exit(0);
}

try {
  // 经典脚本：顶层就是一次 __ModuleLoader__.load(...) 调用。
  new Function("window", "require", source)(windowStub, (name) => {
    if (name === "react") return ReactStub;
    throw new Error(`未预期的 require(${name})`);
  });
} catch (error) {
  check(`${target}：可加载`, false, String(error?.message ?? error));
  report();
}
check(`${target}：可加载`, true);
check("注册了唯一插件体", LOADED.length === 1, `${LOADED.length} 个 load()`);
if (LOADED.length !== 1) report();

let bundle;
try {
  bundle = LOADED[0].factory((name) => {
    if (name === "react") return ReactStub;
    throw new Error(`未预期的 require(${name})`);
  });
} catch (error) {
  check("factory 可执行", false, String(error?.message ?? error));
  report();
}
check("factory 可执行", true, `导出 ${Object.keys(bundle).join("、")}`);

// ── 抓住三个挂载点里的组件 ───────────────────────────────────────────────
const REGISTERED = {};
const SELECTED_PANELS = [];
const fakeCtx = {
  effect(fn) {
    return fn();
  },
  get(name) {
    if (name === "layout") {
      return {
        selectPanel(panelId) {
          SELECTED_PANELS.push(panelId);
        }
      };
    }
    return undefined;
  },
  slots: {
    inject(name, fn) {
      return fn();
    },
    register(options, component) {
      REGISTERED[options.name] = component;
      return () => {};
    }
  },
  remote: {
    $mount() {
      return Promise.resolve();
    }
  }
};

try {
  bundle.apply(fakeCtx);
} catch (error) {
  check("apply 可执行", false, String(error?.message ?? error));
  report();
}
check("apply 可执行", true, Object.keys(REGISTERED).join("、"));

const panel = REGISTERED.main;
check("挂上了 main 工作台组件", typeof panel === "function", typeof panel);

// ── 元素树工具 ───────────────────────────────────────────────────────────
/**
 * 深度遍历元素树。函数组件（MediaBox / LoadingOverlay / BusyBadge / BusyBtn…）
 * 在树里只是「type 是函数」的节点，必须**真的把它们渲染出来**才能看到里面的
 * `SPR_ovl` —— 这正是本测试要验证的东西，不能只看 props。
 *
 * 注意：`h(tag, props, ...children)` 的子节点在元素对象的 `children` 上，
 * 不在 `props.children` 上；只遍历 props 会一个 `SPR_node` 都找不到。
 */
function collect(node, predicate, out = [], seen = new Set()) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out, seen);
    return out;
  }
  if (seen.has(node)) return out;
  seen.add(node);
  if (predicate(node)) out.push(node);
  // `children` 正常情况下是数组；万一它是别的东西（例如被 memo 包了一层），
  // 就跳过而不是抛异常——测试要报告缺遮罩，不该被遍历本身打断。
  if (Array.isArray(node.children)) {
    for (const child of node.children) collect(child, predicate, out, seen);
  }
  for (const value of Object.values(node.props ?? {})) {
    if (value !== null && typeof value === "object") collect(value, predicate, out, seen);
  }
  if (typeof node.type === "function") {
    // 函数组件要按 React 语义渲染：children 通过 props 传进去，不在 props 里。
    // 只传 node.props 的话，`h(Btn, {...}, "通过")` 里的文字会整段丢掉——
    // 于是「按钮没有文案」这种界面问题在测试里反而看不出来。
    const children = Array.isArray(node.children) ? node.children.filter((child) => child !== null && child !== undefined) : [];
    const props = { ...(node.props ?? {}) };
    if (children.length === 1) props.children = children[0];
    else if (children.length > 1) props.children = children;
    collect(node.type(props), predicate, out, seen);
  }
  return out;
}
const byClass = (tree, className) =>
  collect(tree, (node) => node.props?.className === className);
const overlays = (tree) => byClass(tree, "SPR_ovl");
const textOf = (node) => {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.children ?? []);
};
const overlayText = (tree) => overlays(tree).map(textOf).join(" | ");
/** 空态格子上的文案（「尚未抽帧」这类）：没产物时有没有被正确盖住，全看这里。 */
const emptyTexts = (tree) => byClass(tree, "SPR_thumbEmpty").map(textOf);

/** 验收控件：审核模式下拉（auto/manual）与「通过」按钮。 */
const modeOptions = (tree) => collect(tree, (node) => node.type === "option").map((node) => node.props?.value);
const approveLabels = (tree) =>
  collect(tree, (node) => node.props?.className === "SPR_btn")
    .map(textOf)
    .filter((text) => text === "通过" || text === "已通过");
const hasReviewModeSelect = (tree) => {
  const options = modeOptions(tree);
  return options.includes("auto") && options.includes("manual");
};

// ── 桩数据 ───────────────────────────────────────────────────────────────
const COMPASSES = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];

function makeProject(overrides = {}) {
  const images = {};
  const videos = {};
  const frames = {};
  for (const compass of COMPASSES) {
    images[compass] = { file: `images/${compass}.png`, status: "ready", updatedAt: 1 };
    videos[compass] = { file: `videos/${compass}.mp4`, status: "ready", updatedAt: 1, remoteStatus: "Success" };
    frames[compass] = { strip: `frames/${compass}.png`, status: "ready", updatedAt: 1, duration: 4, frames: ["a.png"] };
  }
  return {
    id: "p1",
    name: "角色",
    assetBase: "/dsh-game-material-master/assets/p1/",
    updatedAt: 1,
    source: { file: "source/hero.png", name: "hero.png" },
    images,
    videos,
    frames,
    sheet: {
      file: "out/sheet.png",
      status: "ready",
      approved: false,
      generatedAt: 1,
      width: 1024,
      height: 1024,
      rowOrder: null
    },
    prompts: { images: {}, video: "" },
    settings: {},
    log: [],
    jobs: [],
    ...overrides
  };
}

/** 伪 pending 表：activeKeys 里的 key 视为「正在调用接口」。 */
function makeTasks(activeKeys = []) {
  const labels = {};
  for (const key of activeKeys) labels[key] = `正在处理 ${key}…`;
  return {
    map: { ...labels },
    run: () => Promise.resolve(),
    has: (key) => labels[key] !== undefined,
    label: (key) => labels[key],
    any: (prefix) => Object.keys(labels).some((key) => key.startsWith(prefix)),
    keys: (prefix) => Object.keys(labels).filter((key) => key.startsWith(prefix)),
    active: Object.keys(labels).length > 0,
    firstLabel: Object.values(labels)[0]
  };
}

const noop = () => {};
const api = new Proxy(
  {},
  {
    get: () => () => Promise.resolve({})
  }
);

/**
 * 每个组件的「Hook 调用总数」（useState + useRef），顺序与数量都不能变。
 *
 * 为什么用确切数字而不是「不越界」：桩槽位是按顺序喂值的，顺序一挪，
 * 某个 useState 就会读到别人的值——界面上表现为莫名其妙的初始值，
 * 本地却什么都看不出来。数字变了就说明 Hook 顺序改了，必须同步这里的槽位。
 */
const EXPECTED_HOOKS = {
  StudioPanel: 18,
  ImageModule: 14,
  SequenceModule: 15
};

/**
 * 渲染 StudioPanel 的某个阶段。
 *
 * StudioPanel 的 Hook 顺序（只列 state 槽，顺序不能错）：
 *   0 projects / 1 projectId / 2 project / 3 stage / 4 module / 5 notice /
 *   6 loading / 7 promptDraft / 8 promptOpen / 9 videoPromptDraft /
 *   10 settingsDraft / 11 sourceBusy / 12 dropOver / 14 usePendingTasks.map /
 *   15 useStudioIntent（深链接意图；null = 没有待处理的链接）
 * useRef（13 fileInputRef，以及 usePendingTasks 内部的 ref）与 useCallback 不占 state 槽。
 */
function renderStage(project, stage, tasks) {
  HOOK.slots = [
    ["p1"],
    "p1",
    project,
    stage,
    "sprite",
    null,
    false,
    {},
    {},
    "",
    {},
    false,
    false,
    undefined,
    tasks.map,
    null
  ];
  HOOK.cursor = 0;
  hookOverflow = false;
  const tree = panel({ api });
  return { tree, overflow: false, hooks: HOOK.cursor };
}

if (typeof panel !== "function") report();

// ── 阶段①：用户点名的场景 ────────────────────────────────────────────────
section("阶段① 八方向绿幕图");
{
  const idle = renderStage(makeProject(), "images", makeTasks());
  check(
    "Hook 槽位与 StudioPanel 对齐",
    idle.hooks === EXPECTED_HOOKS.StudioPanel,
    `调用 ${idle.hooks} 个 Hook，期望 ${EXPECTED_HOOKS.StudioPanel}`
  );
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
  // 固定流程的审核模式必须能在八方向图界面上看到 / 改。
  check("八方向图有审核模式下拉", hasReviewModeSelect(idle.tree), modeOptions(idle.tree).join("、"));

  const busy = renderStage(makeProject(), "images", makeTasks(["image:upLeft"]));
  check("单方向生成时出现 loading 遮罩", overlays(busy.tree).length >= 1, `${overlays(busy.tree).length} 个`);
  check("遮罩文案带方向", overlayText(busy.tree).includes("image:upLeft"), overlayText(busy.tree));
  check("网格里仍然是 8 个方向", byClass(busy.tree, "SPR_node").length === 8, `${byClass(busy.tree, "SPR_node").length} 个`);
  check(
    "正在生成的方向被标成忙碌",
    byClass(busy.tree, "SPR_node").some((node) => node.props["data-busy"] === "true")
  );
  check("按钮变成转圈（data-busy）", byClass(busy.tree, "SPR_btn").some((node) => node.props["data-busy"] === "true"));

  // 「一键生成全部（跳过已通过的）」＝ 每个方向都会重新出图 → 全部都要盖住
  const batch = renderStage(makeProject(), "images", makeTasks(["image:*all"]));
  check("批量生成时有遮罩", overlays(batch.tree).length >= 2, `${overlays(batch.tree).length} 个`);
  check("批量时出现忙碌徽章", byClass(batch.tree, "SPR_busyBadge").length >= 1);
  check(
    "批量期间重复提交被禁用",
    byClass(batch.tree, "SPR_btn").some((node) => node.props.disabled === true)
  );

  // 「全部重新生成」宿主只重做未通过的方向，所以提交阶段先给工具栏反馈，
  // 具体哪些方向要重做等宿主状态回来再逐个点亮——这里断言转圈与徽章。
  const regenerate = renderStage(makeProject(), "images", makeTasks(["image:*regenerate"]));
  check(
    "全部重新生成时按钮转圈",
    byClass(regenerate.tree, "SPR_btn").some((node) => node.props["data-busy"] === "true")
  );
  check("全部重新生成时出现忙碌徽章", byClass(regenerate.tree, "SPR_busyBadge").length >= 1);

  // 宿主侧那批生成还在跑（本地 pending 早就撤了）：被它覆盖的方向要盖着，
  // 没被覆盖的方向一个遮罩都不能多——覆盖面是按方向公布的，见 job.targets。
  const hostBatch = makeProject();
  hostBatch.images.upLeft = { status: "empty" };
  hostBatch.jobs = [{ key: "images:all", label: "批量生成八方向图", startedAt: 1, targets: ["upLeft", "upRight"] }];
  const hostTree = renderStage(hostBatch, "images", makeTasks()).tree;
  check("宿主批量生图：还没轮到的方向也被盖住", overlays(hostTree).length === 1, `${overlays(hostTree).length} 个`);
  check("宿主批量生图：还没出图的方向显示正在生成", emptyTexts(hostTree).includes("正在生成…"), emptyTexts(hostTree).join("、"));
  check("宿主批量生图期间出现忙碌徽章", byClass(hostTree, "SPR_busyBadge").length >= 1);
  check(
    "宿主批量生图期间重复提交被禁用",
    byClass(hostTree, "SPR_btn").some((node) => node.props.disabled === true)
  );
}

// ── 阶段①的另一条路：转圈截帧（默认）────────────────────────────────────
section("阶段① 转圈截帧（默认生成方式）");
{
  /** 转圈模式的项目桩：一段转圈视频 + 32 张候选帧 + 八个方向图（都是切出来的）。 */
  function makeTurnProject(overrides = {}) {
    const images = {};
    const picks = {};
    const order = ["front", "downLeft", "left", "upLeft", "back", "upRight", "right", "downRight"];
    COMPASSES.forEach((key, index) => {
      images[key] = { file: `images/${key}.png`, status: "ready", updatedAt: 1, model: "转圈截帧" };
      picks[key] = Math.round((index * 32) / 8);
    });
    return makeProject({
      imageMode: "turn",
      images,
      turn: {
        direction: "cw",
        video: { status: "ready", file: "videos/turn.mp4", updatedAt: 1, firstFrame: "source/hero.png", approved: false },
        frames: {
          status: "ready",
          frames: Array.from({ length: 32 }, (_, i) => `turn/frames/f${String(i).padStart(2, "0")}.png`),
          times: Array.from({ length: 32 }, (_, i) => (i * 2) / 32),
          raw: "turn/raw.bin",
          rawWidth: 120,
          rawHeight: 120,
          rawFrameCount: 32,
          duration: 2,
          picks,
          strip: "turn/strip.png",
          approved: false,
          updatedAt: 2
        }
      },
      ...overrides
    });
  }

  /** 把整棵树（含函数组件内部）的文字拼起来：textOf 只走 element.children，够不到组件内部。 */
  const renderedText = (tree) => collect(tree, () => true).map((node) => textOf(node)).join(" | ");

  const idle = renderStage(makeTurnProject(), "images", makeTasks());
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
  const turnPanels = collect(idle.tree, (node) => typeof node.type === "function" && node.type.name === "TurnImageStage");
  check("有转圈截帧面板", turnPanels.length >= 1, `${turnPanels.length} 个`);
  const modeButtons = byClass(idle.tree, "SPR_mode");
  check("两种生成方式都能选", modeButtons.length === 2, `${modeButtons.length} 个`);
  const defaultTag = byClass(idle.tree, "SPR_modeTag");
  check(
    "默认那种被标成「默认」且处于选中态",
    defaultTag.length === 1 &&
      textOf(defaultTag[0]) === "默认" &&
      modeButtons.some((node) => node.props["data-active"] === "true"),
    `${defaultTag.length} 个标记 / ${modeButtons.map((node) => node.props["data-active"]).join(",")}`
  );
  const dots = collect(idle.tree, (node) => typeof node.props?.["data-testid"] === "string" && node.props["data-testid"].startsWith("turn-dot-"));
  check("时间轴上有八个圆圈", dots.length === 8, `${dots.length} 个`);
  check(
    "圆圈是按钮（可聚焦 / 可键盘微调）",
    dots.every((node) => node.type === "button" && typeof node.props.onPointerDown === "function" && typeof node.props.onKeyDown === "function")
  );
  check("圆圈上有缩略条带", byClass(idle.tree, "SPR_axisStrip").length === 1);
  check("转圈视频能播", collect(idle.tree, (node) => node.type === "video").length === 1);
  check("八个方向图都在网格里", byClass(idle.tree, "SPR_node").length === 8, `${byClass(idle.tree, "SPR_node").length} 个`);
  check("转圈模式也有审核模式下拉", hasReviewModeSelect(idle.tree));
  check("有「通过」按钮", approveLabels(idle.tree).length >= 1);

  // 宿主那批「抽候选帧 + 切八张图」还在跑：已经切过的方向在重切时要盖着遮罩，
  // 还没切出来的方向要给可读的等待文案——否则界面会退回「还没有这一方向的图」，
  // 看着像点击没生效（实测过的表现）。
  const cutting = makeTurnProject();
  cutting.jobs = [{ key: "turn:frames", label: "抽取转圈候选帧", startedAt: 1, targets: ["front", "back"] }];
  const cuttingTree = renderStage(cutting, "images", makeTasks()).tree;
  check("切帧期间正在重切的方向被盖住", overlays(cuttingTree).length === 2, `${overlays(cuttingTree).length} 个`);
  check("切帧遮罩文案可读", overlayText(cuttingTree).includes("候选帧"), overlayText(cuttingTree));
  check("切帧期间出现忙碌徽章", byClass(cuttingTree, "SPR_busyBadge").length >= 1);
  check(
    "切帧期间重复抽帧被禁用",
    byClass(cuttingTree, "SPR_btn").some((node) => node.props.disabled === true)
  );

  const cuttingEmpty = makeTurnProject();
  cuttingEmpty.images.front = { status: "empty" };
  cuttingEmpty.jobs = [{ key: "turn:frames", label: "抽取转圈候选帧", startedAt: 1, targets: ["front"] }];
  const cuttingEmptyTree = renderStage(cuttingEmpty, "images", makeTasks()).tree;
  check(
    "还没切出来的方向显示等待文案",
    emptyTexts(cuttingEmptyTree).includes("正在切出这一帧…"),
    emptyTexts(cuttingEmptyTree).join("、")
  );

  // 本地刚点下「生成转圈视频」：视频区要立刻有转圈 / 遮罩反馈。
  const submitting = renderStage(makeTurnProject(), "images", makeTasks(["turn:*video"]));
  check("提交转圈视频时出现遮罩", overlays(submitting.tree).length >= 1, `${overlays(submitting.tree).length} 个`);
  check("提交转圈视频时按钮转圈", byClass(submitting.tree, "SPR_btn").some((node) => node.props["data-busy"] === "true"));

  // 还没有视频（新项目）：整条链路要给出「先做什么」，而不是空白。
  const empty = makeTurnProject();
  COMPASSES.forEach((key) => (empty.images[key] = { status: "empty" }));
  empty.turn = {
    direction: "cw",
    video: { status: "empty", approved: false },
    frames: { status: "empty", frames: [], times: [], picks: Object.fromEntries(COMPASSES.map((k) => [k, 0])), approved: false }
  };
  const emptyTree = renderStage(empty, "images", makeTasks()).tree;
  const emptyRendered = renderedText(emptyTree);
  check("没有视频时给出下一步提示", emptyRendered.includes("生成转圈视频"), emptyRendered.slice(0, 120));
  check("没有候选帧时给出说明", emptyRendered.includes("还没有候选帧"), "");
  check("空闲时仍然一个遮罩都没有", overlays(emptyTree).length === 0, `${overlays(emptyTree).length} 个`);
}

// ── 阶段②：视频 ─────────────────────────────────────────────────────────
section("阶段② 行走动作视频");
{
  const idle = renderStage(makeProject(), "videos", makeTasks());
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
  const busy = renderStage(makeProject(), "videos", makeTasks(["video:front"]));
  check("生成视频时遮罩盖住预览", overlays(busy.tree).length >= 1, `${overlays(busy.tree).length} 个`);
  check("遮罩文案带方向", overlayText(busy.tree).includes("video:front"), overlayText(busy.tree));
  const all = renderStage(makeProject(), "videos", makeTasks(["video:*all"]));
  check("批量提交时未轮到的方向也被盖住", overlays(all.tree).length >= 7, `${overlays(all.tree).length} 个`);

  // 宿主侧那批提交还在跑：覆盖面里的方向盖着，覆盖面外的一个都不多盖。
  const hostSubmit = makeProject();
  hostSubmit.videos.upLeft = { status: "empty" };
  hostSubmit.videos.upRight = { status: "running", remoteStatus: "提交中" };
  hostSubmit.jobs = [{ key: "videos:submit", label: "提交视频任务", startedAt: 1, targets: ["upLeft", "upRight"] }];
  const hostTree = renderStage(hostSubmit, "videos", makeTasks()).tree;
  check("宿主批量提交：还没轮到的方向也被盖住", overlays(hostTree).length === 2, `${overlays(hostTree).length} 个`);
  check("宿主批量提交期间重复提交被禁用", byClass(hostTree, "SPR_btn").some((node) => node.props.disabled === true));
}

// ── 阶段③：抽帧 ─────────────────────────────────────────────────────────
/** 八个方向都还没抽过帧的那一份桩数据（下面两段抽帧用例都要用）。 */
function emptyFrames() {
  const project = makeProject();
  for (const key of COMPASSES) project.frames[key] = { status: "empty", frames: [], keyed: [], approved: false };
  return project;
}
/** 桩：宿主运行表里那次抽帧任务，`targets` 是它负责的方向。 */
function frameJob(targets) {
  return [{ key: "frames:extract", label: "抽取序列帧", startedAt: 1, targets }];
}

section("阶段③ 提取序列帧");
{
  const idle = renderStage(makeProject(), "frames", makeTasks());
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
  const busy = renderStage(makeProject(), "frames", makeTasks(["frames:front"]));
  check("抽帧时遮罩盖住序列条", overlays(busy.tree).length >= 1, `${overlays(busy.tree).length} 个`);
  const all = renderStage(makeProject(), "frames", makeTasks(["frames:*all"]));
  check("批量抽帧时出现忙碌徽章", byClass(all.tree, "SPR_busyBadge").length >= 1);

  // 点下去到「宿主任务表回来」之间那一下：本地 pending 的批量 key 必须自己盖住，
  // 否则会出现一次「点了没反应」的空档。
  const localBatch = renderStage(emptyFrames(), "frames", makeTasks(["frames:*all"]));
  check(
    "本地批量 key 也要盖住还没轮到的方向",
    emptyTexts(localBatch.tree).every((text) => text === "正在抽帧…"),
    emptyTexts(localBatch.tree).join("、")
  );
}

// ── 批量抽帧：还没轮到的方向不能退回空态（实测踩过的坑）──────────────────
//
// 「提取全部序列帧」是 kick 型调用：远程调用立刻返回 `{started:true}`，真正的活在
// 宿主后台一个方向一个方向地做（并发只有 2）。本地 pending 表只多留 700ms，
// 于是点下去八个方向先一起转圈，紧接着还没轮到的那几个变回「尚未抽帧」，
// 过一阵才陆续出结果——看着像点击没生效，用户会以为按钮坏了。
// 宿主的运行表（`project.jobs[].targets`）在整个任务期间都在，界面必须看它。
section("批量抽帧：宿主任务的覆盖面");
{
  const batch = emptyFrames();
  batch.frames.front = { status: "running", frames: [], keyed: [], approved: false };
  // 本地 pending 已经撤了（远程调用早返回了），只剩宿主这张表。
  batch.jobs = frameJob([...COMPASSES]);
  const hostBusy = renderStage(batch, "frames", makeTasks());
  check(
    "宿主还在抽帧时八个方向都不显示「尚未抽帧」",
    emptyTexts(hostBusy.tree).every((text) => text === "正在抽帧…"),
    emptyTexts(hostBusy.tree).join("、")
  );
  check("宿主还在抽帧时出现忙碌徽章", byClass(hostBusy.tree, "SPR_busyBadge").length >= 1);
  check(
    "宿主还在抽帧时重复提交被禁用",
    byClass(hostBusy.tree, "SPR_btn").some((node) => node.props.disabled === true)
  );

  // 抽帧完成、预览带还没写出来的那一小段：仍然算「在跑」，不能闪回空态。
  const writing = makeProject();
  writing.frames.front = { status: "ready", frames: ["frames/front/f00.png"], keyed: [], approved: false, duration: 2 };
  writing.jobs = frameJob(["front"]);
  const gap = renderStage(writing, "frames", makeTasks());
  check(
    "抽完帧但预览带还没出来时不显示「尚未抽帧」",
    emptyTexts(gap.tree).every((text) => text !== "尚未抽帧"),
    emptyTexts(gap.tree).join("、")
  );

  // 只抽一个方向时不能连累其余方向：覆盖面是按方向公布的。
  const single = emptyFrames();
  single.frames.front = { status: "running", frames: [], keyed: [], approved: false };
  single.jobs = frameJob(["front"]);
  const scoped = renderStage(single, "frames", makeTasks());
  check(
    "只抽一个方向时其余方向照常显示「尚未抽帧」",
    emptyTexts(scoped.tree).filter((text) => text === "尚未抽帧").length === 7,
    emptyTexts(scoped.tree).join("、")
  );

  // 抽帧失败的方向必须让人看见错误，不能被遮罩糊住。
  const failed = emptyFrames();
  failed.frames.back = { status: "error", error: "抽帧失败：ffmpeg 挂了", frames: [], keyed: [], approved: false };
  failed.jobs = frameJob([...COMPASSES]);
  const errored = renderStage(failed, "frames", makeTasks());
  check(
    "抽帧失败的方向不被盖住（错误要看得见）",
    emptyTexts(errored.tree).includes("尚未抽帧") &&
      byClass(errored.tree, "SPR_error").length === 1,
    `${emptyTexts(errored.tree).join("、")} / ${byClass(errored.tree, "SPR_error").length} 个错误`
  );

  const idle = renderStage(emptyFrames(), "frames", makeTasks());
  check(
    "没有任务在跑时该显示「尚未抽帧」",
    emptyTexts(idle.tree).every((text) => text === "尚未抽帧"),
    emptyTexts(idle.tree).join("、")
  );
}

// ── 阶段④：合成整图 ─────────────────────────────────────────────────────
section("序列帧预览：双击看大图");
{
  const zoomables = (tree) =>
    collect(tree, (node) => node.props?.["data-zoomable"] === "true" && typeof node.props.onDoubleClick === "function");
  const frames = renderStage(makeProject(), "frames", makeTasks());
  check("空闲时一个遮罩都没有（大图窗口默认关闭）", overlays(frames.tree).length === 0, `${overlays(frames.tree).length} 个`);
  check("八个方向的预览带都能双击放大", zoomables(frames.tree).length === 8, `${zoomables(frames.tree).length} 个`);
  check(
    "缩略图带「双击看大图」提示",
    zoomables(frames.tree).every((node) => node.props.title === "双击看大图")
  );

  // 大图窗口本身：把 __test 里的 ZoomableImage 直接渲染成"已打开"（Hook 槽位喂 true）。
  const { ZoomableImage } = bundle.__test ?? {};
  check("测试把手导出 ZoomableImage", typeof ZoomableImage === "function");
  if (typeof ZoomableImage === "function") {
    HOOK.slots = [true];
    HOOK.cursor = 0;
    const opened = collect(ZoomableImage({ src: "/a/b.png", alt: "第 1 帧", className: "SPR_frame", caption: "第 1 / 8 帧" }), () => true);
    const mask = collect(opened, (node) => node.props?.className === "SPR_zoomMask");
    const close = collect(opened, (node) => node.props?.className === "SPR_zoomClose");
    const big = collect(opened, (node) => node.props?.className === "SPR_zoomImg");
    check("大图窗口渲染出遮罩", mask.length === 1, `${mask.length} 个`);
    check("右上角有关闭按钮", close.length === 1 && textOf(close[0]) === "×", close.map(textOf).join("、"));
    check("大图用的是原图地址", big.length === 1 && big[0].props.src === "/a/b.png");
    check("大图窗口有点击背景关闭", typeof mask[0].props.onClick === "function");
    check("大图窗口有图注", /第 1 \/ 8 帧/.test(textOf(collect(opened, (node) => node.props?.className === "SPR_zoomCaption")[0] ?? {})));
    check("关闭按钮的点击不会冒泡到遮罩", typeof close[0].props.onClick === "function");
  }
}

section("阶段④ 抠绿幕合成整图");
{
  const idle = renderStage(makeProject(), "sheet", makeTasks());
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
  const busy = renderStage(makeProject(), "sheet", makeTasks(["sheet:compose"]));
  check("合成时整图被遮罩盖住", overlays(busy.tree).length >= 1, `${overlays(busy.tree).length} 个`);
  check("遮罩文案说明在合成", overlayText(busy.tree).includes("sheet:compose"), overlayText(busy.tree));
  check(
    "合成期间不显示旧整图",
    byClass(busy.tree, "SPR_sheet").every((node) => node.props.style?.visibility === "hidden")
  );
  const rekey = renderStage(makeProject(), "sheet", makeTasks(["sheet:rekey"]));
  check("重跑抠像时也盖遮罩", overlays(rekey.tree).length >= 1, `${overlays(rekey.tree).length} 个`);
}

// ── 宿主侧状态 running（不是本地 pending）也要有遮罩 ─────────────────────
section("宿主任务状态 running 的反馈");
{
  const project = makeProject();
  project.images.upLeft = { ...project.images.upLeft, status: "running" };
  const busy = renderStage(project, "images", makeTasks());
  check("宿主标 running 的方向出现遮罩", overlays(busy.tree).length >= 1, `${overlays(busy.tree).length} 个`);

  const project2 = makeProject();
  project2.sheet = { ...project2.sheet, status: "running" };
  const running = renderStage(project2, "sheet", makeTasks());
  check("整图 running 时出现遮罩", overlays(running.tree).length >= 1, `${overlays(running.tree).length} 个`);

  const project3 = makeProject();
  project3.frames.front = { ...project3.frames.front, status: "running" };
  const frames = renderStage(project3, "frames", makeTasks());
  check("抽帧 running 时出现遮罩", overlays(frames.tree).length >= 1, `${overlays(frames.tree).length} 个`);
}

// ── 模块②、③ 的组件 ─────────────────────────────────────────────────────
const { ImageModule, SequenceModule } = bundle.__test ?? {};
check("产物带出三个模块组件（__test 把手）", typeof ImageModule === "function" && typeof SequenceModule === "function");

/** 模块②的桩任务。 */
function makeImageJob(overrides = {}) {
  return {
    id: "i1",
    name: "图片任务",
    assetBase: "/dsh-game-material-master/image-assets/i1/",
    updatedAt: 2,
    prompt: "一只猫",
    suffix: "",
    refs: [],
    settings: { count: 2 },
    keying: { enabled: false },
    log: [],
    items: [
      { status: "ready", source: "generated", file: "out/1.png", updatedAt: 2 },
      { status: "ready", source: "generated", file: "out/2.png", updatedAt: 2, keyedFile: "keyed/2.png", backgroundFraction: 0.4 }
    ],
    ...overrides
  };
}

/** 模块③的桩任务。 */
function makeSequenceJob(overrides = {}) {
  return {
    id: "s1",
    name: "序列帧任务",
    assetBase: "/dsh-game-material-master/sequence-assets/s1/",
    updatedAt: 3,
    mode: "frames",
    prompt: "走路",
    suffix: "",
    settings: { duration: 5, resolution: "768P", frameCount: 4 },
    keying: {},
    refs: { firstFrame: { file: "refs/first.png", name: "first.png" }, referenceImages: [], referenceVideos: [] },
    video: { status: "ready", file: "videos/out.mp4", updatedAt: 3, remoteStatus: "Success" },
    frames: { status: "ready", files: ["frames/1.png", "frames/2.png", "frames/3.png"], keyed: ["keyed/1.png", "keyed/2.png", "keyed/3.png"], duration: 5, updatedAt: 3 },
    sheet: { status: "ready", file: "out/strip.png", updatedAt: 3 },
    log: [],
    ...overrides
  };
}

/**
 * 渲染模块②/③。
 *
 * ImageModule 的 useState 顺序：
 *   0 jobs / 1 jobId / 2 job / 3 notice / 4 uploading / 5 promptDraft / 6 suffixDraft /
 *   7 settingsDraft / 8 keyingDraft / 9 useGlobalConfig / 10 usePendingTasks.map /
 *   11 useStudioIntent（深链接意图）
 * SequenceModule 的顺序与之完全相同。
 */
function renderModule(component, job, tasks) {
  HOOK.slots = [
    [job],
    job.id,
    job,
    null,
    false,
    job.prompt ?? "",
    job.suffix ?? "",
    { ...(job.settings ?? {}) },
    { ...(job.keying ?? {}) },
    undefined,
    tasks.map,
    null
  ];
  HOOK.cursor = 0;
  const tree = component({ api });
  return { tree, overflow: false, hooks: HOOK.cursor };
}

if (typeof ImageModule === "function") {
  section("模块② 图片生成");
  {
    const idle = renderModule(ImageModule, makeImageJob(), makeTasks());
    check(
      "Hook 槽位与 ImageModule 对齐",
      idle.hooks === EXPECTED_HOOKS.ImageModule,
      `调用 ${idle.hooks} 个 Hook，期望 ${EXPECTED_HOOKS.ImageModule}`
    );
    check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);

    const gen = renderModule(ImageModule, makeImageJob(), makeTasks(["img:job"]));
    check("整批生成时两张图都被盖住", overlays(gen.tree).length >= 2, `${overlays(gen.tree).length} 个`);
    check("遮罩文案是生成", overlayText(gen.tree).includes("img:job"), overlayText(gen.tree));
    check("按钮转圈", byClass(gen.tree, "SPR_btn").some((node) => node.props["data-busy"] === "true"));

    const one = renderModule(ImageModule, makeImageJob(), makeTasks(["img:item:0"]));
    check("单张重新生成时只有那张被盖住", overlays(one.tree).length === 1, `${overlays(one.tree).length} 个`);

    const key = renderModule(ImageModule, makeImageJob(), makeTasks(["img:key"]));
    check("重新抠像时结果被盖住", overlays(key.tree).length >= 1, `${overlays(key.tree).length} 个`);

    const upload = renderModule(ImageModule, makeImageJob(), makeTasks(["img:upload"]));
    check("上传时出现忙碌徽章", byClass(upload.tree, "SPR_busyBadge").length >= 1);
    check(
      "上传时上传区的按钮转圈",
      byClass(upload.tree, "SPR_btn").some((node) => node.props["data-busy"] === "true")
    );

    // 宿主侧 running：还没轮到的那些也要盖住
    const runningJob = makeImageJob();
    runningJob.items = [
      { status: "running", source: "generated", file: "out/1.png", updatedAt: 2 },
      { status: "empty", source: "generated" }
    ];
    const running = renderModule(ImageModule, runningJob, makeTasks());
    check("宿主 running 时出现遮罩", overlays(running.tree).length >= 1, `${overlays(running.tree).length} 个`);

    // 验收：每张就绪的图都有自己的「通过」，且审核模式下拉在（固定流程的必问项）。
    const acceptance = renderModule(ImageModule, makeImageJob(), makeTasks());
    check("图片结果每张都有「通过」按钮", approveLabels(acceptance.tree).length === 2, approveLabels(acceptance.tree).join("、"));
    check("图片任务有审核模式下拉", hasReviewModeSelect(acceptance.tree), modeOptions(acceptance.tree).join("、"));
    const approvedJob = makeImageJob();
    approvedJob.items = [
      { status: "ready", source: "generated", file: "out/1.png", updatedAt: 2, approved: true },
      { status: "empty", source: "generated" }
    ];
    const approvedTree = renderModule(ImageModule, approvedJob, makeTasks()).tree;
    check("已通过的显示「已通过」", approveLabels(approvedTree).includes("已通过"), approveLabels(approvedTree).join("、"));
    check("未就绪的那张「通过」被禁用", collect(approvedTree, (node) => node.props?.className === "SPR_btn" && textOf(node) === "通过").every((node) => node.props.disabled === true));
  }
}

if (typeof SequenceModule === "function") {
  section("模块③ 序列帧生成");
  {
    const idle = renderModule(SequenceModule, makeSequenceJob(), makeTasks());
    check(
      "Hook 槽位与 SequenceModule 对齐",
      idle.hooks === EXPECTED_HOOKS.SequenceModule,
      `调用 ${idle.hooks} 个 Hook，期望 ${EXPECTED_HOOKS.SequenceModule}`
    );
    check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);

    const video = renderModule(SequenceModule, makeSequenceJob(), makeTasks(["seq:video"]));
    check("生成视频时遮罩盖住 video", overlays(video.tree).length >= 1, `${overlays(video.tree).length} 个`);
    check("遮罩文案是视频", overlayText(video.tree).includes("seq:video"), overlayText(video.tree));

    const frames = renderModule(SequenceModule, makeSequenceJob(), makeTasks(["seq:frames"]));
    check("抽帧时遮罩盖住预览", overlays(frames.tree).length >= 1, `${overlays(frames.tree).length} 个`);

    const key = renderModule(SequenceModule, makeSequenceJob(), makeTasks(["seq:key"]));
    check("重新抠像时遮罩盖住序列帧", overlays(key.tree).length >= 1, `${overlays(key.tree).length} 个`);

    const compose = renderModule(SequenceModule, makeSequenceJob(), makeTasks(["seq:compose"]));
    check("合成条图时遮罩盖住条图", overlays(compose.tree).length >= 1, `${overlays(compose.tree).length} 个`);

    const runningJob = makeSequenceJob();
    runningJob.video = { status: "running", remoteStatus: "Processing" };
    const running = renderModule(SequenceModule, runningJob, makeTasks());
    check("宿主视频 running 时出现遮罩", overlays(running.tree).length >= 1, `${overlays(running.tree).length} 个`);

    // 验收：视频 / 序列帧 / 条图三步各自可「通过」，审核模式下拉在。
    const acceptance = renderModule(SequenceModule, makeSequenceJob(), makeTasks());
    check("序列帧三步都有「通过」按钮", approveLabels(acceptance.tree).length === 3, approveLabels(acceptance.tree).join("、"));
    const seqZoom = collect(
      acceptance.tree,
      (node) => node.props?.["data-zoomable"] === "true" && typeof node.props.onDoubleClick === "function"
    );
    check("序列帧的逐帧缩略图可双击放大", seqZoom.length === 3, `${seqZoom.length} 个`);
    check("序列帧任务有审核模式下拉", hasReviewModeSelect(acceptance.tree), modeOptions(acceptance.tree).join("、"));
    const halfApproved = makeSequenceJob();
    halfApproved.frames = { ...halfApproved.frames, approved: true };
    check(
      "已通过的步骤显示「已通过」",
      collect(renderModule(SequenceModule, halfApproved, makeTasks()).tree, (node) => node.props?.className === "SPR_btn").map(textOf).includes("已通过")
    );
  }
}

// ── 深链接：会话里点一下链接就切到插件页面 ──────────────────────────────
//
// 这一段测的是**真实链路**：装好的捕获阶段监听器 → 解析 href → 切面板 → 广播意图。
// 模型在回复里贴的那条链接能不能用，全靠它。
section("深链接");
{
  const test = bundle.__test ?? {};
  check("测试把手导出深链接工具", typeof test.parseIntents === "function" && typeof test.subscribeIntent === "function", Object.keys(test).join("、"));
  check("拦截器已装在 document 上", CLICK_LISTENERS.length >= 1, `${CLICK_LISTENERS.length} 个监听器`);

  const click = CLICK_LISTENERS[0];
  const link = `http://127.0.0.1:43120/?dsh-gmm=1&module=sprite&project=p1&stage=videos`;

  const received = [];
  const unsubscribe = test.subscribeIntent((intent) => received.push(intent));

  const makeEvent = (href, overrides = {}) => {
    const anchor = { getAttribute: (name) => (name === "href" ? href : null) };
    return {
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { closest: (selector) => (selector === "a[href]" ? anchor : null) },
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...overrides
    };
  };

  const panelsBefore = SELECTED_PANELS.length;
  const event = makeEvent(link);
  click(event);
  check("点击深链接被拦下（不跳转、不新开标签）", event.defaultPrevented === true && event.stopped === true, JSON.stringify({ prevented: event.defaultPrevented, stopped: event.stopped }));
  check("切到了工作台面板", SELECTED_PANELS.length === panelsBefore + 1 && SELECTED_PANELS.at(-1) === bundle.GAME_STUDIO_PANEL_ID, SELECTED_PANELS.at(-1));
  check("意图被广播出去", received.length === 1, JSON.stringify(received));
  check(
    "意图内容与链接一致",
    JSON.stringify(received[0]) === JSON.stringify({ module: "sprite", projectId: "p1", stage: "videos" }),
    JSON.stringify(received[0])
  );

  // 别的链接一律放行——拦错链接比不拦更糟。
  const plain = makeEvent("https://example.com/");
  click(plain);
  check("没有 dsh-gmm 参数的链接放行", plain.defaultPrevented === false, String(plain.defaultPrevented));
  const foreign = makeEvent("https://example.com/?utm=1");
  click(foreign);
  check("站外普通链接放行", foreign.defaultPrevented === false, String(foreign.defaultPrevented));
  // 我们的匹配只看参数、不看 origin：宿主拼链接时未必知道浏览器真实 origin
  // （可能被反代改写），所以换成别的 host 也必须照样切面板。
  const receivedBefore = received.length;
  click(makeEvent("http://192.168.1.9:43120/?dsh-gmm=1&module=image&job=i7"));
  check(
    "origin 不同但带我们的参数，仍按路径切面板",
    received.length === receivedBefore + 1 && received.at(-1).jobId === "i7",
    JSON.stringify(received.at(-1))
  );

  // 用户按 Ctrl / 中键想新开标签页时，不能抢走这次点击。
  const ctrl = makeEvent(link, { ctrlKey: true });
  click(ctrl);
  check("Ctrl+点击交给浏览器新开标签", ctrl.defaultPrevented === false, String(ctrl.defaultPrevented));
  const middle = makeEvent(link, { button: 1 });
  click(middle);
  check("中键点击交给浏览器", middle.defaultPrevented === false, String(middle.defaultPrevented));

  unsubscribe();
  const afterUnsubscribe = received.length;
  click(makeEvent(link));
  check("退订后不再收到意图", received.length === afterUnsubscribe, `${received.length}`);

  // 直接以 /?dsh-gmm=… 打开（中键新开标签的兜底路径）：应用启动时读一次并清掉参数。
  const bootstrapPanels = SELECTED_PANELS.length;
  windowStub.location.search = "?dsh-gmm=1&module=sequence&job=s9";
  windowStub.location.href = `http://127.0.0.1:43120/?dsh-gmm=1&module=sequence&job=s9`;
  const bootstrapReceived = [];
  const unsubscribeBootstrap = test.subscribeIntent((intent) => bootstrapReceived.push(intent));
  // apply 时会执行 consumeUrlIntent（effect 在桩里是立即执行）。
  bundle.apply(fakeCtx);
  check("以深链接打开时会切面板", SELECTED_PANELS.length === bootstrapPanels + 1, `${SELECTED_PANELS.length}`);
  check("地址栏里的参数被清掉", windowStub.location.search === "", windowStub.location.search);
  unsubscribeBootstrap();
  CLICK_LISTENERS.splice(0, CLICK_LISTENERS.length);
}

report();
