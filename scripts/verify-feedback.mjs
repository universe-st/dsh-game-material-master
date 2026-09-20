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
    if (HOOK.cursor >= HOOK.slots.length) hookOverflow = true;
    const value = HOOK.slots[HOOK.cursor++];
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
const fakeCtx = {
  effect(fn) {
    return fn();
  },
  get() {
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
  if (typeof node.type === "function") collect(node.type(node.props ?? {}), predicate, out, seen);
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
 * 渲染 StudioPanel 的某个阶段。
 *
 * StudioPanel 的 Hook 顺序（只列 useState，顺序不能错）：
 *   0 projects / 1 projectId / 2 project / 3 stage / 4 module / 5 notice /
 *   6 loading / 7 promptDraft / 8 promptOpen / 9 videoPromptDraft /
 *   10 settingsDraft / 11 sourceBusy / 12 dropOver / 14 usePendingTasks.map
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
    tasks.map
  ];
  HOOK.cursor = 0;
  hookOverflow = false;
  const tree = panel({ api });
  return { tree, overflow: hookOverflow, hooks: HOOK.cursor };
}

if (typeof panel !== "function") report();

// ── 阶段①：用户点名的场景 ────────────────────────────────────────────────
section("阶段① 八方向绿幕图");
{
  const idle = renderStage(makeProject(), "images", makeTasks());
  check("Hook 槽位与 StudioPanel 对齐", idle.overflow === false, idle.overflow ? "useState 调用次数超出桩槽位" : `${HOOK.cursor} 个`);
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);

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
}

// ── 阶段③：抽帧 ─────────────────────────────────────────────────────────
section("阶段③ 提取序列帧");
{
  const idle = renderStage(makeProject(), "frames", makeTasks());
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
  const busy = renderStage(makeProject(), "frames", makeTasks(["frames:front"]));
  check("抽帧时遮罩盖住序列条", overlays(busy.tree).length >= 1, `${overlays(busy.tree).length} 个`);
  const all = renderStage(makeProject(), "frames", makeTasks(["frames:*all"]));
  check("批量抽帧时出现忙碌徽章", byClass(all.tree, "SPR_busyBadge").length >= 1);
}

// ── 阶段④：合成整图 ─────────────────────────────────────────────────────
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
    frames: { status: "ready", files: ["frames/1.png"], keyed: ["keyed/1.png"], duration: 5, updatedAt: 3 },
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
 *   7 settingsDraft / 8 keyingDraft / 9 useGlobalConfig / 10 usePendingTasks.map
 * SequenceModule 的顺序：
 *   0 jobs / 1 jobId / 2 job / 3 notice / 4 uploading / 5 promptDraft / 6 suffixDraft /
 *   7 settingsDraft / 8 keyingDraft / 9 useGlobalConfig / 10 usePendingTasks.map
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
    tasks.map
  ];
  HOOK.cursor = 0;
  hookOverflow = false;
  const tree = component({ api });
  return { tree, overflow: hookOverflow };
}

if (typeof ImageModule === "function") {
  section("模块② 图片生成");
  {
    const idle = renderModule(ImageModule, makeImageJob(), makeTasks());
    check("Hook 槽位与 ImageModule 对齐", idle.overflow === false, idle.overflow ? "useState 调用次数超出桩槽位" : `${HOOK.cursor} 个`);
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
  }
}

if (typeof SequenceModule === "function") {
  section("模块③ 序列帧生成");
  {
    const idle = renderModule(SequenceModule, makeSequenceJob(), makeTasks());
    check("Hook 槽位与 SequenceModule 对齐", idle.overflow === false, idle.overflow ? "useState 调用次数超出桩槽位" : `${HOOK.cursor} 个`);
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
  }
}

report();
